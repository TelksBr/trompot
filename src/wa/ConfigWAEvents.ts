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

export default class ConfigWAEvents {
  public wa: WhatsAppBot;

  constructor(wa: WhatsAppBot) {
    this.wa = wa;
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
    this.wa.sock.ws.on('CB:notification,,remove', async (data) => {
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
    });
  }

  public configCBNotificationAdd() {
    this.wa.sock.ws.on('CB:notification,,add', async (data) => {
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
    });
  }

  public configCBNotificationPromote() {
    this.wa.sock.ws.on('CB:notification,,promote', async (data) => {
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
    });
  }

  public configCBNotificationDemote() {
    this.wa.sock.ws.on('CB:notification,,demote', async (data) => {
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
          if (key.remoteJid == 'status@broadcast') continue;

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
              const time = this.wa.config.retryRequestDelayMs || 1000;

              await new Promise((res) => setTimeout(res, time * 3));

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
              timestamp = message.messageTimestamp.toNumber() * 1000;
            } else {
              timestamp = (message.messageTimestamp as number) * 1000;
            }
          }

          await this.wa.updateChat({
            id: chatId,
            unreadCount: (chat?.unreadCount || 0) + 1,
            timestamp,
            name:
              key.id?.includes('@s') && !key.fromMe
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
    this.wa.sock.ev.on('messages.upsert', async (m) => {
      try {
        await this.readMessages(m?.messages || [], m.type);
      } catch (err) {
        this.wa.emit('error', err);
      }
    });
  }

  public configMessagesUpdate() {
    this.wa.sock.ev.on('messages.update', async (messages) => {
      try {
        for (const message of messages || []) {
          try {
            if (!message.key || message.key.remoteJid == 'status@broadcast')
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
          this.wa.lastConnectionUpdateDate = Date.now();
          this.wa.status = BotStatus.Offline;
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

          this.wa.lastConnectionUpdateDate = uptime;
          this.wa.status = BotStatus.Online;
          
          // Reseta o erro de desconexão quando conecta com sucesso
          this.wa.lastDisconnectError = undefined;

          this.wa.id = fixID(this.wa.sock?.user?.id || '');
          this.wa.phoneNumber = getPhoneNumber(this.wa.id);
          this.wa.name =
            this.wa.sock?.user?.name ||
            this.wa.sock?.user?.notify ||
            this.wa.sock?.user?.verifiedName ||
            '';
          this.wa.profileUrl = this.wa.sock?.user?.imgUrl || '';

          this.wa.readUser(
            { id: this.wa.id },
            {
              notify: this.wa.name || undefined,
              imgUrl: this.wa.profileUrl || undefined,
            },
          );
          this.wa.readChat(
            { id: this.wa.id },
            { subject: this.wa.name || undefined },
          );

          this.wa.emit('open', { isNewLogin: update.isNewLogin || false });

          setTimeout(async () => {
            try {
              if (this.wa.lastConnectionUpdateDate != uptime) return;

              await this.wa.reconnect(true, false);
            } catch (error) {
              this.wa.emit('error', error);
            }
          }, this.wa.config.autoRestartInterval);

          if (this.wa.checkConnectionInterval !== null) {
            clearInterval(this.wa.checkConnectionInterval);
          }

          this.wa.checkConnectionInterval = setInterval(() => {
            if (!this.wa.sock) {
              if (this.wa.checkConnectionInterval) {
                clearInterval(this.wa.checkConnectionInterval);
                this.wa.checkConnectionInterval = null;
              }

              return;
            }

            if (this.wa.sock.ws.isOpen) return;

            this.wa.sock.ev.emit('connection.update', {
              connection: 'close',
              lastDisconnect: {
                date: new Date(),
                error: new Boom('Socket closed', {
                  statusCode: DisconnectReason.connectionClosed,
                }),
              },
            });
          }, 10000);

          this.wa.eventsIsStoped = false;

          await this.wa.sock.groupFetchAllParticipating();
        }

        if (update.connection == 'close') {
          this.wa.lastConnectionUpdateDate = Date.now();
          this.wa.status = BotStatus.Offline;

          const status =
            (update.lastDisconnect?.error as Boom)?.output?.statusCode ||
            (typeof update.lastDisconnect?.error === 'number' 
              ? update.lastDisconnect.error 
              : undefined) ||
            500;
          
          // Rastreia o último erro de desconexão (só números)
          this.wa.lastDisconnectError = typeof status === 'number' ? status : undefined;

          if (this.wa.checkConnectionInterval !== null) {
            clearInterval(this.wa.checkConnectionInterval);
            this.wa.checkConnectionInterval = null;
          }

          if (status === DisconnectReason.loggedOut || status === 401 || status === 421) {
            // Erro 401/421: Logged Out - Sessão foi morta do WhatsApp
            // Emite close com o código de erro para o cliente poder limpar as credenciais
            this.wa.emit('close', { 
              reason: status, 
              message: `Sessão desconectada do WhatsApp (${status}). Limpe a pasta de sessão e faça login novamente.` 
            });
            this.wa.emit('stop', { isLogout: true });
          } else if (status === 402) {
            this.wa.emit('stop', { isLogout: false });
          } else if (status === 428) {
            // Erro 428: Connection Terminated - Sessão inválida/corrompida
            // (já rastreado acima)
            // NÃO tenta reconectar automaticamente - a sessão precisa ser limpa
            // Emite evento específico para que o usuário possa limpar a sessão
            this.wa.emit('close', { 
              reason: status, 
              message: 'Connection Terminated (428) - Sessão inválida. Limpe a pasta de sessão e faça login novamente. Não será tentada reconexão automática.' 
            });
            // Para a reconexão automática - não adianta tentar com sessão inválida
            this.wa.emit('stop', { isLogout: false });
          } else if (status == DisconnectReason.restartRequired) {
            // IMPORTANTE: Após autenticação (QR code),
            // o WhatsApp força uma desconexão com restartRequired
            // Salva as credenciais e reconecta com um novo socket
            await this.wa.saveCreds(this.wa.sock.authState.creds);
            await this.wa.reconnect(true, true);
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

    this.wa.sock.ev.on('messaging-history.set', async (update) => {
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

          if (autoLoad) {
            // v7: tipo de chat.id permite null, mas já garantimos acima que existe
            await this.wa.readChat({ id: chat.id! }, chat as any);
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
            message.key.remoteJid == 'status@broadcast'
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
    });
  }

  public configContactsUpdate() {
    this.wa.sock.ev.on('contacts.update', async (updates) => {
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
    });
  }

  public configContactsUpsert() {
    this.wa.sock.ev.on('contacts.upsert', async (updates) => {
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
    });
  }

  public configGroupsUpdate() {
    this.wa.sock.ev.on('groups.update', async (updates) => {
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
    });
  }

  public configChatsDelete() {
    this.wa.sock.ev.on('chats.delete', async (deletions) => {
      for (const id of deletions) {
        try {
          await this.wa.removeChat(new Chat(id));
        } catch (err) {
          this.wa.emit('error', err);
        }
      }
    });
  }

  public configCall() {
    this.wa.sock.ev.on('call', async (events: WACallEvent[]) => {
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
    });
  }
}
