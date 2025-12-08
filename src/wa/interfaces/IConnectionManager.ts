import { WASocket, SocketConfig, ConnectionState } from '@whiskeysockets/baileys';
import { IStateManager, ConnectionStatus } from './IStateManager';
import { ISessionManager } from './ISessionManager';
import { IErrorHandler } from './IErrorHandler';
import { ILoggerService } from './ILoggerService';

/**
 * Interface para gerenciamento de conexão
 */
export interface IConnectionManager {
  connect(config: SocketConfig): Promise<WASocket>;
  disconnect(reason?: number): Promise<void>;
  reconnect(force?: boolean): Promise<void>;
  getSocket(): WASocket | null;
  getStatus(): ConnectionStatus;
  getReconnectAttempts(): number;
  resetReconnectAttempts(): void;
  connectionConfig: SocketConfig | null;
}

