import TelegramBotAPI from "node-telegram-bot-api";

import Chat from "../modules/chat/Chat";
import User from "../modules/user/User";

import TelegramToRompotConverter from "./TelegramToRompotConverter";
import { TelegramUtils } from "./TelegramUtils";
import TelegramBot from "./TelegramBot";

export default class TelegramEvents {
  public telegram: TelegramBot;
  private messageHandler?: (msg: TelegramBotAPI.Message) => Promise<void>;
  private newChatMembersHandler?: (msg: TelegramBotAPI.Message) => Promise<void>;
  private leftChatMemberHandler?: (msg: TelegramBotAPI.Message) => Promise<void>;

  constructor(telegram: TelegramBot) {
    this.telegram = telegram;
  }

  /**
   * Remove todos os listeners registrados
   */
  public cleanup(): void {
    if (this.messageHandler) {
      this.telegram.bot.removeListener("message", this.messageHandler);
      this.telegram.bot.removeListener("edited_message", this.messageHandler);
      this.messageHandler = undefined;
    }

    if (this.newChatMembersHandler) {
      this.telegram.bot.removeListener("new_chat_members", this.newChatMembersHandler);
      this.newChatMembersHandler = undefined;
    }

    if (this.leftChatMemberHandler) {
      this.telegram.bot.removeListener("left_chat_member", this.leftChatMemberHandler);
      this.leftChatMemberHandler = undefined;
    }
  }

  public configAll() {
    // Remove listeners antigos antes de adicionar novos
    this.cleanup();
    
    // Nota: setMaxListeners já é chamado no construtor do TelegramBot
    // Não precisa ser chamado aqui novamente
    
    this.configMessage();
    this.configNewChatMembers();
    this.configLeftChatMember();
  }

  public configMessage() {
    const receievMessage = async (msg: TelegramBotAPI.Message) => {
      if (msg?.new_chat_members) return;
      if (msg?.left_chat_member) return;

      const converter = new TelegramToRompotConverter(msg);

      const rompotMessage = await converter.convert(true);

      await this.update(rompotMessage.user);
      await this.update(rompotMessage.chat);

      this.telegram.emit("message", rompotMessage);
    };

    // Armazena referência para poder remover depois
    this.messageHandler = receievMessage;
    
    this.telegram.bot.on("message", receievMessage);
    this.telegram.bot.on("edited_message", receievMessage);
  }

  public configNewChatMembers() {
    const handler = async (msg: TelegramBotAPI.Message) => {
      const converter = new TelegramToRompotConverter(msg);

      const rompotMessage = await converter.convert(true);

      // Processa membros em paralelo para melhor desempenho
      const members = msg.new_chat_members || [];
      if (members.length > 0) {
        await Promise.all(members.map(async (member) => {
          const userId: string = TelegramUtils.getId(member);

          const user = User.fromJSON({
            ...((await this.telegram.getUser(new User(userId))) || {}),
            id: userId,
            name: TelegramUtils.getName(member),
            nickname: TelegramUtils.getNickname(member),
            phoneNumber: TelegramUtils.getPhoneNumber(userId),
          });

          await this.updateChatUsers("add", rompotMessage.chat, user);

          await this.update(user);
          
          if (rompotMessage.user.id == user.id) {
            this.telegram.emit("user", { action: "join", event: "add", user, chat: rompotMessage.chat, fromUser: rompotMessage.user });
          } else {
            this.telegram.emit("user", { action: "add", event: "add", user, chat: rompotMessage.chat, fromUser: rompotMessage.user });
          }
        }));
        
        // Atualiza chat e usuário da mensagem após processar todos os membros
        await this.update(rompotMessage.user);
        await this.update(rompotMessage.chat);
      }
    };

    // Armazena referência para poder remover depois
    this.newChatMembersHandler = handler;
    
    this.telegram.bot.on("new_chat_members", handler);
  }

  public configLeftChatMember() {
    const handler = async (msg: TelegramBotAPI.Message) => {
      const converter = new TelegramToRompotConverter(msg);

      const rompotMessage = await converter.convert(true);

      const userId: string = TelegramUtils.getId(msg.left_chat_member!);

      const user = User.fromJSON({
        ...((await this.telegram.getUser(new User(userId))) || {}),
        id: userId,
        name: TelegramUtils.getName(msg.left_chat_member!),
        nickname: TelegramUtils.getNickname(msg.left_chat_member!),
        phoneNumber: TelegramUtils.getPhoneNumber(userId),
      });

      await this.update(user);
      await this.update(rompotMessage.user);
      await this.update(rompotMessage.chat);

      await this.updateChatUsers("remove", rompotMessage.chat, user);

      if (rompotMessage.user.id == user.id) {
        this.telegram.emit("user", { action: "leave", event: "remove", user, chat: rompotMessage.chat, fromUser: rompotMessage.user });
      } else {
        this.telegram.emit("user", { action: "remove", event: "remove", user, chat: rompotMessage.chat, fromUser: rompotMessage.user });
      }
    };

    // Armazena referência para poder remover depois
    this.leftChatMemberHandler = handler;
    
    this.telegram.bot.on("left_chat_member", handler);
  }

  public async update(data: User | Chat) {
    try {
      if (!data) return;

      if (data instanceof User) {
        return await this.telegram.updateUser(data);
      }

      if (data instanceof Chat) {
        return await this.telegram.updateChat(data);
      }
    } catch (error) {
      this.telegram.emit("error", error);
    }
  }

  public async updateChatUsers(action: "add" | "remove", chat: Chat, ...usersToUpdate: User[]) {
    try {
      chat = Chat.fromJSON({
        ...((await this.telegram.getChat(chat)) || {}),
        ...chat,
      });

      
      if (action == "add") {
        const currentUsers = chat.users || [];
        const newUserIds = usersToUpdate.map((user) => user.id);
        
        // Adiciona apenas usuários que ainda não estão na lista
        const usersToAdd = newUserIds.filter((userId) => !currentUsers.includes(userId));

        if (usersToAdd.length == 0) return;

        chat.users = [...currentUsers, ...usersToAdd];

        await this.update(chat);
      } else if (action == "remove") {
        const userIdsToRemove = usersToUpdate.map((user) => user.id);

        if (userIdsToRemove.includes(this.telegram.id)) {
          await this.telegram.removeChat(chat);
        } else {
          const currentUsers = chat.users || [];

          chat.users = currentUsers.filter((userId) => !userIdsToRemove.includes(userId));

          await this.update(chat);
        }
      }
    } catch (error) {
      this.telegram.emit("error", error);
    }
  }
}
