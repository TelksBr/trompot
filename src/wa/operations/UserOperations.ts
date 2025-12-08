import User from '../../modules/user/User';
import { getImageURL, verifyIsEquals } from '../../utils/Generic';
import { getPhoneNumber } from '../ID';
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
}

