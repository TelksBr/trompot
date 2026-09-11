export type {
  Message as TelegramMessage,
  Chat as TelegramChat,
  ChatFullInfo as TelegramChatFullInfo,
  User as TelegramUser,
  Contact as TelegramContact,
  MessageEntity as TelegramMessageEntity,
  TelegramBotOptions,
  ReplyParameters,
  InputPollOption,
  InlineKeyboardMarkup,
} from 'node-telegram-bot-api';

export type FileMeta = {
  filename?: string;
  contentType?: string;
};
