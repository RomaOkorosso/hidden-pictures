export type Team = "red" | "blue";
export type CardRole = Team | "neutral" | "assassin";
export type SeatRole = "captain" | "guesser";
export type RoomStatus = "lobby" | "playing" | "finished";
export type Phase = "clue" | "guess" | "awaiting_deal";

export type Profile = {
  displayName: string;
  updatedAt: number;
};

export type Member = {
  uid: string;
  displayName: string;
  team: Team | null;
  role: SeatRole | null;
  joinedAt: number;
  lastSeenAt: number;
};

export type PublicMatch = {
  matchId: string;
  version: number;
  turnId: string;
  cardIds: string[];
  startingTeam: Team;
  currentTeam: Team;
  phase: Phase;
  clueWord: string | null;
  clueCount: number | null;
  guessesLeft: number | null;
  guessesMade: number;
  revealed: Record<string, CardRole>;
  remaining: { red: number; blue: number };
  winner: Team | null;
  winReason: "assassin" | "agents" | null;
  createdAt: number;
};

export type RoomMeta = {
  code: string;
  hostId: string;
  status: RoomStatus;
  createdAt: number;
  updatedAt: number;
  packId: string;
  matchId: string | null;
};

export type GameEvent = {
  id: string;
  at: number;
  type: string;
  actorUid: string | null;
  payload: Record<string, string | number | boolean | null>;
};

export type SecretKey = {
  matchId: string;
  roles: Record<string, CardRole>;
  captainRed: string;
  captainBlue: string;
};

export type RevealOutcome =
  | { kind: "continue"; role: Team; remaining: number; guessesLeft: number }
  | { kind: "turn_end"; role: CardRole; nextTeam: Team }
  | { kind: "win"; role: CardRole; winner: Team; reason: "assassin" | "agents" };
