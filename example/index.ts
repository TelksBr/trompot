import Client, {
  WhatsAppBot,
  TelegramBot,
  TelegramAuth,
  Message,
  Command,
  CMDRunType,
  CMDPerms,
  EmptyMessage,
  MultiFileAuthState,
  QuickResponse,
  ChatType,
} from '../src';

// Configuração do bot (escolha WhatsApp ou Telegram)
const USE_TELEGRAM = false; // Mude para false para usar WhatsApp
const TELEGRAM_BOT_TOKEN = '8089350138:AAF6P9DR6XfQTusebbm0viwkglujn2Zz3go';

// Cria bot baseado na configuração
const bot = USE_TELEGRAM 
  ? new TelegramBot()
  : new WhatsAppBot({
      autoSyncHistory: false,
      useExperimentalServers: true,
      logLevel: 'info', // Reduz logs do Baileys (não mostra "Closing session")
      autoRejectCalls: true, // Rejeita automaticamente todas as chamadas recebidas
    });

const client = new Client(bot, {
  disableAutoCommand: false,
  disableAutoCommandForOldMessage: true,
  disableAutoCommandForUnofficialMessage: true,
  disableAutoTyping: false,
  disableAutoRead: false,
});

client.on('open', (open: { isNewLogin: boolean }) => {
  if (USE_TELEGRAM) {
    console.info('✅ Bot Telegram conectado!');
    console.info(`🤖 Bot: ${client.bot.name || 'Não disponível'}`);
    console.info(`🆔 ID: ${client.bot.id || 'Não disponível'}`);
  } else {
    if (open.isNewLogin) {
      console.info('✅ Nova conexão realizada!');
    } else {
      console.info('✅ Reconectado com sessão existente!');
    }
    // Mostra apenas o número de telefone
    const phoneNumber = client.bot.phoneNumber || 'Não disponível';
    console.info(`📱 Telefone: ${phoneNumber}`);
  }
});

// Configuração de reconexão (apenas para WhatsApp)
if (!USE_TELEGRAM) {
  // Contador de tentativas de reconexão para evitar loop infinito
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const SESSION_PATH = './example/sessions/whatsapp';

  client.on('close', async (update) => {
    console.warn(`⚠️ Cliente desconectou! Motivo: ${update.reason}`);
    
    if (update.reason === 401 || update.reason === 421) {
      reconnectAttempts++;
      
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.error(`❌ Limite de tentativas de reconexão atingido (${MAX_RECONNECT_ATTEMPTS}).`);
        console.error('❌ Por favor, verifique manualmente se a sessão foi limpa e tente novamente.');
        console.error(`📁 Diretório da sessão: ${SESSION_PATH}`);
        return;
      }
      
      console.warn('⚠️ Sessão desconectada do WhatsApp.');
      console.info('✅ A biblioteca já limpou TODA a sessão automaticamente (creds + todas as keys).');
      console.info(`🔄 Reconectando automaticamente em 2 segundos... (tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      
      // Delay exponencial: 2s, 4s, 8s
      const delay = Math.min(2000 * Math.pow(2, reconnectAttempts - 1), 10000);
      
      // Reconecta automaticamente após delay
      // A biblioteca já limpou TUDO (creds + keys), então um novo QR code será gerado
      setTimeout(async () => {
        try {
          await client.connect(SESSION_PATH);
          reconnectAttempts = 0; // Reset contador se conectar com sucesso
        } catch (error) {
          console.error('❌ Erro ao reconectar:', error);
        }
      }, delay);
    } else if (update.reason === 428) {
      console.warn('⚠️ Erro 428: Connection Terminated (erro temporário). O Baileys tentará reconectar automaticamente.');
      reconnectAttempts = 0; // Reset para erros temporários
    } else {
      reconnectAttempts = 0; // Reset para outros erros
    }
  });

  client.on('qr', async (qr: string) => {
    console.info('📱 QR Code gerado!');
    try {
      const QRCode = (await import('qrcode')).default;
      console.log('\n' + await QRCode.toString(qr, { type: 'terminal', small: true }));
      console.log('\n📱 Escaneie o QR code acima com seu WhatsApp\n');
    } catch (err) {
      console.log('QR Code (texto):', qr);
    }
  });
}

client.on('connecting', () => {
  console.info('Tentando conectar cliente...');
});

client.on('stop', (update) => {
  if (update.isLogout) {
    console.info(`Cliente desligado!`);
  } else {
    console.info(`Cliente parado!`);
  }
});

client.on('reconnecting', () => {
  console.info('Reconectando...');
});

client.on('message', async (message: Message) => {
  if (EmptyMessage.isValid(message)) return;
  if (message.isOld) return;

  if (message.selected.includes('poll')) {
    const cmd = client.searchCommand('/poll');

    if (cmd) client.runCommand(cmd, message, CMDRunType.Reply);
  }
});

client.on('chat', (update) => {
  if (update.action == 'add') {
    // console.info(`New chat: ${update.chat.id}`);
  }
  if (update.action == 'remove') {
    // console.info(`Remove chat: ${update.chat.id}`);
  }
  if (update.action == 'update') {
    // console.info("Chat update:", update.chat);
  }
});

client.on('user', async (update) => {
  if (update.action == 'join') {
    // await client.send(new Message(update.chat, `@${update.user.id} entrou no grupo.`));
  }

  if (update.action == 'leave') {
    // await client.send(new Message(update.chat, `@${update.user.id} saiu do grupo...`));
  }

  if (update.action == 'add') {
    // await client.send(new Message(update.chat, `Membro @${update.fromUser.id} adicionou o @${update.user.id} ao grupo!`));
  }

  if (update.action == 'remove') {
    // await client.send(new Message(update.chat, `Membro @${update.fromUser.id} removeu o @${update.user.id} do grupo.`));
  }

  if (update.action == 'promote') {
    // await client.send(new Message(update.chat, `Membro @${update.fromUser.id} promoveu o @${update.user.id} para admin!`));
  }

  if (update.action == 'demote') {
    // await client.send(new Message(update.chat, `Membro @${update.fromUser.id} removeu o admin do @${update.user.id}.`));
  }
});

// Handler de chamadas (apenas para WhatsApp)
if (!USE_TELEGRAM) {
  client.on('new-call', async (call) => {
    console.info('Nova chamada recebida:', call);

    // Nota: Se autoRejectCalls estiver ativado na configuração do bot,
    // a chamada já foi rejeitada automaticamente antes deste evento.
    // Você ainda pode processar a chamada aqui (ex: enviar mensagem, log, etc.)
    
    // Se autoRejectCalls estiver desativado, você pode rejeitar manualmente:
    // await call.reject();

    // Função auxiliar para tentar enviar mensagem com retry
    const trySendMessage = async (maxRetries: number = 3) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Verifica se o JID é válido (deve ser @s.whatsapp.net ou @g.us, não @lid)
        const isJIDValid = call.chat.id.includes('@s.whatsapp.net') || call.chat.id.includes('@g.us');
        
        if (isJIDValid) {
          try {
            await call.chat.send('Não aceitamos chamadas!');
            return true; // Sucesso
          } catch (error) {
            console.warn(`Tentativa ${attempt + 1} de enviar mensagem falhou:`, error);
            if (attempt < maxRetries - 1) {
              // Aguarda antes de tentar novamente (delay crescente)
              await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            }
          }
        } else {
          // JID ainda é LID, tenta normalizar aguardando o mapeamento
          if (attempt < maxRetries - 1) {
            console.info(`Aguardando mapeamento LID/PN... (tentativa ${attempt + 1}/${maxRetries})`);
            // Aguarda um pouco mais para o mapeamento ficar disponível
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            
            // Tenta atualizar o chat.id se o mapeamento estiver disponível agora
            // Nota: Isso não atualiza o objeto Call, mas podemos tentar enviar diretamente
            try {
              const normalizedChat = await client.bot.getChat(call.chat);
              if (normalizedChat && normalizedChat.id !== call.chat.id) {
                // Se conseguiu normalizar, tenta enviar com o novo JID
                const normalizedMessage = new Message(normalizedChat, 'Não aceitamos chamadas!');
                await client.send(normalizedMessage);
                return true;
              }
            } catch (error) {
              // Continua para próxima tentativa
            }
          }
        }
      }
      return false; // Falhou após todas as tentativas
    };

    // Tenta enviar mensagem (com retry automático)
    const success = await trySendMessage();
    
    if (!success) {
      console.warn(`Não foi possível enviar mensagem após ${3} tentativas. O mapeamento LID/PN pode não estar disponível ainda.`);
    }
  });
}

client.on('error', (err: any) => {
  console.info('Um erro ocorreu:', err);
});

(async () => {
  const commands = await Command.readCommands(`${__dirname}/commands`);

  client.setCommands(commands);

  client.commandController.config.prefix = '/';
  client.commandController.config.lowerCase = true;

  client.commandController.on(
    'no-allowed',
    async ({ message, command, permission }) => {
      if (permission.id == CMDPerms.BotChatAdmin) {
        await message.reply(
          'Eu preciso de permissão de admin para executar esse comando!',
        );
      }

      if (permission.id == CMDPerms.UserChatAdmin) {
        await message.reply('Somente admins podem usar esse comando!');
      }

      if (permission.id == CMDPerms.ChatGroup) {
        await message.chat.send('Somente grupos podem usar esse comando!');
      }
    },
  );

  const quickResponse1 = new QuickResponse(
    ['comprar', 'pedido', 'quero'],
    'Vamos fazer um pedido?',
  );

  const quickResponse2 = new QuickResponse(
    /vendem(.*?)\?/,
    'Vou estar conferindo...',
    { priority: 1 },
  );

  const quickResponse3 = new QuickResponse({
    patterns: ['hello', 'hi', /ola(.*?)!/],
    reply: 'Hello There!',
    priority: 2,
  });

  const quickResponse4 = new QuickResponse(
    (text, message) =>
      message.chat.type !== ChatType.Group && text.includes('hi'),
    (message) => `Hello ${message.chat.name}!`,
    { priority: 1 },
  );

  client.addQuickResponse(quickResponse1);
  client.addQuickResponse(quickResponse2);
  client.addQuickResponse(quickResponse3);
  client.addQuickResponse(quickResponse4);

  // Conecta baseado na configuração
  if (USE_TELEGRAM) {
    await client.connect(
      new TelegramAuth(
        TELEGRAM_BOT_TOKEN,
        './example/sessions/telegram',
      ),
    );
  } else {
    await client.connect('./example/sessions/whatsapp');
  }
})();
