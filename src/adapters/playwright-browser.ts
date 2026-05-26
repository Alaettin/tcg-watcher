import type { Browser } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { logger } from "../lib/logger.js";

chromium.use(StealthPlugin());

let browserPromise: Promise<Browser> | null = null;
let lastUseAt = 0;
const IDLE_SHUTDOWN_MS = 5 * 60_000;
const LAUNCH_TIMEOUT_MS = 60_000;
let idleTimer: NodeJS.Timeout | null = null;

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

async function launchBrowser(): Promise<Browser> {
  logger.info("launching chromium (stealth)");
  const launchPromise = chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  }) as Promise<Browser>;

  const timeoutPromise = new Promise<Browser>((_, reject) =>
    setTimeout(
      () => reject(new Error(`browser launch timed out after ${LAUNCH_TIMEOUT_MS}ms`)),
      LAUNCH_TIMEOUT_MS,
    ),
  );

  const browser = await Promise.race([launchPromise, timeoutPromise]);

  // If chromium dies at runtime (OOM, page crash, signal), drop the cached
  // promise so the NEXT getBrowser() relaunches instead of handing out a
  // dead reference.
  browser.on("disconnected", () => {
    logger.warn("chromium disconnected — resetting singleton");
    if (browserPromise) {
      browserPromise = null;
      clearIdleTimer();
    }
  });

  return browser;
}

export async function getBrowser(): Promise<Browser> {
  lastUseAt = Date.now();
  if (!browserPromise) {
    // Wrap in an outer promise so a failed launch resets the cache and the
    // next caller retries from scratch. Without this, a single failed launch
    // poisons every future getBrowser() call forever.
    browserPromise = launchBrowser().catch((err) => {
      logger.error({ err }, "chromium launch failed — resetting singleton");
      browserPromise = null;
      clearIdleTimer();
      throw err;
    });
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
      const promise = browserPromise;
      browserPromise = null;
      idleTimer = null;
      try {
        const browser = await promise;
        await browser.close();
        logger.info("chromium idle-closed");
      } catch (error) {
        logger.warn({ err: error }, "chromium close failed");
      }
    }
  }, IDLE_SHUTDOWN_MS);
}

export async function closeBrowser(): Promise<void> {
  clearIdleTimer();
  if (browserPromise) {
    const promise = browserPromise;
    browserPromise = null;
    try {
      const browser = await promise;
      await browser.close();
    } catch (error) {
      logger.warn({ err: error }, "chromium close on shutdown failed");
    }
  }
}
