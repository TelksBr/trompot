import { WASocket, MessageUpsertType, proto, isJidGroup } from '@whiskeysockets/baileys';
import { ILoggerService } from '../interfaces/ILoggerService';
import ConvertWAMessage from '../ConvertWAMessage';
import ErrorMessage from '../../messages/ErrorMessage';
import { fixID } from '../ID';
import WhatsAppBot from '../WhatsAppBot';
import Chat from '../../modules/chat/Chat';
import User from '../../modules/user/User';
import ChatType from '../../modules/chat/ChatType';
import Long from 'long';
import { ErrorUtils } from '../utils/ErrorUtils';
import { JID_PATTERNS } from '../constants/JIDPatterns';
import { ConfigDefaults, TIMESTAMP_MULTIPLIER } from '../constants/ConfigDefaults';

export class MessageEventHandler {
  private bot: WhatsAppBot;
  private logger: ILoggerService;

  constructor(bot: WhatsAppBot, logger: ILoggerService) {
    this.bot = bot;
    this.logger = logger;
  }

  /**
   * Configura handlers para eventos de mensagens
   */
  setup(socket: WASocket): void {
    // messages.upsert - Novas mensagens (CRÍTICO: processar TODAS as mensagens do array)
    socket.ev.on('messages.upsert', async (m) => {
      await ErrorUtils.safeExecute(
        () => this.readMessages(m?.messages || [], m.type),
        'MessageEventHandler.messages.upsert',
        this.logger,
        this.bot
      );
    });

    // messages.update - Atualizações de mensagens
    socket.ev.on('messages.update', async (messages) => {
      await ErrorUtils.safeExecute(
        async () => {
        for (const message of messages || []) {
          try {
              if (!message.key || message.key.remoteJid === JID_PATTERNS.BROADCAST) return;

            await this.readMessages([{ key: message.key, ...message.update }]);

            if (!message?.update?.status) return;

            const msg = await new ConvertWAMessage(this.bot, message).get();
            msg.isUpdate = true;
            this.bot.emit('message', msg);
          } catch (err) {
              // Erro individual em mensagem não deve parar o processamento
              const errorMsg = ErrorUtils.handleMessageError(err, message?.key?.remoteJid, this.logger);
              this.bot.emit('message', errorMsg);
          }
        }
        },
        'MessageEventHandler.messages.update',
        this.logger,
        this.bot
      );
    });
  }

  /**
   * Lê e processa mensagens (v7.0.0: processa TODAS as mensagens do array)
   */
  public async readMessages(
    messages: proto.IWebMessageInfo[],
    type: MessageUpsertType = 'notify',
  ) {
    try {
      // CRÍTICO v7.0.0: Processar TODAS as mensagens do array, não apenas a primeira
      for (const message of messages || []) {
        try {
          if (!message) continue;

          const key = message.key;
          if (!key) continue;
          if (key.remoteJid === JID_PATTERNS.BROADCAST) continue;

          if (!message.message) {
            if (
              !(message.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT)
            ) {
              continue; // Not read other null messages - CORRIGIDO: usar continue em vez de return
            }

            const msgRetryCount =
              this.bot.config.msgRetryCounterCache?.get<number>(key.id!);

            if (msgRetryCount !== this.bot.config.maxMsgRetryCount) {
              const time = this.bot.config.retryRequestDelayMs || ConfigDefaults.DEFAULT_RETRY_DELAY;
              await new Promise((res) => setTimeout(res, time * ConfigDefaults.RETRY_DELAY_MULTIPLIER));

              const newMsgRetryCount =
                this.bot.config.msgRetryCounterCache?.get<number>(key.id!);

              if (!this.bot.config.readAllFailedMessages) {
                if (
                  msgRetryCount &&
                  newMsgRetryCount &&
                  msgRetryCount !== newMsgRetryCount
                ) {
                  return; // Not read duplicated failed message
                }
              }
            }
          }

          // Ignora mensagens de protocolo
          if (
            message.message?.protocolMessage?.type ===
              proto.Message.ProtocolMessage.Type.EPHEMERAL_SYNC_RESPONSE ||
            message.message?.protocolMessage?.type ===
              proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_SHARE ||
            message.message?.protocolMessage?.type ===
              proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_REQUEST ||
            message.message?.protocolMessage?.type ===
              proto.Message.ProtocolMessage.Type
                .APP_STATE_FATAL_EXCEPTION_NOTIFICATION ||
            message.message?.protocolMessage?.type ===
              proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING ||
            message.message?.protocolMessage?.type ===
              proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION ||
            message.message?.protocolMessage?.type ===
              proto.Message.ProtocolMessage.Type
                .INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC
          ) {
            continue; // Not read empty messages - CORRIGIDO: usar continue em vez de return
          }

          if (this.bot.messagesCached.includes(key.id!)) continue; // CORRIGIDO: usar continue em vez de return
          this.bot.addMessageCache(key.id!);

          const chatId = fixID(key.remoteJid || this.bot.id);

          // Calcula timestamp sem bloquear
          let timestamp: number | undefined;
          if (message.messageTimestamp) {
            if (Long.isLong(message.messageTimestamp)) {
              timestamp = message.messageTimestamp.toNumber() * TIMESTAMP_MULTIPLIER;
            } else {
              timestamp = (message.messageTimestamp as number) * TIMESTAMP_MULTIPLIER;
            }
          }

          // Converte mensagem PRIMEIRO - isso é o mais importante
          const msg = await new ConvertWAMessage(
            this.bot,
            message as any,
            type,
          ).get();

          // Emite a mensagem IMEDIATAMENTE - sem bloqueios
          this.bot.emit('message', msg);

          // Atualiza cache em background (opcional - não bloqueia)
          // Esses dados são apenas para cache, não são necessários para processar a mensagem
          const userId = fixID(
            key.fromMe
              ? this.bot.id
              : key.participant ||
                  message.participant ||
                  key.remoteJid ||
                  '',
          );

          // Atualiza cache diretamente sem passar por getChat/getUser
          // Isso evita chamadas bloqueantes ao funcHandler
          // Esses dados são apenas para cache - não são necessários para processar a mensagem
          Promise.allSettled([
            // Atualiza chat diretamente no cache sem buscar primeiro
            this.bot.auth.get(`chats-${chatId}`)
              .then((chatData: any) => {
                const currentUnreadCount = chatData?.unreadCount || 0;
                const newChat = {
                  ...(chatData || {}),
                  id: chatId,
                  unreadCount: currentUnreadCount + 1,
                  timestamp: timestamp || chatData?.timestamp,
                  name: chatData?.name || (
                    key.id?.includes(JID_PATTERNS.USER) && !key.fromMe
                      ? message.pushName || message.verifiedBizName || undefined
                      : undefined
                  ),
                  type: isJidGroup(chatId) ? ChatType.Group : ChatType.PV,
                };
                return this.bot.auth.set(`chats-${chatId}`, newChat);
              })
              .catch(() => {
                // Se não existir, cria novo
                const newChat = {
                  id: chatId,
                  unreadCount: 1,
                  timestamp,
                  name:
                    key.id?.includes(JID_PATTERNS.USER) && !key.fromMe
                      ? message.pushName || message.verifiedBizName || undefined
                      : undefined,
                  type: isJidGroup(chatId) ? ChatType.Group : ChatType.PV,
                };
                return this.bot.auth.set(`chats-${chatId}`, newChat);
              }),
            // Atualiza user diretamente no cache sem buscar primeiro
            this.bot.auth.get(`users-${userId}`)
              .then((userData: any) => {
                const newUser = {
                  ...(userData || {}),
                  id: userId,
                  name: userData?.name || message.pushName || message.verifiedBizName || undefined,
                };
                return this.bot.auth.set(`users-${userId}`, newUser);
              })
              .catch(() => {
                // Se não existir, cria novo
                const newUser = {
                  id: userId,
                  name: message.pushName || message.verifiedBizName || undefined,
                };
                return this.bot.auth.set(`users-${userId}`, newUser);
              }),
          ]).catch(() => {
            // Ignora erros - não é crítico
          });

          if (msg.fromMe && msg.isUnofficial) {
            // Também em background
            this.bot.updateChat({ id: msg.chat.id, unreadCount: 0 }).catch(() => {
              // Ignora erros
            });
          }

          // Continua para processar próxima mensagem (já foi emitida acima)
          continue;

          // Log de debug para verificar se mensagens estão sendo emitidas
          this.logger.debug(
            {
              chatId: msg.chat.id,
              messageId: msg.id,
              type: msg.type,
              fromMe: msg.fromMe,
              isOld: msg.isOld,
            },
            'Emitindo mensagem do WhatsAppBot'
          );

          // Mensagem já foi emitida acima - não emitir novamente
        } catch (err) {
          // Erro individual em mensagem não deve parar o processamento
          const errorMsg = ErrorUtils.handleMessageError(err, message?.key?.remoteJid, this.logger);
          this.bot.emit('message', errorMsg);
        }
      }
    } catch (err) {
      ErrorUtils.handleHandlerError(err, 'MessageEventHandler.readMessages', this.logger, this.bot);
    }
  }
}

