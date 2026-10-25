# План реализации — Тайные образы / Hidden Pictures

## Аудит

Существующий каталог `codenames-picture-online` — предыдущая версия той же игры на Supabase + 24 карты + placeholders. Handoff требует Firebase Auth + Realtime Database, набор из 100 карт, правила без 0/∞, 4–12 игроков, double-tap. Продолжаем в этом каталоге: заменяем backend и дорабатываем продукт, старые supabase-артефакты удаляем.

## Решения

- Название: «Тайные образы» / Hidden Pictures (`src/config/brand.ts`).
- Стек: Vite + React + TS strict + Firebase Auth/RTDB + Vitest + Playwright + Emulator Suite.
- Колода: `public/assets/packs/hidden-mvp` (100 WebP 512×512). `concepts.json` не публикуем в игровую разметку.
- Hash routing для Pages subpath.
- Раздача ключа: детерминированный инициализатор — капитан начинающей команды (или младший UID капитанов). Rules проверяют состав 8/7/4/1. Угадывающий-хост ключ не читает.
- Открытия: multipath update; Rules сверяют роль с `secret` через `root.child` без выдачи `.read` угадывающему.
- Присутствие: `.info/connected` + `onDisconnect` + serverTime.
- Локально: emulator mode через `VITE_USE_EMULATORS=1`. Production без config — явное состояние, не offline-симуляция комнаты.

## Этапы

1. Доменная модель + unit-тесты правил.
2. Генератор RTDB Rules + emulator rules-тесты.
3. Firebase-адаптер (комнаты, лобби, партия, reconnect).
4. UI RU/EN: auth, профиль, лобби, стол, результат.
5. Asset validation, E2E (4 контекста), CI workflows.
6. Firebase project + GitHub repo + Pages; smoke на URL.
7. `docs/PROGRESS.md`, `docs/DELIVERY_REPORT.md`, README.

## Внешние зависимости от владельца

Вход в GitHub и Firebase (пароль/2FA) через браузер, когда CLI/консоль потребуют. Платные тарифы не используются.
