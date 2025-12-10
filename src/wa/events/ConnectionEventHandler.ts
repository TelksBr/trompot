import { WASocket, ConnectionState } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import { IStateManager } from '../interfaces/IStateManager';
import { ISessionManager } from '../interfaces/ISessionManager';
import WhatsAppBot from '../WhatsAppBot';
import { ErrorCodes, ErrorMessages } from '../constants/ErrorCodes';

export class ConnectionEventHandler {
  private bot: WhatsAppBot;
  private logger: ILoggerService;
  private stateManager: IStateManager;
  private sessionManager: ISessionManager;

  constructor(
    bot: WhatsAppBot,
    logger: ILoggerService,
    stateManager: IStateManager,
    sessionManager: ISessionManager
  ) {
    this.bot = bot;
    this.logger = logger;
    this.stateManager = stateManager;
    this.sessionManager = sessionManager;
  }

  /**
   * Configura handlers para eventos de conexão
   * NOTA: Este handler NÃO escuta connection.update diretamente para evitar duplicação
   * O ConfigWAEvents já escuta connection.update e notifica connectionListeners
   * Este handler é chamado pelo EventManager quando necessário
   */
  setup(socket: WASocket): void {
    // REMOVIDO: Listener duplicado de connection.update
    // O ConfigWAEvents já escuta este evento e notifica connectionListeners
    // Para evitar processamento duplicado, este handler não escuta diretamente
    // A lógica adicional será chamada através do EventManager se necessário
    
    // Handler para creds.update (único responsável)

    // Handler para creds.update
    socket.ev.on('creds.update', async (creds) => {
      try {
        await this.handleCredsUpdate(creds);
      } catch (error) {
        this.logger.error('Erro ao processar creds.update', error);
        this.bot.emit('error', error);
      }
    });
  }

  /**
   * Trata atualizações de conexão
   * NOTA: Os connectionListeners já são notificados pelo ConfigWAEvents
   * Este método apenas gerencia o estado adicional
   */
  private async handleConnectionUpdate(update: ConnectionState): Promise<void> {
    // Atualiza estado
    this.stateManager.updateConnectionState(update);
    this.stateManager.setLastConnectionUpdateDate(Date.now());

    // NOTA: Os eventos 'connecting' e 'qr' já são emitidos pelo ConfigWAEvents
    // Não duplicar aqui para evitar logs duplicados
    if (update.connection === 'connecting') {
      this.stateManager.setStatus(require('../../bot/BotStatus').BotStatus.Offline);
      // this.bot.emit('connecting', { action: 'connecting' }); // Já emitido pelo ConfigWAEvents
    }

    if (update.connection === 'open') {
      await this.handleOpen(update);
    }

    if (update.connection === 'close') {
      await this.handleClose(update);
    }
  }

  /**
   * Trata quando a conexão é aberta
   */
  private async handleOpen(update: ConnectionState): Promise<void> {
    try {
      const uptime = Date.now();

      this.stateManager.setStatus(require('../../bot/BotStatus').BotStatus.Online);
      this.stateManager.setLastDisconnectError(undefined);
      this.stateManager.setConnectionStatus('connected');

      // Atualiza informações do bot
      // Tenta obter ID de múltiplas fontes (sock.user.id pode não estar disponível imediatamente)
      try {
        const { fixID, getPhoneNumber } = require('../ID');
        
        // 1. Tenta sock.user.id
        // 2. Tenta creds.me.id (das credenciais, mais confiável)
        let rawId = this.bot.sock?.user?.id || '';
        
        // Se não encontrou, tenta das credenciais
        if (!rawId && this.bot.sock?.authState?.creds?.me?.id) {
          rawId = this.bot.sock.authState.creds.me.id;
        }
        
        if (rawId) {
          const id = fixID(rawId);
          this.stateManager.setId(id);
          
          // Obtém o número de telefone do ID original (antes do fixID) ou do ID fixado
          // Tenta primeiro do ID original, depois do fixado
          const phoneNumber = getPhoneNumber(rawId) || getPhoneNumber(id);
          this.stateManager.setPhoneNumber(phoneNumber);
          
          this.stateManager.setName(
            this.bot.sock?.user?.name ||
            this.bot.sock?.user?.notify ||
            this.bot.sock?.user?.verifiedName ||
            this.bot.sock?.authState?.creds?.me?.name ||
            ''
          );
          this.stateManager.setProfileUrl(this.bot.sock?.user?.imgUrl || '');
        }
      } catch (error) {
        this.logger.error('Erro ao atualizar informações do bot', error);
      }

      // Lê informações do usuário e chat (pode falhar silenciosamente)
      try {
        if (this.stateManager.id) {
          await this.bot.readUser(
            { id: this.stateManager.id },
            {
              notify: this.stateManager.name || undefined,
              imgUrl: this.stateManager.profileUrl || undefined,
            },
          );
          await this.bot.readChat(
            { id: this.stateManager.id },
            { subject: this.stateManager.name || undefined },
          );
        }
        } catch (error) {
          // Ignora erros não críticos silenciosamente
        }

      this.bot.emit('open', { isNewLogin: update.isNewLogin || false });

      // Auto restart após intervalo configurado
      if (this.bot.config.autoRestartInterval) {
        setTimeout(async () => {
          try {
            if (this.stateManager.lastConnectionUpdateDate !== uptime) return;
            // Reconexão será gerenciada pelo ConnectionManager
          } catch (error) {
            this.bot.emit('error', error);
          }
        }, this.bot.config.autoRestartInterval);
      }

      // Busca grupos (pode falhar silenciosamente)
      try {
        await this.bot.sock?.groupFetchAllParticipating();
      } catch (error) {
        // Ignora erros não críticos silenciosamente
      }
    } catch (error) {
      this.logger.error('Erro crítico ao processar conexão aberta', error);
      this.bot.emit('error', error);
      // Não re-lança o erro para não quebrar o fluxo de conexão
    }
  }

  /**
   * Trata quando a conexão é fechada
   */
  private async handleClose(update: ConnectionState): Promise<void> {
    this.stateManager.setStatus(require('../../bot/BotStatus').BotStatus.Offline);
    this.stateManager.setConnectionStatus('disconnected');

    const { DisconnectReason } = require('@whiskeysockets/baileys');
    const { Boom } = require('@hapi/boom');

    const status =
      (update.lastDisconnect?.error as typeof Boom)?.output?.statusCode ||
      (typeof update.lastDisconnect?.error === 'number'
        ? update.lastDisconnect.error
        : undefined) ||
      ErrorCodes.INTERNAL_SERVER_ERROR;

    this.stateManager.setLastDisconnectError(typeof status === 'number' ? status : undefined);

    // Limpa interval de verificação de conexão
    if (this.bot.checkConnectionInterval !== null) {
      clearInterval(this.bot.checkConnectionInterval);
      this.bot.checkConnectionInterval = null;
    }

    // Trata diferentes códigos de erro
    if (status === DisconnectReason.loggedOut || status === ErrorCodes.LOGGED_OUT || status === ErrorCodes.LOGGED_OUT_ALT) {
      // CRÍTICO: Limpa a sessão inválida automaticamente
      // A biblioteca gerencia isso para garantir que um novo QR code seja gerado
      // O cliente não precisa fazer nada - apenas chamar connect() novamente quando quiser
      try {
        await this.sessionManager.clearInvalidSession(this.bot.auth);
        // Log removido - limpeza de sessão é silenciosa
      } catch (error) {
        this.logger.error('Erro ao limpar sessão após 401/421', error);
      }
      
      // Emite eventos para o cliente ser notificado
      // O cliente pode então decidir quando chamar connect() novamente
      this.bot.emit('close', {
        reason: status,
        message: ErrorMessages.LOGGED_OUT(status)
      });
      this.bot.emit('stop', { isLogout: true });
    } else if (status === ErrorCodes.CONNECTION_CLOSED) {
      // 402 = connectionClosed - geralmente é temporário, não limpa sessão
      // Apenas emite o evento, não tenta reconectar automaticamente
      this.bot.emit('close', {
        reason: status,
        message: ErrorMessages.CONNECTION_CLOSED
      });
      // NÃO emite 'stop' para 402 - permite que o Baileys tente reconectar
    } else if (status === ErrorCodes.REQUEST_TIMEOUT) {
      // 408 = Request Timeout - requisição expirou, geralmente temporário
      // Similar ao 402 (Connection Closed) - não limpa sessão, permite reconexão
      this.bot.emit('close', {
        reason: status,
        message: ErrorMessages.REQUEST_TIMEOUT
      });
      // NÃO emite 'stop' para 408 - permite que o Baileys tente reconectar
    } else if (status === ErrorCodes.CONNECTION_TERMINATED) {
      this.bot.emit('close', {
        reason: status,
        message: ErrorMessages.CONNECTION_TERMINATED
      });
      this.bot.emit('stop', { isLogout: false });
    } else if (status === ErrorCodes.INTERNAL_SERVER_ERROR) {
      // 500 = Internal Server Error - erro temporário do servidor, permite reconexão
      this.bot.emit('close', {
        reason: status,
        message: ErrorMessages.INTERNAL_SERVER_ERROR_MSG
      });
      // NÃO emite 'stop' para 500 - permite que o ConnectionManager tente reconectar
      // Chama ConnectionManager.handleDisconnect para tentar reconectar automaticamente
      // O handleDisconnect verifica shouldReconnect e tenta reconectar se necessário
      try {
        const { Boom } = require('@hapi/boom');
        const error = new Boom('Internal Server Error', { 
          statusCode: 500,
          output: { statusCode: 500 }
        });
        // Chama ConnectionManager.handleDisconnect para tentar reconectar automaticamente
        if (this.bot.connectionManager && typeof this.bot.connectionManager.handleDisconnect === 'function') {
          await this.bot.connectionManager.handleDisconnect(error);
        }
      } catch (error) {
        this.logger.error('Erro ao tentar reconectar após erro 500', error);
      }
    } else if (status === DisconnectReason.restartRequired) {
      // Após autenticação (QR code escaneado), o WhatsApp força restartRequired
      // Salva credenciais e cria novo socket imediatamente
      try {
        // Salva credenciais primeiro
        await this.bot.saveCreds(this.bot.sock.authState.creds);
        
        // Cria novo socket com credenciais salvas (método centralizado)
        await this.bot.createSocket();
        // Log removido - criação de socket após restartRequired é silenciosa
      } catch (error) {
        this.logger.error('Erro ao criar novo socket após restartRequired', error);
        this.bot.emit('error', error);
      }
    } else {
      this.bot.emit('close', { reason: status });
    }
  }

  /**
   * Trata atualizações de credenciais
   * Atualiza informações do bot quando credenciais são atualizadas
   * Isso garante que o número seja obtido mesmo se sock.user.id não estiver disponível imediatamente
   */
  private async handleCredsUpdate(creds: any): Promise<void> {
    await this.bot.saveCreds(creds);
    
    // Atualiza informações do bot se credenciais contiverem me.id
    if (creds?.me?.id) {
      try {
        const { fixID, getPhoneNumber } = require('../ID');
        const rawId = creds.me.id;
        const id = fixID(rawId);
        
        // Atualiza apenas se ainda não tiver ID ou se o ID mudou
        if (!this.stateManager.id || this.stateManager.id !== id) {
          this.stateManager.setId(id);
          // Obtém o número de telefone do ID original (antes do fixID) ou do ID fixado
          const phoneNumber = getPhoneNumber(rawId) || getPhoneNumber(id);
          this.stateManager.setPhoneNumber(phoneNumber);
        } else if (!this.stateManager.phoneNumber) {
          // Se já tem ID mas não tem número, tenta obter novamente
          const phoneNumber = getPhoneNumber(rawId) || getPhoneNumber(this.stateManager.id);
          if (phoneNumber) {
            this.stateManager.setPhoneNumber(phoneNumber);
          }
        }
        
        // Atualiza nome se disponível nas credenciais e ainda não tiver
        if (creds.me?.name && !this.stateManager.name) {
          this.stateManager.setName(creds.me.name);
        }
      } catch (error) {
        this.logger.error('Erro ao atualizar informações do bot em creds.update', error);
      }
    }
  }
}

