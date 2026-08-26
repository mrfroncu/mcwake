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
    <dt>Host/serwer</dt><dd>${data.hostUp ? "🟢 włączony" : "⚪ wyłączony"}</dd>
    <dt>Serwer Minecraft</dt><dd>${STATE_LABELS[data.mcState] ?? escapeHtml(data.mcState)}</dd>
    <dt>Bezczynność</dt><dd>${formatDuration(idleMs)}</dd>
  `;
}

refresh();
setInterval(refresh, 10000);
