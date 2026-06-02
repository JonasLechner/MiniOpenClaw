export type Channel = "telegram";

export type TelegramChannelTarget = {
  channel: "telegram";
  chatId: string;
  userId: string;
};

export type ChannelTarget = TelegramChannelTarget;
