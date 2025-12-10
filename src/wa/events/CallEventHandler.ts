import { WASocket, WACallEvent } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import Call, { CallStatus } from '../../models/Call';
import WhatsAppBot from '../WhatsAppBot';
import { getID } from '../ID';
import { isValidJID } from '../constants/JIDPatterns';

export class CallEventHandler {
  private bot: WhatsAppBot;
  private logger: ILoggerService;

  constructor(bot: WhatsAppBot, logger: ILoggerService) {
    this.bot = bot;
    this.logger = logger;
  }

  /**
   * Converte um JID LID para um JID válido
   * Tenta múltiplas vezes com delay, pois o mapeamento pode não estar disponível imediatamente
   */
  private async normalizeJID(jid: string, retries: number = 2): Promise<string> {
    if (!jid || isValidJID(jid)) {
      return jid;
    }

    // Verifica se é um JID LID (termina com @lid)
    if (jid.endsWith('@lid')) {
      const lid = jid.replace('@lid', '');
      
      // Tenta obter o PN com retries
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // Usa o LIDMappingService do bot (que tem cache e retry interno)
          if (this.bot.sock?.signalRepository?.lidMapping) {
            const pn = await this.bot.sock.signalRepository.lidMapping.getPNForLID(lid);
            
            if (pn) {
              // Converte PN para JID válido
              return getID(pn);
            }
          }
          
          // Se não encontrou e ainda tem tentativas, aguarda um pouco
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          }
        } catch (error) {
          this.logger.debug(`Tentativa ${attempt + 1} de normalização LID falhou: ${error}`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          }
        }
      }
    }

    // Se não conseguir converter após todas as tentativas, retorna o JID original
    // Isso pode acontecer se o mapeamento ainda não estiver disponível
    return jid;
  }

  /**
   * Configura handler para eventos de chamadas
   */
  setup(socket: WASocket): void {
    socket.ev.on('call', async (events: WACallEvent[]) => {
      for (const event of events || []) {
        try {
          // Guarda o JID original do evento (pode ser LID)
          const originalChatJID = event.chatId || event.groupJid || event.from || '';
          
          // Normaliza JID LID para JID válido (para o Call que será emitido)
          let normalizedChat = await this.normalizeJID(originalChatJID);
          
          // Normaliza também o JID do usuário (event.from)
          let userJID = event.from || '';
          if (userJID) {
            userJID = await this.normalizeJID(userJID);
          }

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

          // Rejeita automaticamente se autoRejectCalls estiver ativado e for uma oferta de chamada
          // IMPORTANTE: Usa o JID original do evento (pode ser LID) - o Baileys aceita LID
          const autoRejectEnabled = this.bot.config.autoRejectCalls === true;
          const isOfferStatus = status === CallStatus.Offer;
          const shouldAutoReject = autoRejectEnabled && isOfferStatus;
          
          if (shouldAutoReject) {
            try {
              // Usa o JID original do evento diretamente no rejectCall do Baileys
              await this.bot.sock.rejectCall(event.id, originalChatJID);
              this.logger.info(`📞 Chamada ${event.id} rejeitada automaticamente (JID: ${originalChatJID})`);
            } catch (error) {
              this.logger.error(`Erro ao rejeitar chamada automaticamente (ID: ${event.id}, JID: ${originalChatJID})`, error);
            }
          }

          // Cria o Call com JID normalizado para uso posterior (envio de mensagens, etc)
          const call = new Call(event.id, normalizedChat, userJID, status, {
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

