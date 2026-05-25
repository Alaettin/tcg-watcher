import "dotenv/config";
import pino from "pino";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const logLevel = process.env.LOG_LEVEL ?? "info";
const logFile = process.env.LOG_FILE ?? "data/events.log";
const absoluteLogFile = resolve(process.cwd(), logFile);

mkdirSync(dirname(absoluteLogFile), { recursive: true });

const transport = pino.transport({
  targets: [
    {
      target: "pino-pretty",
      level: logLevel,
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
    {
      target: "pino-roll",
      level: logLevel,
      options: {
        file: absoluteLogFile,
        frequency: "daily",
        size: "10m",
        limit: { count: 10 },
        mkdir: true,
      },
    },
  ],
});

function compactErrorSerializer(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { value: err };
  const e = err as { name?: string; message?: string; code?: string; stack?: string; response?: { status?: number; statusText?: string }; config?: { url?: string } };
  const out: Record<string, unknown> = {};
  if (e.name) out.name = e.name;
  if (e.message) out.message = e.message;
  if (e.code) out.code = e.code;
  if (e.response?.status) out.status = e.response.status;
  if (e.response?.statusText) out.statusText = e.response.statusText;
  if (e.config?.url) out.url = e.config.url;
  return out;
}

export const logger = pino(
  { level: logLevel, serializers: { err: compactErrorSerializer } },
  transport,
);
