export function log(message: string) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a request, waiting and trying again when the homeserver rate-limits it. */
export async function withRetry<T>(request: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const e = error as { errcode?: string; data?: { retry_after_ms?: unknown }; httpStatus?: number };
      const limited = e?.errcode === "M_LIMIT_EXCEEDED" || e?.httpStatus === 429;
      if (!limited || attempt >= attempts) throw error;
      const wait = typeof e.data?.retry_after_ms === "number" ? e.data.retry_after_ms : 1000 * attempt;
      await sleep(Math.min(wait, 60000) + 100);
    }
  }
}
