import IAuth from '../../client/IAuth';
import { AuthenticationCreds } from '@whiskeysockets/baileys';

export interface SessionValidationResult {
  isValid: boolean;
  shouldGenerateQR: boolean;
  reason?: string;
}

/**
 * Interface para gerenciamento de sessão
 */
export interface ISessionManager {
  validateSession(auth: IAuth): Promise<SessionValidationResult>;
  clearInvalidSession(auth: IAuth): Promise<void>;
  saveCredentials(auth: IAuth, creds: Partial<AuthenticationCreds>): Promise<void>;
  loadCredentials(auth: IAuth): Promise<AuthenticationCreds | null>;
}

