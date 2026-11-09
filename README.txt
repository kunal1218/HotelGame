MERIDIAN — NETWORKED LOBBY PROTOTYPE

RUN LOCALLY
Use Node.js 22.12 or newer (tested with 24.5.0; .nvmrc pins that runtime).
Run npm install, then npm run host. Open http://localhost:8787.
The host command builds the client and serves the game and WebSocket on one port.

For development, run npm run server and npm run dev in separate terminals.
Vite forwards /ws to localhost:8787. Open the Vite address printed in the terminal.
Run npm test for the automated suite; npm run build checks the production bundle.

PLAY WITH FRIENDS
Create room, then open the menu with Escape to find the code and Invite friends.
Friends can join by code or the copied ?room= link. A room holds at most five players.
Explore alone creates a normal online room when the server is reachable.
If it cannot connect, solo runs locally and shows "Offline: friends can't join".
An offline room cannot be transferred to the server; leave and create an online room.

Use Discord for Playtest 1. Proximity voice is a later milestone, not implemented.
For a friends playtest, run the host and then (if cloudflared is installed):
  cloudflared tunnel --url http://localhost:8787
Share its HTTPS address. The server accepts the same origin through the tunnel.
The tunnel and campus connectivity have not been tested in this sprint.

CONTROLS
WASD / arrow keys: move. Mouse: look. Click the scene to capture the pointer.
Drag to look when pointer capture is unavailable. Shift: walk faster.
E: discover a nearby detail or use the fireplace/elevators. Escape: open the menu.
Opening the menu stops your input but the shared world keeps running.
Touch: left joystick moves, right side drag looks; E interacts.
The toolbar changes golden/blue hour, toggles ambient audio, and shows controls.
The backtick (`) key toggles room/network statistics.

EXPLORATION
Find five details: residents' lounge, reception, art, fireside, and elevators.
Fireplace and elevator doors are shared. Discoveries, lighting and ambient-audio
preferences remain personal. Exploration stays in the lobby; there is no hunter yet.
Players block one another. Pushing into a blocker for 1.5 s lets you squeeze past.

NETWORK TESTING
Append ?net=wifi or ?net=bad to simulate ordered latency, jitter and delay spikes.
To combine with an invite, use ?room=QXJT&net=bad.
After creating a room, add up to four wandering bots:
  npm run bots -- --room QXJT --count 4
Optional bot argument: --server ws://localhost:8787/ws
To force the offline-fallback path while retaining the page, use:
  http://localhost:8787/?server=ws://localhost:1/ws

SERVER CONFIG
PORT (default 8787); STATIC (default dist); ORIGINS (comma-separated exact origins).
Same-origin and localhost browser connections are accepted by default. CLI bots can
connect without an Origin header. No accounts or public matchmaking are provided.
Client server selection: ?server= override, then VITE_SERVER_URL, then same-origin /ws.
An HTTPS page requires a wss:// server. Logs contain no resume tokens or raw messages.

IMPLEMENTATION
src/shared/sim/: deterministic motion, collision, map data, lobby world and entities.
src/shared/net/: validation, snapshots, interpolation, clocks and in-memory transport.
src/shared/room/: room lifecycle, command queues, validation and snapshot delivery.
src/net/: browser sessions, offline fallback, WebSocket connection and diagnostics.
server/: HTTP/static hosting and WebSocket adapter; tools/bots.js: headless players.
src/engine.js: renderer and input/camera adapter; src/lobby.js and city.js: visuals.
src/main.js: discoveries, HUD, touch controls, lighting and synthesized ambient audio.

STATUS AND LIMITS
N0/N1 foundations and the N2 lobby multiplayer path are implemented.
See SPRINT_NOTES.md for validation, open acceptance checks and the Playtest 1 checklist.
Automatic reconnect/resume (N3), proximity voice (N6), upstairs, hunter and escape
are not implemented. A disconnected player currently leaves the room immediately.
The five-player server p99 timing target still needs profiling under sustained load.

All geometry, art, textures, and sound are generated in the application.
Optional Google Fonts fall back to local system fonts. WebGL 2 is required.
