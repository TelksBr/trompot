import { WASocket, ConnectionState, BaileysEventMap } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';

type EventHandler<T = any> = (data: T) => void | Promise<void>;

export class EventManager {
  private socket: WASocket | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private logger: ILoggerService;
  private cleanupFunctions: (() => void)[] = [];

  constructor(logger: ILoggerService) {
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
    // Remove listeners do Baileys
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];
    
    // Limpa listeners internos
    this.listeners.clear();
    // Log removido para reduzir verbosidade
  }

  /**
   * Configura listeners core do Baileys
   * NOTA: connection.update é gerenciado exclusivamente pelo ConfigWAEvents
   * para evitar processamento duplicado. EventManager não escuta diretamente.
   */
  private setupCoreListeners(): void {
    if (!this.socket?.ev) return;

    // REMOVIDO: Listener duplicado de connection.update
    // O ConfigWAEvents é o único responsável por escutar connection.update
    // EventManager não precisa escutar diretamente para evitar duplicação

    // Creds update
    const credsHandler = (creds: any) => {
      this.emit('creds.update', creds);
    };
    this.socket.ev.on('creds.update', credsHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('creds.update', credsHandler);
    });

    // Messages
    const messagesUpsertHandler = (data: any) => {
      this.emit('messages.upsert', data);
    };
    this.socket.ev.on('messages.upsert', messagesUpsertHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('messages.upsert', messagesUpsertHandler);
    });

    const messagesUpdateHandler = (data: any) => {
      this.emit('messages.update', data);
    };
    this.socket.ev.on('messages.update', messagesUpdateHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('messages.update', messagesUpdateHandler);
    });

    // Contacts
    const contactsUpsertHandler = (data: any) => {
      this.emit('contacts.upsert', data);
    };
    this.socket.ev.on('contacts.upsert', contactsUpsertHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('contacts.upsert', contactsUpsertHandler);
    });

    const contactsUpdateHandler = (data: any) => {
      this.emit('contacts.update', data);
    };
    this.socket.ev.on('contacts.update', contactsUpdateHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('contacts.update', contactsUpdateHandler);
    });

    // Groups
    const groupsUpdateHandler = (data: any) => {
      this.emit('groups.update', data);
    };
    this.socket.ev.on('groups.update', groupsUpdateHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('groups.update', groupsUpdateHandler);
    });

    // Chats
    const chatsDeleteHandler = (data: any) => {
      this.emit('chats.delete', data);
    };
    this.socket.ev.on('chats.delete', chatsDeleteHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('chats.delete', chatsDeleteHandler);
    });

    // History (OBRIGATÓRIO no v7.0.0)
    const historyHandler = (data: any) => {
      this.emit('messaging-history.set', data);
    };
    this.socket.ev.on('messaging-history.set', historyHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('messaging-history.set', historyHandler);
    });

    // Calls
    const callHandler = (data: any) => {
      this.emit('call', data);
    };
    this.socket.ev.on('call', callHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('call', callHandler);
    });

    // LID Mapping (novo no v7.0.0)
    const lidMappingHandler = (data: any) => {
      this.emit('lid-mapping.update', data);
    };
    this.socket.ev.on('lid-mapping.update', lidMappingHandler);
    this.cleanupFunctions.push(() => {
      this.socket?.ev.off('lid-mapping.update', lidMappingHandler);
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

  onHistorySet(handler: EventHandler): () => void {
    return this.on('messaging-history.set', handler);
  }

  onLIDMappingUpdate(handler: EventHandler): () => void {
    return this.on('lid-mapping.update', handler);
  }
}

