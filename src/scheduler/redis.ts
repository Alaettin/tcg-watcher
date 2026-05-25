import "dotenv/config";
import IORedis, { type RedisOptions } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export function createRedisConnection(): IORedis {
  return new IORedis(REDIS_URL, baseOptions);
}
