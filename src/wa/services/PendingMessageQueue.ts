import Message from '../../messages/Message';
import { ILoggerService } from '../interfaces/ILoggerService';
import { getID, jidUser } from '../ID';

export interface PendingMessage {
  message: Message;
  originalJID: string;
  timestamp: number;
  retries: number;
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
}

/**
 * Serviço de fila de mensagens pendentes para JIDs LID
 * Armazena mensagens que não puderam ser enviadas porque o mapeamento LID/PN não estava disponível
 * Processa mensagens quando o mapeamento ficar disponível
 */
export class PendingMessageQueue {
  private queue: Map<string, PendingMessage[]> = new Map();
  private logger: ILoggerService;
  private maxRetries: number = 3;
  private maxAge: number = 60000; // 60 segundos

  constructor(logger: ILoggerService) {
    this.logger = logger;
  }

  /**
   * Adiciona uma mensagem à fila de pendentes
   */
  add(message: Message, resolve: (message: Message) => void, reject: (error: Error) => void): void {
    const lid = jidUser(message.chat.id);
    
    if (!this.queue.has(lid)) {
      this.queue.set(lid, []);
    }

    const pending: PendingMessage = {
      message,
      originalJID: message.chat.id,
      timestamp: Date.now(),
      retries: 0,
      resolve,
      reject,
    };

    this.queue.get(lid)!.push(pending);
    this.logger.info(`📥 Mensagem adicionada à fila de pendentes (LID: ${lid}). Total na fila: ${this.queue.get(lid)!.length}. Aguardando mapeamento LID/PN...`);
  }

  /**
   * Processa mensagens pendentes para um LID quando o mapeamento ficar disponível
   */
  async processPendingMessages(lid: string, pn: string): Promise<void> {
    const lidKey = jidUser(lid);
    const pendingMessages = this.queue.get(lidKey) || this.queue.get(lid);
    if (!pendingMessages || pendingMessages.length === 0) {
      return;
    }

    const normalizedJID = getID(pn);
    this.logger.info(`✅ Mapeamento LID/PN disponível! Processando ${pendingMessages.length} mensagem(ns) pendente(s) para LID ${lid} -> ${normalizedJID}`);

    // Remove da fila ANTES de processar (evita processamento duplicado)
    this.queue.delete(lidKey);
    this.queue.delete(lid);

    // Processa todas as mensagens pendentes para este LID
    // A promise resolve já chama sendMessageInternal automaticamente
    const promises = pendingMessages.map(async (pending) => {
      try {
        // Atualiza o JID da mensagem
        pending.message.chat.id = normalizedJID;
        
        // Resolve a promise (o callback já envia a mensagem)
        pending.resolve(pending.message);
      } catch (error) {
        pending.reject(error as Error);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Remove mensagens antigas da fila (limpeza periódica)
   */
  cleanup(): void {
    const now = Date.now();
    const lidsToRemove: string[] = [];

    for (const [lid, messages] of this.queue.entries()) {
      const validMessages = messages.filter((pending) => {
        const age = now - pending.timestamp;
        
        if (age > this.maxAge) {
          // Mensagem muito antiga, rejeita
          pending.reject(new Error(`Mensagem pendente expirou após ${this.maxAge}ms`));
          return false;
        }

        return true;
      });

      if (validMessages.length === 0) {
        lidsToRemove.push(lid);
      } else {
        this.queue.set(lid, validMessages);
      }
    }

    lidsToRemove.forEach((lid) => this.queue.delete(lid));
  }

  /**
   * Retorna o número de mensagens pendentes para um LID
   */
  getPendingCount(lid: string): number {
    return this.queue.get(jidUser(lid))?.length || this.queue.get(lid)?.length || 0;
  }

  /**
   * Retorna o número total de mensagens pendentes
   */
  getTotalPendingCount(): number {
    let total = 0;
    for (const messages of this.queue.values()) {
      total += messages.length;
    }
    return total;
  }

  /**
   * Limpa todas as mensagens pendentes
   */
  clear(): void {
    // Rejeita todas as mensagens pendentes
    for (const messages of this.queue.values()) {
      messages.forEach((pending) => {
        pending.reject(new Error('Fila de mensagens pendentes foi limpa'));
      });
    }
    this.queue.clear();
  }
}

