import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { heartbeatRouter } from "./routes/heartbeat.js";
import { shopsRouter } from "./routes/shops.js";
import { productsRouter } from "./routes/products.js";
import { eventsRouter } from "./routes/events.js";
import { listingsRouter } from "./routes/listings.js";
import { settingsRouter } from "./routes/settings.js";
import { setsRouter } from "./routes/sets.js";
import { listsRouter } from "./routes/lists.js";
import { prospekteRouter } from "./routes/prospekte.js";
import { adminRouter } from "./routes/admin.js";

const PORT = Number(process.env.WEB_PORT ?? 3000);
const USER = process.env.WEB_USERNAME ?? "admin";
const PASS = process.env.WEB_PASSWORD ?? "";

const STATIC_DIR = resolve(process.cwd(), "dist/public");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="pokemon-watcher", charset="UTF-8"');
    res.status(401).end();
    return;
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const user = idx >= 0 ? decoded.slice(0, idx) : "";
  const pass = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (safeEqual(user, USER) && safeEqual(pass, PASS)) {
    next();
    return;
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="pokemon-watcher", charset="UTF-8"');
  res.status(401).end();
}

export async function startWebServer(): Promise<{ stop: () => Promise<void> }> {
  if (!PASS) {
    logger.warn("WEB_PASSWORD empty — web UI will be disabled. Set it in .env to enable.");
    return { stop: async () => {} };
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.use(basicAuth);

  app.use("/api", heartbeatRouter);
  app.use("/api", shopsRouter);
  app.use("/api", productsRouter);
  app.use("/api", eventsRouter);
  app.use("/api", listingsRouter);
  app.use("/api", settingsRouter);
  app.use("/api", setsRouter);
  app.use("/api", listsRouter);
  app.use("/api", prospekteRouter);
  app.use("/api", adminRouter);

  if (existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR, { index: "index.html", maxAge: "1h" }));
    app.use((_req, res) => {
      res.sendFile(resolve(STATIC_DIR, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res.status(200).type("text/html").send(
        `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
          <h1>Pokemon Watcher</h1>
          <p>Frontend wurde noch nicht gebaut. Im Projekt-Root: <code>cd web && npm install && npm run build</code></p>
          <p>API ist trotzdem erreichbar unter <a href="/api/heartbeat">/api/heartbeat</a>.</p>
        </body></html>`,
      );
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "web request failed");
    res.status(500).json({ error: "internal server error" });
  });

  const server = await new Promise<import("http").Server>((resolveListen) => {
    const s = app.listen(PORT, () => {
      logger.info({ port: PORT, user: USER }, "web server listening");
      resolveListen(s);
    });
  });

  return {
    stop: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}
