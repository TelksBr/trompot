# 💡 Exemplos de Implementação - Refatoração Baileys

Este documento contém exemplos práticos de como implementar as classes propostas no plano de refatoração.

---

## 1. ConnectionManager.ts

```typescript
import { WASocket, ConnectionState, DisconnectReason, makeWASocket, SocketConfig } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { StateManager } from './StateManager';
import { SessionManager } from './SessionManager';
import { RetryService } from '../services/RetryService';
import { EventManager } from '../events/EventManager';
import { ErrorHandler } from '../utils/ErrorHandler';
import { LoggerService } from '../services/LoggerService';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting';

export class ConnectionManager {
  private socket: WASocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private stateManager: StateManager;
  private sessionManager: SessionManager;
  private retryService: RetryService;
  private eventManager: EventManager;
  private errorHandler: ErrorHandler;
  private logger: LoggerService;
  
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private cleanupFunctions: (() => void)[] = [];

  constructor(
    stateManager: StateManager,
    sessionManager: SessionManager,
    retryService: RetryService,
    eventManager: EventManager,
    errorHandler: ErrorHandler,
    logger: LoggerService
  ) {
    this.stateManager = stateManager;
    this.sessionManager = sessionManager;
    this.retryService = retryService;
    this.eventManager = eventManager;
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
    this.logger.info('Iniciando conexão...');

    try {
      // Valida sessão antes de conectar
      const sessionValidation = await this.sessionManager.validateSession(config.auth as any);
      
      if (!sessionValidation.isValid && !sessionValidation.shouldGenerateQR) {
        this.logger.warn('Sessão inválida, limpando...');
        await this.sessionManager.clearInvalidSession(config.auth as any);
      }

      // Cria socket
      this.socket = makeWASocket(config);
      
      // Configura eventos
      this.setupEventListeners();
      
      // Aguarda conexão
      await this.waitForConnection();
      
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      this.logger.info('Conectado com sucesso');
      
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
    this.logger.info(`Desconectando... (reason: ${reason})`);
    
    this.setStatus('disconnected');
    
    // Limpa todos os listeners
    this.cleanup();
    
    // Fecha socket
    if (this.socket) {
      try {
        this.socket.end(reason);
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
      this.logger.warn('Já está tentando reconectar');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts && !force) {
      this.logger.error('Número máximo de tentativas de reconexão atingido');
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    const delay = this.retryService.getBackoffDelay(this.reconnectAttempts);
    this.logger.info(`Tentando reconectar em ${delay}ms (tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Limpa conexão anterior
      await this.disconnect();
      
      // Reconecta (precisa passar config novamente - isso será melhorado)
      // Por enquanto, assume que o config será passado externamente
      this.logger.info('Reconexão iniciada');
    } catch (error) {
      this.errorHandler.handle(error, 'ConnectionManager.reconnect');
      // Tenta novamente após delay
      await this.reconnect();
    }
  }

  /**
   * Configura listeners de eventos
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Listener de atualizações de conexão
    const connectionCleanup = this.eventManager.onConnectionUpdate((update: ConnectionState) => {
      this.handleConnectionUpdate(update);
    });
    this.cleanupFunctions.push(connectionCleanup);

    // Listener de erros
    const errorCleanup = this.eventManager.onError((error: Error) => {
      this.errorHandler.handle(error, 'Socket');
    });
    this.cleanupFunctions.push(errorCleanup);
  }

  /**
   * Trata atualizações de conexão
   */
  private async handleConnectionUpdate(update: ConnectionState): Promise<void> {
    if (!update.connection) return;

    switch (update.connection) {
      case 'connecting':
        this.setStatus('connecting');
        break;
      
      case 'open':
        this.setStatus('connected');
        this.reconnectAttempts = 0;
        break;
      
      case 'close':
        await this.handleDisconnect(update.lastDisconnect?.error as Boom);
        break;
    }

    // Atualiza estado global
    this.stateManager.updateConnectionState(update);
  }

  /**
   * Trata desconexões
   */
  private async handleDisconnect(error?: Boom): Promise<void> {
    const statusCode = error?.output?.statusCode || DisconnectReason.connectionClosed;
    
    this.logger.warn(`Desconectado: ${statusCode}`);

    // Atualiza estado
    this.stateManager.setLastDisconnectError(statusCode);
    this.setStatus('disconnected');

    // Decide se deve reconectar
    if (this.shouldReconnect(statusCode)) {
      await this.reconnect();
    } else {
      this.logger.error(`Não será tentada reconexão (status: ${statusCode})`);
    }
  }

  /**
   * Decide se deve tentar reconectar baseado no código de erro
   */
  private shouldReconnect(statusCode: number): boolean {
    // Não reconecta para erros que indicam sessão inválida
    const nonReconnectableErrors = [
      DisconnectReason.loggedOut, // 401
      421, // Logged out (alternativo)
      428, // Connection Terminated
    ];

    return !nonReconnectableErrors.includes(statusCode);
  }

  /**
   * Aguarda conexão ser estabelecida
   */
  private async waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket não inicializado'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao aguardar conexão'));
      }, 60000); // 60 segundos

      const cleanup = this.eventManager.onConnectionUpdate((update: ConnectionState) => {
        if (update.connection === 'open') {
          clearTimeout(timeout);
          cleanup();
          resolve();
        } else if (update.connection === 'close') {
          clearTimeout(timeout);
          cleanup();
          const error = update.lastDisconnect?.error as Boom;
          reject(error || new Error('Conexão fechada'));
        }
      });

      // Se já estiver conectado
      if (this.socket.ws.isOpen) {
        clearTimeout(timeout);
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
}
```

---

## 2. SessionManager.ts

```typescript
import { AuthenticationCreds, initAuthCreds } from '@whiskeysockets/baileys';
import IAuth from '../../client/IAuth';
import { getBaileysAuth } from './Auth';
import { LoggerService } from '../services/LoggerService';

export interface SessionValidationResult {
  isValid: boolean;
  shouldGenerateQR: boolean;
  reason?: string;
}

export class SessionManager {
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Valida se a sessão é válida
   */
  async validateSession(auth: IAuth): Promise<SessionValidationResult> {
    try {
      const creds = await auth.get('creds') as AuthenticationCreds | null;

      if (!creds) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Nenhuma credencial encontrada'
        };
      }

      // Verifica se está registrado
      if (creds.registered === false) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Sessão não registrada (registered: false)'
        };
      }

      // Verifica se tem me.id (identificação do usuário)
      if (!creds.me?.id) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Sessão sem identificação do usuário'
        };
      }

      // Verifica se tem credenciais básicas necessárias
      if (!creds.noiseKey || !creds.signedIdentityKey) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Credenciais incompletas'
        };
      }

      return {
        isValid: true,
        shouldGenerateQR: false
      };
    } catch (error) {
      this.logger.error('Erro ao validar sessão', error);
      return {
        isValid: false,
        shouldGenerateQR: true,
        reason: `Erro: ${error instanceof Error ? error.message : 'Desconhecido'}`
      };
    }
  }

  /**
   * Limpa sessão inválida
   */
  async clearInvalidSession(auth: IAuth): Promise<void> {
    try {
      this.logger.info('Limpando sessão inválida...');

      // Remove credenciais problemáticas, mas mantém estrutura básica
      const creds = await auth.get('creds') as AuthenticationCreds | null;
      
      if (creds) {
        // Remove campos que indicam sessão inválida
        delete (creds as any).pairingCode;
        delete (creds as any).me;
        creds.registered = false;

        // Salva credenciais limpas
        await auth.set('creds', creds);
      }

      this.logger.info('Sessão limpa com sucesso');
    } catch (error) {
      this.logger.error('Erro ao limpar sessão', error);
      throw error;
    }
  }

  /**
   * Salva credenciais
   */
  async saveCredentials(auth: IAuth, creds: Partial<AuthenticationCreds>): Promise<void> {
    try {
      await auth.set('creds', creds);
      this.logger.debug('Credenciais salvas');
    } catch (error) {
      this.logger.error('Erro ao salvar credenciais', error);
      throw error;
    }
  }

  /**
   * Carrega credenciais
   */
  async loadCredentials(auth: IAuth): Promise<AuthenticationCreds> {
    try {
      const { state } = await getBaileysAuth(auth);
      return state.creds;
    } catch (error) {
      this.logger.error('Erro ao carregar credenciais', error);
      // Retorna credenciais vazias se houver erro
      return initAuthCreds();
    }
  }

  /**
   * Verifica se deve gerar QR code
   */
  shouldGenerateQR(creds: AuthenticationCreds | null): boolean {
    if (!creds) return true;
    if (creds.registered === false) return true;
    if (!creds.me?.id) return true;
    return false;
  }
}
```

---

## 3. EventManager.ts

```typescript
import { WASocket, ConnectionState, BaileysEventEmitter } from '@whiskeysockets/baileys';
import { LoggerService } from '../services/LoggerService';

type EventHandler<T = any> = (data: T) => void | Promise<void>;

export class EventManager {
  private socket: WASocket | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Configura o socket para gerenciar eventos
   */
  setSocket(socket: WASocket): void {
    this.socket = socket;
    this.setupCoreListeners();
  }

  /**
   * Registra um listener para um evento
   */
  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(handler);

    // Retorna função de cleanup
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Remove um listener
   */
  off<T = any>(event: string, handler: EventHandler<T>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Limpa todos os listeners
   */
  cleanup(): void {
    if (this.socket?.ev) {
      // Remove todos os listeners do Baileys
      this.socket.ev.removeAllListeners();
    }
    
    this.listeners.clear();
    this.logger.debug('Todos os listeners foram limpos');
  }

  /**
   * Configura listeners core do Baileys
   */
  private setupCoreListeners(): void {
    if (!this.socket?.ev) return;

    // Connection update
    this.socket.ev.on('connection.update', (update: ConnectionState) => {
      this.emit('connection.update', update);
    });

    // Creds update
    this.socket.ev.on('creds.update', (creds) => {
      this.emit('creds.update', creds);
    });

    // Messages
    this.socket.ev.on('messages.upsert', (data) => {
      this.emit('messages.upsert', data);
    });

    this.socket.ev.on('messages.update', (data) => {
      this.emit('messages.update', data);
    });

    // Contacts
    this.socket.ev.on('contacts.upsert', (data) => {
      this.emit('contacts.upsert', data);
    });

    this.socket.ev.on('contacts.update', (data) => {
      this.emit('contacts.update', data);
    });

    // Groups
    this.socket.ev.on('groups.update', (data) => {
      this.emit('groups.update', data);
    });

    // Chats
    this.socket.ev.on('chats.delete', (data) => {
      this.emit('chats.delete', data);
    });

    // History
    this.socket.ev.on('messaging-history.set', (data) => {
      this.emit('messaging-history.set', data);
    });

    // Calls
    this.socket.ev.on('call', (data) => {
      this.emit('call', data);
    });
  }

  /**
   * Emite um evento para todos os listeners registrados
   */
  private emit<T = any>(event: string, data: T): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          const result = handler(data);
          // Se retornar uma Promise, trata erros
          if (result instanceof Promise) {
            result.catch(error => {
              this.logger.error(`Erro no handler do evento ${event}`, error);
            });
          }
        } catch (error) {
          this.logger.error(`Erro no handler do evento ${event}`, error);
        }
      });
    }
  }

  // Métodos de conveniência para eventos comuns

  onConnectionUpdate(handler: EventHandler<ConnectionState>): () => void {
    return this.on('connection.update', handler);
  }

  onCredsUpdate(handler: EventHandler): () => void {
    return this.on('creds.update', handler);
  }

  onMessagesUpsert(handler: EventHandler): () => void {
    return this.on('messages.upsert', handler);
  }

  onMessagesUpdate(handler: EventHandler): () => void {
    return this.on('messages.update', handler);
  }

  onError(handler: EventHandler<Error>): () => void {
    return this.on('error', handler);
  }
}
```

---

## 4. CacheService.ts

```typescript
import NodeCache from 'node-cache';
import { LoggerService } from './LoggerService';

export class CacheService {
  private caches: Map<string, NodeCache> = new Map();
  private logger: LoggerService;
  private defaultTTL: number = 3600; // 1 hora

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Obtém ou cria um cache
   */
  getCache(name: string, ttl?: number): NodeCache {
    if (!this.caches.has(name)) {
      const cache = new NodeCache({
        stdTTL: ttl || this.defaultTTL,
        useClones: false,
        checkperiod: 600, // Verifica expiração a cada 10 minutos
      });

      this.caches.set(name, cache);
      this.logger.debug(`Cache '${name}' criado`);
    }

    return this.caches.get(name)!;
  }

  /**
   * Limpa um cache específico
   */
  clearCache(name: string): void {
    const cache = this.caches.get(name);
    if (cache) {
      cache.flushAll();
      this.logger.debug(`Cache '${name}' limpo`);
    }
  }

  /**
   * Limpa todos os caches
   */
  clearAll(): void {
    this.caches.forEach((cache, name) => {
      cache.flushAll();
      this.logger.debug(`Cache '${name}' limpo`);
    });
  }

  /**
   * Remove um cache
   */
  removeCache(name: string): void {
    const cache = this.caches.get(name);
    if (cache) {
      cache.flushAll();
      this.caches.delete(name);
      this.logger.debug(`Cache '${name}' removido`);
    }
  }

  // Caches específicos

  getMessageRetryCache(): NodeCache {
    return this.getCache('message-retry', 3600); // 1 hora
  }

  getGroupMetadataCache(): NodeCache {
    return this.getCache('group-metadata', 300); // 5 minutos
  }

  getSignalKeyCache(): NodeCache {
    return this.getCache('signal-keys', 300); // 5 minutos
  }

  getMessageCache(): NodeCache {
    return this.getCache('messages', 3600); // 1 hora
  }
}
```

---

## 5. RetryService.ts

```typescript
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

    // Adiciona jitter aleatório (±20%)
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
}
```

---

## 6. WhatsAppBot Refatorado (Simplificado)

```typescript
import { BotEvents } from '../bot/BotEvents';
import { IBot } from '../bot/IBot';
import { ConnectionManager } from './core/ConnectionManager';
import { SessionManager } from './core/SessionManager';
import { EventManager } from './events/EventManager';
import { StateManager } from './core/StateManager';
import { CacheService } from './services/CacheService';
import { RetryService } from './services/RetryService';
import { ErrorHandler } from './utils/ErrorHandler';
import { LoggerService } from './services/LoggerService';
import { MessageEventHandler } from './events/MessageEventHandler';
import { ConnectionEventHandler } from './events/ConnectionEventHandler';
import { GroupEventHandler } from './events/GroupEventHandler';
import { ContactEventHandler } from './events/ContactEventHandler';
import IAuth from '../client/IAuth';
import Message from '../messages/Message';
// ... outros imports

export default class WhatsAppBot extends BotEvents implements IBot {
  // Serviços
  private connectionManager: ConnectionManager;
  private sessionManager: SessionManager;
  private eventManager: EventManager;
  private stateManager: StateManager;
  private cacheService: CacheService;
  private retryService: RetryService;
  private errorHandler: ErrorHandler;
  private logger: LoggerService;

  // Handlers de eventos
  private messageEventHandler: MessageEventHandler;
  private connectionEventHandler: ConnectionEventHandler;
  private groupEventHandler: GroupEventHandler;
  private contactEventHandler: ContactEventHandler;

  // Estado público (readonly)
  public get id(): string { return this.stateManager.id; }
  public get status(): BotStatus { return this.stateManager.status; }
  public get phoneNumber(): string { return this.stateManager.phoneNumber; }
  public get name(): string { return this.stateManager.name; }

  constructor(config?: Partial<WhatsAppBotConfig>) {
    super();

    // Inicializa serviços
    this.logger = new LoggerService(config?.logLevel || 'info');
    this.cacheService = new CacheService(this.logger);
    this.retryService = new RetryService();
    this.errorHandler = new ErrorHandler(this.logger);
    this.stateManager = new StateManager();
    this.sessionManager = new SessionManager(this.logger);
    this.eventManager = new EventManager(this.logger);
    this.connectionManager = new ConnectionManager(
      this.stateManager,
      this.sessionManager,
      this.retryService,
      this.eventManager,
      this.errorHandler,
      this.logger
    );

    // Inicializa handlers
    this.messageEventHandler = new MessageEventHandler(this, this.logger);
    this.connectionEventHandler = new ConnectionEventHandler(this, this.logger);
    this.groupEventHandler = new GroupEventHandler(this, this.logger);
    this.contactEventHandler = new ContactEventHandler(this, this.logger);

    // Configura eventos
    this.setupEventHandlers();

    // Configuração
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Conecta ao WhatsApp
   */
  async connect(auth?: string | IAuth): Promise<void> {
    try {
      // Configura autenticação
      if (!auth || typeof auth === 'string') {
        this.auth = new MultiFileAuthState(auth || './session');
      } else {
        this.auth = auth;
      }

      // Cria configuração do socket
      const socketConfig = await this.createSocketConfig();

      // Conecta
      const socket = await this.connectionManager.connect(socketConfig);
      
      // Configura event manager com o socket
      this.eventManager.setSocket(socket);

      // Aguarda conexão estar aberta
      await this.connectionManager.waitForConnection();
    } catch (error) {
      this.errorHandler.handle(error, 'WhatsAppBot.connect');
      throw error;
    }
  }

  /**
   * Desconecta do WhatsApp
   */
  async disconnect(): Promise<void> {
    await this.connectionManager.disconnect();
  }

  /**
   * Envia uma mensagem
   */
  async send(message: Message): Promise<Message> {
    const socket = this.connectionManager.getSocket();
    if (!socket) {
      throw new Error('Não está conectado');
    }

    return this.retryService.retry(async () => {
      return await this.messageEventHandler.sendMessage(socket, message);
    });
  }

  // ... outros métodos públicos delegando para handlers/serviços

  /**
   * Configura handlers de eventos
   */
  private setupEventHandlers(): void {
    // Connection events
    this.connectionEventHandler.setup();

    // Message events
    this.messageEventHandler.setup();

    // Group events
    this.groupEventHandler.setup();

    // Contact events
    this.contactEventHandler.setup();
  }

  /**
   * Cria configuração do socket
   */
  private async createSocketConfig(): Promise<SocketConfig> {
    const { state, saveCreds } = await getBaileysAuth(this.auth);
    
    // Configura saveCreds
    this.eventManager.onCredsUpdate(async (creds) => {
      await this.sessionManager.saveCredentials(this.auth, creds);
    });

    return {
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger.getLogger()),
      },
      ...this.config,
    };
  }
}
```

---

## 7. LIDMappingService.ts (Novo no v7.0.0)

```typescript
import { WASocket } from '@whiskeysockets/baileys';
import { LoggerService } from './LoggerService';

export interface LIDMapping {
  lid: string;
  pn: string;
}

export class LIDMappingService {
  private socket: WASocket | null = null;
  private logger: LoggerService;
  private cache: Map<string, string> = new Map(); // LID -> PN
  private reverseCache: Map<string, string> = new Map(); // PN -> LID

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Configura o socket para acessar o lidMapping store
   */
  setSocket(socket: WASocket): void {
    this.socket = socket;
  }

  /**
   * Obtém LID para um PN usando o store interno do Baileys
   */
  async getLIDForPN(pn: string): Promise<string | undefined> {
    if (!this.socket) {
      this.logger.warn('Socket não configurado para LID mapping');
      return undefined;
    }

    try {
      // Verifica cache primeiro
      if (this.reverseCache.has(pn)) {
        return this.reverseCache.get(pn);
      }

      // Usa o store interno do Baileys
      const lid = await this.socket.signalRepository.lidMapping.getLIDForPN(pn);
      
      if (lid) {
        this.cache.set(lid, pn);
        this.reverseCache.set(pn, lid);
      }

      return lid;
    } catch (error) {
      this.logger.error('Erro ao obter LID para PN', error);
      return undefined;
    }
  }

  /**
   * Obtém PN para um LID usando o store interno do Baileys
   */
  async getPNForLID(lid: string): Promise<string | undefined> {
    if (!this.socket) {
      this.logger.warn('Socket não configurado para LID mapping');
      return undefined;
    }

    try {
      // Verifica cache primeiro
      if (this.cache.has(lid)) {
        return this.cache.get(lid);
      }

      // Usa o store interno do Baileys
      const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lid);
      
      if (pn) {
        this.cache.set(lid, pn);
        this.reverseCache.set(pn, lid);
      }

      return pn;
    } catch (error) {
      this.logger.error('Erro ao obter PN para LID', error);
      return undefined;
    }
  }

  /**
   * Armazena mapeamento LID/PN
   */
  async storeLIDPNMapping(lid: string, pn: string): Promise<void> {
    if (!this.socket) {
      this.logger.warn('Socket não configurado para LID mapping');
      return;
    }

    try {
      // Armazena no store interno do Baileys
      await this.socket.signalRepository.lidMapping.storeLIDPNMapping(lid, pn);
      
      // Atualiza cache local
      this.cache.set(lid, pn);
      this.reverseCache.set(pn, lid);
      
      this.logger.debug(`Mapeamento LID/PN armazenado: ${lid} <-> ${pn}`);
    } catch (error) {
      this.logger.error('Erro ao armazenar mapeamento LID/PN', error);
    }
  }

  /**
   * Armazena múltiplos mapeamentos
   */
  async storeLIDPNMappings(mappings: LIDMapping[]): Promise<void> {
    if (!this.socket) {
      this.logger.warn('Socket não configurado para LID mapping');
      return;
    }

    try {
      // Armazena no store interno do Baileys
      await this.socket.signalRepository.lidMapping.storeLIDPNMappings(
        mappings.map(m => ({ lid: m.lid, pn: m.pn }))
      );
      
      // Atualiza cache local
      for (const mapping of mappings) {
        this.cache.set(mapping.lid, mapping.pn);
        this.reverseCache.set(mapping.pn, mapping.lid);
      }
      
      this.logger.debug(`${mappings.length} mapeamentos LID/PN armazenados`);
    } catch (error) {
      this.logger.error('Erro ao armazenar mapeamentos LID/PN', error);
    }
  }

  /**
   * Handler para evento lid-mapping.update
   */
  handleLIDMappingUpdate(mapping: LIDMapping): void {
    this.logger.debug('Novo mapeamento LID/PN recebido', mapping);
    this.storeLIDPNMapping(mapping.lid, mapping.pn);
  }

  /**
   * Limpa cache
   */
  clearCache(): void {
    this.cache.clear();
    this.reverseCache.clear();
  }
}
```

---

## 8. HistoryEventHandler.ts (v7.0.0 - Obrigatório)

```typescript
import { WASocket, proto } from '@whiskeysockets/baileys';
import { LoggerService } from './LoggerService';
import { MessageEventHandler } from './MessageEventHandler';
import WhatsAppBot from '../core/WhatsAppBot';

export class HistoryEventHandler {
  private bot: WhatsAppBot;
  private logger: LoggerService;
  private messageHandler: MessageEventHandler;

  constructor(bot: WhatsAppBot, logger: LoggerService, messageHandler: MessageEventHandler) {
    this.bot = bot;
    this.logger = logger;
    this.messageHandler = messageHandler;
  }

  /**
   * Configura handler para messaging-history.set (OBRIGATÓRIO no v7.0.0)
   */
  setup(socket: WASocket): void {
    socket.ev.on('messaging-history.set', async (update) => {
      try {
        const { chats, contacts, messages, syncType } = update;

        this.logger.info(`History sync iniciado (syncType: ${syncType})`);

        // Processa chats
        if (chats && Array.isArray(chats)) {
          for (const chat of chats) {
            try {
              if (!chat.id) continue; // v7: id pode ser null/undefined
              
              // Armazena chat
              await this.bot.updateChat({
                id: chat.id,
                name: chat.subject || chat.name,
                timestamp: chat.conversationTimestamp ? Number(chat.conversationTimestamp) * 1000 : undefined,
                unreadCount: chat.unreadCount || 0,
              });
            } catch (error) {
              this.logger.error('Erro ao processar chat do history sync', error);
            }
          }
        }

        // Processa contatos
        if (contacts && Array.isArray(contacts)) {
          for (const contact of contacts) {
            try {
              if (!contact.id) continue; // v7: id pode ser null/undefined
              
              // Armazena contato
              await this.bot.updateUser({
                id: contact.id,
                name: contact.notify || contact.verifiedName || contact.name,
              });
            } catch (error) {
              this.logger.error('Erro ao processar contato do history sync', error);
            }
          }
        }

        // Processa mensagens (CRÍTICO: armazenar para getMessage)
        if (messages && Array.isArray(messages)) {
          for (const message of messages) {
            try {
              if (!message.key || !message.key.remoteJid || !message.key.id) continue;
              if (message.key.remoteJid === 'status@broadcast') continue;

              // CRÍTICO: Armazena mensagem para getMessage funcionar
              await this.bot.store.saveMessage(
                message.key.remoteJid,
                message as proto.IWebMessageInfo,
                false
              );

              // Processa mensagem (opcional, se quiser emitir eventos)
              if (this.bot.config.autoSyncHistory) {
                const msg = await this.messageHandler.convertMessage(message);
                msg.isOld = true;
                this.bot.emit('message', msg);
              }
            } catch (error) {
              this.logger.error('Erro ao processar mensagem do history sync', error);
            }
          }
        }

        this.logger.info('History sync concluído', {
          chats: chats?.length || 0,
          contacts: contacts?.length || 0,
          messages: messages?.length || 0,
          syncType,
        });
      } catch (error) {
        this.logger.error('Erro no history sync', error);
        this.bot.emit('error', error);
      }
    });
  }
}
```

---

## 📝 Notas de Implementação

### Compatibilidade Baileys v7.0.0

1. **LIDs**: Sempre verificar se é LID ou PN usando `isPnUser()`. Usar `remoteJidAlt` e `participantAlt` quando disponível.

2. **ACKs**: NUNCA enviar ACKs automaticamente. Apenas marcar como lido localmente.

3. **Protobufs**: Sempre usar `.create()` em vez de `.fromObject()`. Usar `BufferJSON` para encoding/decoding.

4. **getMessage**: OBRIGATÓRIO implementar. Deve buscar do storage onde as mensagens foram salvas no history sync.

5. **cachedGroupMetadata**: OBRIGATÓRIO para evitar ratelimit. Usar `CacheService.getGroupMetadataCache()`.

6. **Eventos**: Processar TODAS as mensagens do array em `messages.upsert`, não apenas a primeira.

7. **History Sync**: Armazenar todas as mensagens para `getMessage` funcionar.

### Dependências

As classes dependem umas das outras, mas a injeção de dependências pode ser melhorada com um container DI.

### Testes

Cada classe deve ter testes unitários cobrindo todos os cenários, especialmente:
- LID mapping
- History sync
- Event handlers
- Reconexão

### Error Handling

Todos os erros devem passar pelo `ErrorHandler` para logging consistente.

### Logging

Use `LoggerService` para todos os logs, nunca `console.log`. Use pino conforme documentação oficial.

### Cleanup

Sempre limpe listeners e recursos quando desconectar. Use `EventManager.cleanup()`.

---

**Próximo Passo**: Implementar uma classe por vez, começando pela FASE 0 (compatibilidade v7.0.0), depois serviços base.

