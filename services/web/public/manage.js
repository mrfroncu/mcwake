function loadStatus() {
  const el = document.getElementById("status-grid");
  el.innerHTML = `
    <dt>Host/serwer</dt><dd>Sprawdzanie…</dd>
    <dt>Serwer Minecraft</dt><dd>Sprawdzanie…</dd>
    <dt>Bezczynność</dt><dd>Sprawdzanie…</dd>
  `;
  loadInto(
    "/api/status",
    (data) => {
      const idleMs = Date.now() - data.lastActivityAt;
      el.innerHTML = `
        <dt>Host/serwer</dt><dd>${data.hostUp ? "🟢 włączony" : "⚪ wyłączony"}</dd>
        <dt>Serwer Minecraft</dt><dd>${STATE_LABELS[data.mcState] ?? escapeHtml(data.mcState)}</dd>
        <dt>Bezczynność</dt><dd>${formatDuration(idleMs)}</dd>
      `;
    },
    () => {
      el.innerHTML = "<dt>Błąd</dt><dd>Orchestrator niedostępny</dd>";
    }
  );
}

function loadPolicy() {
  const el = document.getElementById("policy-grid");
  el.innerHTML = "<dt>Wczytywanie…</dt><dd></dd>";
  loadInto(
    "/api/manage/policy",
    (p) => {
      const modelRow = p.sleepTriggersFullShutdown
        ? "<dt>Model bezczynności</dt><dd>jednowarstwowy — sleep_after wyłącza cały host</dd>"
        : `<dt>Model bezczynności</dt><dd>dwuwarstwowy — idle-reaper ${p.idleReaperEnabled ? "aktywny" : "wyłączony"}</dd>`;
      el.innerHTML = `
        <dt>Publiczny port</dt><dd>${p.publicPort}</dd>
        <dt>Backend (Wings)</dt><dd>${escapeHtml(p.mcServerHost)}:${p.mcServerPort}</dd>
        <dt>lazymc usypia kontener po</dt><dd>${formatDuration(p.lazymcSleepAfterSeconds * 1000)} bezczynności</dd>
        ${modelRow}
        <dt>Limit oczekiwania na cold-boot</dt><dd>${formatDuration(p.hostBootTimeoutSeconds * 1000)}</dd>
      `;
    },
    () => {
      el.innerHTML = "<dt>Błąd</dt><dd>Nie udało się wczytać</dd>";
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
  orchEl.textContent = "Wczytywanie…";
  reaperEl.textContent = "Wczytywanie…";
  loadInto(
    "/api/manage/logs",
    (data) => {
      orchEl.textContent = (data.orchestrator ?? []).join("\n");
      reaperEl.textContent = (data.idleReaper ?? []).join("\n");
    },
    () => {
      orchEl.textContent = "Błąd wczytywania.";
      reaperEl.textContent = "Błąd wczytywania.";
    }
  );
}

setupStatsTabs(document.getElementById("stats-section"));

function setManageMsg(text) {
  document.getElementById("manage-msg").textContent = text;
}

document.getElementById("start-btn").addEventListener("click", async () => {
  setManageMsg("Uruchamianie...");
  const res = await fetch("/api/manage/start", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer uruchomiony." : `Błąd: ${data.error}`);
  loadStatus();
  loadActivity();
});

document.getElementById("stop-btn").addEventListener("click", async () => {
  setManageMsg("Usypianie...");
  const res = await fetch("/api/manage/stop", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer uśpiony." : `Błąd: ${data.error}`);
  loadStatus();
  loadActivity();
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
  loadStatus();
  loadActivity();
});

// Każda sekcja ładuje się i odświeża niezależnie — wolna/niedostępna
// odpowiedź jednej (np. Proxmoksa) nie blokuje pokazania reszty.
function refreshFast() {
  loadStatus();
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
