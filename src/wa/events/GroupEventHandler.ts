import { WASocket } from '@whiskeysockets/baileys';
import { LoggerService } from '../services/LoggerService';
import Chat from '../../modules/chat/Chat';
import WhatsAppBot from '../WhatsAppBot';
import { UserAction } from '../../modules/user';

export class GroupEventHandler {
  private bot: WhatsAppBot;
  private logger: LoggerService;

  constructor(bot: WhatsAppBot, logger: LoggerService) {
    this.bot = bot;
    this.logger = logger;
  }

  /**
   * Configura handlers para eventos de grupos
   */
  setup(socket: WASocket): void {
    // groups.update - Atualizações de grupos
    socket.ev.on('groups.update', async (updates) => {
      if (!this.bot.config.autoLoadGroupInfo) return;

      for (const update of updates) {
        try {
          if (!update?.id) continue;

          const chat = await this.bot.getChat(new Chat(update.id));

          if (chat == null) {
            await this.bot.readChat({ id: update.id }, update, true);
          } else {
            await this.bot.readChat({ id: update.id }, update, false);
          }
        } catch (error) {
          this.logger.error('Erro ao processar groups.update', error);
          this.bot.emit('error', error);
        }
      }
    });

    // group-participants.update - Atualizações de participantes
    socket.ev.on('group-participants.update', async (update) => {
      try {
        const { id, participants, action } = update;
        if (!id || !participants || !action) return;

        // Mapeia ParticipantAction para UserAction
        // Ignora 'modify' pois não é um UserAction válido
        if (action === 'modify') return;

        // UserAction pode ser: "join" | "leave" | UserEvent ("add" | "remove" | "promote" | "demote")
        let userAction: UserAction = 'add';
        if (action === 'add') userAction = 'add';
        else if (action === 'remove') userAction = 'remove';
        else if (action === 'promote') userAction = 'promote';
        else if (action === 'demote') userAction = 'demote';

        for (const participant of participants) {
          const participantId = typeof participant === 'string' 
            ? participant 
            : (participant as any).id || participant;
          await this.bot.groupParticipantsUpdate(
            userAction,
            id,
            participantId,
            update.author || participantId
          );
        }
      } catch (error) {
        this.logger.error('Erro ao processar group-participants.update', error);
        this.bot.emit('error', error);
      }
    });
  }
}

