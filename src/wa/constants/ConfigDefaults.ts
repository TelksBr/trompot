/**
 * Valores padrão para configuração do WhatsAppBot
 */
export const ConfigDefaults = {
  /** Timeout para QR code (60 segundos) */
  QR_TIMEOUT: 60000,
  /** Timeout padrão para queries (10 segundos) */
  DEFAULT_QUERY_TIMEOUT: 10000,
  /** Delay entre tentativas de retry (500ms) */
  RETRY_REQUEST_DELAY: 500,
  /** Intervalo de auto-restart (30 minutos) */
  AUTO_RESTART_INTERVAL: 1000 * 60 * 30,
  /** Delay padrão para retry (1 segundo) */
  DEFAULT_RETRY_DELAY: 1000,
  /** Multiplicador para delay de retry (3x) */
  RETRY_DELAY_MULTIPLIER: 3,
  /** Limite máximo de chaves no cache (10k) */
  MAX_CACHE_KEYS: 10000,
} as const;

/**
 * Conversão de timestamp (segundos para milissegundos)
 */
export const TIMESTAMP_MULTIPLIER = 1000;


