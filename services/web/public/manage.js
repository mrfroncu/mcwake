function loadPolicy() {
  const el = document.getElementById("policy-grid");
  el.innerHTML = "<dt>Wczytywanie…</dt><dd></dd>";
  loadInto(
    "/api/manage/policy",
    (p) => {
      const modelRow = p.sleepTriggersFullShutdown
        ? "<div><dt>Model bezczynności</dt><dd>jednowarstwowy — sleep_after wyłącza cały host</dd></div>"
        : `<div><dt>Model bezczynności</dt><dd>dwuwarstwowy — idle-reaper ${p.idleReaperEnabled ? "aktywny" : "wyłączony"}</dd></div>`;
      el.innerHTML = `
        <div><dt>Publiczny port</dt><dd>${p.publicPort}</dd></div>
        <div><dt>Backend (Wings)</dt><dd>${escapeHtml(p.mcServerHost)}:${p.mcServerPort}</dd></div>
        <div><dt>lazymc usypia kontener po</dt><dd>${formatDuration(p.lazymcSleepAfterSeconds * 1000)} bezczynności</dd></div>
        ${modelRow}
        <div><dt>Limit oczekiwania na cold-boot</dt><dd>${formatDuration(p.hostBootTimeoutSeconds * 1000)}</dd></div>
      `;
    },
    () => {
      el.innerHTML = "<div><dt>Błąd</dt><dd>Nie udało się wczytać</dd></div>";
    }
  );
}

function loadActivity() {
  const playersBody = document.querySelector("#players-table tbody");
  const eventsBody = document.querySelector("#events-table tbody");
  playersBody.innerHTML = `<tr><td colspan="2">Wczytywanie…</td></tr>`;
  eventsBody.innerHTML = `<tr><td colspan="3">Wczytywanie…</td></tr>`;

  loadInto(
    "/api/activity",
    (data) => {
      playersBody.innerHTML =
        data.players
          .map(
            (pl) =>
              `<tr><td>${escapeHtml(pl.name)}</td><td>${new Date(pl.lastSeenAt).toLocaleString("pl-PL")}</td></tr>`
          )
          .join("") || `<tr><td colspan="2">Brak jeszcze żadnego gracza.</td></tr>`;

      eventsBody.innerHTML =
        data.recentEvents
          .map(
            (e) =>
              `<tr><td>${new Date(e.at).toLocaleString("pl-PL")}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.detail ?? "")}</td></tr>`
          )
          .join("") || `<tr><td colspan="3">Brak jeszcze żadnych zdarzeń.</td></tr>`;

      renderCooldown(document.getElementById("cooldown-banner"), data.tapoCooldown);
      renderIdleLine(document.getElementById("idle-line"), data.lastActivityAt);
      renderMaintenanceBanner(document.getElementById("maintenance-banner"), data.maintenanceMode);
      applyMaintenanceState(data.maintenanceMode);
    },
    () => {
      playersBody.innerHTML = `<tr><td colspan="2">Błąd wczytywania.</td></tr>`;
      eventsBody.innerHTML = `<tr><td colspan="3">Błąd wczytywania.</td></tr>`;
    }
  );
}

function loadLogs() {
  const orchEl = document.getElementById("log-orchestrator");
  const reaperEl = document.getElementById("log-idle-reaper");
  const tapoEl = document.getElementById("log-tapo");
  orchEl.textContent = "Wczytywanie…";
  reaperEl.textContent = "Wczytywanie…";
  tapoEl.textContent = "Wczytywanie…";
  loadInto(
    "/api/manage/logs",
    (data) => {
      orchEl.textContent = (data.orchestrator ?? []).join("\n");
      reaperEl.textContent = (data.idleReaper ?? []).join("\n");
      tapoEl.textContent = (data.tapo ?? []).join("\n") || "Brak jeszcze żadnych zdarzeń.";
    },
    () => {
      orchEl.textContent = "Błąd wczytywania.";
      reaperEl.textContent = "Błąd wczytywania.";
      tapoEl.textContent = "Błąd wczytywania.";
    }
  );
}

applyCardIcons();
setupStatsTabs(document.getElementById("stats-section"));
initSettingsSection();

function setManageMsg(text) {
  document.getElementById("manage-msg").textContent = text;
}

function applyMaintenanceState(active) {
  const toggle = document.getElementById("maintenance-toggle");
  if (toggle && !toggle.dataset.pending) toggle.checked = active;
  document.getElementById("start-btn").disabled = active;
}

document.getElementById("maintenance-toggle").addEventListener("change", async (e) => {
  const checkbox = e.target;
  const enabled = checkbox.checked;
  const confirmed = confirm(
    enabled
      ? "To natychmiast zablokuje dołączanie i budzenie hosta, i zrestartuje lazymc (rozłączy aktualnie połączonych graczy). Kontynuować?"
      : "To wyłączy tryb przerwy technicznej i zrestartuje lazymc. Kontynuować?"
  );
  if (!confirmed) {
    checkbox.checked = !enabled;
    return;
  }
  checkbox.dataset.pending = "1";
  checkbox.disabled = true;
  setManageMsg(enabled ? "Włączanie trybu przerwy technicznej…" : "Wyłączanie trybu przerwy technicznej…");
  const res = await fetch("/api/manage/maintenance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const data = await res.json();
  setManageMsg(
    data.ok
      ? enabled
        ? "Tryb przerwy technicznej włączony."
        : "Tryb przerwy technicznej wyłączony."
      : `Błąd: ${data.error}`
  );
  if (!data.ok) checkbox.checked = !enabled;
  checkbox.disabled = false;
  delete checkbox.dataset.pending;
  loadActivity();
});

document.getElementById("start-btn").addEventListener("click", async () => {
  setManageMsg("Uruchamianie...");
  const res = await fetch("/api/manage/start", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer uruchomiony." : `Błąd: ${data.error}`);
  loadActivity();
  renderComponentsGrid(document.getElementById("components-grid"));
});

document.getElementById("stop-btn").addEventListener("click", async () => {
  setManageMsg("Usypianie...");
  const res = await fetch("/api/manage/stop", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer uśpiony." : `Błąd: ${data.error}`);
  loadActivity();
  renderComponentsGrid(document.getElementById("components-grid"));
});

document.getElementById("shutdown-host-btn").addEventListener("click", async () => {
  const confirmed = confirm(
    "To zatrzyma serwer Minecraft (zapisze świat) i wyłączy CAŁY fizyczny serwer (maszynę). Kontynuować?"
  );
  if (!confirmed) return;
  setManageMsg("Zatrzymywanie serwera i wyłączanie maszyny...");
  const res = await fetch("/api/manage/shutdown-host", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer wyłączony." : `Błąd: ${data.error}`);
  loadActivity();
  renderComponentsGrid(document.getElementById("components-grid"));
});

// Każda sekcja ładuje się i odświeża niezależnie — wolna/niedostępna
// odpowiedź jednej (np. Proxmoksa) nie blokuje pokazania reszty.
function refreshFast() {
  loadActivity();
}

function refreshSlow() {
  loadPolicy();
  renderComponentsGrid(document.getElementById("components-grid"));
  renderStatsInto(
    document.getElementById("stats-wake-list"),
    document.getElementById("stats-shutdown-list"),
    null,
    20
  );
  loadLogs();
}

refreshFast();
refreshSlow();
setInterval(refreshFast, 10000);
setInterval(refreshSlow, 20000);
