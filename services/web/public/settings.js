// Konfiguracja: panel-editable overrides of .env values, stored in the
// orchestrator's SQLite DB (POST /api/manage/settings), falling back to
// .env when no override exists (GET /api/manage/settings). Manage-page only.

const SETTINGS_GROUP_LABELS = {
  public: "Publiczny MOTD",
  "lazymc-behavior": "Zachowanie lazymc",
  "lazymc-motd": "Wiadomości MOTD",
  power: "Zasilanie",
  "sleep-model": "Model bezczynności",
  "idle-reaper": "Idle-reaper",
};
const SETTINGS_GROUP_ORDER = ["public", "lazymc-behavior", "lazymc-motd", "power", "sleep-model", "idle-reaper"];

const SOURCE_BADGE = {
  panel: '<span class="badge badge-panel">nadpisane w panelu</span>',
  env: '<span class="badge badge-env">z .env</span>',
  default: '<span class="badge badge-default">wartość domyślna</span>',
};

let settingsData = [];

function secondsToDhm(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60) };
}

function dhmToSeconds(d, h, m) {
  return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(m) || 0) * 60;
}

function settingFieldHtml(s) {
  const id = `setting-${s.key}`;
  switch (s.type) {
    case "boolean":
      return `<label class="switch"><input type="checkbox" id="${id}" ${s.value === "true" ? "checked" : ""}><span></span></label>`;
    case "enum": {
      const opts = (s.options || [])
        .map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === s.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`)
        .join("");
      return `<select id="${id}">${opts}</select>`;
    }
    case "multiline":
      return `<textarea id="${id}" rows="2">${escapeHtml(s.value)}</textarea>`;
    case "duration-seconds": {
      const { d, h, m } = secondsToDhm(s.value);
      return `
        <div class="duration-input" id="${id}">
          <label><input type="number" min="0" class="dur-d" value="${d}"><span>dni</span></label>
          <label><input type="number" min="0" max="23" class="dur-h" value="${h}"><span>godz.</span></label>
          <label><input type="number" min="0" max="59" class="dur-m" value="${m}"><span>min</span></label>
        </div>
      `;
    }
    case "number":
      return `<input type="number" id="${id}" value="${escapeHtml(s.value)}">`;
    default:
      return `<input type="text" id="${id}" value="${escapeHtml(s.value)}">`;
  }
}

function readSettingValue(s) {
  if (s.type === "boolean") return document.getElementById(`setting-${s.key}`).checked ? "true" : "false";
  if (s.type === "duration-seconds") {
    const el = document.getElementById(`setting-${s.key}`);
    return String(
      dhmToSeconds(el.querySelector(".dur-d").value, el.querySelector(".dur-h").value, el.querySelector(".dur-m").value)
    );
  }
  return document.getElementById(`setting-${s.key}`).value;
}

function settingRowHtml(s) {
  const restart = s.restartRequires
    ? `<span class="setting-restart">wymaga restartu: ${escapeHtml(s.restartRequires)}</span>`
    : "";
  return `
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">${escapeHtml(s.label)} ${SOURCE_BADGE[s.source] || ""}</div>
        <div class="setting-desc">${escapeHtml(s.description)}</div>
        ${restart}
      </div>
      <div class="setting-control">
        ${settingFieldHtml(s)}
        <button type="button" class="setting-reset" data-key="${s.key}" ${s.source === "default" ? "disabled" : ""}>↺ domyślne</button>
      </div>
    </div>
  `;
}

function renderSettings(container, list) {
  settingsData = list;
  container.innerHTML = SETTINGS_GROUP_ORDER.filter((g) => list.some((s) => s.group === g))
    .map(
      (g) => `
        <div class="setting-group">
          <h3>${SETTINGS_GROUP_LABELS[g]}</h3>
          ${list.filter((s) => s.group === g).map(settingRowHtml).join("")}
        </div>
      `
    )
    .join("");
}

function loadSettings() {
  const container = document.getElementById("settings-form");
  loadInto(
    "/api/manage/settings",
    (data) => renderSettings(container, data),
    () => {
      container.innerHTML = '<p class="stats-empty">Błąd wczytywania.</p>';
    }
  );
}

async function saveSetting(key, value) {
  const res = await fetch("/api/manage/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  return res.json();
}

function initSettingsSection() {
  const form = document.getElementById("settings-form");
  if (!form) return;

  form.addEventListener("click", async (e) => {
    const btn = e.target.closest(".setting-reset");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    await saveSetting(btn.dataset.key, null);
    loadSettings();
    if (typeof loadPolicy === "function") loadPolicy();
  });

  document.getElementById("restart-lazymc-btn").addEventListener("click", async () => {
    const msg = document.getElementById("settings-msg");
    if (!confirm("To zrestartuje kontener lazymc i rozłączy aktualnie połączonych graczy. Kontynuować?")) return;
    msg.textContent = "Restartowanie lazymc…";
    const res = await fetch("/api/manage/restart/lazymc", { method: "POST" });
    const data = await res.json();
    msg.textContent = data.ok ? "lazymc zrestartowany." : `Błąd: ${data.error}`;
    if (data.ok) {
      loadSettings();
      if (typeof loadPolicy === "function") loadPolicy();
      if (typeof renderComponentsGrid === "function") renderComponentsGrid(document.getElementById("components-grid"));
    }
  });

  document.getElementById("settings-save-btn").addEventListener("click", async () => {
    const msg = document.getElementById("settings-msg");
    msg.textContent = "Zapisywanie…";
    for (const s of settingsData) {
      const newValue = readSettingValue(s);
      if (newValue === s.value) continue;
      const result = await saveSetting(s.key, newValue);
      if (!result.ok) {
        msg.textContent = `Błąd (${s.key}): ${result.error}`;
        return;
      }
    }
    msg.textContent = "Zapisano.";
    loadSettings();
    if (typeof loadPolicy === "function") loadPolicy();
  });

  loadSettings();
}
