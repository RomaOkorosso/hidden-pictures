import { describe, expect, it } from "vitest";
import {
  assertValidKey,
  coerceRolesMap,
  dealRoles,
  otherTeam,
  rolesToMap,
  sampleCardIds,
  targetCount,
} from "../../src/domain/key";
import { normalizeClueWord } from "../../src/domain/clue";
import { applyReveal, applyClue, canEndTurn, endTurn, initialRemaining, normalizePublicMatch } from "../../src/domain/reveal";
import { canStart, mayOpenCards, randomizeCaptains, randomizeTeams } from "../../src/domain/lobby";
import { cellCoords, cellIndex, orderedKeyCells, toCaptainKeyView } from "../../src/domain/board";
import { captainMarkRole, normalizeCaptainNotes, withCaptainMark } from "../../src/domain/marks";
import { GAME } from "../../src/config/brand";
import type { CardRole, Member, PublicMatch } from "../../src/domain/types";
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

  it("builds 8/7/4/1 when red starts", () => {
    const roles = dealRoles("red", () => 0.7);
    expect(roles.filter((r) => r === "red")).toHaveLength(8);
    expect(roles.filter((r) => r === "blue")).toHaveLength(7);
    assertValidKey(rolesToMap(roles), "red");
  });

  it("coerces RTDB array-shaped roles back to a position map", () => {
    const asArray = dealRoles("red", () => 0.1);
    const fromArray = coerceRolesMap(asArray);
    const fromMap = coerceRolesMap(rolesToMap(asArray));
    expect(fromArray).toEqual(fromMap);
    assertValidKey(fromArray, "red");
  });

  it("samples 20 unique ids", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `card_${i}`);
    const board = sampleCardIds(ids, () => 0.2);
    expect(board).toHaveLength(20);
    expect(new Set(board).size).toBe(20);
  });
});

describe("captain key board layout", () => {
  it("uses 5×4 row-major indices", () => {
    expect(GAME.cols).toBe(5);
    expect(GAME.rows).toBe(4);
    expect(GAME.boardSize).toBe(20);
    expect(cellIndex(0, 0)).toBe(0);
    expect(cellIndex(0, 4)).toBe(4);
    expect(cellIndex(1, 0)).toBe(5);
    expect(cellIndex(3, 4)).toBe(19);
    expect(cellCoords(19)).toEqual({ row: 3, column: 4 });
  });

  it("orders key cells for the modal without mutating source roles", () => {
    const roles = rolesToMap(dealRoles("red", () => 0.1));
    const snapshot = structuredClone(roles);
    const view = toCaptainKeyView("m-view", "red", roles);
    expect(view.matchId).toBe("m-view");
    expect(view.startingTeam).toBe("red");
    expect(view.cells).toEqual(orderedKeyCells(roles));
    expect(view.cells).toHaveLength(20);
    expect(roles).toEqual(snapshot);
  });

  it("rejects incomplete role maps", () => {
    const incomplete: Record<string, CardRole> = { "0": "red" };
    expect(() => orderedKeyCells(incomplete)).toThrow("BAD_KEY_POSITIONS");
  });
});

describe("captain private marks", () => {
  it("maps own/enemy relative to the captain team", () => {
    expect(captainMarkRole("red", "own")).toBe("red");
    expect(captainMarkRole("red", "enemy")).toBe("blue");
    expect(captainMarkRole("blue", "own")).toBe("blue");
    expect(captainMarkRole("blue", "enemy")).toBe("red");
    expect(captainMarkRole("red", "neutral")).toBe("neutral");
    expect(captainMarkRole("red", "assassin")).toBe("assassin");
  });

  it("drops notes from a previous match and toggles marks", () => {
    expect(normalizeCaptainNotes({ matchId: "old", marks: { "0": "own" } }, "new")).toEqual({});
    expect(withCaptainMark({ "1": "enemy" }, 1, null)).toEqual({});
    expect(withCaptainMark({}, 3, "assassin")).toEqual({ "3": "assassin" });
  });
});

describe("viewing key does not mutate public match", () => {
  it("leaves public fields untouched when building a view", () => {
    const match: PublicMatch = {
      matchId: "m-stable",
      version: 4,
      turnId: "m-stable-t2",
      cardIds: Array.from({ length: 20 }, (_, i) => `c${i}`),
      startingTeam: "blue",
      currentTeam: "red",
      phase: "guess",
      clueWord: "маяк",
      clueCount: 2,
      guessesLeft: 2,
      guessesMade: 1,
      revealed: { "3": "neutral" },
      remaining: { red: 8, blue: 7 },
      winner: null,
      winReason: null,
      createdAt: 1,
    };
    const before = structuredClone(match);
    const roles = rolesToMap(dealRoles("blue", () => 0.2));
    toCaptainKeyView(match.matchId, match.startingTeam, roles);
    expect(match).toEqual(before);
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

  it("restores revealed dropped by RTDB empty-object omission", () => {
    const raw = { ...base(), revealed: undefined as unknown as PublicMatch["revealed"] };
    const normalized = normalizePublicMatch(raw);
    expect(normalized.revealed).toEqual({});
    expect(normalized.revealed["0"]).toBeUndefined();
  });

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
    // Missing blue captain
    expect(canStart([seat("a", "red", "captain"), seat("b", "red", "guesser"), seat("c", "blue", "guesser")])).toBe(false);
    // Two on blue without a field player
    expect(
      canStart([
        seat("a", "red", "captain"),
        seat("b", "blue", "captain"),
        seat("c", "blue", "captain"),
      ]),
    ).toBe(false);
  });

  it("allows duo training with two captains; opposite captain opens cards", () => {
    const duo = [seat("a", "red", "captain"), seat("b", "blue", "captain")];
    expect(canStart(duo)).toBe(true);
    expect(mayOpenCards(duo, "a", "red")).toBe(false);
    expect(mayOpenCards(duo, "b", "red")).toBe(true);
    expect(mayOpenCards(duo, "a", "blue")).toBe(true);
    expect(mayOpenCards(duo, "b", "blue")).toBe(false);
  });

  it("keeps classic field guessing when a team has guessers", () => {
    const members = [
      seat("a", "red", "captain"),
      seat("b", "red", "guesser"),
      seat("c", "blue", "captain"),
      seat("d", "blue", "guesser"),
    ];
    expect(mayOpenCards(members, "b", "red")).toBe(true);
    expect(mayOpenCards(members, "c", "red")).toBe(false);
    expect(mayOpenCards(members, "a", "red")).toBe(false);
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
