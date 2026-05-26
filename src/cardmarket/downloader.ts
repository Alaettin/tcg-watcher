import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import axios from "axios";
import { logger } from "../lib/logger.js";
import { getCardmarketConfig } from "../lib/settings.js";
import {
  PRICE_GUIDE_PATH,
  PRODUCTS_PATH,
  ensureCardmarketDir,
} from "./storage.js";

const REQUEST_TIMEOUT_MS = 120_000;

async function downloadToFile(url: string, target: string): Promise<number> {
  const log = logger.child({ scope: "cm-download", url });
  const tmp = `${target}.tmp`;
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: REQUEST_TIMEOUT_MS,
    headers: { "User-Agent": "tcg-watcher/cardmarket-sync" },
  });

  await pipeline(res.data, createWriteStream(tmp));

  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }

  const size = Number(res.headers["content-length"] ?? 0);
  log.info({ size }, "downloaded");
  return size;
}

export interface DownloadResult {
  pricesBytes: number;
  productsBytes: number;
}

export async function refreshCardmarketFiles(): Promise<DownloadResult> {
  await ensureCardmarketDir();
  const cfg = await getCardmarketConfig();
  const pricesBytes = await downloadToFile(cfg.priceGuideUrl, PRICE_GUIDE_PATH);
  const productsBytes = await downloadToFile(cfg.productsUrl, PRODUCTS_PATH);
  return { pricesBytes, productsBytes };
}
