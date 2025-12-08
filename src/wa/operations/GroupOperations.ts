import { isJidGroup, proto } from '@whiskeysockets/baileys';
import Chat from '../../modules/chat/Chat';
import User from '../../modules/user/User';
import { UserAction, UserEvent } from '../../modules/user';
import { getPhoneNumber } from '../ID';
import { Validation } from '../utils/Validation';
import WhatsAppBot from '../WhatsAppBot';
import ChatType from '../../modules/chat/ChatType';

/**
 * Operações relacionadas a grupos
 */
export class GroupOperations {
  private bot: WhatsAppBot;

  constructor(bot: WhatsAppBot) {
    this.bot = bot;
  }

  /**
   * Adiciona um usuário a um grupo
   */
  async addUserInChat(chat: Chat, user: User): Promise<void> {
    if (!isJidGroup(chat.id)) return;

    const admins = await this.bot.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) return;

    await this.bot.sock.groupParticipantsUpdate(chat.id, [user.id], 'add');
  }

  /**
   * Remove um usuário de um grupo
   */
  async removeUserInChat(chat: Chat, user: User): Promise<void> {
    // Validações
    Validation.ensureConnected(this.bot.status, this.bot.sock);
    Validation.ensureValidJID(chat.id, 'chat.id');
    Validation.ensureValidJID(user.id, 'user.id');
    
    if (!isJidGroup(chat.id)) {
      throw new Error('removeUserInChat só pode ser usado em grupos');
    }

    const admins = await this.bot.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) {
      throw new Error('Apenas administradores podem remover usuários do grupo');
    }

    await this.bot.sock.groupParticipantsUpdate(chat.id, [user.id], 'remove');
  }

  /**
   * Promove um usuário a administrador
   */
  async promoteUserInChat(chat: Chat, user: User): Promise<void> {
    // Validações
    Validation.ensureConnected(this.bot.status, this.bot.sock);
    Validation.ensureValidJID(chat.id, 'chat.id');
    Validation.ensureValidJID(user.id, 'user.id');
    
    if (!isJidGroup(chat.id)) {
      throw new Error('promoteUserInChat só pode ser usado em grupos');
    }

    const admins = await this.bot.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) {
      throw new Error('Apenas administradores podem promover usuários');
    }

    await this.bot.sock.groupParticipantsUpdate(chat.id, [user.id], 'promote');
  }

  /**
   * Remove privilégios de administrador de um usuário
   */
  async demoteUserInChat(chat: Chat, user: User): Promise<void> {
    // Validações
    Validation.ensureConnected(this.bot.status, this.bot.sock);
    Validation.ensureValidJID(chat.id, 'chat.id');
    Validation.ensureValidJID(user.id, 'user.id');
    
    if (!isJidGroup(chat.id)) {
      throw new Error('demoteUserInChat só pode ser usado em grupos');
    }

    const admins = await this.bot.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) {
      throw new Error('Apenas administradores podem rebaixar usuários');
    }

    await this.bot.sock.groupParticipantsUpdate(chat.id, [user.id], 'demote');
  }

  /**
   * Trata atualizações de participantes do grupo
   */
  async groupParticipantsUpdate(
    action: UserAction,
    chatId: string,
    userId: string,
    fromId: string,
  ): Promise<void> {
    if (!chatId.includes('@g')) return;

    const event: UserEvent =
      action === 'join' ? 'add' : action === 'leave' ? 'remove' : action;

    let chat = await this.bot.getChat(new Chat(chatId));

    if (!chat) {
      if (!this.bot.config.autoLoadGroupInfo) return;

      chat = Chat.fromJSON({
        id: chatId,
        phoneNumber: getPhoneNumber(chatId),
        type: ChatType.Group,
      });
    }

    const fromUser =
      (await this.bot.getUser(new User(fromId))) ||
      User.fromJSON({ id: fromId, phoneNumber: getPhoneNumber(fromId) });
    const user =
      (await this.bot.getUser(new User(userId))) ||
      User.fromJSON({ id: userId, phoneNumber: getPhoneNumber(userId) });

    let users = chat.users || [];
    const admins = chat.admins || [];

    if (event === 'add') users.push(user.id);
    if (event === 'remove') users = users.filter((u) => u !== user.id);
    if (event === 'demote')
      chat.admins = admins.filter((admin) => admin !== user.id);
    if (event === 'promote') admins.push(user.id);

    chat.users = users;
    chat.admins = admins;

    if (user.id === this.bot.id) {
      if (event === 'remove') await this.bot.removeChat(chat);
      if (event === 'add') await this.bot.updateChat(chat);
    } else {
      await this.bot.updateChat(chat);
    }

    this.bot.ev.emit('user', { action, event, user, fromUser, chat });
  }
}

