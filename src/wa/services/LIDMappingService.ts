import { WASocket } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import { ICacheService } from '../interfaces/ICacheService';
import { jidUser, toLidJid, toPnJid } from '../ID';

export interface LIDMapping {
  lid: string;
  pn: string;
}

export class LIDMappingService {
  private socket: WASocket | null = null;
  private logger: ILoggerService;
  private cache: ICacheService;
  private cacheKey = 'lid-mapping';

  constructor(logger: ILoggerService, cache: ICacheService) {
    this.logger = logger;
    this.cache = cache;
  }

  /**
   * Configura o socket para acessar o lidMapping store
   */
  setSocket(socket: WASocket): void {
    this.socket = socket;
  }

  private cachePn(lid: string, pn: string): void {
    const cache = this.cache.getLIDMappingCache();
    cache.set(`pn:${jidUser(pn)}`, lid);
    cache.set(`lid:${jidUser(lid)}`, pn);
  }

  /**
   * Obtém LID para um PN usando o store interno do Baileys
   * rc14: getLIDForPN exige JID PN completo (`user@s.whatsapp.net`)
   */
  async getLIDForPN(pn: string): Promise<string | undefined> {
    if (!this.socket || !pn) {
      return undefined;
    }

    const pnJid = toPnJid(pn);

    try {
      const cache = this.cache.getLIDMappingCache();
      const cachedLID = cache.get<string>(`pn:${jidUser(pnJid)}`);
      if (cachedLID) {
        return cachedLID;
      }

      const lid = await this.socket.signalRepository.lidMapping.getLIDForPN(pnJid);

      if (lid) {
        this.cachePn(lid, pnJid);
      }

      return lid || undefined;
    } catch (error) {
      this.logger.error('Erro ao obter LID para PN', error);
      return undefined;
    }
  }

  /**
   * Obtém PN para um LID usando o store interno do Baileys
   * rc14: getPNForLID ignora valores sem sufixo `@lid`
   */
  async getPNForLID(lid: string): Promise<string | undefined> {
    if (!this.socket || !lid) {
      return undefined;
    }

    const lidJid = toLidJid(lid);

    try {
      const cache = this.cache.getLIDMappingCache();
      const cachedPN = cache.get<string>(`lid:${jidUser(lidJid)}`);
      if (cachedPN) {
        return cachedPN;
      }

      const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lidJid);

      if (pn) {
        this.cachePn(lidJid, pn);
      }

      return pn || undefined;
    } catch (error) {
      this.logger.error('Erro ao obter PN para LID', error);
      return undefined;
    }
  }

  /**
   * Armazena mapeamento LID/PN
   * rc14: storeLIDPNMappings valida isLidUser(lid) && isPnUser(pn)
   */
  async storeLIDPNMapping(lid: string, pn: string): Promise<void> {
    await this.storeLIDPNMappings([{ lid, pn }]);
  }

  /**
   * Armazena múltiplos mapeamentos
   */
  async storeLIDPNMappings(mappings: LIDMapping[]): Promise<void> {
    if (!this.socket || !mappings.length) {
      return;
    }

    const pairs = mappings
      .filter((m) => m.lid && m.pn)
      .map((m) => ({ lid: toLidJid(m.lid), pn: toPnJid(m.pn) }));

    if (!pairs.length) {
      return;
    }

    try {
      await this.socket.signalRepository.lidMapping.storeLIDPNMappings(pairs);

      for (const mapping of pairs) {
        this.cachePn(mapping.lid, mapping.pn);
      }
    } catch (error) {
      this.logger.error('Erro ao armazenar mapeamentos LID/PN', error);
    }
  }

  /**
   * Handler para evento lid-mapping.update
   */
  handleLIDMappingUpdate(mapping: LIDMapping): void {
    this.storeLIDPNMapping(mapping.lid, mapping.pn);
  }

  /**
   * Limpa cache
   */
  clearCache(): void {
    this.cache.clearCache(this.cacheKey);
  }
}
