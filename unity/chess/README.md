# Chess — Unity client

Real-time multiplayer client for the `chess` game. Authoritative game logic —
including all move legality, check/checkmate/stalemate detection — lives
server-side in [`packages/games/src/chess`](../../packages/games/src/chess)
(via [`chess.js`](https://github.com/jhlywa/chess.js)). This Unity project is
a renderer + input device: it never decides whether a move is legal, it just
displays whatever the server says and sends `{from, to}` move attempts.

This was written without a real Unity Editor available to compile-test it —
if you hit a compile error, it's most likely a small Unity-version API
mismatch. Report it back and it'll get fixed. This project reuses the same
patterns as [`unity/snake`](../snake) (WebGL WebSocket bridge, Editor
auto-setup script) — if you've already gotten Snake running, the setup here
will look familiar.

## Requirements

Same as `unity/snake`:

- Unity **2022.3 LTS** or newer.
- WebGL Build Support module.
- The `com.unity.nuget.newtonsoft-json` package (Window → Package Manager →
  "+" → Add package by name → `com.unity.nuget.newtonsoft-json`).
- The `com.unity.ugui` package (legacy UI — `Canvas`, `Text`, `Button`,
  `Image`). Add the same way if it's not already present.

## Step 0: open this as a Unity project

Only `Assets/` exists here — no `ProjectSettings/`/`Packages/`/`Library/`.
Either:

- **Unity Hub → Add → select this `unity/chess` folder directly**, or
- create a new 3D (Built-in Render Pipeline) project elsewhere and copy this
  folder's `Assets/Scripts`, `Assets/Editor`, and `Assets/Plugins` into it.

Install the two packages above before opening any scripts.

## One-time scene setup

1. **Gaming Pool → Setup Chess Scene** (menu bar). This builds:
   - A top-down orthographic camera over an 8×8 board (64 flattened cubes,
     alternating colors, named by algebraic notation `a1`–`h8`).
   - `GameManager` + `NetworkClient` + `ApiClient` on one GameObject.
   - A `Canvas` with three panels: **LobbyBrowserPanel** (Create Room button,
     Refresh button, a room list), **WaitingRoomPanel** (host/guest info,
     Ready/Start buttons), **GameOverPanel** (result text, Back to Lobby
     button) — `GameManager` toggles which one is active.
   - `Assets/Prefabs/RoomListRow.prefab` — instantiated once per open room
     when browsing.
2. Save the scene: **File → Save As** → `Assets/Scenes/Chess.unity`, and add
   it to Build Settings.

## Testing in the Editor

With `apps/api` and `apps/game-server` running (`npm run dev` from the repo
root), hit **Play**. You land on the room browser. Two ways to test the full
flow with one Editor instance:

- **Two Play sessions won't work** (Unity only runs one Play Mode at a time).
  Instead, do a **development build** and run two instances of it side by
  side, each connecting independently — or test the create/list/join HTTP
  flow in the Editor first (does the room you create show up in the list on
  a manual Refresh?), then get a second person/browser tab in for the actual
  ready/start/play flow once you've built.

Click **Create Room** to become the host, or **Join** a room from the list.
Once two players are in: the guest clicks **Ready**, then the host's
**Start Game** button becomes clickable. Click a piece, then a destination
square to move — the board never assumes a move is legal until the server's
`move` broadcast confirms it; an illegal attempt just does nothing visible
(check the status text for the rejection).

Pieces render as plain letters (P/N/B/R/Q/K) with a contrast outline —
white letters get a dark outline, black letters a light one, so both stay
readable on same-tone squares. (Unicode chess glyphs were tried and dropped:
WebGL builds have no OS font fallback, so ♔♕♖ render as nothing in the
browser even when they work in the Editor. Proper piece icons need either a
TTF containing those glyphs added to `Assets/Fonts/`, or sprite art.)

## WebGL build → local CDN dev server

Same as `unity/snake`'s instructions — see
[`../snake/README.md`](../snake/README.md#webgl-build--local-cdn-dev-server)
for the exact Player Settings steps (Compression Format, output folder
naming). Build into `unity/chess/Build`, name the build `chess`, then visit
`http://localhost:3000/games/chess`.

## Protocol reference

Source of truth: [`packages/games/src/chess/module.ts`](../../packages/games/src/chess/module.ts)
and [`apps/api/src/matchmaking.ts`](../../apps/api/src/matchmaking.ts). Summary:

**HTTP (Global API)**
- `POST /rooms/chess` → `{ server, roomId }` — create a room (becomes host/owner).
- `GET /rooms/chess` → `[{ roomId, hostName, playerCount, maxPlayers }]` — open rooms.
- `POST /rooms/chess/join` `{ roomId }` → `{ server, roomId }` — join an open room.

**Server → client (WebSocket)**
- `{ type: "lobby", payload: { ownerId, started, players: [{id, displayName, ready}] } }`
- `{ type: "started", payload: { fen, turn, white, black } }`
- `{ type: "move", payload: { fen, turn, lastMove: {from,to}, inCheck, gameOver, result } }` — `result` is `"checkmate" | "stalemate" | "draw" | null`.
- `{ type: "gameover", payload: { reason, winner } }` — e.g. opponent disconnected mid-game.
- `{ type: "error", payload: { message } }`

**Client → server**
- `{ type: "ready" }` — guest only.
- `{ type: "start" }` — owner only, requires the guest to be ready.
- `{ type: "move", payload: { from, to, promotion? } }` — `promotion` omitted unless promoting (client always sends `"q"` — no promotion-choice UI in this pass).
