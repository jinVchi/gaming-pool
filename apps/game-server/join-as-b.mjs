import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const roomId = process.argv[2];
if (!roomId) throw new Error("usage: node join-as-b.mjs <roomId>");

const credentialResponse = await fetch("http://localhost:4000/player-token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ guestCredential: randomUUID().replaceAll("-", ""), displayName: "TestBot" }),
});
if (!credentialResponse.ok) throw new Error(`player-token failed: ${await credentialResponse.text()}`);
const credential = await credentialResponse.json();

const joinResponse = await fetch("http://localhost:4000/rooms/chess/join", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.token}` },
  body: JSON.stringify({ roomId }),
});
if (!joinResponse.ok) throw new Error(`room join failed: ${await joinResponse.text()}`);
const assignment = await joinResponse.json();

const ws = new WebSocket(`${assignment.server}/?roomId=${roomId}&token=${encodeURIComponent(credential.token)}`);

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
