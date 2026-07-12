import WebSocket from "ws";

const roomId = process.argv[2];
const ws = new WebSocket(`ws://localhost:5000/?roomId=${roomId}&playerId=testB&displayName=TestBot`);

ws.on("open", () => {
  console.log("connected as TestBot, sending ready...");
  setTimeout(() => ws.send(JSON.stringify({ type: "ready" })), 300);
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log(">>", msg.type, JSON.stringify(msg.payload));

  if (msg.type === "started") {
    console.log("Game started! Making a couple of moves so you can see them land in Unity...");
  }
  if (msg.type === "move" && msg.payload.turn === "b") {
    // It's our turn (black) — reply with a simple opening move.
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "move", payload: { from: "e7", to: "e5" } }));
    }, 1500);
  }
});

ws.on("close", (code, reason) => console.log("closed", code, reason.toString()));
ws.on("error", (err) => console.log("error", err.message));

// Keep the process alive so you have time to click Start in Unity.
setTimeout(() => {}, 5 * 60 * 1000);
