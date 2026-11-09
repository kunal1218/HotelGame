export function createNetHud() {
  const element = document.createElement("pre");
  element.className = "net-hud hidden";
  element.setAttribute("aria-label", "Network statistics");
  document.body.append(element);
  const toggle = (event) => {
    if (
      event.code === "Backquote" &&
      !["INPUT", "TEXTAREA"].includes(event.target.tagName)
    )
      element.classList.toggle("hidden");
  };
  addEventListener("keydown", toggle);
  return {
    update(stats, offline) {
      element.textContent = `${offline ? "OFFLINE" : "ROOM " + stats.room}\nRTT ${stats.rttMs.toFixed(0)} ms  jitter ${stats.jitterMs.toFixed(0)} ms\nDelay ${stats.delayMs.toFixed(0)} ms  buffer ${stats.bufferedMs.toFixed(0)} ms\nSnapshots ${stats.snapHz.toFixed(0)}/s  tick ${stats.serverTick}\nIn ${(stats.inBps / 1024).toFixed(1)} KB/s  out ${(stats.outBps / 1024).toFixed(1)} KB/s\nCorrections/min ${stats.correctionsPerMinute}  overlaps ${stats.overlaps}`;
    },
    dispose() {
      removeEventListener("keydown", toggle);
      element.remove();
    },
  };
}
