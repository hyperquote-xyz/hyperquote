/**
 * grammY bot instance with middleware and command registration.
 *
 * Uses long-polling mode. Private-chat-only enforcement is applied
 * via middleware for sensitive commands.
 */

import { Bot } from "grammy";
import { registerCommands } from "./commands.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create bot instance
// ---------------------------------------------------------------------------

export const bot = new Bot(BOT_TOKEN);

// ---------------------------------------------------------------------------
// Middleware: error handling
// ---------------------------------------------------------------------------

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(
    `[bot] Error handling update ${ctx.update.update_id}:`,
    err.error
  );
});

// ---------------------------------------------------------------------------
// Register commands
// ---------------------------------------------------------------------------

registerCommands(bot);

// ---------------------------------------------------------------------------
// Fallback for unknown messages
// ---------------------------------------------------------------------------

bot.on("message:text", async (ctx) => {
  // Only respond to private messages that aren't commands
  if (ctx.chat.type !== "private") return;
  if (ctx.message.text.startsWith("/")) {
    await ctx.reply(
      "Unknown command. Use /help to see available commands."
    );
    return;
  }
  // Ignore non-command messages in private chat
});

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

export async function startBot(): Promise<void> {
  // Set bot commands for the menu button
  await bot.api.setMyCommands([
    { command: "start", description: "Welcome message" },
    { command: "help", description: "Show all commands" },
    { command: "connect", description: "Link your HyperQuote agent" },
    { command: "disconnect", description: "Unlink and stop alerts" },
    { command: "subscribe", description: "Configure alert filters" },
    { command: "unsubscribe", description: "Pause alerts" },
    { command: "status", description: "View connection status" },
  ]);

  // Start long-polling
  bot.start({
    onStart: () => {
      console.log("[bot] Telegram bot started (long-polling)");
    },
  });
}

export function stopBot(): void {
  bot.stop();
  console.log("[bot] Telegram bot stopped");
}
