# mcwake

Budzi cały fizyczny serwer (Wake-on-LAN → Proxmox → Pterodactyl/Wings) gdy
ktoś próbuje dołączyć do śpiącego serwera Minecraft, i usypia go z powrotem
po długim okresie bez graczy — żeby dedyk z 32GB RAM nie stał włączony 24/7
między sesjami znajomych.

Oparte na [lazymc](https://github.com/timvisee/lazymc) jako proxy/MOTD,
sterowane przez konfigurację i zewnętrzny skrypt (`lazymc/bridge/wake.sh`)
pełniący rolę `server.command`. Jeden mały patch źródła jest jednak potrzebny
— patrz `lazymc/patches/monitor.rs` i sekcję niżej o dużych modpackach.

## Architektura

```
gracz (internet) → router (port-forward) → [Unraid: lazymc :25565] → [Unraid: orchestrator] → WoL / Proxmox / Pterodactyl → [dedyk, ten sam LAN]
                                                                     ↘ [Unraid: idle-reaper]  (7 dni ciszy → shutdown hosta)
                                                                     ↘ [Unraid: web panel]    (status, zarządzanie, logi)
```

Cały stos (`docker compose`) stoi na Unraidzie — osobnej, zawsze włączonej
maszynie w tej samej sieci domowej co dedyk. Dzięki temu (inaczej niż przy
VPS-ie) nie ma tunelu VPN w tej architekturze: orchestrator gada z dedykiem
po zwykłych lokalnych IP, a WoL to zwykły broadcast w LAN. Publiczna
dostępność dla graczy to zwykły port-forward na routerze domowym, wskazujący
na LAN IP Unraida zamiast (jak wcześniej pewnie) na dedyka.

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

## Duże modpacki (Forge) i status-ping

lazymc odpytuje prawdziwy serwer bezpośrednio (status-ping) co 2 sekundy,
żeby wykryć że już działa — niezależnie od tego czy ktoś próbuje dołączyć.
Dwa realne problemy wyszły na to podczas testów z dużym modpackiem (ATM9,
~300 modów) i się na nie natknięcie jest bardzo prawdopodobne przy innych
dużych modpackach Forge:

1. **Ikonka serwera (`server-icon.png`) w bibliotece protokołu ma limit
   32 KB na całą odpowiedź status-ping.** Nieoptymalizowana ikonka 64x64
   (nawet kilkanaście KB) w base64 potrafi to przebić. Napraw: podmień
   `server-icon.png` na dysku serwera na dobrze skompresowany PNG (paleta
   256 kolorów lub mniej, kilka KB) — jeśli masz dostęp do Pterodactyl
   Client API, robi się to przez `files/write`. **Wymaga restartu serwera
   MC** — Minecraft wczytuje ikonkę raz przy starcie.
2. **Forge dorzuca listę modów (`forgeData`) do status-ping**, a biblioteka
   protokołu której używa lazymc nie potrafi sparsować tego formatu przy
   dużych modpackach (błąd `invalid type: map, expected a string`) — to nie
   jest kwestia rozmiaru, sam kształt JSON-a jest inny niż to co biblioteka
   rozumie. Do tego czasem `description`/MOTD jest w formacie chat-component
   (obiekt) zamiast zwykłego stringa, co ten sam sztywny parser też odrzuca.

   Na to jest patch w `lazymc/patches/monitor.rs`, nakładany w Dockerfile po
   `git clone` przed kompilacją: gdy ścisły dekoder zawiedzie, patch ręcznie
   wyciąga surowy JSON, usuwa `forgeData`/`modinfo`, spłaszcza obiektowe
   `description` do zwykłego stringa, i próbuje jeszcze raz. lazymc i tak nie
   używa tych danych (`motd.from_server=false`), więc ich wycięcie nic nie
   psuje — tylko pozwala sparsować resztę.

## Wymagania sieciowe (do ustawienia przed testami)

- Unraid i dedyk w tej samej sieci LAN (żadnego VPN-a) — `MC_SERVER_HOST` i
  `PROXMOX_HOST` to zwykłe lokalne IP dedyka, `WOL_TARGET_ADDRESS` to
  broadcast tej sieci.
- Port-forward na routerze domowym: WAN:`PUBLIC_PORT` → LAN IP Unraida —
  tak łączą się gracze z zewnątrz.
- WoL włączony w BIOS/UEFI i w systemie na dedyku.
- Karta sieciowa dedyka musi mieć zasilanie standby (S5/soft-off) — jeśli
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

Panel webowy: `http://<unraid-lan-ip>:${WEB_PORT}` (domyślnie 8080), hasło z
`WEB_PASSWORD`. Domyślnie tylko w LAN — jeśli chcesz go widzieć spoza domu,
to osobna decyzja (port-forward + mocne hasło, albo VPN do domowej sieci),
nie jest do niczego wymagany przez resztę systemu.

## Status implementacji

- ✅ Wake-on-LAN
- ✅ Pterodactyl (status + power start/stop)
- ✅ Proxmox (reachability check + shutdown)
- ✅ Dwuwarstwowa logika bezczynności + SQLite (last-seen globalny i per-gracz)
- ✅ Panel webowy: publiczny status bez logowania (`/`), zarządzanie/gracze/
  zdarzenia/logi za hasłem (`/manage`)
- ✅ Patch lazymc na duże modpacki Forge (limit rozmiaru ikonki, format
  `forgeData`, `description` jako chat-component) — patrz sekcja wyżej
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
