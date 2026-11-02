import type { Member, SeatRole, Team } from "./types";
import { otherTeam, shuffleInPlace } from "./key";

export function teamCounts(members: Member[]): { red: number; blue: number; unassigned: number } {
  let red = 0;
  let blue = 0;
  let unassigned = 0;
  for (const m of members) {
    if (m.team === "red") red += 1;
    else if (m.team === "blue") blue += 1;
    else unassigned += 1;
  }
  return { red, blue, unassigned };
}

export function captainOf(members: Member[], team: Team): Member | undefined {
  return members.find((m) => m.team === team && m.role === "captain");
}

export function guessersOf(members: Member[], team: Team): Member[] {
  return members.filter((m) => m.team === team && m.role === "guesser");
}

export function teamSize(members: Member[], team: Team): number {
  return members.filter((m) => m.team === team).length;
}

/**
 * Who may open cards on the current team's guess phase.
 * Classic: field players of currentTeam.
 * Duo training (no field on currentTeam): the opposite captain guesses.
 */
export function mayOpenCards(members: Member[], uid: string, currentTeam: Team): boolean {
  const me = members.find((m) => m.uid === uid);
  if (!me) return false;
  if (me.team === currentTeam && me.role === "guesser") return true;
  if (
    me.role === "captain" &&
    me.team === otherTeam(currentTeam) &&
    guessersOf(members, currentTeam).length === 0
  ) {
    return true;
  }
  return false;
}

export function canStart(members: Member[]): boolean {
  if (members.length < 2 || members.length > 12) return false;
  if (members.some((m) => m.team == null || m.role == null)) return false;
  for (const team of ["red", "blue"] as const) {
    if (!captainOf(members, team)) return false;
    const size = teamSize(members, team);
    if (size < 1) return false;
    // Classic: 2+ on a side need a field player.
    // Duo (1 per side): opposite captain opens cards as training.
    if (size >= 2 && guessersOf(members, team).length < 1) return false;
  }
  return true;
}

export function randomizeTeams(members: Member[], rng: () => number = Math.random): Member[] {
  const order = shuffleInPlace([...members], rng);
  const half = Math.ceil(order.length / 2);
  return order.map((member, index) => ({
    ...member,
    team: index < half ? "red" : "blue",
    role: "guesser" as SeatRole,
  }));
}

/** Pick one random captain per team from current team members. Host is not preferred. */
export function randomizeCaptains(members: Member[], rng: () => number = Math.random): Member[] {
  const next = members.map((m) => ({ ...m, role: (m.team ? "guesser" : null) as SeatRole | null }));
  for (const team of ["red", "blue"] as const) {
    const pool = next.filter((m) => m.team === team);
    if (pool.length === 0) continue;
    const pick = pool[Math.floor(rng() * pool.length)] as Member;
    const idx = next.findIndex((m) => m.uid === pick.uid);
    next[idx] = { ...next[idx]!, role: "captain" };
  }
  return next;
}

export function assignSeat(
  members: Member[],
  uid: string,
  team: Team | null,
  role: SeatRole | null,
): Member[] {
  if (team == null) {
    return members.map((m) => (m.uid === uid ? { ...m, team: null, role: null } : m));
  }
  if (role == null) throw new Error("BAD_ASSIGNMENT");
  let next = members.map((m) => ({ ...m }));
  if (role === "captain") {
    next = next.map((m) =>
      m.team === team && m.role === "captain" && m.uid !== uid ? { ...m, role: "guesser" } : m,
    );
  }
  return next.map((m) => (m.uid === uid ? { ...m, team, role } : m));
}
