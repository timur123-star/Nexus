# NexusShield

Универсальный кросс-платформенный клиент для **Xray-core / Sing-box** на стеке
**Tauri v2 + React + TypeScript**. Glassmorphism-интерфейс, управление прокси,
подписки, маршрутизация и статистика — без терминала и ручного редактирования JSON.

> ⚠️ Это рабочий каркас MVP. Логика парсинга, генерации конфига, управления
> процессом ядра и весь UI реализованы. Перед первым запуском положите бинарь
> `sing-box` (см. ниже).

---

## Возможности

- **Парсер ссылок**: `vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`/`hysteria2://`, `tuic://`
- **Импорт**: ссылка, список, base64-подписка, буфер обмена, авто-определение формата
- **Подписки** с авто-обновлением и статусами (OK / ошибка / обновляется)
- **Генерация sing-box config** из профиля сервера (TLS, Reality, ws/grpc/h2, TUN, fake-IP, DNS, правила)
- **Управление ядром**: запуск/остановка `sing-box`, стриминг логов в UI
- **Реальный TCP-пинг** серверов (параллельно, с цветовой индикацией)
- **Системный прокси** (Windows: реестр + WinINET notify)
- **Статистика** через Clash API: живой график трафика, таблица соединений, лог
- **Системный трей**, кастомный titlebar, тёмная/светлая тема, RU/EN/FA/ZH
- **Горячие клавиши**: `Ctrl+K` — вкл/выкл, `Ctrl+,` — настройки, `Ctrl+I` — импорт

---

## Архитектура

```
UI (React)  ──invoke──▶  Rust (Tauri)  ──spawn──▶  sing-box
  stores                  core::CoreManager          (внешний бинарь)
  parser                  ping / sysproxy / clash
  configGen ─генерирует─▶ config.json ─────────────▶ -c config.json
```

- `src/core/parser/` — парсер ссылок (unit-тесты в `parser.test.ts`)
- `src/core/singbox/configGen.ts` — профиль → sing-box config
- `src/store/` — Zustand-сторы (серверы, подключение, настройки)
- `src/features/` — экраны (connection / servers / stats / editor / settings / import / onboarding)
- `src-tauri/src/` — `core.rs` (процесс), `ping.rs`, `sysproxy.rs`, `commands.rs`, `tray.rs`

Абстракция над ядром лежит в `core.rs::CoreManager` — точка расширения для
переключения sing-box ↔ xray.

---

## Сборка

### Требования
- Node.js ≥ 20, Rust ≥ 1.77 (msvc на Windows), WebView2
- Бинарь `sing-box` для вашей платформы

### Шаги
```bash
npm install

# иконки приложения (один раз, из исходного PNG)
npm run tauri icon assets/icon-source.png

# положите ядро рядом с бинарём приложения:
#   src-tauri/binaries/sing-box.exe   (Windows)
#   src-tauri/binaries/sing-box       (macOS/Linux)

npm run tauri dev      # запуск в режиме разработки
npm run tauri build    # сборка инсталлятора
```

### Только фронтенд (без ядра, в браузере)
```bash
npm run dev            # http://localhost:1420 — IPC-вызовы возвращают моки
```

---

## Тесты и проверки
```bash
npm test               # vitest — тесты парсера
npm run lint           # tsc --noEmit — проверка типов
cargo check --manifest-path src-tauri/Cargo.toml
```

---

## Расположение бинаря sing-box
`CoreManager::locate_singbox` ищет ядро в порядке:
1. `<resources>/binaries/sing-box[.exe]` (бандл)
2. рядом с exe приложения: `binaries/sing-box[.exe]` или `sing-box[.exe]`
3. в `PATH`

---

## Статус компонентов

| Блок | Статус |
|------|--------|
| Парсер ссылок + тесты | ✅ |
| Генерация sing-box config | ✅ |
| Запуск/остановка ядра, логи | ✅ |
| Пинг, системный прокси (Win) | ✅ |
| UI: все экраны + трей + онбординг | ✅ |
| Подписки + авто-обновление | ✅ (ручное/по кнопке; планировщик — TODO) |
| QR-импорт, Monaco-редактор | 🔜 (задел есть: textarea-редактор, парсер готов) |
| TUN на macOS/Linux sysproxy | 🔜 |

---

## Лицензия
MIT.
