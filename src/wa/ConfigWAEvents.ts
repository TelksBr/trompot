import {
  DisconnectReason,
  MessageUpsertType,
  WACallEvent,
  isJidGroup,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import Long from 'long';

import { BotStatus } from '../bot/BotStatus';
import { fixID, getPhoneNumber } from './ID';
import Call, { CallStatus } from '../models/Call';

import Chat from '../modules/chat/Chat';
import WhatsAppBot from './WhatsAppBot';
import ConvertWAMessage from './ConvertWAMessage';
import ErrorMessage from '../messages/ErrorMessage';
import { StateManager } from './core/StateManager';
import { JID_PATTERNS } from './constants/JIDPatterns';
import { ErrorCodes, ErrorMessages } from './constants/ErrorCodes';
import { ConfigDefaults, TIMESTAMP_MULTIPLIER } from './constants/ConfigDefaults';

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
    this.configConnectionUpdate();
    this.configHistorySet();
    this.configContactsUpsert();
    this.configContactsUpdate();
    this.configChatsDelete();
    this.configGroupsUpdate();
    this.configMessagesUpsert();
    this.configMessagesUpdate();
    this.configCall();
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

  public async readMessages(
    messages: proto.IWebMessageInfo[],
    type: MessageUpsertType = 'notify',
  ) {
    try {
      for (const message of messages || []) {
        try {
          if (!message) continue;

          // v7: key pode ser null/undefined no tipo, garantir antes de usar
          const key = message.key;
          if (!key) continue;
          if (key.remoteJid === JID_PATTERNS.BROADCAST) continue;

          if (!message.message) {
            if (
              !(
                message.messageStubType ==
                proto.WebMessageInfo.StubType.CIPHERTEXT
              )
            ) {
              return; // Not read other null messages
            }

            const msgRetryCount =
              this.wa.config.msgRetryCounterCache?.get<number>(key.id!);

            if (msgRetryCount != this.wa.config.maxMsgRetryCount) {
              const time = this.wa.config.retryRequestDelayMs || ConfigDefaults.DEFAULT_RETRY_DELAY;

              await new Promise((res) => setTimeout(res, time * ConfigDefaults.RETRY_DELAY_MULTIPLIER));

              const newMsgRetryCount =
                this.wa.config.msgRetryCounterCache?.get<number>(
                  key.id!,
                );

              if (!this.wa.config.readAllFailedMessages) {
                if (
                  msgRetryCount &&
                  newMsgRetryCount &&
                  msgRetryCount != newMsgRetryCount
                ) {
                  return; // Not read duplicated failed message
                }
              }
            }
          }

          if (
            message.message?.protocolMessage?.type ==
              proto.Message.ProtocolMessage.Type.EPHEMERAL_SYNC_RESPONSE ||
            message.message?.protocolMessage?.type ==
              proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_SHARE ||
            message.message?.protocolMessage?.type ==
              proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_REQUEST ||
            message.message?.protocolMessage?.type ==
              proto.Message.ProtocolMessage.Type
                .APP_STATE_FATAL_EXCEPTION_NOTIFICATION ||
            message.message?.protocolMessage?.type ==
              proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING ||
            message.message?.protocolMessage?.type ==
              proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION ||
            message.message?.protocolMessage?.type ==
              proto.Message.ProtocolMessage.Type
                .INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC
          ) {
            return; // Not read empty messages
          }

          if (this.wa.messagesCached.includes(key.id!)) return;

          this.wa.addMessageCache(key.id!);

          const chatId = fixID(key.remoteJid || this.wa.id);

          const chat = await this.wa.getChat(new Chat(chatId));

          let timestamp: number | undefined;

          if (message.messageTimestamp) {
            if (Long.isLong(message.messageTimestamp)) {
              timestamp = message.messageTimestamp.toNumber() * TIMESTAMP_MULTIPLIER;
            } else {
              timestamp = (message.messageTimestamp as number) * TIMESTAMP_MULTIPLIER;
            }
          }

          await this.wa.updateChat({
            id: chatId,
            unreadCount: (chat?.unreadCount || 0) + 1,
            timestamp,
            name:
              key.id?.includes(JID_PATTERNS.USER) && !key.fromMe
                ? message.pushName || message.verifiedBizName || undefined
                : undefined,
          });

          const userId = fixID(
            key.fromMe
              ? this.wa.id
              : key.participant ||
                  message.participant ||
                  key.remoteJid ||
                  '',
          );

          await this.wa.updateUser({
            id: userId,
            name: message.pushName || message.verifiedBizName || undefined,
          });

          // v7: tipagem de WAMessageKey exige key não nula; após o guard podemos fazer cast
          const msg = await new ConvertWAMessage(
            this.wa,
            message as any,
            type,
          ).get();

          if (msg.fromMe && msg.isUnofficial) {
            await this.wa.updateChat({ id: msg.chat.id, unreadCount: 0 });
          }

          this.wa.emit('message', msg);
        } catch (err) {
          this.wa.emit(
            'message',
            new ErrorMessage(
              fixID(message?.key?.remoteJid || ''),
              err && err instanceof Error
                ? err
                : new Error(JSON.stringify(err)),
            ),
          );
        }
      }
    } catch (err) {
      this.wa.emit('error', err);
    }
  }

  public configMessagesUpsert() {
    const handler = async (m: any) => {
      try {
        await this.readMessages(m?.messages || [], m.type);
      } catch (err) {
        this.wa.emit('error', err);
      }
    };
    
    this.wa.sock.ev.on('messages.upsert', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('messages.upsert', handler);
    });
  }

  public configMessagesUpdate() {
    const handler = async (messages: any) => {
      try {
        for (const message of messages || []) {
          try {
            if (!message.key || message.key.remoteJid === JID_PATTERNS.BROADCAST)
              return;

            await this.readMessages([{ key: message.key, ...message.update }]);

            if (!message?.update?.status) return;

            const msg = await new ConvertWAMessage(this.wa, message).get();

            msg.isUpdate = true;

            this.wa.emit('message', msg);
          } catch (err) {
            this.wa.emit(
              'message',
              new ErrorMessage(
                fixID(message?.key?.remoteJid || ''),
                err && err instanceof Error
                  ? err
                  : new Error(JSON.stringify(err)),
              ),
            );
          }
        }
      } catch (err) {
        this.wa.emit('error', err);
      }
    };
    
    this.wa.sock.ev.on('messages.update', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('messages.update', handler);
    });
  }

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

  public configHistorySet() {
    const ignoreChats: string[] = [];

    const handler = async (update: any) => {
      if (!this.wa.config.autoSyncHistory) return;

      for (const chat of update.chats || []) {
        try {
          // v7: id pode ser null/undefined no tipo, ignorar chats sem id
          if (!chat.id) continue;

          if (!('unreadCount' in chat) || chat.isDefaultSubgroup === true) {
            ignoreChats.push(chat.id);

            continue;
          }

          const isGroup = isJidGroup(chat.id);

          if (!('pinned' in chat) || isGroup) {
            if (!isGroup) {
              ignoreChats.push(chat.id);

              continue;
            }

            if (
              !('endOfHistoryTransferType' in chat) &&
              !('isDefaultSubgroup' in chat)
            ) {
              ignoreChats.push(chat.id);

              continue;
            }
          }

          if ((chat.participant?.length || 0) > 0) {
            if (!chat.participant?.some((p) => p.userJid == this.wa.id)) {
              ignoreChats.push(chat.id);

              continue;
            }
          }

          const autoLoad = isGroup
            ? this.wa.config.autoLoadGroupInfo
            : this.wa.config.autoLoadContactInfo;

          if (autoLoad && chat.id) {
            // v7: tipo de chat.id permite null, mas já garantimos acima que existe
            await this.wa.readChat({ id: chat.id }, chat);
          }
        } catch (err) {
          this.wa.emit('error', err);
        }
      }

      for (const message of update?.messages || []) {
        try {
          if (
            !message?.message ||
            !message.key?.remoteJid ||
            message.key.remoteJid === JID_PATTERNS.BROADCAST
          )
            continue;
          if (ignoreChats.includes(fixID(message.key.remoteJid || '')))
            continue;

          const msg = await new ConvertWAMessage(this.wa, message).get();

          msg.isOld = true;

          this.wa.emit('message', msg);
        } catch (err) {
          const msg = new ErrorMessage(
            fixID(message?.key?.remoteJid || ''),
            err && err instanceof Error ? err : new Error(JSON.stringify(err)),
          );

          msg.isOld = true;

          this.wa.emit('message', msg);
        }
      }
    };
    
    this.wa.sock.ev.on('messaging-history.set', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('messaging-history.set', handler);
    });
  }

  public configContactsUpdate() {
    const handler = async (updates: any) => {
      if (!this.wa.config.autoLoadContactInfo) return;

      for (const update of updates) {
        try {
          if (isJidGroup(update.id)) {
            await this.wa.readChat({ id: update.id }, update);
          } else {
            await this.wa.readUser({ id: update.id }, update);
          }
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ev.on('contacts.update', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('contacts.update', handler);
    });
  }

  public configContactsUpsert() {
    const handler = async (updates: any) => {
      if (!this.wa.config.autoLoadContactInfo) return;

      for (const update of updates) {
        try {
          if (isJidGroup(update.id)) {
            await this.wa.readChat({ id: update.id }, update);
          } else {
            await this.wa.readUser({ id: update.id }, update);
          }
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ev.on('contacts.upsert', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('contacts.upsert', handler);
    });
  }

  public configGroupsUpdate() {
    const handler = async (updates: any) => {
      if (!this.wa.config.autoLoadGroupInfo) return;

      for (const update of updates) {
        try {
          if (!update?.id) continue;

          const chat = await this.wa.getChat(new Chat(update.id));

          if (chat == null) {
            await this.wa.readChat({ id: update.id }, update, true);
          } else {
            await this.wa.readChat({ id: update.id }, update, false);
          }
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ev.on('groups.update', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('groups.update', handler);
    });
  }

  public configChatsDelete() {
    const handler = async (deletions: any) => {
      for (const id of deletions) {
        try {
          await this.wa.removeChat(new Chat(id));
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ev.on('chats.delete', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('chats.delete', handler);
    });
  }

  public configCall() {
    const handler = async (events: WACallEvent[]) => {
      for (const event of events || []) {
        try {
          const chat = event.chatId || event.groupJid || event.from || '';

          let status: CallStatus;

          switch (event.status) {
            case 'offer':
              status = CallStatus.Offer;
              break;
            case 'ringing':
              status = CallStatus.Ringing;
              break;
            case 'reject':
              status = CallStatus.Reject;
              break;
            case 'accept':
              status = CallStatus.Accept;
              break;
            case 'timeout':
              status = CallStatus.Timeout;
              break;
            default:
              status = CallStatus.Ringing;
              break;
          }

          const call = new Call(event.id, chat, event.from, status, {
            date: event.date || new Date(),
            isVideo: !!event.isVideo,
            offline: !!event.offline,
            latencyMs: event.latencyMs || 1,
          });

          this.wa.emit('call', call);
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    };
    
    this.wa.sock.ev.on('call', handler);
    this.cleanupFunctions.push(() => {
      this.wa.sock?.ev.off('call', handler);
    });
  }
}
