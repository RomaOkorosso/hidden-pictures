export const brand = {
  id: "hidden-pictures",
  nameRu: "Тайные образы",
  nameEn: "Hidden Pictures",
  taglineRu: "Приватная партия друзей: два капитана, двадцать картинок.",
  taglineEn: "A private match for friends: two captains, twenty pictures.",
} as const;

export const GAME = {
  boardSize: 20,
  cols: 5,
  rows: 4,
  minPlayers: 4,
  maxPlayers: 12,
  clueMin: 1,
  clueMax: 8,
  clueWordMax: 32,
  nameMin: 2,
  nameMax: 24,
  codeLength: 6,
  hostGraceMs: 90_000,
  presenceStaleMs: 45_000,
} as const;
