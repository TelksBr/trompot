import {
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

import { BotStatus } from '../bot/BotStatus';
import { fixID } from './ID';
import WhatsAppBot from './WhatsAppBot';
import { StateManager } from './core/StateManager';
import { ErrorCodes, ErrorMessages } from './constants/ErrorCodes';
import { ConfigDefaults } from './constants/ConfigDefaults';

export default class ConfigWAEvents {
  public wa: WhatsAppBot;
  private cleanupFunctions: (() => void)[] = [];
  private stateManager: StateManager | null = null;

  constructor(wa: WhatsAppBot) {
    this.wa = wa;
    // Obtém stateManager de forma type-safe
    this.stateManager = this.wa.getStateManager?.() || null;
  }

  /**
   * Limpa todos os listeners configurados
   */
  public cleanup(): void {
    // Remove todos os listeners do socket
    if (this.wa.sock?.ev) {
      // Remove listeners específicos que foram registrados
      this.cleanupFunctions.forEach(cleanup => {
        try {
          cleanup();
        } catch (error) {
          // Ignora erros ao limpar
        }
      });
      this.cleanupFunctions = [];
    }
  }

  public configureAll() {
    // CRÍTICO: connection.update deve ser configurado PRIMEIRO
    // O Baileys pode emitir o QR code no primeiro connection.update
    this.configConnectionUpdate();
    
    // REMOVIDO: messages.upsert e messages.update
    // Agora são gerenciados exclusivamente pelo MessageEventHandler
    // para evitar processamento duplicado
    
    // REMOVIDO: history, contacts, groups, chats, call
    // Agora são gerenciados pelos handlers especializados:
    // - HistoryEventHandler
    // - ContactEventHandler
    // - GroupEventHandler
    // - ChatEventHandler
    // - CallEventHandler
    
    // Mantém apenas eventos específicos que não têm handlers especializados
    this.configCBNotifications();
  }

  public configCBNotifications() {
    this.configCBNotificationRemove();
    this.configCBNotificationAdd();
    this.configCBNotificationPromote();
    this.configCBNotificationDemote();
  }

  public configCBNotificationRemove() {
    const handler = async (data: any) => {
      for (const content of data.content[0]?.content || []) {
        try {
          await this.wa.groupParticipantsUpdate(
            content.attrs.jid == data.attrs.participant ? 'leave' : 'remove',
            data.attrs.from,
            content.attrs.jid,
            data.attrs.participant,
          );
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ws.on('CB:notification,,remove', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ws.off('CB:notification,,remove', handler);
    });
  }

  public configCBNotificationAdd() {
    const handler = async (data: any) => {
      for (const content of data.content[0]?.content || []) {
        try {
          if (!data.attrs.participant)
            data.attrs.participant = content.attrs.jid;

          await this.wa.groupParticipantsUpdate(
            content.attrs.jid == data.attrs.participant ? 'join' : 'add',
            data.attrs.from,
            content.attrs.jid,
            data.attrs.participant,
          );
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ws.on('CB:notification,,add', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ws.off('CB:notification,,add', handler);
    });
  }

  public configCBNotificationPromote() {
    const handler = async (data: any) => {
      for (const content of data.content[0]?.content || []) {
        try {
          await this.wa.groupParticipantsUpdate(
            'promote',
            data.attrs.from,
            content.attrs.jid,
            data.attrs.participant,
          );
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ws.on('CB:notification,,promote', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ws.off('CB:notification,,promote', handler);
    });
  }

  public configCBNotificationDemote() {
    const handler = async (data: any) => {
      for (const content of data.content[0]?.content || []) {
        try {
          await this.wa.groupParticipantsUpdate(
            'demote',
            data.attrs.from,
            content.attrs.jid,
            data.attrs.participant,
          );
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ws.on('CB:notification,,demote', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ws.off('CB:notification,,demote', handler);
    });
  }

  // REMOVIDO: readMessages, configMessagesUpsert, configMessagesUpdate
  // Agora são gerenciados exclusivamente pelo MessageEventHandler
  // para evitar processamento duplicado

  public configConnectionUpdate() {
    // CRÍTICO: Configurar o listener ANTES de qualquer outra coisa
    // O Baileys pode emitir o QR code no primeiro connection.update
    this.wa.sock.ev.on('connection.update', async (update) => {
      try {
        this.wa.connectionListeners = this.wa.connectionListeners.filter(
          (listener) => !listener(update),
        );

        if (update.connection == 'connecting') {
          // Usa StateManager através dos setters (type-safe)
          if (this.stateManager) {
            this.stateManager.setLastConnectionUpdateDate(Date.now());
            this.stateManager.setStatus(BotStatus.Offline);
          }
          this.wa.emit('connecting', { action: 'connecting' });
        }

        // IMPORTANTE: O Baileys envia o QR code como string no campo 'qr' do connection.update
        // O QR code será emitido como texto através do evento 'qr'
        if (update.qr) {
          // Emite o QR code (string) para o cliente
          // O QR code pode ser atualizado várias vezes, então emitimos sempre que houver
          this.wa.emit('qr', update.qr);
        }

        if (update.connection == 'open') {
          const uptime = Date.now();

          // Usa StateManager através dos setters (type-safe)
          if (this.stateManager) {
            this.stateManager.setLastConnectionUpdateDate(uptime);
            this.stateManager.setStatus(BotStatus.Online);
            this.stateManager.setLastDisconnectError(undefined);

            const id = fixID(this.wa.sock?.user?.id || '');
            this.stateManager.setId(id);
            this.stateManager.setPhoneNumber(getPhoneNumber(id));
            this.stateManager.setName(
              this.wa.sock?.user?.name ||
              this.wa.sock?.user?.notify ||
              this.wa.sock?.user?.verifiedName ||
              ''
            );
            this.stateManager.setProfileUrl(this.wa.sock?.user?.imgUrl || '');

            this.wa.readUser(
              { id: this.stateManager.id },
              {
                notify: this.stateManager.name || undefined,
                imgUrl: this.stateManager.profileUrl || undefined,
              },
            );
            this.wa.readChat(
              { id: this.stateManager.id },
              { subject: this.stateManager.name || undefined },
            );
          }

          this.wa.emit('open', { isNewLogin: update.isNewLogin || false });

          // REMOVIDO: Auto-restart que estava causando reconexões desnecessárias
          // O Baileys já gerencia a conexão automaticamente
          // setTimeout(async () => {
          //   try {
          //     if (this.wa.lastConnectionUpdateDate != uptime) return;
          //     await this.wa.reconnect(true, false);
          //   } catch (error) {
          //     this.wa.emit('error', error);
          //   }
          // }, this.wa.config.autoRestartInterval);

          // Limpa interval anterior se existir
          if (this.wa.checkConnectionInterval !== null) {
            clearInterval(this.wa.checkConnectionInterval);
            this.wa.checkConnectionInterval = null;
          }

          // REMOVIDO: Interval que estava forçando desconexão após 10 segundos
          // Isso estava causando o erro 402 após escanear o QR code
          // O Baileys já gerencia a conexão e emite eventos de desconexão quando necessário
          // this.wa.checkConnectionInterval = setInterval(() => {
          //   if (!this.wa.sock) {
          //     if (this.wa.checkConnectionInterval) {
          //       clearInterval(this.wa.checkConnectionInterval);
          //       this.wa.checkConnectionInterval = null;
          //     }
          //     return;
          //   }
          //   if (this.wa.sock.ws.isOpen) return;
          //   this.wa.sock.ev.emit('connection.update', {
          //     connection: 'close',
          //     lastDisconnect: {
          //       date: new Date(),
          //       error: new Boom('Socket closed', {
          //         statusCode: DisconnectReason.connectionClosed,
          //       }),
          //     },
          //   });
          // }, 10000);

          this.wa.eventsIsStoped = false;

          await this.wa.sock.groupFetchAllParticipating();
        }

        if (update.connection == 'close') {
            const status =
            (update.lastDisconnect?.error as Boom)?.output?.statusCode ||
            (typeof update.lastDisconnect?.error === 'number' 
              ? update.lastDisconnect.error 
              : undefined) ||
            ErrorCodes.INTERNAL_SERVER_ERROR;
          
          // Usa StateManager através dos setters (type-safe)
          if (this.stateManager) {
            this.stateManager.setLastConnectionUpdateDate(Date.now());
            this.stateManager.setStatus(BotStatus.Offline);
            this.stateManager.setLastDisconnectError(typeof status === 'number' ? status : undefined);
          }

          if (this.wa.checkConnectionInterval !== null) {
            clearInterval(this.wa.checkConnectionInterval);
            this.wa.checkConnectionInterval = null;
          }

          if (status === DisconnectReason.loggedOut || status === ErrorCodes.LOGGED_OUT || status === ErrorCodes.LOGGED_OUT_ALT) {
            // Erro 401/421: Logged Out - Sessão foi morta do WhatsApp
            // A limpeza da sessão é feita pelo ConnectionEventHandler
            // Aqui apenas emite eventos para o cliente ser notificado
            this.wa.emit('close', { 
              reason: status, 
              message: ErrorMessages.LOGGED_OUT(status)
            });
            this.wa.emit('stop', { isLogout: true });
          } else if (status === ErrorCodes.CONNECTION_CLOSED) {
            // 402 = connectionClosed - geralmente é temporário
            // NÃO emite 'stop' para permitir que o Baileys gerencie a reconexão
            // Apenas emite 'close' para notificar o cliente
            this.wa.emit('close', {
              reason: status,
              message: ErrorMessages.CONNECTION_CLOSED
            });
          } else if (status === ErrorCodes.CONNECTION_TERMINATED) {
            // Erro 428: Connection Terminated - Sessão inválida/corrompida
            // (já rastreado acima)
            // NÃO tenta reconectar automaticamente - a sessão precisa ser limpa
            // Emite evento específico para que o usuário possa limpar a sessão
            this.wa.emit('close', { 
              reason: status, 
              message: ErrorMessages.CONNECTION_TERMINATED
            });
            // Para a reconexão automática - não adianta tentar com sessão inválida
            this.wa.emit('stop', { isLogout: false });
          } else if (status == DisconnectReason.restartRequired) {
            // restartRequired é tratado pelo ConnectionEventHandler
            // Apenas emite close para notificar (não trata aqui para evitar duplicação)
            this.wa.emit('close', { 
              reason: status, 
              message: 'Reinício necessário após autenticação' 
            });
          } else {
            this.wa.emit('close', { reason: status });
          }
        }
      } catch (err) {
        this.wa.emit('error', err);
      }
    });
  }

  // REMOVIDO: configHistorySet, configContactsUpdate, configContactsUpsert,
  // configGroupsUpdate, configChatsDelete, configCall
  // Agora são gerenciados pelos handlers especializados:
  // - HistoryEventHandler
  // - ContactEventHandler
  // - GroupEventHandler
  // - ChatEventHandler
  // - CallEventHandler
}
