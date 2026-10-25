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
});
