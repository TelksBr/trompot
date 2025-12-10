import { WASocket } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import { LIDMappingService, LIDMapping } from '../services/LIDMappingService';
import { PendingMessageQueue } from '../services/PendingMessageQueue';
import WhatsAppBot from '../WhatsAppBot';

/**
 * Handler para eventos de LID mapping (novo no v7.0.0)
 * Processa mensagens pendentes quando o mapeamento ficar disponível
 */
export class LIDMappingEventHandler {
  private bot: WhatsAppBot;
  private logger: ILoggerService;
  private lidMappingService: LIDMappingService;
  private pendingMessageQueue: PendingMessageQueue;

  constructor(
    bot: WhatsAppBot,
    logger: ILoggerService,
    lidMappingService: LIDMappingService,
    pendingMessageQueue: PendingMessageQueue
  ) {
    this.bot = bot;
    this.logger = logger;
    this.lidMappingService = lidMappingService;
    this.pendingMessageQueue = pendingMessageQueue;
  }

  /**
   * Configura handler para lid-mapping.update (novo no v7.0.0)
   */
  setup(socket: WASocket): void {
    socket.ev.on('lid-mapping.update', async (mapping: LIDMapping) => {
      try {
        this.logger.info(`🔄 Evento lid-mapping.update recebido: LID ${mapping.lid} -> PN ${mapping.pn}`);
        
        // Atualiza o mapeamento no serviço
        await this.lidMappingService.handleLIDMappingUpdate(mapping);
        
        // Processa mensagens pendentes para este LID
        const pendingCount = this.pendingMessageQueue.getPendingCount(mapping.lid);
        if (pendingCount > 0) {
          this.logger.info(`📤 Processando ${pendingCount} mensagem(ns) pendente(s) para LID ${mapping.lid}`);
        }
        await this.pendingMessageQueue.processPendingMessages(mapping.lid, mapping.pn);
      } catch (error) {
        this.logger.error('Erro ao processar lid-mapping.update', error);
        this.bot.emit('error', error);
      }
    });
  }
}

