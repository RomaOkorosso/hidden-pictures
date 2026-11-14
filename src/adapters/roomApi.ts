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
import {
  coerceRolesMap,
  guessesAllowed,
  dealRoles,
  otherTeam,
  pickStartingTeam,
  rolesToMap,
  sampleCardIds,
} from "../domain/key";
import {
  normalizeCaptainNotes,
  withCaptainMark,
  type CaptainMarkKind,
  type CaptainNotes,
} from "../domain/marks";
import { applyClue, applyReveal, canEndTurn, endTurn, initialRemaining, normalizePublicMatch } from "../domain/reveal";
import { assignSeat, canStart, mayOpenCards, randomizeCaptains, randomizeTeams } from "../domain/lobby";
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

  // Write meta first so member validate can see lobby status via root (not only multipath newData).
  try {
    await set(ref(db(), `rooms/${roomId}/meta`), meta);
    await set(ref(db(), `rooms/${roomId}/members/${uid}`), member);
  } catch (error) {
    await set(ref(db(), `roomCodes/${code}`), null).catch(() => undefined);
    await set(ref(db(), `rooms/${roomId}`), null).catch(() => undefined);
    throw error;
  }

  return { roomId, code };
}

export async function resolveCode(codeRaw: string): Promise<string> {
  const code = normalizeRoomCode(codeRaw);
  const snap = await get(ref(db(), `roomCodes/${code}`));
  if (!snap.exists()) throw new Error("ROOM_NOT_FOUND");
  return String((snap.val() as { roomId: string }).roomId);
}

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  return /permission[ _]denied/i.test(`${code} ${message}`);
}

export async function joinRoom(roomId: string, uid: string, displayName: string): Promise<void> {
  const name = normalizeDisplayName(displayName);
  let meta: RoomMeta;
  try {
    const metaSnap = await get(ref(db(), `rooms/${roomId}/meta`));
    if (!metaSnap.exists()) throw new Error("ROOM_NOT_FOUND");
    meta = metaSnap.val() as RoomMeta;
  } catch (error) {
    if (error instanceof Error && error.message === "ROOM_NOT_FOUND") throw error;
    if (isPermissionDenied(error)) throw new Error("MATCH_LOCKED");
    throw error;
  }
  if (meta.status !== "lobby") {
    try {
      const existing = await get(ref(db(), `rooms/${roomId}/members/${uid}`));
      if (!existing.exists()) throw new Error("MATCH_LOCKED");
      await update(ref(db(), `rooms/${roomId}/members/${uid}`), { lastSeenAt: nowMs() });
    } catch (error) {
      if (error instanceof Error && (error.message === "MATCH_LOCKED" || error.message === "ROOM_NOT_FOUND")) throw error;
      if (isPermissionDenied(error)) throw new Error("MATCH_LOCKED");
      throw error;
    }
    return;
  }
  const memberRef = ref(db(), `rooms/${roomId}/members/${uid}`);
  if ((await get(memberRef)).exists()) {
    await update(memberRef, { displayName: name, lastSeenAt: nowMs() });
    return;
  }
  // Serialize new seats with a bounded, server-timestamped lobby lease. A roster
  // transaction would require granting parent writes over other users' records.
  const lockRef = ref(db(), `rooms/${roomId}/joinLock`);
  const offset = await new Promise<number>((resolve, reject) => {
    onValue(ref(db(), ".info/serverTimeOffset"), snap => resolve(Number(snap.val()) || 0), reject, { onlyOnce: true });
  });
  const deadline = nowMs() + 20_000;
  let acquired = false;
  const disconnect = onDisconnect(lockRef);
  try {
    while (nowMs() < deadline) {
      const lease = await runTransaction(lockRef, current => {
        if (current && current.uid !== uid && Number(current.at) + 10_000 > nowMs() + offset) return;
        return { uid, at: serverTimestamp() };
      }, { applyLocally: false });
      if (lease.committed) { acquired = true; break; }
      await new Promise(resolve => window.setTimeout(resolve, 100 + Math.random() * 100));
    }
    if (!acquired) throw new Error("ROOM_BUSY");
    await disconnect.remove();
    const members = ((await get(ref(db(), `rooms/${roomId}/members`))).val() ?? {}) as Record<string, Member>;
    if (!members[uid] && Object.keys(members).length >= GAME.maxPlayers) throw new Error("ROOM_FULL");
    if (!members[uid]) {
      await set(memberRef, { uid, displayName: name, team: null, role: null, joinedAt: nowMs(), lastSeenAt: nowMs() });
    }
  } catch (error) {
    if (isPermissionDenied(error)) throw new Error("MATCH_LOCKED");
    throw error;
  } finally {
    if (acquired) {
      await set(lockRef, null).catch(() => undefined);
      await disconnect.cancel().catch(() => undefined);
    }
  }
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
      handlers.onPublic(snap.exists() ? normalizePublicMatch(snap.val() as PublicMatch) : null);
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
  const disconnect = onDisconnect(presenceRef);
  let stopped = false;
  let connected = false;
  let generation = 0;
  // onDisconnect is one-shot: re-arm it on EVERY connection, before announcing online.
  const stopConnection = onValue(ref(db(), ".info/connected"), snap => {
    connected = snap.val() === true;
    const current = ++generation;
    if (!connected || stopped) return;
    void (async () => {
      await disconnect.set({ online: false, at: serverTimestamp() });
      if (stopped || current !== generation) return;
      await set(presenceRef, { online: true, at: nowMs() });
    })().catch(() => undefined);
  });
  const timer = window.setInterval(() => {
    if (!connected || stopped) return;
    void update(ref(db(), `rooms/${roomId}/members/${uid}`), { lastSeenAt: nowMs() }).catch(() => undefined);
    void set(presenceRef, { online: true, at: nowMs() }).catch(() => undefined);
  }, 20_000);
  return () => {
    stopped = true;
    ++generation;
    stopConnection();
    window.clearInterval(timer);
    void disconnect.cancel().catch(() => undefined);
    void set(presenceRef, { online: false, at: nowMs() }).catch(() => undefined);
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
  for (const m of next) {
    const previous = members.find(member => member.uid === m.uid)!;
    if (previous.role !== m.role || previous.team !== m.team) updates[`rooms/${roomId}/members/${m.uid}`] = m;
  }
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
  if (!canStart(members)) throw new Error("NEED_ROLES");
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
  // Omit empty `revealed: {}` — RTDB drops empty maps anyway; normalizePublicMatch restores on read.
  const pub: Omit<PublicMatch, "revealed"> = {
    matchId,
    version: 1,
    turnId: `${matchId}-t1`,
    cardIds,
    startingTeam: pending.startingTeam,
    duoTraining: members.length === 2 && members.every(m => m.role === "captain"),
    currentTeam: pending.startingTeam,
    phase: "clue",
    clueWord: null,
    clueCount: null,
    guessesLeft: null,
    guessesMade: 0,
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

/** One-shot private key read. Authz is enforced by RTDB rules (captain or finished member). */
export async function fetchCaptainKey(roomId: string, matchId: string): Promise<SecretKey> {
  try {
    const snap = await get(ref(db(), `rooms/${roomId}/secret/${matchId}`));
    if (!snap.exists()) throw new Error("FORBIDDEN_KEY");
    const raw = snap.val() as SecretKey;
    if (raw.matchId !== matchId) throw new Error("STALE");
    return { ...raw, roles: coerceRolesMap(raw.roles) };
  } catch (error) {
    if (error instanceof Error && (error.message === "FORBIDDEN_KEY" || error.message === "STALE")) throw error;
    if (isPermissionDenied(error)) throw new Error("FORBIDDEN_KEY");
    throw error;
  }
}

export async function watchSecret(
  roomId: string,
  matchId: string,
  cb: (key: SecretKey | null) => void,
): Promise<Unsubscribe> {
  return onValue(
    ref(db(), `rooms/${roomId}/secret/${matchId}`),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      const raw = snap.val() as SecretKey;
      cb(raw.matchId === matchId ? { ...raw, roles: coerceRolesMap(raw.roles) } : null);
    },
    () => {
      // Permission denied or network: never keep a stale key in memory.
      cb(null);
    },
  );
}

/** Private captain card marks — only the owning uid can read/write (RTDB rules). */
export function watchCaptainNotes(
  roomId: string,
  uid: string,
  matchId: string,
  cb: (marks: Record<string, CaptainMarkKind>) => void,
): Unsubscribe {
  return onValue(
    ref(db(), `rooms/${roomId}/captainNotes/${uid}`),
    (snap) => {
      cb(normalizeCaptainNotes(snap.exists() ? (snap.val() as CaptainNotes) : null, matchId));
    },
    () => {
      cb({});
    },
  );
}

export async function setCaptainCardMark(
  roomId: string,
  uid: string,
  matchId: string,
  position: number,
  kind: CaptainMarkKind | null,
): Promise<void> {
  if (position < 0 || position >= GAME.boardSize) throw new Error("BAD_POSITION");
  const path = ref(db(), `rooms/${roomId}/captainNotes/${uid}`);
  const snap = await get(path);
  const current = normalizeCaptainNotes(snap.exists() ? (snap.val() as CaptainNotes) : null, matchId);
  const marks = withCaptainMark(current, position, kind);
  if (Object.keys(marks).length === 0) {
    await set(path, null);
    return;
  }
  const payload: CaptainNotes = { matchId, marks };
  await set(path, payload);
}

export async function giveClue(roomId: string, uid: string, wordRaw: string, count: number): Promise<void> {
  const word = normalizeClueWord(wordRaw);
  const guesses = guessesAllowed(count);
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const me = members.find((m) => m.uid === uid);
  const pub = normalizePublicMatch((await get(ref(db(), `rooms/${roomId}/public`))).val() as PublicMatch);
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

export async function guessCard(
  roomId: string,
  uid: string,
  position: number,
  expectedVersion: number,
): Promise<"applied" | "queued"> {
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const me = members.find((m) => m.uid === uid);
  const pubSnap = await get(ref(db(), `rooms/${roomId}/public`));
  const pub = normalizePublicMatch(pubSnap.val() as PublicMatch);
  if (pub.version !== expectedVersion) throw new Error("STALE");
  if (!me || !mayOpenCards(members, uid, pub.currentTeam)) throw new Error("NOT_YOUR_TURN");
  if (pub.phase !== "guess") throw new Error("NOT_GUESS_PHASE");
  if (pub.revealed[String(position)]) throw new Error("ALREADY_REVEALED");

  // Captains can read secret and apply immediately. Guessers get PERMISSION_DENIED — queue instead.
  let secret: SecretKey | null = null;
  try {
    const secretRaw = (await get(ref(db(), `rooms/${roomId}/secret/${pub.matchId}`))).val() as SecretKey | null;
    if (secretRaw) secret = { ...secretRaw, roles: coerceRolesMap(secretRaw.roles) };
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
  }

  if (secret) {
    const role = secret.roles[String(position)];
    if (!role) throw new Error("BAD_POSITION");
    await commitReveal(roomId, uid, pub, position, role);
    return "applied";
  }

  try {
    await set(ref(db(), `rooms/${roomId}/actions/reveal-${pub.turnId}-${uid}-${position}`), {
      uid,
      position,
      turnId: pub.turnId,
      matchId: pub.matchId,
      version: pub.version,
      at: nowMs(),
    });
  } catch (error) {
    if (isPermissionDenied(error)) throw new Error("REVEAL_DENIED");
    throw error;
  }
  return "queued";
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
  try {
    await update(ref(db()), updates);
  } catch (error) {
    if (isPermissionDenied(error)) throw new Error("REVEAL_DENIED");
    throw error;
  }
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
  const pub = normalizePublicMatch((await get(ref(db(), `rooms/${roomId}/public`))).val() as PublicMatch);
  if (pub.turnId !== action.turnId || pub.version !== action.version || pub.matchId !== action.matchId) {
    await set(ref(db(), `rooms/${roomId}/actions/${actionId}`), null);
    return;
  }
  try {
    const secretRaw = (await get(ref(db(), `rooms/${roomId}/secret/${pub.matchId}`))).val() as SecretKey;
    const secret = { ...secretRaw, roles: coerceRolesMap(secretRaw.roles) };
    const role = secret.roles[String(action.position)];
    if (!role) throw new Error("BAD_POSITION");
    if (!pub.revealed[String(action.position)]) {
      await commitReveal(roomId, action.uid, pub, action.position, role);
    }
  } catch (error) {
    // Drop stale/duplicate queue items; keep real failures visible in console only.
    if (!(error instanceof Error && (error.message === "ALREADY_REVEALED" || error.message === "STALE" || error.message === "MATCH_OVER" || error.message === "NO_GUESSES" || error.message === "NOT_GUESS_PHASE"))) {
      if (!isPermissionDenied(error)) throw error;
    }
  }
  await set(ref(db(), `rooms/${roomId}/actions/${actionId}`), null);
}

export function watchActions(roomId: string, cb: (ids: string[]) => void): Unsubscribe {
  return onValue(
    ref(db(), `rooms/${roomId}/actions`),
    (snap) => {
      const val = snap.val() as Record<string, unknown> | null;
      cb(val ? Object.keys(val).filter((k) => k.startsWith("reveal-")) : []);
    },
    () => {
      cb([]);
    },
  );
}

export function watchDealRequest(roomId: string, cb: (initializer: string | null) => void): Unsubscribe {
  return onValue(ref(db(), `rooms/${roomId}/dealRequests/pending`), (snap) => {
    cb(snap.exists() ? String(snap.val().initializer) : null);
  });
}

export async function endTurnAction(roomId: string, uid: string): Promise<void> {
  const members = Object.values(((await get(ref(db(), `rooms/${roomId}/members`))).val() as Record<string, Member>) ?? {});
  const me = members.find((m) => m.uid === uid);
  const pub = normalizePublicMatch((await get(ref(db(), `rooms/${roomId}/public`))).val() as PublicMatch);
  const canEndAsOpener = mayOpenCards(members, uid, pub.currentTeam);
  const canEndAsCaptain = me?.team === pub.currentTeam && me.role === "captain";
  if (!me || (!canEndAsOpener && !canEndAsCaptain)) {
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

export { canStart, mayOpenCards, otherTeam };
