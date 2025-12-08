/**
 * Interface para tratamento de erros
 */
export interface IErrorHandler {
  handle(error: unknown, context?: string): void;
  handleAndGetMessage(error: unknown, context?: string): string;
  isErrorOfType(error: unknown, type: string): boolean;
  createError(message: string, context?: string, originalError?: unknown): Error;
}

