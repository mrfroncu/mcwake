#!/usr/bin/env python3
"""Bridge script for controlling a Tapo device/child socket.

Called by services/common/src/clients/tapo.ts via subprocess — see that
file and requirements.txt for why this exists as Python instead of native
TypeScript (TPAP protocol support isn't available in any JS library yet).
"""
import asyncio
import os
import sys

from kasa import Credentials, Discover


async def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("on", "off"):
        print("Usage: tapo_control.py <on|off>", file=sys.stderr)
        return 2

    action = sys.argv[1]
    email = os.environ["TAPO_EMAIL"]
    password = os.environ["TAPO_PASSWORD"]
    ip = os.environ["TAPO_DEVICE_IP"]
    child_name = os.environ.get("TAPO_CHILD_NAME", "").strip()

    dev = await Discover.discover_single(
        ip, credentials=Credentials(email, password), discovery_timeout=15
    )
    try:
        await dev.update()

        target = dev
        if child_name:
            match = next((c for c in dev.children if c.alias == child_name), None)
            if match is None:
                available = ", ".join(c.alias for c in dev.children) or "(none)"
                print(
                    f"No child socket named '{child_name}'. Available: {available}",
                    file=sys.stderr,
                )
                return 1
            target = match

        if action == "on":
            await target.turn_on()
        else:
            await target.turn_off()
        return 0
    finally:
        try:
            await dev.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
