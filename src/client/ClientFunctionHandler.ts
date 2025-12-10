import IClient from './IClient';
import IBot from '../bot/IBot';
import { BotStatus } from '../bot/BotStatus';

export default class ClientFunctionHandler<B extends IBot, T extends string> {
  /** Todas funções */
  public awaiting: Function[] = [];

  constructor(
    public client: IClient<B>,
    public functions: Record<T, Function[]>,
  ) {}

  public async exec<F extends (...args: any[]) => any>(
    row: T,
    func: F,
    ...args: Parameters<F>
  ): Promise<Awaited<ReturnType<F>>> {
    await this.await(row);

    const getResult = async (
      count: number = 0,
      error: unknown = undefined,
    ): Promise<[Awaited<ReturnType<F>> | undefined, unknown]> => {
      try {
        if (count >= this.client.config.maxRequests) {
          return [undefined, error];
        }

        // Verifica conexão de forma mais robusta
        // Para WhatsApp: verifica sock.ws.isOpen
        // Para Telegram: verifica apenas status === Online
        const sock = (this.client.bot as any).sock;
        const statusIsOnline = this.client.bot.status === BotStatus.Online;
        const sockIsOpen = sock?.ws?.isOpen === true;
        
        // Determina se está conectado baseado no tipo de bot
        // Telegram não tem sock, então verifica apenas status
        // WhatsApp precisa de sock.ws.isOpen E status Online
        const isTelegram = !sock; // Telegram não tem sock
        const isConnected = isTelegram 
          ? statusIsOnline 
          : (statusIsOnline && sockIsOpen);
        
        // CRÍTICO: Só aguarda conexão se realmente não estiver conectado
        // Isso evita timeouts desnecessários, especialmente para Telegram
        if (!isConnected) {
          try {
            await this.client.awaitConnectionOpen();
          } catch (err) {
            // Verifica novamente se realmente não está conectado
            const sockAfterError = (this.client.bot as any).sock;
            const statusAfterError = this.client.bot.status === BotStatus.Online;
            const sockIsOpenAfterError = sockAfterError?.ws?.isOpen === true;
            const isTelegramAfterError = !sockAfterError;
            const stillNotConnected = isTelegramAfterError
              ? !statusAfterError
              : (!statusAfterError || !sockIsOpenAfterError);
            
            if (stillNotConnected) {
              throw err; // Só relança se realmente não estiver conectado
            }
          }
        }

        const result = await func.bind(this.client.bot)(...args);
        return [result, undefined];
      } catch (error) {
        await new Promise((res) =>
          setTimeout(res, this.client.config.requestsDelay),
        );

        return await getResult(count + 1, error);
      }
    };

    const [result, error] = await getResult();

    this.functions[row].shift();

    this.resolve(row);

    if (error) {
      throw error;
    }

    return result as any;
  }

  public async await(row: T) {
    await new Promise((resolve) => this.addAwaiting(resolve));
    await new Promise((resolve) => this.add(row, resolve));
  }

  public add(row: T, func: Function) {
    this.functions[row].push(func);

    if (this.functions[row].length == 1) {
      this.resolve(row);
    }
  }

  public addAwaiting(func: Function) {
    this.awaiting.push(func);

    if (this.awaiting.length == 1) {
      this.resolveAwaiting();
    }
  }

  public async resolve(row: T) {
    if (this.functions[row].length <= 0) return;

    const func = this.functions[row][0];

    if (func) {
      await func();
    }
  }

  public async resolveAwaiting() {
    if (this.awaiting.length <= 0) return;

    const func = this.awaiting[0];

    if (func) {
      await func();
    }

    this.awaiting.shift();

    if (this.awaiting.length > 0) {
      this.resolveAwaiting();
    }
  }
}
