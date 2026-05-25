import type { Browser } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { logger } from "../lib/logger.js";

chromium.use(StealthPlugin());

let browserPromise: Promise<Browser> | null = null;
let lastUseAt = 0;
const IDLE_SHUTDOWN_MS = 5 * 60_000;
let idleTimer: NodeJS.Timeout | null = null;

async function launchBrowser(): Promise<Browser> {
  logger.info("launching chromium (stealth)");
  return chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  }) as Promise<Browser>;
}

export async function getBrowser(): Promise<Browser> {
  lastUseAt = Date.now();
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }
  scheduleIdleShutdown();
  return browserPromise;
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (Date.now() - lastUseAt < IDLE_SHUTDOWN_MS) {
      scheduleIdleShutdown();
      return;
    }
    if (browserPromise) {
      const browser = await browserPromise;
      browserPromise = null;
      idleTimer = null;
      try {
        await browser.close();
        logger.info("chromium idle-closed");
      } catch (error) {
        logger.warn({ err: error }, "chromium close failed");
      }
    }
  }, IDLE_SHUTDOWN_MS);
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
  }
}
