import { WASocket, WACallEvent } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import Call, { CallStatus } from '../../models/Call';
import WhatsAppBot from '../WhatsAppBot';

export class CallEventHandler {
  private bot: WhatsAppBot;
  private logger: ILoggerService;

  constructor(bot: WhatsAppBot, logger: ILoggerService) {
    this.bot = bot;
    this.logger = logger;
  }

  /**
   * Configura handler para eventos de chamadas
   */
  setup(socket: WASocket): void {
    socket.ev.on('call', async (events: WACallEvent[]) => {
      for (const event of events || []) {
        try {
          const chat = event.chatId || event.groupJid || event.from || '';

          let status: CallStatus;

          switch (event.status) {
            case 'offer':
              status = CallStatus.Offer;
              break;
            case 'ringing':
              status = CallStatus.Ringing;
              break;
            case 'reject':
              status = CallStatus.Reject;
              break;
            case 'accept':
              status = CallStatus.Accept;
              break;
            case 'timeout':
              status = CallStatus.Timeout;
              break;
            default:
              status = CallStatus.Ringing;
              break;
          }

          const call = new Call(event.id, chat, event.from, status, {
            date: event.date || new Date(),
            isVideo: !!event.isVideo,
            offline: !!event.offline,
            latencyMs: event.latencyMs || 1,
          });

          this.bot.emit('call', call);
        } catch (error) {
          this.logger.error('Erro ao processar call event', error);
          this.bot.emit('error', error);
        }
      }
    });
  }
}

