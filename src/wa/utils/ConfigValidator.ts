import { WhatsAppBotConfig } from '../WhatsAppBot';
import { ConfigDefaults } from '../constants/ConfigDefaults';
import { LoggerService } from '../services/LoggerService';

/**
 * Validador de configuração do WhatsAppBot
 */
export class ConfigValidator {
  /**
   * Valida e normaliza a configuração do WhatsAppBot
   */
  static validate(config?: Partial<WhatsAppBotConfig>): WhatsAppBotConfig {
    const validated: WhatsAppBotConfig = {
      // Valores padrão obrigatórios
      qrTimeout: config?.qrTimeout ?? ConfigDefaults.QR_TIMEOUT,
      defaultQueryTimeoutMs: config?.defaultQueryTimeoutMs ?? ConfigDefaults.DEFAULT_QUERY_TIMEOUT,
      retryRequestDelayMs: config?.retryRequestDelayMs ?? ConfigDefaults.RETRY_REQUEST_DELAY,
      autoRestartInterval: config?.autoRestartInterval ?? ConfigDefaults.AUTO_RESTART_INTERVAL,
      autoSyncHistory: config?.autoSyncHistory ?? false,
      readAllFailedMessages: config?.readAllFailedMessages ?? false,
      useExperimentalServers: config?.useExperimentalServers ?? false,
      autoLoadContactInfo: config?.autoLoadContactInfo ?? false,
      autoLoadGroupInfo: config?.autoLoadGroupInfo ?? false,
      logLevel: config?.logLevel ?? 'info',
      ...config,
    };

    // Validações de valores
    if (validated.qrTimeout && validated.qrTimeout < 1000) {
      throw new Error('qrTimeout deve ser pelo menos 1000ms');
    }

    if (validated.defaultQueryTimeoutMs && validated.defaultQueryTimeoutMs < 1000) {
      throw new Error('defaultQueryTimeoutMs deve ser pelo menos 1000ms');
    }

    if (validated.retryRequestDelayMs && validated.retryRequestDelayMs < 100) {
      throw new Error('retryRequestDelayMs deve ser pelo menos 100ms');
    }

    if (validated.autoRestartInterval && validated.autoRestartInterval < 60000) {
      throw new Error('autoRestartInterval deve ser pelo menos 60000ms (1 minuto)');
    }

    if (validated.logLevel && !['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(validated.logLevel)) {
      throw new Error(`logLevel inválido: ${validated.logLevel}. Use: fatal, error, warn, info, debug, trace ou silent`);
    }

    return validated;
  }

  /**
   * Valida configuração e loga avisos
   */
  static validateWithWarnings(
    config?: Partial<WhatsAppBotConfig>,
    logger?: LoggerService
  ): WhatsAppBotConfig {
    const validated = this.validate(config);

    // Avisos para configurações não recomendadas
    if (validated.autoSyncHistory && logger) {
      logger.warn('autoSyncHistory está ativado. Isso pode causar alto uso de memória e processamento.');
    }

    if (validated.readAllFailedMessages && logger) {
      logger.warn('readAllFailedMessages está ativado. Isso pode processar mensagens duplicadas.');
    }

    if (validated.useExperimentalServers && logger) {
      logger.warn('useExperimentalServers está ativado. Use apenas para testes.');
    }

    return validated;
  }
}

