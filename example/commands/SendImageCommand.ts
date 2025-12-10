import Client, { CMDKey, Command, ImageMessage, Message } from "../../src";

export class SendImageCommand extends Command {
  public onRead() {
    this.keys = [CMDKey("sendimage"), CMDKey("imagem")];
  }

  public async onExec(message: Message) {
    if (message.fromMe) return;

    const client = Client.getClient(this.clientId);

    try {
      // URL de uma imagem de teste
      // Você pode substituir por qualquer URL de imagem válida
      const imageUrl = "https://alfabeto.pt/wp-abc/wp-content/uploads/2020/07/imagem-001-letra-a-imprensa.png";

      // Baixa a imagem da URL
      let imageBuffer: Buffer;
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      } catch (fetchError) {
        throw new Error(`Erro ao baixar imagem: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      }

      // Cria mensagem de imagem usando Buffer
      const imageMessage = new ImageMessage(
        message.chat,
        "📸 Imagem de teste enviada com sucesso!\n\nUse /sendimage ou /imagem para testar o envio de imagens.",
        imageBuffer,
        {
          mimetype: "image/png",
          name: "test-image.png",
        }
      );

      // Envia a imagem
      await client.send(imageMessage);
      
      console.log(`[SendImageCommand] Imagem enviada por ${message.user.id} no chat ${message.chat.id}`);
    } catch (error) {
      console.error("[SendImageCommand] Erro ao enviar imagem:", error);
      
      // Tenta enviar uma mensagem de erro
      try {
        await client.sendMessage(
          message.chat,
          "❌ Erro ao enviar imagem. Verifique os logs.\n\nErro: " + (error instanceof Error ? error.message : String(error)),
          message
        );
      } catch (err) {
        // Ignora erro ao enviar mensagem de erro
      }
    }
  }
}

