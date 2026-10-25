# Progress

- [x] Handoff docs + 100 cards (`hidden-mvp`)
- [x] IMPLEMENTATION_PLAN
- [x] Domain model + unit tests (8 PASS)
- [x] RTDB rules generator (`database.rules.json`)
- [x] Firebase adapter + RU/EN UI (auth, lobby, game, double-tap)
- [x] Asset check, typecheck, lint, production build PASS
- [x] CI/Pages workflows
- [x] Initial git commit on `main` (`0745083`)
- [ ] Rules tests against emulators (need Java + running emulators)
- [ ] E2E 4-browser contexts
- [ ] Firebase project + deploy rules
- [ ] GitHub repo + Pages publish + online smoke

## Last commands

- `npm run typecheck` / `lint` / `test:unit` / `test:assets` / `build` — PASS
- `git commit` — PASS

## Next

1. Owner signs into GitHub (browser tab open at https://github.com/login) and Firebase Console.
2. Create public repo `hidden-pictures`, push, set Pages + Firebase vars.
3. Create Firebase project, enable Email/RTDB, deploy rules, put web config in GitHub variables.
4. Smoke HTTPS URL with 4 clients.

## Blockers

- No `gh` in PATH initially; installing to `~/.local/bin`.
- System package install (Java for emulators) needs elevated approval.
- GitHub/Firebase account login requires owner password/2FA in the open browser tab.
