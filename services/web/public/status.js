function renderStatusGrid(el, data) {
  const idleMs = Date.now() - data.lastActivityAt;
  el.innerHTML = `
    <dt>Host/serwer</dt><dd>${data.hostUp ? "🟢 włączony" : "⚪ wyłączony"}</dd>
    <dt>Serwer Minecraft</dt><dd>${STATE_LABELS[data.mcState] ?? escapeHtml(data.mcState)}</dd>
    <dt>Bezczynność</dt><dd>${formatDuration(idleMs)}</dd>
  `;
}

function loadStatus() {
  const el = document.getElementById("status-grid");
  el.innerHTML = `
    <dt>Host/serwer</dt><dd>Sprawdzanie…</dd>
    <dt>Serwer Minecraft</dt><dd>Sprawdzanie…</dd>
    <dt>Bezczynność</dt><dd>Sprawdzanie…</dd>
  `;
  loadInto(
    "/api/status",
    (data) => renderStatusGrid(el, data),
    () => {
      el.innerHTML = "<dt>Błąd</dt><dd>Orchestrator niedostępny</dd>";
    }
  );
}

setupStatsTabs(document.getElementById("stats-section"));

function refreshAll() {
  loadStatus();
  renderStatsInto(
    document.getElementById("stats-wake-list"),
    document.getElementById("stats-shutdown-list"),
    document.getElementById("cooldown-banner"),
    20
  );
}

refreshAll();
setInterval(loadStatus, 10000);
setInterval(refreshAll, 30000);
