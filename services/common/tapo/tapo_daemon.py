#!/usr/bin/env python3
"""Long-lived Tapo control daemon.

TPAP uses a SPAKE2+/ECDSA handshake (elliptic curve), far heavier than the
plain MD5/SHA1 hashing KLAP uses — expensive for the P300's modest
microcontroller. Doing a full handshake on every single on/off command (as
a stateless CLI invocation would) can make the device stop responding to
discovery for a while. So instead: connect once, keep the session alive,
and only reconnect on error or once the session gets old.

Exposes a tiny localhost-only HTTP API for tapo.ts to call, instead of
spawning a fresh Python process (and fresh handshake) per action.
"""
import asyncio
import os
import time
from datetime import datetime, timezone

from aiohttp import web
from kasa import Credentials, Discover

RECONNECT_INTERVAL_SECONDS = 24 * 60 * 60  # refresh the session once a day

# Same "[ISO ts] [LEVEL] message" line format as the Node logger, appended to
# a file under the shared /data volume — so the orchestrator's existing
# logger.readTail() can show this in the panel with zero TS-side changes.
LOG_FILE = os.environ.get("TAPO_LOG_FILE", "/data/logs/tapo.log")
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)


def log(level: str, message: str) -> None:
    line = f"[{datetime.now(timezone.utc).isoformat(timespec='milliseconds')}] [{level.upper()}] {message}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


class TapoDaemon:
    def __init__(self) -> None:
        self.email = os.environ["TAPO_EMAIL"]
        self.password = os.environ["TAPO_PASSWORD"]
        self.ip = os.environ["TAPO_DEVICE_IP"]
        self.child_name = os.environ.get("TAPO_CHILD_NAME", "").strip()
        self.child_position = os.environ.get("TAPO_CHILD_POSITION", "").strip()
        self.dev = None
        self.connected_at = 0.0
        self.lock = asyncio.Lock()

    async def _connect(self) -> None:
        if self.dev is not None:
            try:
                await self.dev.disconnect()
            except Exception:
                pass
        log("info", f"connecting to Tapo device {self.ip}...")
        self.dev = await Discover.discover_single(
            self.ip,
            credentials=Credentials(self.email, self.password),
            discovery_timeout=15,
        )
        await self.dev.update()
        self.connected_at = time.time()
        log("info", f"connected to Tapo device {self.ip} ({getattr(self.dev, 'alias', '?')})")

    async def ensure_connected(self) -> None:
        async with self.lock:
            stale = time.time() - self.connected_at > RECONNECT_INTERVAL_SECONDS
            if self.dev is None or stale:
                await self._connect()

    def resolve_target(self):
        if not self.child_name and not self.child_position:
            return self.dev

        children = list(self.dev.children)

        if self.child_position:
            index = int(self.child_position) - 1  # "Plug 2" -> children[1]
            if 0 <= index < len(children):
                return children[index]
            raise ValueError(f"No child at position {self.child_position} (strip has {len(children)})")

        match = next((c for c in children if c.alias == self.child_name), None)
        if match is None:
            available = ", ".join(c.alias for c in children) or "(none)"
            raise ValueError(f"No child named '{self.child_name}'. Available: {available}")
        return match

    async def set_power(self, on: bool) -> None:
        action = "ON" if on else "OFF"
        await self.ensure_connected()
        try:
            target = self.resolve_target()
            await (target.turn_on() if on else target.turn_off())
            log("info", f"power {action} succeeded (child={self.child_position or self.child_name or '-'})")
        except Exception as e:
            # Session may have gone stale without us noticing — hard
            # reconnect once and retry before giving up.
            log("warn", f"power {action} failed on first try ({e}), reconnecting and retrying...")
            async with self.lock:
                self.dev = None
            await self.ensure_connected()
            target = self.resolve_target()
            await (target.turn_on() if on else target.turn_off())
            log("info", f"power {action} succeeded after reconnect (child={self.child_position or self.child_name or '-'})")


daemon = TapoDaemon()


async def handle_on(_request: web.Request) -> web.Response:
    log("info", "power ON requested")
    try:
        await daemon.set_power(True)
        return web.json_response({"ok": True})
    except Exception as e:
        log("error", f"power ON failed: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


async def handle_off(_request: web.Request) -> web.Response:
    log("info", "power OFF requested")
    try:
        await daemon.set_power(False)
        return web.json_response({"ok": True})
    except Exception as e:
        log("error", f"power OFF failed: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


async def handle_health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


def build_app() -> web.Application:
    app = web.Application()
    app.add_routes(
        [
            web.post("/on", handle_on),
            web.post("/off", handle_off),
            web.get("/health", handle_health),
        ]
    )
    return app


if __name__ == "__main__":
    port = int(os.environ.get("TAPO_DAEMON_PORT", "7101"))
    log("info", f"tapo daemon starting on :{port} (device={daemon.ip}, child={daemon.child_position or daemon.child_name or '-'})")
    web.run_app(build_app(), host="127.0.0.1", port=port, print=None)
