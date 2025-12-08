import { downloadMediaMessage, isJidGroup } from '@whiskeysockets/baileys';
import Message from '../../messages/Message';
import MediaMessage from '../../messages/MediaMessage';
import ReactionMessage from '../../messages/ReactionMessage';
import { BotStatus } from '../../bot/BotStatus';
import { Validation } from '../utils/Validation';
import { isValidJID } from '../constants/JIDPatterns';
import ConvertToWAMessage from '../ConvertToWAMessage';
import { ErrorHandler } from '../services/ErrorHandler';
import WhatsAppBot from '../WhatsAppBot';
import ChatType from '../../modules/chat/ChatType';

/**
 * Operações relacionadas a mensagens
 */
export class MessageOperations {
  private bot: WhatsAppBot;
  private errorHandler: ErrorHandler;

  constructor(bot: WhatsAppBot, errorHandler: ErrorHandler) {
    this.bot = bot;
    this.errorHandler = errorHandler;
  }

  /**
   * Envia uma mensagem
   */
  async send(message: Message): Promise<Message> {
    // Valida estado antes de enviar
    if (this.bot.status !== BotStatus.Online || !this.bot.sock?.ws.isOpen) {
      throw new Error('Bot não está conectado. Aguarde o evento "open" antes de enviar mensagens.');
    }

    // Valida JID do chat usando utilitário
    if (!message.chat?.id || !isValidJID(message.chat.id)) {
      throw new Error(`JID de chat inválido: ${message.chat?.id}`);
    }

    try {
      const waMsg = (await new ConvertToWAMessage(this.bot, message).refactory()).waMessage;
      const sent = await this.bot.sock.sendMessage(message.chat.id, waMsg);
      if (sent && sent.key && sent.key.id) message.id = sent.key.id;
      return message;
    } catch (error) {
      this.errorHandler.handle(error, 'MessageOperations.send');
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
    
    const key = {
      remoteJid: message.chat.id,
      id: message.id || '',
      fromMe: message.fromMe || message.user.id === this.bot.id,
      participant: isJidGroup(message.chat.id)
        ? message.user.id || this.bot.id || undefined
        : undefined,
      toJSON: () => key,
    };

    // v7.0.0: Removido ACKs automáticos para evitar banimentos
    // O WhatsApp agora gerencia automaticamente o status de leitura
    const chat = await this.bot.getChat(message.chat);
    
    // Apenas marcar como lido localmente, sem enviar ACK
    if (chat?.type === ChatType.Group || chat?.type === ChatType.PV) {
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
}

