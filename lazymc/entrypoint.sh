#!/bin/sh
set -eu

: "${PUBLIC_PORT:=25565}"
: "${MC_SERVER_PORT:=25565}"
: "${LAZYMC_START_TIMEOUT_SECONDS:=900}"
: "${LAZYMC_STOP_TIMEOUT_SECONDS:=180}"
: "${MC_SERVER_HOST:?MC_SERVER_HOST must be set}"

# The 9 settings below are panel-editable (management panel → Konfiguracja).
# The panel stores overrides in the orchestrator's SQLite DB, not in this
# container's own env — so fetch the *effective* values (panel override,
# falling back to .env) from the orchestrator at every start, instead of
# reading our own env directly. Retry a few times in case the orchestrator
# isn't ready yet even though depends_on ordered us after it.
CONFIG_FILE=/tmp/lazymc.settings.env
: > "$CONFIG_FILE"
if [ -n "${ORCHESTRATOR_URL:-}" ] && [ -n "${ORCHESTRATOR_INTERNAL_TOKEN:-}" ]; then
  attempt=0
  until curl -fsS -H "Authorization: Bearer ${ORCHESTRATOR_INTERNAL_TOKEN}" \
      "${ORCHESTRATOR_URL}/config/lazymc" -o "$CONFIG_FILE"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 10 ]; then
      echo "[entrypoint] could not reach orchestrator for config after $attempt tries, falling back to local .env" >&2
      : > "$CONFIG_FILE"
      break
    fi
    sleep 3
  done
fi
set -a
. "$CONFIG_FILE"
set +a

# Local .env fallbacks — only used for whatever the orchestrator fetch above
# didn't set (i.e. orchestrator was unreachable), so this container can still
# boot standalone.
: "${PUBLIC_MOTD_VERSION:=1.20.4}"
: "${PUBLIC_MOTD_PROTOCOL:=765}"
: "${LAZYMC_SLEEP_AFTER_SECONDS:=1800}"
: "${LAZYMC_FORGE:=false}"
: "${LAZYMC_MOTD_SLEEPING:=☠ Serwer śpi z powodu bezczynności\n§2☻ Dołącz, aby go uruchomić}"
: "${LAZYMC_MOTD_STARTING:=§2☻ Serwer się uruchamia...\n§7⌛ To może potrwać do 10 minut}"
: "${LAZYMC_MOTD_STOPPING:=☠ Serwer usypia...\n⌛ Spróbuj ponownie za chwilę}"
: "${LAZYMC_KICK_STARTING_MESSAGE:=Serwer był wyłączony z powodu długiej nieaktywności.\n\nRozpoczęto uruchamianie — może to potrwać do 10 minut.\n\nSpróbuj dołączyć ponownie za chwilę.}"
: "${LAZYMC_KICK_STOPPING_MESSAGE:=Serwer usypia po okresie bezczynności.\n\nSpróbuj dołączyć ponownie za chwilę, aby go zbudzić.}"
: "${LAZYMC_LOCKOUT_ENABLED:=false}"
: "${LAZYMC_LOCKOUT_MESSAGE:=🛠 Serwer w trybie przerwy technicznej.\n⌛ Spróbuj ponownie później.}"

export PUBLIC_PORT PUBLIC_MOTD_VERSION PUBLIC_MOTD_PROTOCOL MC_SERVER_HOST MC_SERVER_PORT \
  LAZYMC_START_TIMEOUT_SECONDS LAZYMC_STOP_TIMEOUT_SECONDS LAZYMC_SLEEP_AFTER_SECONDS LAZYMC_FORGE \
  LAZYMC_MOTD_SLEEPING LAZYMC_MOTD_STARTING LAZYMC_MOTD_STOPPING \
  LAZYMC_KICK_STARTING_MESSAGE LAZYMC_KICK_STOPPING_MESSAGE \
  LAZYMC_LOCKOUT_ENABLED LAZYMC_LOCKOUT_MESSAGE

mkdir -p /lazymc/serverdir
envsubst < /lazymc/lazymc.toml.template > /lazymc/lazymc.toml

exec lazymc --config /lazymc/lazymc.toml start
