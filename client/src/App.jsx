import React, { useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const MOVE_SPEED = 2.4;
const EMIT_INTERVAL = 33;

const hexToNumber = (hex) => Number.parseInt(hex.replace("#", ""), 16);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const keyDirections = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0]
};

const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const formatElapsed = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const WALL_HEIGHT = 170;

const defaultRooms = [
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

const FURNITURE = [
  { x: 80, y: 70, w: 26, h: 26 },
  { x: 150, y: 110, w: 26, h: 26 },
  { x: 230, y: 90, w: 26, h: 26 },
  { x: 300, y: 125, w: 26, h: 26 },
  { x: 760, y: 90, w: 26, h: 26 },
  { x: 830, y: 135, w: 26, h: 26 },
  { x: 900, y: 90, w: 26, h: 26 },
  { x: 980, y: 135, w: 26, h: 26 }
];

const COLOR_OPTIONS = ["#ff915a", "#29b6b0", "#f6c453", "#4e7cff", "#ec6b9a", "#53c27f"];
const STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "busy", label: "Busy" },
  { value: "away", label: "Away" }
];
const EMOTE_OPTIONS = [
  { id: "wave", label: "Wave", symbol: "WAVE" },
  { id: "heart", label: "Heart", symbol: "<3" },
  { id: "clap", label: "Clap", symbol: "CLAP" }
];

const lighten = (hex, amt = 0.3) => {
  const num = Number.parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.floor(((num >> 16) & 255) + 255 * amt));
  const g = Math.min(255, Math.floor(((num >> 8) & 255) + 255 * amt));
  const b = Math.min(255, Math.floor((num & 255) + 255 * amt));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const darken = (hex, amt = 0.3) => {
  const num = Number.parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.floor(((num >> 16) & 255) * (1 - amt)));
  const g = Math.max(0, Math.floor(((num >> 8) & 255) * (1 - amt)));
  const b = Math.max(0, Math.floor((num & 255) * (1 - amt)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const getRoomIdForPosition = (rooms, x, y) => {
  const match = rooms.find(
    (room) =>
      x >= room.x &&
      x <= room.x + room.width &&
      y >= room.y &&
      y <= room.y + room.height
  );
  return match ? match.id : null;
};

const drawAvatarParts = (parts, user) => {
  const bodyColor = user.color || "#ff915a";
  const headColor = lighten(bodyColor, 0.35);
  const hairColor = darken(bodyColor, 0.55);

  parts.shadow.clear();
  parts.shadow.beginFill(hexToNumber("#000000"), 0.18);
  parts.shadow.drawEllipse(0, 18, 14, 6);
  parts.shadow.endFill();

  parts.head.clear();
  parts.head.beginFill(hexToNumber(headColor));
  parts.head.drawCircle(0, 0, 9);
  parts.head.endFill();
  parts.head.lineStyle(1, hexToNumber("#1f2a31"), 0.15);

  parts.hair.clear();
  parts.hair.beginFill(hexToNumber(hairColor));
  parts.hair.drawRoundedRect(-9, -9, 18, 8, 4);
  parts.hair.endFill();

  parts.eyeLeft.clear();
  parts.eyeLeft.beginFill(hexToNumber("#1f2a31"), 0.75);
  parts.eyeLeft.drawCircle(-3, -1, 1.2);
  parts.eyeLeft.endFill();

  parts.eyeRight.clear();
  parts.eyeRight.beginFill(hexToNumber("#1f2a31"), 0.75);
  parts.eyeRight.drawCircle(3, -1, 1.2);
  parts.eyeRight.endFill();

  parts.mouth.clear();
  parts.mouth.lineStyle(1.2, hexToNumber("#1f2a31"), 0.6);
  parts.mouth.moveTo(-3, 3);
  parts.mouth.quadraticCurveTo(0, 5, 3, 3);

  parts.body.clear();
  parts.body.beginFill(hexToNumber(bodyColor));
  parts.body.lineStyle(1, hexToNumber("#1f2a31"), 0.2);
  parts.body.drawRoundedRect(-10, 8, 20, 18, 6);
  parts.body.endFill();

  parts.legLeft.clear();
  parts.legLeft.beginFill(hexToNumber("#1f2a31"), 0.35);
  parts.legLeft.drawRoundedRect(-8, 24, 6, 8, 3);
  parts.legLeft.endFill();

  parts.legRight.clear();
  parts.legRight.beginFill(hexToNumber("#1f2a31"), 0.35);
  parts.legRight.drawRoundedRect(2, 24, 6, 8, 3);
  parts.legRight.endFill();

  parts.glasses.clear();
  if (user.accessories?.glasses) {
    parts.glasses.lineStyle(1.6, hexToNumber("#1f2a31"), 0.7);
    parts.glasses.drawRoundedRect(-8, -4, 6, 6, 2);
    parts.glasses.drawRoundedRect(2, -4, 6, 6, 2);
    parts.glasses.moveTo(-2, -1);
    parts.glasses.lineTo(2, -1);
    parts.glasses.visible = true;
  } else {
    parts.glasses.visible = false;
  }

  parts.hat.clear();
  parts.hat.beginFill(hexToNumber(darken(bodyColor, 0.45)), 0.9);
  parts.hat.drawRoundedRect(-10, -14, 20, 6, 3);
  parts.hat.endFill();
  parts.hat.beginFill(hexToNumber(darken(bodyColor, 0.55)), 0.9);
  parts.hat.drawRoundedRect(-7, -20, 14, 8, 3);
  parts.hat.endFill();

  parts.hat.visible = Boolean(user.accessories?.hat);

};

const createAvatar = (user) => {
  const container = new PIXI.Container();
  const parts = {
    shadow: new PIXI.Graphics(),
    head: new PIXI.Graphics(),
    hair: new PIXI.Graphics(),
    eyeLeft: new PIXI.Graphics(),
    eyeRight: new PIXI.Graphics(),
    mouth: new PIXI.Graphics(),
    body: new PIXI.Graphics(),
    legLeft: new PIXI.Graphics(),
    legRight: new PIXI.Graphics(),
    glasses: new PIXI.Graphics(),
    hat: new PIXI.Graphics()
  };

  const label = new PIXI.Text(user.name || "Visitor", {
    fontFamily: "Space Grotesk, sans-serif",
    fontSize: 12,
    fill: hexToNumber("#1f2a31")
  });
  label.anchor.set(0.5, -1.8);

  const emoteBubble = new PIXI.Graphics();
  const emote = new PIXI.Text("", {
    fontFamily: "Space Grotesk, sans-serif",
    fontSize: 11,
    fill: hexToNumber("#ffffff"),
    stroke: hexToNumber("#1f2230"),
    strokeThickness: 3
  });
  emote.anchor.set(0.5, 0.5);
  emote.position.set(0, -34);

  drawAvatarParts(parts, user);

  container.addChild(parts.shadow);
  container.addChild(parts.legLeft);
  container.addChild(parts.legRight);
  container.addChild(parts.body);
  container.addChild(parts.head);
  container.addChild(parts.hair);
  container.addChild(parts.hat);
  container.addChild(parts.eyeLeft);
  container.addChild(parts.eyeRight);
  container.addChild(parts.glasses);
  container.addChild(parts.mouth);
  container.addChild(label);
  container.addChild(emoteBubble);
  container.addChild(emote);

  return {
    container,
    parts,
    label,
    emote,
    emoteBubble,
    meta: { color: user.color, name: user.name, accessories: user.accessories }
  };
};

const createRoomArea = (room) => {
  const container = new PIXI.Container();
  const base = new PIXI.Graphics();
  base.beginFill(hexToNumber(room.color), 0.16);
  base.lineStyle(2, hexToNumber(room.color), 0.6);
  base.drawRoundedRect(0, 0, room.width, room.height, 18);
  base.endFill();

  const badgeText = new PIXI.Text(room.label, {
    fontFamily: "Space Grotesk, sans-serif",
    fontSize: 12,
    fill: hexToNumber("#ffffff")
  });
  const subText = new PIXI.Text(room.activity, {
    fontFamily: "Space Grotesk, sans-serif",
    fontSize: 10,
    fill: hexToNumber("#e6e9f3")
  });

  const badgeWidth = Math.max(badgeText.width, subText.width) + 24;
  const badgeHeight = 34;
  const badge = new PIXI.Graphics();
  badge.beginFill(hexToNumber("#1f2230"), 0.9);
  badge.drawRoundedRect(10, 10, badgeWidth, badgeHeight, 10);
  badge.endFill();

  badgeText.x = 18;
  badgeText.y = 12;
  subText.x = 18;
  subText.y = 22;

  container.addChild(base);
  container.addChild(badge);
  container.addChild(badgeText);
  container.addChild(subText);

  return container;
};

const createFurniture = ({ w, h }) => {
  const block = new PIXI.Graphics();
  block.beginFill(hexToNumber("#c19a6b"), 0.8);
  block.lineStyle(1, hexToNumber("#9a7248"), 0.8);
  block.drawRoundedRect(0, 0, w, h, 6);
  block.endFill();
  return block;
};

const PixiStage = ({ world, rooms, usersRef, selfIdRef }) => {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const spritesRef = useRef(new Map());
  const radiusRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    const app = new PIXI.Application();
    const container = containerRef.current;
    if (!container) return () => {};
    let avatarLayer = null;

    const tick = () => {
      const users = usersRef.current;
      const sprites = spritesRef.current;

      for (const [id, user] of Object.entries(users)) {
        let sprite = sprites.get(id);
        if (!sprite) {
          sprite = createAvatar(user);
          sprites.set(id, sprite);
          if (avatarLayer) avatarLayer.addChild(sprite.container);
        }
        if (
          sprite.meta?.color !== user.color ||
          sprite.meta?.name !== user.name ||
          JSON.stringify(sprite.meta?.accessories) !== JSON.stringify(user.accessories)
        ) {
          drawAvatarParts(sprite.parts, user);
          sprite.meta = { color: user.color, name: user.name, accessories: user.accessories };
        }
        if (sprite.label && sprite.label.text !== (user.name || "Visitor")) {
          sprite.label.text = user.name || "Visitor";
        }
        const emoteActive = user.emote && Date.now() - user.emote.ts < 2200;
        if (sprite.emote) {
          sprite.emote.text = emoteActive ? user.emote.type : "";
        }
        if (sprite.emoteBubble) {
          if (emoteActive && sprite.emote?.text) {
            const paddingX = 6;
            const paddingY = 4;
            const width = sprite.emote.width + paddingX * 2;
            const height = sprite.emote.height + paddingY * 2;
            sprite.emoteBubble.clear();
            sprite.emoteBubble.beginFill(hexToNumber("#1f2230"), 0.85);
            sprite.emoteBubble.drawRoundedRect(
              -width / 2,
              sprite.emote.y - height / 2,
              width,
              height,
              6
            );
            sprite.emoteBubble.endFill();
            sprite.emoteBubble.visible = true;
          } else {
            sprite.emoteBubble.clear();
            sprite.emoteBubble.visible = false;
          }
        }
        sprite.container.x = user.x;
        sprite.container.y = user.y;
      }

      for (const [id, sprite] of Array.from(sprites.entries())) {
        if (!users[id]) {
          if (avatarLayer) avatarLayer.removeChild(sprite.container);
          sprite.container.destroy({ children: true });
          sprites.delete(id);
        }
      }

      if (!radiusRef.current) return;
      radiusRef.current.clear();
      const selfId = selfIdRef.current;
      if (selfId && users[selfId]) {
        radiusRef.current.lineStyle(1.5, hexToNumber("#29b6b0"), 0.35);
        radiusRef.current.drawCircle(
          users[selfId].x,
          users[selfId].y,
          world.radius
        );
      }
    };

    (async () => {
      await app.init({
        width: world.width,
        height: world.height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2)
      });

      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }

      appRef.current = app;
      container.innerHTML = "";
      container.appendChild(app.canvas);
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      app.canvas.style.display = "block";

      const frame = new PIXI.Graphics();
      frame.lineStyle(2, hexToNumber("#1f2a31"), 0.2);
      frame.drawRoundedRect(0, 0, world.width, world.height, 18);
      app.stage.addChild(frame);

      const envLayer = new PIXI.Container();
      app.stage.addChild(envLayer);

      const wall = new PIXI.Graphics();
      wall.beginFill(hexToNumber("#d7b48d"), 0.92);
      wall.drawRect(0, 0, world.width, WALL_HEIGHT);
      wall.endFill();
      envLayer.addChild(wall);

      const wallDivider = new PIXI.Graphics();
      wallDivider.lineStyle(6, hexToNumber("#b28a61"), 0.65);
      wallDivider.moveTo(world.width / 2, 0);
      wallDivider.lineTo(world.width / 2, WALL_HEIGHT);
      envLayer.addChild(wallDivider);

      const lounge = new PIXI.Graphics();
      lounge.beginFill(hexToNumber("#ffffff"), 0.16);
      lounge.drawRoundedRect(world.width / 2 - 190, world.height / 2 - 70, 380, 140, 26);
      lounge.endFill();
      envLayer.addChild(lounge);

      const furnitureLayer = new PIXI.Container();
      app.stage.addChild(furnitureLayer);

      FURNITURE.forEach((item) => {
        const block = createFurniture(item);
        block.x = item.x;
        block.y = item.y;
        furnitureLayer.addChild(block);
      });

      const radiusGraphic = new PIXI.Graphics();
      radiusRef.current = radiusGraphic;
      app.stage.addChild(radiusGraphic);

      avatarLayer = new PIXI.Container();
      app.stage.addChild(avatarLayer);

      const roomLayer = new PIXI.Container();
      app.stage.addChild(roomLayer);

      rooms.forEach((room) => {
        const area = createRoomArea(room);
        area.x = room.x;
        area.y = room.y;
        roomLayer.addChild(area);
      });

      app.ticker.add(tick);
    })();

    return () => {
      disposed = true;
      if (appRef.current) {
        appRef.current.ticker.remove(tick);
        appRef.current.destroy(true, { children: true });
      }
    };
  }, [world.width, world.height, world.radius, rooms, usersRef, selfIdRef]);

  return <div ref={containerRef} className="pixi-stage" />;
};

const MiniMap = ({ world, rooms, users, selfId }) => {
  const width = 180;
  const height = 120;
  const scaleX = width / world.width;
  const scaleY = height / world.height;

  return (
    <div className="minimap">
      <div className="minimap-title">Map</div>
      <div className="minimap-body" style={{ width, height }}>
        {rooms.map((room) => (
          <div
            key={room.id}
            className="minimap-room"
            style={{
              left: room.x * scaleX,
              top: room.y * scaleY,
              width: room.width * scaleX,
              height: room.height * scaleY,
              borderColor: room.color
            }}
          />
        ))}
        {Object.values(users).map((user) => (
          <span
            key={user.id}
            className={`minimap-dot ${user.id === selfId ? "self" : ""}`}
            style={{
              left: user.x * scaleX,
              top: user.y * scaleY,
              background: user.color || "#ffffff"
            }}
          />
        ))}
      </div>
    </div>
  );
};

const App = () => {
  const [selfId, setSelfId] = useState(null);
  const [world, setWorld] = useState({ width: 1100, height: 640, radius: 120 });
  const [users, setUsers] = useState({});
  const [rooms, setRooms] = useState(defaultRooms);
  const [connections, setConnections] = useState({});
  const [activeDirectId, setActiveDirectId] = useState(null);
  const [directMessages, setDirectMessages] = useState({});
  const [roomMessages, setRoomMessages] = useState({});
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("connecting");
  const [chatMode, setChatMode] = useState("room");
  const [typingState, setTypingState] = useState({ room: {}, direct: {} });
  const [roomStates, setRoomStates] = useState({});
  const [noteDraft, setNoteDraft] = useState("");
  const [recentlyLeft, setRecentlyLeft] = useState([]);
  const [profile, setProfile] = useState({
    name: "",
    color: COLOR_OPTIONS[0],
    status: "available",
    accessories: { hat: false, glasses: false }
  });

  const socketRef = useRef(null);
  const usersRef = useRef(users);
  const selfIdRef = useRef(selfId);
  const keysRef = useRef({});
  const lastEmitRef = useRef(0);
  const typingTimeoutsRef = useRef({ room: new Map(), direct: new Map() });
  const typingEmitRef = useRef(null);

  const updateUsers = (updater) => {
    setUsers((prev) => {
      const next = updater(prev);
      usersRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("online"));
    socket.on("disconnect", () => setStatus("offline"));

    socket.on("init", (payload) => {
      const nextUsers = {};
      for (const user of payload.users || []) {
        nextUsers[user.id] = user;
      }
      updateUsers(() => nextUsers);
      setSelfId(payload.selfId);
      setWorld({
        width: payload.world?.width || 960,
        height: payload.world?.height || 600,
        radius: payload.proximityRadius || 120
      });
      setRooms(payload.rooms?.length ? payload.rooms : defaultRooms);
      if (payload.user) {
        setProfile({
          name: payload.user.name || "",
          color: payload.user.color || COLOR_OPTIONS[0],
          status: payload.user.status || "available",
          accessories: payload.user.accessories || { hat: false, glasses: false }
        });
      }
    });

    socket.on("user:join", (user) => {
      updateUsers((prev) => ({ ...prev, [user.id]: user }));
    });

    socket.on("user:leave", ({ id, name, lastSeen }) => {
      updateUsers((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      setConnections((prev) => {
        const next = { ...prev };
        for (const [roomId, entry] of Object.entries(next)) {
          if (entry.with?.id === id) delete next[roomId];
        }
        return next;
      });

      if (id) {
        setRecentlyLeft((prev) => [
          { id, name: name || "Unknown", lastSeen: lastSeen || Date.now() },
          ...prev.filter((item) => item.id !== id)
        ].slice(0, 5));
      }
    });

    socket.on("user:move", ({ id, x, y, roomId }) => {
      updateUsers((prev) => {
        if (!prev[id]) return prev;
        return {
          ...prev,
          [id]: { ...prev[id], x, y, roomId: roomId ?? prev[id].roomId }
        };
      });
    });

    socket.on("proximity:connect", ({ with: other, roomId }) => {
      if (!other || !roomId) return;

      setConnections((prev) => {
        const next = { ...prev, [roomId]: { with: other, roomId } };
        return next;
      });

      setActiveDirectId((prev) => prev || roomId);
    });

    socket.on("proximity:disconnect", ({ roomId }) => {
      setConnections((prev) => {
        const next = { ...prev };
        if (roomId && next[roomId]) delete next[roomId];
        return next;
      });

      setActiveDirectId((prev) => (prev === roomId ? null : prev));
    });

    socket.on("direct:message", (message) => {
      setDirectMessages((prev) => {
        const next = { ...prev };
        const list = next[message.roomId] ? [...next[message.roomId]] : [];
        list.push(message);
        next[message.roomId] = list;
        return next;
      });
    });

    socket.on("chat:message", (message) => {
      setDirectMessages((prev) => {
        const next = { ...prev };
        const list = next[message.roomId] ? [...next[message.roomId]] : [];
        list.push(message);
        next[message.roomId] = list;
        return next;
      });
    });

    socket.on("room:message", (message) => {
      setRoomMessages((prev) => {
        const next = { ...prev };
        const list = next[message.roomId] ? [...next[message.roomId]] : [];
        list.push(message);
        next[message.roomId] = list;
        return next;
      });
    });

    socket.on("room:state", (payload) => {
      if (!payload?.roomId) return;
      setRoomStates((prev) => ({
        ...prev,
        [payload.roomId]: {
          notes: payload.notes || [],
          timer: payload.timer || { running: false, elapsedMs: 0, startedAt: null }
        }
      }));
    });

    socket.on("room:note:add", (payload) => {
      if (!payload?.roomId || !payload.note) return;
      setRoomStates((prev) => {
        const current = prev[payload.roomId] || { notes: [], timer: { running: false, elapsedMs: 0 } };
        return {
          ...prev,
          [payload.roomId]: { ...current, notes: [...current.notes, payload.note] }
        };
      });
    });

    socket.on("room:timer:update", (payload) => {
      if (!payload?.roomId || !payload.timer) return;
      setRoomStates((prev) => ({
        ...prev,
        [payload.roomId]: { ...(prev[payload.roomId] || {}), timer: payload.timer }
      }));
    });

    socket.on("room:typing", (payload) => {
      if (!payload?.roomId || !payload?.from) return;
      const key = payload.roomId;
      setTypingState((prev) => {
        const next = { ...prev, room: { ...prev.room } };
        const roomList = new Set(next.room[key] || []);
        if (payload.isTyping) {
          roomList.add(payload.from);
        } else {
          roomList.delete(payload.from);
        }
        next.room[key] = Array.from(roomList);
        return next;
      });

      if (payload.isTyping) {
        const timers = typingTimeoutsRef.current.room;
        if (timers.has(payload.from)) clearTimeout(timers.get(payload.from));
        timers.set(
          payload.from,
          setTimeout(() => {
            setTypingState((prev) => {
              const next = { ...prev, room: { ...prev.room } };
              const list = new Set(next.room[key] || []);
              list.delete(payload.from);
              next.room[key] = Array.from(list);
              return next;
            });
            timers.delete(payload.from);
          }, 1600)
        );
      }
    });

    socket.on("direct:typing", (payload) => {
      if (!payload?.roomId || !payload?.from) return;
      const key = payload.roomId;
      setTypingState((prev) => {
        const next = { ...prev, direct: { ...prev.direct } };
        const list = new Set(next.direct[key] || []);
        if (payload.isTyping) {
          list.add(payload.from);
        } else {
          list.delete(payload.from);
        }
        next.direct[key] = Array.from(list);
        return next;
      });

      if (payload.isTyping) {
        const timers = typingTimeoutsRef.current.direct;
        if (timers.has(payload.from)) clearTimeout(timers.get(payload.from));
        timers.set(
          payload.from,
          setTimeout(() => {
            setTypingState((prev) => {
              const next = { ...prev, direct: { ...prev.direct } };
              const list = new Set(next.direct[key] || []);
              list.delete(payload.from);
              next.direct[key] = Array.from(list);
              return next;
            });
            timers.delete(payload.from);
          }, 1600)
        );
      }
    });

    socket.on("user:update", (payload) => {
      if (!payload?.id) return;
      updateUsers((prev) => {
        if (!prev[payload.id]) return prev;
        return { ...prev, [payload.id]: { ...prev[payload.id], ...payload } };
      });
    });

    socket.on("user:emote", (payload) => {
      if (!payload?.id) return;
      updateUsers((prev) => {
        if (!prev[payload.id]) return prev;
        return {
          ...prev,
          [payload.id]: { ...prev[payload.id], emote: { type: payload.type, ts: payload.ts } }
        };
      });
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    const handleDown = (event) => {
      if (keyDirections[event.code]) {
        keysRef.current[event.code] = true;
      }
    };
    const handleUp = (event) => {
      if (keyDirections[event.code]) {
        keysRef.current[event.code] = false;
      }
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);

    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
    };
  }, []);

  useEffect(() => {
    let frameId;

    const step = (time) => {
      const id = selfIdRef.current;
      const socket = socketRef.current;

      if (id && usersRef.current[id]) {
        let dx = 0;
        let dy = 0;

        for (const [code, vector] of Object.entries(keyDirections)) {
          if (keysRef.current[code]) {
            dx += vector[0];
            dy += vector[1];
          }
        }

        if (dx !== 0 || dy !== 0) {
          const length = Math.hypot(dx, dy) || 1;
          dx /= length;
          dy /= length;

          const current = usersRef.current[id];
          const nextX = clamp(current.x + dx * MOVE_SPEED, 12, world.width - 12);
          const nextY = clamp(current.y + dy * MOVE_SPEED, 12, world.height - 12);

          const nextRoomId = getRoomIdForPosition(rooms, nextX, nextY);
          updateUsers((prev) => ({
            ...prev,
            [id]: { ...prev[id], x: nextX, y: nextY, roomId: nextRoomId }
          }));

          if (socket && time - lastEmitRef.current > EMIT_INTERVAL) {
            socket.emit("user:move", { x: nextX, y: nextY });
            lastEmitRef.current = time;
          }
        }
      }

      frameId = requestAnimationFrame(step);
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [world.width, world.height, rooms]);

  useEffect(() => {
    const rooms = Object.keys(connections);
    if (rooms.length === 0) {
      setActiveDirectId(null);
      return;
    }

    if (!activeDirectId || !connections[activeDirectId]) {
      setActiveDirectId(rooms[0]);
    }
  }, [connections, activeDirectId]);

  useEffect(() => {
    if (!selfId || !users[selfId]) return;
    const user = users[selfId];
    setProfile({
      name: user.name || "",
      color: user.color || COLOR_OPTIONS[0],
      status: user.status || "available",
      accessories: user.accessories || { hat: false, glasses: false }
    });
  }, [selfId, users]);

  const self = selfId ? users[selfId] : null;
  const roomLookup = useMemo(() => {
    const map = new Map();
    rooms.forEach((room) => map.set(room.id, room));
    return map;
  }, [rooms]);
  const currentRoom = self?.roomId ? roomLookup.get(self.roomId) : null;
  const roomStats = useMemo(() => {
    const counts = new Map();
    rooms.forEach((room) => counts.set(room.id, 0));
    let openArea = 0;
    Object.values(users).forEach((user) => {
      if (user.roomId && counts.has(user.roomId)) {
        counts.set(user.roomId, counts.get(user.roomId) + 1);
      } else {
        openArea += 1;
      }
    });
    return { counts, openArea };
  }, [rooms, users]);
  const directRoomByUserId = useMemo(() => {
    const map = new Map();
    Object.values(connections).forEach((entry) => {
      if (entry?.with?.id) map.set(entry.with.id, entry.roomId);
    });
    return map;
  }, [connections]);
  const activeDirectUser = activeDirectId ? connections[activeDirectId]?.with : null;
  const roomState = currentRoom?.id ? roomStates[currentRoom.id] : null;
  const roomTimer = roomState?.timer;
  const roomTimerElapsed = roomTimer
    ? roomTimer.elapsedMs + (roomTimer.running && roomTimer.startedAt ? Date.now() - roomTimer.startedAt : 0)
    : 0;
  const statusLabel = status === "online" ? "Connected" : "Offline";
  const statusClass = status === "online" ? "status-live" : "status-off";

  const activeConnections = useMemo(
    () => Object.values(connections),
    [connections]
  );

  const roomMessageList = currentRoom?.id
    ? roomMessages[currentRoom.id] || []
    : [];
  const directMessageList = activeDirectId
    ? directMessages[activeDirectId] || []
    : [];
  const activeMessages = chatMode === "room" ? roomMessageList : directMessageList;
  const activeTyping =
    chatMode === "room"
      ? typingState.room[currentRoom?.id] || []
      : typingState.direct[activeDirectId] || [];
  const typingLabel =
    activeTyping.length > 0
      ? `${activeTyping
          .map((id) => users[id]?.name || "Someone")
          .join(", ")} typing...`
      : "";

  const emitTyping = (isTyping) => {
    const socket = socketRef.current;
    if (!socket) return;
    if (chatMode === "room") {
      if (!currentRoom?.id) return;
      socket.emit("room:typing", { isTyping });
    } else if (activeDirectId) {
      socket.emit("direct:typing", { roomId: activeDirectId, isTyping });
    }
  };

  const handleSend = () => {
    const socket = socketRef.current;
    if (!socket) return;

    const text = draft.trim();
    if (!text) return;

    if (chatMode === "room") {
      if (!currentRoom?.id) return;
      socket.emit("room:message", { text });
    } else {
      if (!activeDirectId) return;
      socket.emit("direct:message", { roomId: activeDirectId, text });
    }
    setDraft("");
    emitTyping(false);
  };

  const handleDraftKey = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSend();
    }
  };

  const handleDraftChange = (event) => {
    setDraft(event.target.value);
    emitTyping(true);
    if (typingEmitRef.current) clearTimeout(typingEmitRef.current);
    typingEmitRef.current = setTimeout(() => emitTyping(false), 1200);
  };

  useEffect(() => {
    if (chatMode === "room" && !currentRoom && activeDirectId) {
      setChatMode("direct");
    }
    if (chatMode === "direct" && !activeDirectId && currentRoom) {
      setChatMode("room");
    }
  }, [chatMode, currentRoom, activeDirectId]);

  useEffect(() => {
    if (!roomTimer?.running) return;
    const tick = setInterval(() => {
      setRoomStates((prev) => ({ ...prev }));
    }, 1000);
    return () => clearInterval(tick);
  }, [roomTimer?.running]);

  const applyProfileUpdate = (updates) => {
    const next = {
      ...profile,
      ...updates,
      accessories: { ...profile.accessories, ...(updates.accessories || {}) }
    };
    setProfile(next);
    if (selfId) {
      updateUsers((prev) => {
        if (!prev[selfId]) return prev;
        return { ...prev, [selfId]: { ...prev[selfId], ...next } };
      });
    }
    const socket = socketRef.current;
    if (socket) socket.emit("user:update", next);
  };

  const sendEmote = (type) => {
    const socket = socketRef.current;
    if (!socket) return;
    if (selfId) {
      updateUsers((prev) => {
        if (!prev[selfId]) return prev;
        return {
          ...prev,
          [selfId]: {
            ...prev[selfId],
            emote: { type, ts: Date.now() }
          }
        };
      });
    }
    socket.emit("user:emote", { type });
  };

  const addNote = () => {
    const socket = socketRef.current;
    const text = noteDraft.trim();
    if (!socket || !text || !currentRoom?.id) return;
    socket.emit("room:note:add", { text });
    setNoteDraft("");
  };

  const updateTimer = (action) => {
    const socket = socketRef.current;
    if (!socket || !currentRoom?.id) return;
    socket.emit("room:timer", { action });
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <span>Space</span>
        </div>
        <div className="top-actions">
          <button className="ghost">Call</button>
          <button className="ghost">Share</button>
        </div>
        <div className="room-indicator">
          <span>Room:</span>
          <strong>{currentRoom ? currentRoom.label : "Open Area"}</strong>
          {currentRoom?.activity && (
            <em>{currentRoom.activity}</em>
          )}
        </div>
        <div className={`status-pill ${statusClass}`}>{statusLabel}</div>
      </header>

      <div className="layout">
        <section className="world-panel">
          <div className="world-stage">
            <MiniMap world={world} rooms={rooms} users={users} selfId={selfId} />
            <div className="floating-cards">
              {activeConnections.length === 0 ? (
                <div className="user-card empty">
                  <div className="user-card-title">No nearby users</div>
                  <div className="user-card-sub">Move closer to connect</div>
                </div>
              ) : (
                activeConnections.map((entry) => (
                  <div
                    className="user-card"
                    key={entry.roomId}
                    style={{
                      background: `linear-gradient(135deg, ${lighten(
                        entry.with.color,
                        0.35
                      )}, ${darken(entry.with.color, 0.2)})`
                    }}
                  >
                    <div
                      className="user-card-avatar"
                      style={{ background: entry.with.color }}
                    />
                    <div>
                      <div className="user-card-title">{entry.with.name}</div>
                      <div className="user-card-sub">
                        {roomLookup.get(entry.with.roomId)?.label || "Open Area"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="canvas-shell">
              <PixiStage
                world={world}
                rooms={rooms}
                usersRef={usersRef}
                selfIdRef={selfIdRef}
              />
            </div>
          </div>
        </section>

        <aside className="chat-panel">
          <div className="room-panel">
            <div className="room-panel-title">Rooms</div>
            <div className="room-list">
              {rooms.map((room) => {
                const count = roomStats.counts.get(room.id) || 0;
                const isActive = currentRoom?.id === room.id;
                return (
                  <div
                    key={room.id}
                    className={`room-item ${isActive ? "active" : ""}`}
                  >
                    <div className="room-item-left">
                      <span
                        className="room-dot"
                        style={{ background: room.color }}
                      />
                      <div>
                        <div className="room-name">{room.label}</div>
                        <div className="room-activity">{room.activity}</div>
                      </div>
                    </div>
                    <span className="room-count">{count}</span>
                  </div>
                );
              })}
              <div className="room-item open-area">
                <div className="room-item-left">
                  <span className="room-dot open" />
                  <div>
                    <div className="room-name">Open Area</div>
                    <div className="room-activity">Free roam</div>
                  </div>
                </div>
                <span className="room-count">{roomStats.openArea}</span>
              </div>
            </div>
          </div>

          <div className="people-panel">
            <div className="people-title">People</div>
            <div className="people-list">
              {Object.values(users)
                .filter((user) => user.id !== selfId)
                .map((user) => {
                  const directRoom = directRoomByUserId.get(user.id);
                  const inRange = Boolean(directRoom);
                  return (
                    <div
                      key={user.id}
                      className={`people-item ${inRange ? "near" : ""}`}
                    >
                      <span className={`status-dot ${user.status || "available"}`} />
                      <div className="people-meta">
                        <div className="people-name">{user.name}</div>
                        <div className="people-room">
                          {roomLookup.get(user.roomId)?.label || "Open Area"}
                        </div>
                      </div>
                      <button
                        className="people-action"
                        disabled={!inRange}
                        onClick={() => {
                          if (!directRoom) return;
                          setChatMode("direct");
                          setActiveDirectId(directRoom);
                        }}
                      >
                        Direct
                      </button>
                    </div>
                  );
                })}
            </div>
            {recentlyLeft.length > 0 && (
              <div className="people-recent">
                <div className="people-recent-title">Recently left</div>
                <div className="people-recent-list">
                  {recentlyLeft.map((entry) => (
                    <div key={entry.id} className="people-recent-item">
                      <span>{entry.name}</span>
                      <time>{formatTime(entry.lastSeen)}</time>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="profile-panel">
            <div className="profile-title">Your Profile</div>
            <label className="profile-field">
              <span>Name</span>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => applyProfileUpdate({ name: e.target.value })}
              />
            </label>
            <label className="profile-field">
              <span>Status</span>
              <select
                value={profile.status}
                onChange={(e) => applyProfileUpdate({ status: e.target.value })}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="profile-colors">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  className={`color-swatch ${profile.color === color ? "active" : ""}`}
                  style={{ background: color }}
                  onClick={() => applyProfileUpdate({ color })}
                />
              ))}
            </div>
            <div className="profile-accessories">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(profile.accessories?.hat)}
                  onChange={(e) =>
                    applyProfileUpdate({
                      accessories: { hat: e.target.checked }
                    })
                  }
                />
                Hat
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(profile.accessories?.glasses)}
                  onChange={(e) =>
                    applyProfileUpdate({
                      accessories: { glasses: e.target.checked }
                    })
                  }
                />
                Glasses
              </label>
            </div>
            <div className="emote-row">
              {EMOTE_OPTIONS.map((option) => (
                <button key={option.id} onClick={() => sendEmote(option.symbol)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="chat-section">
            <div className="chat-header">
              <h2>{chatMode === "room" ? "Room Chat" : "Direct Chat"}</h2>
              <button className="chat-close" aria-label="Close chat">
                ×
              </button>
            </div>

            <div className="chat-mode-tabs">
              <button
                className={chatMode === "room" ? "active" : ""}
                onClick={() => setChatMode("room")}
                disabled={!currentRoom}
              >
                Room
              </button>
              <button
                className={chatMode === "direct" ? "active" : ""}
                onClick={() => setChatMode("direct")}
                disabled={activeConnections.length === 0}
              >
                Direct
              </button>
            </div>

            {chatMode === "room" ? (
              currentRoom ? (
                <>
                  <div className="room-tools">
                    <div className="room-tools-header">
                      <div>
                        <div className="room-tools-title">{currentRoom.label}</div>
                        <div className="room-tools-sub">{currentRoom.activity}</div>
                      </div>
                      <div className="room-timer">
                        <span>{formatElapsed(roomTimerElapsed)}</span>
                        <div className="room-timer-buttons">
                          <button
                            onClick={() =>
                              updateTimer(roomTimer?.running ? "pause" : "start")
                            }
                          >
                            {roomTimer?.running ? "Pause" : "Start"}
                          </button>
                          <button onClick={() => updateTimer("reset")}>Reset</button>
                        </div>
                      </div>
                    </div>
                    <div className="room-notes">
                      <div className="room-notes-list">
                        {roomState?.notes?.length ? (
                          roomState.notes.map((note) => (
                            <div key={note.id} className="room-note">
                              <p>{note.text}</p>
                              <span>{note.author}</span>
                            </div>
                          ))
                        ) : (
                          <span className="room-note-empty">No notes yet.</span>
                        )}
                      </div>
                      <div className="room-notes-input">
                        <input
                          type="text"
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Add a note"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addNote();
                            }
                          }}
                        />
                        <button onClick={addNote}>Add</button>
                      </div>
                    </div>
                  </div>

                  <div className="chat-feed">
                    {activeMessages.length === 0 ? (
                      <div className="chat-empty">
                        <p>Start the room conversation.</p>
                      </div>
                    ) : (
                      activeMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`chat-bubble ${msg.from === selfId ? "self" : ""}`}
                        >
                          <div className="chat-meta">
                            <span>{msg.from === selfId ? "You" : users[msg.from]?.name}</span>
                            <time>{formatTime(msg.ts)}</time>
                          </div>
                          <p>{msg.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                  {typingLabel && <div className="typing-indicator">{typingLabel}</div>}
                  <div className="chat-input">
                    <input
                      type="text"
                      value={draft}
                      onChange={handleDraftChange}
                      onKeyDown={handleDraftKey}
                      placeholder={`Message ${currentRoom.label}`}
                    />
                    <button onClick={handleSend}>Send</button>
                  </div>
                </>
              ) : (
                <div className="chat-empty">
                  <p>Move into a room to access room chat and tools.</p>
                </div>
              )
            ) : activeConnections.length === 0 ? (
              <div className="chat-empty">
                <p>Move closer to someone to start a direct chat.</p>
              </div>
            ) : (
              <>
                <div className="chat-tabs">
                  {activeConnections.map((entry) => (
                    <button
                      key={entry.roomId}
                      className={`chat-tab ${activeDirectId === entry.roomId ? "active" : ""}`}
                      onClick={() => setActiveDirectId(entry.roomId)}
                    >
                      <span className="tab-dot" style={{ background: entry.with.color }} />
                      {entry.with.name}
                    </button>
                  ))}
                </div>

                <div className="chat-feed">
                  {activeMessages.length === 0 ? (
                    <div className="chat-empty">
                      <p>
                        This is the beginning of your chat with
                        <strong> @{activeDirectUser?.name || "someone"}</strong>.
                      </p>
                      <span>Send messages, links, and reactions.</span>
                    </div>
                  ) : (
                    activeMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`chat-bubble ${msg.from === selfId ? "self" : ""}`}
                      >
                        <div className="chat-meta">
                          <span>
                            {msg.from === selfId ? "You" : connections[msg.roomId]?.with?.name}
                          </span>
                          <time>{formatTime(msg.ts)}</time>
                        </div>
                        <p>{msg.text}</p>
                      </div>
                    ))
                  )}
                </div>
                {typingLabel && <div className="typing-indicator">{typingLabel}</div>}
                <div className="chat-input">
                  <input
                    type="text"
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={handleDraftKey}
                    placeholder={
                      activeDirectUser
                        ? `Message ${activeDirectUser.name}`
                        : "Message nearby user"
                    }
                  />
                  <button onClick={handleSend}>Send</button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="bottombar">
        <button className="bar-item">Invite</button>
        <button className="bar-item">Record</button>
        <button className="bar-item">Move</button>
        <button className="bar-item">Hand</button>
        <button className="bar-item">React</button>
        <button className="bar-item">Action</button>
      </footer>
    </div>
  );
};

export default App;
