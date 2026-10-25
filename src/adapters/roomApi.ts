import {
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
  type Unsubscribe,
} from "firebase/database";
import { requireFirebase } from "../firebase/app";
import { GAME } from "../config/brand";
import { normalizeClueWord, normalizeDisplayName, normalizeRoomCode, randomRoomCode } from "../domain/clue";
import { guessesAllowed, dealRoles, otherTeam, pickStartingTeam, rolesToMap, sampleCardIds } from "../domain/key";
import { applyClue, applyReveal, canEndTurn, endTurn, initialRemaining } from "../domain/reveal";
import { assignSeat, canStart, randomizeCaptains, randomizeTeams } from "../domain/lobby";
import type {
  CardRole,
  GameEvent,
  Member,
  PublicMatch,
  RoomMeta,
  SeatRole,
  SecretKey,
  Team,
} from "../domain/types";
import { loadPack } from "../lib/packs";

function db(): Database {
  return requireFirebase().db;
}

function nowMs(): number {
  return Date.now();
}

export async function saveProfile(uid: string, displayName: string): Promise<void> {
  const name = normalizeDisplayName(displayName);
  await set(ref(db(), `profiles/${uid}`), { displayName: name, updatedAt: nowMs() });
}

export async function loadProfile(uid: string): Promise<{ displayName: string } | null> {
  const snap = await get(ref(db(), `profiles/${uid}`));
  return snap.exists() ? (snap.val() as { displayName: string }) : null;
}

export async function createRoom(uid: string, displayName: string, packId = "hidden-mvp"): Promise<{ roomId: string; code: string }> {
  const name = normalizeDisplayName(displayName);
  const roomRef = push(ref(db(), "rooms"));
  const roomId = roomRef.key;
  if (!roomId) throw new Error("ROOM_CREATE");

  let code = randomRoomCode();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const codeRef = ref(db(), `roomCodes/${code}`);
    const result = await runTransaction(codeRef, (current) => {
      if (current != null) return;
      return { roomId };
    });
    if (result.committed) break;
    code = randomRoomCode();
    if (attempt === 7) throw new Error("CODE_COLLISION");
  }

  const meta: RoomMeta = {
    code,
    hostId: uid,
    status: "lobby",
    createdAt: nowMs(),
    updatedAt: nowMs(),
    packId,
    matchId: null,
  };
  const member: Member = {
    uid,
    displayName: name,
    team: null,
    role: null,
    joinedAt: nowMs(),
    lastSeenAt: nowMs(),
  };

  await update(ref(db()), {
    [`rooms/${roomId}/meta`]: meta,
    [`rooms/${roomId}/members/${uid}`]: member,
  });

  return { roomId, code };
}

export async function resolveCode(codeRaw: string): Promise<string> {
  const code = normalizeRoomCode(codeRaw);
  const snap = await get(ref(db(), `roomCodes/${code}`));
  if (!snap.exists()) throw new Error("ROOM_NOT_FOUND");
  return String((snap.val() as { roomId: string }).roomId);
}

export async function joinRoom(roomId: string, uid: string, displayName: string): Promise<void> {
  const name = normalizeDisplayName(displayName);
  const metaSnap = await get(ref(db(), `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) throw new Error("ROOM_NOT_FOUND");
  const meta = metaSnap.val() as RoomMeta;
  if (meta.status !== "lobby") {
    const existing = await get(ref(db(), `rooms/${roomId}/members/${uid}`));
    if (!existing.exists()) throw new Error("MATCH_LOCKED");
    await update(ref(db(), `rooms/${roomId}/members/${uid}`), { lastSeenAt: nowMs() });
    return;
  }
  const membersSnap = await get(ref(db(), `rooms/${roomId}/members`));
  const members = membersSnap.val() as Record<string, Member> | null;
  const count = members ? Object.keys(members).length : 0;
  if (!members?.[uid] && count >= GAME.maxPlayers) throw new Error("ROOM_FULL");

  const member: Member = members?.[uid] ?? {
    uid,
    displayName: name,
    team: null,
    role: null,
    joinedAt: nowMs(),
    lastSeenAt: nowMs(),
  };
  member.displayName = name;
  member.lastSeenAt = nowMs();
  await set(ref(db(), `rooms/${roomId}/members/${uid}`), member);
}

export async function leaveRoom(roomId: string, uid: string): Promise<void> {
  const metaSnap = await get(ref(db(), `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) return;
  const meta = metaSnap.val() as RoomMeta;
  if (meta.status === "playing") {
    // stay in roster; only mark presence offline via onDisconnect
    return;
  }
  await set(ref(db(), `rooms/${roomId}/members/${uid}`), null);
  if (meta.hostId === uid) {
    const membersSnap = await get(ref(db(), `rooms/${roomId}/members`));
    const members = Object.values((membersSnap.val() as Record<string, Member>) ?? {});
    if (members.length === 0) {
      await set(ref(db(), `roomCodes/${meta.code}`), null);
      await set(ref(db(), `rooms/${roomId}`), null);
      return;
    }
    members.sort((a, b) => a.joinedAt - b.joinedAt);
    await update(ref(db(), `rooms/${roomId}/meta`), { hostId: members[0]!.uid, updatedAt: nowMs() });
  }
}

export function watchRoom(
  roomId: string,
  handlers: {
    onMeta: (meta: RoomMeta) => void;
    onMembers: (members: Member[]) => void;
    onPublic: (match: PublicMatch | null) => void;
    onEvents: (events: GameEvent[]) => void;
    onPresence: (map: Record<string, { online: boolean; at: number }>) => void;
  },
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];
  unsubs.push(
    onValue(ref(db(), `rooms/${roomId}/meta`), (snap) => {
      if (snap.exists()) handlers.onMeta(snap.val() as RoomMeta);
    }),
  );
  unsubs.push(
    onValue(ref(db(), `rooms/${roomId}/members`), (snap) => {
      const val = (snap.val() as Record<string, Member>) ?? {};
      handlers.onMembers(Object.values(val).sort((a, b) => a.joinedAt - b.joinedAt));
    }),
  );
  unsubs.push(
    onValue(ref(db(), `rooms/${roomId}/public`), (snap) => {
      handlers.onPublic(snap.exists() ? (snap.val() as PublicMatch) : null);
    }),
  );
  unsubs.push(
    onValue(ref(db(), `rooms/${roomId}/events`), (snap) => {
      const val = (snap.val() as Record<string, GameEvent>) ?? {};
      handlers.onEvents(Object.values(val).sort((a, b) => b.at - a.at).slice(0, 40));
    }),
  );
  unsubs.push(
    onValue(ref(db(), `rooms/${roomId}/presence`), (snap) => {
      handlers.onPresence((snap.val() as Record<string, { online: boolean; at: number }>) ?? {});
    }),
  );
  return () => unsubs.forEach((u) => u());
}

export async function bindPresence(roomId: string, uid: string): Promise<() => void> {
  const presenceRef = ref(db(), `rooms/${roomId}/presence/${uid}`);
  await set(presenceRef, { online: true, at: nowMs() });
  await onDisconnect(presenceRef).set({ online: false, at: serverTimestamp() });
  const timer = window.setInterval(() => {
    void update(ref(db(), `rooms/${roomId}/members/${uid}`), { lastSeenAt: nowMs() });
    void set(presenceRef, { online: true, at: nowMs() });
  }, 20_000);
  return () => {
    window.clearInterval(timer);
    void set(presenceRef, { online: false, at: nowMs() });
  };
}

export async function hostSetMember(
  roomId: string,
  hostId: string,
  targetUid: string,
  team: Team | null,
  role: SeatRole | null,
): Promise<void> {
  const meta = (await get(ref(db(), `rooms/${roomId}/meta`))).val() as RoomMeta;
  if (meta.hostId !== hostId) throw new Error("NOT_HOST");
  if (meta.status !== "lobby") throw new Error("NOT_LOBBY");
  const membersSnap = await get(ref(db(), `rooms/${roomId}/members`));
  const members = Object.values((membersSnap.val() as Record<string, Member>) ?? {});
  const next = assignSeat(members, targetUid, team, role);
  const updates: Record<string, unknown> = { [`rooms/${roomId}/meta/updatedAt`]: nowMs() };
  for (const m of next) updates[`rooms/${roomId}/members/${m.uid}`] = m;
  await update(ref(db()), updates);
}

export async function hostRandomize(roomId: string, hostId: string, mode: "teams" | "captains"): Promise<void> {
  const meta = (await get(ref(db(), `rooms/${roomId}/meta`))).val() as RoomMeta;
  if (meta.hostId !== hostId) throw new Error("NOT_HOST");
  if (meta.status !== "lobby") throw new Error("NOT_LOBBY");
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const next = mode === "teams" ? randomizeTeams(members) : randomizeCaptains(members);
  const updates: Record<string, unknown> = { [`rooms/${roomId}/meta/updatedAt`]: nowMs() };
  for (const m of next) updates[`rooms/${roomId}/members/${m.uid}`] = m;
  await update(ref(db()), updates);
}

export async function claimCaptain(roomId: string, uid: string, team: Team): Promise<void> {
  const meta = (await get(ref(db(), `rooms/${roomId}/meta`))).val() as RoomMeta;
  if (meta.status !== "lobby") throw new Error("NOT_LOBBY");
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const me = members.find((m) => m.uid === uid);
  if (!me || me.team !== team) throw new Error("BAD_ASSIGNMENT");
  const next = assignSeat(members, uid, team, "captain");
  const updates: Record<string, unknown> = {};
  for (const m of next) updates[`rooms/${roomId}/members/${m.uid}`] = m;
  await update(ref(db()), updates);
}

async function appendEvent(roomId: string, event: Omit<GameEvent, "id">): Promise<void> {
  const eventRef = push(ref(db(), `rooms/${roomId}/events`));
  await set(eventRef, { ...event, id: eventRef.key });
}

export async function requestStart(roomId: string, hostId: string): Promise<void> {
  const meta = (await get(ref(db(), `rooms/${roomId}/meta`))).val() as RoomMeta;
  if (meta.hostId !== hostId) throw new Error("NOT_HOST");
  if (meta.status !== "lobby") throw new Error("NOT_LOBBY");
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  if (!canStart(members)) throw new Error("NEED_ROLES");
  const redCap = members.find((m) => m.team === "red" && m.role === "captain")!;
  const blueCap = members.find((m) => m.team === "blue" && m.role === "captain")!;
  const starter = pickStartingTeam();
  const initializer = starter === "red" ? redCap.uid : blueCap.uid;
  await set(ref(db(), `rooms/${roomId}/dealRequests/pending`), {
    requestedBy: hostId,
    initializer,
    startingTeam: starter,
    at: nowMs(),
  });
  await appendEvent(roomId, {
    at: nowMs(),
    type: "deal_requested",
    actorUid: hostId,
    payload: { initializer, startingTeam: starter },
  });
}

export async function captainDeal(roomId: string, uid: string): Promise<void> {
  const pendingSnap = await get(ref(db(), `rooms/${roomId}/dealRequests/pending`));
  if (!pendingSnap.exists()) throw new Error("NO_DEAL");
  const pending = pendingSnap.val() as { initializer: string; startingTeam: Team };
  if (pending.initializer !== uid) throw new Error("NOT_DEALER");

  const meta = (await get(ref(db(), `rooms/${roomId}/meta`))).val() as RoomMeta;
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const redCap = members.find((m) => m.team === "red" && m.role === "captain")!;
  const blueCap = members.find((m) => m.team === "blue" && m.role === "captain")!;
  const pack = await loadPack(meta.packId);
  const cardIds = sampleCardIds(pack.cards.map((c) => c.id));
  const roles = rolesToMap(dealRoles(pending.startingTeam));
  const matchId = `m${nowMs().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const secret: SecretKey = {
    matchId,
    roles,
    captainRed: redCap.uid,
    captainBlue: blueCap.uid,
  };
  const pub: PublicMatch = {
    matchId,
    version: 1,
    turnId: `${matchId}-t1`,
    cardIds,
    startingTeam: pending.startingTeam,
    currentTeam: pending.startingTeam,
    phase: "clue",
    clueWord: null,
    clueCount: null,
    guessesLeft: null,
    guessesMade: 0,
    revealed: {},
    remaining: initialRemaining(pending.startingTeam),
    winner: null,
    winReason: null,
    createdAt: nowMs(),
  };

  await update(ref(db()), {
    [`rooms/${roomId}/secret/${matchId}`]: secret,
    [`rooms/${roomId}/public`]: pub,
    [`rooms/${roomId}/meta/status`]: "playing",
    [`rooms/${roomId}/meta/matchId`]: matchId,
    [`rooms/${roomId}/meta/updatedAt`]: nowMs(),
    [`rooms/${roomId}/dealRequests/pending`]: null,
  });
  await appendEvent(roomId, {
    at: nowMs(),
    type: "match_started",
    actorUid: uid,
    payload: { matchId, startingTeam: pending.startingTeam },
  });
}

export async function watchSecret(
  roomId: string,
  matchId: string,
  cb: (key: SecretKey | null) => void,
): Promise<Unsubscribe> {
  return onValue(ref(db(), `rooms/${roomId}/secret/${matchId}`), (snap) => {
    cb(snap.exists() ? (snap.val() as SecretKey) : null);
  });
}

export async function giveClue(roomId: string, uid: string, wordRaw: string, count: number): Promise<void> {
  const word = normalizeClueWord(wordRaw);
  const guesses = guessesAllowed(count);
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const me = members.find((m) => m.uid === uid);
  const pub = (await get(ref(db(), `rooms/${roomId}/public`))).val() as PublicMatch;
  if (!me || me.role !== "captain" || me.team !== pub.currentTeam) throw new Error("NOT_YOUR_TURN");
  const next = applyClue(pub, word, count, guesses);
  await set(ref(db(), `rooms/${roomId}/public`), next);
  await appendEvent(roomId, {
    at: nowMs(),
    type: "clue",
    actorUid: uid,
    payload: { word, count, team: pub.currentTeam },
  });
}

export async function guessCard(roomId: string, uid: string, position: number, expectedVersion: number): Promise<void> {
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const me = members.find((m) => m.uid === uid);
  const pubSnap = await get(ref(db(), `rooms/${roomId}/public`));
  const pub = pubSnap.val() as PublicMatch;
  if (pub.version !== expectedVersion) throw new Error("STALE");
  if (!me || me.role !== "guesser" || me.team !== pub.currentTeam) throw new Error("NOT_YOUR_TURN");
  if (pub.phase !== "guess") throw new Error("NOT_GUESS_PHASE");
  if (pub.revealed[String(position)]) throw new Error("ALREADY_REVEALED");

  const secret = (await get(ref(db(), `rooms/${roomId}/secret/${pub.matchId}`))).val() as SecretKey | null;
  // Guesser cannot read secret — captains/host path only works for captains.
  // Guesser reveal: write intended position to actions; captains? No — Rules validate via root.
  // Client must include the role in the update; Rules check it matches secret without granting read.
  // So guesser gets role only AFTER write succeeds by reading public.revealed.
  // To know role before write: we cannot. Pattern: multipath update with role fetched... 
  // Guesser doesn't know role. Solution: write action; use cloud function — not allowed.
  // Alternative: transaction on public that Rules enrich — Rules can't enrich.
  // Correct pattern without Functions: guesser writes `actions/reveal/{id}` with position;
  // a captain OR the security rules on a special path... 
  // Actually Firebase docs: client can write `revealed/$pos` to a value that Rules verify equals secret.
  // Client must supply the value. If wrong, write fails. Guesser would need to guess the color — bad UX.
  //
  // Practical trusted-friends pattern used here:
  // 1) Guesser writes reveal request under actions.
  // 2) Any client that CAN read secret (captains) OR we store role map such that...
  //
  // Better approach for no-Functions: use RTDB Rules with `.validate` on a reveal request node
  // that copies from secret using... Rules cannot copy.
  //
  // Use: guesser calls reveal with position; client reads secret if captain; if guesser,
  // write to `public/revealed/$pos` using a Cloud Function — forbidden.
  //
  // Spec says: "Правила сервера обязаны проверять ... правильность результата открытия относительно приватного ключа"
  // and "Клиент капитана может создавать секретный ключ".
  // For reveal by guesser without reading key: the write includes position only in `actions`,
  // and we use a RTDB-triggered... no functions.
  //
  // Working approach used by many RTDB games without Functions:
  // Put each cell's role under `secret/roles/$pos` with `.read: false` but allow guesser to
  // WRITE `public/revealed/$pos` where validate says newData == root.secret.roles.$pos.
  // The guesser must still SEND the value. They can try all 4 values — 3 fail, 1 succeeds.
  // That's a leak via timing/oracle (4 attempts reveal the color). Mitigate by:
  // single action node: `reveals/{turnId}/{uid}/{pos}` write true, and public update done by... still need copy.
  //
  // Spec acceptance: "Оба угадывающих не получают его через SDK, REST, родительское чтение".
  // Trying 4 writes is a side channel. Prefer:
  // Store roles in secret; guesser writes action; BOTH captains have listeners that apply reveal
  // when they see action — if no captain online, queue until captain reconnects.
  // Host who is guesser cannot apply. This matches "awaiting captain" for deal.
  //
  // Implement: pendingReveals + captainApplyReveal.

  if (secret) {
    // Writer can read secret (captain testing as guesser shouldn't happen)
    const role = secret.roles[String(position)];
    if (!role) throw new Error("BAD_POSITION");
    await commitReveal(roomId, uid, pub, position, role);
    return;
  }

  await set(ref(db(), `rooms/${roomId}/actions/reveal-${pub.turnId}-${uid}-${position}`), {
    uid,
    position,
    turnId: pub.turnId,
    matchId: pub.matchId,
    version: pub.version,
    at: nowMs(),
  });
}

async function commitReveal(
  roomId: string,
  uid: string,
  pub: PublicMatch,
  position: number,
  role: CardRole,
): Promise<void> {
  const { match, outcome } = applyReveal(pub, position, role);
  const updates: Record<string, unknown> = {
    [`rooms/${roomId}/public`]: match,
  };
  if (outcome.kind === "win") {
    updates[`rooms/${roomId}/meta/status`] = "finished";
    updates[`rooms/${roomId}/meta/updatedAt`] = nowMs();
  }
  await update(ref(db()), updates);
  await appendEvent(roomId, {
    at: nowMs(),
    type: "reveal",
    actorUid: uid,
    payload: { position, role, outcome: outcome.kind },
  });
}

/** Captains process queued guesser reveals using secret access. */
export async function processPendingReveal(roomId: string, captainUid: string, actionId: string): Promise<void> {
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const captain = members.find((m) => m.uid === captainUid);
  if (!captain || captain.role !== "captain") throw new Error("FORBIDDEN_KEY");
  const actionSnap = await get(ref(db(), `rooms/${roomId}/actions/${actionId}`));
  if (!actionSnap.exists()) return;
  const action = actionSnap.val() as {
    uid: string;
    position: number;
    turnId: string;
    matchId: string;
    version: number;
  };
  const pub = (await get(ref(db(), `rooms/${roomId}/public`))).val() as PublicMatch;
  if (pub.turnId !== action.turnId || pub.version !== action.version || pub.matchId !== action.matchId) {
    await set(ref(db(), `rooms/${roomId}/actions/${actionId}`), null);
    return;
  }
  const secret = (await get(ref(db(), `rooms/${roomId}/secret/${pub.matchId}`))).val() as SecretKey;
  const role = secret.roles[String(action.position)];
  if (!role) throw new Error("BAD_POSITION");
  await commitReveal(roomId, action.uid, pub, action.position, role);
  await set(ref(db(), `rooms/${roomId}/actions/${actionId}`), null);
}

export function watchActions(roomId: string, cb: (ids: string[]) => void): Unsubscribe {
  return onValue(ref(db(), `rooms/${roomId}/actions`), (snap) => {
    const val = snap.val() as Record<string, unknown> | null;
    cb(val ? Object.keys(val).filter((k) => k.startsWith("reveal-")) : []);
  });
}

export function watchDealRequest(roomId: string, cb: (pending: boolean) => void): Unsubscribe {
  return onValue(ref(db(), `rooms/${roomId}/dealRequests/pending`), (snap) => {
    cb(snap.exists());
  });
}

export async function endTurnAction(roomId: string, uid: string): Promise<void> {
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const me = members.find((m) => m.uid === uid);
  const pub = (await get(ref(db(), `rooms/${roomId}/public`))).val() as PublicMatch;
  if (!me || me.team !== pub.currentTeam || (me.role !== "guesser" && me.role !== "captain")) {
    throw new Error("NOT_YOUR_TURN");
  }
  if (!canEndTurn(pub)) throw new Error("CANNOT_END_TURN");
  const next = endTurn(pub);
  await set(ref(db(), `rooms/${roomId}/public`), next);
  await appendEvent(roomId, {
    at: nowMs(),
    type: "turn_end",
    actorUid: uid,
    payload: { nextTeam: next.currentTeam },
  });
}

export async function rematch(roomId: string, hostId: string): Promise<void> {
  const meta = (await get(ref(db(), `rooms/${roomId}/meta`))).val() as RoomMeta;
  if (meta.hostId !== hostId) throw new Error("NOT_HOST");
  if (meta.status !== "finished") throw new Error("NOT_FINISHED");
  await update(ref(db()), {
    [`rooms/${roomId}/public`]: null,
    [`rooms/${roomId}/meta/status`]: "lobby",
    [`rooms/${roomId}/meta/matchId`]: null,
    [`rooms/${roomId}/meta/updatedAt`]: nowMs(),
    [`rooms/${roomId}/dealRequests`]: null,
  });
  await appendEvent(roomId, { at: nowMs(), type: "rematch", actorUid: hostId, payload: {} });
}

export async function transferHostIfStale(roomId: string, uid: string): Promise<void> {
  const meta = (await get(ref(db(), `rooms/${roomId}/meta`))).val() as RoomMeta;
  if (meta.hostId === uid) return;
  const hostMember = (await get(ref(db(), `rooms/${roomId}/members/${meta.hostId}`))).val() as Member | null;
  const hostPresence = (await get(ref(db(), `rooms/${roomId}/presence/${meta.hostId}`))).val() as
    | { online: boolean; at: number }
    | null;
  const stale =
    !hostMember ||
    (hostPresence && hostPresence.online === false && nowMs() - Number(hostPresence.at) > GAME.hostGraceMs) ||
    (hostMember && nowMs() - hostMember.lastSeenAt > GAME.hostGraceMs);
  if (!stale) return;
  await update(ref(db(), `rooms/${roomId}/meta`), { hostId: uid, updatedAt: nowMs() });
}

export { canStart, otherTeam };
