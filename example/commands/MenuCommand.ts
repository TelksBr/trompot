import Client, { CMDKey, Command, Message } from "../../src";

export class MenuCommand extends Command {
  public onRead() {
    this.keys = [CMDKey("menu")];
  }

  public async onExec(message: Message) {
    if (message.fromMe) return;

    const client = Client.getClient(this.clientId);

    const menuText = `
📋 *MENU DO BOT*

✅ Comandos disponíveis:
• /menu - Mostra este menu
• /hello - Comando de teste
• /poll - Criar uma enquete
• /sendimage ou /imagem - Envia uma imagem de teste

🤖 Bot funcionando corretamente!
    `.trim();

    await client.sendMessage(message.chat, menuText, message);
    
    console.log(`[MenuCommand] Comando /menu executado por ${message.user.id} no chat ${message.chat.id}`);
  }
}

