# Delivery report — Тайные образы / Hidden Pictures

## Status summary

| Area | Status |
|------|--------|
| Local product code | READY |
| Unit + asset tests | PASS |
| Typecheck / lint / build | PASS |
| Emulator rules tests | NOT TESTED (Java/emulators not installed in environment yet) |
| E2E 4-client | NOT TESTED |
| Firebase production | BLOCKED — needs owner login |
| GitHub Pages URL | BLOCKED — needs owner login + push |

Local readiness ≠ production. Do not treat this as a published game until the HTTPS URL is smoke-tested.

## What exists

- React/Vite app «Тайные образы» with RU/EN, auth screens, lobby (4–12), deal-by-starting-captain, 5×4 board, double-tap reveal, rematch.
- Pack `public/assets/packs/hidden-mvp` with 100 WebP cards.
- Domain rules: 8/7/4/1, clue 1–8 → N+1 opens, assassin / last agent, manual end after ≥1 guess.
- Firebase adapter + generated `database.rules.json` (secret readable by captains; after finish by members).
- Guesser reveals queue for online captain apply (no Cloud Functions; no secret read for guessers).
- Workflows: `.github/workflows/ci.yml`, `deploy.yml`.
- Git commit `0745083` on `main`.

## Acceptance checklist (evidence)

1. Four independent browsers online — **NOT TESTED** (no Firebase project yet).
2. Random seating / captains / start gate — **PASS** unit (`tests/unit/key.test.ts` lobby cases) + UI wired; live multiplayer **NOT TESTED**.
3. Key hidden from guessers — Rules test written (`tests/rules/database.rules.test.ts`); runtime against emulator **NOT TESTED** without Java.
4–10. Live turn/reconnect/Pages deep link — **NOT TESTED** pending publish.

## Commands run

```text
npm run typecheck   # PASS
npm run lint        # PASS
npm run test:unit   # 8 PASS
npm run test:assets # 1 PASS
npm run build       # PASS (dist/)
```

## Remaining owner actions

1. Sign in at https://github.com/login (tab may already be open) and https://console.firebase.google.com/
2. Allow agent to create public repo `hidden-pictures`, push `main`, enable Pages (Actions), set repository variables `VITE_FIREBASE_*`.
3. Allow agent to create Firebase project (Blaze not required), enable Email/Password + Realtime Database, deploy rules, register web app, add Pages domain to Auth.
4. After deploy, agent runs online smoke; if mail quota blocks registration, mark that path and use existing test accounts only if provided.

## Trust model (README)

Captains know the key by role. Deal randomness is not cryptographically proven. Guessers never receive the key via SDK read of `secret`.
