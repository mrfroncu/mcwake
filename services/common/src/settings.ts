import * as db from "./db.js";

export type SettingType = "string" | "number" | "boolean" | "enum" | "duration-seconds" | "multiline";

export interface SettingDef {
  key: string;
  label: string;
  description: string;
  group: "public" | "lazymc-behavior" | "lazymc-motd" | "power" | "sleep-model" | "idle-reaper";
  type: SettingType;
  fallback: string;
  options?: { value: string; label: string }[];
  /** Which container must restart before a change actually takes effect. */
  restartRequires?: "lazymc";
}

export const SETTINGS_CATALOG: SettingDef[] = [
  {
    key: "PUBLIC_MOTD_VERSION",
    label: "Wersja MC w MOTD",
    description:
      "Etykieta wersji Minecrafta pokazywana klientom na liście serwerów, zanim jeszcze połączą się z prawdziwym serwerem (np. w stanie uśpienia). Czysto kosmetyczne — nie wpływa na to, jaka wersja faktycznie działa.",
    group: "public",
    type: "string",
    fallback: "1.20.4",
    restartRequires: "lazymc",
  },
  {
    key: "PUBLIC_MOTD_PROTOCOL",
    label: "Numer protokołu MC w MOTD",
    description:
      "Numer protokołu sieciowego Minecrafta towarzyszący wersji powyżej. Musi odpowiadać realnej wersji serwera, inaczej niektórzy klienci pokażą komunikat o niezgodności wersji na liście serwerów.",
    group: "public",
    type: "number",
    fallback: "765",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_SLEEP_AFTER_SECONDS",
    label: "Uśpij po bezczynności",
    description:
      "Jak długo (od odejścia ostatniego gracza) lazymc czeka zanim uśpi serwer. W modelu jednowarstwowym (patrz niżej) to jest jedyny próg — po jego przekroczeniu gaśnie cały fizyczny serwer, nie tylko kontener Minecrafta.",
    group: "lazymc-behavior",
    type: "duration-seconds",
    fallback: "1800",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_FORGE",
    label: "Serwer typu Forge",
    description:
      "Włącz, jeśli prawdziwy serwer to modowany Forge/NeoForge (a nie czysty Vanilla/Paper). Forge dokleja do odpowiedzi ping dodatkowe dane (listę modów) w formacie, który lazymc musi wiedzieć jak zignorować.",
    group: "lazymc-behavior",
    type: "boolean",
    fallback: "false",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_MOTD_SLEEPING",
    label: "MOTD: serwer śpi",
    description:
      "Tekst na liście serwerów gracza, gdy serwer jest całkowicie uśpiony (nikt go nie budzi). Dosłowne \\n robi nową linię, kody koloru Minecrafta (§) działają.",
    group: "lazymc-motd",
    type: "multiline",
    fallback: "☠ Server is sleeping\\n§2☻ Join to start it up",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_MOTD_STARTING",
    label: "MOTD: serwer się budzi",
    description: "Tekst na liście serwerów w trakcie budzenia (host wstaje, kontener startuje, Minecraft się ładuje).",
    group: "lazymc-motd",
    type: "multiline",
    fallback: "§2☻ Server is starting...\\n§7⌛ Please wait...",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_MOTD_STOPPING",
    label: "MOTD: serwer usypia",
    description: "Tekst na liście serwerów, gdy serwer właśnie się usypia po okresie bezczynności.",
    group: "lazymc-motd",
    type: "multiline",
    fallback: "☠ Server going to sleep...\\n⌛ Please wait...",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_KICK_STARTING_MESSAGE",
    label: "Komunikat po dołączeniu: budzenie",
    description:
      "Gracz zobaczy ten tekst, jeśli spróbuje faktycznie dołączyć podczas budzenia — klient MC i tak zrywa połączenie po ~30s, więc zamiast czekać, od razu wyrzucamy z tym komunikatem.",
    group: "lazymc-motd",
    type: "multiline",
    fallback:
      "Server was sleeping due to inactivity.\\n\\nIt is now starting, this may take some time.\\n\\nPlease try to reconnect in a moment.",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_KICK_STOPPING_MESSAGE",
    label: "Komunikat po dołączeniu: usypianie",
    description: "Gracz zobaczy ten tekst, jeśli spróbuje dołączyć w trakcie usypiania serwera.",
    group: "lazymc-motd",
    type: "multiline",
    fallback: "Server is going to sleep due to inactivity.\\n\\nPlease try to reconnect in a moment to wake it up.",
    restartRequires: "lazymc",
  },
  {
    key: "LAZYMC_LOCKOUT_MESSAGE",
    label: "Komunikat: przerwa techniczna",
    description:
      "Tekst pokazywany każdemu, kto spróbuje dołączyć, gdy włączony jest tryb przerwy technicznej (przełącznik w karcie Zarządzanie). Nie da się w ten sposób przypadkowo obudzić serwera — to najwyższy priorytet, sprawdzany zanim cokolwiek innego (usypianie/budzenie) zdąży zadziałać.",
    group: "lazymc-motd",
    type: "multiline",
    fallback: "🛠 Serwer w trybie przerwy technicznej.\\n⌛ Spróbuj ponownie później.",
    restartRequires: "lazymc",
  },
  {
    key: "POWER_ON_STRATEGY",
    label: "Sposób budzenia fizycznego serwera",
    description:
      "Jak orchestrator włącza zasilanie hosta, gdy jest wyłączony. \"tapo\" korzysta z inteligentnej listwy Tapo P300, \"wol\" wysyła pakiet Wake-on-LAN (wymaga karty sieciowej ze sterownikiem wspierającym WoL w Linuksie).",
    group: "power",
    type: "enum",
    fallback: "wol",
    options: [
      { value: "tapo", label: "Tapo (listwa zasilająca)" },
      { value: "wol", label: "Wake-on-LAN" },
    ],
  },
  {
    key: "TAPO_POWER_OFF_COOLDOWN_SECONDS",
    label: "Cooldown gniazdka Tapo (sekundy)",
    description:
      "Dedyk nie budzi się niezawodnie, jeśli prąd był odcięty tylko na chwilę. Po każdym pełnym wyłączeniu orchestrator odczekuje tyle sekund minimum, zanim pozwoli ponownie włączyć zasilanie przez Tapo — licznik na żywo widać przy Statystykach.",
    group: "power",
    type: "number",
    fallback: "120",
  },
  {
    key: "SLEEP_TRIGGERS_FULL_SHUTDOWN",
    label: "Model jednowarstwowy",
    description:
      "Włączone: próg bezczynności lazymc (patrz \"Uśpij po bezczynności\" wyżej) od razu wyłącza CAŁY fizyczny serwer. Wyłączone: dwuwarstwowy model — lazymc usypia tylko kontener Minecrafta, a osobny idle-reaper (patrz niżej) wyłącza cały host dopiero po znacznie dłuższej ciszy. Uwaga: licznik lazymc żyje tylko w pamięci procesu i zeruje się przy KAŻDYM restarcie kontenera lazymc (nie tylko celowym) — nawet w tym trybie warto trzymać idle-reaper włączony z takim samym progiem jako niezależny, przeżywający restart backstop (patrz niżej).",
    group: "sleep-model",
    type: "boolean",
    fallback: "false",
  },
  {
    key: "IDLE_REAPER_ENABLED",
    label: "Idle-reaper włączony",
    description:
      "Niezależnie wyłącza cały host po długiej ciszy, licząc od trwałego (w SQLite, przeżywającego restart) znacznika ostatniej aktywności — nie od licznika lazymc, który żyje tylko w pamięci i zeruje się przy każdym jego restarcie. Wartościowe jako backstop nawet przy włączonym modelu jednowarstwowym powyżej — wtedy ustaw próg niżej na tę samą wartość co próg lazymc.",
    group: "idle-reaper",
    type: "boolean",
    fallback: "true",
  },
  {
    key: "IDLE_REAPER_THRESHOLD_MINUTES",
    label: "Próg bezczynności (minuty)",
    description:
      "Po ilu minutach całkowitej ciszy (od ostatniej realnej aktywności gracza, śledzonej niezależnie od lazymc) idle-reaper wyłącza cały host. W modelu jednowarstwowym ustaw na tę samą wartość co próg usypiania lazymc powyżej (w minutach zamiast sekund), żeby idle-reaper był wiarygodnym backstopem, nie osobnym, niezsynchronizowanym progiem.",
    group: "idle-reaper",
    type: "number",
    fallback: "10080",
  },
  {
    key: "IDLE_REAPER_POLL_INTERVAL_MINUTES",
    label: "Co ile sprawdzać (minuty)",
    description: "Jak często idle-reaper sprawdza, czy próg bezczynności został przekroczony.",
    group: "idle-reaper",
    type: "number",
    fallback: "30",
  },
];

export interface EffectiveSetting {
  def: SettingDef;
  value: string;
  source: "panel" | "env" | "default";
}

function resolveRaw(def: SettingDef): EffectiveSetting {
  const override = db.getSetting(def.key);
  if (override !== null) return { def, value: override, source: "panel" };
  const envValue = process.env[def.key];
  if (envValue !== undefined && envValue !== "") return { def, value: envValue, source: "env" };
  return { def, value: def.fallback, source: "default" };
}

export function getAllEffective(): EffectiveSetting[] {
  return SETTINGS_CATALOG.map(resolveRaw);
}

export function getEffective(key: string): EffectiveSetting {
  const def = SETTINGS_CATALOG.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  return resolveRaw(def);
}

export function getEffectiveString(key: string): string {
  return getEffective(key).value;
}

export function getEffectiveNumber(key: string): number {
  const raw = getEffective(key).value;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Setting ${key} is not a number: ${raw}`);
  return parsed;
}

export function getEffectiveBoolean(key: string): boolean {
  return getEffective(key).value === "true";
}

/** Validates `value` against its catalog entry's type, throws a descriptive Error if invalid. */
export function validate(def: SettingDef, value: string): void {
  switch (def.type) {
    case "number":
    case "duration-seconds":
      if (Number.isNaN(Number(value)) || value.trim() === "") {
        throw new Error(`${def.key} musi być liczbą`);
      }
      break;
    case "boolean":
      if (value !== "true" && value !== "false") {
        throw new Error(`${def.key} musi być "true" lub "false"`);
      }
      break;
    case "enum":
      if (!def.options?.some((o) => o.value === value)) {
        throw new Error(`${def.key} musi być jedną z: ${def.options?.map((o) => o.value).join(", ")}`);
      }
      break;
    case "string":
    case "multiline":
      break;
  }
}

export function setOverride(key: string, value: string): void {
  const def = SETTINGS_CATALOG.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  validate(def, value);
  db.setSetting(key, value);
}

export function clearOverride(key: string): void {
  if (!SETTINGS_CATALOG.some((d) => d.key === key)) throw new Error(`Unknown setting: ${key}`);
  db.deleteSetting(key);
}

/** Plain KEY=value lines (shell-sourceable) for lazymc's entrypoint.sh to fetch over HTTP. */
export function renderLazymcEnvFile(): string {
  const keys = [
    "PUBLIC_MOTD_VERSION",
    "PUBLIC_MOTD_PROTOCOL",
    "LAZYMC_SLEEP_AFTER_SECONDS",
    "LAZYMC_FORGE",
    "LAZYMC_MOTD_SLEEPING",
    "LAZYMC_MOTD_STARTING",
    "LAZYMC_MOTD_STOPPING",
    "LAZYMC_KICK_STARTING_MESSAGE",
    "LAZYMC_KICK_STOPPING_MESSAGE",
    "LAZYMC_LOCKOUT_MESSAGE",
  ];
  const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
  const lines = keys.map((key) => `${key}=${quote(getEffectiveString(key))}`);
  // DB-only, not part of the .env-backed catalog above — the maintenance
  // mode switch (Zarządzanie) sets this directly, always false unless
  // explicitly toggled on.
  lines.push(`LAZYMC_LOCKOUT_ENABLED=${quote(db.getSetting("LAZYMC_LOCKOUT_ENABLED") ?? "false")}`);
  return lines.join("\n");
}
