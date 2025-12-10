import { isJidGroup, GroupMetadata, Chat as BaileysChat, proto } from '@whiskeysockets/baileys';
import Chat from '../../modules/chat/Chat';
import ChatType from '../../modules/chat/ChatType';
import ChatStatus from '../../modules/chat/ChatStatus';
import User from '../../modules/user/User';
import { WAStatus } from '../WAStatus';
import { getImageURL, verifyIsEquals } from '../../utils/Generic';
import { getPhoneNumber } from '../ID';
import { Validation } from '../utils/Validation';
import { isValidJID } from '../constants/JIDPatterns';
import { TIMESTAMP_MULTIPLIER } from '../constants/ConfigDefaults';
import Long from 'long';
import WhatsAppBot from '../WhatsAppBot';

/**
 * Operações relacionadas a chats
 */
export class ChatOperations {
  private bot: WhatsAppBot;

  constructor(bot: WhatsAppBot) {
    this.bot = bot;
  }

  /**
   * Obtém o nome de um chat
   */
  async getChatName(chat: Chat): Promise<string> {
    return (await this.bot.getChat(chat))?.name || '';
  }

  /**
   * Define o nome de um chat (apenas grupos)
   */
  async setChatName(chat: Chat, name: string): Promise<void> {
    if (!isJidGroup(chat.id)) return;

    const admins = await this.bot.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) return;

    await this.bot.sock.groupUpdateSubject(chat.id, name);
  }

  /**
   * Obtém a descrição de um chat
   */
  async getChatDescription(chat: Chat): Promise<string> {
    return (await this.bot.getChat(chat))?.description || '';
  }

  /**
   * Define a descrição de um chat (apenas grupos, apenas admins)
   */
  async setChatDescription(chat: Chat, description: string): Promise<void> {
    // Validações
    Validation.ensureConnected(this.bot.status, this.bot.sock);
    Validation.ensureValidJID(chat.id, 'chat.id');
    
    if (!isJidGroup(chat.id)) {
      throw new Error('setChatDescription só pode ser usado em grupos');
    }

    const admins = await this.bot.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) {
      throw new Error('Apenas administradores podem alterar a descrição do grupo');
    }

    await this.bot.sock.groupUpdateDescription(chat.id, description);
  }

  /**
   * Obtém a foto de perfil de um chat
   */
  async getChatProfile(chat: Chat, lowQuality?: boolean): Promise<Buffer> {
    const uri = await this.getChatProfileUrl(chat, lowQuality);
    return await getImageURL(uri);
  }

  /**
   * Obtém a URL da foto de perfil de um chat
   */
  async getChatProfileUrl(chat: Chat, lowQuality?: boolean): Promise<string> {
    try {
      return (
        (await this.bot.sock.profilePictureUrl(
          chat.id,
          lowQuality ? 'preview' : 'image',
        )) || ''
      );
    } catch {
      return '';
    }
  }

  /**
   * Define a foto de perfil de um chat (apenas grupos, apenas admins)
   */
  async setChatProfile(chat: Chat, image: Buffer): Promise<void> {
    if (!isJidGroup(chat.id)) return;

    const admins = await this.bot.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) return;

    await this.bot.sock.updateProfilePicture(chat.id, image);
  }

  /**
   * Atualiza informações de um chat
   */
  async updateChat(chat: { id: string } & Partial<Chat>): Promise<void> {
    const chatData = await this.bot.getChat(new Chat(chat.id));

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

    newChat.type = isJidGroup(chat.id) ? ChatType.Group : ChatType.PV;
    newChat.phoneNumber = newChat.phoneNumber || getPhoneNumber(chat.id);

    await this.bot.auth.set(`chats-${chat.id}`, newChat.toJSON());

    this.bot.ev.emit('chat', { action: chatData != null ? 'update' : 'add', chat });
  }

  /**
   * Remove um chat
   */
  async removeChat(chat: Chat): Promise<void> {
    await this.bot.auth.remove(`chats-${chat.id}`);
    this.bot.ev.emit('chat', { action: 'remove', chat });
  }

  /**
   * Obtém um chat
   */
  async getChat(chat: Chat): Promise<Chat | null> {
    const chatData = await this.bot.auth.get(`chats-${chat.id}`);

    if (!chatData) return null;

    if (!chat.name || !chat.profileUrl) {
      const user = await this.bot.getUser(new User(chat.id));

      if (user != null) {
        return Chat.fromJSON({ ...chat, ...user });
      }
    }

    return Chat.fromJSON(chatData);
  }

  /**
   * Obtém lista de IDs de chats
   */
  async getChats(): Promise<string[]> {
    return (await this.bot.auth.listAll('chats-')).map((id) =>
      id.replace('chats-', ''),
    );
  }

  /**
   * Define múltiplos chats
   */
  async setChats(chats: Chat[]): Promise<void> {
    await Promise.all(chats.map(async (chat) => await this.updateChat(chat)));
  }

  /**
   * Obtém lista de usuários de um chat
   */
  async getChatUsers(chat: Chat): Promise<string[]> {
    return (await this.bot.getChat(chat))?.users || [];
  }

  /**
   * Obtém lista de administradores de um chat
   */
  async getChatAdmins(chat: Chat): Promise<string[]> {
    const chatReaded = await this.bot.getChat(chat);

    if (!chatReaded) return [];

    if (chatReaded.admins?.length) {
      return chatReaded.admins || [];
    }

    if (chatReaded.type !== ChatType.Group) return [];

    await this.readChat(chat);

    return (await this.bot.getChat(chat))?.admins || [];
  }

  /**
   * Obtém o líder de um chat
   */
  async getChatLeader(chat: Chat): Promise<string> {
    return (await this.bot.getChat(chat))?.leader || '';
  }

  /**
   * Altera o status de um chat
   */
  async changeChatStatus(chat: Chat, status: ChatStatus): Promise<void> {
    await this.bot.sock.sendPresenceUpdate(
      WAStatus[status] || 'available',
      chat.id,
    );
  }

  /**
   * Cria um novo chat (grupo)
   */
  async createChat(chat: Chat): Promise<void> {
    await this.bot.sock.groupCreate(chat.name || '', [this.bot.id]);
  }

  /**
   * Sai de um chat
   */
  async leaveChat(chat: Chat): Promise<void> {
    if (!isJidGroup(chat.id)) return;

    if ((await this.bot.getChat(chat)) == null) return;

    await this.bot.sock.groupLeave(chat.id);
    await this.removeChat(chat);
  }

  /**
   * Entra em um chat através de código de convite
   */
  async joinChat(code: string): Promise<void> {
    await this.bot.sock.groupAcceptInvite(
      code.replace('https://chat.whatsapp.com/', ''),
    );
  }

  /**
   * Obtém código de convite de um chat
   */
  async getChatInvite(chat: Chat): Promise<string> {
    if (!isJidGroup(chat.id)) return '';

    const admins = await this.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) return '';

    return (await this.bot.sock.groupInviteCode(chat.id)) || '';
  }

  /**
   * Revoga código de convite de um chat
   */
  async revokeChatInvite(chat: Chat): Promise<string> {
    if (!isJidGroup(chat.id)) return '';

    const admins = await this.getChatAdmins(chat);

    if (admins.length && !admins.includes(this.bot.id)) return '';

    return (await this.bot.sock.groupRevokeInvite(chat.id)) || '';
  }

  /**
   * Arquiva ou desarquiva um chat
   */
  async archiveChat(chat: Chat | string, archive: boolean = true, lastMessages: any[]): Promise<void> {
    const chatId = typeof chat === 'string' ? chat : chat.id;
    await this.bot.sock.chatModify({ archive, lastMessages }, chatId);
  }

  /**
   * Silencia ou dessilencia um chat
   */
  async muteChat(chat: Chat | string, mute: number | null, lastMessages: any[]): Promise<void> {
    const chatId = typeof chat === 'string' ? chat : chat.id;
    await this.bot.sock.chatModify({ mute, lastMessages }, chatId);
  }

  /**
   * Marca um chat como lido
   */
  async markChatRead(chat: Chat | string, read: boolean = true, lastMessages: any[]): Promise<void> {
    const chatId = typeof chat === 'string' ? chat : chat.id;
    await this.bot.sock.chatModify({ markRead: read, lastMessages }, chatId);
  }

  /**
   * Define o modo de mensagens temporárias em um chat
   */
  async setDisappearingMessages(chat: Chat | string, duration: number): Promise<void> {
    const chatId = typeof chat === 'string' ? chat : chat.id;
    await this.bot.sock.sendMessage(chatId, { disappearingMessagesInChat: duration });
  }

  /**
   * Lê o chat e atualiza suas informações
   */
  async readChat(
    chat: Partial<Chat>,
    metadata?: Partial<GroupMetadata> & Partial<BaileysChat>,
    updateMetadata: boolean = true,
  ): Promise<void> {
    try {
      // Valida JID usando utilitário
      if (!chat.id || !isValidJID(chat.id)) {
        return;
      }
      
      // Valida se socket está disponível (mas não exige conexão completa para leitura)
      if (!this.bot.sock) {
        return;
      }

      chat.type = isJidGroup(chat.id) ? ChatType.Group : ChatType.PV;

      if (chat.type == ChatType.Group) {
        if (updateMetadata) {
          chat.profileUrl =
            (await this.getChatProfileUrl(new Chat(chat.id))) || undefined;

          if (!metadata) {
            try {
              metadata = await this.bot.sock.groupMetadata(chat.id);
            } catch {}
          } else if (!metadata.participants) {
            try {
              metadata = {
                ...metadata,
                ...(await this.bot.sock.groupMetadata(chat.id)),
              };
            } catch {}

            if (metadata.participant) {
              metadata.participants = [
                ...(metadata.participants || []),
                ...metadata.participant.map((p) => {
                  return {
                    id: p.userJid,
                    isSuperAdmin:
                      p.rank == proto.GroupParticipant.Rank.SUPERADMIN,
                    isAdmin: p.rank == proto.GroupParticipant.Rank.ADMIN,
                  } as any;
                }),
              ];
            }
          }
        }

        if (metadata?.participants) {
          chat.users = [];
          chat.admins = [];

          for (const p of metadata.participants) {
            chat.users.push(p.id);

            if (p.admin == 'admin' || p.isAdmin) {
              chat.admins.push(`${p.id}`);
            } else if (p.isSuperAdmin) {
              chat.leader = p.id;

              chat.admins.push(`${p.id}`);
            }
          }
        }

        if (metadata?.subjectOwner) {
          chat.leader = metadata.subjectOwner;
        }
      }

      if (metadata?.subject || metadata?.name) {
        chat.name = metadata.subject || metadata.name || undefined;
      }

      if (metadata?.desc || metadata?.description) {
        chat.description = metadata.desc || metadata.description || undefined;
      }

      if (metadata?.unreadCount) {
        chat.unreadCount = metadata.unreadCount || undefined;
      }

      if (metadata?.conversationTimestamp) {
        if (Long.isLong(metadata.conversationTimestamp)) {
          chat.timestamp = metadata.conversationTimestamp.toNumber() * TIMESTAMP_MULTIPLIER;
        } else {
          chat.timestamp = Number(metadata.conversationTimestamp) * TIMESTAMP_MULTIPLIER;
        }
      }

      if (chat.id) {
        await this.updateChat({ id: chat.id, ...chat });
      }
    } catch {}
  }
}

