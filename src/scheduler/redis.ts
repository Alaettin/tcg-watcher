import "dotenv/config";
import IORedis, { type RedisOptions } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Reconnect aggressively on transient failures (container restart, network
  // blip). Without this, a brief Redis hiccup leaves the BullMQ workers in a
  // permanent reconnect loop with no recovery.
  retryStrategy: (times) => Math.min(times * 100, 3000),
  reconnectOnError: (err) => err.message.includes("READONLY"),
};

export function createRedisConnection(): IORedis {
  return new IORedis(REDIS_URL, baseOptions);
}
