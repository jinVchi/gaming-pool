import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 5000);

// One process hosts many rooms across multiple games; game logic loaded from packages/games.
const wss = new WebSocketServer({ port, perMessageDeflate: false });

wss.on("connection", (socket) => {
  socket.on("message", () => {
    // Room routing + game module dispatch land here in Phase 4.
  });
});

console.log(`game-server listening on ws://localhost:${port}`);
