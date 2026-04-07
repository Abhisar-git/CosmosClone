import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const WORLD = { width: 1100, height: 640 };
const PROXIMITY_RADIUS = 120;

const ROOMS = [
  {
    id: "focus",
    label: "Focus Room",
    activity: "Deep work",
    color: "#8ecae6",
    x: 40,
    y: 40,
    width: 250,
    height: 170
  },
  {
    id: "sprint",
    label: "Sprint Zone",
    activity: "Daily standup",
    color: "#ffb703",
    x: 320,
    y: 40,
    width: 260,
    height: 170
  },
  {
    id: "lounge",
    label: "Lounge",
    activity: "Casual chat",
    color: "#bde0fe",
    x: 610,
    y: 40,
    width: 260,
    height: 170
  },
  {
    id: "game",
    label: "Game Corner",
    activity: "Play & reset",
    color: "#ffafcc",
    x: 200,
    y: 250,
    width: 300,
    height: 180
  },
  {
    id: "workshop",
    label: "Workshop",
    activity: "Pairing",
    color: "#caffbf",
    x: 540,
    y: 250,
    width: 300,
    height: 180
  }
];

const ROOM_SPAWN_MARGIN = 34;
const ROOM_SPAWN_GAP = 36;
const MAX_NOTES = 12;
const MAX_MESSAGE_LENGTH = 500;

const ROOM_CHAT_CHANNEL = (roomId) => `room:${roomId}`;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.get("/health", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true }
});

const users = new Map();
const connections = new Set();
const presenceHistory = new Map();
const roomStates = new Map(
  ROOMS.map((room) => [
    room.id,
    {
      notes: [],
      timer: {
        running: false,
        elapsedMs: 0,
        startedAt: null
      }
    }
  ])
);

const namePool = [
  "Nova",
  "Atlas",
  "Orion",
  "Luna",
  "Vega",
  "Sage",
  "Kai",
  "Indie",
  "Rin",
  "Sol",
  "Echo",
  "Juno"
];

const colorPool = [
  "#ff915a",
  "#29b6b0",
  "#f6c453",
  "#4e7cff",
  "#ec6b9a",
  "#53c27f"
];

const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const now = () => Date.now();
const sanitizeName = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, 24);
  return trimmed.length ? trimmed : fallback;
};
const sanitizeColor = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
};
const sanitizeStatus = (value) => {
  if (value === "busy" || value === "away") return value;
  return "available";
};
const sanitizeAccessories = (value = {}) => ({
  hat: Boolean(value.hat),
  glasses: Boolean(value.glasses)
});

const getRoomState = (roomId) =>
  roomStates.get(roomId) || { notes: [], timer: { running: false, elapsedMs: 0, startedAt: null } };

const getTimerElapsed = (timer) => {
  if (!timer.running || !timer.startedAt) return timer.elapsedMs;
  return timer.elapsedMs + (now() - timer.startedAt);
};

const buildTimerPayload = (timer) => ({
  running: timer.running,
  elapsedMs: getTimerElapsed(timer),
  startedAt: timer.running ? timer.startedAt : null
});
const getRoomForPosition = (x, y) => {
  const room = ROOMS.find(
    (item) =>
      x >= item.x &&
      x <= item.x + item.width &&
      y >= item.y &&
      y <= item.y + item.height
  );
  return room ? room.id : null;
};

const buildSpawnPoints = (room) => {
  const points = [];
  const startX = room.x + ROOM_SPAWN_MARGIN;
  const startY = room.y + ROOM_SPAWN_MARGIN;
  const endX = room.x + room.width - ROOM_SPAWN_MARGIN;
  const endY = room.y + room.height - ROOM_SPAWN_MARGIN;

  for (let y = startY; y <= endY; y += ROOM_SPAWN_GAP) {
    for (let x = startX; x <= endX; x += ROOM_SPAWN_GAP) {
      points.push({ x, y });
    }
  }

  return points;
};

const roomSpawnPoints = new Map(ROOMS.map((room) => [room.id, buildSpawnPoints(room)]));
const roomSpawnIndex = new Map(ROOMS.map((room) => [room.id, 0]));

const getRoomOccupancy = (roomId) => {
  let count = 0;
  for (const user of users.values()) {
    if (user.roomId === roomId) count += 1;
  }
  return count;
};

const pickRoomForNewUser = () => {
  let target = ROOMS[0];
  let targetCount = getRoomOccupancy(target.id);

  for (const room of ROOMS.slice(1)) {
    const count = getRoomOccupancy(room.id);
    if (count < targetCount) {
      target = room;
      targetCount = count;
    }
  }

  return target.id;
};

const pickSpawnForRoom = (roomId) => {
  const points = roomSpawnPoints.get(roomId);
  if (!points || points.length === 0) {
    return {
      x: Math.floor(Math.random() * (WORLD.width - 80) + 40),
      y: Math.floor(Math.random() * (WORLD.height - 80) + 40)
    };
  }

  const index = roomSpawnIndex.get(roomId) ?? 0;
  roomSpawnIndex.set(roomId, (index + 1) % points.length);
  return points[index];
};

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const roomId = (a, b) => `pair:${pairKey(a, b)}`;
const roomChannel = (room) => (room ? ROOM_CHAT_CHANNEL(room) : null);

const getSocketByUserId = (userId) => {
  const user = users.get(userId);
  if (!user) return null;
  return io.sockets.sockets.get(user.socketId) || null;
};

const emitConnection = (socket, payload) => {
  if (!socket) return;
  socket.emit("proximity:connect", payload);
};

const emitDisconnection = (socket, payload) => {
  if (!socket) return;
  socket.emit("proximity:disconnect", payload);
};

const emitRoomState = (socket, room) => {
  if (!socket || !room) return;
  const state = getRoomState(room);
  socket.emit("room:state", {
    roomId: room,
    notes: state.notes,
    timer: buildTimerPayload(state.timer)
  });
};

const updateRoomMembership = (socket, user, nextRoomId) => {
  if (!socket || !user) return;
  const current = user.roomId;
  if (current === nextRoomId) return;

  if (current) {
    socket.leave(roomChannel(current));
  }
  if (nextRoomId) {
    socket.join(roomChannel(nextRoomId));
    emitRoomState(socket, nextRoomId);
  }
  user.roomId = nextRoomId;
};

const connectPair = (a, b) => {
  const key = pairKey(a, b);
  if (connections.has(key)) return;

  const socketA = getSocketByUserId(a);
  const socketB = getSocketByUserId(b);
  if (!socketA || !socketB) return;

  const room = roomId(a, b);
  socketA.join(room);
  socketB.join(room);

  connections.add(key);

  const userA = users.get(a);
  const userB = users.get(b);
  emitConnection(socketA, { with: userB, roomId: room });
  emitConnection(socketB, { with: userA, roomId: room });
};

const disconnectPair = (a, b) => {
  const key = pairKey(a, b);
  if (!connections.has(key)) return;

  connections.delete(key);
  const room = roomId(a, b);

  const socketA = getSocketByUserId(a);
  const socketB = getSocketByUserId(b);

  if (socketA) {
    socketA.leave(room);
    emitDisconnection(socketA, { withId: b, roomId: room });
  }
  if (socketB) {
    socketB.leave(room);
    emitDisconnection(socketB, { withId: a, roomId: room });
  }
};

const updateProximityForUser = (userId) => {
  const user = users.get(userId);
  if (!user) return;

  for (const [otherId, other] of users.entries()) {
    if (otherId === userId) continue;

    const dx = user.x - other.x;
    const dy = user.y - other.y;
    const distance = Math.hypot(dx, dy);

    if (distance < PROXIMITY_RADIUS) {
      connectPair(userId, otherId);
    } else {
      disconnectPair(userId, otherId);
    }
  }
};

io.on("connection", (socket) => {
  const userId = socket.id;
  const assignedRoomId = pickRoomForNewUser();
  const spawn = pickSpawnForRoom(assignedRoomId);

  const user = {
    id: userId,
    name: `${randomItem(namePool)}-${Math.floor(Math.random() * 90 + 10)}`,
    x: spawn.x,
    y: spawn.y,
    color: randomItem(colorPool),
    socketId: socket.id,
    roomId: assignedRoomId,
    status: "available",
    accessories: {
      hat: false,
      glasses: false
    },
    emote: null
  };

  users.set(userId, user);
  socket.data.userId = userId;

  socket.emit("init", {
    selfId: userId,
    user,
    users: Array.from(users.values()),
    world: WORLD,
    proximityRadius: PROXIMITY_RADIUS,
    rooms: ROOMS
  });

  socket.join(roomChannel(assignedRoomId));
  emitRoomState(socket, assignedRoomId);

  socket.broadcast.emit("user:join", user);
  updateProximityForUser(userId);

  socket.on("user:move", (payload) => {
    if (!payload || typeof payload.x !== "number" || typeof payload.y !== "number") return;

    const current = users.get(userId);
    if (!current) return;

    const nextX = clamp(payload.x, 12, WORLD.width - 12);
    const nextY = clamp(payload.y, 12, WORLD.height - 12);
    const nextRoomId = getRoomForPosition(nextX, nextY);

    current.x = nextX;
    current.y = nextY;
    updateRoomMembership(socket, current, nextRoomId);

    socket.broadcast.emit("user:move", {
      id: userId,
      x: nextX,
      y: nextY,
      roomId: current.roomId
    });
    updateProximityForUser(userId);
  });

  socket.on("user:update", (payload) => {
    const current = users.get(userId);
    if (!current || !payload) return;

    const nextName = sanitizeName(payload.name, current.name);
    const nextColor = sanitizeColor(payload.color, current.color);
    const nextStatus = sanitizeStatus(payload.status);
    const nextAccessories = sanitizeAccessories(payload.accessories);

    current.name = nextName;
    current.color = nextColor;
    current.status = nextStatus;
    current.accessories = nextAccessories;

    io.emit("user:update", {
      id: userId,
      name: current.name,
      color: current.color,
      status: current.status,
      accessories: current.accessories
    });
  });

  socket.on("user:emote", (payload) => {
    const current = users.get(userId);
    if (!current || !payload || typeof payload.type !== "string") return;

    const type = payload.type.trim().slice(0, 16);
    if (!type) return;

    current.emote = { type, ts: now() };
    io.emit("user:emote", { id: userId, type, ts: current.emote.ts });
  });

  const handleDirectMessage = (payload) => {
    if (!payload || typeof payload.text !== "string") return;

    const text = payload.text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return;

    const room = payload.roomId;
    if (!room || !socket.rooms.has(room)) return;

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      roomId: room,
      from: userId,
      text,
      ts: now()
    };

    io.to(room).emit("direct:message", message);
  };

  socket.on("direct:message", handleDirectMessage);
  socket.on("chat:message", handleDirectMessage);

  socket.on("direct:typing", (payload) => {
    if (!payload) return;
    const room = payload.roomId;
    if (!room || !socket.rooms.has(room)) return;
    socket.to(room).emit("direct:typing", {
      from: userId,
      roomId: room,
      isTyping: Boolean(payload.isTyping)
    });
  });

  socket.on("room:message", (payload) => {
    const current = users.get(userId);
    if (!current || !current.roomId || !payload || typeof payload.text !== "string") return;
    const text = payload.text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return;

    const room = current.roomId;
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      roomId: room,
      from: userId,
      text,
      ts: now()
    };

    io.to(roomChannel(room)).emit("room:message", message);
  });

  socket.on("room:typing", (payload) => {
    const current = users.get(userId);
    if (!current || !current.roomId) return;
    socket.to(roomChannel(current.roomId)).emit("room:typing", {
      from: userId,
      roomId: current.roomId,
      isTyping: Boolean(payload?.isTyping)
    });
  });

  socket.on("room:note:add", (payload) => {
    const current = users.get(userId);
    if (!current || !current.roomId || !payload || typeof payload.text !== "string") return;
    const text = payload.text.trim().slice(0, 120);
    if (!text) return;
    const state = getRoomState(current.roomId);
    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      author: current.name,
      ts: now()
    };
    state.notes.push(note);
    if (state.notes.length > MAX_NOTES) state.notes.shift();
    roomStates.set(current.roomId, state);
    io.to(roomChannel(current.roomId)).emit("room:note:add", {
      roomId: current.roomId,
      note
    });
  });

  socket.on("room:timer", (payload) => {
    const current = users.get(userId);
    if (!current || !current.roomId || !payload || typeof payload.action !== "string") return;
    const state = getRoomState(current.roomId);
    const timer = state.timer;
    const action = payload.action;

    if (action === "start" && !timer.running) {
      timer.running = true;
      timer.startedAt = now();
    } else if (action === "pause" && timer.running) {
      timer.elapsedMs = getTimerElapsed(timer);
      timer.running = false;
      timer.startedAt = null;
    } else if (action === "reset") {
      timer.elapsedMs = 0;
      timer.startedAt = timer.running ? now() : null;
    }

    roomStates.set(current.roomId, state);
    io.to(roomChannel(current.roomId)).emit("room:timer:update", {
      roomId: current.roomId,
      timer: buildTimerPayload(timer)
    });
  });

  socket.on("disconnect", () => {
    const leaving = users.get(userId);
    if (!leaving) return;

    users.delete(userId);
    const lastSeen = now();
    presenceHistory.set(userId, { name: leaving.name, lastSeen });

    for (const key of Array.from(connections)) {
      const [a, b] = key.split("|");
      if (a === userId || b === userId) disconnectPair(a, b);
    }

    socket.broadcast.emit("user:leave", {
      id: userId,
      name: leaving.name,
      lastSeen
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
