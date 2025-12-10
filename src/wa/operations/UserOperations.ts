import { Contact } from '@whiskeysockets/baileys';
import User from '../../modules/user/User';
import { getImageURL, verifyIsEquals } from '../../utils/Generic';
import { getPhoneNumber } from '../ID';
import { JID_PATTERNS } from '../constants/JIDPatterns';
import WhatsAppBot from '../WhatsAppBot';

/**
 * Operações relacionadas a usuários
 */
export class UserOperations {
  private bot: WhatsAppBot;

  constructor(bot: WhatsAppBot) {
    this.bot = bot;
  }

  /**
   * Obtém o nome de um usuário
   */
  async getUserName(user: User): Promise<string> {
    return (await this.bot.getUser(user))?.name || '';
  }

  /**
   * Define o nome de um usuário (apenas para o próprio bot)
   */
  async setUserName(user: User, name: string): Promise<void> {
    if (user.id !== this.bot.id) return;
    await this.bot.setBotName(name);
  }

  /**
   * Obtém a descrição de um usuário
   */
  async getUserDescription(user: User): Promise<string> {
    // O método fetchStatus não existe na API pública do Baileys
    throw new Error('getUserDescription não implementado: fetchStatus não disponível na API do Baileys');
  }

  /**
   * Define a descrição de um usuário (apenas para o próprio bot)
   */
  async setUserDescription(user: User, description: string): Promise<void> {
    if (user.id !== this.bot.id) return;
    await this.bot.setBotDescription(description);
  }

  /**
   * Obtém a foto de perfil de um usuário
   */
  async getUserProfile(user: User, lowQuality?: boolean): Promise<Buffer> {
    const uri = await this.getUserProfileUrl(user, lowQuality);
    return await getImageURL(uri);
  }

  /**
   * Obtém a URL da foto de perfil de um usuário
   */
  async getUserProfileUrl(user: User, lowQuality?: boolean): Promise<string> {
    try {
      return (
        (await this.bot.sock.profilePictureUrl(
          user.id,
          lowQuality ? 'preview' : 'image',
        )) || ''
      );
    } catch {
      return '';
    }
  }

  /**
   * Define a foto de perfil de um usuário (apenas para o próprio bot)
   */
  async setUserProfile(user: User, image: Buffer): Promise<void> {
    if (user.id !== this.bot.id) return;
    await this.bot.setBotProfile(image);
  }

  /**
   * Obtém um usuário
   */
  async getUser(user: User): Promise<User | null> {
    const userData = await this.bot.auth.get(`users-${user.id}`);

    if (!userData) return null;

    return User.fromJSON(userData);
  }

  /**
   * Obtém lista de IDs de usuários
   */
  async getUsers(): Promise<string[]> {
    return (await this.bot.auth.listAll('users-')).map((id) =>
      id.replace('users-', ''),
    );
  }

  /**
   * Atualiza informações de um usuário
   */
  async updateUser(user: { id: string } & Partial<User>): Promise<void> {
    const userData = await this.bot.getUser(new User(user.id));

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

    newUser.phoneNumber = newUser.phoneNumber || getPhoneNumber(user.id);

    await this.bot.auth.set(`users-${user.id}`, newUser.toJSON());
  }

  /**
   * Define múltiplos usuários
   */
  async setUsers(users: User[]): Promise<void> {
    await Promise.all(users.map(async (user) => await this.updateUser(user)));
  }

  /**
   * Remove um usuário
   */
  async removeUser(user: User): Promise<void> {
    await this.bot.auth.remove(`users-${user.id}`);
  }

  /**
   * Bloqueia um usuário
   */
  async blockUser(user: User): Promise<void> {
    if (user.id === this.bot.id) return;
    await this.bot.sock.updateBlockStatus(user.id, 'block');
  }

  /**
   * Desbloqueia um usuário
   */
  async unblockUser(user: User): Promise<void> {
    if (user.id === this.bot.id) return;
    await this.bot.sock.updateBlockStatus(user.id, 'unblock');
  }

  /**
   * Lê o usuário e atualiza suas informações
   */
  async readUser(user: Partial<User>, metadata?: Partial<Contact>): Promise<void> {
    try {
      if (!user.id || !user.id.includes(JID_PATTERNS.USER)) return;
      
      // Valida se socket está disponível (mas não exige conexão completa para leitura)
      if (!this.bot.sock) {
        return;
      }

      if (metadata?.imgUrl) {
        user.profileUrl = await this.getUserProfileUrl(new User(user.id));
      } else {
        const userData = await this.getUser(new User(user.id || ''));

        if (userData == null || !userData.profileUrl) {
          user.profileUrl = await this.getUserProfileUrl(new User(user.id));
        }
      }

      if (metadata?.notify || metadata?.verifiedName) {
        user.name = metadata?.notify || metadata?.verifiedName;
      }

      if (metadata?.name) {
        user.savedName = metadata.name;
      }

      user.name = user.name || user.savedName;

      await this.updateUser({ id: user.id || '', ...user });
    } catch (err) {
      this.bot.emit('error', err);
    }
  }

  /**
   * Obtém o nome do bot
   */
  async getBotName(): Promise<string> {
    return (await this.getUser(new User(this.bot.id)))?.name || '';
  }

  /**
   * Define o nome do bot
   */
  async setBotName(name: string): Promise<void> {
    await this.bot.sock.updateProfileName(name);
  }

  /**
   * Obtém a descrição do bot
   */
  async getBotDescription(): Promise<string> {
    // O método fetchStatus não existe na API pública do Baileys
    throw new Error('getBotDescription não implementado: fetchStatus não disponível na API do Baileys');
  }

  /**
   * Define a descrição do bot
   */
  async setBotDescription(description: string): Promise<void> {
    await this.bot.sock.updateProfileStatus(description);
  }

  /**
   * Obtém a foto de perfil do bot
   */
  async getBotProfile(lowQuality?: boolean): Promise<Buffer> {
    return await this.getUserProfile(new User(this.bot.id), lowQuality);
  }

  /**
   * Obtém a URL da foto de perfil do bot
   */
  async getBotProfileUrl(lowQuality?: boolean): Promise<string> {
    return (await this.getUserProfileUrl(new User(this.bot.id), lowQuality)) || '';
  }

  /**
   * Define a foto de perfil do bot
   */
  async setBotProfile(image: Buffer): Promise<void> {
    await this.bot.sock.updateProfilePicture(this.bot.id, image);
  }
}

