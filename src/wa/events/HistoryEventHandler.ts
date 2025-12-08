import { WASocket, proto } from '@whiskeysockets/baileys';
import { LoggerService } from '../services/LoggerService';
import ConvertWAMessage from '../ConvertWAMessage';
import ErrorMessage from '../../messages/ErrorMessage';
import { fixID } from '../ID';
import WhatsAppBot from '../WhatsAppBot';
import Chat from '../../modules/chat/Chat';

/**
 * Handler para messaging-history.set (OBRIGATÓRIO no v7.0.0)
 * Este handler é crítico para armazenar mensagens para getMessage funcionar
 */
export class HistoryEventHandler {
  private bot: WhatsAppBot;
  private logger: LoggerService;

  constructor(bot: WhatsAppBot, logger: LoggerService) {
    this.bot = bot;
    this.logger = logger;
  }

  /**
   * Configura handler para messaging-history.set (OBRIGATÓRIO no v7.0.0)
   */
  setup(socket: WASocket): void {
    socket.ev.on('messaging-history.set', async (update) => {
      if (!this.bot.config.autoSyncHistory) return;

      try {
        const { chats, contacts, messages, syncType } = update;

        // Log removido para reduzir verbosidade

        // Processa chats
        if (chats && Array.isArray(chats)) {
          for (const chat of chats) {
            try {
              if (!chat.id) continue; // v7: id pode ser null/undefined

              // Armazena chat
              await this.bot.updateChat({
                id: chat.id,
                name: chat.name || undefined,
                timestamp: chat.conversationTimestamp
                  ? Number(chat.conversationTimestamp) * 1000
                  : undefined,
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
                const msg = await new ConvertWAMessage(this.bot, message).get();
                msg.isOld = true;
                this.bot.emit('message', msg);
              }
            } catch (error) {
              this.logger.error('Erro ao processar mensagem do history sync', error);
              this.bot.emit(
                'message',
                new ErrorMessage(
                  fixID(message?.key?.remoteJid || ''),
                  error instanceof Error ? error : new Error(JSON.stringify(error)),
                ),
              );
            }
          }
        }

        // Log removido para reduzir verbosidade
      } catch (error) {
        this.logger.error('Erro no history sync', error);
        this.bot.emit('error', error);
      }
    });
  }
}

