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
  const res = await fetch("/api/status");
  if (!res.ok) return;
  const data = await res.json();

  const idleMs = Date.now() - data.lastActivityAt;
  document.getElementById("status-grid").innerHTML = `
    <dt>Komputer/host</dt><dd>${data.hostUp ? "🟢 włączony" : "⚪ wyłączony"}</dd>
    <dt>Serwer Minecraft</dt><dd>${STATE_LABELS[data.mcState] ?? escapeHtml(data.mcState)}</dd>
    <dt>Bezczynność</dt><dd>${formatDuration(idleMs)}</dd>
  `;

  document.querySelector("#players-table tbody").innerHTML = data.players
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.name)}</td><td>${new Date(p.lastSeenAt).toLocaleString("pl-PL")}</td></tr>`
    )
    .join("");

  document.querySelector("#events-table tbody").innerHTML = data.recentEvents
    .map(
      (e) =>
        `<tr><td>${new Date(e.at).toLocaleString("pl-PL")}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.detail ?? "")}</td></tr>`
    )
    .join("");
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

refresh();
setInterval(refresh, 10000);
