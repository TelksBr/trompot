import { WASocket } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import { LIDMappingService } from './LIDMappingService';
import { getID, getPhoneNumber } from '../ID';
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
   * 3. Tenta extrair do próprio LID (se for um número válido)
   * 4. Retorna null se não conseguir
   */
  async normalizeJID(jid: string, quickOnly: boolean = false): Promise<string | null> {
    if (!jid || isValidJID(jid)) {
      return jid;
    }

    if (!jid.endsWith('@lid')) {
      return null;
    }

    const lid = jid.replace('@lid', '');

    // Estratégia 1: Cache do LIDMappingService (mais rápido - instantâneo)
    try {
      if (this.lidMappingService) {
        const pn = await this.lidMappingService.getPNForLID(lid);
        if (pn) {
          return getID(pn);
        }
      }
    } catch (error) {
      // Ignora erro
    }

    // Estratégia 2: Store do Baileys (rápido se disponível)
    try {
      if (this.socket?.signalRepository?.lidMapping) {
        const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lid);
        if (pn) {
          // Armazena no cache para próxima vez
          if (this.lidMappingService) {
            await this.lidMappingService.storeLIDPNMapping(lid, pn);
          }
          return getID(pn);
        }
      }
    } catch (error) {
      // Ignora erro
    }

    // Estratégia 3: Verifica se o LID é um número válido (alguns LIDs são números de telefone)
    // IMPORTANTE: Isso NÃO funciona na maioria dos casos - LIDs não são números de telefone
    // Removido para evitar falsos positivos que podem causar envio para número errado
    // O LID é um identificador interno do WhatsApp, não o número de telefone

    // Se quickOnly, retorna null imediatamente (não tenta mais)
    if (quickOnly) {
      return null;
    }

    // Estratégia 4: Tenta algumas vezes com delays pequenos (para casos onde o mapeamento está sendo atualizado)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (this.socket?.signalRepository?.lidMapping) {
          const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lid);
          if (pn) {
            // Armazena no cache
            if (this.lidMappingService) {
              await this.lidMappingService.storeLIDPNMapping(lid, pn);
            }
            return getID(pn);
          }
        }
        
        // Aguarda um pouco antes de tentar novamente
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      } catch (error) {
        // Ignora erro
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
    if (!jid || isValidJID(jid)) {
      return jid;
    }

    if (!jid.endsWith('@lid')) {
      return jid;
    }

    const lid = jid.replace('@lid', '');

    // Tenta obter do cache síncronamente
    try {
      // Acessa o cache através do ICacheService
      const cacheService = (this.lidMappingService as any).cache;
      if (cacheService && typeof cacheService.getLIDMappingCache === 'function') {
        const cache = cacheService.getLIDMappingCache();
        if (cache) {
          const cachedPN = cache.get(`lid:${lid}`);
          if (cachedPN && typeof cachedPN === 'string') {
            return getID(cachedPN);
          }
        }
      }
    } catch (error) {
      // Ignora erro
    }

    // IMPORTANTE: Não tenta extrair número do LID - LIDs não são números de telefone
    // Isso pode causar envio para número errado

    return jid;
  }
}

