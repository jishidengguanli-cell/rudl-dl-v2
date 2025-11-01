const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isMetaDurationError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const message = error.message ?? '';
  return typeof message === 'string' && message.includes("reading 'duration'");
};

type RetryableOperation<T> = () => Promise<T>;

export async function runWithD1Retry<T>(
  operation: RetryableOperation<T>,
  context: string,
  maxAttempts = 5,
  baseDelay = 50
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (isMetaDurationError(error)) {
        lastError = error;
        const delay = baseDelay * attempt;
        console.warn('[d1] meta.duration missing, retrying', { context, attempt, delay });
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  console.error('[d1] meta.duration missing after retries', { context, attempts: maxAttempts, error: lastError });
  throw lastError instanceof Error ? lastError : new Error('D1 meta.duration missing after retries');
}

