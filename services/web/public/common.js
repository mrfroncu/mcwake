// Shared between index.html (public) i manage.html (za hasłem).

const ICON_ATTRS = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  check: `<svg ${ICON_ATTRS}><circle cx="10" cy="10" r="7.5"/><path d="M6.7 10.3l2.2 2.2L13.4 8"/></svg>`,
  x: `<svg ${ICON_ATTRS}><circle cx="10" cy="10" r="7.5"/><path d="M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4"/></svg>`,
  clock: `<svg ${ICON_ATTRS}><circle cx="10" cy="10" r="7.5"/><path d="M10 6v4.2l3 1.8"/></svg>`,
  activity: `<svg ${ICON_ATTRS}><path d="M2.5 10h3l1.8-5.5L10.5 15l1.8-5H17.5"/></svg>`,
  sliders: `<svg ${ICON_ATTRS}><path d="M4 5.5h12M4 10h12M4 14.5h12"/><circle cx="13" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="7" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14.5" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  grid: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="11" y="3" width="6" height="6" rx="1.2"/><rect x="3" y="11" width="6" height="6" rx="1.2"/><rect x="11" y="11" width="6" height="6" rx="1.2"/></svg>`,
  chart: `<svg ${ICON_ATTRS}><path d="M4 16.5V9M10 16.5V3.5M16 16.5v-6"/></svg>`,
  shield: `<svg ${ICON_ATTRS}><path d="M10 2.2l6 2.3v4.7c0 4-2.6 6.6-6 7.6-3.4-1-6-3.6-6-7.6V4.5l6-2.3z"/></svg>`,
  users: `<svg ${ICON_ATTRS}><circle cx="7.3" cy="7" r="2.6"/><path d="M2.3 16c0-2.8 2.1-4.6 5-4.6s5 1.8 5 4.6"/><circle cx="14.7" cy="7.6" r="2"/><path d="M12.6 11.8c2 .2 3.9 1.7 3.9 4.2"/></svg>`,
  list: `<svg ${ICON_ATTRS}><path d="M7 5.2h10.5M7 10h10.5M7 14.8h10.5"/><circle cx="2.7" cy="5.2" r="1" fill="currentColor" stroke="none"/><circle cx="2.7" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="2.7" cy="14.8" r="1" fill="currentColor" stroke="none"/></svg>`,
  terminal: `<svg ${ICON_ATTRS}><rect x="2.3" y="3.5" width="15.4" height="13" rx="1.8"/><path d="M6 8l2.6 2L6 12M11 12h3.3"/></svg>`,
  power: `<svg ${ICON_ATTRS}><path d="M10 3v6.2"/><path d="M6 5.6a6.2 6.2 0 1 0 8 0"/></svg>`,
  settings: `<svg ${ICON_ATTRS}><circle cx="10" cy="10" r="2.6"/><path d="M10 3.3v2.3M10 14.4v2.3M16.7 10h-2.3M5.6 10H3.3M14.9 5.1l-1.6 1.6M6.7 13.3l-1.6 1.6M14.9 14.9l-1.6-1.6M6.7 6.7L5.1 5.1"/></svg>`,
};

function icon(name, cls) {
  return `<span class="icon${cls ? " " + cls : ""}">${ICONS[name] || ""}</span>`;
}

/** Wstrzykuje ikony do <h2 data-icon="..."> w nagłówkach kart, i klasę akcentu do rodzica .card. */
function applyCardIcons() {
  document.querySelectorAll(".card h2[data-icon]").forEach((h2) => {
    const name = h2.dataset.icon;
    h2.insertAdjacentHTML("afterbegin", icon(name));
    const card = h2.closest(".card");
    if (card) card.classList.add(`accent-${name}`);
  });
}

function statusIcon(state) {
  if (state === "good") return icon("check", "i-good");
  if (state === "critical") return icon("x", "i-critical");
  return icon("clock", "i-loading");
}

// key = pole w odpowiedzi /components (camelCase), slug = segment URL w /healthz/:slug (kebab-case)
const COMPONENTS = [
  { key: "web", slug: "web", label: "Panel webowy" },
  { key: "orchestrator", slug: "orchestrator", label: "Orchestrator" },
  { key: "database", slug: "database", label: "Baza (SQLite)" },
  { key: "lazymc", slug: "lazymc", label: "lazymc" },
  { key: "idleReaper", slug: "idle-reaper", label: "Idle-reaper" },
  { key: "proxmox", slug: "proxmox", label: "Proxmox API" },
  { key: "pterodactyl", slug: "pterodactyl", label: "Pterodactyl API" },
  { key: "mcServer", slug: "mc-server", label: "Serwer Minecraft" },
];

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

/** Fetches `url` and calls onData(data) on success or onError() on any failure/non-2xx. */
function loadInto(url, onData, onError) {
  fetch(url)
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => (ok ? onData(data) : onError(data)))
    .catch(() => onError(null));
}

// --- Komponenty (health grid), każdy ładowany i renderowany niezależnie ---

function componentChipHtml(c) {
  return `
    <div class="component-chip" id="component-${c.key}">
      ${statusIcon("loading")}
      <span class="component-text">
        <span class="component-name">${escapeHtml(c.label)}</span>
        <span class="component-state">Sprawdzanie…</span>
      </span>
    </div>
  `;
}

function renderComponentsGrid(container) {
  container.innerHTML = COMPONENTS.map(componentChipHtml).join("");
  COMPONENTS.forEach((c) => {
    loadInto(
      `/healthz/${c.slug}`,
      (data) => updateComponentChip(c.key, true, data),
      (data) => updateComponentChip(c.key, false, data)
    );
  });
}

function updateComponentChip(key, healthy, data) {
  const el = document.getElementById(`component-${key}`);
  if (!el) return;
  const cls = healthy ? "good" : "critical";
  el.querySelector(".icon").outerHTML = statusIcon(cls);
  const stateEl = el.querySelector(".component-state");
  stateEl.className = `component-state ${cls}`;
  stateEl.textContent = healthy ? "Działa" : "Niedostępny";
  if (data && data.detail) el.title = String(data.detail);
}

// --- Bezczynność (jedna linia w karcie Komponenty — host/MC health są już
// pokazane jako osobne kafelki w tej samej karcie, nie trzeba ich duplikować) ---

function renderIdleLine(el, lastActivityAt) {
  el.textContent = "";
  el.innerHTML = `Bezczynność: <b>${formatDuration(Date.now() - lastActivityAt)}</b>`;
}

function renderMaintenanceBanner(el, active) {
  if (!el) return;
  if (!active) {
    el.textContent = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  el.textContent =
    "🛠 Tryb przerwy technicznej jest włączony — serwer nie wystartuje, dopóki nie zostanie wyłączony w karcie Zarządzanie.";
}

// Public page only fetches /api/activity for these two small bits — manage.js
// does its own richer fetch (players/events/cooldown too) and calls
// renderIdleLine/renderMaintenanceBanner directly from there instead.
function loadIdleLine(el, maintenanceBannerEl) {
  loadInto(
    "/api/activity",
    (data) => {
      renderIdleLine(el, data.lastActivityAt);
      renderMaintenanceBanner(maintenanceBannerEl, data.maintenanceMode);
    },
    () => {
      el.textContent = "";
    }
  );
}

// --- Statystyki uruchamiania/zamykania (paski faz) ---

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

  const detailHtml = phaseDefs
    .map((p) => {
      const v = session.phases[p.key];
      if (v === null || v === undefined) return "";
      return `<span>${escapeHtml(p.label)}: <b>${formatPhase(v)}</b></span>`;
    })
    .join("");

  return `
    <div class="session-row">
      <div class="session-meta">
        <span>${new Date(session.startedAt).toLocaleString("pl-PL")}</span>
        ${badge}
        <span class="session-total">razem: ${formatPhase(session.totalMs)}</span>
      </div>
      <div class="phase-bar">${segmentsHtml || emptyBar}</div>
      ${detailHtml ? `<div class="session-phase-detail">${detailHtml}</div>` : ""}
    </div>
  `;
}

function renderStatsInto(wakeListEl, shutdownListEl, cooldownEl, limit) {
  loadInto(
    `/api/stats?limit=${limit || 20}`,
    (data) => {
      wakeListEl.innerHTML = data.wake.length
        ? data.wake.map((s) => renderSession(s, WAKE_PHASES)).join("")
        : '<p class="stats-empty">Brak jeszcze żadnego uruchomienia.</p>';
      shutdownListEl.innerHTML = data.shutdown.length
        ? data.shutdown.map((s) => renderSession(s, SHUTDOWN_PHASES)).join("")
        : '<p class="stats-empty">Brak jeszcze żadnego pełnego zamknięcia.</p>';
    },
    () => {
      wakeListEl.innerHTML = '<p class="stats-empty">Błąd wczytywania.</p>';
      shutdownListEl.innerHTML = '<p class="stats-empty">Błąd wczytywania.</p>';
    }
  );

  if (cooldownEl) {
    loadInto(
      "/api/activity",
      (data) => renderCooldown(cooldownEl, data.tapoCooldown),
      () => {
        cooldownEl.textContent = "";
      }
    );
  }
}

// Ticks down live (every 1s) instead of only updating on each ~10-20s poll,
// re-synced to the server's authoritative remainingMs on every real call.
const cooldownTimers = new WeakMap();

function renderCooldown(el, cooldown) {
  const existingTimer = cooldownTimers.get(el);
  if (existingTimer) clearInterval(existingTimer);

  if (!cooldown || !cooldown.active || cooldown.remainingMs <= 0) {
    el.textContent = "";
    el.style.display = "none";
    return;
  }

  el.style.display = "";
  let remainingMs = cooldown.remainingMs;
  const tick = () => {
    if (remainingMs <= 0) {
      el.textContent = "";
      el.style.display = "none";
      clearInterval(timer);
      cooldownTimers.delete(el);
      return;
    }
    el.textContent = `⏳ Cooldown gniazdka Tapo aktywny — jeszcze ${formatPhase(remainingMs)} zanim będzie można ponownie włączyć zasilanie.`;
    remainingMs -= 1000;
  };
  tick();
  const timer = setInterval(tick, 1000);
  cooldownTimers.set(el, timer);
}

function setupStatsTabs(root) {
  root.querySelectorAll(".stats-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".stats-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      root.querySelector('[data-panel="wake"]').style.display = tab === "wake" ? "" : "none";
      root.querySelector('[data-panel="shutdown"]').style.display = tab === "shutdown" ? "" : "none";
    });
  });
}
