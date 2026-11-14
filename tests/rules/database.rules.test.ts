/**
 * Rules tests require Firebase emulators.
 * npm run test:rules starts an isolated emulator; initialization failures fail the suite.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, get, set, update, serverTimestamp } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { coerceRolesMap } from "../../src/domain/key";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT = "demo-hidden-pictures";

let testEnv: RulesTestEnvironment | null = null;
let available = false;

beforeAll(async () => {
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT,
      database: {
        host: "127.0.0.1",
        port: Number(process.env.FIREBASE_DATABASE_EMULATOR_HOST?.split(":")[1] || 9000),
        rules: readFileSync(join(root, "database.rules.json"), "utf8"),
      },
    });
    available = true;
  } catch (error) {
    throw new Error("Rules tests require a running isolated emulator", { cause: error });
  }
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  if (available && testEnv) await testEnv.clearDatabase();
});

function requireEmulators(skip: (reason?: string) => void): RulesTestEnvironment {
  if (!available || !testEnv) {
    skip("Firebase emulators unavailable (need Java + npm run emulators)");
    throw new Error("emulators unavailable");
  }
  return testEnv;
}

function buildRoles(start: "red" | "blue"): Record<string, string> {
  const roles: Record<string, string> = {};
  const first = start === "red" ? "red" : "blue";
  const second = start === "red" ? "blue" : "red";
  for (let i = 0; i < 8; i += 1) roles[String(i)] = first;
  for (let i = 8; i < 15; i += 1) roles[String(i)] = second;
  for (let i = 15; i < 19; i += 1) roles[String(i)] = "neutral";
  roles["19"] = "assassin";
  return roles;
}

async function seedPlayingRoom(
  env: RulesTestEnvironment,
  roomId: string,
  matchId: string,
  opts?: { status?: "playing" | "finished"; includeBlueCaptain?: boolean },
): Promise<Record<string, string>> {
  const roles = buildRoles("red");
  const status = opts?.status ?? "playing";
  const includeBlueCaptain = opts?.includeBlueCaptain ?? true;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, `rooms/${roomId}/meta`), {
      code: "KEYTST",
      hostId: "capRed",
      status,
      createdAt: 1,
      updatedAt: 1,
      packId: "hidden-mvp",
      matchId,
    });
    await set(ref(db, `rooms/${roomId}/members/capRed`), {
      uid: "capRed",
      displayName: "CapR",
      team: "red",
      role: "captain",
      joinedAt: 1,
      lastSeenAt: 1,
    });
    if (includeBlueCaptain) {
      await set(ref(db, `rooms/${roomId}/members/capBlue`), {
        uid: "capBlue",
        displayName: "CapB",
        team: "blue",
        role: "captain",
        joinedAt: 1,
        lastSeenAt: 1,
      });
    }
    await set(ref(db, `rooms/${roomId}/members/guessRed`), {
      uid: "guessRed",
      displayName: "GuessR",
      team: "red",
      role: "guesser",
      joinedAt: 1,
      lastSeenAt: 1,
    });
    await set(ref(db, `rooms/${roomId}/public`), {
      matchId,
      version: 1,
      turnId: `${matchId}-t1`,
      cardIds: Array.from({ length: 20 }, (_, i) => `c${i}`),
      startingTeam: "red",
      currentTeam: "blue",
      phase: "clue",
      clueWord: null,
      clueCount: null,
      guessesLeft: null,
      guessesMade: 0,
      remaining: { red: 8, blue: 7 },
      winner: null,
      winReason: null,
      createdAt: 1,
    });
    await set(ref(db, `rooms/${roomId}/secret/${matchId}`), {
      matchId,
      roles,
      captainRed: "capRed",
      captainBlue: "capBlue",
    });
  });
  return roles;
}

describe("database rules", () => {
  it("blocks guesser from reading secret and allows both captains the same key", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomKeyBoth";
    const matchId = "m1";
    const roles = await seedPlayingRoom(env, roomId, matchId);

    const red = env.authenticatedContext("capRed");
    const blue = env.authenticatedContext("capBlue");
    const guesser = env.authenticatedContext("guessRed");
    const redSnap = await assertSucceeds(get(ref(red.database(), `rooms/${roomId}/secret/${matchId}`)));
    const blueSnap = await assertSucceeds(get(ref(blue.database(), `rooms/${roomId}/secret/${matchId}`)));
    expect(coerceRolesMap(redSnap.val().roles)).toEqual(roles);
    expect(coerceRolesMap(blueSnap.val().roles)).toEqual(coerceRolesMap(redSnap.val().roles));
    await assertFails(get(ref(guesser.database(), `rooms/${roomId}/secret/${matchId}`)));
    await assertFails(get(ref(guesser.database(), `rooms/${roomId}/secret`)));
  });

  it("denies unauthenticated, stranger, and non-member key reads", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomKeyDenied";
    const matchId = "mDenied";
    await seedPlayingRoom(env, roomId, matchId);

    const unauth = env.unauthenticatedContext();
    const stranger = env.authenticatedContext("outsider");
    await assertFails(get(ref(unauth.database(), `rooms/${roomId}/secret/${matchId}`)));
    await assertFails(get(ref(stranger.database(), `rooms/${roomId}/secret/${matchId}`)));
  });

  it("revokes key read after captain demotion", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomDemote";
    const matchId = "mDemote";
    await seedPlayingRoom(env, roomId, matchId);

    const demoted = env.authenticatedContext("capRed");
    await assertSucceeds(get(ref(demoted.database(), `rooms/${roomId}/secret/${matchId}`)));

    await env.withSecurityRulesDisabled(async (ctx) => {
      await update(ref(ctx.database(), `rooms/${roomId}/members/capRed`), { role: "guesser" });
    });

    await assertFails(get(ref(demoted.database(), `rooms/${roomId}/secret/${matchId}`)));
  });

  it("blocks reading a previous rematch secret after meta.matchId advances", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomRematch";
    const oldMatch = "mOld";
    const newMatch = "mNew";
    await seedPlayingRoom(env, roomId, oldMatch);
    const newRoles = buildRoles("blue");

    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      await set(ref(db, `rooms/${roomId}/secret/${newMatch}`), {
        matchId: newMatch,
        roles: newRoles,
        captainRed: "capRed",
        captainBlue: "capBlue",
      });
      await update(ref(db, `rooms/${roomId}/meta`), { matchId: newMatch, updatedAt: 2 });
      await update(ref(db, `rooms/${roomId}/public`), { matchId: newMatch, startingTeam: "blue", currentTeam: "blue" });
    });

    const captain = env.authenticatedContext("capRed");
    await assertFails(get(ref(captain.database(), `rooms/${roomId}/secret/${oldMatch}`)));
    const fresh = await assertSucceeds(get(ref(captain.database(), `rooms/${roomId}/secret/${newMatch}`)));
    expect(coerceRolesMap(fresh.val().roles)).toEqual(newRoles);
  });

  it("lets a guesser enqueue a reveal action and blocks strangers", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomActions";
    const matchId = "mAct";
    await seedPlayingRoom(env, roomId, matchId);

    const guesser = env.authenticatedContext("guessRed");
    const stranger = env.authenticatedContext("outsider");
    const captain = env.authenticatedContext("capRed");
    await env.withSecurityRulesDisabled(async ctx => {
      await update(ref(ctx.database(), `rooms/${roomId}/public`), { currentTeam: "red", phase: "guess", guessesLeft: 3 });
    });
    const actionPath = `rooms/${roomId}/actions/reveal-${matchId}-t1-guessRed-3`;
    const payload = {
      uid: "guessRed",
      position: 3,
      turnId: `${matchId}-t1`,
      matchId,
      version: 1,
      at: 1,
    };
    await assertSucceeds(set(ref(guesser.database(), actionPath), payload));
    await assertSucceeds(get(ref(captain.database(), `rooms/${roomId}/actions`)));
    await assertFails(get(ref(guesser.database(), `rooms/${roomId}/actions`)));
    await assertFails(get(ref(guesser.database(), `rooms/${roomId}/secret/${matchId}`)));
    await assertFails(set(ref(stranger.database(), actionPath), { ...payload, uid: "outsider" }));
    await assertSucceeds(set(ref(captain.database(), actionPath), null));
  });

  it("allows a second reveal that rewrites existing revealed cells unchanged", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomSecondReveal";
    const matchId = "mReveal2";
    const roles = await seedPlayingRoom(env, roomId, matchId);
    const firstPos = "0";
    const secondPos = "1";
    const firstRole = roles[firstPos]!;
    const secondRole = roles[secondPos]!;

    await env.withSecurityRulesDisabled(async (ctx) => {
      await update(ref(ctx.database(), `rooms/${roomId}/public`), {
        revealed: { [firstPos]: firstRole },
        guessesMade: 1,
        guessesLeft: 2,
        remaining: {
          red: firstRole === "red" ? 7 : 8,
          blue: firstRole === "blue" ? 6 : 7,
        },
        version: 2,
        phase: "guess",
        clueWord: "тест",
        clueCount: 2,
      });
    });

    const opener = env.authenticatedContext("capBlue");
    const nextPublic = {
      matchId,
      version: 3,
      turnId: `${matchId}-t1`,
      cardIds: Array.from({ length: 20 }, (_, i) => `c${i}`),
      startingTeam: "red",
      currentTeam: "red",
      phase: "guess",
      clueWord: "тест",
      clueCount: 2,
      guessesLeft: 1,
      guessesMade: 2,
      revealed: { [firstPos]: firstRole, [secondPos]: secondRole },
      remaining: {
        red: (firstRole === "red" ? 7 : 8) - (secondRole === "red" ? 1 : 0),
        blue: (firstRole === "blue" ? 6 : 7) - (secondRole === "blue" ? 1 : 0),
      },
      winner: null,
      winReason: null,
      createdAt: 1,
    };
    await assertSucceeds(set(ref(opener.database(), `rooms/${roomId}/public`), nextPublic));
  });

  it("allows room members to read the active key only after the match finishes", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomFinished";
    const matchId = "mFin";
    const roles = await seedPlayingRoom(env, roomId, matchId, { status: "finished" });

    const guesser = env.authenticatedContext("guessRed");
    const snap = await assertSucceeds(get(ref(guesser.database(), `rooms/${roomId}/secret/${matchId}`)));
    expect(coerceRolesMap(snap.val().roles)).toEqual(roles);
  });

  it("allows host to create room meta and first member together", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "createRoom1";
    const host = env.authenticatedContext("hostCreate");
    await assertSucceeds(
      set(ref(host.database(), `rooms/${roomId}/meta`), {
        code: "CRT001",
        hostId: "hostCreate",
        status: "lobby",
        createdAt: 1,
        updatedAt: 1,
        packId: "hidden-mvp",
        matchId: null,
      }),
    );
    await assertSucceeds(
      set(ref(host.database(), `rooms/${roomId}/members/hostCreate`), {
        uid: "hostCreate",
        displayName: "Host",
        team: null,
        role: null,
        joinedAt: 1,
        lastSeenAt: 1,
      }),
    );
  });

  it("allows authenticated stranger to read lobby meta and join", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "lobbyJoin";
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      await set(ref(db, `rooms/${roomId}/meta`), {
        code: "WN2MZF",
        hostId: "host1",
        status: "lobby",
        createdAt: 1,
        updatedAt: 1,
        packId: "hidden-mvp",
        matchId: null,
      });
      await set(ref(db, `rooms/${roomId}/members/host1`), {
        uid: "host1",
        displayName: "Host",
        team: null,
        role: null,
        joinedAt: 1,
        lastSeenAt: 1,
      });
      await set(ref(db, `roomCodes/WN2MZF`), { roomId });
    });

    const joiner = env.authenticatedContext("guest2");
    await assertSucceeds(get(ref(joiner.database(), `roomCodes/WN2MZF`)));
    await assertSucceeds(get(ref(joiner.database(), `rooms/${roomId}/meta`)));
    await assertSucceeds(get(ref(joiner.database(), `rooms/${roomId}/members`)));
    await assertSucceeds(set(ref(joiner.database(), `rooms/${roomId}/joinLock`), { uid: "guest2", at: serverTimestamp() }));
    await assertSucceeds(
      set(ref(joiner.database(), `rooms/${roomId}/members/guest2`), {
        uid: "guest2",
        displayName: "Guest",
        team: null,
        role: null,
        joinedAt: 2,
        lastSeenAt: 2,
      }),
    );
  });

  it("keeps captain notes private to the owning captain", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "roomNotes";
    const matchId = "mNotes";
    await seedPlayingRoom(env, roomId, matchId);

    const red = env.authenticatedContext("capRed");
    const blue = env.authenticatedContext("capBlue");
    const guesser = env.authenticatedContext("guessRed");
    const notes = { matchId, marks: { "2": "own", "5": "assassin" } };

    await assertSucceeds(set(ref(red.database(), `rooms/${roomId}/captainNotes/capRed`), notes));
    await assertSucceeds(get(ref(red.database(), `rooms/${roomId}/captainNotes/capRed`)));
    await assertFails(get(ref(blue.database(), `rooms/${roomId}/captainNotes/capRed`)));
    await assertFails(get(ref(guesser.database(), `rooms/${roomId}/captainNotes/capRed`)));
    await assertFails(set(ref(guesser.database(), `rooms/${roomId}/captainNotes/guessRed`), notes));
    await assertFails(set(ref(blue.database(), `rooms/${roomId}/captainNotes/capRed`), notes));
  });

  it("blocks stranger from joining a playing room", async ({ skip }) => {
    const env = requireEmulators(skip);
    const roomId = "playingJoin";
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      await set(ref(db, `rooms/${roomId}/meta`), {
        code: "PLAY12",
        hostId: "host1",
        status: "playing",
        createdAt: 1,
        updatedAt: 1,
        packId: "hidden-mvp",
        matchId: "m1",
      });
      await set(ref(db, `rooms/${roomId}/members/host1`), {
        uid: "host1",
        displayName: "Host",
        team: "red",
        role: "captain",
        joinedAt: 1,
        lastSeenAt: 1,
      });
    });

    const stranger = env.authenticatedContext("latecomer");
    await assertFails(get(ref(stranger.database(), `rooms/${roomId}/meta`)));
    await assertFails(
      set(ref(stranger.database(), `rooms/${roomId}/members/latecomer`), {
        uid: "latecomer",
        displayName: "Late",
        team: null,
        role: null,
        joinedAt: 2,
        lastSeenAt: 2,
      }),
    );
  });
});


describe("QA privilege escalation regressions", () => {
  for (const [name, uid, path, patch] of [
    ["guesser self promotion", "guessRed", "members/guessRed", { role: "captain" }],
    ["stranger promotes an existing member", "outsider", "members/guessRed", { role: "captain" }],
    ["guesser finishes match to read key", "guessRed", "meta", { status: "finished" }],
    ["stranger hijacks host", "outsider", "meta", { hostId: "outsider" }],
    ["guesser forges winner", "guessRed", "public", { winner: "red" }],
  ] as const) {
    it(`denies ${name}`, async ({ skip }) => {
      const env = requireEmulators(skip);
      await seedPlayingRoom(env, "attack", "m1");
      await assertFails(update(ref(env.authenticatedContext(uid).database(), `rooms/attack/${path}`), patch));
    });
  }
});

describe('QA authorization and replay boundaries', () => {
  it('rejects opponent, stale and fractional reveal requests', async ({ skip }) => {
    const env = requireEmulators(skip);
    await seedPlayingRoom(env, 'queueBoundary', 'm1');
    const db = env.authenticatedContext('guessRed').database();
    const action = { uid: 'guessRed', position: 2, turnId: 'm1-t1', matchId: 'm1', version: 1, at: 1 };
    await assertFails(set(ref(db, 'rooms/queueBoundary/actions/reveal-wrong-turn'), action));
    await env.withSecurityRulesDisabled(async ctx => {
      await update(ref(ctx.database(), 'rooms/queueBoundary/public'), { currentTeam: 'red', phase: 'guess', guessesLeft: 3 });
    });
    await assertFails(set(ref(db, 'rooms/queueBoundary/actions/reveal-stale'), { ...action, version: 0 }));
    await assertFails(set(ref(db, 'rooms/queueBoundary/actions/reveal-fraction'), { ...action, position: 2.5 }));
    await assertSucceeds(set(ref(db, 'rooms/queueBoundary/actions/reveal-valid'), action));
  });
  it('rejects member deletion, host status bypass and key overwrite during play', async ({ skip }) => {
    const env = requireEmulators(skip);
    const roles = await seedPlayingRoom(env, 'immutable', 'm1');
    const outsider = env.authenticatedContext('outsider').database();
    const host = env.authenticatedContext('capRed').database();
    await assertFails(set(ref(outsider, 'rooms/immutable/members/capRed'), null));
    await assertFails(update(ref(host, 'rooms/immutable/meta'), { status: 'finished' }));
    await assertFails(set(ref(host, 'rooms/immutable/secret/m1'), { matchId: 'm1', roles, captainRed: 'capRed', captainBlue: 'capBlue' }));
    await assertFails(get(ref(outsider, 'profiles/capRed')));
  });
});

describe('QA key identity binding', () => {
  it('denies a third roster captain who was not selected into the active key', async ({ skip }) => {
    const env = requireEmulators(skip);
    await seedPlayingRoom(env, 'thirdCaptain', 'm1');
    await env.withSecurityRulesDisabled(async ctx => {
      await set(ref(ctx.database(), 'rooms/thirdCaptain/members/fakeCaptain'), {
        uid: 'fakeCaptain', displayName: 'Fake', team: 'red', role: 'captain', joinedAt: 1, lastSeenAt: 1,
      });
    });
    const db = env.authenticatedContext('fakeCaptain').database();
    await assertFails(get(ref(db, 'rooms/thirdCaptain/secret/m1')));
    await assertFails(update(ref(db, 'rooms/thirdCaptain/public'), { winner: 'red', version: 2 }));
    await assertFails(update(ref(db, 'rooms/thirdCaptain/meta'), { status: 'finished' }));
  });
});

describe('QA lobby join lease', () => {
  it('requires ownership for new seats, protects the lease and rejects extra roster fields', async ({ skip }) => {
    const env = requireEmulators(skip);
    await seedPlayingRoom(env, 'leaseRoom', 'm1');
    await env.withSecurityRulesDisabled(async ctx => {
      await update(ref(ctx.database(), 'rooms/leaseRoom/meta'), { status: 'lobby' });
    });
    const alice = env.authenticatedContext('alice').database();
    const bob = env.authenticatedContext('bob').database();
    const lease = 'rooms/leaseRoom/joinLock';
    const seat = { uid: 'alice', displayName: 'Alice', joinedAt: 1, lastSeenAt: 1 };
    await assertFails(set(ref(alice, 'rooms/leaseRoom/members/alice'), seat));
    await assertSucceeds(set(ref(alice, lease), { uid: 'alice', at: serverTimestamp() }));
    await assertFails(set(ref(bob, lease), { uid: 'bob', at: serverTimestamp() }));
    await assertFails(set(ref(bob, lease), null));
    await assertSucceeds(set(ref(alice, 'rooms/leaseRoom/members/alice'), seat));
    await assertFails(update(ref(alice, 'rooms/leaseRoom/members/alice'), { hiddenRole: 'captain' }));
    await env.withSecurityRulesDisabled(async ctx => {
      await set(ref(ctx.database(), lease), { uid: 'alice', at: Date.now() - 11_000 });
    });
    await assertSucceeds(set(ref(bob, lease), { uid: 'bob', at: serverTimestamp() }));
    await assertFails(set(ref(bob, lease), { uid: 'bob', at: 0 }));
    await assertSucceeds(set(ref(bob, lease), null));
  });
});
