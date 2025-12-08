import { AuthenticationCreds, initAuthCreds } from '@whiskeysockets/baileys';
import IAuth from '../../client/IAuth';
import { getBaileysAuth } from '../Auth';
import { LoggerService } from '../services/LoggerService';

export interface SessionValidationResult {
  isValid: boolean;
  shouldGenerateQR: boolean;
  reason?: string;
}

export class SessionManager {
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Valida se a sessão é válida
   */
  async validateSession(auth: IAuth): Promise<SessionValidationResult> {
    try {
      const creds = await auth.get('creds') as AuthenticationCreds | null;

      if (!creds) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Nenhuma credencial encontrada'
        };
      }

      // Verifica se está registrado
      if (creds.registered === false) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Sessão não registrada (registered: false)'
        };
      }

      // Verifica se tem me.id (identificação do usuário)
      if (!creds.me?.id) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Sessão sem identificação do usuário'
        };
      }

      // Verifica se tem credenciais básicas necessárias
      if (!creds.noiseKey || !creds.signedIdentityKey) {
        return {
          isValid: false,
          shouldGenerateQR: true,
          reason: 'Credenciais incompletas'
        };
      }

      return {
        isValid: true,
        shouldGenerateQR: false
      };
    } catch (error) {
      this.logger.error('Erro ao validar sessão', error);
      return {
        isValid: false,
        shouldGenerateQR: true,
        reason: `Erro: ${error instanceof Error ? error.message : 'Desconhecido'}`
      };
    }
  }

  /**
   * Limpa sessão inválida completamente
   * Remove creds.json e todas as keys relacionadas
   */
  async clearInvalidSession(auth: IAuth): Promise<void> {
    try {
      // Lista todos os arquivos da sessão
      const allFiles = await auth.listAll();

      // Remove creds.json primeiro
      try {
        await auth.remove('creds');
      } catch (error) {
        // Ignora erros silenciosamente
      }

      // Remove todas as keys relacionadas (pre-key, session, sender-key, app-state-sync-key, etc)
      const keyPatterns = [
        'pre-key',
        'session',
        'sender-key',
        'app-state-sync-key',
        'sender-key-memory',
        'lid-mapping',
        'device-list',
        'tctoken',
      ];

      let removedCount = 0;
      for (const pattern of keyPatterns) {
        const matchingFiles = allFiles.filter(file => file.startsWith(pattern));
        for (const file of matchingFiles) {
          try {
            await auth.remove(file);
            removedCount++;
          } catch (error) {
            // Ignora erros ao remover keys individuais
          }
        }
      }

      // Log removido para reduzir verbosidade - sessão limpa silenciosamente
    } catch (error) {
      this.logger.error('Erro ao limpar sessão', error);
      throw error;
    }
  }

  /**
   * Salva credenciais
   */
  async saveCredentials(auth: IAuth, creds: Partial<AuthenticationCreds>): Promise<void> {
    try {
      await auth.set('creds', creds);
      // Log removido para reduzir verbosidade
    } catch (error) {
      this.logger.error('Erro ao salvar credenciais', error);
      throw error;
    }
  }

  /**
   * Carrega credenciais
   */
  async loadCredentials(auth: IAuth): Promise<AuthenticationCreds> {
    try {
      const { state } = await getBaileysAuth(auth);
      return state.creds;
    } catch (error) {
      this.logger.error('Erro ao carregar credenciais', error);
      // Retorna credenciais vazias se houver erro
      return initAuthCreds();
    }
  }

  /**
   * Verifica se deve gerar QR code
   */
  shouldGenerateQR(creds: AuthenticationCreds | null): boolean {
    if (!creds) return true;
    if (creds.registered === false) return true;
    if (!creds.me?.id) return true;
    return false;
  }
}

