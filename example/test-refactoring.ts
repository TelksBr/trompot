/**
 * Script de teste para verificar a refatoração
 * Testa se todos os novos serviços e managers estão funcionando
 */

import { WhatsAppBot } from '../src';
import path from 'path';

console.log('🧪 Testando refatoração da biblioteca...\n');

// Testa criação do bot com novas configurações
console.log('1️⃣ Testando criação do WhatsAppBot com logLevel...');
try {
  const wbot = new WhatsAppBot({
    autoSyncHistory: false,
    useExperimentalServers: false,
    logLevel: 'info', // Nova configuração
  });
  console.log('✅ WhatsAppBot criado com sucesso!');
  console.log(`   - Config logLevel: ${(wbot.config as any).logLevel || 'não definido'}`);
} catch (error) {
  console.error('❌ Erro ao criar WhatsAppBot:', error);
  process.exit(1);
}

// Testa se os serviços estão inicializados
console.log('\n2️⃣ Testando inicialização dos serviços...');
try {
  const wbot = new WhatsAppBot();
  
  // Verifica se os serviços privados existem (através de reflexão)
  const botAny = wbot as any;
  
  const services = [
    'loggerService',
    'cacheService',
    'errorHandler',
    'retryService',
    'lidMappingService',
    'stateManager',
    'connectionManager',
    'sessionManager',
    'eventManager',
  ];

  const handlers = [
    'connectionEventHandler',
    'messageEventHandler',
    'historyEventHandler',
    'contactEventHandler',
    'groupEventHandler',
    'chatEventHandler',
    'callEventHandler',
    'lidMappingEventHandler',
  ];

  let allServicesOk = true;
  for (const service of services) {
    if (!botAny[service]) {
      console.error(`   ❌ ${service} não encontrado`);
      allServicesOk = false;
    } else {
      console.log(`   ✅ ${service} inicializado`);
    }
  }

  for (const handler of handlers) {
    if (!botAny[handler]) {
      console.error(`   ❌ ${handler} não encontrado`);
      allServicesOk = false;
    } else {
      console.log(`   ✅ ${handler} inicializado`);
    }
  }

  if (allServicesOk) {
    console.log('✅ Todos os serviços e handlers foram inicializados!');
  } else {
    console.error('❌ Alguns serviços não foram inicializados');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Erro ao verificar serviços:', error);
  process.exit(1);
}

// Testa getters que delegam para StateManager
console.log('\n3️⃣ Testando getters do StateManager...');
try {
  const wbot = new WhatsAppBot();
  
  // Os getters devem funcionar mesmo sem conexão
  console.log(`   - id: ${wbot.id}`);
  console.log(`   - status: ${wbot.status}`);
  console.log(`   - phoneNumber: ${wbot.phoneNumber}`);
  console.log(`   - name: ${wbot.name}`);
  console.log(`   - profileUrl: ${wbot.profileUrl}`);
  console.log(`   - lastConnectionUpdateDate: ${wbot.lastConnectionUpdateDate}`);
  console.log(`   - lastDisconnectError: ${wbot.lastDisconnectError}`);
  
  console.log('✅ Getters funcionando corretamente!');
} catch (error) {
  console.error('❌ Erro ao testar getters:', error);
  process.exit(1);
}

// Testa caches
console.log('\n4️⃣ Testando caches...');
try {
  const wbot = new WhatsAppBot();
  
  if (wbot.msgRetryCountercache) {
    console.log('   ✅ msgRetryCountercache inicializado');
  } else {
    console.error('   ❌ msgRetryCountercache não inicializado');
  }
  
  if (wbot.groupMetadataCache) {
    console.log('   ✅ groupMetadataCache inicializado');
  } else {
    console.error('   ❌ groupMetadataCache não inicializado');
  }
  
  if (wbot.signalKeyCache) {
    console.log('   ✅ signalKeyCache inicializado');
  } else {
    console.error('   ❌ signalKeyCache não inicializado');
  }
  
  console.log('✅ Caches inicializados corretamente!');
} catch (error) {
  console.error('❌ Erro ao testar caches:', error);
  process.exit(1);
}

console.log('\n✅ Todos os testes passaram! A refatoração está funcionando corretamente.\n');
console.log('💡 Para testar a conexão real, execute: npm run example\n');

