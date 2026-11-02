# Delivery report — Тайные образы / Hidden Pictures

## Status summary

| Area | Status |
|------|--------|
| Local product code | READY |
| Unit + asset tests | PASS |
| Typecheck / lint / build | PASS |
| Captain key viewer | READY (UI + RTDB rules; see `CAPTAIN_KEY_IMPLEMENTATION_REPORT.md`) |
| Emulator rules tests | SKIPPED here (need Java + `npm run emulators`); cases written |
| E2E 4-client full match | NOT TESTED |
| Firebase production | READY |
| GitHub Pages URL | LIVE — smoke OK |

Published URL: https://romaokorosso.github.io/hidden-pictures/

## What exists

- React/Vite app «Тайные образы» with RU/EN, auth screens, lobby (4–12), deal-by-starting-captain, 5×4 board, double-tap reveal, rematch.
- Pack `public/assets/packs/hidden-mvp` with 100 WebP cards.
- Domain rules: 8/7/4/1, clue 1–8 → N+1 opens, assassin / last agent, manual end after ≥1 guess.
- Firebase Auth (email/password) + Realtime Database; `database.rules.json` published (secret readable by captains; after finish by members).
- Guesser reveals void for online captain apply (no Cloud Functions; no secret read for guessers).
- Workflows: `.github/workflows/ci.yml`, `deploy.yml`.
- Repo: https://github.com/RomaOkorosso/hidden-pictures (`main`).

## Cloud wiring (done)

| Item | Value |
|------|--------|
| Firebase project | `hidden-pictures-11613` |
| Auth | Email/Password enabled |
| RTDB | `https://hidden-pictures-11613-default-rtdb.firebaseio.com` |
| Rules | Published from repo `database.rules.json` |
| Auth authorized domain | `romaokorosso.github.io` |
| GitHub Actions vars | All five `VITE_FIREBASE_*` set |
| Pages deploy | Run #3 success (env restriction cleared: github-pages → No restriction) |

## Smoke evidence (2026-10-25)

1. `GET https://romaokorosso.github.io/hidden-pictures/` → **HTTP 200**, title «Тайные образы», base path assets OK (`/hidden-pictures/assets/...`, pack `manifest.json` 200).
2. Home UI: RU/EN, Войти / Регистрация, rules blurb.
3. Registration → home as logged-in user (Профиль, Выйти, Создать комнату).
4. Create room → lobby `#/room/394AMB` with host SmokeTest, team/role controls, start gated until 4 players.

Full 4-browser match / assassin / reconnect / rematch still **NOT TESTED** live.

## Acceptance checklist (evidence)

1. Four independent browsers online — **NOT TESTED** (single-browser smoke only).
2. Random seating / captains / start gate — **PASS** unit + UI; live multiplayer **NOT TESTED**.
3. Key hidden from guessers — Rules test written (`tests/rules/database.rules.test.ts`); emulator run **NOT TESTED** without Java; production rules deployed.
4–10. Live turn / reconnect / deep link mid-match — **NOT TESTED** beyond room create.

## Commands run (local)

```text
npm run typecheck   # PASS
npm run lint        # PASS
npm run test:unit   # 8 PASS
npm run test:assets # 1 PASS
npm run build       # PASS (dist/)
```

## Remaining optional work

1. Install JDK + Firebase emulators → `npm run test:rules`.
2. Four-client E2E on the published URL (register ×4, lobby, full game, rematch).
3. Re-auth `gh` CLI if CLI-driven Actions/vars are needed later (web UI path already used).

## Trust model (README)

Captains know the key by role. Deal randomness is not cryptographically proven. Guessers never receive the key via SDK read of `secret`.
