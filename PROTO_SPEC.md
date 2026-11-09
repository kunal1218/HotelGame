# Prototype Spec — Networked "Explore and Escape"

**Branch:** `steves-proto`
**Status:** Networking/movement foundations and lobby multiplayer are implemented under `NETCODE_SPEC.md`. Upstairs, the hunter, key and escape loop below remain unimplemented. See `SPRINT_NOTES.md`.
**Superseded in part:** §2 (architecture), §4.1 (message format) and §4.5–4.6 (server and client files) are replaced by `NETCODE_SPEC.md`. That includes the change from 20 Hz to 60 Hz simulation with 30 Hz snapshots. The game rules here (world, hunter, key, match flow) still apply.
**Relates to:** `RND.md` §19, Experiment A

---

## 1. Intent

Turn the single-player lobby walkaround into a small networked match that answers one question from `RND.md`:
**is exploring with a hunter, together, fun?**

2–5 players join one shared session. They start in the lobby, which is a safe hub. They take the elevator to an upstairs floor of rooms. One of those rooms holds a **key**. Someone has to find it and carry it back down to the front doors while a server-controlled **hunter** patrols upstairs and chases anyone it sees. Getting caught sends you back to the lobby, and you drop the key where you were caught. The match ends when the key reaches the exit.

**Out of scope for this prototype:** classes, karma, money, an inventory beyond carrying one key, an AI director, procedural generation, matchmaking, accounts, persistence between matches, anti-cheat beyond basic sanity checks, public deployment, mobile polish, and character models (players are capsules with name tags). Voice uses Discord for Playtest 1; optional proximity voice follows in N6 for Playtest 2 (`NETCODE_SPEC.md` D19).

---

## 2. Architecture decision

**One Node server owns the game state. Each client simulates its own movement.**

| Concern | Who decides | Why |
|---|---|---|
| Your own position | **Your client** simulates it; the server runs sanity checks | Movement feels instant without prediction/reconciliation code. Cheating doesn't matter while we're playtesting with friends. |
| Other players' positions | The server relays them; clients **interpolate** them (render them about 100 ms in the past) | Remote players move smoothly instead of jittering. |
| Hunter, key, captures, match phase | **The server only** | Everyone has to see the same hunter and agree on who got caught. |

- **Transport:** WebSocket (JSON messages), using the `ws` package on the server and the browser's built-in `WebSocket` on the client.
- **Tick rate:** the server simulates and sends snapshots at 20 Hz. Clients send their position at 20 Hz.
- **Shared code:** the game rules, map data, collision and the message format live in `src/shared/`. That code is pure: no DOM, no Three.js, no I/O. The browser and the server import the same files, so the two can't disagree about rules or walls.
- **One match per server process.** That's enough for a friends playtest. Supporting several matches per server can wait.

### Alternatives considered

- **Peer-to-peer over WebRTC (one player hosts):** no server to run. But it needs a signaling service, often fails across home routers (NAT), and the match dies if the host leaves.
- **A hosted framework (Colyseus, PartyKit):** less code to write ourselves, but it ties us to that framework's model and to their hosting. Worth revisiting if the plain `ws` setup becomes painful.
- **Server-authoritative movement (clients send key presses, not positions):** cheat-proof, but it needs client-side prediction and rollback to feel responsive. That's too much for a first prototype. The message format below keeps a position message, so switching later means changing `move`, not everything.

### Failure domain

- If the server goes down, nobody can play, and the match in progress is lost. That's acceptable for playtests.
- If a client crashes, only that player is affected. The server removes them after a 5-second heartbeat timeout.
- The existing static hosting (`.openai/hosting.json`, which serves `dist/` only) **cannot run the server.** See open question Q1.

---

## 3. Behavioral spec

### 3.1 Session and connection

| # | Acceptance criterion |
|---|---|
| S1 | With two browser tabs connected to one local server, each tab shows the other player's capsule and name tag within 1 s of joining. |
| S2 | At rest, a remote player's rendered position is within 0.1 m of their true position. While they move, the error stays within 0.5 m on localhost. |
| S3 | A client whose `hello.v` doesn't match `PROTOCOL_VERSION` gets `reject {reason:"version"}` and the connection closes. The client shows a readable message. |
| S4 | A 6th client gets `reject {reason:"full"}`. |
| S5 | When a player closes their tab, other clients remove that avatar within 1 s. If a player goes silent with no close event, it's removed within 6 s (heartbeat timeout). |
| S6 | A malformed or unknown message is dropped and logged once per connection, and the server keeps running. More than 20 malformed messages within 10 s disconnects that client. |
| S7 | If the server can't be reached, the client shows "Can't reach the hotel server" with a retry button. It doesn't fail silently. |
| S8 | A player who joins mid-match receives the full current state in `welcome` and spawns in the lobby. |

### 3.2 Movement validation (server)

| # | Acceptance criterion |
|---|---|
| M1 | The server accepts a `move` if the distance from the last accepted position is at most `SPRINT_SPEED × elapsed × 1.5 + 0.2 m` and the new position is legal on that player's level (`canOccupy`). |
| M2 | Otherwise the server sends `correct {x,z,level}` to that client only, and the client snaps to it. Other clients never see the rejected position. |
| M3 | `move` messages with a `seq` at or below the last one accepted are ignored, so messages arriving out of order are harmless. |
| M4 | The browser controller and the server use the **same** `canOccupy` and collider data. A contract test asserts this. |

### 3.3 World

| # | Acceptance criterion |
|---|---|
| W1 | There are two levels: `LOBBY` (the existing room) and `FLOOR` (a corridor with about 6 rooms off it, open doorways, no door objects). |
| W2 | Pressing E at the lobby elevator moves the player to the floor's elevator spawn, and the reverse works upstairs. The server performs the move and broadcasts it. |
| W3 | The lobby is a **safe zone**: the hunter never enters it and nobody can be captured there. |
| W4 | The existing lobby visuals, discoveries, time-of-day and audio keep working. |

### 3.4 Hunter

| # | Acceptance criterion |
|---|---|
| H1 | While it sees no one, the hunter patrols the floor by walking a random route along a hand-placed waypoint graph. |
| H2 | It notices a player on `FLOOR` who is within 12 m and in line of sight (no collider in between). Once it has noticed someone, it chases the nearest player it can see. |
| H3 | Its chase speed is 3.4 m/s. That's faster than walking (2.6) and slower than sprinting (4.4), so you **can escape by sprinting**. |
| H4 | When it loses sight of everyone, it goes to the last place it saw someone, searches there for 4 s, then goes back to patrolling. |
| H5 | It catches a player if they're within 0.8 m. The caught player sees a capture screen for 3 s and then respawns in the lobby. If they were carrying the key, it drops at the capture spot. |
| H6 | It can't catch the same player again within 5 s of their respawn. |
| H7 | Given the same seed and the same input sequence, the hunter's path is identical (it's deterministic, which makes it testable). |

### 3.5 Objective and match flow

| # | Acceptance criterion |
|---|---|
| O1 | At match start the key spawns in one of the floor rooms. The server chooses the room with a seeded RNG. |
| O2 | A player within 1.5 m of the key who presses E picks it up. If two players try in the same tick, the earlier message wins. |
| O3 | The carrier is visible to everyone (the key glows on their avatar, and the HUD names who has it). |
| O4 | When the carrier gets within 2 m of the lobby's front doors, the match phase becomes `ESCAPED` and every client shows the result screen. |
| O5 | From `ESCAPED`, any player can trigger "Play again". That resets the match with a new seed and puts everyone back in the lobby. |
| O6 | Phases: `LOBBY_WAIT` → (any player presses "Start") → `ACTIVE` → `ESCAPED` → `LOBBY_WAIT`. The hunter only moves during `ACTIVE`. |

---

## 4. Interfaces

All shared code is plain JS with JSDoc types and `// @ts-check`. Enums are frozen objects, defined once.

### 4.1 `src/shared/protocol.js` — the message format between client and server

```js
export const PROTOCOL_VERSION = 1;

export const Level = Object.freeze({ LOBBY: 0, FLOOR: 1 });
export const Phase = Object.freeze({ LOBBY_WAIT: 'lobby_wait', ACTIVE: 'active', ESCAPED: 'escaped' });
export const RejectReason = Object.freeze({ VERSION: 'version', FULL: 'full', BAD_NAME: 'bad_name' });

/** Client → server */
/** @typedef {{t:'hello', v:number, name:string}} HelloMsg */
/** @typedef {{t:'move', seq:number, x:number, z:number, yaw:number}} MoveMsg */
/** @typedef {{t:'interact', target:InteractTarget}} InteractMsg */
/** @typedef {{t:'start'} | {t:'restart'} | {t:'ping', n:number}} ControlMsg */
/** @typedef {HelloMsg|MoveMsg|InteractMsg|ControlMsg} ClientMsg */
/** @typedef {'elevator'|'key'} InteractTarget */

/** Server → client */
/** @typedef {{t:'welcome', you:string, snapshot:Snapshot}} WelcomeMsg */
/** @typedef {{t:'reject', reason:string}} RejectMsg */
/** @typedef {{t:'snap', snapshot:Snapshot}} SnapMsg */
/** @typedef {{t:'correct', x:number, z:number, level:number}} CorrectMsg */
/** @typedef {{t:'event', event:GameEvent}} EventMsg */
/** @typedef {{t:'pong', n:number}} PongMsg */

/** @typedef {{id:string, name:string, x:number, z:number, yaw:number, level:number, carrying:boolean, downUntil:number}} PlayerView */
/** @typedef {{x:number, z:number, yaw:number, mode:'patrol'|'chase'|'search'}} HunterView */
/** @typedef {{x:number, z:number, level:number} | {carrier:string}} KeyView */
/** @typedef {{tick:number, phase:string, players:PlayerView[], hunter:HunterView, key:KeyView}} Snapshot */
/** @typedef {{kind:'captured', player:string} | {kind:'picked_up', player:string} | {kind:'dropped', player:string} | {kind:'escaped', player:string} | {kind:'joined'|'left', player:string}} GameEvent */

/**
 * Parse and validate one raw client message. Never throws.
 * @param {string} raw
 * @returns {{ok:true, msg:ClientMsg} | {ok:false, error:string}}
 *   Failure modes: invalid JSON, unknown `t`, missing or wrongly typed fields,
 *   non-finite numbers, a name that is empty or longer than 16 characters.
 */
export function decodeClientMsg(raw) {}

/** @param {ServerMsg} msg @returns {string} */
export function encode(msg) {}
```

### 4.2 `src/shared/map.js` — level geometry as plain data

```js
/** @typedef {{minX:number, maxX:number, minZ:number, maxZ:number}} AABB */
/** @typedef {{id:string, x:number, z:number, links:string[]}} Waypoint */
/** @typedef {{bounds:AABB, colliders:AABB[], spawn:{x:number,z:number,yaw:number}, elevator:{x:number,z:number,radius:number}}} LevelData */

/** @type {Readonly<{[Level.LOBBY]: LevelData & {exit:{x:number,z:number,radius:number}},
 *                   [Level.FLOOR]: LevelData & {rooms:{id:string, keySpots:{x:number,z:number}[]}[], waypoints:Waypoint[]}}>} */
export const MAP = /* data */;
```

`lobby.js` keeps the visuals, but its colliders come from `MAP[Level.LOBBY].colliders` instead of the inline `collider()` calls. We switch over with expand/contract: first add `MAP`, then add a test that it matches what `lobby.js` produces today, then delete the inline calls.

### 4.3 `src/shared/collision.js` — movement physics (moved out of `FirstPersonController`)

```js
/** @param {LevelData} level @param {number} x @param {number} z @param {number} radius @returns {boolean} */
export function canOccupy(level, x, z, radius) {}

/**
 * Move a circle by (dx, dz) in substeps, sliding along walls.
 * @returns {{x:number, z:number}} The final legal position. If the start position is illegal, returns it unchanged.
 */
export function slideMove(level, x, z, dx, dz, radius) {}

/** @returns {boolean} True if a segment from a to b crosses no collider. Used for the hunter's line of sight. */
export function lineOfSight(level, ax, az, bx, bz) {}
```

### 4.4 `src/shared/match.js` — the rules (pure)

```js
/** @typedef {object} MatchState  — opaque to callers; only this module reads or writes its fields. */

/** @param {number} seed @returns {MatchState} */
export function createMatch(seed) {}

/**
 * Apply one validated command from one player.
 * @param {MatchState} state @param {string} playerId @param {ClientMsg} msg @param {number} now  seconds, injected
 * @returns {{state:MatchState, events:GameEvent[], correction?:CorrectMsg}}
 *   Unknown player → state unchanged and no events (the caller bug is logged at the edge).
 */
export function applyCommand(state, playerId, msg, now) {}

/** @returns {{state:MatchState, events:GameEvent[]}} Advances the hunter, captures, respawns and win check by dt. */
export function tick(state, dt, now) {}

/** @returns {{state:MatchState, id:string} | {state:MatchState, reject:string}} */
export function addPlayer(state, name, now) {}
/** @returns {{state:MatchState, events:GameEvent[]}} Drops the key if they were carrying it. */
export function removePlayer(state, playerId) {}

/** @returns {Snapshot} */
export function toSnapshot(state) {}
```

The hunter's logic lives in `src/shared/hunter.js` as `stepHunter(hunter, players, level, dt, rng) → hunter`, and only `match.js` calls it. A seeded RNG lives in `src/shared/rng.js`.

### 4.5 Server — `server/`

| File | One job |
|---|---|
| `server/main.js` | Process entry. Reads the environment exactly once (`PORT`, default `8787`) and wires everything together. |
| `server/transport.js` | Accepts WebSocket connections, decodes messages, runs heartbeats. Contains no game rules. |
| `server/session.js` | Holds the single `MatchState`, runs the 20 Hz loop on an injected clock, broadcasts snapshots. |

```js
// session.js
/** @param {{now:()=>number, setInterval:typeof setInterval, log:(event:string, data:object)=>void}} deps */
export function createSession(deps) {
  return { onJoin(conn, hello) {}, onMessage(connId, msg) {}, onLeave(connId) {}, stop() {} };
}
```

Logging is structured (one JSON line per join, leave, reject, capture, phase change) at the session boundary. Snapshots aren't logged.

### 4.6 Client — `src/net/` and views

| File | One job |
|---|---|
| `src/net/connection.js` | Opens the WebSocket, sends `hello`, exposes `send(msg)` and `onMessage(cb)`, reports connection status. |
| `src/net/interpolation.js` | **Pure.** Buffers snapshots; `sample(renderTime) → {players, hunter}` blends between the two snapshots around the render time. |
| `src/remotePlayers.js` | Draws capsules and name tags for other players from the sampled state. |
| `src/floor.js` | Builds the upstairs corridor and room meshes from `MAP[Level.FLOOR]`. |
| `src/hunterView.js` | Draws the hunter. |
| `src/main.js` | Changed to send its position each tick, apply `correct`, and route events to the HUD. |

The server URL comes from `?server=ws://host:port` in the page URL, falling back to `ws://<page host>:8787`. It's read in one place in `connection.js`.

---

## 5. Build order

Each milestone ends in something we can play and judge. **We'll stop and playtest after M1 and after M3.**

1. **M0 — Groundwork.** Add `ws` and a test script. Extract `collision.js` and lobby `MAP` data, with a contract test showing the lobby colliders are unchanged. Single-player behavior stays the same.
2. **M1 — Shared presence.** Server, join/leave, players see each other walking around the lobby. Criteria S1–S8 and M1–M4.
3. **M2 — Upstairs.** Floor geometry, elevator travel between levels. Criteria W1–W4.
4. **M3 — Hunter.** Patrol, chase, search, capture, respawn. Criteria H1–H7.
5. **M4 — Key and escape.** Match phases, the key, a win screen, restart. Criteria O1–O6.

**Dev workflow:** run `npm run dev` (the client) and `npm run server` in two terminals. For friends on the same Wi-Fi, they open `http://<your-LAN-IP>:5173`.

---

## 6. Dependencies

| Add | Cost | Alternative |
|---|---|---|
| `ws` (pinned), server only | Small, widely used, no dependencies of its own | Node has no built-in WebSocket *server*. Writing one by hand isn't worth it. |
| *(none for tests)* | — | We use Node's built-in `node:test` instead of adding Vitest. We can switch later if we want watch mode or a nicer reporter. |

---

## 7. Open questions (need a decision)

- **Q1 — How do friends connect?** **Resolved 2026-11-09:** your laptop plus a Cloudflare tunnel for playtests. Later, an always-on server in Chicago. See `NETCODE_SPEC.md` D15.
- **Q2 — Does the lobby's tone change?** Right now it's a cozy real-estate showcase. Should the prototype keep it as a deliberate "too-nice" contrast with a creepy upstairs, or start making it uneasy? *Default: keep it, and make upstairs the contrast.*
- **Q3 — Can players block or push each other?** **Resolved 2026-11-09:** players block each other, with no pushing or PvP. See `NETCODE_SPEC.md` D16–D17.
- **Q4 — How many floor rooms, and how big?** *Default: 6 rooms, about 5×5 m, off one 30 m corridor.*
- **Q5 — How does the hunter scale with player count?** Solo play is supported (`NETCODE_SPEC.md` D18), so one player must be able to win. *Default: with 1 player, detection range is 9 m (instead of 12 m) and chase speed is 3.0 m/s (instead of 3.4 m/s). Values for 2–5 players stay as specified. Tune at Playtest 1.*
