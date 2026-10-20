# Audyt bezpieczeństwa mcwake — 2026-10-20

**Zakres:** całe repozytorium po przebudowie na jeden proces (`orchestrator/`, `lazymc/`, oba pliki compose), wdrożenie na UNRAID
(`/mnt/user/appdata/mcwake`), lazymc na network4, host gry B550 (192.168.100.80) w części, której dotyka mcwake.
Punkt wyjścia: `f2b386c` (stan przed przebudową, z panelem webowym, idle-reaperem i Tapo).

## Skala wag

| Waga | Znaczenie |
|---|---|
| 🔴 Krytyczna | Wyjście poza własne uprawnienia lub wykonanie kodu |
| 🟠 Średnia | Realny wpływ, ale wymaga dodatkowych warunków albo ogranicza się do dostępności |
| 🟡 Niska | Ograniczony wpływ albo trudne do wykorzystania |
| ℹ️ Informacja | Świadomie przyjęte, opisane dla porządku |

## Podsumowanie

Krytycznych nie ma. Największy problem był architektoniczny: **jeden token do wszystkiego, trzymany także na VPS**, oraz
**konfiguracja lazymc składana z tekstów z panelu bez escapowania**. Przebudowa usuwa też całe powierzchnie ataku, które
przestały być potrzebne: panel webowy z logowaniem w LAN, demona Tapo w Pythonie ze sforkowaną biblioteką z niescalonego PR,
dostęp do gniazda Dockera i obsługę API Proxmoxa.

| # | Waga | Ustalenie | Status |
|---|---|---|---|
| 1 | 🟠 | Jeden token do całego API, kopia na VPS | ✅ token lazymc wdrożony, token administracyjny wymieniony |
| 2 | 🟠 | Teksty z panelu wklejane do `lazymc.toml` bez escapowania | ✅ |
| 3 | 🟠 | API orchestratora osiągalne z całego LAN przez nogę ipvlan | ✅ |
| 4 | 🟠 | Panel webowy mcwake na `0.0.0.0:8459` | ✅ usunięty |
| 5 | 🟡 | Porównanie tokenu w czasie zależnym od treści | ✅ |
| 6 | 🟡 | Kontener jako root, wszystkie uprawnienia, Python i git w obrazie | ✅ |
| 7 | 🟡 | Zapytania do Pterodactyla bez limitu czasu | ✅ |
| 8 | 🟡 | Wyścig budzenia z wyłączaniem hosta | ✅ |
| 9 | 🟡 | Ustawienia bez kontroli typu i długości | ✅ |
| 10 | 🟡 | Log i tabela zdarzeń rosną bez końca | ✅ |
| 11 | 🟡 | Node 20 po końcu wsparcia | ✅ Node 24 |
| 12 | 🟡 | Klucz API Pterodactyla należy do konta root-admina | ✅ konto serwisowe, stary klucz unieważniony |
| 13 | 🟡 | Stare kopie z sekretami na UNRAID | ✅ usunięte |
| 14 | ℹ️ | Wake-on-LAN bez uwierzytelnienia | przyjęte |
| 15 | ℹ️ | Uprawnienie „control" w dashboardzie obejmuje wyłączenie hosta | przyjęte |
| 16 | ℹ️ | `kt-direct.alleria.pl` ujawnia domowe IP | przyjęte — SFTP musi działać z zewnątrz |

## Ustalenia

### 1. 🟠 Jeden token do całego API, kopia na VPS

`ORCHESTRATOR_INTERNAL_TOKEN` otwierał każdą trasę: wyłączenie hosta, tryb przerwy, zmianę ustawień, restart lazymc. Ten sam
token leżał w `.env` lazymc na network4, a lazymc potrzebuje tylko budzenia, usypiania i własnej konfiguracji.

**Scenariusz:** ktoś czyta `.env` projektu lazymc na network4 (Arcane ma do niego dostęp, kopia zapasowa, błąd w innym stosie)
i z dowolnego miejsca w tailnecie wyłącza KT5 z graczami albo włącza tryb przerwy na stałe.

**Naprawa:** `ORCHESTRATOR_LAZYMC_TOKEN` — drugi token, ważny tylko dla `POST /wake`, `POST /sleep`, `GET /config/lazymc`
(`src/api.ts`, test `the lazymc token reaches only its own routes`). lazymc dostaje go w miejsce pełnego tokenu; pełny zostaje
tylko w dashboardzie. Bez nowej zmiennej wszystko działa jak dawniej, więc wdrożenie kodu i zmiana tokenu na VPS mogą iść osobno.

### 2. 🟠 Teksty z panelu wklejane do `lazymc.toml` bez escapowania

MOTD i komunikaty edytowane w dashboardzie trafiały przez `envsubst` między cudzysłowy w `lazymc.toml`. Cudzysłów lub znak
nowej linii kończył napis wcześniej.

**Scenariusz:** osoba z uprawnieniem „control" wpisuje MOTD z `"` — lazymc przy następnym restarcie nie startuje i nikt nie
wejdzie na serwer. Dopisanie nowej tabeli (np. `[join.forward]` z obcym adresem) też było możliwe; nadpisanie istniejących
kluczy, w tym `server.command`, blokuje sama składnia TOML (powtórzona tabela to błąd).

**Naprawa:** `tomlString()` w `src/settings.ts` escapuje wszystko, co może zakończyć napis lub linię; udokumentowane `\n` dalej
łamie linię. Liczby i przełączniki trafiają do pliku tylko jako cyfry albo `true`/`false`. Sprawdzone testem i parserem TOML
na prawdziwym szablonie.

### 3. 🟠 API orchestratora osiągalne z całego LAN przez nogę ipvlan

Od 2026-10-19 (`f2b386c`) orchestrator ma drugi adres w LAN (192.168.100.81) do wysyłania WoL. Proces słuchał na wszystkich
adresach, więc API było dostępne z każdego urządzenia w sieci domowej, z pominięciem publikacji portu tylko na adresie Tailscale.
Token nadal obowiązywał, ale wcześniej API w ogóle nie było widać z LAN.

**Naprawa:** `src/index.ts` zrywa każde połączenie przychodzące na `WOL_LAN_ADDRESS`, zanim przeczyta choć bajt.

### 4. 🟠 Panel webowy mcwake na `0.0.0.0:8459`

Osobny kontener z własnym logowaniem (hasło z `.env`, sesje, opcjonalnie Cloudflare Access), opublikowany na wszystkich
interfejsach UNRAID, z pełnym tokenem orchestratora. Jego funkcje od dawna ma dashboard.

**Naprawa:** usunięty razem z `WEB_PASSWORD`, `WEB_SESSION_SECRET`, `CF_ACCESS_*`. Uptime Kuma go nie monitorował (sprawdzone).

### 5. 🟡 Porównanie tokenu w czasie zależnym od treści

`req.header("authorization") !== \`Bearer ${TOKEN}\`` — porównanie napisów kończy się na pierwszym różnym znaku. Praktycznie
trudne do wykorzystania przez sieć, ale to jedyna bariera API. **Naprawa:** `crypto.timingSafeEqual`.

### 6. 🟡 Kontener jako root, wszystkie uprawnienia, Python i git w obrazie

Obraz orchestratora zawierał Pythona, pip, git i bibliotekę Tapo budowaną ze sforkowanego, niescalonego PR (zależność
z łańcucha dostaw bez wydania). Proces działał jako root z pełnym zestawem capabilities i zapisywalnym systemem plików.

**Naprawa:** Tapo usunięte w całości. Obraz `node:24-trixie-slim` z `apt upgrade`, tylko `openssh-client` ponad bazę. Proces
jako `node`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`. Stan wyłącznie w wolumenie `/data`.

### 7. 🟡 Zapytania do Pterodactyla bez limitu czasu

Zawieszone połączenie z panelem (Cloudflare, przeciążenie) wisiało bez końca. Teraz budzenie, usypianie i wyłączanie idą jedno
po drugim (#8), więc takie zawieszenie zablokowałoby wszystkie. **Naprawa:** 30 s na zapytanie (`clients/pterodactyl.ts`),
ponawianie jak dotąd.

### 8. 🟡 Wyścig budzenia z wyłączaniem hosta

Budzenie w trakcie wyłączania zastawało host jeszcze włączony, szło „szybką ścieżką" i startowało serwer, który poweroff chwilę
później odcinał w trakcie ładowania świata. Dwa równoczesne budzenia (lazymc i przycisk w dashboardzie) wysyłały podwójne
sygnały startu.

**Naprawa:** `src/power.ts` — budzenie, usypianie i wyłączanie czekają na swoją kolej; równoczesne budzenia dzielą jeden przebieg.
Budzenie zgłoszone w trakcie wyłączania czeka na nie i budzi maszynę od zera.

### 9. 🟡 Ustawienia bez kontroli typu i długości

`POST /config/settings` przyjmował wartość dowolnego typu i długości; liczba zamiast napisu kończyła się błędem 500, a liczby
akceptowały np. `1e3` czy `-5`. **Naprawa:** wartość musi być napisem (lub `null`), najwyżej 500 znaków, liczby tylko jako cyfry.

### 10. 🟡 Log i tabela zdarzeń rosną bez końca

`orchestrator.log` był tylko dopisywany, tabela `events` też. Powolne zapełnianie dysku UNRAID (pula cache już bywała pełna).
**Naprawa:** log obracany przy 5 MB (zostaje jeden poprzedni), zdarzenia starsze niż 90 dni usuwane raz na dobę.

### 11. 🟡 Node 20 po końcu wsparcia

Node 20 przestał dostawać poprawki bezpieczeństwa w kwietniu 2026. **Naprawa:** Node 24 LTS, zależności podniesione
(better-sqlite3 13, express 4.22).

### 12. 🟡 Klucz API Pterodactyla należy do konta root-admina

`PTERODACTYL_API_KEY` to klucz Client API konta z pełnymi prawami administratora panelu. mcwake potrzebuje tylko stanu i
zasilania jednego serwera, ale wyciek klucza z UNRAID daje dostęp do wszystkich serwerów i plików w panelu.

**Zalecenie:** osobne konto w panelu, dodane do KT5 jako podużytkownik z prawami `control.start`/`control.stop` (i odczytem
stanu), jego klucz w `.env`, stary klucz unieważniony. Wymaga założenia konta — decyzja właściciela.

### 13. 🟡 Stare kopie z sekretami na UNRAID

W `/mnt/user/appdata/mcwake` leżą `.env.kopia-*` i katalogi `.kopia-*` sprzed zmian, a w `appdata` archiwum
`mcwake-kopia-20261019-przed-wings.tgz`. Zawierają m.in. hasło do konta Tapo (konto TP-Link w chmurze) i hasło panelu webowego.
Mają uprawnienia tylko dla roota.

**Zalecenie:** po potwierdzeniu, że nowe wdrożenie działa, usunąć kopie (decyzja właściciela). Hasło konta TP-Link warto
zmienić, jeśli używa go też aplikacja Tapo — nigdzie nie wyciekło, ale przez miesiące leżało w kilku plikach.

### 14. ℹ️ Wake-on-LAN bez uwierzytelnienia

Każde urządzenie w LAN może obudzić B550 magicznym pakietem. Tak działa WoL; skutkiem jest tylko włączenie maszyny.

### 15. ℹ️ Uprawnienie „control" w dashboardzie obejmuje wyłączenie hosta

Kto ma „control" w projekcie Klocki Time, może też wyłączyć maszynę, przełączyć tryb przerwy i zmieniać ustawienia mcwake.
Akcje są zapisywane w dzienniku audytu dashboardu. Osobne uprawnienie miałoby sens dopiero przy większej liczbie osób z „control".

### 16. ℹ️ `kt-direct.alleria.pl` ujawnia domowe IP

lazymc na network4 łączy się z serwerem przez `kt-direct.alleria.pl:60321` (CNAME na `network5.alleria.pl`, domowe IP, to samo
co UNRAID), a przez tę samą nazwę idzie SFTP na 2023. To konfiguracja sieci, nie kod mcwake. Alternatywa: lazymc łączy się przez
Tailscale (alokacja serwera także na adresie tailnetu), wtedy przekierowanie 60321 w routerze przestaje być potrzebne.

## Sprawdzone bez uwag

- Klucz do wyłączania hosta: `restrict,command="/usr/bin/systemctl poweroff",from="192.168.100.81,192.168.100.70"`, klucz hosta
  przypięty w `known_hosts` (nieznany lub zmieniony klucz = błąd, nie zaufanie).
- Sprawdzanie Wings to anonimowe `GET /api/system` w LAN — żadne poświadczenie nie wychodzi.
- Webhook Arcane może tylko zrestartować projekt lazymc; adres nie trafia do logów.
- `/config/lazymc` zwraca wartości w apostrofach z poprawnie escapowanym `'`, więc `entrypoint.sh` lazymc nie wykona nic z tekstu.
- Port API publikowany tylko na adresie Tailscale UNRAID; ruch lazymc i dashboardu idzie w WireGuard.

## Status wdrożenia (2026-10-20)

- **#1:** lazymc na network4 ma własny token (sprawdzone: `/config/lazymc` 200, `/admin/shutdown-host` 403). Token
  administracyjny, który leżał w `.env` lazymc, został wymieniony na UNRAID i w dashboardzie.
- **#12:** konto panelu `mcwake@alleria.pl` — podużytkownik KT5 tylko z `control.start` i `control.stop`, bez roli
  administratora i bez hasła, które ktokolwiek zna. Jego klucz widzi jeden serwer. Klucz root-admina z opisem „mcwake"
  unieważniony dopiero po tym, jak orchestrator użył nowego.
- **#13:** usunięte cztery kopie `.env` (jedna, `.env.bak-pre-vps`, miała uprawnienia 644) i dwa archiwa z UNRAID oraz kopia
  `.env` lazymc na network4.
