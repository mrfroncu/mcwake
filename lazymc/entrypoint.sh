#!/bin/sh
set -eu

: "${PUBLIC_PORT:=25565}"
: "${PUBLIC_MOTD_VERSION:=1.20.4}"
: "${PUBLIC_MOTD_PROTOCOL:=765}"
: "${MC_SERVER_PORT:=25565}"
: "${LAZYMC_START_TIMEOUT_SECONDS:=900}"
: "${LAZYMC_STOP_TIMEOUT_SECONDS:=180}"
: "${LAZYMC_SLEEP_AFTER_SECONDS:=1800}"
: "${LAZYMC_FORGE:=false}"
: "${LAZYMC_MOTD_SLEEPING:=☠ Serwer śpi z powodu bezczynności\n§2☻ Dołącz, aby go uruchomić}"
: "${LAZYMC_MOTD_STARTING:=§2☻ Serwer się uruchamia...\n§7⌛ To może potrwać do 10 minut}"
: "${LAZYMC_MOTD_STOPPING:=☠ Serwer usypia...\n⌛ Spróbuj ponownie za chwilę}"
: "${LAZYMC_KICK_STARTING_MESSAGE:=Serwer był wyłączony z powodu długiej nieaktywności.\n\nRozpoczęto uruchamianie — może to potrwać do 10 minut.\n\nSpróbuj dołączyć ponownie za chwilę.}"
: "${LAZYMC_KICK_STOPPING_MESSAGE:=Serwer usypia po okresie bezczynności.\n\nSpróbuj dołączyć ponownie za chwilę, aby go zbudzić.}"
: "${MC_SERVER_HOST:?MC_SERVER_HOST must be set}"

export PUBLIC_PORT PUBLIC_MOTD_VERSION PUBLIC_MOTD_PROTOCOL MC_SERVER_HOST MC_SERVER_PORT \
  LAZYMC_START_TIMEOUT_SECONDS LAZYMC_STOP_TIMEOUT_SECONDS LAZYMC_SLEEP_AFTER_SECONDS LAZYMC_FORGE \
  LAZYMC_MOTD_SLEEPING LAZYMC_MOTD_STARTING LAZYMC_MOTD_STOPPING \
  LAZYMC_KICK_STARTING_MESSAGE LAZYMC_KICK_STOPPING_MESSAGE

mkdir -p /lazymc/serverdir
envsubst < /lazymc/lazymc.toml.template > /lazymc/lazymc.toml

exec lazymc --config /lazymc/lazymc.toml start
