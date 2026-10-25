import { describe, expect, it } from "vitest";
import { assertValidKey, dealRoles, otherTeam, rolesToMap, sampleCardIds, targetCount } from "../../src/domain/key";
import { normalizeClueWord } from "../../src/domain/clue";
import { applyReveal, applyClue, canEndTurn, endTurn, initialRemaining } from "../../src/domain/reveal";
import { canStart, randomizeCaptains, randomizeTeams } from "../../src/domain/lobby";
import type { Member, PublicMatch } from "../../src/domain/types";
import { guessesAllowed } from "../../src/domain/key";

describe("deal", () => {
  it("builds 8/7/4/1 without card-id coupling", () => {
    const roles = dealRoles("blue", () => 0.3);
    expect(roles).toHaveLength(20);
    expect(roles.filter((r) => r === "blue")).toHaveLength(8);
    expect(roles.filter((r) => r === "red")).toHaveLength(7);
    expect(roles.filter((r) => r === "neutral")).toHaveLength(4);
    expect(roles.filter((r) => r === "assassin")).toHaveLength(1);
    assertValidKey(rolesToMap(roles), "blue");
    expect(targetCount("blue", "blue")).toBe(8);
    expect(targetCount("red", "blue")).toBe(7);
  });

  it("samples 20 unique ids", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `card_${i}`);
    const board = sampleCardIds(ids, () => 0.2);
    expect(board).toHaveLength(20);
    expect(new Set(board).size).toBe(20);
  });
});

describe("clue and reveal", () => {
  function base(): PublicMatch {
    return {
      matchId: "m1",
      version: 1,
      turnId: "m1-t1",
      cardIds: Array.from({ length: 20 }, (_, i) => `c${i}`),
      startingTeam: "red",
      currentTeam: "red",
      phase: "clue",
      clueWord: null,
      clueCount: null,
      guessesLeft: null,
      guessesMade: 0,
      revealed: {},
      remaining: initialRemaining("red"),
      winner: null,
      winReason: null,
      createdAt: 1,
    };
  }

  it("accepts hyphenated unicode clue and N+1", () => {
    expect(normalizeClueWord("маяк-2")).toBe("маяк-2");
    expect(() => normalizeClueWord("два слова")).toThrow("BAD_CLUE");
    expect(guessesAllowed(3)).toBe(4);
  });

  it("continues on own card and ends on neutral", () => {
    let match = applyClue(base(), "океан", 2, 3);
    const own = applyReveal(match, 0, "red");
    expect(own.outcome.kind).toBe("continue");
    match = own.match;
    const neutral = applyReveal(match, 1, "neutral");
    expect(neutral.outcome.kind).toBe("turn_end");
    expect(neutral.match.currentTeam).toBe("blue");
    expect(neutral.match.phase).toBe("clue");
  });

  it("assassin and last enemy agent decide winner", () => {
    const a = applyClue(base(), "нож", 1, 2);
    const dead = applyReveal(a, 3, "assassin");
    expect(dead.outcome).toMatchObject({ kind: "win", winner: "blue", reason: "assassin" });

    let match = applyClue(base(), "гора", 1, 2);
    match = { ...match, remaining: { red: 8, blue: 1 } };
    const last = applyReveal(match, 4, "blue");
    expect(last.outcome).toMatchObject({ kind: "win", winner: "blue", reason: "agents" });
  });

  it("manual end requires at least one guess", () => {
    const match = applyClue(base(), "луч", 1, 2);
    expect(canEndTurn(match)).toBe(false);
    const after = applyReveal(match, 0, "red").match;
    expect(canEndTurn(after)).toBe(true);
    expect(endTurn(after).currentTeam).toBe("blue");
  });
});

describe("lobby", () => {
  function seat(uid: string, team: Member["team"], role: Member["role"]): Member {
    return { uid, displayName: uid, team, role, joinedAt: 1, lastSeenAt: 1 };
  }

  it("requires captains and guessers on both sides", () => {
    const members = [
      seat("a", "red", "captain"),
      seat("b", "red", "guesser"),
      seat("c", "blue", "captain"),
      seat("d", "blue", "guesser"),
    ];
    expect(canStart(members)).toBe(true);
    expect(canStart(members.slice(0, 3))).toBe(false);
  });

  it("random seating balances and does not force first member captain", () => {
    const members = Array.from({ length: 6 }, (_, i) => seat(`u${i}`, null, null));
    const teams = randomizeTeams(members, () => 0.1);
    const red = teams.filter((m) => m.team === "red").length;
    const blue = teams.filter((m) => m.team === "blue").length;
    expect(Math.abs(red - blue)).toBeLessThanOrEqual(1);
    const caps = randomizeCaptains(teams, () => 0.9);
    expect(caps.filter((m) => m.role === "captain")).toHaveLength(2);
    expect(otherTeam("red")).toBe("blue");
  });
});
