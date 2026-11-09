import { createNetClient } from "./netClient.js";
import { connectWebSocket, serverUrl } from "./wsConnect.js";
import { createLocalSession } from "./localSession.js";
import { createNetHud } from "./netHud.js";
import { createRemoteEntities } from "../remoteEntities.js";
import { withConditions, PRESETS } from "../shared/net/conditioner.js";
import { validCode } from "../shared/net/protocol.js";
import { Kind, PlayerStatus } from "../shared/sim/entities.js";
export function createSessionUi({ engine, lobby, onJoined, onLeft, toast }) {
  const $ = (id) => document.getElementById(id),
    nowMs = () => performance.now();
  const params = new URLSearchParams(location.search),
    preset = params.get("net") ?? "lan";
  const hud = createNetHud(),
    remote = createRemoteEntities(engine.scene);
  let client = null,
    local = null,
    offline = false,
    attempt = 0,
    lastAction = "create",
    failed = false;
  function busy(value) {
    for (const id of [
      "create-room",
      "join-room",
      "solo-button",
      "join-submit",
      "player-name",
    ])
      $(id).disabled = value;
  }
  function message(text) {
    $("connection-status").textContent = text;
  }
  function teardown() {
    attempt++;
    client?.close();
    client = null;
    local?.close();
    local = null;
    remote.clear();
    engine.controller.onTick = null;
    engine.controller.runWhileInactive = false;
    engine.controller.motion.setObstacles([], 0);
  }
  function left() {
    teardown();
    onLeft();
    busy(false);
    message("");
    $("retry-button").classList.add("hidden");
    $("solo-button").textContent = "Explore alone";
    failed = false;
  }
  async function begin(action, forceOffline = false) {
    const name = $("player-name").value.trim() || "Guest",
      room =
        action === "join" ? $("room-code").value.trim().toUpperCase() : null;
    if (!/^[\p{L}\p{N} _-]{1,16}$/u.test(name)) {
      message("Use 1–16 letters, numbers, spaces, _ or - for your name.");
      return;
    }
    if (action === "join" && !validCode(room)) {
      message("Enter a four-letter room code.");
      $("join-form").classList.remove("hidden");
      return;
    }
    teardown();
    const current = attempt;
    let hasJoined = false;
    lastAction = action;
    offline = forceOffline;
    busy(true);
    message(offline ? "Opening offline hotel…" : "Connecting to the hotel…");
    $("retry-button").classList.add("hidden");
    try {
      localStorage.setItem("hotel-name", name);
    } catch {}
    try {
      if (offline) local = createLocalSession({ nowMs, preset });
      const open = offline
        ? () => local.open()
        : () =>
            withConditions(
              connectWebSocket(
                serverUrl(location, import.meta.env.VITE_SERVER_URL),
              ),
              { ...(PRESETS[preset] ?? PRESETS.lan), nowMs },
            );
      client = createNetClient({ open, nowMs, name, room });
      client.onStatus((status) => {
        if (current !== attempt) return;
        if (status === "joined") {
          hasJoined = true;
          busy(false);
          failed = false;
          message("");
          $("room-label").textContent = offline
            ? "Offline: friends can't join"
            : `Room ${client.self().room}`;
          $("invite-button").classList.toggle("hidden", offline);
          $("session-status").textContent = offline
            ? "Offline: friends can't join"
            : `Room ${client.self().room}`;
          const frame = client.frame(nowMs());
          if (frame.selfJump) engine.controller.teleport(frame.selfJump);
          engine.controller.onTick = (state, input) =>
            client?.recordMotion(input, state.x, state.z);
          engine.controller.runWhileInactive = true;
          onJoined();
          if (offline) toast("Offline: friends can't join");
        } else if (status === "closed") {
          const reason = client.reason();
          if (
            action === "solo" &&
            !hasJoined &&
            !offline &&
            !failed &&
            reason !== "Left room" &&
            /reach|closed|timed out/i.test(reason)
          ) {
            failed = true;
            begin("solo", true);
            return;
          }
          teardown();
          onLeft();
          busy(false);
          failed = true;
          message(reason || "Can't reach the hotel");
          $("retry-button").classList.remove("hidden");
          $("solo-button").textContent = "Explore alone (offline)";
        }
      });
    } catch (error) {
      teardown();
      busy(false);
      failed = true;
      message(error.message || "Can't reach the hotel");
      $("retry-button").classList.remove("hidden");
      $("solo-button").textContent = "Explore alone (offline)";
    }
  }
  try {
    $("player-name").value = localStorage.getItem("hotel-name") || "Guest";
  } catch {
    $("player-name").value = "Guest";
  }
  $("create-room").addEventListener("click", () => begin("create"));
  $("join-room").addEventListener("click", () => {
    $("join-form").classList.remove("hidden");
    $("room-code").focus();
  });
  $("join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    begin("join");
  });
  $("room-code").addEventListener("input", () => {
    $("room-code").value = $("room-code").value.toUpperCase();
  });
  $("solo-button").addEventListener("click", () => begin("solo", failed));
  $("retry-button").addEventListener("click", () => begin(lastAction));
  $("leave-button").addEventListener("click", left);
  $("invite-button").addEventListener("click", async () => {
    if (!client?.self() || offline) return;
    const link = new URL(location.href);
    link.searchParams.set("room", client.self().room);
    link.searchParams.delete("net");
    try {
      await navigator.clipboard.writeText(link.href);
      toast("Invite link copied.");
    } catch {
      toast(`Share room code ${client.self().room}`);
    }
  });
  const initialRoom = params.get("room");
  if (initialRoom) {
    $("room-code").value = initialRoom.toUpperCase();
    $("join-form").classList.remove("hidden");
    begin("join");
  }
  return {
    request: (action, target) =>
      client?.request(action, target) ??
      Promise.resolve({ ok: false, reason: "disconnected" }),
    frame() {
      if (!client) return;
      const frame = client.frame(nowMs()),
        self = client.self();
      if (frame.selfJump) engine.controller.teleport(frame.selfJump);
      remote.update(frame.entities, self, engine.camera);
      const obstacles = [...frame.entities.values()]
        .filter(
          (e) =>
            e.kind === Kind.PLAYER &&
            e.id !== self?.entity &&
            e.fields.lvl === 0 &&
            [PlayerStatus.ACTIVE, PlayerStatus.AFK].includes(e.fields.st),
        )
        .map((e) => ({ id: e.id, x: e.fields.x, z: e.fields.z, r: 0.32 }));
      engine.controller.motion.setObstacles(obstacles, self?.entity ?? 0);
      const fire = frame.entities.get(1),
        elevator = frame.entities.get(2);
      if (fire && elevator)
        lobby.setSharedState({
          fireOn: fire.fields.state,
          elevatorOpen: elevator.fields.state,
        });
      hud.update(client.stats(), offline);
    },
    dispose() {
      teardown();
      hud.dispose();
      remote.dispose();
    },
  };
}
