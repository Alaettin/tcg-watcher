import { mkdir } from "node:fs/promises";
import path from "node:path";

const CARDMARKET_DATA_DIR = process.env.CARDMARKET_DATA_DIR ?? "data/cardmarket";

export const CARDMARKET_DIR = path.resolve(process.cwd(), CARDMARKET_DATA_DIR);
export const PRICE_GUIDE_PATH = path.join(CARDMARKET_DIR, "price_guide_6.json");
export const PRODUCTS_PATH = path.join(CARDMARKET_DIR, "products_nonsingles_6.json");

export async function ensureCardmarketDir(): Promise<void> {
  await mkdir(CARDMARKET_DIR, { recursive: true });
}
