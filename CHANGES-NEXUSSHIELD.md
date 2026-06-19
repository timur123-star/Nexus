# NexusShield — исправления подключения (аудит)

Этот файл описывает изменения, внесённые в ходе аудита «не подключается / подключается, но не работает».

## 1. FATAL при старте ядра: rule-set not found: geosite-cn
**Симптом:** `FATAL start service: initialize DNS rule[1]: rule-set not found: geosite-cn` — ядро падало сразу.
**Причина:** инициализация DNS-правил в sing-box синхронная и не может ссылаться на `remote` rule-set, который ещё не скачан.
**Фикс:** `src/core/singbox/configGen.ts` — из `buildDns` убран DNS-rule `{ rule_set: "geosite-cn", server: "dns-direct" }`. Маршрутный geosite-cn (для DIRECT) сохранён.

## 2. FATAL: fix windows firewall for system stack: Error adding Rule
**Симптом:** при стеке `system` ядро поднимало TUN-адаптер, затем падало на пост-старте.
**Причина:** начиная с sing-box v1.3-beta12 стек `system` регистрирует правило брандмауэра Windows через WFP/Base Filtering Engine (BFE). Если службы BFE или mpssvc (Брандмауэр Защитника Windows) отключены — регистрация падает → FATAL.
**Фикс:** `src-tauri/src/core.rs` — добавлен `ensure_windows_firewall_ready()`, который перед запуском ядра (best-effort, не блокирует старт):
- `sc config BFE start= auto` + `sc start BFE`
- `sc config mpssvc start= auto` + `sc start mpssvc`
- предрегистрирует разрешающее правило `netsh advfirewall firewall add rule name=NexusShield-Core dir=out action=allow program=<bin> enable=yes`

Дефолтный стек возвращён на `system` (`configGen.ts`, `useSettingsStore.ts`); gVisor остаётся как запасной вариант для заблокированных машин.

## 3. Ложный тост «Ядро не запустилось» при работающем ядре (главная причина «подключается, но не работает»)
**Симптом:** ядро реально проксирует трафик (в логах `outbound/vless[proxy]` и `outbound/hysteria2[proxy]` успешно идут на notion/yandex/telegram), но UI показывает ошибку и переподключается.
**Причина:** `classify_core_error()` в `core.rs` реагировал на ЛЮБУЮ строку лога со словом error/failed/timeout. sing-box пишет по строке на каждое соединение: заблокированная реклама → `open outbound connection: operation not permitted`, медленный резолв → `context deadline exceeded`, закрытый сокет → `reset by peer`/`aborted by the software`. Эти строки трактовались как фатальная ошибка ядра и поднимали notice (в т.ч. `need_admin`).
**Фикс:** `classify_core_error()` теперь:
- игнорирует пер-конекшн телеметрию (`inbound/`, `outbound/`, `connection:`, `dns:`, `blocked connection`, `aborted by the software`, `reset by peer`, `context deadline exceeded`);
- поднимает notice только на фатальных строках старта (`fatal`, `panic`, `start service`, `configure tun`, `invalid config`, `initialize`).

## Исправление 4 — авто-переключение на gVisor, когда `system`-стек невозможен
**Симптом (лог из fixed-сборки):** ядро по-прежнему падает на старте `system`-стека: `FATAL start service: post-start inbound/tun[tun-in]: starting tun stack: fix windows firewall for system stack: Error adding Rule: Ошибка. (<nil>)` — и так в цикле (8+ перезапусков).
**Причина:** на этой машине Windows отказывает sing-box в регистрации правила брандмауэра для `system`-стека ДАЖЕ при поднятых BFE/mpssvc и с правами админа (TUN-адаптер создаётся — значит, права есть). Самолечение брандмауэра (`ensure_windows_firewall_ready`) не помогает: ОС жёстко блокирует регистрацию. Именно поэтому Hiddify «просто работает» — он собран на ядре с gVisor и вообще не трогает брандмауэр.
**Фикс (прозрачный авто-фолбэк, без выбора ядра пользователем):**
- `core.rs`: строка `fix windows firewall for system stack` теперь классифицируется в отдельный notice `tun_firewall` (а не глохнет как «неизвестно»).
- Фронтенд (`useCoreNotices.ts` → `useConnectionStore.ts`): при получении `tun_firewall` сессия помечается `forceGvisorStack`, и ближайший авто-реконнект пересобирает конфиг со `stack: "gvisor"`. Пользователь видит info-тост «Системный TUN-стек недоступен — переключаюсь на gVisor», после чего туннель поднимается сам.
- `ipc.ts`: добавлен код `tun_firewall` в тип `CoreNotice`.
- Дефолт остаётся `system` (как вы просили): сначала пробуем быстрый kernel-стек, и только при отказе ОС автоматически уходим в gVisor. Ручной disconnect сбрасывает флаг — следующий запуск снова пробует `system`.

С учётом исправлений 1 (DNS rule-set) и 3 (ложный классификатор) gVisor-конфиг теперь действительно рабочий, а не «подключается, но не работает».

## Известная проблема (НЕ исправлено в коде — нужен ваш тест)
### WireGuard / WARP падает на старте
`FATAL post-start outbound/wireguard[proxy]: resolve endpoint domain for peer[0]: engage.cloudflareclient.com:2408: exchange4/6: context deadline exceeded`

Ядро не может зарезолвить домен эндпоинта WARP при старте. Вероятная причина: `direct` DNS по умолчанию — `https://223.5.5.5/dns-query` (AliDNS, КНР), который из РФ может быть недоступен/медленным (то же объясняет редкие `context deadline exceeded` по DNS). Возможные решения (на выбор, требуется проверка реальным запуском):
- сменить `direct` DNS на доступный из РФ (например `https://dns.google/dns-query` или системный);
- для WireGuard-эндпоинтов с доменом резолвить через надёжный direct-резолвер / использовать статический IP WARP.

## Как применить
1. Пересоберите приложение (Tauri): фронтенд (`configGen.ts`, `useSettingsStore.ts`) + Rust-бэкенд (`core.rs`).
2. Либо немедленный обходной путь для стека `system` без пересборки — из админ-консоли:
   ```cmd
   sc config BFE start= auto && net start BFE
   sc config mpssvc start= auto && net start mpssvc
   ```
