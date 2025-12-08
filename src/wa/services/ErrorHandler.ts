import { LoggerService } from './LoggerService';

export class ErrorHandler {
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Trata um erro de forma centralizada
   */
  handle(error: unknown, context?: string): void {
    const errorMessage = this.getErrorMessage(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const contextInfo = context ? `[${context}]` : '';

    // Log estruturado
    this.logger.error({
      error: errorMessage,
      stack: errorStack,
      context: contextInfo,
      timestamp: new Date().toISOString(),
    }, `Erro ${contextInfo}`);

    // Em produção, você pode adicionar:
    // - Envio para serviço de monitoramento (Sentry, etc)
    // - Alertas
    // - Métricas
  }

  /**
   * Trata um erro e retorna uma mensagem amigável
   */
  handleAndGetMessage(error: unknown, context?: string): string {
    this.handle(error, context);
    return this.getErrorMessage(error);
  }

  /**
   * Extrai mensagem de erro de forma segura
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return 'Erro desconhecido';
  }

  /**
   * Verifica se um erro é de um tipo específico
   */
  isErrorOfType(error: unknown, type: string): boolean {
    if (error instanceof Error) {
      return error.name === type || error.constructor.name === type;
    }
    return false;
  }

  /**
   * Cria um erro customizado com contexto
   */
  createError(message: string, context?: string, originalError?: unknown): Error {
    const contextInfo = context ? `[${context}] ` : '';
    const error = new Error(`${contextInfo}${message}`);
    
    if (originalError instanceof Error) {
      error.stack = originalError.stack;
      // Nota: error.cause não está disponível no target es2018
      // Se necessário, pode ser adicionado como propriedade customizada
    }

    return error;
  }
}

