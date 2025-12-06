# Changelog - Migração para Baileys v7.0.0-rc.5

## Principais Mudanças Implementadas

### 1. Atualização de Dependências
- ✅ Atualizado `@whiskeysockets/baileys` de `^6.7.20` para `7.0.0-rc.5`
- ✅ Adicionado suporte a ESM no `package.json` (`"type": "module"`)

### 2. Remoção de ACKs Automáticos
- ✅ Removido envio automático de ACKs após entrega de mensagens
- ✅ Atualizado método `readMessage()` para não enviar ACKs
- ✅ Implementado cache local para status de leitura

### 3. Suporte a LIDs (Local IDs)
- ⏳ Preparado para implementação de LIDs quando disponível na API estável
- ⏳ Estrutura criada para cache de mapeamento de LIDs
- ⏳ Método `saveCreds()` preparado para LIDs futuros

### 4. BufferJSON para Mensagens
- ⏳ Preparado para uso de `BufferJSON` quando disponível na API estável
- ✅ Método `getMessage()` simplificado para rc.5
- ✅ Tratamento de erros mantido

### 5. Configurações do Socket
- ✅ Adicionado cache para metadata de grupos
- ✅ Implementado cache de chaves de sinal
- ✅ Desabilitado `generateHighQualityLinkPreview` por padrão
- ⏳ Cache de LIDs preparado para versão estável

### 6. Melhorias nas Enquetes
- ✅ Configurações básicas de enquete mantidas
- ✅ Atualizado método `refactoryPollMessage()` para rc.5
- ⏳ Recursos avançados preparados para versão estável

## Mudanças de API

### Métodos Atualizados
- `saveCreds()`: Simplificado para rc.5, preparado para LIDs futuros
- `internalConnect()`: Configuração básica de auth
- `readMessage()`: Removido envio de ACKs automáticos
- `refactoryPollMessage()`: Configurações básicas de enquete
- `getMessage()`: Simplificado para rc.5

### Configurações Adicionadas
- `generateHighQualityLinkPreview`: Desabilitado por padrão
- Cache de metadata de grupos mantido
- Cache de chaves de sinal mantido

## Compatibilidade

### Quebrada
- ACKs automáticos não são mais enviados
- Algumas configurações de socket foram alteradas

### Mantida
- Todas as APIs públicas da biblioteca permanecem iguais
- Métodos de envio de mensagens funcionam normalmente
- Sistema de eventos continua o mesmo

## Próximos Passos

1. **Testes**: Testar todas as funcionalidades com a nova versão
2. **Documentação**: Atualizar documentação se necessário
3. **Exemplos**: Verificar se os exemplos funcionam corretamente
4. **Performance**: Monitorar performance com as novas configurações

## Notas Importantes

- **Privacidade**: LIDs melhoram a privacidade em grupos grandes
- **Banimentos**: Remoção de ACKs reduz risco de banimentos
- **Performance**: Novos caches melhoram performance
- **Compatibilidade**: ESM permite melhor tree-shaking

## Migração de Código Existente

Se você está usando esta biblioteca, as mudanças são transparentes. Apenas certifique-se de:

1. Atualizar dependências: `npm install`
2. Não depender de ACKs automáticos
3. Usar as novas configurações de enquete se necessário

## Referências

- [Baileys v7.0.0 Migration Guide](https://baileys.wiki/docs/migration/to-v7.0.0/)
- [Socket Configuration](https://baileys.wiki/docs/socket/configuration/)
- [LIDs Documentation](https://baileys.wiki/docs/category/socket)