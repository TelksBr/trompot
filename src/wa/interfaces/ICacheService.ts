import NodeCache from 'node-cache';

/**
 * Interface para serviços de cache
 */
export interface ICacheService {
  getMessageRetryCache(): NodeCache;
  getGroupMetadataCache(): NodeCache;
  getSignalKeyCache(): NodeCache;
  getLIDMappingCache(): NodeCache;
  clearCache(name: string): void;
  clearAll(): void;
}

