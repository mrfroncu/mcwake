applyCardIcons();
setupStatsTabs(document.getElementById("stats-section"));

function refreshFast() {
  loadIdleLine(document.getElementById("idle-line"), document.getElementById("maintenance-banner"));
}

function refreshSlow() {
  renderComponentsGrid(document.getElementById("components-grid"));
  renderStatsInto(
    document.getElementById("stats-wake-list"),
    document.getElementById("stats-shutdown-list"),
    document.getElementById("cooldown-banner"),
    20
  );
}

refreshFast();
refreshSlow();
setInterval(refreshFast, 10000);
setInterval(refreshSlow, 20000);
