import { GAME } from "../config/brand";
import type { CardRole, Team } from "./types";

/** Row-major index on the 5×4 board: index = row * cols + column (zero-based). */
export function cellIndex(row: number, column: number, cols = GAME.cols): number {
  return row * cols + column;
}

export function cellCoords(index: number, cols = GAME.cols): { row: number; column: number } {
  return { row: Math.floor(index / cols), column: index % cols };
}

export function orderedKeyCells(
  roles: Record<string, CardRole>,
  size = GAME.boardSize,
): CardRole[] {
  return Array.from({ length: size }, (_, index) => {
    const role = roles[String(index)];
    if (!role) throw new Error("BAD_KEY_POSITIONS");
    return role;
  });
}

export type CaptainKeyView = {
  matchId: string;
  startingTeam: Team;
  cells: CardRole[];
};

export function toCaptainKeyView(
  matchId: string,
  startingTeam: Team,
  roles: Record<string, CardRole>,
): CaptainKeyView {
  return {
    matchId,
    startingTeam,
    cells: orderedKeyCells(roles),
  };
}
