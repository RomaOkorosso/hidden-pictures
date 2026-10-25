import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("assets", () => {
  it("ships >=20 unique cards with files on disk", () => {
    const index = JSON.parse(readFileSync(join(root, "public/assets/packs/index.json"), "utf8")) as string[];
    expect(index.length).toBeGreaterThan(0);
    for (const packId of index) {
      const manifest = JSON.parse(
        readFileSync(join(root, "public/assets/packs", packId, "manifest.json"), "utf8"),
      ) as { cards: Array<{ id: string; image: string }> };
      expect(manifest.cards.length).toBeGreaterThanOrEqual(20);
      expect(new Set(manifest.cards.map((c) => c.id)).size).toBe(manifest.cards.length);
      for (const card of manifest.cards) {
        expect(existsSync(join(root, "public/assets/packs", packId, card.image))).toBe(true);
      }
    }
  });
});
