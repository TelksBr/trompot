/**
 * Timeouts padrão para operações
 */
export const Timeouts = {
  /** Timeout para aguardar conexão (60 segundos) */
  CONNECTION_WAIT: 60000,
  /** Delay antes de reconectar (2 segundos) */
  RECONNECT_DELAY: 2000,
  /** Timeout para operações de rede (10 segundos) */
  NETWORK_OPERATION: 10000,
} as const;

