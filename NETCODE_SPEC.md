# Netcode Foundation Spec

**Branch:** `steves-proto`
**Status:** N0/N1 foundations and the N2 lobby multiplayer path implemented (2026-11-09). Playtest 1 and remaining performance/manual acceptance checks are pending; see `SPRINT_NOTES.md`. Later milestones below remain the target design, not a claim of implementation.
**Replaces:** the networking parts of `PROTO_SPEC.md`: §2 (architecture), §4.1 (message format), and §4.5–4.6 (server and client files). The game rules in `PROTO_SPEC.md` (the upstairs floor, the hunter, the key) still apply and get built on top of this.

**How to read this**

| Section | What's in it |
|---|---|
| §0 | One-page summary |
| §1 | How real games do multiplayer, and what we copy from each |
| §2 | Intent and what's out of scope |
| §3 | How the system fits together, plus a glossary |
| §4 | Decisions, each with the alternatives and why we didn't pick them |
| §5 | Testable acceptance criteria |
| §6 | Interfaces (function signatures, no bodies) |
| §7–§11 | Testing, build order, dependencies, what breaks when something fails, open questions |
| §12 | Sources |

---

## 0. Summary

- **A Node server runs each match, called a room.** It's the only source of truth for the hunter, items, captures, doors and match phase. Friends join a room with a four-letter code.
- **Each player owns their own movement.** Your browser simulates where you are, and the server only checks it's plausible. Each movement message carries both your input (keys pressed, direction faced) and the resulting position. That means we can later switch to the server re-checking every step without changing the message format.
- **Simulation runs at 60 Hz** (60 steps, or *ticks*, per second), on both the server and your own movement. **The server sends world updates at 30 Hz.** Other players and the hunter are drawn about 66–100 ms in the past so their motion looks smooth. That delay adjusts itself to network jitter.
- **State and events are separate.** State is "where things are now"; only the newest copy matters. Events are "something happened at tick T": guaranteed delivery, and stamped with that tick. The client shows each event when its own picture of the world reaches that tick, so you see the hunter reach you before the capture screen appears.
- **One general system describes what gets sent over the network.** For each type of object (player, hunter, item) we declare its fields once, including who may write each field and who may see it. Fields can be marked "only the owner sees this," which the betrayal and secret-objective ideas in `RND.md` will need.
- **Hunter captures are judged from what you saw.** The server compares your position against where the hunter was on your screen, not where it is "now". That's Valve's lag compensation applied to an AI enemy, and it means you never get caught by a hunter you couldn't see yet.
- **WebSocket for now, behind a small interface.** The same interface has an in-memory version, which gives us solo play, tests, and a built-in "bad network" simulator.
- **The operational basics are designed in from the start:** handshakes that check the version number, reconnecting after a dropped connection, rate limits, handling clients that can't keep up, a failure in one room never taking down the others, structured logs, a network stats overlay, and headless bot players so you can test a "5-player" room by yourself.

---

## 1. What professional games do

None of this is new. Every technique below has shipped in a major game, and most of it is 20+ years old. What matters is choosing the right subset for **5 friends in a browser, playing a co-op/competitive horror game**.

### 1.1 Three ways to keep machines in sync

Glenn Fiedler's *Networked Physics* series (Gaffer On Games) describes three basic approaches:

| Approach | How it works | Who uses it | Fits us? |
|---|---|---|---|
| **Deterministic lockstep** | Only inputs are sent, and every machine runs an identical simulation. | RTS games, fighting games | **No.** Every browser would have to produce bit-identical results, and the whole game waits for the slowest player. Fiedler recommends it only for about 2–4 players. JavaScript's `Math.sin` and `Math.cos` aren't even guaranteed to give identical results in Chrome and Safari. |
| **Snapshot interpolation** | The authority sends the state it's showing; receivers buffer a few copies and blend between them. | Most shooters, for *other* players | **Yes**, for everything you don't control. |
| **State synchronization** | Both sides simulate; the authority sends inputs plus state to correct drift. | Physics-heavy games | Not needed. We have no physics objects to network. |

### 1.2 The competitive shooter model (Valve's Source engine, Overwatch)

Gabriel Gambetta's *Fast-Paced Multiplayer* series is the standard explanation. Valve's developer wiki documents the version Valve ships:

1. **The server is authoritative.** Clients send inputs; the server decides what happens.
2. **Clients predict their own movement** and apply it immediately, so the controls feel instant.
3. **When server state arrives, the client corrects itself** by replaying the inputs the server hasn't processed yet on top of it (called *reconciliation*).
4. **Other entities are interpolated.** You see them slightly in the past. Source's default delay is 100 ms, which is 2× the default 20 Hz update interval, capped at 250 ms.
5. **The server lag-compensates.** It knows each client's interpolation delay, so it can rewind to judge hits the way the shooter saw them. Source keeps 1 second of history and by default rewinds only players. Valve's wiki has a separate tutorial for adding lag compensation to NPCs, which is exactly the hunter's situation.

Overwatch (GDC 2017, Tim Ford) is built on an Entity Component System. It shipped with a server update rate of about 20.8 Hz, then added a 60 Hz option for players with enough bandwidth. **Lesson: tick rate is a setting you tune, not part of the design. Define it once as a constant.**

**What we take:** interpolation for remote entities, a fixed tick, and lag compensation, adapted for an AI hunter (§4 D9). **What we skip for now:** server-authoritative movement with prediction and reconciliation. That's the expensive part, and it mainly protects competitive fairness, which a friends playtest doesn't need. D3 explains how we keep the option open.

### 1.3 Separate state from events (Tribes, then Halo: Reach)

The *Tribes Engine Networking Model* (Frohnmayer & Gift, around 1998–99) split network traffic into separate managers: **ghosts** (state updates for world objects), **events** (guaranteed and unguaranteed messages) and **moves** (player input). Each manager gets a turn to write into each outgoing packet, in priority order. Halo: Reach's networking (David Aldridge, GDC 2011, "I Shot You First") traces its design back to this paper. Write-ups of the talk describe two things that let it scale: **prioritization, and keeping state separate from events**. Aldridge put it as "unreliability enables aggressive prioritization": because a state update can be replaced by a newer one, it can be dropped or delayed without breaking anything.

**What we take:** a strict split between *state* (only the newest copy matters, safe to skip, everything a late joiner needs) and *events* (guaranteed, stamped with a tick, used only for one-off presentation like sounds and screens). See D6 and D7.

### 1.4 Each object has its own authority (Photon Fusion, Unity Netcode, Unreal)

- **Photon Fusion** distinguishes *state authority* (who writes an object's state) from *input authority* (who controls it). In *Shared* mode, clients own the objects they spawn. In *Host/Server* mode, the server owns all state and players only own their input.
- **Unity Netcode for GameObjects** is server-authoritative by default, but supports objects owned and driven by a client.
- **Unreal** replication lets each property be replicated with conditions, such as "send to the owner only."

**What we take:** authority is declared **per object type and per field**. Player motion is owned by the player; everything else is owned by the server (D2). Who can *see* each field is declared the same way (D5).

### 1.5 Co-op friend games: Lethal Company

Lethal Company was built on Unity by a solo developer. A third-party list of the game's shipped files includes *Facepunch Transport for Netcode for GameObjects* and *Facepunch.Steamworks*. That suggests Unity's Netcode running over Steam, with one player hosting the match. The developer has also written: *"Latency makes melee weapons almost impossible to use if you are not the host."*

**Lesson:** when one player hosts and the host decides time-sensitive actions, everyone else plays with a delay the host doesn't have. **What we take:** use a server that no player runs, so nobody gets a built-in advantage. Make your own movement feel instant by letting each player own it, and resolve the time-sensitive moment (the hunter catching you) based on what *you* saw (D9).

### 1.6 Authority you give to clients is hard to take back (Among Us)

Community-run Among Us servers offer a "host authority" setting for mod compatibility. Innersloth has moved anti-cheat checks to the server over time, and some of those changes broke features players relied on (secondary sources). **What we take:** we give clients authority over their own motion *knowingly*. The message format already carries what the server would need to take that authority back (D3).

### 1.7 Don't network what both sides already know (Phasmophobia and Photon)

A Photon forum thread about Phasmophobia describes players timing out on its largest maps, which each had **over 1,000 networked objects**, but only with 3–4 players. **What we take:** the map is *data that both sides already have* (§6 `map.js`). Only things that change at runtime and that other players need to know about become networked entities. Furniture, walls and decorations are never networked.

### 1.8 Single-player is just a server running locally (Minecraft)

Starting with Java Edition snapshot 12w18a, released as 1.3.1, Minecraft's single-player runs on an internal local server, which removed the separate code paths for single-player and multiplayer. **What we take:** an in-memory connection, so the *same room code* runs inside the browser for solo play and for tests (D10). There's only one code path to debug.

### 1.9 Scaling tricks we'll leave hooks for (Unreal)

Unreal decides which objects are *relevant* to each client (`IsNetRelevantFor`), skips updates for objects that aren't changing (*dormancy*), and ranks objects by priority when bandwidth runs short. Its newer Iris system lets priority build up over network ticks, so even low-priority objects eventually get sent. **What we take:** a per-client `isRelevant(entity)` hook that returns `true` for everything today. With 5 players and a handful of entities we don't need prioritization. §4 D14 lists when we would.

### 1.10 What browsers can use as a connection

| Option | What it is | Upside | Downside |
|---|---|---|---|
| **WebSocket** | Messages over a single TCP connection | Works everywhere, simple, well-supported in Node | Every message is delivered reliably and in order. One lost packet holds up everything behind it until it's resent (*head-of-line blocking*; see Fiedler's "Why can't I send UDP packets from a browser?"). On a decent connection that's rare. On lossy Wi-Fi it shows up as hitches. |
| **WebRTC DataChannel** | Peer-to-peer data, can run unreliable and unordered | Messages can arrive and be dropped like UDP | Setup is complicated: you need a separate signaling step plus the STUN/TURN machinery for getting through home routers. |
| **WebTransport** | HTTP/3 (QUIC) with unreliable datagrams | UDP-like delivery with a modern API | Secondary sources say it became available in all major browsers when Safari 26.4 shipped it in March 2026. Server-side support in Node is less mature (*not verified yet*). |

**What we take:** WebSocket now. Every message is labeled with how it *could* be delivered (state that can be dropped vs events that must arrive), so moving state to WebTransport datagrams later only means swapping the connection code.

### 1.11 Hosting options

- **A long-running Node process** (your laptop, a tunnel, or a host like Fly.io, Render or Railway): the simplest choice, and it matches the code we write.
- **Cloudflare Durable Objects (PartyKit runs on them):** the common pattern is one Durable Object per game room, which maps exactly onto our rooms (secondary sources). One catch: a room that ticks continuously can't go to sleep, and sleeping idle rooms is what saves money there, so check pricing before choosing it. **What we take:** the room code never imports Node-only APIs (D12), so moving to Durable Objects later is an option rather than a rewrite.

### 1.12 Fixed timestep (Gaffer On Games, "Fix Your Timestep")

The simulation advances in fixed steps, driven by an accumulator that collects real elapsed time. Rendering blends between the last two simulation states, so the picture stays smooth at any frame rate. This is required for any of the above to be predictable and testable.

---

## 2. Intent

**Problem.** Build networking groundwork that the Explore-and-Escape prototype (`PROTO_SPEC.md`) and the bigger ideas in `RND.md` (secret objectives, betrayal, an AI director, more rooms) can grow on without a rewrite. It should feel good for 2–5 friends, be testable by one person working alone, and be cheap to run.

**In scope:** transport, rooms, handshakes, the system describing what gets sent, snapshots, interpolation, owner-authoritative movement, server-authoritative actions, tick-stamped events, lag compensation for AI, reconnecting, rate limiting, network simulation, network stats, bots, logs and budgets.

**Out of scope:** game rules (they're in `PROTO_SPEC.md`), server-authoritative movement with prediction and reconciliation (designed for, not built; D3), binary encoding and sending only changes, interest management and prioritization, matchmaking with strangers, accounts, persistence between matches, anti-cheat beyond plausibility checks, and choosing a production host (Q1). Voice chat is deferred until after Playtest 1, then built in N6 (D19).

---

## 3. How it fits together

### 3.1 Data flow

```
 Each player's browser                                  Room (Node server, or in the browser for solo play)
┌──────────────────────────────────────┐              ┌──────────────────────────────────────────────┐
│ keyboard/mouse                        │  'in' x30/s  │ per-player input queue                        │
│   └▶ stepMotion() @60 Hz  (YOU own it)├─────────────▶│   └▶ take 1 command per player per tick       │
│        └▶ camera (blended between    │ 2 cmds/msg   │                                              │
│           ticks, mouse look per frame)│              │ stepWorld() @60 Hz  ◀─ joins/leaves/requests │
│                                       │  'req'       │   motion checks · hunter · items · match     │
│ request("interact") ─────────────────┼─────────────▶│   records hunter history (1 s, lag comp)     │
│                                       │              │                                              │
│ SnapshotBuffer ◀─ 'snap' x30/s ───────┼◀─────────────┤ buildSnapshot(per recipient, visibility)     │
│ PlayoutClock → renderTick (~66–100 ms │              │                                              │
│   behind) → others + hunter blended   │  'ev' 'res'  │ events (tick-stamped), responses (by req id) │
│ event queue → shown at renderTick ≥ T ◀┼◀─────────────┤                                              │
└──────────────────────────────────────┘              └──────────────────────────────────────────────┘
```

### 3.2 Two timelines on the client

- **The present:** your own motion, simulated locally. That's why it feels instant.
- **The render timeline (`renderTick`):** everything you don't own: other players, the hunter, items, doors, and events. It sits a little behind the server so there's always a newer snapshot to blend towards.

Rule: **anything the server does that affects you is applied when the render timeline reaches its tick.** That way cause (the hunter reaching you, as drawn) and effect (the capture) appear together. Replies to your own requests (did I get the key?) are applied as soon as they arrive.

### 3.3 Glossary

| Term | Meaning here |
|---|---|
| **Tick** | One fixed simulation step, 1/60 s. Server ticks are numbered from 0 for each room. |
| **Snapshot** | The server's view of every entity a client is allowed to see, at one tick. |
| **Entity** | Something networked that changes at runtime: a player, the hunter, the key, a door. Never walls or furniture. |
| **Authority** | Who is allowed to write a field: `SERVER` or `OWNER` (the player that entity belongs to). |
| **Visibility** | Who receives a field: `ALL`, `OWNER` (only the owning player), or `SERVER` (never sent). |
| **Interpolation** | Drawing a remote entity by blending between two snapshots that have already arrived. |
| **Extrapolation** | Guessing forward past the newest snapshot. We allow at most 100 ms of it. |
| **Prediction / reconciliation** | Simulating your own inputs before the server confirms them, then correcting when it does. Not needed while you own your motion (D3). |
| **Lag compensation** | The server judges an outcome using what the player saw at the time, not the server's "now". |
| **Jitter** | Variation in how long messages take to arrive. The reason we keep a buffer. |
| **Epoch** | A counter on each player's motion. The server increments it when it moves you itself (teleport, respawn, correction), so in-flight movement messages from before that move get thrown away. |
| **Backpressure** | When a client can't receive data as fast as we send it, messages pile up. We skip state updates for that client rather than let the pile grow. |
| **Room** | One match: up to 5 players, one world, one four-letter code. |

---

## 4. Decisions

### D1. Shape: a server per match that no player runs

| Option | Why not chosen |
|---|---|
| One player's browser hosts, connected peer-to-peer over WebRTC | A browser can't accept WebSocket connections. WebRTC needs signaling plus STUN/TURN. The host gets a latency advantage (§1.5), and the match dies if the host leaves. |
| A hosted framework (Colyseus 0.18, PartyKit) | Workable, but it brings its own model for rooms and state and ties us to it. Our needs are small enough to build ourselves, and building them is the learning goal. We can revisit if this becomes painful. |
| **A Node room server (chosen)** | Simple, the same code runs in solo mode, no player has an advantage, and it can be hosted anywhere. |

### D2. Who owns what

| State | Who writes it | Who sees it | Notes |
|---|---|---|---|
| Player motion: `x, z, yaw, pitch` | **Owner** (the server checks it) | All | Pitch lets others see where you're looking, which is cheap and helps you feel present together. |
| Player `epoch` | Server | All | Remote clients need it to know when to jump instead of blending. |
| Player `level, status, carrying, name` | Server | All | |
| Player private data (later: secret objective, inventory, karma) | Server | **Owner only** | The visibility setting exists from day one, even though no field uses it yet. |
| Hunter | Server | All (per-client hook exists) | |
| Items (the key) | Server | All | |
| Shared props (elevator doors, the fireplace's on/off state) | Server | All | Physical interactions are shared (D20). |
| Lobby discoveries, golden/blue hour, ambient-audio preference, camera bob, UI | Client only | Not networked | Stays per-player while presentation has no gameplay effect (D20). |

### D3. Movement: you own it, and each message carries input plus result

Each tick, the client runs the shared `stepMotion(state, input, level)` at 60 Hz and records one **MotionCmd**:
`{seq, ep, in:{mx, mz, sprint, yaw, pitch}, x, z, view}`. Here `in` is the raw input, `x` and `z` are the resulting position, and `view` is the render tick the player was seeing.

The server **checks plausibility rather than re-simulating**: the step size must be within the sprint speed plus a tolerance, the new position must be legal, the epoch must be current, the sequence number must increase, and the command rate must be within limits.

**Why carry both input and result?** If we later need server-authoritative movement (direct PvP combat arrives, or we open the game to strangers), the server re-runs `stepMotion` on the `in` field and compares its answer with `x, z`. The client adds reconciliation (Gambetta part II). **The message format doesn't change.** We'd compare with a tolerance rather than exact equality, because browsers don't guarantee identical floating-point math results (§1.1). The same field also makes replays possible (§6.9).

### D4. Rates and delays (named constants, defined once)

| Constant | Value | Why |
|---|---|---|
| `TICK_HZ` | 60 | The standard simulation rate. Smooth enough for the hunter's steering and collision. Simulation cost is trivial at our scale. |
| `SNAPSHOT_EVERY` | 2 ticks (30 Hz) | Halves bandwidth. Interpolation covers the gaps. |
| `INPUT_SEND_EVERY` | 2 ticks (30 Hz, 2 commands per message) | Matches the snapshot rate. |
| Interpolation delay | `clamp(2 × snapshot interval + 2 × jitter, 66 ms, 250 ms)` | Same shape as Source's `max(cl_interp, ratio/updaterate)` with its 250 ms cap. |
| Extrapolation cap | 100 ms, then hold position | Guessing too far makes entities overshoot and snap back. |
| Lag-compensation history / max rewind | 60 ticks (1 s) / 15 ticks (250 ms) | Source keeps 1 s. Capping the rewind limits abuse from deliberate lag spikes. |

### D5. A general system for what gets sent

The game declares each entity type once, field by field: **type** (which also sets precision, e.g. positions rounded to 1 cm and angles to 0.001 rad), **authority**, **visibility** and **blending rule** (`LINEAR`, `ANGLE` for shortest turn, or `STEP` for values that jump). The networking code works on any declared type, so **adding a new entity type (a second hunter, an NPC, a door) needs no networking changes**.

- **Version 1 sends full snapshots as JSON**, built separately for each recipient. The builder always leaves out server-only fields, and leaves out owner-only fields for everyone except the owner. An entity missing from a snapshot has been removed.
- **Estimated bandwidth:** about 80 bytes per player × 5 + hunter + key + header ≈ 600 bytes per snapshot × 30 Hz ≈ **18 KB/s per client downstream**. That's under budget (B1). Sending only what changed and binary encoding are deliberately left out until measurements say we need them (D14).
- **IDs are never reused within a room**, so a newly spawned entity can't be confused with an old one and blended from its last position.
- **Never network what can be worked out from other data.** Walking and sprinting animations, for example, come from velocity on the client.

### D6. Four kinds of message over one WebSocket

| Kind | Direction | Meaning | What happens under pressure |
|---|---|---|---|
| **state** (`snap`, `in`) | both | Only the newest copy matters | Can be skipped. `snap` is skipped for a client that's falling behind (F7). |
| **event** (`ev`) | server → client | Something happened at tick T | Must arrive, in order |
| **request/response** (`req` / `res`) | client → server → client | "Please do X", then "OK" or "no, because Y" | Must arrive. Answered exactly once. |
| **control** (`hello`, `welcome`, `ping`, `pong`, close codes) | both | Session management | Must arrive |

### D7. The rule for events, and what late joiners get

- Every event carries the **tick** it happened on. The client shows it **when `renderTick ≥ tick`**.
- **Rule:** *anything a player who joins later needs must be in state.* Events are only for one-off presentation: sounds, screen effects, toasts. For example, "the fire is lit" is a field on the fireplace entity. The `fire_toggled` event only plays the sound. Test P8 enforces this rule.

### D8. Teleports use motion epochs

When the server moves a player itself (the elevator, a respawn, a correction), it sets the position and **increments `ep`**. The server then drops queued and in-flight commands that carry the old epoch. The owner applies the jump when its render timeline reaches that tick and starts stamping the new epoch on its commands. Remote clients **jump rather than blend** whenever an entity's epoch changes between two snapshots. Without this, the server and client could end up repeatedly correcting each other in a loop, and teleports would show players sliding across the map.

Latency is hidden by local animation: the elevator doors start closing on your screen the moment you press E.

### D9. Lag compensation favours the player being chased

Shooters favour the shooter. Here the "shooter" is an AI with no feelings to protect, while the *player being chased* is the human whose experience matters. Getting caught by a hunter you couldn't see yet is the worst-feeling failure in this genre.

When the server takes player P's command at tick T, it tests for capture as:
`distance(cmd.x/z, hunterHistory.at(clamp(cmd.view, T − 15, T))) < CAPTURE_RADIUS`.

Two guards stop players abusing this:
- The rewind is capped at 250 ms.
- A player whose command queue has been empty for more than 250 ms (lag spike, hidden tab) is tested against the hunter's **current** position.

### D10. The connection interface, the in-memory version, and the bad-network simulator

Everything above the connection layer talks to a small **Connection** interface (`send`, `close`, `onMessage`, `onClose`, `bufferedBytes`). It has these implementations:

- **A WebSocket wrapper.** In the browser it uses the native `WebSocket`; on the server it uses the `ws` package.
- **An in-memory pair** that connects a room directly to the client in one process. This is what solo/offline play and the room tests run on.
- **A bad-network simulator** (`withConditions`) that wraps any connection with seeded latency, jitter and delay spikes. Over TCP, a lost packet shows up as a delay spike, so that's how we model loss. Presets are chosen from the page address, e.g. `?net=wifi` or `?net=bad`. **Build it on day one.** Source has `net_fakelag` and Unity ships a network simulator because bugs that only appear at 150 ms of latency are the ones that ruin playtests.

### D11. Rooms, codes and reconnecting

- **Room codes are four letters from 20 consonants** (`BCDFGHJKLMNPQRSTVWXZ`, 160,000 possible codes). No vowels means no accidental words. Codes can be shared as a link (`?room=QXJT`).
- On joining, the server issues a **resume token** (128 random bits). If the connection drops, the client reconnects automatically and sends the token to get **the same player and entity** back within a **30 s** window. During that window the player's avatar stays in the world marked *disconnected*: anything it was carrying drops immediately, and the hunter ignores it. After 30 s the player is removed.
- A room with nobody connected for 60 s is closed.

### D12. Server process

- **One Node process runs many rooms**, driven by **one fixed-timestep loop** that ticks every room in turn.
- **Rooms are kept independent of the runtime.** A room never imports `ws`, `fs` or `http`, and never reads the environment or the clock directly; everything is passed in. That's how the same room runs in the browser (solo play) and in tests, and could move to Durable Objects later.
- **Failure isolation:** if a room's tick throws, that room is **closed loudly**. The error and stack trace are logged with the room code, and its clients get close code `4007 room_closed`. Other rooms keep running. The error isn't hidden; its damage is limited to one room.
- **In production, the server also serves the built game from `dist/`.** Friends then need one address on one port, which also means a single tunnel works. In development, Vite forwards `/ws` to the server.

### D13. Encoding

JSON with short keys, with values rounded according to each field's declared type. All encoding goes through one place (`encode` and `decode`), so switching to a binary format later changes one file, plus a protocol version bump.

### D14. Deliberately not built yet, and when we would build each

| Technique | Build it when… |
|---|---|
| Server-authoritative movement with prediction and reconciliation | Direct PvP combat is confirmed, or we open the game to strangers (D3 explains the migration) |
| Sending only what changed since the client's last confirmed snapshot (the Quake 3 approach) | Bandwidth measured in the stats overlay goes over budget B1 |
| Binary encoding | Same trigger, or CPU time spent encoding JSON shows up in profiles |
| Relevancy and priority (the Unreal/Iris approach) | More than about 200 networked entities, or bandwidth saturates |
| Unreliable delivery (WebTransport or WebRTC) | Playtests show hitches on lossy Wi-Fi that the bad-network simulator reproduces |
| Proximity voice chat (WebRTC, with signaling over our WebSocket) | N6, immediately after Playtest 1; ready for comparison at Playtest 2 (D19) |
| Rollback netcode (the GGPO approach) or lockstep | Probably never. They suit fighting games and RTS games (§1.1) |

### D15. Hosting: three stages, starting with your laptop *(decided 2026-11-09)*

The playtesters are in Madison, and your laptop acts as the server for early playtests. None of the stages changes code, only config (D12).

| Stage | When | How | Notes |
|---|---|---|---|
| **1. Local** | Development (N0–N2) | `localhost`, plus the bots | Same-Wi-Fi play with friends might not work on campus. Campus and dorm networks often block devices from reaching each other (*not checked for UW specifically*). |
| **2. Laptop + tunnel** | Playtests 1–2 | `npm run host` (build, then start the server on one port), then `cloudflared tunnel --url http://localhost:8787` | Free, uses `wss://`, and needs no port-forwarding, so it works from any network. The quick-tunnel address changes every run. Add it to `ORIGINS`, or have `parseConfig` accept a `*.trycloudflare.com` pattern. Your laptop must stay awake while hosting (`caffeinate -i`). You get ~0 ms to the server, a small advantage mostly limited to item grabs (D3 and D9 cover the rest). |
| **3. Always-on server** | When people want to play without you | A small always-on server in **Chicago** (e.g. Fly.io `ord`), the closest major region to Madison | Not a sleeping free tier. Check pricing when we get here. |

### D16. Players can't hurt each other *(decided 2026-11-09)*

No attacks, shoving, knockback or any other player-to-player force for now. Betrayal happens through the world: doors, items, noise, information. All of those are server-decided requests (§5 I), so players keep owning their own movement (D3) and we don't need server-authoritative movement or rewinding players for hit checks. If this is revisited, follow the trigger in D14. The message format already supports it.

### D17. Players block each other, and each player resolves it for themselves *(decided 2026-11-09)*

Players are solid to each other: two avatars never pass through each other. The difficulty is that everyone owns their own movement while seeing other players about 66–100 ms in the past (§3.2). The server's "truth" isn't what anyone sees, so it can't referee blocking without causing endless corrections. Instead:

1. **What you see is what blocks you.** In `stepMotion`, your player collides with circles (radius `PLAYER_RADIUS`) placed at the other players' **drawn** positions, the same samples the renderer uses. You never visibly walk into anyone. This is the same "judge it from what the player saw" principle as D9.
2. **Overlaps get pushed apart, by each player separately.** If two players step into the same gap at once, each was colliding with the other's slightly old position, so they can end up overlapping. Each client then moves **only its own player** apart along the line between the two centres, at most `SEPARATE_SPEED` (1.5 m/s). It uses the normal wall sliding, so nobody gets pushed into a wall. Both clients do the same thing at once, so they come apart within a few ticks without any coordination.
3. **The server doesn't enforce blocking.** `checkMotion` ignores other players, so blocking can never trigger a correction. The server only counts long overlaps (O5) so we can tell if separation is failing. Accepted risk: a modified client could walk through people. That's fine for friends (§1.6).
4. **Who blocks:** players with status `ACTIVE` or `AFK`. `CAPTURED` and `DISCONNECTED` avatars don't block and are drawn translucent, so a dropped connection can't leave a body plugging a doorway.
5. **The hunter isn't blocked by players.** Touching it means capture (D9), so body-blocking it isn't a strategy.
6. **Anti-trap squeeze:** if you've been pushing into the same player for `SQUEEZE_AFTER_MS` (1.5 s) and moved less than 0.1 m, that player stops blocking you until you're apart. Without this, one player can permanently trap another in a corner, the elevator or a narrow corridor, which is griefing rather than betrayal. Set `SQUEEZE_AFTER_MS = Infinity` to turn it off.
7. **Positions the server picks never overlap anyone.** Spawns, respawns and elevator arrivals use a fixed set of slots, at least `2 × PLAYER_RADIUS + 0.1` m apart, one per possible player. The map data defines them.
8. **Level design rule:** any chokepoint on the required route (doors, corridors, the elevator) is at least 1.4 m wide, so one player can't block it alone. `map.js` tests check this.

### D18. Solo play is supported, but multiplayer comes first *(decided 2026-11-09)*

1. **The start screen leads with multiplayer.** The two primary buttons are **Create room** and **Join with code**, with the tagline "Best with 2–5 friends". **Explore alone** is a smaller secondary link underneath.
2. **When the server is reachable, solo is a real room with one player.** "Explore alone" creates a normal server room. The room code and an **Invite friends** button (which copies the `?room=` link) stay in the pause menu and network stats overlay. Friends can join mid-game, and someone playing solo is never more than one click from a multiplayer session.
3. **Offline solo is the fallback.** If the server can't be reached, "Explore alone" runs the room in the browser over the in-memory connection (D10). The game says it's offline and that inviting friends isn't available. A room running in the browser can't be handed over to a server later.
4. **The hunter scales with player count.** Its tuning gets the number of players as an input (`PROTO_SPEC.md` Q5), so one player isn't stuck with a hunter built for five. That's a game-design concern, but the input has to exist in `stepWorld`.
5. **Not built:** single-player-only content, separate solo saves, or a solo tutorial.

---

### D19. Discord first, optional proximity voice next *(decided 2026-11-09)*

1. **Playtest 1 uses a Discord call.** Establish whether moving and cooperating together feels good before adding in-game voice.
2. **N6 starts immediately after Playtest 1.** Add proximity voice for Playtest 2, with volume falling over distance and muffling through walls. Compare the experience against the Discord baseline.
3. **Reserve signaling now; implement voice in N6.** Reserve `t:'voice'` in the protocol for browser connection setup. N6 will specify the payload, validation and room-scoped routing. Audio uses WebRTC, with TURN relay support where needed; the game WebSocket carries setup messages only.
4. **Voice is optional.** Joining and playing never depend on microphone permission or a working voice connection. Provide an explicit enable control, microphone mute and per-player mute. Denied permissions, missing microphones and voice connection failures leave gameplay working and show a readable voice status.
5. **Campus connectivity is part of N6 acceptance.** Test with players on UW campus Wi-Fi and on an outside network, and exercise the relay path. Record the result before calling voice ready. TURN provider selection and current costs are evaluated during N6.

---

### D20. Shared lobby interactions, personal presentation *(decided 2026-11-09; revisit if gameplay changes)*

1. **The fireplace and elevator doors are shared.** The server owns their state. When a player changes either, everyone sees the result; late joiners receive the current state (D7, P8).
2. **Discoveries and presentation stay personal.** Discovering a lobby detail updates only that player's progress. Golden/blue hour, ambient-audio preference, camera effects and UI remain local, so changing them doesn't change another player's experience.
3. **Gameplay-affecting lighting must become shared.** For now, time of day is cosmetic. If lighting starts affecting hiding, hunter detection or another game rule, move the relevant lighting state to server authority before introducing that mechanic.

---

## 5. Behavioral spec: acceptance criteria

"Check" says how each criterion is verified. **U** = unit test (pure code), **R** = room test (fake connections, manual `tick()`), **I** = integration (a real `ws` server on a random port with headless clients), **M** = manual playtest.

### R: Rooms and handshake

| # | Criterion | Check |
|---|---|---|
| R1 | `hello{room:null}` creates a room and returns `welcome` with a new code from the 20-letter alphabet. A code is never handed out while a room is using it. | U, I |
| R2 | `hello{room:"QXJT"}` for an existing room returns `welcome` with a starting snapshot containing every entity this player is allowed to see. | R, I |
| R3 | An unknown code closes the connection with `4003`. A full room (5 players) closes it with `4002`. | R, I |
| R4 | A `hello.v` that doesn't match `PROTOCOL_VERSION` closes with `4001`. The reason text includes the server's version. The client shows "A new version is available. Refresh." | I |
| R5 | No `hello` within 5 s, or a malformed `hello`, closes with `4004`. | R |
| R6 | Names are trimmed and must be 1–16 characters of letters, digits, spaces, `_` or `-` (any language's letters). Anything else gets `4004`. A duplicate name gets `" 2"`, `" 3"`, and so on appended. Names are only ever drawn as text, never inserted as HTML. | U |
| R7 | A room with no connected players for 60 s is closed and its code freed. | R |

### P: Presence and replication

| # | Criterion | Check |
|---|---|---|
| P1 | Two clients in one room each show the other's avatar within 1 s of joining. | I, M |
| P2 | Rendered remote positions always lie on the path of reported positions, within 0.05 m. With the simulator at 150 ms ± 30 ms there's no visible stutter. | U, M |
| P3 | Owner-only fields never appear in snapshots sent to other players. Server-only fields never appear in any snapshot. | U |
| P4 | An entity appears when `renderTick` reaches the first snapshot containing it, and disappears when `renderTick` reaches the first snapshot without it. | U |
| P5 | Entity IDs are never reused within a room's lifetime. | U |
| P6 | When an entity's epoch changes between two snapshots, it jumps instead of blending. | U |
| P7 | The client's own entity's motion fields in snapshots are ignored, except when its epoch changes. | U |
| P8 | **Late joiners see the same world:** a client that joins at tick T and a client that has been in the room since tick 0 render identical entity views for every render tick ≥ T + the buffer. | I |

### M: Movement

| # | Criterion | Check |
|---|---|---|
| M1 | Movement feels the same as the current single-player game: walk at 2.6 m/s, sprint at 4.4 m/s, diagonal movement isn't faster, you slide along walls, you stay inside the room, and thin walls can't be walked through. Tested against the shared `stepMotion`. | U |
| M2 | The client simulates motion at a fixed 60 Hz. The camera blends between the last two motion states. Mouse look is applied every rendered frame, not once per tick. | U, M |
| M3 | The client sends `in` at 30 Hz containing that period's commands, numbered with consecutive `seq` values. | R |
| M4 | The room takes **one** command per player per tick, or two if more than 4 are queued, to catch up. If the queue is empty, the player holds their position. | R |
| M5 | A command with an old epoch, or a `seq` that isn't higher than the last one, is dropped silently. A step that's too long, or that ends in an illegal position, triggers a correction: the epoch is incremented and the player is told the server's position. | U, R |
| M6 | More than 75 commands per second sustained from one player: the extra ones are dropped, and a warning is logged at most once every 10 s. | U, R |
| M7 | After a correction there's **no correction loop:** with the simulator at 150 ms RTT, a forced correction produces exactly one correction. | I |
| M8 | Opening the menu (Esc) doesn't pause the world. The menu appears on top and the client keeps sending zero-input commands. | M |
| M9 | After 1 s with an empty queue (e.g. a hidden tab), the player's status becomes `AFK`. It goes back to `ACTIVE` on the next command. | R |

### C: Player blocking (D17)

| # | Criterion | Check |
|---|---|---|
| C1 | Outside a separation (C2), `stepMotion` never ends a tick with your player overlapping a blocking obstacle by more than 0.02 m. Walking into another player slides you around them, the same way walls do. | U |
| C2 | Two clients that both move into the same space at once (simulator at 150 ms RTT, 30 ms jitter) are fully apart within 0.5 s. Neither ends up inside a wall. | U, I |
| C3 | Overlapping players never trigger a server correction. `checkMotion` returns the same result with or without other players present. | U |
| C4 | `CAPTURED` and `DISCONNECTED` players don't block, and are drawn translucent. `ACTIVE` and `AFK` players block. | U, M |
| C5 | The hunter isn't blocked by players. | U |
| C6 | After pushing into the same player for `SQUEEZE_AFTER_MS` while moving less than 0.1 m, you can pass through that player until you're apart. Collision with them comes back once you're apart. | U |
| C7 | Spawn, respawn and elevator-arrival slots never overlap each other, and the server never puts two players in the same slot. | U, R |
| C8 | Every chokepoint on the required route in `map.js` is at least 1.4 m wide. | U |

### S: Start screen and solo (D18)

| # | Criterion | Check |
|---|---|---|
| S1 | The start screen shows **Create room** and **Join with code** as the primary actions, with "Best with 2–5 friends". **Explore alone** is visibly secondary. A `?room=` link skips straight to joining. | M |
| S2 | When the server is reachable, "Explore alone" creates a normal room with one player. A second client can join it by code mid-game, and both see each other (P1). | I |
| S3 | The pause menu shows the room code and an **Invite friends** button that copies the join link. | M |
| S4 | When the server can't be reached, "Explore alone" runs entirely in the browser, shows an "Offline: friends can't join" notice, and hides Invite. | M |
| S5 | `stepWorld` receives the current player count. With 1 player, a full match can be won (`PROTO_SPEC.md` Q5). | U, M |

### V: Optional proximity voice (D19; N6 only)

| # | Criterion | Check |
|---|---|---|
| V1 | In a 2–5-player room, enabled voices become quieter with distance and muffled when a wall blocks line of sight. Compare with the Discord baseline at Playtest 2. | M |
| V2 | A player can join and keep playing with voice disabled, microphone permission denied, no microphone, or a failed voice connection. Voice status is readable; microphone mute and per-player mute work. | M |
| V3 | Voice setup is routed only between connected players in the same room, with the sender identified by the server. Invalid messages and attempts to signal another room are rejected. Late joins and departures update voice connections. | R, I, M |
| V4 | A campus-to-outside-network call succeeds with the configured TURN fallback available. Separately force the relay path and verify audio. Record network, browser and direct/relay results before declaring N6 complete. | M |

### I: Requests (actions the server decides)

| # | Criterion | Check |
|---|---|---|
| I1 | Each `req` gets exactly one `res`. Repeating the same (player, request ID) within 10 s returns the original result without doing the action again, so retries are safe. | R |
| I2 | If two requests for the same item arrive in the same tick, the first to arrive wins. The second gets `reason:"taken"`. | R |
| I3 | Range checks use the server's copy of the player's position, with 0.3 m of tolerance. | R |
| I4 | The client gives immediate local feedback (a sound or animation) but only changes game state when the server confirms. After 3 s with no answer it shows a timeout and logs a warning. | M |

### E: Events and the render timeline

| # | Criterion | Check |
|---|---|---|
| E1 | Every event carries the tick it happened on. | U |
| E2 | The client shows each event when `renderTick ≥ event.tick`, in tick order, ties broken by arrival order. An event more than 1 s ahead of the render timeline is shown immediately, with a warning. | U |
| E3 | Server-made changes to the local player (teleport, capture, respawn) are applied at their tick on the render timeline. | U, M |
| E4 | Replies (`res`) are applied as soon as they arrive. | U |
| E5 | Every networked effect that lasts is in state, not only in an event (D7). Checked by P8 plus code review. | I |

### L: Lag compensation (the hunter, from `PROTO_SPEC.md` M3)

| # | Criterion | Check |
|---|---|---|
| L1 | The room records the hunter's position every tick and keeps the last 60 ticks. | U |
| L2 | When a player's command is taken, capture is tested against the hunter's position at `clamp(cmd.view, T−15, T)`, with blending between recorded ticks. | U |
| L3 | A player whose queue has been empty for more than 250 ms is tested against the hunter's current position. | R |
| L4 | With the simulator at 150 ms RTT and 30 ms jitter, and a scripted player standing still while the hunter approaches, the capture happens within ±1 tick of the moment the client's *drawn* hunter crosses the capture radius. | I |

### F: Failures and recovery

| # | Criterion | Check |
|---|---|---|
| F1 | If the server can't be reached, the client shows "Can't reach the hotel", a **Retry** button, and **Explore alone (offline)**, which uses the in-memory connection (D18.3). | M |
| F2 | After an unexpected disconnect, the client reconnects automatically after 0.5, 1, 2, 4 and 8 s, sending its resume token. On success the player gets back the same entity in the same place. | I |
| F3 | While disconnected, the avatar has status `DISCONNECTED` and stays where it was. Anything it carried drops immediately and the hunter ignores it. It's removed after 30 s. | R |
| F4 | A second connection with the same resume token wins. The old one closes with `4005`. | R |
| F5 | Malformed or unknown messages are dropped and counted. More than 20 in 10 s closes the connection with `4006`. | R |
| F6 | An incoming message over 16 KB closes the connection with `1009` (the `ws` maximum message size setting). | I |
| F7 | If a client has more than 64 KB of unsent data, snapshots to it are skipped; events and replies are still sent. Over 1 MB, it's closed with `4008`. | R |
| F8 | The server pings each connection every 2 s. No reply within 6 s ends the connection, and the 30 s reconnect window starts. | I |
| F9 | An exception in one room's tick closes that room with `4007` and logs `room_crashed` with the stack trace. Other rooms keep ticking. | R, I |
| F10 | If the loop falls more than 5 ticks behind, it skips the backlog and logs `tick_skip` with how many ticks were skipped. | U |
| F11 | After a server restart, resume fails and the client shows "Room closed" with a **Create new room** button. | I |

### D: Determinism and testability

| # | Criterion | Check |
|---|---|---|
| D1 | Simulation code (`src/shared/sim/`) never reads the clock, `Math.random`, the network or the DOM. Everything comes in through `stepWorld` arguments and the seeded RNG. | Lint rule + code review, proven by D2 |
| D2 | The same seed and the same recorded commands produce an identical event log and identical world state after N ticks. | U |
| D3 | Rooms can be fully tested with fake connections and manual `tick()`, with no timers or sockets. | R (the tests exist) |
| D4 | The bad-network simulator is seeded, so network tests are reproducible. | U |

### O: Observability

| # | Criterion | Check |
|---|---|---|
| O1 | A network stats overlay, toggled with the `` ` `` key, shows: RTT, jitter, interpolation delay, how much is buffered, snapshot rate, bytes per second in and out, corrections per minute, server tick and room code. | M |
| O2 | The server logs one JSON line for each of: `conn_open`, `hello_rejected`, `player_joined`, `player_left`, `player_resumed`, `room_created`, `room_closed`, `room_crashed`, `correction` (summarized every 10 s), `tick_skip`, `rate_limited`. It never logs resume tokens or raw message contents. | R |
| O3 | Every 10 s, each room logs: player count, tick time (median and 99th percentile) and bytes sent per second. | R |
| O4 | With `RECORD_REPLAYS=1`, the room writes its seed and every command it took, by tick, to a file. `npm run replay <file>` reproduces the event log (D2). | U |
| O5 | The room counts pairs of blocking players that overlap by more than 0.1 m for more than 0.5 s. It reports the count in the 10 s room stats and shows it in the network stats overlay. It should stay near zero. If it doesn't, separation (D17) is failing. | R |

### B: Performance budgets

| # | Budget |
|---|---|
| B1 | A 5-player room uses at most **32 KB/s** downstream and **8 KB/s** upstream per client. |
| B2 | A room tick (5 players and the hunter) takes **at most 1 ms** at the 99th percentile on a development laptop. |
| B3 | Client networking work takes **at most 0.5 ms per frame**. |
| B4 | Interpolation delay is about 66 ms on a clean LAN, and never more than 250 ms. |

---

## 6. Interfaces

Plain JS with JSDoc types and `// @ts-check`. Enums are frozen objects, defined once. Every function that can fail documents how.

### 6.1 File map

Every file does exactly one job.

```
src/shared/                      ← imported by both browser and server. No DOM, no Node-only APIs, no I/O.
  constants.js                   rates, limits and tuning numbers that are part of the protocol
  net/protocol.js                message shapes, enums, version, decoding with validation
  net/codec.js                   turns messages into text and back (JSON v1)
  net/schema.js                  field types: rounding, validation, blending
  net/snapshot.js                builds what one recipient may see
  net/snapshotBuffer.js          stores received snapshots and samples them at a render tick
  net/playoutClock.js            decides which tick to draw right now
  net/history.js                 ring buffer of past positions, for lag compensation
  net/rateLimit.js               token bucket (a rate limiter)
  net/transport.js               the Connection interface and the in-memory pair
  net/conditioner.js             bad-network simulator wrapped around a Connection
  net/fixedLoop.js               fixed-timestep driver, with the clock and timers passed in
  room/room.js                   runs one match: players, input queues, stepping, sending updates
  room/roomManager.js            handshakes, room codes and resume tokens, across all rooms
  sim/entities.js                the entity type declarations (player, hunter, item, prop)
  sim/world.js                   world state and stepWorld(): the fixed order of game rules each tick
  sim/motion.js                  stepMotion() and checkMotion()
  sim/collision.js               canOccupy, slideMove, lineOfSight   (from PROTO_SPEC §4.3)
  sim/map.js                     level data                          (from PROTO_SPEC §4.2)
  sim/rng.js                     seeded random numbers
  sim/hunter.js · items.js · match.js   game rules (PROTO_SPEC M3–M4)
server/                          ← Node edge
  main.js                        wires everything together. The only file that reads the environment (through config.js)
  config.js                      parses the environment into typed settings, or throws
  wsAdapter.js                   turns ws sockets into Connections
  static.js                      serves dist/ (path-safe)
  log.js                         structured JSON-line logger
src/net/                         ← browser edge
  wsConnect.js                   turns a browser WebSocket into a Connection
  netClient.js                   keeps one session with a room
  netHud.js                      the network stats overlay
src/remoteEntities.js            draws remote players, the hunter and items (Three.js)
tools/bots.js · tools/replay.js  headless bot players; replaying recorded matches
vite.config.js                   forwards /ws to the server during development
test/                            node:test suites (§7)
```

`engine.js`, `lobby.js`, `city.js` and `main.js` stay where they are (no unrelated refactors). `FirstPersonController` keeps input and camera, but its movement moves to `sim/motion.js` (expand/contract, milestone N0).

### 6.2 `src/shared/constants.js`

```js
export const TICK_HZ = 60;
export const SNAPSHOT_EVERY = 2;          // ticks
export const INPUT_SEND_EVERY = 2;        // ticks
export const MAX_PLAYERS = 5;
export const MAX_ROOMS = 50;
export const HISTORY_TICKS = 60;
export const MAX_REWIND_TICKS = 15;
export const INTERP_MIN_MS = 66, INTERP_MAX_MS = 250, EXTRAP_MAX_MS = 100;
export const RESUME_GRACE_MS = 30_000, ROOM_IDLE_CLOSE_MS = 60_000, HELLO_TIMEOUT_MS = 5_000;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const BACKPRESSURE_SKIP_BYTES = 64 * 1024, BACKPRESSURE_CLOSE_BYTES = 1024 * 1024;
export const WALK_SPEED = 2.6, SPRINT_SPEED = 4.4, PLAYER_RADIUS = 0.32;
export const SEPARATE_SPEED = 1.5;        // m/s, overlap push-apart (D17)
export const SQUEEZE_AFTER_MS = 1500;     // anti-trap; Infinity disables (D17)
export const MIN_CHOKEPOINT_WIDTH = 1.4;  // m (D17)
```

### 6.3 `src/shared/net/protocol.js`

```js
export const PROTOCOL_VERSION = 1;

// Reserved for N6: t:'voice' in both directions (D19). Until N6, not accepted or forwarded; normal unknown-message rules apply.
export const C2S = Object.freeze({ HELLO: 'hello', INPUT: 'in', REQUEST: 'req', PING: 'ping' });
export const S2C = Object.freeze({ WELCOME: 'welcome', SNAPSHOT: 'snap', EVENTS: 'ev', RESPONSE: 'res', PONG: 'pong' });
export const CloseCode = Object.freeze({
  VERSION: 4001, FULL: 4002, NO_ROOM: 4003, BAD_HELLO: 4004,
  REPLACED: 4005, MALFORMED: 4006, ROOM_CLOSED: 4007, SLOW_CONSUMER: 4008,
}); // 4000–4999 are reserved for applications by the WebSocket standard (RFC 6455)

// Client → server
/** @typedef {{t:'hello', v:number, build:string, name:string, room:string|null, resume?:string}} Hello */
/** @typedef {{mx:number, mz:number, sprint:boolean, yaw:number, pitch:number}} MoveInput  mx, mz in [-1, 1] */
/** @typedef {{seq:number, ep:number, in:MoveInput, x:number, z:number, view:number}} MotionCmd */
/** @typedef {{t:'in', cmds:MotionCmd[]}} InputMsg  1–4 cmds */
/** @typedef {{t:'req', id:number, action:string, target?:number}} RequestMsg */
/** @typedef {{t:'ping', c:number}} PingMsg  c = the client's clock in ms */

// Server → client
/** @typedef {[id:number, kind:number, fields:Record<string, number|string|boolean>]} EntityState */
/** @typedef {{tick:number, ack:number, ents:EntityState[]}} Snapshot  ack = last seq taken from this client */
/** @typedef {{t:'welcome', playerId:string, entity:number, room:string, resume:string, tickHz:number, snapEvery:number, snap:Snapshot}} Welcome */
/** @typedef {{t:'snap'} & Snapshot} SnapMsg */
/** @typedef {{tick:number, k:string} & Record<string, unknown>} GameEvent */
/** @typedef {{t:'ev', list:GameEvent[]}} EventsMsg */
/** @typedef {{t:'res', id:number, ok:boolean, reason?:string}} ResponseMsg */
/** @typedef {{t:'pong', c:number, tick:number}} PongMsg */

/**
 * Check one raw message from a client. Never throws.
 * @param {string} raw
 * @returns {{ok:true, msg:Hello|InputMsg|RequestMsg|PingMsg} | {ok:false, error:string}}
 * Fails on: invalid JSON; unknown `t`; missing or wrongly typed fields; numbers that are
 * infinite or not a number; mx/mz outside [-1, 1]; more than 4 cmds; an invalid name.
 */
export function decodeClient(raw) {}

/** The server-to-client counterpart. Same rules; used by netClient and the bots. */
export function decodeServer(raw) {}
```

### 6.4 `src/shared/net/schema.js` and `snapshot.js`

```js
export const FieldType  = Object.freeze({ POS: 'pos', ANGLE: 'angle', U8: 'u8', U16: 'u16', BOOL: 'bool', ENTITY: 'entity', NAME: 'name' });
export const Visibility = Object.freeze({ ALL: 'all', OWNER: 'owner', SERVER: 'server' });
export const Authority  = Object.freeze({ SERVER: 'server', OWNER: 'owner' });
export const Blend      = Object.freeze({ LINEAR: 'linear', ANGLE: 'angle', STEP: 'step' });

/** @typedef {{type:string, vis:string, auth:string, blend:string}} FieldSpec */
/** @typedef {{kind:number, fields:Readonly<Record<string, FieldSpec>>}} EntitySchema */
/** @typedef {{id:number, kind:number, owner:string|null, fields:Record<string, unknown>}} Entity */

/** Declare an entity type. Throws at module load if the declaration is invalid (a programmer error, so fail early). */
export function defineKind(kind, fields) {}
/** Round a value to its type's precision (POS → 0.01 m, ANGLE → 0.001 rad). */
export function quantize(type, value) {}
/** @returns {boolean} whether a value received from a client is valid for this field type */
export function isValidValue(type, value) {}
/** Blend between a and b by t in [0, 1] using the field's blending rule. */
export function blend(spec, a, b, t) {}

// snapshot.js
/**
 * Build the snapshot one recipient is allowed to see.
 * @param {Iterable<Entity>} entities
 * @param {Map<number, EntitySchema>} schemas
 * @param {{tick:number, ack:number, recipient:string, isRelevant?:(e:Entity)=>boolean}} ctx
 * @returns {Snapshot} Always leaves out SERVER fields. Leaves out OWNER fields unless e.owner === recipient.
 *   Values are rounded. Throws if an entity's kind has no schema (a programmer error).
 */
export function buildSnapshot(entities, schemas, ctx) {}
```

`src/shared/sim/entities.js` declares the game's entity types, for example:

```js
export const Kind = Object.freeze({ PLAYER: 1, HUNTER: 2, ITEM: 3, PROP: 4 });
export const PlayerStatus = Object.freeze({ ACTIVE: 0, CAPTURED: 1, AFK: 2, DISCONNECTED: 3 });
export const PLAYER = defineKind(Kind.PLAYER, {
  x:     { type: FieldType.POS,   vis: Visibility.ALL, auth: Authority.OWNER,  blend: Blend.LINEAR },
  z:     { type: FieldType.POS,   vis: Visibility.ALL, auth: Authority.OWNER,  blend: Blend.LINEAR },
  yaw:   { type: FieldType.ANGLE, vis: Visibility.ALL, auth: Authority.OWNER,  blend: Blend.ANGLE },
  pitch: { type: FieldType.ANGLE, vis: Visibility.ALL, auth: Authority.OWNER,  blend: Blend.ANGLE },
  ep:    { type: FieldType.U16,   vis: Visibility.ALL, auth: Authority.SERVER, blend: Blend.STEP },
  lvl:   { type: FieldType.U8,    vis: Visibility.ALL, auth: Authority.SERVER, blend: Blend.STEP },
  st:    { type: FieldType.U8,    vis: Visibility.ALL, auth: Authority.SERVER, blend: Blend.STEP },
  carry: { type: FieldType.ENTITY,vis: Visibility.ALL, auth: Authority.SERVER, blend: Blend.STEP },
  name:  { type: FieldType.NAME,  vis: Visibility.ALL, auth: Authority.SERVER, blend: Blend.STEP },
});
// HUNTER: x, z, yaw, lvl, mode.  ITEM: x, z, lvl, holder.  PROP: state.
```

### 6.5 Client-side timeline (`snapshotBuffer.js`, `playoutClock.js`)

```js
/** @typedef {{id:number, kind:number, fields:Record<string, unknown>, jumped:boolean}} EntityView */

/**
 * @param {Map<number, EntitySchema>} schemas @param {number} [capacity=32]
 */
export function createSnapshotBuffer(schemas, capacity) {
  return {
    /** Store a snapshot. Ignores any snapshot that isn't newer than the newest one stored (safe if they arrive out of order). */
    push(snapshot) {},
    /**
     * @param {number} renderTick  may be fractional
     * @returns {Map<number, EntityView>} An entity is visible if it's in the snapshot at or before renderTick.
     *   If it's also in the next snapshot, it's blended between the two, unless its `ep` changed (then it jumps, and jumped = true).
     *   Beyond the newest snapshot, LINEAR fields are extrapolated for at most EXTRAP_MAX_MS, then held.
     *   Returns an empty Map if no snapshot has arrived yet.
     */
    sample(renderTick) {},
    newestTick() {}, clear() {},
  };
}

/**
 * Decides which (fractional) server tick to draw right now.
 * The delay is kept near clamp(2·interval + 2·jitter, INTERP_MIN_MS, INTERP_MAX_MS) by speeding the
 * render clock up or slowing it down by at most 5%. If it's more than 250 ms off (e.g. the tab was hidden), it resets to the target.
 */
export function createPlayoutClock({ tickHz, snapshotEvery }) {
  return {
    onSnapshot(tick, arrivalMs) {},
    /** @returns {number} never goes backwards, except right after a reset */
    renderTick(nowMs) {},
    stats() { /* {delayMs, jitterMs, bufferedMs, resets} */ },
  };
}
```

### 6.6 Server-side helpers (`history.js`, `rateLimit.js`, `fixedLoop.js`)

```js
/** Ring buffer of {x, z} per tick. */
export function createHistory(capacityTicks) {
  return {
    record(tick, x, z) {},
    /** @returns {{x:number, z:number} | null} blended between recorded ticks; null if older than the buffer or before the first record */
    at(tick) {},
  };
}

/** Token bucket. @returns {{take:(nowMs:number, n?:number)=>boolean}} */
export function createTokenBucket({ ratePerSec, burst }) {}

/**
 * Calls step() TICK_HZ times per second on average, using a fixed-timestep accumulator.
 * More than maxCatchUp ticks behind → the backlog is skipped and onSkip(count) is called. Never runs step() in parallel with itself.
 * If step() throws, the loop stops and the error is rethrown to whoever started the loop.
 * (The room manager catches failures per room before they reach here; see F9.)
 */
export function startFixedLoop({ tickHz, nowMs, setTimer, clearTimer, step, maxCatchUp = 5, onSkip }) {
  return { stop() {} };
}
```

### 6.7 Connections (`transport.js`, `conditioner.js`)

```js
/**
 * One two-way message pipe.
 * @typedef {object} Connection
 * @property {string} id
 * @property {(data:string)=>boolean} send  Returns false if already closed. Sending as a connection
 *   closes is a normal race, not an error.
 * @property {(code:number, reason:string)=>void} close  Safe to call more than once.
 * @property {()=>number} bufferedBytes  Bytes queued but not yet sent (used for backpressure).
 * @property {(cb:(data:string)=>void)=>void} onMessage
 * @property {(cb:(code:number, reason:string)=>void)=>void} onClose
 */

/** Two in-memory Connections wired together. Delivery happens on the next scheduled callback, never immediately inside send(). */
export function createLoopbackPair({ schedule }) { return { client: null, server: null }; }

/**
 * Wrap a Connection with fake latency, jitter and delay spikes (how packet loss shows up over TCP).
 * The seeded RNG makes results reproducible. Message order is preserved (it's still TCP-like).
 */
export function withConditions(conn, { latencyMs, jitterMs, spikeChance, spikeMs, seed, schedule }) {}
export const NetPreset = Object.freeze({ LAN: 'lan', WIFI: 'wifi', BAD: 'bad' });
```

### 6.8 Rooms (`room.js`, `roomManager.js`)

```js
/**
 * @typedef {{
 *   code:string, seed:number, nowMs:()=>number, log:Logger,
 *   sim:{ createWorld:Function, stepWorld:Function, entities:Function },   // passed in so tests can substitute a faulty or trivial simulation
 *   schemas:Map<number, EntitySchema>, recorder?:ReplayRecorder
 * }} RoomDeps
 */
export function createRoom(deps) {
  return {
    /** @returns {{ok:true, playerId:string, resume:string} | {ok:false, close:number, reason:string}} Fails if FULL. */
    join(conn, hello) {},
    /** Reattach to an existing player. Fails with NO_ROOM if the token is unknown or expired. If the player
     *  already has a live connection, that connection is closed with REPLACED (F4). */
    resume(conn, token) {},
    /** Advance exactly one tick: take queued commands, run stepWorld, send events and replies, and send
     *  snapshots every SNAPSHOT_EVERY ticks. Throws if the simulation throws. The manager isolates that failure (F9). */
    tick() {},
    connectedCount() {},
    /** @returns {number|null} ms timestamp when the last player disconnected, or null if anyone is connected */
    emptySince() {},
    /** Close every connection with the given code. Safe to call more than once. */
    close(code, reason) {},
  };
}

export function createRoomManager({ nowMs, randomBytes, log, createRoom, maxRooms }) {
  return {
    /** Owns the handshake: waits for `hello` (HELLO_TIMEOUT_MS), checks it, then routes to create/join/resume.
     *  Every failure closes the connection with a CloseCode from protocol.js. */
    accept(conn) {},
    /** Ticks every room. If a room throws, it's closed with ROOM_CLOSED, `room_crashed` is logged with the
     *  stack trace, and the room is removed. The remaining rooms still tick this turn. */
    tickAll() {},
    /** Closes rooms that have been empty for longer than ROOM_IDLE_CLOSE_MS, and expires resume tokens. */
    sweep() {},
    stats() { /* {rooms, players} */ },
  };
}
```

### 6.9 Simulation entry points (`sim/world.js`, `sim/motion.js`)

```js
/**
 * Everything that changes the world goes through here, so ordering is fixed and replays are exact.
 * @typedef {{
 *   joins:{playerId:string, name:string}[],
 *   leaves:string[],
 *   motion:Map<string, MotionCmd>,          // at most one per player this tick (already checked by decodeClient)
 *   starved:Set<string>,                    // players whose queue has been empty > 250 ms (L3)
 *   requests:{playerId:string, id:number, action:string, target?:number}[]   // in arrival order
 * }} TickInput
 * @typedef {{
 *   events:GameEvent[],
 *   responses:{playerId:string, id:number, ok:boolean, reason?:string}[],
 *   corrections:{playerId:string, ep:number, x:number, z:number, lvl:number}[]
 * }} TickOutput
 */
export function createWorld(seed) {}
/** Runs the rules in a fixed order: joins/leaves → motion checks → requests → hunter → captures → items → match → record history.
 *  Changes `world` in place (the room owns it). Deterministic: no clock, no Math.random, no I/O. */
export function stepWorld(world, input) { /* → TickOutput */ }
/** @returns {Iterable<Entity>} a read-only view for building snapshots */
export function entities(world) {}

// motion.js
/** @typedef {{x:number, z:number, vx:number, vz:number}} MotionState */
/** A blocking circle: another player at its drawn position (D17). */
/** @typedef {{id:number, x:number, z:number, r:number}} Obstacle */
/** @typedef {{pushingId:number|null, pushMs:number, squeezeId:number|null}} SqueezeState  per-client anti-trap memory (D17.6) */
/**
 * Advance one fixed tick (1/TICK_HZ). Same speeds, smoothing and wall sliding as today's controller.
 * Treats `obstacles` as solid, except the one in `squeeze.squeezeId`. If your player starts the tick overlapping an
 * obstacle, it's pushed apart at up to SEPARATE_SPEED (C1, C2). Pure: returns new state and never mutates its arguments.
 * The server never calls this with obstacles (C3).
 * @param {MotionState} state @param {MoveInput} input @param {LevelData} level
 * @param {readonly Obstacle[]} obstacles @param {SqueezeState} squeeze
 * @returns {{state:MotionState, squeeze:SqueezeState}}
 */
export function stepMotion(state, input, level, obstacles, squeeze) {}
/**
 * Server-side plausibility check of a position reported by the owner.
 * @returns {{ok:true} | {ok:false, reason:'stale_epoch'|'out_of_order'|'too_far'|'blocked'}}
 *   'stale_epoch' and 'out_of_order' → drop silently. 'too_far' and 'blocked' → correction (M5).
 */
export function checkMotion(prev, cmd, level, currentEpoch, lastSeq) {}
```

### 6.10 Client (`src/net/netClient.js`)

```js
/**
 * Keeps one session with a room over any Connection. Draws nothing and never touches Three.js,
 * so the same code also runs the headless bots in Node.
 * @param {{open:(url:string)=>Connection, url:string, nowMs:()=>number, name:string,
 *          room:string|null, resume?:string, schemas:Map<number, EntitySchema>}} opts
 */
export function createNetClient(opts) {
  return {
    /** @returns {'connecting'|'joined'|'reconnecting'|'closed'} */ status() {},
    onStatus(cb) {},
    /** @returns {{playerId:string, entity:number, epoch:number, room:string} | null} */ self() {},
    /** Record this tick's command. seq, ep and view are filled in here. Sent in batches every INPUT_SEND_EVERY ticks. */
    recordMotion(input, x, z) {},
    /** Never rejects. Resolves {ok:false, reason:'timeout'} after 3 s, or {ok:false, reason:'disconnected'}. */
    request(action, target) {},
    /** Call once per rendered frame.
     *  @returns {{renderTick:number, entities:Map<number, EntityView>, events:GameEvent[],
     *            selfJump?:{ep:number, x:number, z:number, lvl:number}}}
     *  `events` are the ones due at this renderTick (E2). `selfJump` is a server-made move of the local player that's now due (E3). */
    frame(nowMs) {},
    stats() { /* {rttMs, jitterMs, delayMs, bufferedMs, snapHz, inBps, outBps, corrections, serverTick} */ },
    close() {},
  };
}
```

The server address is decided **in one place** (`wsConnect.js`): the `?server=` page parameter, else `import.meta.env.VITE_SERVER_URL`, else `ws(s)://<page host>/ws`.

### 6.11 Server edge (`server/`)

```js
// config.js
/** @returns {{port:number, allowedOrigins:string[], staticDir:string|null, recordReplays:boolean}}
 *  Throws with a readable message on invalid values. Defaults: PORT=8787, ORIGINS=same-origin + localhost, STATIC=dist if it exists. */
export function parseConfig(env) {}

// wsAdapter.js
/** Starts the ws server on an existing http.Server at path /ws. maxPayload = MAX_MESSAGE_BYTES, permessage-deflate off,
 *  connections from origins not on the allowlist rejected, ws-level ping every 2 s with a 6 s timeout (F8).
 *  Each accepted socket becomes a Connection passed to onConnection. */
export function attachWsServer(httpServer, { allowedOrigins, onConnection }) { return { close() {} }; }

// static.js
/** Serves files from `dir`. Rejects path traversal ('..', encoded or not) with 404. index.html is the fallback for the page itself. */
export function createStaticHandler(dir) {}

// log.js
/** One JSON line per call: {ts, level, event, ...fields}. `write` is passed in (stdout in production, an array in tests). */
export function createLogger(write) { return { info(event, fields) {}, warn(event, fields) {}, error(event, fields) {} }; }
```

---

## 7. Testing strategy

Tests check the criteria in §5, not how the code happens to be written. We use Node's built-in `node:test`, run with `npm test`.

| Layer | What | How |
|---|---|---|
| **Unit (pure code)** | schema/codec round-trips and rounding; snapshot visibility (P3); buffer sampling, spawn/despawn, epoch jumps and extrapolation cap (P2, P4, P6); playout clock adjusting and resetting; history blending (L1–L2); token bucket; room code alphabet; `stepMotion` behavior (M1); `checkMotion` rules (M5); determinism (D2) | Plain function calls, no timers. |
| **Room** | handshake paths (R2–R5, R7), queue consumption (M3–M4, M9), idempotent requests (I1–I3), disconnect window (F3–F5, F7), crash isolation (F9), logs (O2–O3) | Fake connections plus manual `tick()` and `nowMs`. No sockets, no timers. |
| **Contract** | Every message type survives `encode` → `decode`. Lobby colliders in `map.js` match what `lobby.js` currently builds (the N0 migration). | Shared modules imported on both sides. |
| **Integration** | Real `ws` server on port 0 plus headless netClients: P1, P8, M7, L4, F2, F6, F8, F11 | Started in-process. The bad-network simulator uses fixed seeds. |
| **Bots** | `npm run bots -- --room QXJT --count 4`: wandering bots join your room so one person can play "with" four others | Uses the real netClient. |
| **Manual** | P2 smoothness, M2 feel, M8, I4, E3, F1, O1 | A checklist, run before each playtest and repeated under the `?net=bad` preset. |

**Bug-fix rule (from your engineering protocol):** reproduce the bug first, as a failing unit, room or replay test.

---

## 8. Build order

Every milestone leaves the game playable. N-milestones are networking work. M-milestones are game work from `PROTO_SPEC.md`.

| Step | What | Done when |
|---|---|---|
| **N0** | Move movement into `sim/motion.js` and `collision.js`, and lobby colliders into `map.js`. The controller uses them at a fixed 60 Hz with camera blending. **No networking yet.** | Single-player feels the same. M1 tests pass. The README's "ten controller checks" finally exist as real tests. |
| **N1** | Networking core plus rooms, **running entirely in the browser** through the in-memory connection. The stats overlay and network presets work. | Solo play runs through the full networking path. Unit and room tests pass. |
| **N2** | Real server: `ws` adapter, config, logs, serving `dist/`, Vite forwarding; netClient over WebSocket; remote avatars; a create/join screen with name and code; bots; the `npm run host` script (D15). | R, P, M2–M8 and O1–O3 pass. **Playtest 1: walk around together, using Discord for voice.** |
| **N6** *(scheduled here; D19)* | Optional proximity voice, WebRTC setup over room-scoped WebSocket signaling, distance attenuation and wall muffling, mute controls, TURN configuration and campus connectivity test. | V1–V4 pass; the Playtest 2 comparison in V1 is completed at M2–M4. Voice failures never block gameplay. |
| **N3** | Recovery: reconnecting and resuming, the 30 s window, replaced connections, backpressure, room crash isolation, skipped ticks. | F2–F11 pass. |
| **N4** | Requests and replies, events on the render timeline, epochs and teleports (the elevator), hunter history and the capture rule. | I, E and L1–L3 pass. |
| **M2–M4** | Upstairs floor, hunter, key and escape (`PROTO_SPEC.md`). | L4 passes. **Playtest 2: include proximity voice and compare with the Discord baseline.** |
| **N5** *(when the first bug that's hard to reproduce shows up)* | Replay recording and the replay tool. | O4 passes. |

---

## 9. Dependencies and environment

| Item | Decision | Cost / alternative |
|---|---|---|
| `ws` | Installed and **pinned at 8.22.2** after checking the [8.22.1 and 8.22.2 release notes](https://github.com/websockets/ws/releases). | Small and widely used. Node has no built-in WebSocket *server*. |
| Test runner | `node:test`, built in | No dependency. Vitest is the upgrade if we want watch mode. |
| Node | **Require 22.12+; tested on the already-installed 24.5.0**, pinned in `.nvmrc`. The system default was not changed. | The bots use the runtime's global `WebSocket` client. |
| Encoding, schema, interpolation | Written ourselves | Colyseus's schema system is the off-the-shelf alternative (D1). |

---

## 10. What breaks when something fails

| Failure | What breaks | What still works |
|---|---|---|
| A room's simulation throws | That one room (its clients see "Room closed") | Every other room |
| The server process crashes or restarts | Every room; clients can't resume (F11) | Solo play (in-memory) |
| One client's network is bad | That client's view (stalls, then catches up) | Everyone else. Their snapshots are skipped, not queued (F7). |
| A client is deliberately sending bad data | It's rate-limited, then disconnected (F5, M6) | Everyone else |
| The hosting provider goes down | All online play | Solo play |

---

## 11. Open questions

1. ~~**Hosting**~~ **Resolved (D15):** your laptop plus a Cloudflare tunnel for playtests. Later, an always-on server in Chicago.
2. ~~**Direct PvP?**~~ **Resolved (D16, D17):** no player-to-player force. Players block each other, and each client resolves it.
   - 2a. ~~**Keep the anti-trap squeeze?**~~ **Resolved:** yes, after 1.5 s (D17.6).
3. ~~**Solo play?**~~ **Resolved (D18):** it's on the start screen but secondary. It's a real server room when online, so friends can join, and runs in the browser when offline.
4. ~~**Proximity voice chat?**~~ **Resolved (D19):** Discord for Playtest 1; optional proximity voice immediately afterward in N6, for Playtest 2. Campus connectivity and relay testing are required before voice is ready.
5. ~~**Shared vs per-player lobby details?**~~ **Resolved for now (D20):** fireplace and elevator doors are shared; discoveries, golden/blue hour, ambient-audio preference and camera effects stay personal. Lighting becomes shared if it affects gameplay.
6. ~~**Tooling setup?**~~ **Resolved during the authorized implementation sprint:** `ws` 8.22.2 installed; Node 22.12+ required, tests run on existing Node 24.5.0. System-wide Node settings unchanged.

---

## 12. Sources

Primary or first-party sources are unmarked. *(secondary)* means a third-party summary, so treat the specifics with some caution.

- Gabriel Gambetta, *Fast-Paced Multiplayer*: [Part I: Client-Server Architecture](https://www.gabrielgambetta.com/client-server-game-architecture.html) · [Part II: Prediction and Reconciliation](https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html) · [Part III: Entity Interpolation](https://gabrielgambetta.com/entity-interpolation.html) · [Part IV: Lag Compensation](https://gabrielgambetta.com/lag-compensation.html) · [Live demo](https://www.gabrielgambetta.com/client-side-prediction-live-demo.html)
- Valve Developer Wiki: [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) · [Lag Compensation](https://developer.valvesoftware.com/wiki/Lag_Compensation) · [NPC Lag Compensation](https://developer.valvesoftware.com/wiki/NPC_Lag_Compensation) · [Interpolation](https://developer.valvesoftware.com/wiki/Interpolation) · [TF2 Network Graph (interpolation formula)](https://developer.valvesoftware.com/wiki/TF2_Network_Graph) · [Latency Compensating Methods in Client/Server Protocol Design](https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization)
- Glenn Fiedler, Gaffer On Games: [Introduction to Networked Physics](https://new.gafferongames.com/post/introduction_to_networked_physics/) · [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation) · [State Synchronization](https://new.gafferongames.com/post/state_synchronization/) · [Why can't I send UDP packets from a browser?](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/) · [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- Overwatch: [GDC 2017, "Overwatch Gameplay Architecture and Netcode" (Tim Ford)](https://gdcvault.com/play/1024001) · [60 Hz high-bandwidth update (GamesBeat)](https://gamesbeat.com/overwatch-netcode-tick-rate-60hz/) · [Edgegap deep dive](https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback) *(secondary)*
- Tribes and Halo: [Torque networking docs (Tribes lineage)](https://bl.kenko.dev/Websites/docs.garagegames.com/tge/official/content/documentation/Engine/Reference/Networking.html) · [Edgegap: TRIBES deep dive](https://edgegap.com/blog/game-backend-deep-dive-tribes-(1998)) *(secondary)* · [Edgegap: Halo: Reach deep dive](https://edgegap.com/blog/game-backend-deep-dive-halo-reach-netcode-host-migration) *(secondary)* · [Wolfire GDC 2011 Halo networking summary](https://wolfire-blog.appspot.com/2011/03/GDC-Session-Summary-Halo-networking) *(secondary)*
- Photon Fusion: [Network topologies](https://doc.photonengine.com/fusion/v2/manual/network-topologies) · [Modes and topologies (Fusion 3)](https://doc.photonengine.com/fusion-core/v3/getting-started/modes-and-topologies)
- Unity Netcode for GameObjects: [Dealing with latency](https://mp-docs.dl.it.unity3d.com/netcode/1.6.0/learn/dealing-with-latency/)
- Unreal: [Actor priority](https://dev.epicgames.com/documentation/unreal-engine/actor-priority-in-unreal-engine) · [Iris prioritization](https://dev.epicgames.com/documentation/unreal-engine/iris-prioritization-in-unreal-engine) · [Migrate to Iris](https://dev.epicgames.com/documentation/unreal-engine/migrate-to-iris-in-unreal-engine)
- Lethal Company: [GamesRadar (developer's quote on latency for non-hosts)](https://www.gamesradar.com/games/after-4-months-without-an-update-lethal-company-is-back-in-business-after-its-creator-was-inspired-by-playing-steam-competitor-repo/) · [list of shipped files including the NGO + Facepunch transport](https://www.advanceduninstaller.com/Lethal-Company-dc631c712e06f0c9f0f2575d05def46d-application.htm) *(secondary, inferred)*
- Among Us: [Impostor server configuration (host-authority setting)](https://qingfengtechnology.github.io/ImpostorDocs/Server/ServerConfiguration) *(secondary)*
- Phasmophobia / Photon: [Photon forum thread on timeouts with 1,000+ networked objects](https://forum.photonengine.com/discussion/comment/53060) *(secondary)*
- Minecraft: [Java Edition 1.3.1 development versions (single-player becomes a local server)](https://minecraft.wiki/w/Java_Edition_1.3.1/Development_versions)
- WebTransport: [WebRTC.ventures: WebTransport is now Baseline](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/) *(secondary)* · [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/webtransport/)
- Cloudflare Durable Objects: [Durable Objects product page](https://www.cloudflare.com/products/durable-objects.md) · [game server tutorial](https://tech-insider.org/cloudflare-durable-objects-multiplayer-game-server-2026/) *(secondary)*
