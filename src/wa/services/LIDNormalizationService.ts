import { WASocket } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import { LIDMappingService } from './LIDMappingService';
import { getID, isLidJid, jidUser, toLidJid } from '../ID';
import { isValidJID } from '../constants/JIDPatterns';

/**
 * Serviço especializado para normalização rápida de JIDs LID
 * Tenta múltiplas estratégias para obter o PN o mais rápido possível
 */
export class LIDNormalizationService {
  private socket: WASocket | null = null;
  private logger: ILoggerService;
  private lidMappingService: LIDMappingService;

  constructor(logger: ILoggerService, lidMappingService: LIDMappingService) {
    this.logger = logger;
    this.lidMappingService = lidMappingService;
  }

  /**
   * Configura o socket
   */
  setSocket(socket: WASocket): void {
    this.socket = socket;
  }

  /**
   * Normaliza JID LID usando múltiplas estratégias para máxima velocidade
   * 1. Cache do LIDMappingService (mais rápido)
   * 2. Store do Baileys (rápido se disponível)
   * 3. Retorna null se não conseguir
   *
   * rc14: getPNForLID exige `user@lid`, não o número nu.
   */
  async normalizeJID(jid: string, quickOnly: boolean = false): Promise<string | null> {
    if (!jid || (isValidJID(jid) && !isLidJid(jid))) {
      return jid;
    }

    if (!isLidJid(jid) && jid.includes('@')) {
      return null;
    }

    const lidJid = toLidJid(jid);

    try {
      if (this.lidMappingService) {
        const pn = await this.lidMappingService.getPNForLID(lidJid);
        if (pn) {
          return getID(pn);
        }
      }
    } catch (error) {
      // Ignora erro
    }

    try {
      if (this.socket?.signalRepository?.lidMapping) {
        const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lidJid);
        if (pn) {
          if (this.lidMappingService) {
            await this.lidMappingService.storeLIDPNMapping(lidJid, pn);
          }
          return getID(pn);
        }
      }
    } catch (error) {
      // Ignora erro
    }

    if (quickOnly) {
      return null;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (this.socket?.signalRepository?.lidMapping) {
          const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lidJid);
          if (pn) {
            if (this.lidMappingService) {
              await this.lidMappingService.storeLIDPNMapping(lidJid, pn);
            }
            return getID(pn);
          }
        }

        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      } catch (error) {
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }

    return null;
  }

  /**
   * Normaliza JID LID de forma síncrona quando possível (usando apenas cache)
   * Retorna o JID original se não conseguir normalizar
   */
  normalizeJIDSync(jid: string): string {
    if (!jid || (isValidJID(jid) && !isLidJid(jid))) {
      return jid;
    }

    if (!isLidJid(jid) && jid.includes('@')) {
      return jid;
    }

    const lidJid = toLidJid(jid);

    try {
      const cacheService = (this.lidMappingService as any).cache;
      if (cacheService && typeof cacheService.getLIDMappingCache === 'function') {
        const cache = cacheService.getLIDMappingCache();
        if (cache) {
          const cachedPN = cache.get(`lid:${jidUser(lidJid)}`);
          if (cachedPN && typeof cachedPN === 'string') {
            return getID(cachedPN);
          }
        }
      }
    } catch (error) {
      // Ignora erro
    }

    return jid;
  }
}
