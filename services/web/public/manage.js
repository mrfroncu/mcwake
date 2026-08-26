const STATE_LABELS = {
  running: "🟢 działa",
  starting: "🟡 uruchamia się",
  stopping: "🟡 zatrzymuje się",
  offline: "⚪ zatrzymany",
  unknown: "❓ nieznany",
};

const COMPONENT_LABELS = {
  web: "Panel webowy",
  orchestrator: "Orchestrator",
  database: "Baza (SQLite)",
  lazymc: "lazymc",
  idleReaper: "Idle-reaper",
  proxmox: "Proxmox API",
  pterodactyl: "Pterodactyl API",
  mcServer: "Serwer Minecraft",
};

const WAKE_PHASES = [
  { key: "requestToPowerOn", cls: "p1", label: "Zlecenie → zasilanie" },
  { key: "hostBoot", cls: "p2", label: "Boot hosta (Proxmox)" },
  { key: "wingsContainerStart", cls: "p3", label: "Start Wings/kontenera" },
  { key: "minecraftBoot", cls: "p4", label: "Start Minecrafta" },
];

const SHUTDOWN_PHASES = [
  { key: "mcStop", cls: "p1", label: "Zatrzymanie MC" },
  { key: "hostShutdown", cls: "p2", label: "Zamykanie hosta" },
  { key: "tapoPowerCut", cls: "p3", label: "Odcięcie zasilania" },
];

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

function formatPhase(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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
    <dt>Host/serwer</dt><dd>${data.hostUp ? "🟢 włączony" : "⚪ wyłączony"}</dd>
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

async function refreshComponents() {
  const res = await fetch("/api/manage/components");
  if (!res.ok) return;
  const components = await res.json();

  document.getElementById("components-grid").innerHTML = Object.entries(components)
    .map(([key, status]) => {
      const label = COMPONENT_LABELS[key] ?? key;
      const cls = status.healthy ? "good" : "critical";
      const stateText = status.healthy ? "Działa" : "Niedostępny";
      const title = status.detail ? escapeHtml(String(status.detail)) : "";
      return `
        <div class="component-chip" title="${title}">
          <span class="status-dot ${cls}"></span>
          <span class="component-text">
            <span class="component-name">${escapeHtml(label)}</span>
            <span class="component-state ${cls}">${stateText}</span>
          </span>
        </div>
      `;
    })
    .join("");
}

function renderSession(session, phaseDefs) {
  const values = phaseDefs.map((p) => session.phases[p.key]).filter((v) => v !== null && v !== undefined);
  const sum = values.reduce((a, b) => a + b, 0);

  const segmentsHtml = phaseDefs
    .map((p) => {
      const v = session.phases[p.key];
      if (v === null || v === undefined || sum === 0) return "";
      const pct = (v / sum) * 100;
      return `<div class="phase-segment ${p.cls}" style="width:${pct}%" title="${escapeHtml(p.label)}: ${formatPhase(v)}"></div>`;
    })
    .join("");

  let badge = "";
  if (session.skipped) {
    badge = '<span class="badge badge-skipped">pominięto (host już wyłączony)</span>';
  } else if (!session.completed) {
    badge = '<span class="badge badge-failed">niedokończona</span>';
  } else if (session.path) {
    badge =
      session.path === "fast"
        ? '<span class="badge badge-fast">szybka ścieżka</span>'
        : '<span class="badge badge-slow">pełne budzenie</span>';
  }

  const emptyBar = '<div class="phase-segment p1" style="width:100%;opacity:0.12"></div>';

  return `
    <div class="session-row">
      <div class="session-meta">
        <span>${new Date(session.startedAt).toLocaleString("pl-PL")}</span>
        ${badge}
        <span class="session-total">${formatPhase(session.totalMs)}</span>
      </div>
      <div class="phase-bar">${segmentsHtml || emptyBar}</div>
    </div>
  `;
}

async function refreshStats() {
  const res = await fetch("/api/manage/stats?limit=20");
  if (!res.ok) return;
  const data = await res.json();

  const wakeList = document.getElementById("stats-wake-list");
  wakeList.innerHTML = data.wake.length
    ? data.wake.map((s) => renderSession(s, WAKE_PHASES)).join("")
    : '<p class="stats-empty">Brak jeszcze żadnego uruchomienia.</p>';

  const shutdownList = document.getElementById("stats-shutdown-list");
  shutdownList.innerHTML = data.shutdown.length
    ? data.shutdown.map((s) => renderSession(s, SHUTDOWN_PHASES)).join("")
    : '<p class="stats-empty">Brak jeszcze żadnego pełnego zamknięcia.</p>';
}

document.querySelectorAll(".stats-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".stats-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById("stats-wake-panel").style.display = tab === "wake" ? "" : "none";
    document.getElementById("stats-shutdown-panel").style.display = tab === "shutdown" ? "" : "none";
  });
});

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
    "To zatrzyma serwer Minecraft (zapisze świat) i wyłączy CAŁY fizyczny serwer (maszynę). Kontynuować?"
  );
  if (!confirmed) return;
  setManageMsg("Zatrzymywanie serwera i wyłączanie maszyny...");
  const res = await fetch("/api/manage/shutdown-host", { method: "POST" });
  const data = await res.json();
  setManageMsg(data.ok ? "Serwer wyłączony." : `Błąd: ${data.error}`);
  refresh();
});

refresh();
refreshComponents();
refreshStats();
setInterval(refresh, 10000);
setInterval(refreshComponents, 20000);
setInterval(refreshStats, 30000);
