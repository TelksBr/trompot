import { WASocket } from '@whiskeysockets/baileys';
import { LoggerService } from '../services/LoggerService';
import { LIDMappingService, LIDMapping } from '../services/LIDMappingService';
import WhatsAppBot from '../WhatsAppBot';

/**
 * Handler para eventos de LID mapping (novo no v7.0.0)
 */
export class LIDMappingEventHandler {
  private bot: WhatsAppBot;
  private logger: LoggerService;
  private lidMappingService: LIDMappingService;

  constructor(
    bot: WhatsAppBot,
    logger: LoggerService,
    lidMappingService: LIDMappingService
  ) {
    this.bot = bot;
    this.logger = logger;
    this.lidMappingService = lidMappingService;
  }

  /**
   * Configura handler para lid-mapping.update (novo no v7.0.0)
   */
  setup(socket: WASocket): void {
    socket.ev.on('lid-mapping.update', async (mapping: LIDMapping) => {
      try {
        // Log removido para reduzir verbosidade
        await this.lidMappingService.handleLIDMappingUpdate(mapping);
      } catch (error) {
        this.logger.error('Erro ao processar lid-mapping.update', error);
        this.bot.emit('error', error);
      }
    });
  }
}

