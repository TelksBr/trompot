# 📋 Plano Completo de Refatoração - Integração Baileys

## 🎯 Objetivos da Refatoração

1. **Melhorar a Arquitetura**: Separar responsabilidades, reduzir acoplamento
2. **Simplificar o Código**: Reduzir complexidade ciclomática, melhorar legibilidade
3. **Melhorar Confiabilidade**: Tratamento de erros robusto, reconexão inteligente
4. **Otimizar Performance**: Reduzir memory leaks, otimizar caches
5. **Facilitar Manutenção**: Código modular, testável e documentado

---

## 🔍 Análise dos Problemas Atuais

### 1. **Arquitetura e Organização**

#### Problemas Identificados:
- ❌ `WhatsAppBot.ts` com **1237 linhas** - viola Single Responsibility Principle
- ❌ `ConfigWAEvents.ts` com **658 linhas** - muitas responsabilidades
- ❌ Listeners duplicados (ex: `messages.upsert` no constructor E em `ConfigWAEvents`)
- ❌ Lógica de negócio misturada com lógica de infraestrutura
- ❌ `setTimeout` no constructor para configurar listeners (anti-pattern)

#### Impacto:
- Difícil de testar
- Difícil de manter
- Alto risco de bugs
- Performance degradada

### 2. **Gerenciamento de Estado e Conexão**

#### Problemas Identificados:
- ❌ Estado de conexão não centralizado
- ❌ Múltiplos caches (`msgRetryCountercache`, `groupMetadataCache`, `signalKeyCache`) sem estratégia clara
- ❌ `connectionListeners` array cresce indefinidamente
- ❌ `checkConnectionInterval` não é limpo adequadamente
- ❌ Lógica de reconexão complexa e espalhada

#### Impacto:
- Memory leaks potenciais
- Estado inconsistente
- Reconexões falhando silenciosamente

### 3. **Tratamento de Erros e Reconexão**

#### Problemas Identificados:
- ❌ Tratamento de erros inconsistente (alguns em try/catch, outros não)
- ❌ Lógica de reconexão com múltiplos caminhos
- ❌ Falta de retry logic adequada
- ❌ Erros 401/421/428 tratados de forma diferente em lugares diferentes
- ❌ `lastDisconnectError` não é resetado adequadamente

#### Impacto:
- Erros não tratados causam crashes
- Reconexões falhando
- Experiência do usuário ruim

### 4. **Autenticação e Sessão**

#### Problemas Identificados:
- ❌ Lógica de validação de sessão espalhada
- ❌ `saveCreds` pode ser sobrescrito
- ❌ Não há validação clara de sessão válida vs inválida
- ❌ `creds.json` com `registered: false` não é tratado adequadamente

#### Impacto:
- Sessões inválidas causam loops de reconexão
- QR codes não gerados quando deveriam

### 5. **Performance e Memory Leaks**

#### Problemas Identificados:
- ❌ Listeners não são removidos quando desconecta
- ❌ `setTimeout` no constructor nunca é limpo
- ❌ Caches não têm TTL adequado
- ❌ `messagesCached` array cresce indefinidamente

#### Impacto:
- Memory leaks ao longo do tempo
- Performance degradada
- Aplicação pode travar

---

## 🏗️ Arquitetura Proposta

### Nova Estrutura de Arquivos

```
src/wa/
├── core/
│   ├── WhatsAppBot.ts          # Classe principal (apenas orquestração)
│   ├── ConnectionManager.ts    # Gerencia conexão, reconexão, estado
│   ├── SessionManager.ts       # Gerencia autenticação e sessão
│   └── StateManager.ts         # Gerencia estado da conexão
├── events/
│   ├── EventManager.ts         # Gerencia todos os listeners
│   ├── MessageEventHandler.ts # Handlers de mensagens
│   ├── ConnectionEventHandler.ts # Handlers de conexão
│   ├── GroupEventHandler.ts   # Handlers de grupos
│   └── ContactEventHandler.ts  # Handlers de contatos
├── services/
│   ├── CacheService.ts         # Serviço centralizado de cache
│   ├── RetryService.ts         # Lógica de retry
│   └── LoggerService.ts        # Logging estruturado
├── utils/
│   ├── ErrorHandler.ts         # Tratamento centralizado de erros
│   └── ConnectionUtils.ts     # Utilitários de conexão
├── Auth.ts                     # Mantém (já está bom)
├── ConvertToWAMessage.ts      # Mantém
├── ConvertWAMessage.ts         # Mantém
└── makeInMemoryStore.ts        # Mantém
```

---

## 📝 Plano de Implementação

### **FASE 0: Preparação para Baileys v7.0.0** (Prioridade: CRÍTICA)

#### 0.1. Atualizar Auth State para v7.0.0
- [ ] Atualizar `Auth.ts` para suportar `lid-mapping`, `device-list`, `tctoken`
- [ ] Atualizar `SignalDataTypeMap` com todas as chaves necessárias
- [ ] Testar persistência e recuperação de todas as chaves

**Benefícios:**
- Compatibilidade total com v7.0.0
- Suporte a LIDs
- Sessões funcionando corretamente

#### 0.2. Atualizar Protobufs
- [ ] Substituir todos os `.fromObject()` por `.create()`
- [ ] Usar `BufferJSON.replacer` e `BufferJSON.reviver` em todos os lugares
- [ ] Implementar `decodeAndHydrate()` onde necessário

**Benefícios:**
- Compatibilidade com v7.0.0
- Bundle size reduzido
- Performance melhorada

#### 0.3. Remover ACKs Automáticos
- [ ] Remover todos os `sendReadReceipt()` automáticos
- [ ] Verificar que `readMessage()` não envia ACK
- [ ] Documentar comportamento

**Benefícios:**
- Evita banimentos
- Conformidade com v7.0.0

### **FASE 1: Preparação e Infraestrutura** (Prioridade: ALTA)

#### 1.1. Criar Serviços Base
- [ ] `CacheService.ts` - Centralizar todos os caches (incluindo `cachedGroupMetadata`)
- [ ] `LoggerService.ts` - Logging estruturado usando pino
- [ ] `ErrorHandler.ts` - Tratamento centralizado de erros
- [ ] `RetryService.ts` - Lógica de retry com backoff exponencial
- [ ] `LIDMappingService.ts` - Gerenciar mapeamentos LID/PN

**Benefícios:**
- Código reutilizável
- Fácil de testar
- Consistência
- Suporte completo a LIDs

#### 1.2. Criar StateManager
- [ ] `StateManager.ts` - Gerenciar estado de conexão centralizado
- [ ] Substituir múltiplas variáveis de estado por um objeto único
- [ ] Implementar observers para mudanças de estado
- [ ] Suportar LIDs e PNs no estado

**Benefícios:**
- Estado consistente
- Fácil de debugar
- Prevenção de race conditions
- Suporte a LIDs

### **FASE 2: Refatorar Gerenciamento de Conexão** (Prioridade: ALTA)

#### 2.1. Criar ConnectionManager
- [ ] Extrair lógica de conexão de `WhatsAppBot.ts`
- [ ] Implementar máquina de estados para conexão
- [ ] Centralizar lógica de reconexão
- [ ] Implementar retry logic com backoff exponencial
- [ ] Limpar listeners adequadamente

**Estados da Máquina:**
```
DISCONNECTED → CONNECTING → AUTHENTICATING → CONNECTED → RECONNECTING
     ↑                                                          ↓
     └──────────────────────────────────────────────────────────┘
```

**Benefícios:**
- Reconexão confiável
- Sem memory leaks
- Fácil de debugar

#### 2.2. Criar SessionManager
- [ ] Extrair lógica de autenticação
- [ ] Validar sessão antes de conectar
- [ ] Limpar sessão inválida automaticamente
- [ ] Gerenciar ciclo de vida de credenciais

**Benefícios:**
- Sessões sempre válidas
- QR codes gerados quando necessário
- Sem loops de reconexão

### **FASE 3: Refatorar Eventos** (Prioridade: MÉDIA)

#### 3.1. Criar EventManager
- [ ] Centralizar todos os listeners
- [ ] Implementar cleanup automático
- [ ] Prevenir listeners duplicados
- [ ] Gerenciar ordem de execução

**Benefícios:**
- Sem listeners duplicados
- Sem memory leaks
- Performance melhorada

#### 3.2. Separar Handlers por Responsabilidade
- [ ] `MessageEventHandler.ts` - Apenas mensagens
  - [ ] `messages.upsert` (processar TODAS as mensagens do array)
  - [ ] `messages.update`
  - [ ] `messages.delete`
  - [ ] `messages.reaction`
  - [ ] `message-receipt.update`
- [ ] `ConnectionEventHandler.ts` - Apenas conexão
  - [ ] `connection.update`
  - [ ] `creds.update`
- [ ] `GroupEventHandler.ts` - Apenas grupos
  - [ ] `groups.upsert`
  - [ ] `groups.update`
  - [ ] `group-participants.update`
- [ ] `ContactEventHandler.ts` - Apenas contatos
  - [ ] `contacts.upsert`
  - [ ] `contacts.update`
- [ ] `HistoryEventHandler.ts` - History sync
  - [ ] `messaging-history.set` (obrigatório)
  - [ ] Armazenar mensagens para `getMessage`
- [ ] `LIDMappingEventHandler.ts` - LID mappings
  - [ ] `lid-mapping.update` (novo no v7.0.0)
- [ ] `ChatEventHandler.ts` - Chats
  - [ ] `chats.upsert`
  - [ ] `chats.update`
  - [ ] `chats.delete`
  - [ ] `blocklist.set`
  - [ ] `blocklist.update`

**Benefícios:**
- Código mais limpo
- Fácil de testar
- Fácil de manter
- Conformidade com v7.0.0

### **FASE 4: Refatorar WhatsAppBot** (Prioridade: MÉDIA)

#### 4.1. Simplificar WhatsAppBot
- [ ] Reduzir para ~300-400 linhas
- [ ] Apenas orquestração, não implementação
- [ ] Delegar para serviços especializados
- [ ] Manter apenas API pública

**Estrutura Proposta:**
```typescript
export default class WhatsAppBot extends BotEvents implements IBot {
  private connectionManager: ConnectionManager;
  private sessionManager: SessionManager;
  private eventManager: EventManager;
  private stateManager: StateManager;
  private cacheService: CacheService;
  
  // API pública simplificada
  public async connect(auth?: string | IAuth): Promise<void>
  public async disconnect(): Promise<void>
  public async send(message: Message): Promise<Message>
  // ... outros métodos públicos
}
```

**Benefícios:**
- Código mais limpo
- Fácil de entender
- Fácil de testar

### **FASE 5: Otimizações e Melhorias** (Prioridade: BAIXA)

#### 5.1. Otimizar Caches
- [ ] Implementar TTL adequado
- [ ] Limpar caches periodicamente
- [ ] Implementar cache warming

#### 5.2. Melhorar Logging
- [ ] Logging estruturado
- [ ] Níveis de log configuráveis
- [ ] Contexto rico nos logs

#### 5.3. Adicionar Métricas
- [ ] Tempo de conexão
- [ ] Taxa de erro
- [ ] Uso de memória

---

## 🔧 Detalhamento Técnico

### ConnectionManager

```typescript
export class ConnectionManager {
  private state: ConnectionState = 'disconnected';
  private retryService: RetryService;
  private stateManager: StateManager;
  private sessionManager: SessionManager;
  
  async connect(config: SocketConfig): Promise<void>
  async disconnect(reason?: number): Promise<void>
  async reconnect(force?: boolean): Promise<void>
  
  private async handleConnectionUpdate(update: ConnectionState): Promise<void>
  private async handleDisconnect(error: Boom): Promise<void>
  private async cleanup(): Promise<void>
}
```

### SessionManager

```typescript
export class SessionManager {
  async validateSession(auth: IAuth): Promise<SessionValidationResult>
  async clearInvalidSession(auth: IAuth): Promise<void>
  async saveCredentials(creds: AuthenticationCreds): Promise<void>
  async loadCredentials(auth: IAuth): Promise<AuthenticationCreds>
  
  private isSessionValid(creds: AuthenticationCreds): boolean
  private shouldGenerateQR(creds: AuthenticationCreds): boolean
}
```

### EventManager

```typescript
export class EventManager {
  private listeners: Map<string, Set<Function>> = new Map();
  private socket: WASocket;
  
  register(event: string, handler: Function): () => void // retorna cleanup
  unregister(event: string, handler: Function): void
  cleanup(): void
  
  // Métodos específicos
  onMessage(handler: (msg: Message) => void): () => void
  onConnection(handler: (state: ConnectionState) => void): () => void
  // ...
}
```

### CacheService

```typescript
export class CacheService {
  private caches: Map<string, NodeCache> = new Map();
  
  getCache(name: string, ttl?: number): NodeCache
  clearCache(name: string): void
  clearAll(): void
  
  // Caches específicos (v7.0.0)
  getMessageCache(): NodeCache
  getGroupMetadataCache(): NodeCache // CRÍTICO: Para cachedGroupMetadata
  getSignalKeyCache(): NodeCache
  getLIDMappingCache(): NodeCache // Novo: Para mapeamentos LID/PN
}
```

### LIDMappingService

```typescript
export class LIDMappingService {
  private socket: WASocket;
  
  // Acessa o store interno do Baileys
  getLIDForPN(pn: string): Promise<string | undefined>
  getPNForLID(lid: string): Promise<string | undefined>
  storeLIDPNMapping(lid: string, pn: string): Promise<void>
  
  // Handler para evento lid-mapping.update
  handleLIDMappingUpdate(mapping: LIDMapping): void
}
```

---

## ✅ Checklist de Migração

### Antes de Começar
- [ ] **CRÍTICO**: Verificar compatibilidade com Baileys v7.0.0
- [ ] **CRÍTICO**: Atualizar `Auth.ts` para suportar `lid-mapping`, `device-list`, `tctoken`
- [ ] **CRÍTICO**: Remover todos os ACKs automáticos
- [ ] **CRÍTICO**: Substituir `.fromObject()` por `.create()` em protobufs
- [ ] Criar branch `refactor/baileys-integration`
- [ ] Documentar comportamento atual (testes de integração)
- [ ] Criar testes unitários para funcionalidades críticas
- [ ] Testar com Baileys v7.0.0-rc.9 (versão atual do projeto)

### Durante a Refatoração
- [ ] Implementar uma fase por vez
- [ ] Testar após cada fase
- [ ] Manter compatibilidade com API pública
- [ ] Documentar mudanças

### Após a Refatoração
- [ ] Executar todos os testes
- [ ] Testar em ambiente de produção (staging)
- [ ] Atualizar documentação
- [ ] Code review
- [ ] Merge para main

---

## 📊 Métricas de Sucesso

### Antes da Refatoração
- `WhatsAppBot.ts`: ~1237 linhas
- `ConfigWAEvents.ts`: ~658 linhas
- Listeners duplicados: 3+
- Memory leaks conhecidos: 2+
- Complexidade ciclomática: Alta

### Após a Refatoração (Meta)
- `WhatsAppBot.ts`: ~300-400 linhas (-70%)
- Handlers separados: ~100-200 linhas cada
- Listeners duplicados: 0
- Memory leaks: 0
- Complexidade ciclomática: Baixa
- Cobertura de testes: >80%

---

## 🚨 Riscos e Mitigações

### Risco 1: Quebrar Funcionalidade Existente
**Mitigação:**
- Manter API pública idêntica
- Testes de integração antes/depois
- Deploy gradual

### Risco 2: Introduzir Novos Bugs
**Mitigação:**
- Code review rigoroso
- Testes unitários para cada componente
- Testes de carga

### Risco 3: Tempo de Desenvolvimento
**Mitigação:**
- Implementar por fases
- Priorizar funcionalidades críticas
- Reutilizar código existente quando possível

---

## 🔄 Compatibilidade com Baileys v7.0.0

### Mudanças Críticas do v7.0.0

#### 1. **LIDs (Local Identifiers)**
- ⚠️ **CRÍTICO**: Sistema de LIDs requer suporte a `lid-mapping`, `device-list`, e `tctoken` no auth state
- ⚠️ **CRÍTICO**: `SignalDataTypeMap` deve ser atualizado para suportar novas chaves
- ✅ **Implementar**: Suporte a `remoteJidAlt` e `participantAlt` em MessageKey
- ✅ **Implementar**: Uso de `isPnUser()` em vez de `isJidUser()`
- ✅ **Implementar**: Acesso ao `lidMapping` store via `sock.signalRepository.lidMapping`
- ✅ **Implementar**: Handler para evento `lid-mapping.update`

**Ações Necessárias:**
- [ ] Atualizar `Auth.ts` para suportar `lid-mapping`, `device-list`, `tctoken`
- [ ] Atualizar `ConvertWAMessage.ts` para lidar com LIDs e PNs
- [ ] Atualizar `ConvertToWAMessage.ts` para usar LIDs quando disponível
- [ ] Implementar `LIDMappingHandler` para gerenciar mapeamentos

#### 2. **ACKs Removidos**
- ⚠️ **CRÍTICO**: Não enviar ACKs automaticamente (pode causar banimento)
- ✅ **Implementar**: Remover todos os ACKs automáticos
- ✅ **Verificar**: `readMessage()` não deve enviar ACK

**Ações Necessárias:**
- [ ] Remover todos os `sendReadReceipt()` automáticos
- [ ] Verificar que `readMessage()` apenas marca localmente
- [ ] Documentar que ACKs devem ser manuais se necessário

#### 3. **ESM (ECMAScript Modules)**
- ⚠️ **CRÍTICO**: Baileys v7.0.0+ é ESM apenas
- ✅ **Verificar**: Projeto já usa TypeScript, mas precisa garantir compatibilidade ESM
- ✅ **Implementar**: Usar `import` em vez de `require()`

**Ações Necessárias:**
- [ ] Verificar se `package.json` tem `"type": "module"` ou usar `.mjs`
- [ ] Converter todos os `require()` para `import`
- [ ] Testar build e runtime

#### 4. **Protobufs Simplificados**
- ⚠️ **CRÍTICO**: Apenas `.create()`, `.encode()`, `.decode()` disponíveis
- ⚠️ **CRÍTICO**: Usar `BufferJSON` para encoding/decoding
- ✅ **Implementar**: Usar `decodeAndHydrate()` para decodificação

**Ações Necessárias:**
- [ ] Substituir todos os `.fromObject()` por `.create()`
- [ ] Usar `BufferJSON.replacer` e `BufferJSON.reviver` sempre
- [ ] Usar `decodeAndHydrate()` para decodificação

#### 5. **Configuração do Socket (v7.0.0)**
- ✅ **Implementar**: `getMessage` obrigatório para reenvio e descriptografia de polls
- ✅ **Implementar**: `cachedGroupMetadata` para evitar ratelimit
- ✅ **Implementar**: `logger` usando pino
- ✅ **Implementar**: `auth` state customizado

**Ações Necessárias:**
- [ ] Garantir que `getMessage` está implementado corretamente
- [ ] Implementar `cachedGroupMetadata` usando `CacheService`
- [ ] Configurar `logger` adequadamente
- [ ] Validar `auth` state suporta todas as chaves necessárias

#### 6. **Eventos do Socket (v7.0.0)**
- ✅ **Implementar**: Handler para `messaging-history.set` (obrigatório)
- ✅ **Implementar**: Handlers para todos os eventos de mensagens
- ✅ **Implementar**: Handlers para eventos de grupos, contatos, chats

**Eventos Obrigatórios:**
- `messaging-history.set` - Sincronização inicial
- `messages.upsert` - Novas mensagens (type: 'notify' ou 'append')
- `messages.update` - Atualizações de mensagens
- `messages.delete` - Deleção de mensagens
- `messages.reaction` - Reações
- `chats.upsert`, `chats.update`, `chats.delete`
- `contacts.upsert`, `contacts.update`
- `groups.upsert`, `groups.update`, `group-participants.update`
- `lid-mapping.update` - Novo no v7.0.0

**Ações Necessárias:**
- [ ] Implementar handler completo para `messaging-history.set`
- [ ] Garantir que `messages.upsert` processa TODAS as mensagens do array
- [ ] Implementar handler para `lid-mapping.update`
- [ ] Separar handlers por tipo (MessageEventHandler, GroupEventHandler, etc.)

#### 7. **History Sync**
- ✅ **Implementar**: Armazenar mensagens para `getMessage`
- ✅ **Implementar**: Processar `syncType` corretamente
- ✅ **Opcional**: Desabilitar sync com `shouldSyncHistoryMessage: () => false`

**Ações Necessárias:**
- [ ] Garantir que mensagens do history sync são armazenadas
- [ ] Implementar `getMessage` que busca do storage
- [ ] Processar `syncType` para determinar se é histórico completo ou parcial

#### 8. **Meta Coexistence**
- ℹ️ **Info**: Suporte experimental para coexistência com WA Business App
- ✅ **Monitorar**: Reportar issues se encontrar problemas

---

## 📚 Recursos e Referências

### Documentação Oficial Baileys v7.0.0
- [Migração para v7.0.0](https://baileys.wiki/docs/migration/to-v7.0.0)
- [Configuração do Socket](https://baileys.wiki/docs/socket/configuration)
- [History Sync](https://baileys.wiki/docs/socket/history-sync)
- [Receiving Updates](https://baileys.wiki/docs/socket/receiving-updates)
- [Handling Messages](https://baileys.wiki/docs/socket/handling-messages)
- [Sending Messages](https://baileys.wiki/docs/socket/sending-messages)
- [Group Management](https://baileys.wiki/docs/socket/group-management)
- [Privacy](https://baileys.wiki/docs/socket/privacy)
- [App State Updates](https://baileys.wiki/docs/socket/appstate-updates)

### Outros Recursos
- [Baileys GitHub](https://github.com/WhiskeySockets/Baileys)
- Clean Architecture principles
- SOLID principles
- Design Patterns (State, Observer, Strategy)

---

## 🎯 Próximos Passos

1. **Revisar este plano** com a equipe
2. **Priorizar fases** baseado em necessidades
3. **Criar branch** e começar Fase 1
4. **Implementar incrementalmente** com testes contínuos
5. **Documentar** cada mudança

---

**Data de Criação:** 2025-01-27
**Última Atualização:** 2025-01-27
**Status:** 📋 Proposta

