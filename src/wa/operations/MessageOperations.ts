import { downloadMediaMessage, isJidGroup } from '@whiskeysockets/baileys';
import Message, { MessageType } from '../../messages/Message';
import MediaMessage from '../../messages/MediaMessage';
import ReactionMessage from '../../messages/ReactionMessage';
import { PollMessage, PollUpdateMessage } from '../../messages';
import { BotStatus } from '../../bot/BotStatus';
import { Validation } from '../utils/Validation';
import { isValidJID } from '../constants/JIDPatterns';
import ConvertToWAMessage from '../ConvertToWAMessage';
import { ErrorHandler } from '../services/ErrorHandler';
import { PendingMessageQueue } from '../services/PendingMessageQueue';
import WhatsAppBot from '../WhatsAppBot';
import ChatType from '../../modules/chat/ChatType';
import { getID } from '../ID';

/**
 * Operações relacionadas a mensagens
 */
export class MessageOperations {
  private bot: WhatsAppBot;
  private errorHandler: ErrorHandler;
  private pendingMessageQueue: PendingMessageQueue;

  constructor(bot: WhatsAppBot, errorHandler: ErrorHandler, pendingMessageQueue: PendingMessageQueue) {
    this.bot = bot;
    this.errorHandler = errorHandler;
    this.pendingMessageQueue = pendingMessageQueue;
  }

  /**
   * Normaliza JID LID para JID válido (baseado em práticas do Rompot)
   * Tenta normalizar apenas quando necessário (antes de enviar mensagem)
   * Usa LIDMappingService do bot (que tem cache) primeiro
   * Tenta múltiplas vezes com delays crescentes antes de desistir
   */
  private async normalizeJIDForSend(jid: string, maxRetries: number = 5): Promise<string | null> {
    if (!jid || isValidJID(jid)) {
      return jid;
    }

    // Verifica se é um JID LID (termina com @lid)
    if (jid.endsWith('@lid')) {
      const lid = jid.replace('@lid', '');
      
      // Tenta usar o LIDNormalizationService (múltiplas estratégias, mais rápido)
      try {
        if (this.bot.lidNormalizationService) {
          const normalized = await this.bot.lidNormalizationService.normalizeJID(jid, false);
          if (normalized && isValidJID(normalized)) {
            return normalized;
          }
        }
      } catch (error) {
        // Ignora erro - continua para tentar do socket
      }
      
      // Tenta múltiplas vezes do socket com delays crescentes
      // Delays: 500ms, 1000ms, 2000ms, 4000ms, 8000ms
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (this.bot.sock?.signalRepository?.lidMapping) {
            const pn = await this.bot.sock.signalRepository.lidMapping.getPNForLID(lid);
            
            if (pn) {
              return getID(pn);
            }
          }
          
          // Aguarda antes de tentar novamente (backoff exponencial)
          if (attempt < maxRetries - 1) {
            const delay = 500 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          // Ignora erro
          if (attempt < maxRetries - 1) {
            const delay = 500 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
    }

    // Retorna null se não conseguir normalizar (indica que deve usar fila ou fallback)
    return null;
  }

  /**
   * Envia uma mensagem
   * Baseado no Rompot: normaliza JID apenas quando necessário (antes de enviar)
   * Usa fila de mensagens pendentes se o mapeamento LID/PN não estiver disponível
   */
  async send(message: Message): Promise<Message> {
    // Valida estado antes de enviar
    const sockIsOpen = this.bot.sock?.ws?.isOpen === true;
    
    if (!sockIsOpen) {
      const error = new Error('Bot não está conectado. Socket não está aberto.');
      throw error;
    }

    // Normaliza JID LID antes de validar (se necessário)
    if (message.chat?.id && !isValidJID(message.chat.id)) {
      // Verifica se o socket está disponível antes de tentar normalizar
      if (!this.bot.sock?.signalRepository?.lidMapping) {
        const error = new Error(`JID de chat inválido: ${message.chat?.id}. Socket não está disponível para normalização LID.`);
        throw error;
      }

      // Tenta normalizar usando LIDNormalizationService (múltiplas estratégias otimizadas)
      let normalizedJID: string | null = null;
      
      try {
        if (this.bot.lidNormalizationService) {
          normalizedJID = await this.bot.lidNormalizationService.normalizeJID(message.chat.id, false);
        }
      } catch (error) {
        // Ignora erro - continua para tentar outras estratégias
      }
      
      if (normalizedJID && isValidJID(normalizedJID)) {
        // Normalização bem-sucedida, atualiza o JID e continua
        message.chat.id = normalizedJID;
      } else {
        // Se não conseguiu normalizar, tenta enviar com JID LID diretamente primeiro
        // Baileys pode aceitar JID LID em alguns casos
        try {
          const waMsg = (await new ConvertToWAMessage(this.bot, message).refactory()).waMessage;
          const sent = await this.bot.sock.sendMessage(message.chat.id, waMsg);
          
          if (sent && sent.key && sent.key.id) {
            message.id = sent.key.id;
          }
          
          return message;
        } catch (sendError) {
          // Se falhar ao enviar com LID, adiciona à fila de pendentes
          // A mensagem será processada quando o mapeamento ficar disponível
          return new Promise<Message>((resolve, reject) => {
            this.pendingMessageQueue.add(message, 
              // Resolve: quando o mapeamento ficar disponível, envia a mensagem
              async (normalizedMessage) => {
                try {
                  const sent = await this.sendMessageInternal(normalizedMessage);
                  resolve(sent);
                } catch (error) {
                  reject(error as Error);
                }
              },
              // Reject: se a mensagem expirar ou houver erro
              reject
            );
          });
        }
      }
    }

    // Valida JID do chat usando utilitário
    if (!message.chat?.id || !isValidJID(message.chat.id)) {
      const error = new Error(`JID de chat inválido: ${message.chat?.id}. O mapeamento LID/PN pode não estar disponível ainda.`);
      throw error;
    }

    // Envia a mensagem
    return this.sendMessageInternal(message);
  }

  /**
   * Envia a mensagem internamente (JID já deve estar normalizado)
   */
  private async sendMessageInternal(message: Message): Promise<Message> {
    try {
      const waMsg = (await new ConvertToWAMessage(this.bot, message).refactory()).waMessage;
      const sent = await this.bot.sock.sendMessage(message.chat.id, waMsg);
      
      if (sent && sent.key && sent.key.id) {
        message.id = sent.key.id;
      }
      
      return message;
    } catch (error) {
      this.errorHandler.handle(error, 'MessageOperations.sendMessageInternal');
      throw error;
    }
  }

  /**
   * Lê uma mensagem (marca como lida localmente)
   */
  async readMessage(message: Message): Promise<void> {
    // Validações básicas
    if (!message.chat?.id || !message.id) {
      return;
    }
    
    // Valida se socket está disponível (mas não exige conexão completa para leitura)
    if (!this.bot.sock) {
      return;
    }
    
    // REMOVIDO: await this.bot.getChat(message.chat) - estava bloqueando!
    // Não precisa buscar chat do cache - já temos message.chat.type
    // Apenas marca como lido localmente, sem enviar ACK
    const chatType = isJidGroup(message.chat.id) ? ChatType.Group : ChatType.PV;
    
    if (chatType === ChatType.Group || chatType === ChatType.PV) {
      // Marcar mensagem como lida apenas no cache local
      this.bot.addMessageCache(message.id || '');
    }
  }

  /**
   * Remove uma mensagem (marca como removida para todos)
   */
  async removeMessage(message: Message): Promise<void> {
    if (!message.id || !message.chat?.id) return;
    await this.bot.sock.sendMessage(message.chat.id, {
      delete: {
        remoteJid: message.chat.id,
        id: message.id,
        fromMe: message.fromMe || message.user.id === this.bot.id,
        participant: isJidGroup(message.chat.id)
          ? message.user.id || this.bot.id || undefined
          : undefined,
      },
    });
  }

  /**
   * Deleta uma mensagem (remove do histórico)
   */
  async deleteMessage(message: Message): Promise<void> {
    if (!message.id || !message.chat?.id) return;
    await this.bot.sock.sendMessage(message.chat.id, {
      delete: {
        remoteJid: message.chat.id,
        id: message.id,
        fromMe: message.fromMe || message.user.id === this.bot.id,
        participant: isJidGroup(message.chat.id)
          ? message.user.id || this.bot.id || undefined
          : undefined,
      },
    });
  }

  /**
   * Edita o texto de uma mensagem enviada
   */
  async editMessage(message: Message): Promise<void> {
    // Validações
    Validation.ensureConnected(this.bot.status, this.bot.sock);
    if (!message.id || !message.chat?.id) {
      throw new Error('Message deve ter id e chat.id válidos para edição');
    }
    Validation.ensureValidJID(message.chat.id, 'message.chat.id');
    await this.bot.sock.sendMessage(message.chat.id, {
      edit: {
        remoteJid: message.chat.id,
        id: message.id,
        fromMe: message.fromMe || message.user.id === this.bot.id,
        participant: isJidGroup(message.chat.id)
          ? message.user.id || this.bot.id || undefined
          : undefined,
      },
      text: message.text,
    });
  }

  /**
   * Adiciona uma reação a uma mensagem
   */
  async addReaction(message: ReactionMessage): Promise<void> {
    if (!message.id || !message.chat?.id || !message.reaction) return;
    await this.bot.sock.sendMessage(message.chat.id, {
      react: {
        text: message.reaction,
        key: {
          id: message.id,
          remoteJid: message.chat.id,
          fromMe: message.fromMe || message.user.id === this.bot.id,
          participant: isJidGroup(message.chat.id)
            ? message.user.id || this.bot.id || undefined
            : undefined,
        },
      },
    });
  }

  /**
   * Remove uma reação de uma mensagem
   */
  async removeReaction(message: ReactionMessage): Promise<void> {
    // Validações
    Validation.ensureConnected(this.bot.status, this.bot.sock);
    if (!message.chat?.id || !message.id) {
      throw new Error('ReactionMessage deve ter chat.id e id válidos');
    }
    Validation.ensureValidJID(message.chat.id, 'message.chat.id');
    if (!message.id || !message.chat?.id) return;
    await this.bot.sock.sendMessage(message.chat.id, {
      react: {
        text: '',
        key: {
          id: message.id,
          remoteJid: message.chat.id,
          fromMe: message.fromMe || message.user.id === this.bot.id,
          participant: isJidGroup(message.chat.id)
            ? message.user.id || this.bot.id || undefined
            : undefined,
        },
      },
    });
  }

  /**
   * Baixa a stream de mídia de uma mensagem
   */
  async downloadStreamMessage(media: MediaMessage): Promise<Buffer> {
    // Validações
    Validation.ensureConnected(this.bot.status, this.bot.sock);
    Validation.ensureValidJID(media.chat?.id, 'media.chat.id');
    Validation.ensureNotNull(media.id, 'media.id');
    
    const msg = await this.bot.store.loadMessage(media.chat.id, media.id);
    if (!msg) return Buffer.from("");
    
    // downloadMediaMessage espera (msg, type, options?)
    return Buffer.from(
      await downloadMediaMessage(msg, "buffer", {
        // opções extras se necessário
      })
    );
  }

  /**
   * Obtém uma mensagem de enquete
   */
  async getPollMessage(pollMessageId: string): Promise<PollMessage | PollUpdateMessage> {
    const pollMessage = await this.bot.auth.get(`polls-${pollMessageId}`);

    if (!pollMessage || !PollMessage.isValid(pollMessage))
      return PollMessage.fromJSON({ id: pollMessageId });

    if (pollMessage.type == MessageType.PollUpdate) {
      return PollUpdateMessage.fromJSON(pollMessage);
    }

    return PollMessage.fromJSON(pollMessage);
  }

  /**
   * Salva uma mensagem de enquete
   */
  async savePollMessage(pollMessage: PollMessage | PollUpdateMessage): Promise<void> {
    await this.bot.auth.set(`polls-${pollMessage.id}`, pollMessage.toJSON());
  }
}

