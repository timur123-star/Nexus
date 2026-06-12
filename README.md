# NexusShield

Универсальный кросс-платформенный клиент для **Xray-core / Sing-box** на стеке
**Tauri v2 + React + TypeScript**. Glassmorphism-интерфейс, два ядра,
TUN-режим, подписки, маршрутизация и статистика — без терминала.

---

## Возможности

- **Два ядра**: sing-box и Xray-core с единой абстракцией `IProxyCore`
- **Парсер ссылок**: `vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`/`hysteria2://`, `tuic://`
- **Импорт**: ссылка, список, base64-подписка, буфер, **QR из файла/буфера**, авто-определение формата
- **Подписки** с авто-обновлением по расписанию и статусами
- **Генерация config** (TLS, Reality, ws/grpc/h2, TUN, fake-IP, DNS, правила)
- **TUN-режим** с запросом прав администратора (UAC / osascript / pkexec)
- **Системный прокси**: Windows (реестр), macOS (`networksetup`), Linux (`gsettings`)
- **Реальный TCP-пинг** серверов (параллельно)
- **Статистика** через Clash API: график трафика, соединения, лог, **DNS-лог**
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
- `src/core/db.ts` — SQLite-хранилище для Zustand
- `src/store/` — Zustand-сторы (серверы, подключение, настройки)
- `src/features/` — экраны (connection / servers / stats / editor / settings / import / onboarding)
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

Ядра кладутся в `src-tauri/binaries/` и бандлятся как resources. `xray` требует
`geosite.dat` и `geoip.dat` (скрипт кладёт их туда же); sing-box тянет rule-set'ы онлайн.

### Только фронтенд (без ядра)
```bash
npm run dev            # IPC-вызовы возвращают моки
```

---

## Тесты и проверки
```bash
npm test               # vitest — парсер, DNS, планировщик подписок
npm run lint           # tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

---

## CI/CD

В папке `.github/workflows/` предусмотрены пайплайны:

- **`ci.yml`** — на каждый push/PR: проверка типов, юнит-тесты, `cargo check`.

Выпуск релиза выполняется по тегу `v*`.

---

## Лицензия
MIT.
