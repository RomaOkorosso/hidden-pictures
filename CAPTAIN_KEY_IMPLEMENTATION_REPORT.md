# Captain key viewer — implementation report

## Summary

Secure persistent captain key viewing is implemented on the **existing Firebase Auth + Realtime Database** stack (not Supabase). The task’s Supabase RLS/RPC wording maps to RTDB Security Rules + authenticated SDK reads at `rooms/$roomId/secret/$matchId`. No Cloud Functions, no public key assets, no gameplay mutation on open/close.

Live project remains `hidden-pictures-11613` / GitHub Pages; this change is code + rules ready to deploy.

## Changed files

| Area | Path |
|------|------|
| Domain layout helpers | `src/domain/board.ts` |
| Private fetch / watch | `src/adapters/roomApi.ts` (`fetchCaptainKey`, `watchSecret`) |
| UI modal | `src/ui/components/CaptainKeyModal.tsx` |
| Room integration | `src/ui/pages/RoomPage.tsx` |
| Styles | `src/styles.css` |
| i18n RU/EN | `src/i18n/messages.ts` |
| Rules generator | `scripts/generate-database-rules.ts` |
| Generated rules | `database.rules.json` |
| Unit tests | `tests/unit/key.test.ts` |
| Rules tests | `tests/rules/database.rules.test.ts` |
| Docs | `CURSOR_TASK.md`, `docs/CAPTAIN_KEY_START_HERE.md`, `README.md`, this report |

## Access / threat model

- **Storage:** one immutable secret document per match at `rooms/{roomId}/secret/{matchId}` with exactly 20 roles (8/7/4/1) written once at deal time with the public match.
- **Public path** `rooms/{roomId}/public` never contains unrevealed assignments — only revealed cell colors and match metadata (`startingTeam` is public by design).
- **Read rule (active match only):**
  - Auth required (`auth.uid` from Firebase Auth — never a client-supplied role claim).
  - `$matchId` must equal `meta.matchId` (blocks reading a previous rematch key).
  - During `playing`: caller’s current `members/{uid}.role === 'captain'`.
  - During `finished`: any current room member (existing product choice to show the key after the match).
- **Write:** captains only, and only when the path does not already exist (immutable key).
- **UI cache:** in-memory only. Cleared on logout, leave, demotion (non-captain while playing), match change / rematch, and permission-denied watch errors. Not written to `localStorage` / `sessionStorage`.
- **Viewing** uses `get` / `onValue` only — no updates to turn, clue, guesses, revealed, timers, or events.
- **Pages / static build:** no `keys.json`, no key PNGs with assignments. Artwork packs are card images only. Bundle contains game *logic*, not per-match secret maps.

## Frontend behaviour

- Sticky toolbar button **«Посмотреть ключ»** for captains while playing, and for all members after finish.
- Modal: 5×4 row-major grid (`index = row * 5 + col`), starting team, legend, Escape / overlay / close button, focus restore, `aria-*`.
- Fetch keyed by the **current** `match.matchId`; stale responses discarded.
- Closing the modal does not click through to tiles (`stopPropagation` on mousedown/click).

## “Migration” note (Firebase, not Supabase)

There is no Postgres migration. Equivalent steps:

1. Regenerate and deploy RTDB rules (`npm run deploy:rules` or CI equivalent).
2. Existing rooms already store secrets under `secret/$matchId`; the tightened read rule only restricts *which* matchId may be read (must match `meta.matchId`).
3. No data backfill required.

## Tests actually run

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run test:unit` | PASS — 16 tests (deal 8/7/4/1 both starters, 5×4 layout, view purity, lobby/reveal) |
| `npm run lint` | PASS after ignoring `.tools/**` |
| `npm run build` | PASS |
| `npm run test:rules` | **8 skipped** — Java/emulators unavailable in this environment; cases are ready and will run under `npm run emulators`. |

### Rules coverage prepared (needs emulators)

When Java + `npm run emulators` are available, `npm run test:rules` asserts:

1. Both captains read the same 20-cell key; guesser denied.
2. Unauthenticated and non-member denied.
3. Demoted captain loses read.
4. Previous rematch `secret/{oldMatchId}` denied after `meta.matchId` advances.
5. After `finished`, room members may read the active key.

## Owner actions (one checklist)

Do these once; nothing else is blocked on chat confirmation.

1. **Install JRE locally (optional but recommended for rules tests):**
   ```bash
   sudo apt-get install -y openjdk-21-jre-headless
   npm run emulators   # separate terminal
   npm run test:rules
   ```
2. **Deploy updated Realtime Database rules** (required for rematch-key lockdown):
   ```bash
   npm run deploy:rules
   # or Firebase Console → Realtime Database → Rules → paste database.rules.json → Publish
   ```
3. **Ship frontend** — push `main` so GitHub Actions Pages deploy picks up the viewer UI (no new env vars).
4. **Smoke (two browsers as red/blue captains):** start match → deal → open «Посмотреть ключ» on both during opponent’s turn → refresh → demote/leave as guesser and confirm button + fetch fail → rematch and confirm new key differs and old path is denied in SDK.

## Remaining gaps

- Automated rules tests not executed against a live emulator in this session (no Java).
- No new Playwright E2E for the modal (existing e2e suite still optional/incomplete project-wide).
- Production rules deploy and Pages publish require owner credentials / push as above.
