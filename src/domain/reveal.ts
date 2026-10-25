import { otherTeam } from "./key";
import type { CardRole, PublicMatch, RevealOutcome, Team } from "./types";

export function applyReveal(
  match: PublicMatch,
  position: number,
  role: CardRole,
): { match: PublicMatch; outcome: RevealOutcome } {
  if (match.winner) throw new Error("MATCH_OVER");
  if (match.phase !== "guess") throw new Error("NOT_GUESS_PHASE");
  if (match.guessesLeft == null || match.guessesLeft <= 0) throw new Error("NO_GUESSES");
  const key = String(position);
  if (position < 0 || position > 19) throw new Error("BAD_POSITION");
  if (match.revealed[key]) throw new Error("ALREADY_REVEALED");

  const revealed = { ...match.revealed, [key]: role };
  const guessesMade = match.guessesMade + 1;
  const guessesLeft = match.guessesLeft - 1;
  const remaining = { ...match.remaining };

  if (role === "assassin") {
    const winner = otherTeam(match.currentTeam);
    const next: PublicMatch = {
      ...match,
      revealed,
      guessesMade,
      guessesLeft: 0,
      phase: "guess",
      winner,
      winReason: "assassin",
      version: match.version + 1,
    };
    return { match: next, outcome: { kind: "win", role, winner, reason: "assassin" } };
  }

  if (role === "red" || role === "blue") {
    remaining[role] -= 1;
    if (remaining[role] < 0) throw new Error("BAD_REMAINING");
    if (remaining[role] === 0) {
      const next: PublicMatch = {
        ...match,
        revealed,
        remaining,
        guessesMade,
        guessesLeft: 0,
        winner: role,
        winReason: "agents",
        version: match.version + 1,
      };
      return { match: next, outcome: { kind: "win", role, winner: role, reason: "agents" } };
    }
  }

  if (role === match.currentTeam) {
    if (guessesLeft <= 0) {
      const nextTeam = otherTeam(match.currentTeam);
      const next: PublicMatch = {
        ...match,
        revealed,
        remaining,
        guessesMade,
        guessesLeft: null,
        clueWord: null,
        clueCount: null,
        currentTeam: nextTeam,
        phase: "clue",
        turnId: `${match.matchId}-t${match.version + 1}`,
        version: match.version + 1,
      };
      return { match: next, outcome: { kind: "turn_end", role, nextTeam } };
    }
    const next: PublicMatch = {
      ...match,
      revealed,
      remaining,
      guessesMade,
      guessesLeft,
      version: match.version + 1,
    };
    return {
      match: next,
      outcome: { kind: "continue", role, remaining: remaining[role], guessesLeft },
    };
  }

  // neutral or enemy — end turn (enemy already decremented above)
  const nextTeam = otherTeam(match.currentTeam);
  const next: PublicMatch = {
    ...match,
    revealed,
    remaining,
    guessesMade,
    guessesLeft: null,
    clueWord: null,
    clueCount: null,
    currentTeam: nextTeam,
    phase: "clue",
    turnId: `${match.matchId}-t${match.version + 1}`,
    version: match.version + 1,
  };
  return { match: next, outcome: { kind: "turn_end", role, nextTeam } };
}

export function canEndTurn(match: PublicMatch): boolean {
  return match.phase === "guess" && match.guessesMade >= 1 && !match.winner;
}

export function endTurn(match: PublicMatch): PublicMatch {
  if (!canEndTurn(match)) throw new Error("CANNOT_END_TURN");
  const nextTeam = otherTeam(match.currentTeam);
  return {
    ...match,
    phase: "clue",
    clueWord: null,
    clueCount: null,
    guessesLeft: null,
    guessesMade: 0,
    currentTeam: nextTeam,
    turnId: `${match.matchId}-t${match.version + 1}`,
    version: match.version + 1,
  };
}

export function applyClue(match: PublicMatch, word: string, count: number, guessesLeft: number): PublicMatch {
  if (match.winner) throw new Error("MATCH_OVER");
  if (match.phase !== "clue") throw new Error("NOT_CLUE_PHASE");
  return {
    ...match,
    phase: "guess",
    clueWord: word,
    clueCount: count,
    guessesLeft,
    guessesMade: 0,
    version: match.version + 1,
  };
}

export function initialRemaining(starting: Team): { red: number; blue: number } {
  return starting === "red" ? { red: 8, blue: 7 } : { red: 7, blue: 8 };
}
