import makeWASocket, {
  generateWAMessageFromContent,
  makeCacheableSignalKeyStore,
  DEFAULT_CONNECTION_CONFIG,
  MediaDownloadOptions,
  downloadMediaMessage,
  AuthenticationCreds,
  DEFAULT_CACHE_TTLS,
  WAConnectionState,
  DisconnectReason,
  ConnectionState,
  GroupMetadata,
  SocketConfig,
  isJidGroup,
  Browsers,
  Contact,
  proto,
  Chat as BaileysChat,
  BufferJSON,
  DisconnectReason as BaileysDisconnectReason,
} from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import { Boom } from '@hapi/boom';
import internal from 'stream';
import pino from 'pino';
import Long from 'long';

import { WA_MEDIA_SERVERS } from '../configs/WAConfigs';

import { PollMessage, PollUpdateMessage, ReactionMessage } from '../messages';
import { getImageURL, verifyIsEquals } from '../utils/Generic';
import { getBaileysAuth, MultiFileAuthState } from './Auth';
import Message, { MessageType } from '../messages/Message';
import ConvertToWAMessage from './ConvertToWAMessage';
import makeInMemoryStore from './makeInMemoryStore';
import ConvertWAMessage from './ConvertWAMessage';
import { Media } from '../messages/MediaMessage';
import MediaMessage from '../messages/MediaMessage';
import { UserAction, UserEvent } from '../modules/user';
import ConfigWAEvents from './ConfigWAEvents';
import { fixID, getPhoneNumber } from './ID';
import { Timeouts } from './constants/Timeouts';
import { isValidJID, JID_PATTERNS } from './constants/JIDPatterns';
import { Validation } from './utils/Validation';
import { ConfigDefaults, TIMESTAMP_MULTIPLIER } from './constants/ConfigDefaults';
import { ErrorCodes, ErrorMessages } from './constants/ErrorCodes';
import { ConfigValidator } from './utils/ConfigValidator';
import { MessageOperations } from './operations/MessageOperations';
import { ChatOperations } from './operations/ChatOperations';
import { UserOperations } from './operations/UserOperations';
import { GroupOperations } from './operations/GroupOperations';

// Novos serviços e managers
import { LoggerService } from './services/LoggerService';
import { CacheService } from './services/CacheService';
import { ErrorHandler } from './services/ErrorHandler';
import { RetryService } from './services/RetryService';
import { LIDMappingService } from './services/LIDMappingService';
import { PendingMessageQueue } from './services/PendingMessageQueue';
import { LIDNormalizationService } from './services/LIDNormalizationService';
import { StateManager } from './core/StateManager';
import { ConnectionManager } from './core/ConnectionManager';
import { SessionManager } from './core/SessionManager';
import { EventManager } from './events/EventManager';
import { ConnectionEventHandler } from './events/ConnectionEventHandler';
import { MessageEventHandler } from './events/MessageEventHandler';
import { HistoryEventHandler } from './events/HistoryEventHandler';
import { ContactEventHandler } from './events/ContactEventHandler';
import { GroupEventHandler } from './events/GroupEventHandler';
import { ChatEventHandler } from './events/ChatEventHandler';
import { CallEventHandler } from './events/CallEventHandler';
import { LIDMappingEventHandler } from './events/LIDMappingEventHandler';
import { BotStatus } from '../bot/BotStatus';
import ChatType from '../modules/chat/ChatType';
import BotEvents from '../bot/BotEvents';
import { WAStatus } from './WAStatus';
import ChatStatus from '../modules/chat/ChatStatus';
import IAuth from '../client/IAuth';
import User from '../modules/user/User';
import Chat from '../modules/chat/Chat';
import IBot from '../bot/IBot';
import Call from '../models/Call';

export type WhatsAppBotConfig = Partial<SocketConfig> & {
  /** Auto carrega o histórico de mensagens ao se conectar */
  autoSyncHistory: boolean;
  /** Lê todas as mensagens falhadas */
  readAllFailedMessages: boolean;
  /** Intervalo em milesgundos para reiniciar conexão */
  autoRestartInterval: number;
  /** Usar servidor experimental para download de mídias */
  useExperimentalServers: boolean;
  /** Auto carrega informações de contatos */
  autoLoadContactInfo: boolean;
  /** Auto carrega informações de contatos */
  autoLoadGroupInfo: boolean;
  /** Rejeita automaticamente todas as chamadas recebidas */
  autoRejectCalls?: boolean;
  /** Nível de log */
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
};

export default class WhatsAppBot extends BotEvents implements IBot {
  //@ts-ignore
  public sock: ReturnType<typeof makeWASocket> = {};
  public config: WhatsAppBotConfig;
  public auth: IAuth = new MultiFileAuthState('./session', undefined, false);

  public messagesCached: string[] = [];
  public store: ReturnType<typeof makeInMemoryStore>;
  public msgRetryCountercache: NodeCache;
  public groupMetadataCache: NodeCache;
  public signalKeyCache: NodeCache;

  public saveCreds = async (creds: Partial<AuthenticationCreds>) => {
    await this.sessionManager.saveCredentials(this.auth, creds);
  };
  public connectionListeners: ((
    update: Partial<ConnectionState>,
  ) => boolean)[] = [];

  public DisconnectReason = DisconnectReason;
  public logger: any = pino({ level: 'silent' });

  public checkConnectionInterval: NodeJS.Timeout | null = null;
  public configEvents: ConfigWAEvents = new ConfigWAEvents(this);
  public eventsIsStoped: boolean = false;

  // Novos serviços e managers (privados)
  private loggerService: LoggerService;
  private cacheService: CacheService;
  private errorHandler: ErrorHandler;
  private retryService: RetryService;
  public lidMappingService: LIDMappingService;
  public lidNormalizationService: LIDNormalizationService;
  public pendingMessageQueue: PendingMessageQueue;
  private stateManager: StateManager;
  public connectionManager: ConnectionManager; // Tornado público para permitir reconexão em erros
  private sessionManager: SessionManager;
  private eventManager: EventManager;
  
  // Tornar stateManager acessível para ConfigWAEvents (sem type casting)
  public getStateManager(): StateManager {
    return this.stateManager;
  }

  // Handlers de eventos (privados)
  private connectionEventHandler: ConnectionEventHandler;
  private messageEventHandler: MessageEventHandler;
  private historyEventHandler: HistoryEventHandler;
  private contactEventHandler: ContactEventHandler;
  private groupEventHandler: GroupEventHandler;
  private chatEventHandler: ChatEventHandler;
  private callEventHandler: CallEventHandler;
  private lidMappingEventHandler: LIDMappingEventHandler;

  // Operações especializadas (privadas)
  private messageOperations: MessageOperations;
  private chatOperations: ChatOperations;
  private userOperations: UserOperations;
  private groupOperations: GroupOperations;

  // Getters para compatibilidade (delegam para StateManager)
  public get id(): string {
    return this.stateManager.id;
  }

  public get status(): BotStatus {
    return this.stateManager.status;
  }

  public get phoneNumber(): string {
    return this.stateManager.phoneNumber;
  }

  public get name(): string {
    return this.stateManager.name;
  }

  public get profileUrl(): string {
    return this.stateManager.profileUrl;
  }

  public get lastConnectionUpdateDate(): number {
    return this.stateManager.lastConnectionUpdateDate;
  }

  public get lastDisconnectError(): number | undefined {
    return this.stateManager.lastDisconnectError;
  }

  constructor(config?: Partial<WhatsAppBotConfig>) {
    super();

    // Valida e normaliza configuração
    const validatedConfig = ConfigValidator.validateWithWarnings(config);

    // Inicializa serviços
    this.loggerService = new LoggerService(validatedConfig.logLevel || 'info');
    this.cacheService = new CacheService(this.loggerService);
    this.errorHandler = new ErrorHandler(this.loggerService);
    this.retryService = new RetryService();
    this.lidMappingService = new LIDMappingService(this.loggerService, this.cacheService);
    this.lidNormalizationService = new LIDNormalizationService(this.loggerService, this.lidMappingService);
    this.pendingMessageQueue = new PendingMessageQueue(this.loggerService);
    this.stateManager = new StateManager(this.loggerService);
    this.sessionManager = new SessionManager(this.loggerService);
    this.connectionManager = new ConnectionManager(
      this.stateManager,
      this.sessionManager,
      this.retryService,
      this.errorHandler,
      this.loggerService
    );
    this.eventManager = new EventManager(this.loggerService);

    // Inicializa handlers
    this.connectionEventHandler = new ConnectionEventHandler(
      this,
      this.loggerService,
      this.stateManager,
      this.sessionManager
    );
    this.messageEventHandler = new MessageEventHandler(this, this.loggerService);
    this.historyEventHandler = new HistoryEventHandler(this, this.loggerService);
    this.contactEventHandler = new ContactEventHandler(this, this.loggerService);
    this.groupEventHandler = new GroupEventHandler(this, this.loggerService);
    this.chatEventHandler = new ChatEventHandler(this, this.loggerService);
    this.callEventHandler = new CallEventHandler(this, this.loggerService);
    this.lidMappingEventHandler = new LIDMappingEventHandler(
      this,
      this.loggerService,
      this.lidMappingService,
      this.pendingMessageQueue
    );

    // Inicializa operações especializadas
    this.messageOperations = new MessageOperations(this, this.errorHandler, this.pendingMessageQueue);
    this.chatOperations = new ChatOperations(this);
    this.userOperations = new UserOperations(this);
    this.groupOperations = new GroupOperations(this);

    // Configura caches usando CacheService
    this.msgRetryCountercache = this.cacheService.getMessageRetryCache();
    this.groupMetadataCache = this.cacheService.getGroupMetadataCache();
    this.signalKeyCache = this.cacheService.getSignalKeyCache();

    // Cria store
    const store = makeInMemoryStore({ logger: this.logger });
    this.store = store;

    const waBot = this;

    // Configuração do socket (usa valores validados)
    this.config = {
      ...DEFAULT_CONNECTION_CONFIG,
      logger: this.logger,
      qrTimeout: validatedConfig.qrTimeout,
      defaultQueryTimeoutMs: validatedConfig.defaultQueryTimeoutMs,
      retryRequestDelayMs: validatedConfig.retryRequestDelayMs,
      maxMsgRetryCount: 5,
      readAllFailedMessages: validatedConfig.readAllFailedMessages,
      msgRetryCounterCache: this.msgRetryCountercache,
      autoRestartInterval: validatedConfig.autoRestartInterval,
      useExperimentalServers: validatedConfig.useExperimentalServers,
      autoSyncHistory: validatedConfig.autoSyncHistory,
      autoLoadContactInfo: validatedConfig.autoLoadContactInfo,
      autoLoadGroupInfo: validatedConfig.autoLoadGroupInfo,
      autoRejectCalls: validatedConfig.autoRejectCalls,
      shouldIgnoreJid: () => false,
      // v7.0.0-rc.5: Removido ACKs automáticos para evitar banimentos
      generateHighQualityLinkPreview: false,
      async patchMessageBeforeSending(msg) {
        if (
          msg.deviceSentMessage?.message?.listMessage?.listType ==
          proto.Message.ListMessage.ListType.PRODUCT_LIST
        ) {
          msg = JSON.parse(JSON.stringify(msg));

          msg.deviceSentMessage!.message!.listMessage!.listType =
            proto.Message.ListMessage.ListType.SINGLE_SELECT;
        }

        if (
          msg.listMessage?.listType ==
          proto.Message.ListMessage.ListType.PRODUCT_LIST
        ) {
          msg = JSON.parse(JSON.stringify(msg));

          msg.listMessage!.listType =
            proto.Message.ListMessage.ListType.SINGLE_SELECT;
        }

        return msg;
      },
      async getMessage(key) {
        const msg = await waBot.store.loadMessage(fixID(key.remoteJid!), key.id!);
        if (!msg) return undefined;
        
        // v7.0.0-rc.5: Retornar mensagem diretamente
        // BufferJSON será implementado quando estiver disponível na API estável
        return msg.message;
      },
      cachedGroupMetadata: async (jid) => this.groupMetadataCache.get(jid),
    };

    delete this.config.auth;

    // NOTA: Listeners de eventos Baileys são configurados em:
    // - setupEventHandlers() - handlers especializados (MessageEventHandler, etc.)
    // - ConfigWAEvents.configureAll() - configuração de eventos do Baileys
    // Não adicionar listeners diretamente aqui para evitar vazamento de memória
  }

  public async connect(auth?: string | IAuth): Promise<void> {
    if (!auth || typeof auth == 'string') {
      this.auth = new MultiFileAuthState(`${auth || './session'}`);
    } else {
      this.auth = auth;
    }

    // Cria e configura o socket (método centralizado)
    await this.createSocket();
  }

  /**
   * Cria e configura um novo socket (método centralizado)
   * Usado tanto em connect() quanto após restartRequired
   */
  private isCreatingSocket: boolean = false;
  private createSocketPromise: Promise<void> | null = null;

  public async createSocket(): Promise<void> {
    // Previne race condition: se já estiver criando, retorna a Promise existente
    if (this.isCreatingSocket && this.createSocketPromise) {
      return this.createSocketPromise;
    }

    this.isCreatingSocket = true;
    this.createSocketPromise = this._createSocketInternal().finally(() => {
      this.isCreatingSocket = false;
      this.createSocketPromise = null;
    });

    return this.createSocketPromise;
  }

  private async _createSocketInternal(): Promise<void> {
    // Carrega credenciais
    const { state, saveCreds } = await getBaileysAuth(this.auth);
    this.saveCreds = saveCreds;

    // Cria logger para o Baileys (filtra logs de sessão se logLevel for 'warn' ou superior)
    // O Baileys usa este logger para logs internos, incluindo "Closing session"
    const baileysLogger = this.config.logger || pino({ 
      level: this.config.logLevel === 'info' ? 'warn' : this.config.logLevel || 'warn' 
    });

    // Cria configuração do socket
    const socketConfig: SocketConfig = {
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      browser: Browsers.windows('Rompot'),
      logger: baileysLogger, // Passa logger explicitamente para o Baileys
      ...this.config,
    } as SocketConfig;

    // Fecha socket anterior se existir
    if (this.sock) {
      try {
        // Remove todos os listeners ANTES de fechar para evitar vazamento
        this.configEvents.cleanup(); // Limpa listeners do ConfigWAEvents
        this.eventManager.cleanup(); // Limpa listeners do EventManager
        this.sock.end(undefined);
      } catch (err) {
        // Ignora erros
      }
    }

    // Cria novo socket
    this.sock = makeWASocket(socketConfig);
    
    // Armazena configuração no ConnectionManager
    this.connectionManager.connectionConfig = socketConfig;
    
    // Configura componentes
    this.store.bind(this.sock.ev);
    this.eventManager.setSocket(this.sock);
    this.lidMappingService.setSocket(this.sock);
    this.lidNormalizationService.setSocket(this.sock);

    // Configura handlers (CRÍTICO: antes de qualquer evento)
    this.configEvents.configureAll();
    this.setupEventHandlers();

    // Configura limpeza periódica da fila de mensagens pendentes (a cada 30 segundos)
    if (this.pendingMessageQueue) {
      setInterval(() => {
        this.pendingMessageQueue.cleanup();
      }, 30000);
    }

    // Configura creds.update
    this.sock.ev.on('creds.update', saveCreds);

    // Se já estiver conectado, emite evento
    if (this.sock?.ws.isOpen) {
      this.emit('open', { isNewLogin: false });
    }
  }

  /**
   * Configura todos os handlers de eventos
   */
  private setupEventHandlers(): void {
    if (!this.sock) return;

    this.connectionEventHandler.setup(this.sock);
    this.messageEventHandler.setup(this.sock);
    this.historyEventHandler.setup(this.sock);
    this.contactEventHandler.setup(this.sock);
    this.groupEventHandler.setup(this.sock);
    this.chatEventHandler.setup(this.sock);
    this.callEventHandler.setup(this.sock);
    this.lidMappingEventHandler.setup(this.sock);
  }

  /**
   * * Reconecta ao servidor do WhatsApp
   * @returns
   */
  public async reconnect(
    stopEvents: boolean = false,
    showOpen?: boolean,
    force: boolean = false,
  ): Promise<void> {
    // 428 foi removido da lista de erros não reconectáveis
    // É um erro temporário que permite reconexão
    // Apenas 401/421 (token expirado) impedem reconexão

    // Se já estiver conectado, não precisa reconectar
    if (this.sock?.ws.isOpen) {
      return;
    }

    // Se force=true (vindo de restartRequired após QR code), sempre reconecta
    // Caso contrário, verifica se está aguardando QR code inicial
    // IMPORTANTE: Não impede reconexão se for restartRequired (código 515)
    // O restartRequired acontece após escanear QR code e precisa reconectar imediatamente
    if (!force && this.sock && !this.sock.ws.isOpen) {
      // Verifica se o último erro foi restartRequired (515) - se sim, permite reconexão
      const isRestartRequired = this.lastDisconnectError === DisconnectReason.restartRequired;
      
      if (!isRestartRequired) {
        // Verifica se há QR code pendente - se sim, não reconecta
        // Mas permite se for restartRequired
        this.loggerService.warn('Aguardando autenticação (QR code). Não reconectando para evitar limpar sessão.');
        return;
      }
      // Se for restartRequired, continua e reconecta (force será true implicitamente)
      this.loggerService.info('RestartRequired detectado (após QR code). Reconectando...');
      force = true; // Força reconexão para restartRequired
    }

    // Limpa socket anterior se existir (sem desconectar explicitamente)
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch (err) {
        // Ignora erros ao fechar socket anterior
      }
    }
    
    // Delay antes de reconectar (mas não para restartRequired - precisa ser imediato)
    if (!force) {
      await new Promise((resolve) => setTimeout(resolve, Timeouts.RECONNECT_DELAY));
    }
    
    this.emit('reconnecting', {});
    
    // Reconecta chamando connect novamente
    // Para restartRequired (force=true), reconecta imediatamente sem delay
    await this.connect();
  }

  /**
   * * Desliga a conexão com o servidor do WhatsApp
   * @param reason
   * @returns
   */
  public async stop(reason: any = ErrorCodes.CONNECTION_CLOSED): Promise<void> {
    try {
      this.stateManager.setStatus(BotStatus.Offline);
      
      // Limpa event handlers (já remove listeners do socket)
      this.configEvents.cleanup(); // Limpa listeners do ConfigWAEvents
      this.eventManager.cleanup(); // Limpa listeners do EventManager
      
      // Limpa connection listeners
      this.connectionListeners = [];
      
      // Limpa checkConnectionInterval
      if (this.checkConnectionInterval) {
        clearInterval(this.checkConnectionInterval);
        this.checkConnectionInterval = null;
      }
      
      await this.connectionManager.disconnect(reason);
    } catch (err) {
      this.errorHandler.handle(err, 'WhatsAppBot.stop');
      this.emit('error', err);
    }
  }

  public async logout(): Promise<void> {
    await this.sock?.logout();
  }

  /**
   * * Aguarda um status de conexão
   */
  public async awaitConnectionState(
    connection: WAConnectionState,
  ): Promise<Partial<ConnectionState>> {
    return new Promise<Partial<ConnectionState>>((res, rej) => {
      // Timeout usando constante
      const timeout = setTimeout(() => {
        // Remove listener do array para evitar vazamento
        const index = this.connectionListeners.indexOf(listener);
        if (index > -1) {
          this.connectionListeners.splice(index, 1);
        }
        rej(new Error(`Timeout ao aguardar conexão '${connection}'`));
      }, Timeouts.CONNECTION_WAIT);

      const listener = (update: Partial<ConnectionState>) => {
        if (update.connection != connection) return false;

        clearTimeout(timeout);
        // Remove listener do array após resolver
        const index = this.connectionListeners.indexOf(listener);
        if (index > -1) {
          this.connectionListeners.splice(index, 1);
        }
        res(update);
        return true;
      };

      this.connectionListeners.push(listener);

      // Se já estiver no estado desejado, resolve imediatamente
      if (this.sock?.ws.isOpen && connection === 'open') {
        clearTimeout(timeout);
        // Remove listener do array
        const index = this.connectionListeners.indexOf(listener);
        if (index > -1) {
          this.connectionListeners.splice(index, 1);
        }
        res({ connection: 'open' });
        return;
      }
    });
  }

  /**
   * * Lê o chat
   * @param chat Sala de bate-papo
   */
  public async readChat(
    chat: Partial<Chat>,
    metadata?: Partial<GroupMetadata> & Partial<BaileysChat>,
    updateMetadata: boolean = true,
  ): Promise<void> {
    return this.chatOperations.readChat(chat, metadata, updateMetadata);
  }

  /**
   * * Lê o usuário
   * @param user Usuário
   */
  public async readUser(user: Partial<User>, metadata?: Partial<Contact>): Promise<void> {
    return this.userOperations.readUser(user, metadata);
  }

  /**
   * Obtem uma mensagem de enquete.
   * @param pollMessageId - ID da mensagem de enquete que será obtida.
   * @returns A mensagem de enquete salva.
   */
  public async getPollMessage(
    pollMessageId: string,
  ): Promise<PollMessage | PollUpdateMessage> {
    return this.messageOperations.getPollMessage(pollMessageId);
  }

  /**
   * Salva a mensagem de enquete.
   * @param pollMessage - Mensagem de enquete que será salva.
   */
  public async savePollMessage(
    pollMessage: PollMessage | PollUpdateMessage,
  ): Promise<void> {
    return this.messageOperations.savePollMessage(pollMessage);
  }

  /**
   * * Trata atualizações de participantes
   * @param action Ação realizada
   * @param chatId Sala de bate-papo que a ação foi realizada
   * @param userId Usuário que foi destinado a ação
   * @param fromId Usuário que realizou a ação
   */
  public async groupParticipantsUpdate(
    action: UserAction,
    chatId: string,
    userId: string,
    fromId: string,
  ) {
    return this.groupOperations.groupParticipantsUpdate(action, chatId, userId, fromId);
  }

  //! ********************************* CHAT *********************************

  public async getChatName(chat: Chat) {
    return this.chatOperations.getChatName(chat);
  }

  public async setChatName(chat: Chat, name: string) {
    return this.chatOperations.setChatName(chat, name);
  }

  public async getChatDescription(chat: Chat) {
    return this.chatOperations.getChatDescription(chat);
  }

  public async setChatDescription(chat: Chat, description: string): Promise<any> {
    return this.chatOperations.setChatDescription(chat, description);
  }

  public async getChatProfile(chat: Chat, lowQuality?: boolean): Promise<Buffer> {
    return this.chatOperations.getChatProfile(chat, lowQuality);
  }

  public async getChatProfileUrl(chat: Chat, lowQuality?: boolean) {
    return this.chatOperations.getChatProfileUrl(chat, lowQuality);
  }

  public async setChatProfile(chat: Chat, image: Buffer) {
    return this.chatOperations.setChatProfile(chat, image);
  }

  public async updateChat(chat: { id: string } & Partial<Chat>): Promise<void> {
    return this.chatOperations.updateChat(chat);
  }

  public async removeChat(chat: Chat): Promise<void> {
    return this.chatOperations.removeChat(chat);
  }

  public async getChat(chat: Chat): Promise<Chat | null> {
    return this.chatOperations.getChat(chat);
  }

  public async getChats(): Promise<string[]> {
    return this.chatOperations.getChats();
  }

  public async setChats(chats: Chat[]): Promise<void> {
    return this.chatOperations.setChats(chats);
  }

  public async getChatUsers(chat: Chat): Promise<string[]> {
    return this.chatOperations.getChatUsers(chat);
  }

  public async getChatAdmins(chat: Chat): Promise<string[]> {
    return this.chatOperations.getChatAdmins(chat);
  }

  public async getChatLeader(chat: Chat): Promise<string> {
    return this.chatOperations.getChatLeader(chat);
  }

  public async addUserInChat(chat: Chat, user: User) {
    return this.groupOperations.addUserInChat(chat, user);
  }

  public async removeUserInChat(chat: Chat, user: User) {
    return this.groupOperations.removeUserInChat(chat, user);
  }

  public async promoteUserInChat(chat: Chat, user: User): Promise<void> {
    return this.groupOperations.promoteUserInChat(chat, user);
  }

  public async demoteUserInChat(chat: Chat, user: User): Promise<void> {
    return this.groupOperations.demoteUserInChat(chat, user);
  }

  public async changeChatStatus(chat: Chat, status: ChatStatus): Promise<void> {
    return this.chatOperations.changeChatStatus(chat, status);
  }

  public async createChat(chat: Chat) {
    return this.chatOperations.createChat(chat);
  }

  public async leaveChat(chat: Chat): Promise<void> {
    return this.chatOperations.leaveChat(chat);
  }

  public async joinChat(code: string): Promise<void> {
    return this.chatOperations.joinChat(code);
  }

  public async getChatInvite(chat: Chat): Promise<string> {
    return this.chatOperations.getChatInvite(chat);
  }

  public async revokeChatInvite(chat: Chat): Promise<string> {
    return this.chatOperations.revokeChatInvite(chat);
  }

  public async rejectCall(call: Call): Promise<void> {
    await this.sock.rejectCall(call.id, call.chat.id);
  }

  public async getUserName(user: User): Promise<string> {
    return this.userOperations.getUserName(user);
  }

  public async setUserName(user: User, name: string): Promise<void> {
    return this.userOperations.setUserName(user, name);
  }

  public async getUserDescription(user: User): Promise<string> {
    return this.userOperations.getUserDescription(user);
  }

  public async setUserDescription(user: User, description: string): Promise<void> {
    return this.userOperations.setUserDescription(user, description);
  }

  public async getUserProfile(user: User, lowQuality?: boolean): Promise<Buffer> {
    return this.userOperations.getUserProfile(user, lowQuality);
  }

  public async getUserProfileUrl(user: User, lowQuality?: boolean) {
    return this.userOperations.getUserProfileUrl(user, lowQuality);
  }

  public async setUserProfile(user: User, image: Buffer) {
    return this.userOperations.setUserProfile(user, image);
  }

  public async getUser(user: User): Promise<User | null> {
    return this.userOperations.getUser(user);
  }

  public async getUsers(): Promise<string[]> {
    return this.userOperations.getUsers();
  }

  public async updateUser(user: { id: string } & Partial<User>): Promise<void> {
    return this.userOperations.updateUser(user);
  }

  public async setUsers(users: User[]): Promise<void> {
    return this.userOperations.setUsers(users);
  }

  public async removeUser(user: User): Promise<void> {
    return this.userOperations.removeUser(user);
  }

  public async blockUser(user: User) {
    return this.userOperations.blockUser(user);
  }

  public async unblockUser(user: User) {
    return this.userOperations.unblockUser(user);
  }

  //! ******************************** BOT ********************************

  public async getBotName(): Promise<string> {
    return this.userOperations.getBotName();
  }

  public async setBotName(name: string): Promise<void> {
    return this.userOperations.setBotName(name);
  }

  public async getBotDescription(): Promise<string> {
    return this.userOperations.getBotDescription();
  }

  public async setBotDescription(description: string): Promise<void> {
    return this.userOperations.setBotDescription(description);
  }

  public async getBotProfile(lowQuality?: boolean): Promise<Buffer> {
    return this.userOperations.getBotProfile(lowQuality);
  }

  public async getBotProfileUrl(lowQuality?: boolean): Promise<string> {
    return this.userOperations.getBotProfileUrl(lowQuality);
  }

  public async setBotProfile(image: Buffer): Promise<void> {
    return this.userOperations.setBotProfile(image);
  }

  //! ******************************* MESSAGE *******************************

  public async readMessage(message: Message): Promise<void> {
    return this.messageOperations.readMessage(message);
  }

  // Adiciona um método utilitário para cache de mensagens
  public addMessageCache(id: string) {
    if (!this.messagesCached.includes(id)) {
      this.messagesCached.push(id);
    }
  }

  // ================= APP STATE UPDATES =================
  /** Arquiva ou desarquiva um chat */
  public async archiveChat(chat: Chat | string, archive: boolean = true, lastMessages: any[]) {
    return this.chatOperations.archiveChat(chat, archive, lastMessages);
  }

  /** Silencia ou dessilencia um chat */
  public async muteChat(chat: Chat | string, mute: number | null, lastMessages: any[]) {
    return this.chatOperations.muteChat(chat, mute, lastMessages);
  }

  /** Marca um chat como lido */
  public async markChatRead(chat: Chat | string, read: boolean = true, lastMessages: any[]) {
    return this.chatOperations.markChatRead(chat, read, lastMessages);
  }

  /** Define o modo de mensagens temporárias em um chat */
  public async setDisappearingMessages(chat: Chat | string, duration: number) {
    return this.chatOperations.setDisappearingMessages(chat, duration);
  }

  // ================= BUSINESS FEATURES =================
  /** Busca o perfil de negócio de um contato */
  public async fetchBusinessProfile(jid: string) {
    return await this.sock.getBusinessProfile(jid);
  }

  // O método fetchBusinessProducts foi removido pois não existe na API pública do Baileys.
  // Se precisar de recursos de catálogo, utilize a API oficial do WhatsApp Business.

  // ================= PRIVACIDADE =================
  public async fetchBlocklist() {
    return await this.sock.fetchBlocklist();
  }

  public async fetchPrivacySettings(force: boolean = false) {
    return await this.sock.fetchPrivacySettings(force);
  }

  public async updateOnlinePrivacy(option: 'all' | 'match_last_seen') {
    await this.sock.updateOnlinePrivacy(option);
  }

  public async updateLastSeenPrivacy(option: 'all' | 'contacts' | 'contact_blacklist' | 'none') {
    await this.sock.updateLastSeenPrivacy(option);
  }

  public async updateProfilePicturePrivacy(option: 'all' | 'contacts' | 'contact_blacklist' | 'none') {
    await this.sock.updateProfilePicturePrivacy(option);
  }

  public async updateStatusPrivacy(option: 'all' | 'contacts' | 'contact_blacklist' | 'none') {
    await this.sock.updateStatusPrivacy(option);
  }

  public async updateGroupsAddPrivacy(option: 'all' | 'contacts' | 'contact_blacklist') {
    await this.sock.updateGroupsAddPrivacy(option);
  }

  public async updateReadReceiptsPrivacy(option: 'all' | 'none') {
    await this.sock.updateReadReceiptsPrivacy(option);
  }

  /**
   * Adiciona uma reação a uma mensagem
   */
  public async addReaction(message: ReactionMessage): Promise<void> {
    return this.messageOperations.addReaction(message);
  }

  /** Remove uma reação de uma mensagem */
  public async removeReaction(message: ReactionMessage): Promise<void> {
    return this.messageOperations.removeReaction(message);
  }

  /** Edita o texto de uma mensagem enviada */
  public async editMessage(message: Message): Promise<void> {
    return this.messageOperations.editMessage(message);
  }

  /** Envia uma mensagem */
  public async send(message: Message): Promise<Message> {
    return this.messageOperations.send(message);
  }

  /** Remove uma mensagem (marca como removida para todos) */
  public async removeMessage(message: Message): Promise<void> {
    return this.messageOperations.removeMessage(message);
  }

  /** Deleta uma mensagem (remove do histórico) */
  public async deleteMessage(message: Message): Promise<void> {
    return this.messageOperations.deleteMessage(message);
  }

  /** Baixa a stream de mídia de uma mensagem */
  public async downloadStreamMessage(media: Media): Promise<Buffer> {
    // A interface IBot espera Media, mas internamente precisamos de MediaMessage
    // MediaMessage estende Message e tem chat e id necessários para carregar do store
    // Na prática, sempre será passado MediaMessage, então fazemos type assertion
    if (media instanceof MediaMessage) {
      return this.messageOperations.downloadStreamMessage(media);
    }
    // Se não for MediaMessage, tenta usar como MediaMessage (compatibilidade)
    // Isso permite que código que passa MediaMessage funcione
    return this.messageOperations.downloadStreamMessage(media as unknown as MediaMessage);
  }
}