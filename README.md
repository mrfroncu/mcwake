# mcwake

Budzi cały fizyczny serwer (Wake-on-LAN → Proxmox → Pterodactyl/Wings) gdy
ktoś próbuje dołączyć do śpiącego serwera Minecraft, i usypia go z powrotem
po długim okresie bez graczy — żeby dedyk z 32GB RAM nie stał włączony 24/7
między sesjami znajomych.

Oparte na [lazymc](https://github.com/timvisee/lazymc) jako proxy/MOTD —
lazymc jest używane bez żadnych modyfikacji źródła, tylko przez konfigurację
i zewnętrzny skrypt (`lazymc/bridge/wake.sh`) pełniący rolę `server.command`.

## Architektura

```
gracz → [VPS: lazymc :25565] → [VPS: orchestrator] → WoL / Proxmox / Pterodactyl → [dedyk]
                              ↘ [VPS: idle-reaper]  (7 dni ciszy → shutdown hosta)
                              ↘ [VPS: web panel]    (status, zarządzanie, logi)
```

- **lazymc** — proxy z MOTD, jedyna rzecz widoczna dla graczy. Gdy ktoś
  dołącza do śpiącego serwera, uruchamia `bridge/wake.sh` (skonfigurowane
  jako `server.command`), które woła orchestrator przez HTTP i czeka.
- **orchestrator** — cała logika: sprawdza czy host już żyje (szybka ścieżka
  vs. pełne budzenie), wysyła WoL, odpytuje Proxmox/Pterodactyl API,
  wystawia `/status` dla panelu.
- **idle-reaper** — niezależny, wolny licznik: co
  `IDLE_REAPER_POLL_INTERVAL_MINUTES` sprawdza, czy minęło
  `IDLE_REAPER_THRESHOLD_DAYS` od ostatniej aktywności — jeśli tak, każe
  orchestratorowi wyłączyć cały host przez Proxmox.
- **web** — panel pod hasłem: status, gracze, historia zdarzeń, ręczny
  start/stop.

Dwie niezależne warstwy bezczynności:
1. **lazymc `sleep_after`** (domyślnie 30 min) — usypia tylko kontener MC w
   Pterodactylu. Host zostaje włączony, więc powrót tego samego dnia to
   sekundy, nie 10 minut.
2. **idle-reaper** (domyślnie 7 dni) — dopiero to wyłącza cały fizyczny
   komputer przez Proxmox.

## Wymagania sieciowe (do ustawienia przed testami)

- Tunel (np. WireGuard) między VPS-em a siecią domową — `MC_SERVER_HOST`,
  `PROXMOX_HOST` i `WOL_TARGET_ADDRESS` muszą być osiągalne z kontenerów na
  VPS-ie.
- WoL włączony w BIOS/UEFI i w systemie na docelowej maszynie.
- Karta sieciowa hosta musi mieć zasilanie standby (S5/soft-off) — jeśli
  kiedyś przejdziecie na wtyczkę Tapo do twardego odcięcia prądu, WoL
  przestanie działać i trzeba użyć "Restore on AC Power Loss" w BIOS zamiast
  magic packetu (`services/common/src/clients/tapo.ts` ma notatkę o tym).
- Pterodactyl Client API key (nie Application API key).
- Proxmox API token (Datacenter → Permissions → API Tokens).

## Setup

```bash
cp .env.example .env
# uzupełnij .env — MAC adres, adresy IP, klucze API Pterodactyl/Proxmox, hasła

docker compose up -d --build
docker compose logs -f
```

Panel webowy: `http://<vps>:${WEB_PORT}` (domyślnie 8080), hasło z
`WEB_PASSWORD`.

## Status implementacji

- ✅ Wake-on-LAN
- ✅ Pterodactyl (status + power start/stop)
- ✅ Proxmox (reachability check + shutdown)
- ✅ Dwuwarstwowa logika bezczynności + SQLite (last-seen globalny i per-gracz)
- ✅ Panel webowy (status/gracze/zdarzenia/ręczne sterowanie), hasło współdzielone
- ⬜ Tapo (fallback, gdyby WoL nie działał) — zaplanuj po przetestowaniu WoL,
  patrz `services/common/src/clients/tapo.ts`
- ⬜ Synchronizacja `banned-ips.json` z Wings (obecnie `block_banned_ips=false`)
- ⬜ Per-fazowy (dynamiczny) komunikat MOTD dla szybkiej vs. wolnej ścieżki
  budzenia — na razie jeden komunikat zakładający "do 10 minut" w obu
  przypadkach (nigdy nie kłamie, czasem jest zachowawczy)

## Struktura repo

```
lazymc/                  # obraz Docker z lazymc + config template + bridge script
services/common/         # współdzielony kod: config, SQLite, klienci API (Pterodactyl/Proxmox/WoL/Tapo/MC status)
services/orchestrator/   # HTTP API: /wake /sleep /admin/shutdown-host /status
services/idle-reaper/    # niezależny proces pilnujący progu 7 dni
services/web/            # panel webowy pod hasłem
```

## Testowanie

Docker jest dostępny lokalnie tylko do budowania obrazów
(`docker compose build`) i typecheckingu — nie do faktycznego uruchamiania
stacku, bo cała logika (WoL, Proxmox, Pterodactyl) wymaga prawdziwej sieci
domowej. Właściwe testy robimy na docelowym serwerze przez SSH.
