import pino, { Logger } from 'pino';
import { ILoggerService } from '../interfaces/ILoggerService';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export class LoggerService implements ILoggerService {
  private logger: Logger;
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
    
    // Se for 'silent', não cria transport para evitar logs
    if (level === 'silent') {
      this.logger = pino({ level: 'silent' });
      return;
    }
    
    this.logger = pino({
      level,
      transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      } : undefined,
    });
  }

  /**
   * Obtém o logger pino (para uso direto se necessário)
   */
  getLogger(): Logger {
    return this.logger;
  }

  /**
   * Log fatal
   */
  fatal(obj: any, msg?: string): void {
    this.logger.fatal(obj, msg);
  }

  /**
   * Log error
   */
  error(obj: any, msg?: string): void {
    this.logger.error(obj, msg);
  }

  /**
   * Log warn
   */
  warn(obj: any, msg?: string): void {
    this.logger.warn(obj, msg);
  }

  /**
   * Log info
   */
  info(obj: any, msg?: string): void {
    this.logger.info(obj, msg);
  }

  /**
   * Log debug
   */
  debug(obj: any, msg?: string): void {
    this.logger.debug(obj, msg);
  }

  /**
   * Log trace
   */
  trace(obj: any, msg?: string): void {
    this.logger.trace(obj, msg);
  }

  /**
   * Define o nível de log
   */
  setLevel(level: LogLevel): void {
    this.level = level;
    this.logger.level = level;
  }

  /**
   * Retorna o nível atual
   */
  getLevel(): LogLevel {
    return this.level;
  }
}

