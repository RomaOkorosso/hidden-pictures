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
- [x] CI: JDK 21 for firebase-tools 15 emulators (`actions/setup-java`)
- [ ] Rules tests locally (need JDK 21 + `npm run emulators` / CI `emulators:exec`)
- [ ] E2E 4-browser contexts
- [ ] Deploy updated RTDB rules to production (needs owner `firebase login`)

## Last commands

- Fixed rules tests: RTDB returns `roles` as array for keys 0–19; coerce via `coerceRolesMap`.
- Bumped `firebase-tools` to 15.x (drops broken `universal-analytics`/`uuid` ESM); `deploy:rules` uses Node ≥20 / `.tools/node`.
- CI installs Temurin JDK 21 before `firebase emulators:exec` (tools 15 rejects Java &lt; 21).
- Production rules deploy still needs `firebase login` on owner machine (no token in env/configstore).

## Next (owner)

1. `export PATH="$PWD/.tools/node/bin:$PATH"` (or `nvm use 20`), then `firebase login` and `npm run deploy:rules`.
2. Or paste `database.rules.json` in Console → Realtime Database → Rules → Publish.
3. Confirm CI green after JDK 21 fix; Pages deploy follows `main`.
4. Smoke two captains → «Посмотреть ключ».
