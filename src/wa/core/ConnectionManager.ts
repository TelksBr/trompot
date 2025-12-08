import { WASocket, ConnectionState, DisconnectReason, makeWASocket, SocketConfig } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { IStateManager, ConnectionStatus } from '../interfaces/IStateManager';
import { ISessionManager } from '../interfaces/ISessionManager';
import { RetryService } from '../services/RetryService';
import { IErrorHandler } from '../interfaces/IErrorHandler';
import { ILoggerService } from '../interfaces/ILoggerService';
import { IConnectionManager } from '../interfaces/IConnectionManager';
import { ErrorCodes } from '../constants/ErrorCodes';
import { Timeouts } from '../constants/Timeouts';

export class ConnectionManager implements IConnectionManager {
  private socket: WASocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private stateManager: IStateManager;
  private sessionManager: ISessionManager;
  private retryService: RetryService;
  private errorHandler: IErrorHandler;
  private logger: ILoggerService;
  
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private cleanupFunctions: (() => void)[] = [];
  public connectionConfig: SocketConfig | null = null; // Tornado público para acesso em createSocket

  constructor(
    stateManager: IStateManager,
    sessionManager: ISessionManager,
    retryService: RetryService,
    errorHandler: IErrorHandler,
    logger: ILoggerService
  ) {
    this.stateManager = stateManager;
    this.sessionManager = sessionManager;
    this.retryService = retryService;
    this.errorHandler = errorHandler;
    this.logger = logger;
  }

  /**
   * Conecta ao WhatsApp
   */
  async connect(config: SocketConfig): Promise<WASocket> {
    if (this.status === 'connected' || this.status === 'connecting') {
      throw new Error('Já está conectado ou conectando');
    }

    this.setStatus('connecting');
    this.connectionConfig = config;

    try {
      // Valida sessão antes de conectar (se auth estiver disponível)

      // Cria socket
      this.socket = makeWASocket(config);
      
      // Configura eventos
      this.setupEventListeners();
      
      // Aguarda conexão
      await this.waitForConnection();
      
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      // Log removido - conexão bem-sucedida é indicada pelo evento 'open'
      
      return this.socket;
    } catch (error) {
      this.setStatus('disconnected');
      this.errorHandler.handle(error, 'ConnectionManager.connect');
      throw error;
    }
  }

  /**
   * Desconecta do WhatsApp
   */
  async disconnect(reason: number = DisconnectReason.connectionClosed): Promise<void> {
    // Log removido - desconexão é indicada pelo evento 'close'
    
    this.setStatus('disconnected');
    
    // Limpa todos os listeners
    this.cleanup();
    
    // Fecha socket
    if (this.socket) {
      try {
        // socket.end() não aceita número, apenas fecha a conexão
        this.socket.end(undefined);
      } catch (error) {
        this.errorHandler.handle(error, 'ConnectionManager.disconnect');
      }
      this.socket = null;
    }
  }

  /**
   * Reconecta ao WhatsApp
   */
  async reconnect(force: boolean = false): Promise<void> {
    if (this.status === 'connecting' || this.status === 'reconnecting') {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts && !force) {
      this.logger.error('Número máximo de tentativas de reconexão atingido');
      this.setStatus('disconnected');
      return;
    }

    if (!this.connectionConfig) {
      this.logger.error('Não é possível reconectar: configuração não disponível');
      return;
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    const delay = this.retryService.getBackoffDelay(this.reconnectAttempts);
    // Log removido - reconexão é indicada pelo evento 'reconnecting'

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Limpa conexão anterior
      await this.disconnect();
      
      // Reconecta
      await this.connect(this.connectionConfig);
    } catch (error) {
      this.errorHandler.handle(error, 'ConnectionManager.reconnect');
      // Tenta novamente após delay
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await this.reconnect();
      }
    }
  }

  /**
   * Configura listeners de eventos
   * NOTA: Não escuta connection.update diretamente para evitar duplicação
   * O ConfigWAEvents é o único responsável por escutar connection.update
   * Este método pode ser usado para outros listeners se necessário
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // REMOVIDO: Listener duplicado de connection.update
    // O ConfigWAEvents já escuta este evento e gerencia toda a lógica
    // ConnectionManager não precisa escutar diretamente para evitar processamento duplicado
    
    // Nota: Baileys não tem evento 'error' direto no ev
    // Erros são tratados através de connection.update com connection: 'close'
  }

  /**
   * Trata atualizações de conexão
   * NOTA: Este método não é mais chamado automaticamente
   * Pode ser chamado manualmente se necessário, mas a lógica principal
   * está no ConfigWAEvents para evitar duplicação
   */
  handleConnectionUpdate(update: ConnectionState): void {
    if (!update.connection) return;

    switch (update.connection) {
      case 'connecting':
        this.setStatus('connecting');
        this.stateManager.setLastConnectionUpdateDate(Date.now());
        break;
      
      case 'open':
        this.setStatus('connected');
        this.reconnectAttempts = 0;
        this.stateManager.setLastDisconnectError(undefined);
        this.stateManager.setLastConnectionUpdateDate(Date.now());
        break;
      
      case 'close':
        this.handleDisconnect(update.lastDisconnect?.error as Boom).catch(error => {
          this.errorHandler.handle(error, 'ConnectionManager.handleDisconnect');
        });
        break;
    }

    // Atualiza estado global
    this.stateManager.updateConnectionState(update);
  }

  /**
   * Trata desconexões
   */
  async handleDisconnect(error?: Boom): Promise<void> {
    const statusCode = error?.output?.statusCode || DisconnectReason.connectionClosed;
    
    // Log removido - desconexão é indicada pelo evento 'close'

    // Atualiza estado
    this.stateManager.setLastDisconnectError(statusCode);
    this.setStatus('disconnected');

    // Decide se deve reconectar
    if (this.shouldReconnect(statusCode)) {
      await this.reconnect();
    }
    // Log removido - decisão de reconexão é silenciosa
  }

  /**
   * Decide se deve tentar reconectar baseado no código de erro
   */
  private shouldReconnect(statusCode: number): boolean {
    // Não reconecta para erros que indicam sessão inválida
    const nonReconnectableErrors = [
      DisconnectReason.loggedOut, // 401
      ErrorCodes.LOGGED_OUT_ALT, // 421
      ErrorCodes.CONNECTION_TERMINATED, // 428
    ];

    return !nonReconnectableErrors.includes(statusCode);
  }

  /**
   * Aguarda conexão ser estabelecida
   */
  async waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket não inicializado'));
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout ao aguardar conexão'));
      }, Timeouts.CONNECTION_WAIT);

      const cleanup = () => {
        clearTimeout(timeout);
        if (this.socket) {
          this.socket.ev.off('connection.update', connectionHandler);
        }
      };

      const connectionHandler = (update: ConnectionState) => {
        if (update.connection === 'open') {
          cleanup();
          resolve();
        } else if (update.connection === 'close') {
          cleanup();
          const error = update.lastDisconnect?.error as Boom;
          reject(error || new Error('Conexão fechada'));
        }
      };

      this.socket.ev.on('connection.update', connectionHandler);

      // Se já estiver conectado
      if (this.socket.ws.isOpen) {
        cleanup();
        resolve();
      }
    });
  }

  /**
   * Limpa todos os listeners
   */
  private cleanup(): void {
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];
  }

  /**
   * Atualiza status e notifica
   */
  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.stateManager.setConnectionStatus(status);
  }

  /**
   * Retorna o socket atual
   */
  getSocket(): WASocket | null {
    return this.socket;
  }

  /**
   * Retorna o status atual
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Retorna o número de tentativas de reconexão
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Reseta o número de tentativas de reconexão
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}

