import { WASocket } from '@whiskeysockets/baileys';
import { LoggerService } from '../services/LoggerService';
import Chat from '../../modules/chat/Chat';
import WhatsAppBot from '../WhatsAppBot';

export class ChatEventHandler {
  private bot: WhatsAppBot;
  private logger: LoggerService;

  constructor(bot: WhatsAppBot, logger: LoggerService) {
    this.bot = bot;
    this.logger = logger;
  }

  /**
   * Configura handlers para eventos de chats
   */
  setup(socket: WASocket): void {
    // chats.delete - Deleção de chats
    socket.ev.on('chats.delete', async (deletions) => {
      for (const id of deletions) {
        try {
          await this.bot.removeChat(new Chat(id));
        } catch (error) {
          this.logger.error('Erro ao processar chats.delete', error);
          this.bot.emit('error', error);
        }
      }
    });

    // chats.upsert - Novos chats
    socket.ev.on('chats.upsert', async (chats) => {
      for (const chat of chats) {
        try {
          if (!chat.id) continue;
          await this.bot.updateChat({
            id: chat.id,
            name: chat.name || undefined,
            timestamp: chat.conversationTimestamp
              ? Number(chat.conversationTimestamp) * 1000
              : undefined,
            unreadCount: chat.unreadCount || 0,
          });
        } catch (error) {
          this.logger.error('Erro ao processar chats.upsert', error);
          this.bot.emit('error', error);
        }
      }
    });

    // chats.update - Atualizações de chats
    socket.ev.on('chats.update', async (updates) => {
      for (const update of updates) {
        try {
          if (!update.id) continue;
          await this.bot.updateChat({
            id: update.id,
            name: update.name || undefined,
            timestamp: update.conversationTimestamp
              ? Number(update.conversationTimestamp) * 1000
              : undefined,
            unreadCount: update.unreadCount || undefined,
          });
        } catch (error) {
          this.logger.error('Erro ao processar chats.update', error);
          this.bot.emit('error', error);
        }
      }
    });
  }
}

