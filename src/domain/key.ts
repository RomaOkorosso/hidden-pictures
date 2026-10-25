import type { CardRole, Team } from "./types";
import { GAME } from "../config/brand";

export function otherTeam(team: Team): Team {
  return team === "red" ? "blue" : "red";
}

export function targetCount(team: Team, starting: Team): number {
  return team === starting ? 8 : 7;
}

/** Fisher–Yates; caller supplies rng in [0,1). */
export function shuffleInPlace<T>(items: T[], rng: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}

export function pickStartingTeam(rng: () => number = Math.random): Team {
  return rng() < 0.5 ? "red" : "blue";
}

export function buildRoleList(starting: Team): CardRole[] {
  const other = otherTeam(starting);
  return [
    ...Array.from({ length: 8 }, (): CardRole => starting),
    ...Array.from({ length: 7 }, (): CardRole => other),
    ...Array.from({ length: 4 }, (): CardRole => "neutral"),
    "assassin",
  ];
}

export function dealRoles(starting: Team, rng: () => number = Math.random): CardRole[] {
  return shuffleInPlace(buildRoleList(starting), rng);
}

export function rolesToMap(roles: CardRole[]): Record<string, CardRole> {
  if (roles.length !== GAME.boardSize) throw new Error("BAD_KEY_SIZE");
  const map: Record<string, CardRole> = {};
  roles.forEach((role, index) => {
    map[String(index)] = role;
  });
  return map;
}

export function assertValidKey(roles: Record<string, CardRole>, starting: Team): void {
  const values = Array.from({ length: GAME.boardSize }, (_, i) => roles[String(i)]);
  if (values.some((v) => v == null)) throw new Error("BAD_KEY_POSITIONS");
  const counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
  for (const role of values) {
    counts[role as CardRole] += 1;
  }
  if (counts[starting] !== 8) throw new Error("BAD_KEY_STARTING");
  if (counts[otherTeam(starting)] !== 7) throw new Error("BAD_KEY_OTHER");
  if (counts.neutral !== 4 || counts.assassin !== 1) throw new Error("BAD_KEY_FILLER");
}

export function sampleCardIds(allIds: string[], rng: () => number = Math.random): string[] {
  if (allIds.length < GAME.boardSize) throw new Error("PACK_TOO_SMALL");
  const unique = [...new Set(allIds)];
  if (unique.length < GAME.boardSize) throw new Error("PACK_DUPLICATES");
  return shuffleInPlace([...unique], rng).slice(0, GAME.boardSize);
}

export function guessesAllowed(clueCount: number): number {
  if (!Number.isInteger(clueCount) || clueCount < GAME.clueMin || clueCount > GAME.clueMax) {
    throw new Error("BAD_CLUE_COUNT");
  }
  return clueCount + 1;
}
