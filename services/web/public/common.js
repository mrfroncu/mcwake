// Shared between index.html (public) and manage.html (za hasłem).

const STATE_LABELS = {
  running: "🟢 działa",
  starting: "🟡 uruchamia się",
  stopping: "🟡 zatrzymuje się",
  offline: "⚪ zatrzymany",
  unknown: "❓ nieznany",
};

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
      <span class="status-dot loading"></span>
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
  el.querySelector(".status-dot").className = `status-dot ${cls}`;
  const stateEl = el.querySelector(".component-state");
  stateEl.className = `component-state ${cls}`;
  stateEl.textContent = healthy ? "Działa" : "Niedostępny";
  if (data && data.detail) el.title = String(data.detail);
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

function renderCooldown(el, cooldown) {
  if (!cooldown || !cooldown.active) {
    el.textContent = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  el.textContent = `⏳ Cooldown gniazdka Tapo aktywny — jeszcze ${formatPhase(cooldown.remainingMs)} zanim będzie można ponownie włączyć zasilanie.`;
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
