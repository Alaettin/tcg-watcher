import axios, { type AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import type { Logger } from "pino";

const MAX_ATTEMPTS = 3;

function isRetriable(err: unknown): boolean {
  const status = (err as AxiosError).response?.status ?? 0;
  // Retry on network errors (no response) and on 5xx / 429
  return !status || status >= 500 || status === 429;
}

export async function httpGetWithRetry<T = string>(
  url: string,
  config: AxiosRequestConfig,
  log?: Logger,
): Promise<AxiosResponse<T>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await axios.get<T>(url, config);
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err) || attempt === MAX_ATTEMPTS - 1) throw err;
      const delay = 500 * Math.pow(4, attempt); // 500ms, then 2000ms
      const status = (err as AxiosError).response?.status ?? 0;
      log?.warn({ url, status, attempt: attempt + 1, delayMs: delay }, "retrying HTTP request");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
