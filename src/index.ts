import "dotenv/config";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandledRejection (continuing)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException (continuing)");
});
import { seedShops } from "./seed/shops.js";
import { seedProducts } from "./seed/products.js";
import { seedSettings } from "./seed/settings.js";
import { seedSetPresets } from "./seed/sets.js";
import { startScheduler } from "./scheduler/queue.js";
import { runShop } from "./worker/runShop.js";
import { closeBrowser } from "./adapters/playwright-browser.js";
import { startWebServer } from "./web/server.js";

async function main() {
  const mode = process.argv[2] ?? "scheduler";

  await seedShops();
  await seedSettings();
  await seedSetPresets();
  const products = await seedProducts();
  logger.info({ products: products.length }, "watchlist ready");

  if (mode === "once") {
    const shopArg = process.argv[3];
    const shops = await prisma.shop.findMany({
      where: shopArg ? { id: shopArg } : { enabled: true },
    });
    for (const shop of shops) {
      await runShop(shop.id);
    }
    await closeBrowser();
    await prisma.$disconnect();
    return;
  }

  const { stop: stopScheduler } = await startScheduler();
  logger.info("scheduler started");

  const { stop: stopWeb } = await startWebServer();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutdown initiated");
    await stopWeb();
    await stopScheduler();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal: bootstrap failed");
  process.exit(1);
});
