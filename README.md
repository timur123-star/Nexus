# NexusShield

Универсальный кросс-платформенный клиент для **Xray-core / Sing-box** на стеке
**Tauri v2 + React + TypeScript**. Glassmorphism-интерфейс, два ядра,
TUN-режим, подписки, маршрутизация и статистика — без терминала.

---

## Возможности

- **Два ядра**: sing-box и Xray-core с единой абстракцией `IProxyCore`
- **Парсер ссылок**: `vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`/`hysteria2://`, `tuic://` (вкл. Reality и `flow`)
- **Импорт**: ссылка, список, base64-подписка, буфер, **QR из файла/буфера**, авто-определение формата
- **Подписки** с авто-обновлением по расписанию и статусами
- **Группировка серверов по подпискам** со сворачиванием групп
- **Пинг всех серверов + авто-выбор лучшего** («Авто (лучший)») по реальной задержке
- **Профили маршрутизации**: сохранение режима, правил и QUIC как пресета, переключение в один клик
- **Раздельный прокси по приложениям** (split tunneling) с пресетами популярных приложений
- **Генерация config** (TLS, Reality, ws/grpc/h2, TUN, fake-IP, DNS, правила)
- **TUN-режим** с запросом прав администратора (UAC / osascript / pkexec)
- **Системный прокси**: Windows (реестр), macOS (`networksetup`), Linux (`gsettings`)
- **Реальный TCP-пинг** серверов (параллельно)
- **Статистика** через Clash API: график трафика, соединения, лог, **DNS-лог**
- **Живой лог ядра** прямо в интерфейсе (события `core://log`)
- **Тост-уведомления** о статусе подключения и авто-выборе
- **Monaco-редактор** конфига с подсветкой и оффлайн-worker'ами
- **Системный трей**, кастомный titlebar, тёмная/светлая тема, RU/EN/FA/ZH
- **Анимации** на framer-motion с учётом prefers-reduced-motion
- **Персистентность** через SQLite (tauri-plugin-sql) с fallback на localStorage
- **Горячие клавиши**: `Ctrl+K`, `Ctrl+,`, `Ctrl+I`

---

## Архитектура

- `src/core/proxy/` — абстракция `IProxyCore` + реестр ядер (`getCore`, `ALL_CORES`)
- `src/core/singbox/` и `src/core/xray/` — генераторы конфига (с unit-тестами)
- `src/core/parser/` — парсер ссылок; `qr.ts`, `dns.ts`, `subscriptions/scheduler.ts` — с тестами
- `src/core/i18n/` — словари RU/EN/FA/ZH + `translate`/`useT` (паритет ключей проверяется тестом)
- `src/core/db.ts` — SQLite-хранилище для Zustand
- `src/store/` — Zustand-сторы (серверы, подключение, настройки, тосты)
- `src/features/` — экраны (connection / servers / stats / editor / settings / import / onboarding)
- `src/shared/` — общие компоненты, хуки и утилиты (Toaster, анимации, форматтеры)
- `src-tauri/src/` — `core.rs`, `ping.rs`, `sysproxy.rs`, `privilege.rs`, `commands.rs`, `tray.rs`

---

## Сборка

### Требования
- Node.js ≥ 20, Rust ≥ 1.77 (msvc на Windows), WebView2
- Ядра `sing-box` и `xray` (загружаются скриптом, см. ниже)

### Шаги
```bash
npm install

# загрузить ядра (sing-box + xray + geo) для текущей ОС:
npm run fetch-cores

# иконки приложения (один раз)
npm run tauri icon assets/icon-source.png

npm run tauri dev      # разработка
npm run tauri build    # сборка инсталлятора
```

> Важно: без `npm run fetch-cores` бинарники ядер отсутствуют и подключение не запустится.
> TUN-режим требует прав администратора; системный прокси маршрутизирует только proxy-aware приложения.

Ядра кладутся в `src-tauri/binaries/` и бандлятся как resources. `xray` требует
`geosite.dat` и `geoip.dat` (скрипт кладёт их туда же); sing-box тянет rule-set'ы онлайн.

### Только фронтенд (без ядра)
```bash
npm run dev            # IPC-вызовы возвращают моки
```

---

## Тесты и проверки
```bash
npm test               # vitest — парсер, DNS, планировщик подписок, генератор конфига, i18n-паритет
npm run lint           # tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

---

## Лицензия
MIT.
