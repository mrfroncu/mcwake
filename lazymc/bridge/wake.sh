#!/bin/sh
# This is lazymc's `server.command`. lazymc treats it as "the server process":
# it starts this script when a player tries to join a sleeping server, and
# sends it SIGTERM when it decides to sleep the server again (sleep_after).
#
# All the actual WoL/Proxmox/Pterodactyl orchestration logic lives in the
# orchestrator service — this script just calls it over HTTP and stays alive
# in between, per docs/command-bash.md's trap-and-wait pattern.
set -eu

: "${ORCHESTRATOR_URL:=http://orchestrator:7100}"
: "${ORCHESTRATOR_INTERNAL_TOKEN:?ORCHESTRATOR_INTERNAL_TOKEN must be set}"
: "${LAZYMC_START_TIMEOUT_SECONDS:=900}"
: "${LAZYMC_STOP_TIMEOUT_SECONDS:=180}"

AUTH="Authorization: Bearer ${ORCHESTRATOR_INTERNAL_TOKEN}"
stopping=0

on_term() {
  stopping=1
}
trap on_term TERM INT

echo "[bridge] requesting wake..."
if ! curl -sf -X POST -H "$AUTH" --max-time "$LAZYMC_START_TIMEOUT_SECONDS" "${ORCHESTRATOR_URL}/wake"; then
  echo "[bridge] wake request failed" >&2
  exit 1
fi
echo "[bridge] server is up, holding until lazymc asks us to stop"

while [ "$stopping" -eq 0 ]; do
  sleep 1
done

echo "[bridge] stop requested, asking orchestrator to sleep the server..."
curl -sf -X POST -H "$AUTH" --max-time "$LAZYMC_STOP_TIMEOUT_SECONDS" "${ORCHESTRATOR_URL}/sleep" \
  || echo "[bridge] sleep request failed" >&2

echo "[bridge] done"
exit 0
