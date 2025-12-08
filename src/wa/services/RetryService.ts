export class RetryService {
  private baseDelay: number = 1000; // 1 segundo
  private maxDelay: number = 60000; // 60 segundos
  private multiplier: number = 2; // Backoff exponencial

  /**
   * Calcula delay para retry com backoff exponencial
   */
  getBackoffDelay(attempt: number): number {
    const delay = Math.min(
      this.baseDelay * Math.pow(this.multiplier, attempt - 1),
      this.maxDelay
    );

    // Adiciona jitter aleatório (±20%) para evitar thundering herd
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  /**
   * Executa uma função com retry
   */
  async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxAttempts) {
          const delay = this.getBackoffDelay(attempt);
          onRetry?.(attempt, lastError);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Configura o delay base
   */
  setBaseDelay(delay: number): void {
    this.baseDelay = delay;
  }

  /**
   * Configura o delay máximo
   */
  setMaxDelay(delay: number): void {
    this.maxDelay = delay;
  }

  /**
   * Configura o multiplicador
   */
  setMultiplier(multiplier: number): void {
    this.multiplier = multiplier;
  }
}

