# ✅ Checklist de Compatibilidade Baileys v7.0.0

Este checklist garante que a refatoração está 100% alinhada com as documentações oficiais do Baileys v7.0.0.

## 🔴 CRÍTICO - Deve ser feito ANTES de qualquer refatoração

### Auth State (SignalDataTypeMap)
- [ ] `Auth.ts` suporta `lid-mapping` no `SignalDataTypeMap`
- [ ] `Auth.ts` suporta `device-list` no `SignalDataTypeMap`
- [ ] `Auth.ts` suporta `tctoken` no `SignalDataTypeMap`
- [ ] `Auth.ts` suporta `app-state-sync-key` (já implementado)
- [ ] Testado persistência e recuperação de todas as chaves

### Protobufs
- [ ] Todos os `.fromObject()` substituídos por `.create()`
- [ ] `BufferJSON.replacer` usado em todos os `JSON.stringify()`
- [ ] `BufferJSON.reviver` usado em todos os `JSON.parse()`
- [ ] `decodeAndHydrate()` usado onde necessário
- [ ] Nenhum uso de métodos removidos do proto

### ACKs
- [ ] Removidos todos os `sendReadReceipt()` automáticos
- [ ] `readMessage()` não envia ACK (apenas marca localmente)
- [ ] Documentado que ACKs devem ser manuais se necessário
- [ ] Testado que não há ACKs automáticos sendo enviados

### ESM
- [ ] Verificado se projeto precisa de `"type": "module"` no `package.json`
- [ ] Todos os `require()` convertidos para `import`
- [ ] Testado build e runtime

## 🟡 IMPORTANTE - Deve ser feito durante a refatoração

### Configuração do Socket
- [ ] `getMessage` implementado e funcional
  - [ ] Busca mensagens do storage
  - [ ] Usado para reenvio de mensagens faltantes
  - [ ] Usado para descriptografia de votos em polls
- [ ] `cachedGroupMetadata` implementado
  - [ ] Usa `CacheService.getGroupMetadataCache()`
  - [ ] Evita ratelimit ao enviar mensagens em grupos
- [ ] `logger` configurado usando pino
- [ ] `auth` state customizado funcionando
- [ ] `browser` configurado corretamente (especialmente para pairing code)

### Eventos Obrigatórios
- [ ] `messaging-history.set` implementado
  - [ ] Processa `chats`, `contacts`, `messages`
  - [ ] Armazena mensagens para `getMessage`
  - [ ] Processa `syncType` corretamente
- [ ] `messages.upsert` implementado
  - [ ] Processa TODAS as mensagens do array (não apenas a primeira)
  - [ ] Diferencia `type: 'notify'` de `type: 'append'`
- [ ] `messages.update` implementado
- [ ] `messages.delete` implementado
- [ ] `messages.reaction` implementado
- [ ] `message-receipt.update` implementado
- [ ] `chats.upsert`, `chats.update`, `chats.delete` implementados
- [ ] `contacts.upsert`, `contacts.update` implementados
- [ ] `groups.upsert`, `groups.update` implementados
- [ ] `group-participants.update` implementado
- [ ] `lid-mapping.update` implementado (novo no v7.0.0)
- [ ] `blocklist.set`, `blocklist.update` implementados
- [ ] `call` implementado

### LIDs (Local Identifiers)
- [ ] Suporte a `remoteJidAlt` em MessageKey
- [ ] Suporte a `participantAlt` em MessageKey
- [ ] `isPnUser()` usado em vez de `isJidUser()`
- [ ] Acesso ao `lidMapping` store via `sock.signalRepository.lidMapping`
- [ ] Handler para `lid-mapping.update` implementado
- [ ] `LIDMappingService` criado e funcional
- [ ] `getLIDForPN()` e `getPNForLID()` funcionando
- [ ] `ConvertWAMessage.ts` atualizado para lidar com LIDs
- [ ] `ConvertToWAMessage.ts` atualizado para usar LIDs quando disponível

### History Sync
- [ ] Mensagens do history sync são armazenadas
- [ ] `getMessage` busca do storage corretamente
- [ ] `syncType` é processado corretamente
- [ ] Opção de desabilitar sync com `shouldSyncHistoryMessage: () => false` funciona

## 🟢 RECOMENDADO - Melhorias e otimizações

### Performance
- [ ] `cachedGroupMetadata` implementado e funcionando
- [ ] Caches têm TTL adequado
- [ ] Limpeza periódica de caches implementada

### Logging
- [ ] Logging estruturado usando pino
- [ ] Níveis de log configuráveis
- [ ] Contexto rico nos logs

### Error Handling
- [ ] Tratamento centralizado de erros
- [ ] Logs de erro estruturados
- [ ] Retry logic com backoff exponencial

### Testing
- [ ] Testes unitários para cada handler
- [ ] Testes de integração com Baileys v7.0.0
- [ ] Testes de reconexão
- [ ] Testes de LID mapping

## 📋 Referências de Documentação

Verificar cada item contra:
- [Migração para v7.0.0](https://baileys.wiki/docs/migration/to-v7.0.0)
- [Configuração do Socket](https://baileys.wiki/docs/socket/configuration)
- [History Sync](https://baileys.wiki/docs/socket/history-sync)
- [Receiving Updates](https://baileys.wiki/docs/socket/receiving-updates)
- [Handling Messages](https://baileys.wiki/docs/socket/handling-messages)
- [Sending Messages](https://baileys.wiki/docs/socket/sending-messages)
- [Group Management](https://baileys.wiki/docs/socket/group-management)
- [Privacy](https://baileys.wiki/docs/socket/privacy)
- [App State Updates](https://baileys.wiki/docs/socket/appstate-updates)

## 🎯 Ordem de Implementação Recomendada

1. **FASE 0**: Atualizar para compatibilidade v7.0.0 (CRÍTICO)
2. **FASE 1**: Criar serviços base
3. **FASE 2**: Refatorar gerenciamento de conexão
4. **FASE 3**: Refatorar eventos (seguindo lista de eventos obrigatórios)
5. **FASE 4**: Refatorar WhatsAppBot
6. **FASE 5**: Otimizações

---

**Última Atualização**: 2025-01-27
**Baseado em**: Baileys v7.0.0-rc.9 (versão atual do projeto)

