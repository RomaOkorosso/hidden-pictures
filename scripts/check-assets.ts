import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packsRoot = join(root, "public/assets/packs");
const index = JSON.parse(readFileSync(join(packsRoot, "index.json"), "utf8")) as string[];

if (!Array.isArray(index) || index.length < 1) {
  throw new Error("assets: pack index empty");
}

for (const packId of index) {
  const manifestPath = join(packsRoot, packId, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`assets: missing manifest ${packId}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    cards: Array<{ id: string; image: string }>;
  };
  if (!manifest.cards || manifest.cards.length < 20) {
    throw new Error(`assets: pack ${packId} needs >= 20 cards, got ${manifest.cards?.length ?? 0}`);
  }
  const ids = new Set<string>();
  for (const card of manifest.cards) {
    if (!card.id || ids.has(card.id)) throw new Error(`assets: bad/duplicate id in ${packId}`);
    ids.add(card.id);
    const file = join(packsRoot, packId, card.image);
    if (!existsSync(file)) throw new Error(`assets: missing file ${packId}/${card.image}`);
  }
}

console.log(`assets ok: ${index.join(", ")}`);
