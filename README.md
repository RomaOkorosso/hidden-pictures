# Тайные образы / Hidden Pictures

Приватная браузерная игра друзей по ассоциациям с картинками. Две команды, два капитана, поле 5×4. Собственное название и графика; без чужих брендов.

Стек: React + TypeScript + Vite, Firebase Authentication (email/password), Firebase Realtime Database, GitHub Pages.

[Открыть игру](https://romaokorosso.github.io/hidden-pictures/) — релиз проверен четырьмя независимыми игроками до завершения партий.

## Локально и автономный QA

Нужны Node.js **24.12+ в поддерживаемой LTS-ветке** (проверено на 24.22.3, см. `.nvmrc`) и **JDK 21+** для эмуляторов. Системный Node 18 не подходит. При наличии локального бинаря QA: `export PATH="$PWD/.tools/node24-qa/bin:$PATH"`; глобальные настройки менять не требуется.

```bash
npm ci
npx playwright install chromium
npm run typecheck
npm run lint
npm run build
npm test             # unit + assets
npm run test:rules   # сам поднимает и останавливает изолированные эмуляторы
npm run test:e2e     # сам поднимает Auth + RTDB + Vite + отдельные браузерные сессии
# либо все тесты одной командой:
npm run qa
```

QA использует только loopback-порты 19000/19099/14400/14401/14402/4177 и demo-проект, игнорирует `.env.local` и отказывается подключаться к уже занятым сервисам. Подробности, трассы, восстановление и обновление: [docs/QA_RECOVERY.md](docs/QA_RECOVERY.md). Результаты и ограничения: [QA_REPORT.md](QA_REPORT.md), [QA_RELEASE_GATE.md](QA_RELEASE_GATE.md).

Для обычной локальной разработки:

```bash
cp .env.example .env.local
# В .env.local включить VITE_USE_EMULATORS=1
npm run emulators  # отдельный терминал, порты 9099/9000
npm run dev
```

Эмулятор приложения использует namespace `demo-hidden-pictures-default-rtdb`, куда Firebase CLI загружает Rules. `npm run rules:generate` обновляет `database.rules.json`; Rules-тесты не пропускаются молча, если эмулятор не запустился.

`npm run deploy:rules` публикует правила в реальный проект и **не является QA-командой**. Во время автономной проверки не запускается; публикация требует отдельного разрешения владельца.

## Ассеты

`public/assets/packs/hidden-mvp` — 100 карт WebP. В партии случайно выбираются 20 разных ID. Замена карты: положите файл с тем же именем. Новый набор ≥20 карт: обновите `manifest.json` и `index.json`.

## Модель доверия

Капитаны видят ключ (они и так знают ответы). Раздачу инициирует капитан начинающей команды после запроса ведущего. Угадывающие не читают `secret` через SDK. Открытия угадывающих ставит в очередь; онлайн-капитан применяет их, сверяя с ключом. Случайность раздачи не является криптографически доказанной.

### Просмотр ключа капитаном

Кнопка **«Посмотреть ключ»** открывает модалку 5×4 с тем же mapping, что записан в `rooms/{roomId}/secret/{matchId}` при раздаче. Чтение разрешено Rules только текущим капитанам активной партии (`meta.matchId`); после `finished` — участникам комнаты. Открытие/закрытие модалки не меняет ход, подсказку и открытия. Подробности: [`CAPTAIN_KEY_IMPLEMENTATION_REPORT.md`](./CAPTAIN_KEY_IMPLEMENTATION_REPORT.md).

На своём ходе капитан может тапнуть карту и поставить **приватную метку** (верная / чужая / нейтраль / чёрная). Метки лежат в `rooms/{roomId}/captainNotes/{uid}` и не видны угадывающим и другому капитану.

## Production

1. Создайте бесплатный Firebase-проект, включите Email/Password и Realtime Database.
2. Опубликуйте Rules: `npm run deploy:rules`.
3. Зарегистрируйте web app, скопируйте config в GitHub repository variables (`VITE_FIREBASE_*`) и локальный `.env.local`.
4. Добавьте домен Pages в Authorized domains Auth.
5. Pages → Source: GitHub Actions. Workflow `deploy.yml` собирает с `VITE_BASE_PATH=/<repo>/`.

Приглашение: `https://USER.github.io/REPO/#/room/CODE`.
