// Ambient module declarations for packages without bundled types
// These allow TypeScript to compile without @types/* packages

declare module "uuid" {
  export function v4(): string;
  export function v1(): string;
  export function v5(name: string, namespace: string): string;
}

declare module "node-telegram-bot-api" {
  interface SendMessageOptions {
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
    disable_web_page_preview?: boolean;
    disable_notification?: boolean;
    reply_to_message_id?: number;
  }

  class TelegramBot {
    constructor(token: string, options?: { polling?: boolean });
    sendMessage(chatId: string | number, text: string, options?: SendMessageOptions): Promise<unknown>;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }

  export = TelegramBot;
}
