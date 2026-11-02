/**
 * Rules tests require Firebase emulators.
 * They are skipped automatically when emulators are not reachable.
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
import { ref, get, set } from "firebase/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
        port: 9000,
        rules: readFileSync(join(root, "database.rules.json"), "utf8"),
      },
    });
    available = true;
  } catch {
    available = false;
    testEnv = null;
  }
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("database rules", () => {
  it("blocks guesser from reading secret and allows captain", async () => {
    if (!available || !testEnv) {
      expect(available, "start emulators for rules tests: npm run emulators").toBe(false);
      return;
    }
    const roomId = "room1";
    const matchId = "m1";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      await set(ref(db, `rooms/${roomId}/meta`), {
        code: "ABC234",
        hostId: "host1",
        status: "playing",
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
      await set(ref(db, `rooms/${roomId}/members/guessRed`), {
        uid: "guessRed",
        displayName: "GuessR",
        team: "red",
        role: "guesser",
        joinedAt: 1,
        lastSeenAt: 1,
      });
      const roles: Record<string, string> = {};
      for (let i = 0; i < 8; i += 1) roles[String(i)] = "red";
      for (let i = 8; i < 15; i += 1) roles[String(i)] = "blue";
      for (let i = 15; i < 19; i += 1) roles[String(i)] = "neutral";
      roles["19"] = "assassin";
      await set(ref(db, `rooms/${roomId}/secret/${matchId}`), {
        matchId,
        roles,
        captainRed: "capRed",
        captainBlue: "capBlue",
      });
    });

    const captain = testEnv.authenticatedContext("capRed");
    const guesser = testEnv.authenticatedContext("guessRed");
    await assertSucceeds(get(ref(captain.database(), `rooms/${roomId}/secret/${matchId}`)));
    await assertFails(get(ref(guesser.database(), `rooms/${roomId}/secret/${matchId}`)));
    await assertFails(get(ref(guesser.database(), `rooms/${roomId}/secret`)));
  });

  it("allows host to create room meta and first member together", async () => {
    if (!available || !testEnv) {
      expect(available, "start emulators for rules tests: npm run emulators").toBe(false);
      return;
    }
    const roomId = "createRoom1";
    const host = testEnv.authenticatedContext("hostCreate");
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
    // Multipath-equivalent: member write while meta already present (join/create second step)
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

  it("allows authenticated stranger to read lobby meta and join", async () => {
    if (!available || !testEnv) {
      expect(available, "start emulators for rules tests: npm run emulators").toBe(false);
      return;
    }
    const roomId = "lobbyJoin";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
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

    const joiner = testEnv.authenticatedContext("guest2");
    await assertSucceeds(get(ref(joiner.database(), `roomCodes/WN2MZF`)));
    await assertSucceeds(get(ref(joiner.database(), `rooms/${roomId}/meta`)));
    await assertSucceeds(get(ref(joiner.database(), `rooms/${roomId}/members`)));
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

  it("blocks stranger from joining a playing room", async () => {
    if (!available || !testEnv) {
      expect(available, "start emulators for rules tests: npm run emulators").toBe(false);
      return;
    }
    const roomId = "playingJoin";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
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

    const stranger = testEnv.authenticatedContext("latecomer");
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
