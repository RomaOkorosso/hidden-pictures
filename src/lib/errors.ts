const CODES = [
  "FIREBASE_NOT_CONFIGURED",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "MATCH_LOCKED",
  "NOT_HOST",
  "NOT_LOBBY",
  "NOT_FINISHED",
  "NOT_YOUR_TURN",
  "NOT_GUESS_PHASE",
  "NOT_CLUE_PHASE",
  "BAD_CLUE",
  "BAD_CLUE_COUNT",
  "BAD_NAME",
  "BAD_CODE",
  "BAD_POSITION",
  "ALREADY_REVEALED",
  "NEED_ROLES",
  "NO_DEAL",
  "NOT_DEALER",
  "FORBIDDEN_KEY",
  "STALE",
  "CANNOT_END_TURN",
  "CODE_COLLISION",
  "ROOM_CREATE",
  "PACK_TOO_SMALL",
  "AUTH",
] as const;

export type ErrCode = (typeof CODES)[number] | "UNKNOWN";

export function matchError(raw: unknown): ErrCode {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  for (const code of CODES) if (text.includes(code)) return code;
  return "UNKNOWN";
}
