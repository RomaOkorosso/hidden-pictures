import { GAME } from "../config/brand";

const WORD_RE = /^[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?$/u;

export function normalizeClueWord(raw: string): string {
  const word = raw.trim();
  if (word.length < 1 || word.length > GAME.clueWordMax) throw new Error("BAD_CLUE");
  if (/\s/u.test(word) || /[<>&]/.test(word)) throw new Error("BAD_CLUE");
  if (!WORD_RE.test(word)) throw new Error("BAD_CLUE");
  return word;
}

export function normalizeDisplayName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < GAME.nameMin || name.length > GAME.nameMax) throw new Error("BAD_NAME");
  if (/[<>]/.test(name)) throw new Error("BAD_NAME");
  return name;
}

export function normalizeRoomCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "");
  if (code.length !== GAME.codeLength) throw new Error("BAD_CODE");
  return code;
}

export function randomRoomCode(rng: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < GAME.codeLength; i += 1) {
    out += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return out;
}
