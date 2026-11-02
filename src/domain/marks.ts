import { otherTeam } from "./key";
import type { CardRole, Team } from "./types";

/** Private captain annotations relative to their own team. */
export type CaptainMarkKind = "own" | "enemy" | "neutral" | "assassin";

export const CAPTAIN_MARK_KINDS: CaptainMarkKind[] = ["own", "enemy", "neutral", "assassin"];

export type CaptainNotes = {
  matchId: string;
  marks: Record<string, CaptainMarkKind>;
};

export function captainMarkRole(team: Team, kind: CaptainMarkKind): CardRole {
  if (kind === "own") return team;
  if (kind === "enemy") return otherTeam(team);
  return kind;
}

export function normalizeCaptainNotes(
  raw: CaptainNotes | null | undefined,
  matchId: string,
): Record<string, CaptainMarkKind> {
  if (!raw || raw.matchId !== matchId) return {};
  const marks = raw.marks ?? {};
  const next: Record<string, CaptainMarkKind> = {};
  for (const [pos, kind] of Object.entries(marks)) {
    if (CAPTAIN_MARK_KINDS.includes(kind)) next[pos] = kind;
  }
  return next;
}

export function withCaptainMark(
  marks: Record<string, CaptainMarkKind>,
  position: number,
  kind: CaptainMarkKind | null,
): Record<string, CaptainMarkKind> {
  const next = { ...marks };
  const key = String(position);
  if (kind == null) delete next[key];
  else next[key] = kind;
  return next;
}
