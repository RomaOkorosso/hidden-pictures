# Тайные образы / Hidden Pictures

Приватная браузерная игра друзей по ассоциациям с картинками. Две команды, два капитана, поле 5×4. Собственное название и графика; без чужих брендов.

Стек: React + TypeScript + Vite, Firebase Authentication (email/password), Firebase Realtime Database, GitHub Pages.

## Локально

```bash
npm ci
cp .env.example .env.local
# для эмуляторов:
echo 'VITE_USE_EMULATORS=1' >> .env.local
npm run emulators   # в отдельном терминале
npm run dev
```

Команды: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:rules` (нужны эмуляторы), `npm run build`, `npm run deploy:rules`.

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
