import { ErrorCodes } from './ErrorCodes';

/**
 * Códigos de desconexão do WhatsApp
 * @deprecated Use ErrorCodes ao invés de DisconnectReasons para novos códigos
 */
export const DisconnectReasons = {
  /** Logged out - Sessão foi morta do WhatsApp */
  LOGGED_OUT: ErrorCodes.LOGGED_OUT,
  /** Logged out (alternativo) */
  LOGGED_OUT_ALT: ErrorCodes.LOGGED_OUT_ALT,
  /** Connection Terminated - Sessão inválida */
  CONNECTION_TERMINATED: ErrorCodes.CONNECTION_TERMINATED,
  /** Connection Closed - Geralmente temporário */
  CONNECTION_CLOSED: ErrorCodes.CONNECTION_CLOSED,
} as const;

/**
 * Códigos que indicam que não deve tentar reconectar
 */
export const NON_RECONNECTABLE_ERRORS = [
  DisconnectReasons.LOGGED_OUT,
  DisconnectReasons.LOGGED_OUT_ALT,
  DisconnectReasons.CONNECTION_TERMINATED,
] as const;

/**
 * Verifica se um código de erro não permite reconexão
 */
export function isNonReconnectableError(code: number): boolean {
  return NON_RECONNECTABLE_ERRORS.some(err => err === code);
}

