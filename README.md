# mcwake

Automatyczne budzenie i usypianie całego fizycznego serwera Minecraft
(dedyk z Proxmoksem + Pterodactyl/Wings) — gracze łączą się cały czas pod
tym samym adresem, a fizyczna maszyna stoi wyłączona między sesjami zamiast
palić prąd 24/7 dla kilkugodzinnej rozgrywki raz na jakiś czas.

Gdy ktoś dołącza, a serwer śpi: dostaje komunikat "serwer się budzi, ~10
minut" zamiast odmowy połączenia, a w tle system budzi fizyczną maszynę,
czeka aż wstanie Proxmox, każe Pterodactylowi odpalić kontener Minecrafta, i
przepuszcza gracza automatycznie gdy tylko serwer faktycznie odpowiada. Gdy
nikt nie gra przez dłuższy czas — system sam usypia kontener, a po dłuższej
ciszy wyłącza cały komputer.

## Spis treści

- [Jak to działa (skrót)](#jak-to-działa-skrót)
- [Architektura](#architektura)
- [Technologie](#technologie)
- [Konfiguracja zewnętrznych systemów](#konfiguracja-zewnętrznych-systemów)
- [Instalacja](#instalacja)
- [Korzystanie z narzędzia](#korzystanie-z-narzędzia)
- [Jak to działa — krok po kroku](#jak-to-działa--krok-po-kroku)
- [Duże modpacki (Forge) i status-ping](#duże-modpacki-forge-i-status-ping)
- [Tapo / TPAP — dlaczego Python](#tapo--tpap--dlaczego-python)
- [Status implementacji](#status-implementacji)
- [Struktura repo](#struktura-repo)

## Jak to działa (skrót)

Dwie niezależne warstwy bezczynności, żeby krótkie przerwy w graniu nie
kosztowały 10-minutowego czekania, a długie realnie oszczędzały prąd:

1. **Warstwa szybka (`lazymc`, domyślnie 30 min)** — gdy ostatni gracz
   wyjdzie, usypiany jest tylko kontener Minecraft w Pterodactylu. Fizyczny
   komputer zostaje włączony, więc powrót tego samego dnia to restart
   kontenera — sekundy, nie 10 minut.
2. **Warstwa wolna (`idle-reaper`, domyślnie 7 dni)** — dopiero po
   tygodniu realnej ciszy (nikt nawet nie próbował dołączyć) system
   wyłącza cały fizyczny serwer przez Proxmox.

Budzenie fizycznej maszyny (gdy warstwa wolna ją wyłączyła) idzie przez
**wtyczkę TP-Link Tapo** sterowaną programowo (Wake-on-LAN był pierwotnym
planem, ale sprzęt — karta Killer E2400 — nigdy nie doczekał się wsparcia
WoL w Linuksie, patrz [niżej](#tapo--tpap--dlaczego-python)).

## Architektura

```
gracz (internet)
      │
      ▼ port-forward na routerze domowym
┌─────────────────────────── Unraid (zawsze włączony, ten sam LAN co dedyk) ───────────────────────────┐
│                                                                                                          │
│  ┌──────────┐   HTTP    ┌────────────────┐   python3 (localhost)   ┌──────────────────┐               │
│  │  lazymc  │──────────▶│  orchestrator  │─────────────────────────▶│ tapo_daemon.py   │──▶ Tapo P300  │
│  │  :25565  │  /wake    │     :7100      │                          │ (SPAKE2+, sesja  │    (LAN)      │
│  │ (proxy + │  /sleep   │                │                          │  trzymana 24h)   │               │
│  │  MOTD)   │           │  Pterodactyl ──┼──▶ panel.alleria.pl (Wings na dedyku)         │               │
│  └──────────┘           │  Proxmox ──────┼──▶ https://<dedyk>:8006                       │               │
│                          │  SQLite ───────┼──▶ last-seen, zdarzenia, statystyki faz       │               │
│                          └───────┬────────┘                                               │               │
│                                  │ HTTP /admin/shutdown-host                               │               │
│  ┌──────────────┐                │                                                        │               │
│  │ idle-reaper  │────────────────┘  (po 7 dniach ciszy)                                    │               │
│  │   :7102      │                                                                          │               │
│  └──────────────┘                                                                          │               │
│                          ┌────────────────┐                                                │               │
│  gracz/admin ───────────▶│      web       │──▶ /healthz* dla Uptime Kuma                   │               │
│  (panel, przeglądarka)   │     :8459      │                                                │               │
│                          └────────────────┘                                                │               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **lazymc** — jedyna rzecz widoczna dla graczy: proxy Minecrafta z
  customowym MOTD. Gdy ktoś dołącza do śpiącego serwera, uruchamia
  `bridge/wake.sh` (skonfigurowane jako `server.command`), które woła
  orchestrator przez HTTP i trzyma połączenie aż lazymc każe mu się
  zatrzymać.
- **orchestrator** — cała logika: szybka vs. wolna ścieżka budzenia,
  Tapo, Proxmox API, Pterodactyl API, SQLite (aktywność, zdarzenia,
  statystyki faz), health-checki pozostałych komponentów.
- **idle-reaper** — niezależny, wolny licznik pilnujący progu 7 dni;
  własny mini-serwer HTTP (`/health`) do monitoringu.
- **web** — panel: publiczny status (`/`, bez logowania) + zarządzanie
  za hasłem (`/manage`: komponenty, statystyki, gracze, zdarzenia, logi,
  ręczne sterowanie) + `/healthz*` dla zewnętrznego monitoringu.
- **tapo_daemon.py** — długo żyjący proces obok orchestratora w tym samym
  kontenerze, trzymający jedną sesję do listwy Tapo zamiast robić kosztowny
  handshake przy każdej akcji.

## Technologie

| Warstwa | Co i po co |
|---|---|
| Proxy Minecrafta | [lazymc](https://github.com/timvisee/lazymc) (Rust) — MOTD dla śpiącego serwera, wykrywanie że już działa, kick z komunikatem podczas budzenia. Kompilowany ze źródeł z jednym patchem (patrz niżej), bez innych modyfikacji. |
| Backend | Node.js 20 + TypeScript, [Express](https://expressjs.com/) — orchestrator i panel webowy. |
| Baza danych | [SQLite](https://sqlite.org/) przez [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — last-seen (globalny + per gracz), log zdarzeń, statystyki faz uruchamiania/zamykania. Jeden plik, współdzielony wolumen Dockera. |
| Kontrola zasilania | [python-kasa](https://github.com/python-kasa/python-kasa) (fork z obsługą TPAP, patrz niżej) — sterowanie gniazdem listwy Tapo P300 przez lokalne API, bez chmury przy każdej akcji. |
| Kontenery | Docker + Docker Compose — cztery usługi (`lazymc`, `orchestrator`, `idle-reaper`, `web`), wieloetapowe (multi-stage) Dockerfile'e. |
| Panel webowy | Zwykły HTML + CSS + vanilla JS (bez frameworka) — sesje przez `express-session`, jedno wspólne hasło. |
| Zewnętrzne API | Pterodactyl Client API (stan i sterowanie serwerem MC), Proxmox VE API (stan i wyłączanie hosta). |
| Monitoring | `/healthz` i `/healthz/:komponent` — proste endpointy HTTP zgodne z [Uptime Kuma](https://github.com/louislam/uptime-kuma) (i każdym innym monitoringiem sprawdzającym kod HTTP). |

## Konfiguracja zewnętrznych systemów

Cały setup idzie przez `.env` (skopiuj z `.env.example`, każda zmienna ma
tam komentarz). Poniżej rzeczy, które trzeba zrobić *poza* tym repo.

### Pterodactyl

1. **Client API key** (nie Application API!) — zaloguj się jako zwykły
   user, kliknij avatar w prawym górnym rogu → **API Credentials** →
   **Create New**. Bez wybierania żadnych uprawnień — Client API
   automatycznie działa na serwerach do których masz dostęp.
   → `PTERODACTYL_API_KEY`
2. **Server ID** — krótki 8-znakowy identifier z paska adresu gdy
   wejdziesz na serwer w panelu: `https://panel.example.com/server/XXXXXXXX`.
   Nie pełny UUID, nie numeryczny ID z bazy.
   → `PTERODACTYL_SERVER_ID`
3. `PTERODACTYL_URL` — adres panelu.

### Proxmox

1. **API Token**: Datacenter → Permissions → API Tokens → Add. **Odznacz
   "Privilege Separation"**, żeby token odziedziczył pełne prawa usera
   (inaczej trzeba osobno nadać `Sys.PowerMgmt` w Datacenter →
   Permissions → Permissions — bez tego shutdown hosta zwróci 403).
   → `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`
2. `PROXMOX_HOST` — adres Proxmoksa (`https://<ip>:8006`).
3. `PROXMOX_NODE` — nazwa node'a widoczna w lewym panelu pod
   "Datacenter" (domyślnie bywa `pve`, ale bywa zmieniona przy instalacji).
4. `PROXMOX_ALLOW_SELF_SIGNED=true`, jeśli (jak zwykle) Proxmox używa
   własnego certyfikatu.

### Budzenie fizycznej maszyny — Tapo albo WoL

`POWER_ON_STRATEGY=tapo` albo `wol`.

**Tapo** (zalecane jeśli sprzęt sieciowy nie wspiera WoL — patrz
[sekcja niżej](#tapo--tpap--dlaczego-python)):
- `TAPO_EMAIL` / `TAPO_PASSWORD` — dane logowania do konta Tapo (te same
  co w aplikacji mobilnej).
- `TAPO_DEVICE_IP` — IP samego urządzenia w LAN, **nie huba** Tapo
  (H100/H200) jeśli go używasz do czegoś innego.
- Listwa z wieloma gniazdami (P300 itp.): `TAPO_CHILD_POSITION` (numer
  portu, zalecane — stabilne niezależnie od nazwy nadanej w appce) albo
  `TAPO_CHILD_NAME` (dokładny alias gniazda, używany tylko jeśli
  `TAPO_CHILD_POSITION` puste).
- `TAPO_POWER_OFF_COOLDOWN_SECONDS` — niektóre płyty główne nie
  wznawiają się po bardzo krótkim odcięciu prądu; to minimalny czas
  wyłączenia zanim orchestrator z powrotem włączy gniazdko.

**WoL** — wymaga karty sieciowej ze wsparciem Wake-on-LAN w Linuksie
(sprawdź `ethtool <interfejs>`, szukaj linijki `Wake-on:`) i włączonego
"Power On by PCI-E"/podobnego ustawienia w BIOS:
- `WOL_MAC_ADDRESS` — adres MAC karty sieciowej dedyka.
- `WOL_TARGET_ADDRESS` — adres broadcast Twojej sieci LAN (np. dla
  `192.168.1.0/24` to `192.168.1.255`), **nie** zwykłe IP dedyka — dedyk
  jest wyłączony, więc unicast nie zadziała (nie ma jak rozwiązać ARP).

### Sieć

- Unraid (albo cokolwiek hostuje `docker compose`) i dedyk muszą być w
  **tej samej sieci LAN** — całość zakłada zwykłe lokalne IP, bez VPN-a.
- Port-forward na routerze domowym: `WAN:PUBLIC_PORT` → `LAN-IP-Unraida:PUBLIC_PORT`
  — tak łączą się gracze z zewnątrz.
- Panel webowy (`WEB_PORT`) nie musi być wystawiony na zewnątrz — domyślnie
  dostępny tylko w LAN, co jest wystarczające.

## Instalacja

```bash
cp .env.example .env
# uzupełnij .env — patrz sekcja wyżej

docker compose up -d --build
docker compose logs -f
```

Panel: `http://<lan-ip-unraida>:<WEB_PORT>` (domyślnie 8459 w naszej
konfiguracji, 8080 domyślnie w przykładzie). Publiczny status na `/`, hasło
do zarządzania w `WEB_PASSWORD`.

## Korzystanie z narzędzia

### Z perspektywy gracza

Nic się nie zmienia — łączysz się pod tym samym adresem/portem co zawsze.
Jeśli serwer śpi, zamiast normalnego wejścia dostajesz komunikat w stylu
"serwer był wyłączony, rozpoczęto uruchamianie, spróbuj za chwilę" i widzisz
to samo w MOTD na liście serwerów. Kolejna próba (zwykle w ciągu 10 minut,
często szybciej jeśli fizyczny host już stał włączony) po prostu wpuszcza
normalnie.

### Panel webowy

- **`/` (bez logowania)** — status: host włączony/wyłączony, stan serwera
  MC, od jak dawna trwa bezczynność. Bezpieczne do pokazania komukolwiek.
- **`/manage` (za hasłem z `WEB_PASSWORD`)**:
  - **Zarządzanie** — ręczny start, uśpienie samego kontenera, albo
    **"Wyłącz cały serwer (maszynę)"** (ta sama ścieżka co automatyczne
    wyłączenie po 7 dniach, tylko na żądanie — z potwierdzeniem, bo to
    nieodwracalna w danej chwili akcja).
  - **Komponenty** — status każdego elementu systemu (lazymc,
    orchestrator, baza, idle-reaper, Proxmox, Pterodactyl, sam serwer MC)
    bez potrzeby dostępu do Docker socket.
  - **Polityka bezczynności** — aktualne progi obu warstw + odliczanie do
    następnego automatycznego wyłączenia.
  - **Statystyki uruchamiania/zamykania** — ostatnie 20 uruchomień i 20
    zamknięć, rozbite na fazy (patrz [niżej](#jak-to-działa--krok-po-kroku)) z
    czasem trwania każdej.
  - **Gracze / Zdarzenia / Logi** — historia i surowe logi orchestratora
    oraz idle-reapera.

### Monitoring zewnętrzny (Uptime Kuma i podobne)

Panel wystawia proste, niewymagające logowania endpointy HTTP — dodaj je
jako monitory typu "HTTP(s)" w Uptime Kuma (albo dowolnym innym narzędziu
sprawdzającym kod odpowiedzi):

| Endpoint | Sprawdza |
|---|---|
| `GET /healthz` | wszystko naraz — 200 tylko jeśli każdy komponent jest zdrowy, inaczej 503 |
| `GET /healthz/web` | sam panel |
| `GET /healthz/orchestrator` | orchestrator |
| `GET /healthz/database` | SQLite |
| `GET /healthz/lazymc` | proxy (port nasłuchuje) |
| `GET /healthz/idle-reaper` | licznik 7-dniowy |
| `GET /healthz/proxmox` | API Proxmoksa odpowiada |
| `GET /healthz/pterodactyl` | API Pterodactyl odpowiada |
| `GET /healthz/mc-server` | sam serwer Minecraft odpowiada na status-ping |

Każdy zwraca `200` gdy zdrowe, `503` gdy nie — standardowy kod, żadnej
specjalnej konfiguracji po stronie Kumy.

## Jak to działa — krok po kroku

### Budzenie (gracz dołącza do śpiącego serwera)

1. **Zlecenie** — gracz próbuje dołączyć, lazymc uruchamia
   `bridge/wake.sh` → `POST /wake` do orchestratora. Zapisywane jako
   zdarzenie `wake_requested`, zaczyna się nowa sesja statystyk.
2. Orchestrator sprawdza czy Proxmox już odpowiada:
   - **Tak (szybka ścieżka)** — pomija cały poniższy krok 3, przechodzi
     od razu do kroku 4.
   - **Nie (wolna ścieżka)** — **faza "zlecenie → zasilanie"**: czeka na
     ewentualny cooldown Tapo (patrz wyżej), włącza gniazdko (albo wysyła
     magic packet WoL).
3. **Faza "boot hosta"** — orchestrator odpytuje Proxmox API co kilka
   sekund aż odpowie (`HOST_BOOT_TIMEOUT_SECONDS` na to, domyślnie 10
   min) — to czas w którym fizyczna maszyna się uruchamia, Proxmox
   startuje, i (skonfigurowane wcześniej w Proxmoksie) automatycznie
   odpala LXC z Dockerem/Wings.
4. Orchestrator sprawdza stan serwera MC w Pterodactylu; jeśli nie jest
   już `running`/`starting`, wysyła sygnał `start`.
5. **Faza "start Wings/kontenera"** — orchestrator czeka aż Pterodactyl
   przestanie zgłaszać `offline` (czyli Wings odebrał komendę i zaczyna
   podnosić kontener Dockera).
6. **Faza "start Minecrafta"** — orchestrator odpytuje bezpośrednio port
   gry (status-ping) aż odpowie — to realny czas bootowania
   Minecrafta/Forge wewnątrz kontenera.
7. Serwer gotowy — `bridge/wake.sh` dostaje odpowiedź, lazymc przepuszcza
   graczy. Zdarzenie `mc_ready` kończy sesję statystyk.

### Usypianie — warstwa szybka (lazymc, częste)

Ostatni gracz wychodzi → po `LAZYMC_SLEEP_AFTER_SECONDS` lazymc wysyła
SIGTERM do `bridge/wake.sh` → `POST /sleep` → orchestrator zatrzymuje
**tylko** kontener MC przez Pterodactyl (zapis świata). Fizyczny host
zostaje włączony.

### Wyłączanie — warstwa wolna (idle-reaper, rzadkie)

1. Co `IDLE_REAPER_POLL_INTERVAL_MINUTES` idle-reaper sprawdza czas od
   ostatniej aktywności (dowolna próba dołączenia, nie tylko udana sesja).
2. Po przekroczeniu `IDLE_REAPER_THRESHOLD_MINUTES` woła
   `POST /admin/shutdown-host` na orchestratorze (to samo wywołuje
   przycisk "Wyłącz cały serwer" w panelu).
3. **Faza "zatrzymanie MC"** — jeśli serwer nie jest już offline,
   orchestrator go zatrzymuje przez Pterodactyl i czeka na potwierdzenie
   (świat zapisany).
4. Orchestrator woła Proxmox API (`shutdown`) — to zwykły, łagodny
   shutdown OS-owy (jak `shutdown -h now`), nie twardy kill: Proxmox sam
   najpierw gracefully zatrzymuje działające VM/CT (w tym LXC z
   Dockerem/Wings), które z kolei gracefully zatrzymuje kontenery Dockera
   w środku.
5. **Faza "zamykanie hosta"** (tylko strategia Tapo) — orchestrator
   czeka aż Proxmox faktycznie przestanie odpowiadać (nie od razu po
   wysłaniu komendy) zanim fizycznie odetnie prąd — cięcie prądu w
   trakcie zamykania mogłoby uszkodzić system plików.
6. **Faza "odcięcie zasilania"** (tylko Tapo) — gniazdko na listwie
   wyłączone. Przy WoL nic tu się nie dzieje — host zostaje w stanie
   niskiego poboru (S5), gotowy na magic packet.

## Duże modpacki (Forge) i status-ping

lazymc odpytuje prawdziwy serwer bezpośrednio (status-ping) co 2 sekundy,
żeby wykryć że już działa — niezależnie od tego czy ktoś próbuje dołączyć.
Dwa realne problemy wyszły na to podczas testów z dużym modpackiem (ATM9,
~300 modów) i natknięcie się na nie jest bardzo prawdopodobne przy innych
dużych modpackach Forge:

1. **Ikonka serwera (`server-icon.png`) w bibliotece protokołu ma limit
   32 KB na całą odpowiedź status-ping.** Nieoptymalizowana ikonka 64×64
   (nawet kilkanaście KB) w base64 potrafi to przebić. Napraw: podmień
   `server-icon.png` na dysku serwera na dobrze skompresowany PNG (paleta
   256 kolorów lub mniej, kilka KB) — jeśli masz dostęp do Pterodactyl
   Client API, robi się to przez `files/write`. **Wymaga restartu serwera
   MC** — Minecraft wczytuje ikonkę raz przy starcie.
2. **Forge dorzuca listę modów (`forgeData`) do status-ping**, a
   biblioteka protokołu której używa lazymc nie potrafi sparsować tego
   formatu przy dużych modpackach (błąd `invalid type: map, expected a
   string`) — to nie jest kwestia rozmiaru, sam kształt JSON-a jest inny
   niż to co biblioteka rozumie. Do tego czasem `description`/MOTD jest w
   formacie chat-component (obiekt) zamiast zwykłego stringa, co ten sam
   sztywny parser też odrzuca.

   Na to jest patch w `lazymc/patches/monitor.rs`, nakładany w Dockerfile
   po `git clone` przed kompilacją: gdy ścisły dekoder zawiedzie, patch
   ręcznie wyciąga surowy JSON, usuwa `forgeData`/`modinfo`, spłaszcza
   obiektowe `description` do zwykłego stringa, i próbuje jeszcze raz.
   lazymc i tak nie używa tych danych (`motd.from_server=false`), więc
   ich wycięcie nic nie psuje — tylko pozwala sparsować resztę.

## Tapo / TPAP — dlaczego Python

Krótka historia, bo wpływa na kod: pierwotny plan zakładał zwykły
Wake-on-LAN. Karta sieciowa dedyka (Qualcomm Atheros Killer E2400,
sterownik `alx`) **nigdy nie doczekała się wsparcia WoL w Linuksie** —
funkcja została usunięta z jądra w 2013 przez buga i nigdy oficjalnie nie
wróciła (istnieje nieoficjalny patch DKMS, `docs/alx-wol-instrukcja.md` ma
notatki na wypadek powrotu do tego tematu — świadomie odłożone na bok jako
zbyt ryzykowne dla produkcyjnego hypervisora bez zawsze-dostępnego dostępu
fizycznego).

Zamiennik: wtyczka/listwa **TP-Link Tapo**, sterowana programowo zamiast
magic packetu. Tu pojawił się drugi problem: firmware 1.4.x tych urządzeń
przeszedł na nowy protokół lokalnego API — **TPAP** (handshake
SPAKE2+/ECDSA, krzywe eliptyczne) zamiast starszego KLAP (proste
hashowanie). **Żadna biblioteka JavaScript/TypeScript go nie obsługuje** —
stąd Python: [python-kasa](https://github.com/python-kasa/python-kasa) ma
to w nieukończonym, nieoficjalnym PR
([python-kasa/python-kasa#1592](https://github.com/python-kasa/python-kasa/pull/1592)),
z którego korzysta `services/common/tapo/` (fork z jednym dodatkowym
fixem, przypięty do konkretnego commita — `requirements.txt` ma pełne
wyjaśnienie). Gdy ten PR się zmerguje i wyjdzie w oficjalnym wydaniu,
`requirements.txt` powinien przejść na zwykły `python-kasa[speedups]`.

Handshake SPAKE2+ jest zauważalnie cięższy obliczeniowo niż zwykłe
hashowanie — dla skromnego mikrokontrolera w P300 robienie go od nowa przy
każdej pojedynczej akcji potrafiło zapchać urządzenie tak, że przestawało
odpowiadać na discovery. Dlatego `services/common/tapo/tapo_daemon.py` to
**długo żyjący proces** (uruchamiany w tle obok orchestratora, patrz
`entrypoint.sh`) trzymający jedną sesję przez całą dobę (odświeżaną
automatycznie, albo natychmiast przy błędzie) zamiast łączyć się od zera
za każdym razem — `tapo.ts` w Node.js gada z nim przez lokalne HTTP
(`127.0.0.1:7101`) zamiast spawnować nowy proces Pythona na każde
włącz/wyłącz.

## Status implementacji

- ✅ Tapo (TPAP, przez daemon Pythona) + Wake-on-LAN jako alternatywna
  strategia
- ✅ Pterodactyl (status + power start/stop)
- ✅ Proxmox (reachability check + shutdown)
- ✅ Dwuwarstwowa logika bezczynności + SQLite (last-seen globalny i
  per-gracz, sesje ze statystykami faz)
- ✅ Panel webowy: publiczny status bez logowania (`/`), zarządzanie
  (komponenty, statystyki, gracze, zdarzenia, logi, sterowanie) za hasłem
  (`/manage`)
- ✅ Health-checki komponentów + endpointy `/healthz*` dla Uptime Kuma
- ✅ Patch lazymc na duże modpacki Forge (limit rozmiaru ikonki, format
  `forgeData`, `description` jako chat-component)
- ⬜ Synchronizacja `banned-ips.json` z Wings (obecnie
  `block_banned_ips=false`)
- ⬜ Per-fazowy (dynamiczny) komunikat MOTD dla szybkiej vs. wolnej
  ścieżki budzenia — na razie jeden komunikat zakładający "do 10 minut" w
  obu przypadkach (nigdy nie kłamie, czasem jest zachowawczy)

## Struktura repo

```
lazymc/                        # obraz Docker z lazymc + config template + bridge script + patch
  patches/monitor.rs           # patch na duże modpacki Forge (patrz sekcja wyżej)
  bridge/wake.sh                # server.command — most do orchestratora

services/common/               # współdzielony kod TypeScript
  src/db.ts                     # SQLite: aktywność, gracze, zdarzenia/sesje
  src/clients/                  # Pterodactyl, Proxmox, WoL, Tapo (klient HTTP do daemona), status MC
  tapo/                         # daemon Pythona (python-kasa fork) + requirements.txt

services/orchestrator/         # HTTP API: /wake /sleep /admin/shutdown-host /status /components /stats /logs
  src/wake.ts                   # ścieżka budzenia (szybka/wolna), fazy statystyk
  src/sleep.ts                   # tier 1 — usypianie kontenera MC
  src/hostShutdown.ts            # tier 2 — pełne wyłączenie hosta
  src/stats.ts                   # liczenie faz z sesji zdarzeń
  src/components.ts              # health-checki innych usług

services/idle-reaper/          # niezależny proces pilnujący progu bezczynności + własny /health

services/web/                  # panel webowy
  public/                        # statyczne assety, strona publiczna (/)
  views/manage.html              # panel zarządzania (za hasłem)
```

## Testowanie / rozwój

Docker jest dostępny lokalnie tylko do budowania obrazów
(`docker compose build`) i typecheckingu (`npm run typecheck`) — nie do
faktycznego uruchamiania stacku, bo cała logika (Tapo, Proxmox,
Pterodactyl) wymaga prawdziwej sieci domowej. Właściwe testy robimy na
docelowym serwerze przez SSH.
