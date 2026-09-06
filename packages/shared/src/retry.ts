export function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? ` ${err.cause.message}` : "";
  return `${msg}${cause}`;
}

export function isTransientError(err: unknown): boolean {
  return /timeout|abort|econnreset|etimedout|econnrefused|fetch failed|socket|network|502|503|504/i.test(
    errText(err),
  );
}

export async function withRetry<T>(
  label: string,
  delaysMs: readonly number[],
  op: () => Promise<T>,
  onRetry?: (label: string, err: unknown, delayMs: number, attempt: number) => void,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      const delay = delaysMs[attempt];
      if (delay === undefined || !isTransientError(err)) break;
      onRetry?.(label, err, delay, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
