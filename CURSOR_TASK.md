# Cursor task: secure persistent captain key viewer

Implement this feature in the existing Codenames: Pictures codebase. Inspect the repository and use its established conventions. Do not rewrite working game flow, auth, rooms, or deployment. Work autonomously and complete implementation, tests, migration(s), and documentation.

## Product requirements

- Board is exactly **5 columns by 4 rows** (20 positions), with a consistent row-major coordinate convention: index = row * 5 + column, both zero-based.
- Each match has exactly one secret key, generated or selected at match creation and immutable throughout that match. Its assignments: starting team = 8, other team = 7, neutral = 4, assassin = 1. The starting team is stored with the match.
- Both captains may open the same key at ANY moment during an active match, regardless of whose turn it is; a captain can close and reopen it as often as wanted. It also works after reconnection or page refresh and when a captain's team is not active.
- Put an always accessible **“Посмотреть ключ”** button in the captain's game UI (desktop and mobile), visible while in the game and not obscured by sticky layers. Make the UI accessible (keyboard, aria labels, Escape, focus restoration), render key as a 5x4 grid matching the board order, and indicate starting team plus legend (red, blue, neutral, assassin).
- Prefer a modal/drawer overlay with a close button. Never mutate turn or timer state, clue, remaining guesses, revealed cards, match status or RNG seed just by viewing, opening or closing the key. No gameplay event should be emitted for key viewing.
- Ordinary players/spectators never see the control or the secret payload. If roles change mid-match, immediately revoke cached private key and secure the next fetch; do not rely on hiding the button alone.
- Optional: at match end, expose the key to everyone only if the existing game design explicitly requires it; otherwise retain secrecy.

## Trust boundary — critical

The app runs on GitHub Pages (public static assets) and Supabase backend. **Never ship secret keys or their mapping as accessible static files**, public `keys.json`, image paths with embedded assignments, client bundle literals, or unprotected realtime payloads. If the project currently contains a public pre-generated keys file, do NOT serve it as a source of actual secret assignments; migrate its generation pattern or internal templates to a protected server-side mechanism. Captain key PNG/SVG files containing specific mappings should not be published to public Pages assets.

- Store the match key in a private database table or equivalent backend-only store. Lock down direct SELECT with RLS / grants; avoid exposing it in public joined tables/views, broad room subscriptions, and `SELECT *` queries.
- Create a narrow server-authorized RPC or Edge Function such as `get_captain_key(match_id)` that authenticates the user using `auth.uid()`, verifies the user is a CURRENT member of that match with captain role for red or blue, checks relevant room/match access, and returns exactly 20 assignments + starting team. The function must use server-derived identity, not a role or user ID sent by the browser.
- If using SECURITY DEFINER in Postgres: set an explicit secure search_path, schema-qualify relations, restrict EXECUTE privileges, never use request-supplied caller IDs for authorization, and be careful of RLS bypass. Remove direct access to the underlying secret table from `anon` and `authenticated` where appropriate. If using an Edge Function, enforce equivalent controls and never expose service-role credentials to the client.
- Match lifecycle mutations (creating the key, revealing a card, checking victory, finishing a match) remain authoritative server-side; a normal player must never be able to derive assignments of unrevealed cards from any response.
- Ensure realtime/public match objects publish only revealed card colors and public data. A captain's key is fetched through authorized private access, not published to the entire room.
- Do not log full secret arrays to analytics, network debug logs, exceptions, or client storage. Prefer no persistence in localStorage/sessionStorage. Clear in-memory cache on logout, role change, leaving room, and match change.
- Treat images from any previous archive as artwork only. If there is an archive of 20 key graphics, it is a prototype/reference and not a substitute for access-controlled per-match data.

## Reliability and consistency

- Use stable match_id; request key using the **currently active match**, not stale room state. Guard against race conditions on rapid room switch or rematch; discard stale responses. Use request cancellation or request identity.
- Every render of the key must correspond to the identical mapping used by server-side reveal logic. Generate mapping once on the server at start and store it transactionally with the match, not independently in UI.
- Loading, error, expired-session and unauthorized states should be user-friendly and must not display stale keys.
- Preserve the state of the board behind the overlay; modal closing must not click through to game tiles.
- All rows/columns must be visually aligned with the normal board in the same orientation; no rotation based on team, screen size or captain.

## Tests and verification

Implement automated unit/integration/security tests fitting the existing stack. At minimum verify:
1. Both current captains receive the same correct 20-cell key.
2. Red and blue normal players, spectators, non-room users and unauthenticated users cannot retrieve it, including by direct REST/table reads and realtime channels.
3. Captains can fetch during opponent's turn, after reconnect, and repeatedly without changing any game state.
4. Demoted/removed captains lose access and do not retain usable stale UI data.
5. Opening/closing viewer does not increment turn, reveal cards, consume guesses, restart timer, or trigger a rematch.
6. 5x4 orientation and 8/7/4/1 distribution are correct for both possible starting teams.
7. Rematch uses the new match's key, never the previous match's mapping.
8. Public builds do not expose private key data or artifacts.

If existing tests are not runnable without credentials, run all feasible local tests and document exactly which integration checks need a configured Supabase environment. Do not claim checks passed without running them.

## Deliverables

- Finished frontend captain viewer and button.
- Secure server-side schema/migration and access-controlled endpoint/RPC.
- Automated tests as described.
- `CAPTAIN_KEY_IMPLEMENTATION_REPORT.md` including changed files, threat model / access model, migration and deployment steps, tests actually run and results, and any remaining setup.
- Update README and deployment workflow if necessary. Maintain backwards compatibility wherever possible.

Do not ask for approvals at each step. If credentials or production database operations are missing, implement everything feasible, provide exact manual commands/checklist, and stop short of claiming a live deployment.
