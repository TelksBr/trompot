import { WASocket } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import { ICacheService } from '../interfaces/ICacheService';

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

  /**
   * Obtém LID para um PN usando o store interno do Baileys
   */
  async getLIDForPN(pn: string): Promise<string | undefined> {
    if (!this.socket) {
      return undefined;
    }

    try {
      // Verifica cache primeiro
      const cache = this.cache.getLIDMappingCache();
      const cachedLID = cache.get<string>(`pn:${pn}`);
      if (cachedLID) {
        return cachedLID;
      }

      // Usa o store interno do Baileys
      const lid = await this.socket.signalRepository.lidMapping.getLIDForPN(pn);
      
      if (lid) {
        // Armazena no cache
        cache.set(`pn:${pn}`, lid);
        cache.set(`lid:${lid}`, pn);
        // Log removido para reduzir verbosidade
      }

      return lid || undefined;
    } catch (error) {
      this.logger.error('Erro ao obter LID para PN', error);
      return undefined;
    }
  }

  /**
   * Obtém PN para um LID usando o store interno do Baileys
   */
  async getPNForLID(lid: string): Promise<string | undefined> {
    if (!this.socket) {
      return undefined;
    }

    try {
      // Verifica cache primeiro
      const cache = this.cache.getLIDMappingCache();
      const cachedPN = cache.get<string>(`lid:${lid}`);
      if (cachedPN) {
        return cachedPN;
      }

      // Usa o store interno do Baileys
      const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lid);
      
      if (pn) {
        // Armazena no cache
        cache.set(`lid:${lid}`, pn);
        cache.set(`pn:${pn}`, lid);
        // Log removido para reduzir verbosidade
      }

      return pn || undefined;
    } catch (error) {
      this.logger.error('Erro ao obter PN para LID', error);
      return undefined;
    }
  }

  /**
   * Armazena mapeamento LID/PN
   */
  async storeLIDPNMapping(lid: string, pn: string): Promise<void> {
    if (!this.socket) {
      return;
    }

    try {
      // Armazena no store interno do Baileys (usa storeLIDPNMappings com array)
      await this.socket.signalRepository.lidMapping.storeLIDPNMappings([{ lid, pn }]);
      
      // Atualiza cache local
      const cache = this.cache.getLIDMappingCache();
      cache.set(`lid:${lid}`, pn);
      cache.set(`pn:${pn}`, lid);
      
      // Log removido para reduzir verbosidade
    } catch (error) {
      this.logger.error('Erro ao armazenar mapeamento LID/PN', error);
    }
  }

  /**
   * Armazena múltiplos mapeamentos
   */
  async storeLIDPNMappings(mappings: LIDMapping[]): Promise<void> {
    if (!this.socket) {
      return;
    }

    try {
      // Armazena no store interno do Baileys
      await this.socket.signalRepository.lidMapping.storeLIDPNMappings(
        mappings.map(m => ({ lid: m.lid, pn: m.pn }))
      );
      
      // Atualiza cache local
      const cache = this.cache.getLIDMappingCache();
      for (const mapping of mappings) {
        cache.set(`lid:${mapping.lid}`, mapping.pn);
        cache.set(`pn:${mapping.pn}`, mapping.lid);
      }
      
      // Log removido para reduzir verbosidade
    } catch (error) {
      this.logger.error('Erro ao armazenar mapeamentos LID/PN', error);
    }
  }

  /**
   * Handler para evento lid-mapping.update
   */
  handleLIDMappingUpdate(mapping: LIDMapping): void {
    // Log removido para reduzir verbosidade
    this.storeLIDPNMapping(mapping.lid, mapping.pn);
  }

  /**
   * Limpa cache
   */
  clearCache(): void {
    this.cache.clearCache(this.cacheKey);
  }
}

