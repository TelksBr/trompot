# Análise de Vazamentos de Memória e Más Práticas

## 🔴 Problemas Críticos Encontrados

### 1. **Event Listeners Não Removidos**

#### Problema 1.1: `WhatsAppBot.ts` - Listeners em `setTimeout` (linha 269-314)
```typescript
setTimeout(() => {
  if (this.sock && this.sock.ev) {
    this.sock.ev.on('messages.upsert', async ({ type, messages }) => {
      // ... handlers nunca são removidos
    });
    // ... mais listeners
  }
}, 0);
```
**Impacto**: Listeners acumulam a cada reconexão, causando processamento duplicado e vazamento.

#### Problema 1.2: `ConfigWAEvents.ts` - Múltiplos listeners sem cleanup
- `configConnectionUpdate()` adiciona listener mas não remove quando socket é recriado
- `configMessagesUpsert()`, `configHistorySet()`, etc. - todos sem cleanup adequado

#### Problema 1.3: `ConnectionEventHandler.ts` - Listeners duplicados
- Adiciona listeners para `connection.update` mas `ConfigWAEvents` também adiciona
- Ambos processam o mesmo evento, causando duplicação

#### Problema 1.4: `Client.ts` - `configEvents()` nunca remove listeners
- Todos os listeners adicionados em `configEvents()` permanecem até o processo terminar
- Se o cliente for recriado, listeners antigos podem permanecer

### 2. **setTimeout/setInterval Sem Cleanup**

#### Problema 2.1: `WhatsAppBot.ts` linha 269
```typescript
setTimeout(() => { /* ... */ }, 0);
```
**Impacto**: Timeout nunca é limpo, pode executar após o socket ser destruído.

#### Problema 2.2: `ConnectionEventHandler.ts` linha 134
```typescript
setTimeout(async () => {
  // ... código que pode não executar se bot for parado
}, this.bot.config.autoRestartInterval);
```
**Impacto**: Timeout pode executar após o bot ser parado.

#### Problema 2.3: `awaitConnectionState()` - Timeout pode não ser limpo
- Se a Promise for rejeitada de outra forma, o timeout pode não ser limpo

### 3. **Caches Sem Limites de Tamanho**

#### Problema 3.1: `NodeCache` sem `maxKeys`
- `CacheService` cria caches com TTL mas sem limite de tamanho
- Em uso intenso, caches podem crescer indefinidamente

#### Problema 3.2: `makeInMemoryStore` pode crescer indefinidamente
- Store armazena chats, mensagens, contatos sem limite
- Em bots com muitos chats, memória pode crescer sem controle

### 4. **Socket Não Limpo Adequadamente**

#### Problema 4.1: `createSocket()` fecha socket mas não remove listeners
```typescript
if (this.sock) {
  this.sock.end(undefined); // Fecha mas listeners podem permanecer
}
```
**Impacto**: Listeners do socket anterior podem continuar ativos.

#### Problema 4.2: `sock.ev.on('creds.update')` nunca é removido
- Adicionado em `createSocket()` mas nunca removido quando socket é recriado

### 5. **connectionListeners Acumulando**

#### Problema 5.1: `connectionListeners` nunca é limpo
- Array cresce indefinidamente com listeners que já foram resolvidos
- Apenas filtrado, nunca limpo completamente

### 6. **Store Não Limpo**

#### Problema 6.1: `makeInMemoryStore` não tem método de limpeza
- Dados acumulam indefinidamente
- Não há mecanismo para limpar dados antigos

## ✅ Correções Necessárias

### Correção 1: Adicionar Cleanup em `WhatsAppBot.stop()`

```typescript
public async stop(reason: any = 402): Promise<void> {
  try {
    this.stateManager.setStatus(BotStatus.Offline);
    
    // Limpa todos os listeners do socket
    if (this.sock?.ev) {
      this.sock.ev.removeAllListeners();
    }
    
    // Limpa event handlers
    this.eventManager.cleanup();
    
    // Limpa connection listeners
    this.connectionListeners = [];
    
    // Limpa checkConnectionInterval
    if (this.checkConnectionInterval) {
      clearInterval(this.checkConnectionInterval);
      this.checkConnectionInterval = null;
    }
    
    await this.connectionManager.disconnect(reason);
  } catch (err) {
    this.errorHandler.handle(err, 'WhatsAppBot.stop');
    this.emit('error', err);
  }
}
```

### Correção 2: Remover Listeners Duplicados em `createSocket()`

```typescript
public async createSocket(): Promise<void> {
  // Fecha socket anterior se existir
  if (this.sock) {
    try {
      // Remove todos os listeners ANTES de fechar
      if (this.sock.ev) {
        this.sock.ev.removeAllListeners();
      }
      this.sock.end(undefined);
    } catch (err) {
      // Ignora erros
    }
  }
  
  // ... resto do código
}
```

### Correção 3: Adicionar Limite de Tamanho aos Caches

```typescript
getCache(name: string, ttl?: number, maxKeys?: number): NodeCache {
  if (!this.caches.has(name)) {
    const cache = new NodeCache({
      stdTTL: ttl || this.defaultTTL,
      maxKeys: maxKeys || 10000, // Limite padrão
      useClones: false,
      checkperiod: 600,
    });
    // ...
  }
}
```

### Correção 4: Limpar `connectionListeners` Periodicamente

```typescript
// Em awaitConnectionState, limpar listeners resolvidos
public async awaitConnectionState(
  connection: WAConnectionState,
): Promise<Partial<ConnectionState>> {
  return new Promise<Partial<ConnectionState>>((res, rej) => {
    const timeout = setTimeout(() => {
      // Remove listener do array
      const index = this.connectionListeners.indexOf(listener);
      if (index > -1) {
        this.connectionListeners.splice(index, 1);
      }
      rej(new Error(`Timeout ao aguardar conexão '${connection}'`));
    }, 60000);

    const listener = (update: Partial<ConnectionState>) => {
      if (update.connection != connection) return false;

      clearTimeout(timeout);
      // Remove listener do array
      const index = this.connectionListeners.indexOf(listener);
      if (index > -1) {
        this.connectionListeners.splice(index, 1);
      }
      res(update);
      return true;
    };

    this.connectionListeners.push(listener);
    // ...
  });
}
```

### Correção 5: Remover `setTimeout` Desnecessário em `WhatsAppBot.ts`

```typescript
// REMOVER o setTimeout e adicionar listeners diretamente
// Se necessário, adicionar em setupEventHandlers() com cleanup adequado
```

### Correção 6: Adicionar Cleanup em `Client.stop()`

```typescript
public async stop(): Promise<void> {
  // Remove todos os listeners do bot
  this.bot.removeAllListeners('message');
  this.bot.removeAllListeners('open');
  this.bot.removeAllListeners('close');
  // ... outros eventos
  
  await this.bot.stop();
}
```

### Correção 7: Limitar Tamanho do Store

```typescript
// Adicionar método para limpar dados antigos do store
public cleanupOldData(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
  const now = Date.now();
  // Limpar chats sem atividade há mais de maxAge
  // Limpar mensagens antigas
}
```

## 📊 Resumo de Impacto

| Problema | Severidade | Impacto na Memória | Frequência |
|----------|-----------|-------------------|------------|
| Listeners não removidos | 🔴 Crítico | Alto | A cada reconexão |
| Timeouts não limpos | 🟡 Médio | Médio | Variável |
| Caches sem limite | 🟡 Médio | Alto | Crescimento contínuo |
| Store sem limpeza | 🟡 Médio | Alto | Crescimento contínuo |
| Listeners duplicados | 🟠 Alto | Médio | A cada reconexão |

## 🎯 Prioridade de Correção

1. **Alta Prioridade**: Limpar listeners em `stop()` e `createSocket()`
2. **Média Prioridade**: Adicionar limites aos caches
3. **Baixa Prioridade**: Limpeza periódica do store

