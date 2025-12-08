import { BotStatus } from '../../bot/BotStatus';
import { isValidJID } from '../constants/JIDPatterns';

/**
 * Utilitários de validação
 */
export class Validation {
  /**
   * Valida se o bot está conectado
   */
  static ensureConnected(status: BotStatus, socket?: any): void {
    if (status !== BotStatus.Online) {
      throw new Error('Bot não está conectado. Aguarde o evento "open" antes de realizar operações.');
    }
    
    if (socket && !socket.ws?.isOpen) {
      throw new Error('Socket não está aberto. Aguarde a conexão ser estabelecida.');
    }
  }

  /**
   * Valida se um JID é válido
   */
  static ensureValidJID(jid: string | undefined | null, paramName: string = 'jid'): void {
    if (!isValidJID(jid)) {
      throw new Error(`JID inválido para ${paramName}: ${jid}`);
    }
  }

  /**
   * Valida se um parâmetro não é null/undefined
   */
  static ensureNotNull<T>(value: T | null | undefined, paramName: string): asserts value is T {
    if (value === null || value === undefined) {
      throw new Error(`Parâmetro ${paramName} não pode ser null ou undefined`);
    }
  }
}

