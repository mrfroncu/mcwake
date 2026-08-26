#!/bin/sh
set -e

# Only needed for the Tapo power strategy — skip entirely for WoL so we
# don't crash-loop on missing Tapo credentials when they're not in use.
if [ "${POWER_ON_STRATEGY:-wol}" = "tapo" ]; then
  (
    while true; do
      python3 /app/services/common/tapo/tapo_daemon.py
      echo "[entrypoint] tapo daemon exited, restarting in 5s" >&2
      sleep 5
    done
  ) &
fi

exec node services/orchestrator/dist/index.js
