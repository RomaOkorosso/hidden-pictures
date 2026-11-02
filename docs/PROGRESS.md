# Progress

- [x] Handoff docs + 100 cards (`hidden-mvp`)
- [x] IMPLEMENTATION_PLAN
- [x] Domain model + unit tests
- [x] RTDB rules generator (`database.rules.json`)
- [x] Firebase adapter + RU/EN UI (auth, lobby, game, double-tap)
- [x] Asset check, typecheck, lint, production build PASS
- [x] CI/Pages workflows
- [x] Join/create lobby fixes; duo training; empty `revealed` normalize
- [x] Captain key viewer (modal, sticky button, private fetch, rematch-scoped rules)
- [ ] Rules tests against emulators (need Java + running emulators)
- [ ] E2E 4-browser contexts
- [ ] Deploy updated RTDB rules + Pages frontend for captain key

## Last commands

- `npm run typecheck` / `test:unit` (16) / `build` — PASS
- `npm run test:rules` — skipped without emulators
- Report: `CAPTAIN_KEY_IMPLEMENTATION_REPORT.md`

## Next (owner)

1. `npm run deploy:rules` (or paste `database.rules.json` in Console).
2. Push/deploy Pages frontend.
3. Optional: install JRE, `npm run emulators`, `npm run test:rules`.
4. Smoke two captains → «Посмотреть ключ».
