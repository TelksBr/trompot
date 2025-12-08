import { ILoggerService } from '../interfaces/ILoggerService';
import { IErrorHandler } from '../interfaces/IErrorHandler';
import { ErrorHandler } from '../services/ErrorHandler';
import ErrorMessage from '../../messages/ErrorMessage';
import { fixID } from '../ID';

/**
 * Utilitários para tratamento padronizado de erros
 */
export class ErrorUtils {
  /**
   * Trata erro em handler de eventos e emite evento de erro
   */
  static handleHandlerError(
    error: unknown,
    context: string,
    logger: ILoggerService,
    bot: { emit: (event: string, data: any) => void }
  ): void {
    const errorHandler = new ErrorHandler(logger);
    errorHandler.handle(error, context);
    bot.emit('error', error);
  }

  /**
   * Trata erro em processamento de mensagem e retorna ErrorMessage
   */
  static handleMessageError(
    error: unknown,
    remoteJid: string | undefined | null,
    logger?: ILoggerService
  ): ErrorMessage {
    if (logger) {
      logger.error('Erro ao processar mensagem', error);
    }

    const errorObj = error instanceof Error 
      ? error 
      : new Error(JSON.stringify(error));

    return new ErrorMessage(
      fixID(remoteJid || ''),
      errorObj
    );
  }

  /**
   * Wrapper para executar função assíncrona com tratamento de erro padronizado
   */
  static async safeExecute<T>(
    fn: () => Promise<T>,
    context: string,
    logger: ILoggerService,
    bot: { emit: (event: string, data: any) => void },
    onError?: (error: unknown) => void
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      ErrorUtils.handleHandlerError(error, context, logger, bot);
      if (onError) {
        onError(error);
      }
      return undefined;
    }
  }

  /**
   * Wrapper para executar função síncrona com tratamento de erro padronizado
   */
  static safeExecuteSync<T>(
    fn: () => T,
    context: string,
    logger: ILoggerService,
    bot: { emit: (event: string, data: any) => void },
    onError?: (error: unknown) => void
  ): T | undefined {
    try {
      return fn();
    } catch (error) {
      ErrorUtils.handleHandlerError(error, context, logger, bot);
      if (onError) {
        onError(error);
      }
      return undefined;
    }
  }
}


