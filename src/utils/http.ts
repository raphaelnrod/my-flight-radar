import { sleep } from './time.js';

export interface FetchRetryOptions {
  retries: number;
  timeoutMs: number;
  /** Atraso base do backoff exponencial. */
  backoffMs: number;
}

const DEFAULTS: FetchRetryOptions = { retries: 2, timeoutMs: 20_000, backoffMs: 1_500 };

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/** fetch com timeout, retry e backoff exponencial (429/5xx/erros de rede). */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: Partial<FetchRetryOptions> = {},
): Promise<Response> {
  const { retries, timeoutMs, backoffMs } = { ...DEFAULTS, ...options };
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (isRetryableStatus(response.status) && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
