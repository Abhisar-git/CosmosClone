# Virtual Cosmos — Proximity Chat

A 2D virtual space where users move around in real time, and chat automatically appears when they are within a proximity radius.

## Features
- PixiJS-rendered 2D world with live avatars
- Real-time movement via Socket.IO
- Automatic proximity detection + connect/disconnect events
- Pair chat rooms that appear only when users are close
- Clean, minimal UI with active connections list

## Tech Stack
- Frontend: React + Vite + PixiJS
- Backend: Node.js + Express + Socket.IO

Note: MongoDB is **optional** for this assignment. The current build keeps user state in-memory because sessions are ephemeral; persisting to MongoDB can be added later if needed.

## Getting Started
### 1) Start the server
```bash
cd server
npm install
npm run dev
```

### 2) Start the client
```bash
cd ../client
npm install
npm run dev
```

Open `http://localhost:5173` in multiple tabs to see real-time interaction.

## Configuration
- Server port: `3001`
- Client origin: `http://localhost:5173`

You can override the client origin:
```bash
CLIENT_ORIGIN=http://localhost:5173 npm run dev
```

## How It Works
- Users are represented as avatars in a 2D world.
- When the distance between two users is **< 120px**, the server puts them into a shared Socket.IO room.
- If they move apart, the room is automatically left and the chat panel hides.

## Demo Checklist
- Movement with WASD/Arrow keys
- Multiple users visible
- Proximity connect/disconnect
- Chat panel appears/disappears based on distance

