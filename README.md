
# trompot

Uma biblioteca para desenvolvimento de ChatBot multi-plataforma em JavaScript/TypeScript

Fork do projeto Rompot. Este repositório é mantido por TelksBr: https://github.com/TelksBr/trompot

## 🛠 Recursos

- [x] Simples uso
- [x] Criação de comandos
- [x] Resposta rápida
- [x] Tratamento de solicitações
- [x] Tratamento de conexão
- [x] Alta personalização
- [x] Suporte a Cluster (Beta)

| Plataformas            | Whatsapp | Telegram (Beta) |
| ----------------------- | -------- | --------------- |
| Recebimento de mensagem | ✅       | ✅              |
| Envio de texto          | ✅       | ✅              |
| Envio de mídia          | ✅       | ✅              |
| Envio de stickers       | ✅       | ✅              |
| Envio de lista          | ❌       | ❌              |
| Envio de botão          | ❌       | ✅              |
| Envio de enquete        | ✅       | ✅              |
| Criação de chats        | ✅       | 🔧              |
| Histórico de mensagens  | ✅       | ❌              |

### 🔧 Instalação

Instalando pacote

```sh
npm i trompot
```

Importando pacote

```ts
// TypeScript
import Client, { WhatsAppBot, TelegramBot } from "trompot";

// Javascript
const { Client, WhatsAppBot, TelegramBot } = require("trompot");
```

## WhatsApp

### Conexão e Reconexão Automática

O trompot gerencia automaticamente a reconexão com sessões existentes. Se você já autenticou uma vez, não precisará escanear o QR code novamente.

**IMPORTANTE:** Use sempre o **mesmo caminho de sessão** para que a reconexão automática funcione.

```ts
import Client, { WhatsAppBot } from "trompot";

const client = new Client(new WhatsAppBot());

// Use sempre o mesmo caminho de sessão
const SESSION_PATH = "./whatsapp-session";

// Escuta o QR code (só será emitido se não houver sessão válida)
client.on("qr", async (qr) => {
  try {
    const QRCode = (await import("qrcode")).default;
    console.log("Escaneie o QR code com seu WhatsApp:");
    console.log(await QRCode.toString(qr, { type: "terminal" }));
  } catch (err) {
    console.log("QR Code:", qr);
  }
});

// Escuta quando conecta (pode ser reconexão automática ou novo login)
client.on("open", (update) => {
  if (update.isNewLogin) {
    console.log("✅ Novo login realizado!");
  } else {
    console.log("✅ Reconectado automaticamente com sessão existente!");
  }
});

// Conecta - se já houver sessão válida, reconecta automaticamente sem QR code
await client.connect(SESSION_PATH);
```

### Como Funciona a Reconexão Automática

1. **Primeira vez**: Quando não há sessão, o Baileys gera um QR code. Escaneie com seu WhatsApp.
2. **Próximas vezes**: Se a sessão estiver válida (`registered: true` no `creds.json`), o Baileys reconecta automaticamente **sem gerar QR code**.
3. **Sessão expirada**: Se a sessão expirar ou for inválida, um novo QR code será gerado automaticamente.

### Dicas Importantes

- ✅ **Use sempre o mesmo caminho de sessão** para manter a sessão
- ✅ **Não delete a pasta de sessão** se quiser reconectar automaticamente
- ✅ **O QR code só aparece** quando não há sessão válida ou quando a sessão expira
- ❌ **Não mude o caminho de sessão** entre conexões se quiser reconexão automática


## Telegram (Beta)

Altere o valor `BOT_TOKEN` para o token do seu bot para se conectar a ele, acaso não tenha consulte a documentação do [Telegram](https://core.telegram.org/bots/api) para gerar um.

```ts
const client = new Client(new TelegramBot());
client.connect("BOT_TOKEN");

client.on("open", () => {
  console.log("Bot conectado!");
});
```

## Configurações

```ts
type ConnectionConfig = {
  /** Desativa execução do comando automático */
  disableAutoCommand: boolean;
  /** Desativa os comandos para mensagem antiga */
  disableAutoCommandForOldMessage: boolean;
  /** Desativa a execução do comando automático para mensagens não oficiais */
  disableAutoCommandForUnofficialMessage: boolean;
  /** Desativa a digitação automatica */
  disableAutoTyping: boolean;
  /** Desativa a leitura automatica de uma mensagem */
  disableAutoRead: boolean;
  /** Máximo de reconexões possíveis */
  maxReconnectTimes: number;
  /** Tempo de aguarde para se reconectar */
  reconnectTimeout: number;
  /** Máximo de tentativas de solitação acaso a primeira falhe */
  maxRequests: number;
  /** Tempo necessário de aguardo para próxima tentativa de solicitação */
  requestsDelay: number;
  /** Tempo máximo de espera */
  maxTimeout: number;
};

client.config = config;
```

## ⚙️ Criando comandos

```ts
import { CMDKey, Command, Message } from "trompot";

// Cria um comando com o nome hello
// Ao ser executado envia a mensagem "Hello World!"
class HelloCommand extends Command {
  public onRead() {
    this.keys = [CMDKey("hello")];
  }

  public async onExec(message: Message) {
    await message.reply(`Hello World!`);
  }
}

// Listando comandos
const commands = [new HelloCommand(), new DateCommand()];

client.setCommands(commands);
```

## Eventos

### Conexão

```ts
client.on("open", (open) => {
  console.log("Cliente conectado!");
});

client.on("close", (update) => {
  console.info(`Cliente desconectou! Motivo: ${update.reason}`);
});

client.on("stop", (update) => {
  if (update.isLogout) {
    console.info(`Cliente desligado!`);
  } else {
    console.info(`Cliente parado!`);
  }
});

client.on("connecting", (conn) => {
  console.log("Conectando cliente...");
});

client.on("reconnecting", (conn) => {
  console.log("Reconectando cliente...");
});
```

### Mensagem

```ts
client.on("message", (message) => {
  console.log(`Mensagem recebida de "${message.user.name}"`);

  if (message.text == "Oi") {
    message.reply("Olá");
  }
});
```

### Usuários

```ts
client.on("user", async (update) => {
  if (update.action == "join") {
    await client.send(new Message(update.chat, `@${update.fromUser.id} entrou no grupo.`));
  }

  if (update.action == "leave") {
    await client.send(new Message(update.chat, `@${update.fromUser.id} saiu do grupo...`));
  }

  if (update.action == "add") {
    await client.send(new Message(update.chat, `Membro @${update.fromUser.id} adicionou o @${update.user.id} ao grupo!`));
  }

  if (update.action == "remove") {
    client.send(new Message(update.chat, `Membro @${update.fromUser.id} removeu o @${update.user.id} do grupo.`));
  }

  if (update.action == "promote") {
    client.send(new Message(update.chat, `Membro @${update.fromUser.id} promoveu o @${update.user.id} para admin!`));
  }

  if (update.action == "demote") {
    await client.send(new Message(update.chat, `Membro @${update.fromUser.id} removeu o admin do @${update.user.id}.`));
  }
});
```

### Erro interno

```ts
client.on("error", (err) => {
  console.error(`Um erro ocorreu: ${err}`);
});
```

## Mensagem

```ts
import { Message } from "trompot";

// Chat
const chat = new Chat("id12345");

// Criar mensagem
const msg = new Message(chat, "texto");

// Enviar mensagem
const saveMsg = await client.send(msg);

// Edita uma mensagem enviada
await client.editMessage(saveMsg, "novo texto");

// Mencionar usuário
msg.mentions.push("userId");

// Marcar mensagem
msg.mention = message;

// Responder mensagem
msg.reply(message);

// Visualiza uma mensagem recebida
msg.read();

// Reage a mensagem
msg.addReaction("❤");

// Remove a reação de uma mensagem
msg.removeReaction();
```

## Mensagem de mídia

```ts
import { ImageMessage, VideoMessage, AudioMessage, FileMessage, StickerMessage } from "trompot";

// Criar mensagem de audio
const audioMessage = new AudioMessage(chat, Buffer.from(""));

// Criar mensagem com imagem
const imageMessage = new ImageMessage(chat, "texto", Buffer.from(""));

// Criar mensagem com video
const videoMessage = new VideoMessage(chat, "texto", Buffer.from(""));

// Criar mensagem de arquivo
const fileMessage = new FileMessage(chat, "texto", Buffer.from(""));

// Criar mensagem de sticker
const stickerMessage = new StickerMessage(chat, Buffer.from(""));
```

## Outros tipos de mensagem

```ts
import { LocationMessage, ContactMessage, ButtonMessage, ListMessage, PollMessage } from "trompot";

// Criar mensagem de localiação
// Latitude, Longitude
const locationMessage = new LocationMessage(chat, 24.121231, 55.1121221);

// Obter dados do endereço da localização
const address = await locationMessage.getAddress();

// Criar mensagem com contatos
const contactMessage = new ContactMessage(chat, "nome", "userId");

// Criando botões
const btnMessage = new ButtonMessage(chat, "texto", "rodapé");
btnMessage.addCall("Call", "1234567890");
btnMessage.addUrl("Link", "https://example.com");
btnMessage.addReply("Texto", "button-id-123");

// Criar lista
const listMessage = new ListMessage(chat, "texto", "botão", "titulo", "rodapé");
const index1 = listMessage.addCategory("Categoria 1");
const index2 = listMessage.addCategory("Categoria 2");

listMessage.addItem(index1, "Item 1");
listMessage.addItem(index1, "Item 2");

listMessage.addItem(index2, "Abc 1");
listMessage.addItem(index2, "Abc 2");

// Criar enquete
const pollMessage = new PollMessage(chat, "Hello World!");

pollMessage.addOption("Hello", "id-hello-123");
pollMessage.addOption("Hey", "id-hey-123");
pollMessage.addOption("Hi", "id-hi-123");
```

## Mensagem personalizada

```ts
import { CustomMessage } from "trompot";

// Ex: conteúdo para baileys
const content = { text: "texto" }; 

// O conteúdo inserido será enviado diretamente para a plataforma
const customMessage = new CustomMessage(chat, content);

// Adicionando opções adicionais
// Essas alterações serão tratadas pelo processamento da plataforma

//? Na baileys utiliza o relayMessage invés de sendMessage
customMessage.extra = { isRelay: true }; 
```

## Lendo resposas de ButtonMessage, ListMessage e PollMessage

```ts
import { Command, Message, CMDKey, CMDRunType, isPollMessage } from "trompot";

class ButtonCommand extends Command {
  public onRead() {
    this.keys = [CMDKey("cmd-button")];
  }

  // Recebe uma resposta ao comando
  public async onReply(message: Message) {
    await message.reply(`Button Clicked!`);
  }
}

client.addCommand(new ButtonCommand());

client.on("message", async (message: Message) => {
  if (isPollMessage(message)) {
    // Não responde caso a votação da enquete for removida
    if (message.action == "remove") return;
  }

  // Verifica o ID passado na mensagem como opção
  if (message.selected == "button-id-123") {
    const cmd = client.getCommand("cmd-button");

    // Manda a resposta ao comando
    if (cmd) client.runCommand(cmd, message, CMDRunType.Reply);
  }
}):
```

## Bot

- Definir foto de perfil

```ts
client.setBotProfile(Buffer.from(""));
```

- Obter foto de perfil do bot

```ts
client.getBotProfile();
```

- Definir nome do bot

```ts
client.setBotName("Name");
```

- Definir descrição do bot

```ts
client.setBotDescription("Description");
```

- Obter descrição do bot

```ts
client.getBotDescription();
```

## Grupo

Você pode obter o chat em `message.chat` ou `client.getChat("id")`, o ID pode ser encontrado em `message.chat.id`

- Criar grupo

```ts
client.createChat("name");
```

- Sair de um grupo

```ts
client.leaveChat(chat);
```

- Definir imagem do grupo

```ts
client.setChatProfile(chat, Buffer.from(""));
```

- Obter imagem do grupo

```ts
client.getChatProfile(chat);
```

- Definir nome do grupo

```ts
client.setChatName(chat, "Name chat");
```

- Obter nome do grupo

```ts
client.getChatName(chat);
```

- Definir a descrição do grupo

```ts
client.setChatDescription(chat, "Chat description");
```

- Obter descrição do grupo

```ts
client.getChatDescription(chat);
```

- Adicionar membro
  - Você pode encontrar o user em `message.user`, o ID pode se encontrado em `message.user.id`

```ts
client.addUserInChat(chat, user);
```

- Remover membro

```ts
client.removeUserInChat(chat, user);
```

- Promover membro

```ts
client.promoteUserInChat(chat, user);
```

- Despromover membro

```ts
client.demoteUserInChat(chat, user);
```

- Rejeitar chamada
  - Você pode receber a chamada pelo evento `new-call` ou `call`, porém o evento `call` também recebe atualização de chamadas invez de somente o pedido dela.
```ts
client.rejectCall(call);
```

## Utilitários de Estado do App e Recursos de Negócio (WhatsAppBot)

A partir da versão mais recente, o WhatsAppBot oferece métodos utilitários para manipular o estado dos chats e acessar recursos de negócio do WhatsApp Business. Veja exemplos abaixo:

### App State Updates

- **Arquivar um chat**

```ts
// Arquiva um chat
await client.bot.archiveChat(chat, true, lastMessages);
```

- **Silenciar um chat**

```ts
// Silencia um chat por 1 hora (em segundos)
await client.bot.muteChat(chat, 3600, lastMessages);
// Para remover o silêncio:
await client.bot.muteChat(chat, null, lastMessages);
```

- **Marcar chat como lido**

```ts
// Marca o chat como lido
await client.bot.markChatRead(chat, true, lastMessages);
```

- **Ativar mensagens temporárias**

```ts
// Define o chat para mensagens temporárias (em segundos)
await client.bot.setDisappearingMessages(chat, 86400); // 24 horas
```

> **Nota:** O parâmetro `lastMessages` é obrigatório e deve ser um array com as últimas mensagens do chat, conforme exigido pela API do Baileys.

### Business Features

- **Obter perfil de negócio**

```ts
// Busca o perfil de negócio de um usuário ou grupo
const profile = await client.bot.fetchBusinessProfile(chat.id);
console.log(profile);
```

> **Nota:** O método `fetchBusinessProducts` foi removido pois não está disponível na API pública do Baileys.

---
O envio de botões interativos é suportado no Telegram usando o tipo `ButtonMessage`. Veja um exemplo:

```ts
import { ButtonMessage } from "trompot";

const chat = new Chat("id_do_chat");
const btnMsg = new ButtonMessage(chat, "Escolha uma opção:", "Rodapé opcional");

btnMsg.addReply("Botão 1", "resposta_1");
btnMsg.addUrl("Site", "https://exemplo.com");
btnMsg.addCall("Ligar", "5511999999999");

await client.send(btnMsg);
```

- Botões do tipo `Reply` são enviados como botões de callback.
- Botões do tipo `Url` abrem um link.
- Botões do tipo `Call` abrem o discador do telefone (se suportado pelo Telegram).

O recebimento do clique em botões de callback pode ser tratado usando os eventos do Telegram.