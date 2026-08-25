const STATE_LABELS = {
  running: "🟢 działa",
  starting: "🟡 uruchamia się",
  stopping: "🟡 zatrzymuje się",
  offline: "⚪ zatrzymany",
  unknown: "❓ nieznany",
};

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function formatDuration(ms) {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days} d ${hours} godz.`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours} godz. ${minutes} min`;
  return `${minutes} min`;
}

async function refresh() {
  const res = await fetch("/api/manage/overview");
  if (res.status === 401) {
    location.href = "/login.html";
    return;
  }
  if (!res.ok) return;
  const data = await res.json();

  const idleMs = Date.now() - data.lastActivityAt;
  document.getElementById("status-grid").innerHTML = `
    <dt>Komputer/host</dt><dd>${data.hostUp ? "🟢 włączony" : "⚪ wyłączony"}</dd>
    <dt>Serwer Minecraft</dt><dd>${STATE_LABELS[data.mcState] ?? escapeHtml(data.mcState)}</dd>
    <dt>Bezczynność</dt><dd>${formatDuration(idleMs)}</dd>
  `;

  const p = data.policy;
  const thresholdMs = p.idleReaperThresholdMinutes * 60_000;
  const reaperEta = p.idleReaperEnabled ? formatDuration(Math.max(0, thresholdMs - idleMs)) : "wyłączony";
  document.getElementById("policy-grid").innerHTML = `
    <dt>Publiczny port</dt><dd>${p.publicPort}</dd>
    <dt>Backend (Wings)</dt><dd>${escapeHtml(p.mcServerHost)}:${p.mcServerPort}</dd>
    <dt>lazymc usypia kontener po</dt><dd>${formatDuration(p.lazymcSleepAfterSeconds * 1000)} bezczynności</dd>
    <dt>Idle-reaper wyłączy hosta po</dt><dd>${p.idleReaperEnabled ? formatDuration(thresholdMs) : "—"}</dd>
    <dt>Do wyłączenia hosta zostało</dt><dd>${data.hostUp ? reaperEta : "host już wyłączony"}</dd>
    <dt>Limit oczekiwania na cold-boot</dt><dd>${formatDuration(p.hostBootTimeoutSeconds * 1000)}</dd>
  `;

  document.querySelector("#players-table tbody").innerHTML = data.players
    .map(
      (pl) =>
        `<tr><td>${escapeHtml(pl.name)}</td><td>${new Date(pl.lastSeenAt).toLocaleString("pl-PL")}</td></tr>`
    )
    .join("");

  document.querySelector("#events-table tbody").innerHTML = data.recentEvents
    .map(
      (e) =>
        `<tr><td>${new Date(e.at).toLocaleString("pl-PL")}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.detail ?? "")}</td></tr>`
    )
    .join("");

  document.getElementById("log-orchestrator").textContent = (data.logs?.orchestrator ?? []).join("\n");
  document.getElementById("log-idle-reaper").textContent = (data.logs?.idleReaper ?? []).join("\n");
}

function setManageMsg(text) {
  document.getElementById("manage-msg").textContent = text;
}

document.getElementById("start-btn").addEventListener("click", async () => {
  setManageMsg("Uruchamianie...");
  const res = await fetch("/api/manage/start", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer uruchomiony." : `Błąd: ${data.error}`);
  refresh();
});

document.getElementById("stop-btn").addEventListener("click", async () => {
  setManageMsg("Usypianie...");
  const res = await fetch("/api/manage/stop", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer uśpiony." : `Błąd: ${data.error}`);
  refresh();
});

document.getElementById("shutdown-host-btn").addEventListener("click", async () => {
  const confirmed = confirm(
    "To zatrzyma serwer Minecraft (zapisze świat) i wyłączy CAŁY fizyczny komputer przez Proxmox. Kontynuować?"
  );
  if (!confirmed) return;
  setManageMsg("Zatrzymywanie serwera i wyłączanie komputera...");
  const res = await fetch("/api/manage/shutdown-host", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Komputer wyłączony." : `Błąd: ${data.error}`);
  refresh();
});

refresh();
setInterval(refresh, 10000);
