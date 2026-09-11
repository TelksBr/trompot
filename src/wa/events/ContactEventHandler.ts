import { WASocket, isJidGroup } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import WhatsAppBot from '../WhatsAppBot';

export class ContactEventHandler {
  private bot: WhatsAppBot;
  private logger: ILoggerService;

  constructor(bot: WhatsAppBot, logger: ILoggerService) {
    this.bot = bot;
    this.logger = logger;
  }

  /**
   * Configura handlers para eventos de contatos
   */
  setup(socket: WASocket): void {
    // contacts.upsert - Novos contatos
    socket.ev.on('contacts.upsert', async (updates) => {
      if (!this.bot.config.autoLoadContactInfo) return;

      for (const update of updates) {
        try {
          if (!update.id) continue;

          const contactId = update.phoneNumber || update.id;

          if (isJidGroup(contactId)) {
            await this.bot.readChat({ id: contactId }, update);
          } else {
            await this.bot.readUser({ id: contactId }, update);
          }
        } catch (error) {
          this.logger.error('Erro ao processar contacts.upsert', error);
          this.bot.emit('error', error);
        }
      }
    });

    // contacts.update - Atualizações de contatos
    socket.ev.on('contacts.update', async (updates) => {
      if (!this.bot.config.autoLoadContactInfo) return;

      for (const update of updates) {
        try {
          if (!update.id) continue;

          const contactId = update.phoneNumber || update.id;

          if (isJidGroup(contactId)) {
            await this.bot.readChat({ id: contactId }, update);
          } else {
            await this.bot.readUser({ id: contactId }, update);
          }
        } catch (error) {
          this.logger.error('Erro ao processar contacts.update', error);
          this.bot.emit('error', error);
        }
      }
    });
  }
}
