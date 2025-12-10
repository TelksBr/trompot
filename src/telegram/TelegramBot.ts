import TelegramBotAPI from 'node-telegram-bot-api';

import IAuth from '../client/IAuth';

import ChatStatus from '../modules/chat/ChatStatus';
import ChatType from '../modules/chat/ChatType';
import Chat from '../modules/chat/Chat';
import User from '../modules/user/User';

import { BotStatus } from '../bot/BotStatus';
import BotEvents from '../bot/BotEvents';
import IBot from '../bot/IBot';

import ReactionMessage from '../messages/ReactionMessage';
import { Media } from '../messages/MediaMessage';
import Message from '../messages/Message';

import TelegramSendingController from './TelegramSendingController';
import { TelegramUtils } from './TelegramUtils';
import TelegramEvents from './TelegramEvents';
import TelegramAuth from './TelegramAuth';

import { verifyIsEquals } from '../utils/Generic';
import Call from '../models/Call';
import NodeCache from 'node-cache';

export default class TelegramBot extends BotEvents implements IBot {
  public auth: IAuth;
  public bot: TelegramBotAPI;
  public events: TelegramEvents;
  public options: Partial<TelegramBotAPI.ConstructorOptions>;
  private sendingController: TelegramSendingController;
  
  // Caches para melhorar desempenho
  private chatCache: NodeCache;
  private botInfoCache: NodeCache;

  public id: string = '';
  public status: BotStatus = BotStatus.Offline;
  public phoneNumber: string = '';
  public name: string = '';
  public profileUrl: string = '';

  constructor(options?: Partial<TelegramBotAPI.ConstructorOptions>) {
    super();

    this.options = { ...(options || {}) };

    this.auth = new TelegramAuth('', './sessions', false);
    this.bot = new TelegramBotAPI('', this.options);
    
    // Aumenta o limite de listeners no EventEmitter do bot para evitar warnings
    // O bot do TelegramBotAPI é um EventEmitter, então podemos chamar setMaxListeners
    if (typeof (this.bot as any).setMaxListeners === 'function') {
      (this.bot as any).setMaxListeners(20);
    }
    
    this.events = new TelegramEvents(this);
    
    // Cria instância única do controller de envio para reutilização
    this.sendingController = new TelegramSendingController(this);
    
    // Inicializa caches
    // Cache de chats: TTL de 5 minutos, máximo 1000 chats
    this.chatCache = new NodeCache({
      stdTTL: 300, // 5 minutos
      maxKeys: 1000,
      useClones: false,
      checkperiod: 60, // Verifica expiração a cada 1 minuto
    });
    
    // Cache de informações do bot: TTL de 1 hora (raramente muda)
    this.botInfoCache = new NodeCache({
      stdTTL: 3600, // 1 hora
      maxKeys: 1,
      useClones: false,
    });

    // Não configura eventos no construtor - será configurado no connect()
    // Isso evita adicionar listeners antes do bot estar pronto
  }

  public async connect(auth: string | IAuth): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        this.status = BotStatus.Offline;

        this.emit('connecting', {});

        // Remove listeners antigos antes de conectar (se já houver)
        this.events.cleanup();

        if (typeof auth == 'string') {
          auth = new TelegramAuth(auth, './sessions');
        }

        this.auth = auth;

        const botToken = await this.auth.get('BOT_TOKEN');

        (this.bot as any).token = botToken;
        (this.bot as any).options = {
          ...(this.bot as any).options,
          ...this.options,
        };

        this.bot.startPolling();

        // Reconfigura eventos após iniciar polling
        this.events.configAll();

        // Usa getBotInfo() que já tem cache
        const botInfo = await this.getBotInfo();

        this.id = `${botInfo.id}`;
        this.status = BotStatus.Online;
        this.name = TelegramUtils.getName(botInfo);
        this.phoneNumber = TelegramUtils.getPhoneNumber(this.id);
        this.profileUrl = await this.getBotProfileUrl();

        // Emite evento 'open' ANTES de resolver a Promise
        // Isso garante que listeners registrados antes do connect() recebam o evento
        this.emit('open', { isNewLogin: false });

        // Usa setImmediate para garantir que o evento seja processado antes de resolver
        setImmediate(() => {
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public async reconnect(alert?: boolean): Promise<void> {
    this.status = BotStatus.Offline;

    // Remove listeners antes de reconectar
    this.events.cleanup();

    try {
      await this.bot.close();
    } catch {}

    this.emit('reconnecting', {});

    // connect() já reconfigura os eventos, não precisa chamar configAll() aqui
    await this.connect(this.auth);
  }

  public async stop(reason: any): Promise<void> {
    this.status = BotStatus.Offline;

    // Remove listeners ao parar
    this.events.cleanup();
    
    // Limpa caches
    this.chatCache.flushAll();
    this.botInfoCache.flushAll();

    try {
      await this.bot.close();
    } catch {}

    this.emit('stop', { isLogout: false });
  }

  public async logout(): Promise<void> {
    this.status = BotStatus.Offline;

    try {
      await this.bot.logOut();
    } catch {}

    this.emit('stop', { isLogout: true });
  }

  public async send(message: Message): Promise<Message> {
    return await this.sendingController.send(message);
  }

  public async editMessage(message: Message): Promise<void> {
    await this.sendingController.sendEditedMessage(message);
  }

  public async addReaction(message: ReactionMessage): Promise<void> {
    await this.sendingController.sendReaction(message);
  }

  public async removeReaction(message: ReactionMessage): Promise<void> {
    await this.sendingController.sendReaction(message);
  }

  public async readMessage(message: Message): Promise<void> {
    //TODO: Read message
  }

  public async removeMessage(message: Message): Promise<void> {
    //TODO: Remove message
  }

  public async deleteMessage(message: Message): Promise<void> {
    await this.bot.deleteMessage(Number(message.chat.id), Number(message.id));
  }

  public async downloadStreamMessage(media: Media): Promise<Buffer> {
    if (
      !media?.stream ||
      typeof media.stream != 'object' ||
      !media.stream.file_id
    ) {
      return Buffer.from('');
    }

    const fileUrl = await this.bot.getFileLink(media.stream.file_id);

    return await TelegramUtils.downloadFileFromURL(fileUrl);
  }

  public async getBotName(): Promise<string> {
    const botInfo = await this.getBotInfo();
    return TelegramUtils.getName(botInfo);
  }
  
  /**
   * Obtém informações do bot com cache
   */
  private async getBotInfo(): Promise<TelegramBotAPI.User> {
    const cacheKey = 'bot_info';
    let botInfo = this.botInfoCache.get<TelegramBotAPI.User>(cacheKey);
    
    if (!botInfo) {
      botInfo = await this.bot.getMe();
      this.botInfoCache.set(cacheKey, botInfo);
    }
    
    return botInfo;
  }

  public async setBotName(name: string): Promise<void> {
    await this.setUserName(new User(this.id), name);
  }

  public async getBotDescription(): Promise<string> {
    return await this.getUserDescription(new User(this.id));
  }

  public async setBotDescription(description: string): Promise<void> {
    await this.setUserDescription(new User(this.id), description);
  }

  public async getBotProfile(lowQuality?: boolean): Promise<Buffer> {
    return await this.getUserProfile(new User(this.id));
  }

  public async getBotProfileUrl(lowQuality?: boolean): Promise<string> {
    return await this.getUserProfileUrl(new User(this.id));
  }

  public async setBotProfile(image: Buffer): Promise<void> {
    await this.setUserProfile(new User(this.id), image);
  }

  public async getChat(chat: Chat): Promise<Chat | null> {
    // Tenta obter do cache primeiro
    const cacheKey = `chat_${chat.id}`;
    const cachedChat = this.chatCache.get<Chat>(cacheKey);
    if (cachedChat) {
      return cachedChat;
    }

    const chatData = await this.auth.get(`chats-${chat.id}`);

    if (!chatData) return null;

    if (!chat.name || !chat.profileUrl) {
      const user = await this.getUser(new User(chat.id));

      if (user != null) {
        const result = Chat.fromJSON({ ...chat, ...user });
        this.chatCache.set(cacheKey, result);
        return result;
      }
    }

    const result = Chat.fromJSON(chatData);
    this.chatCache.set(cacheKey, result);
    return result;
  }

  public async getChats(): Promise<string[]> {
    return (await this.auth.listAll('chats-')).map((id) =>
      id.replace('chats-', ''),
    );
  }

  public async setChats(chats: Chat[]): Promise<void> {
    await Promise.all(chats.map(async (chat) => await this.updateChat(chat)));
  }

  public async updateChat(chat: { id: string } & Partial<Chat>): Promise<void> {
    const chatData = await this.getChat(new Chat(chat.id));

    if (chatData != null) {
      chat = Object.keys(chat).reduce(
        (data, key) => {
          if (chat[key] == undefined || chat[key] == null) return data;
          if (verifyIsEquals(chat[key], chatData[key])) return data;

          return { ...data, [key]: chat[key] };
        },
        { id: chat.id },
      );

      if (Object.keys(chat).length < 2) return;
    }

    const newChat = Chat.fromJSON({ ...(chatData || {}), ...chat });

    newChat.type = chat.id.length > 10 ? ChatType.Group : ChatType.PV;
    newChat.phoneNumber =
      newChat.phoneNumber || TelegramUtils.getPhoneNumber(chat.id);

    if (!newChat.profileUrl) {
      try {
        newChat.profileUrl = await this.getChatProfileUrl(newChat);
      } catch {}
    }

    await this.auth.set(`chats-${chat.id}`, newChat.toJSON());
    
    // Atualiza cache
    this.chatCache.set(`chat_${chat.id}`, newChat);
    this.chatCache.del(`tg_chat_${chat.id}`); // Invalida cache da API

    this.ev.emit('chat', { action: chatData != null ? 'update' : 'add', chat });
  }

  public async removeChat(chat: Chat): Promise<void> {
    await this.auth.remove(`chats-${chat.id}`);
    
    // Remove do cache
    this.chatCache.del(`chat_${chat.id}`);
    this.chatCache.del(`tg_chat_${chat.id}`);

    this.ev.emit('chat', { action: 'remove', chat });
  }

  public async createChat(chat: Chat): Promise<void> {
    //TODO: Create chat
  }

  public async leaveChat(chat: Chat): Promise<void> {
    await this.bot.leaveChat(Number(chat.id));
  }

  public async addUserInChat(chat: Chat, user: User): Promise<void> {
    await this.bot.unbanChatMember(Number(chat.id), Number(user.id));
  }

  public async removeUserInChat(chat: Chat, user: User): Promise<void> {
    await this.bot.banChatMember(Number(chat.id), Number(user.id));
  }

  public async promoteUserInChat(chat: Chat, user: User): Promise<void> {
    await this.bot.promoteChatMember(Number(chat.id), Number(user.id));
  }

  public async demoteUserInChat(chat: Chat, user: User): Promise<void> {
    //TODO: Demote user in chat
  }

  public async changeChatStatus(chat: Chat, status: ChatStatus): Promise<void> {
    //TODO: Change chat status
  }

  public async getChatUsers(chat: Chat): Promise<string[]> {
    return (await this.getChat(chat))?.users || [];
  }

  public async getChatAdmins(chat: Chat): Promise<string[]> {
    const members = await this.bot.getChatAdministrators(Number(chat.id));

    return members.map((member) => TelegramUtils.getId(member.user));
  }

  public async getChatLeader(chat: Chat): Promise<string> {
    const members = await this.bot.getChatAdministrators(Number(chat.id));

    return `${members.find((member) => member.status == 'creator') || ''}`;
  }

  /**
   * Obtém dados do chat da API do Telegram com cache
   */
  private async getTelegramChatData(chatId: number): Promise<TelegramBotAPI.Chat> {
    const cacheKey = `tg_chat_${chatId}`;
    let chatData = this.chatCache.get<TelegramBotAPI.Chat>(cacheKey);
    
    if (!chatData) {
      chatData = await this.bot.getChat(chatId);
      // Cache por 5 minutos
      this.chatCache.set(cacheKey, chatData, 300);
    }
    
    return chatData;
  }

  public async getChatName(chat: Chat): Promise<string> {
    const chatData = await this.getTelegramChatData(Number(chat.id));

    return `${chatData.title || ''}`;
  }

  public async setChatName(chat: Chat, name: string): Promise<void> {
    await this.bot.setChatTitle(Number(chat.id), `${name}`);
    // Invalida cache após atualização
    this.chatCache.del(`tg_chat_${chat.id}`);
    this.chatCache.del(`chat_${chat.id}`);
  }

  public async getChatDescription(chat: Chat): Promise<string> {
    const chatData = await this.getTelegramChatData(Number(chat.id));

    return `${chatData.description || chatData.bio || ''}`;
  }

  public async setChatDescription(
    chat: Chat,
    description: string,
  ): Promise<void> {
    await this.bot.setChatDescription(Number(chat.id), `${description || ''}`);
  }

  public async getChatProfile(
    chat: Chat,
    lowQuality?: boolean,
  ): Promise<Buffer> {
    const fileUrl = await this.getChatProfileUrl(chat, lowQuality);

    if (!fileUrl) {
      return Buffer.from('');
    }

    return await TelegramUtils.downloadFileFromURL(fileUrl);
  }

  public async getChatProfileUrl(
    chat: Chat,
    lowQuality?: boolean,
  ): Promise<string> {
    const chatData = await this.getTelegramChatData(Number(chat.id));

    const fileId = lowQuality
      ? chatData.photo?.small_file_id
      : chatData.photo?.big_file_id;

    if (!fileId) return '';

    return await this.bot.getFileLink(fileId);
  }

  public async setChatProfile(chat: Chat, profile: Buffer): Promise<void> {
    await this.bot.setChatPhoto(Number(chat.id), profile);
  }

  public async joinChat(code: string): Promise<void> {
    //TODO: Join chat
  }

  public async getChatInvite(chat: Chat): Promise<string> {
    return await this.bot.exportChatInviteLink(Number(chat.id));
  }

  public async revokeChatInvite(chat: Chat): Promise<string> {
    const result = await this.bot.revokeChatInviteLink(
      Number(chat.id),
      await this.getChatInvite(chat),
    );

    return result.invite_link;
  }

  public async rejectCall(call: Call): Promise<void> {
    //TODO: Reject call
  }

  public async getUser(user: User): Promise<User | null> {
    const userData = await this.auth.get(`users-${user.id}`);

    if (!userData) return null;

    return User.fromJSON(userData);
  }

  public async getUsers(): Promise<string[]> {
    return (await this.auth.listAll('users-')).map((id) =>
      id.replace('users-', ''),
    );
  }

  public async setUsers(users: User[]): Promise<void> {
    await Promise.all(users.map(async (user) => await this.updateUser(user)));
  }

  public async updateUser(user: { id: string } & Partial<User>): Promise<void> {
    const userData = await this.getUser(new User(user.id));

    if (userData != null) {
      user = Object.keys(user).reduce(
        (data, key) => {
          if (user[key] == undefined || user[key] == null) return data;
          if (verifyIsEquals(user[key], userData[key])) return data;

          return { ...data, [key]: user[key] };
        },
        { id: user.id },
      );

      if (Object.keys(user).length < 2) return;
    }

    const newUser = User.fromJSON({ ...(userData || {}), ...user });

    newUser.phoneNumber =
      newUser.phoneNumber || TelegramUtils.getPhoneNumber(user.id);

    if (!newUser.profileUrl) {
      try {
        newUser.profileUrl = await this.getUserProfileUrl(newUser);
      } catch {}
    }

    await this.auth.set(`users-${user.id}`, newUser.toJSON());
  }

  public async removeUser(user: User): Promise<void> {
    await this.auth.remove(`users-${user.id}`);
  }

  public async unblockUser(user: User): Promise<void> {
    //TODO: Unblock user
  }

  public async blockUser(user: User): Promise<void> {
    //TODO: Block user
  }

  public async getUserName(user: User): Promise<string> {
    const chat = await this.getTelegramChatData(Number(user.id));

    return `${chat.title || ''}`;
  }

  public async setUserName(user: User, name: string): Promise<void> {
    await this.bot.setChatTitle(Number(user.id), `${name || ''}`);
  }

  public async getUserDescription(user: User): Promise<string> {
    const chatData = await this.getTelegramChatData(Number(user.id));

    return `${chatData.description || chatData.bio || ''}`;
  }

  public async setUserDescription(
    user: User,
    description: string,
  ): Promise<void> {
    await this.bot.setChatDescription(Number(user.id), `${description || ''}`);
  }

  public async getUserProfile(
    user: User,
    lowQuality?: boolean,
  ): Promise<Buffer> {
    const fileUrl = await this.getUserProfileUrl(user, lowQuality);

    if (!fileUrl) {
      return Buffer.from('');
    }

    return await TelegramUtils.downloadFileFromURL(fileUrl);
  }

  public async getUserProfileUrl(
    user: User,
    lowQuality?: boolean,
  ): Promise<string> {
    const profile = await this.bot.getUserProfilePhotos(Number(user.id));

    const photo = profile.photos?.shift()?.shift();

    if (!photo) {
      return '';
    }

    return await this.bot.getFileLink(photo.file_id);
  }

  public async setUserProfile(user: User, profile: Buffer): Promise<void> {
    await this.bot.setChatPhoto(Number(user.id), profile);
  }
}
