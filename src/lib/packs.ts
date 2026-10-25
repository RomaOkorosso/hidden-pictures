export type PackCard = { id: string; image: string };
export type PackManifest = {
  id: string;
  name: string;
  nameRu?: string;
  cover?: string;
  width?: number;
  height?: number;
  cards: PackCard[];
};

export function assetUrl(packId: string, file: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}assets/packs/${packId}/${file}`.replace(/\/{2,}/g, "/").replace(":/", "://");
}

export function roomInviteUrl(code: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${window.location.origin}${base}#/room/${code}`;
}

export async function loadPack(id: string): Promise<PackManifest> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/packs/${id}/manifest.json`);
  if (!response.ok) throw new Error("PACK_LOAD");
  const data = (await response.json()) as PackManifest;
  if (!data.cards || data.cards.length < 20) throw new Error("PACK_TOO_SMALL");
  return data;
}

export async function loadPackIndex(): Promise<string[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/packs/index.json`);
  if (!response.ok) throw new Error("PACK_INDEX");
  return (await response.json()) as string[];
}
