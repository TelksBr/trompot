/**
 * Interface para serviços de logging
 */
export interface ILoggerService {
  fatal(obj: any, msg?: string): void;
  error(obj: any, msg?: string): void;
  warn(obj: any, msg?: string): void;
  info(obj: any, msg?: string): void;
  debug(obj: any, msg?: string): void;
  trace(obj: any, msg?: string): void;
  setLevel(level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'): void;
  getLevel(): 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

