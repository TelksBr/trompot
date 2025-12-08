import NodeCache from 'node-cache';
import { LoggerService } from './LoggerService';

export class CacheService {
  private caches: Map<string, NodeCache> = new Map();
  private logger: LoggerService;
  private defaultTTL: number = 3600; // 1 hora

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Obtém ou cria um cache
   */
  getCache(name: string, ttl?: number, maxKeys?: number): NodeCache {
    if (!this.caches.has(name)) {
      const cache = new NodeCache({
        stdTTL: ttl || this.defaultTTL,
        maxKeys: maxKeys || 10000, // Limite padrão de 10k chaves para evitar vazamento
        useClones: false,
        checkperiod: 600, // Verifica expiração a cada 10 minutos
      });

      this.caches.set(name, cache);
      // Log removido para reduzir verbosidade
    }

    return this.caches.get(name)!;
  }

  /**
   * Limpa um cache específico
   */
  clearCache(name: string): void {
    const cache = this.caches.get(name);
    if (cache) {
      cache.flushAll();
      // Log removido para reduzir verbosidade
    }
  }

  /**
   * Limpa todos os caches
   */
  clearAll(): void {
    this.caches.forEach((cache) => {
      cache.flushAll();
      // Log removido para reduzir verbosidade
    });
  }

  /**
   * Remove um cache
   */
  removeCache(name: string): void {
    const cache = this.caches.get(name);
    if (cache) {
      cache.flushAll();
      this.caches.delete(name);
      // Log removido para reduzir verbosidade
    }
  }

  // Caches específicos (v7.0.0)

  /**
   * Cache para retry de mensagens
   */
  getMessageRetryCache(): NodeCache {
    return this.getCache('message-retry', 3600); // 1 hora
  }

  /**
   * Cache para metadata de grupos (CRÍTICO: para cachedGroupMetadata)
   */
  getGroupMetadataCache(): NodeCache {
    return this.getCache('group-metadata', 300); // 5 minutos
  }

  /**
   * Cache para chaves de sinal
   */
  getSignalKeyCache(): NodeCache {
    return this.getCache('signal-keys', 300); // 5 minutos
  }

  /**
   * Cache para mensagens
   */
  getMessageCache(): NodeCache {
    return this.getCache('messages', 3600); // 1 hora
  }

  /**
   * Cache para mapeamentos LID/PN (v7.0.0)
   */
  getLIDMappingCache(): NodeCache {
    return this.getCache('lid-mapping', 86400); // 24 horas
  }
}

