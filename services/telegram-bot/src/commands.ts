/**
 * Telegram bot command handlers.
 *
 * Commands:
 *   /start      — Welcome message
 *   /help       — Detailed help
 *   /connect    — Link Telegram account to HyperQuote agent
 *   /disconnect — Unlink and stop alerts
 *   /subscribe  — Configure alert filters (inline keyboard or text args)
 *   /unsubscribe — Pause alerts
 *   /status     — Show connection status and filters
 */

import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  getUser,
  linkUser,
  unlinkUser,
  updateFilters,
  decryptUserApiKey,
  encryptApiKey,
} from "./store.js";
import {
  ensureConnection,
  removeUserFromConnection,
  getConnectionStatus,
  getUserAlertCount,
  refreshSubscription,
} from "./alertStream.js";
import { symbolToAddress, allTokenSymbols } from "./tokenMap.js";
import type { AgentAuthInfo, AlertEventType } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NEXTJS_URL = process.env.NEXTJS_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Auth helper — validate token via Next.js API
// ---------------------------------------------------------------------------

async function validateToken(token: string): Promise<AgentAuthInfo | null> {
  if (!token || !token.startsWith("hq_live_")) return null;

  try {
    const res = await fetch(`${NEXTJS_URL}/api/v1/agent/auth`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      agent?: Partial<AgentAuthInfo>;
      id?: string;
      name?: string;
      owner?: string;
      wallet?: string;
      roles?: string[];
    };

    return {
      id: data.agent?.id ?? data.id ?? "",
      name: data.agent?.name ?? data.name ?? "Unknown",
      owner: data.agent?.owner ?? data.owner ?? "",
      wallet: (data.agent?.wallet ?? data.wallet ?? "").toLowerCase(),
      roles: data.agent?.roles ?? data.roles ?? [],
    };
  } catch (err) {
    console.error("[commands] Token validation error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: require linked user
// ---------------------------------------------------------------------------

function requireLinked(ctx: Context): ReturnType<typeof getUser> {
  const userId = ctx.from?.id?.toString();
  if (!userId) return null;
  return getUser(userId);
}

function fmtWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------

export function registerCommands(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    const user = userId ? getUser(userId) : null;

    if (user) {
      const status = getConnectionStatus(user.agentId);
      await ctx.reply(
        `<b>HyperQuote Alert Bot</b>\n\n` +
          `You're linked to agent <b>${fmtWallet(user.agentWallet)}</b>.\n` +
          `Connection: ${status === "authenticated" ? "Connected" : status}\n` +
          `Alerts: ${user.alertsEnabled ? "Enabled" : "Paused"}\n\n` +
          `Use /status for details or /help for commands.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await ctx.reply(
      `<b>HyperQuote Alert Bot</b>\n\n` +
        `Get real-time RFQ alerts from HyperQuote delivered to your Telegram.\n\n` +
        `<b>Getting started:</b>\n` +
        `1. Register an agent at hyperquote.io/maker\n` +
        `2. Copy your API key (<code>hq_live_...</code>)\n` +
        `3. Run <code>/connect YOUR_API_KEY</code>\n\n` +
        `<b>Commands:</b>\n` +
        `/connect — Link your agent\n` +
        `/subscribe — Customize filters\n` +
        `/status — View connection status\n` +
        `/help — Detailed help`,
      { parse_mode: "HTML" }
    );
  });

  // ---------------------------------------------------------------------------
  // /help
  // ---------------------------------------------------------------------------

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `<b>HyperQuote Alert Bot — Commands</b>\n\n` +
        `<code>/connect &lt;api_key&gt;</code>\n` +
        `Link your HyperQuote agent. The message with your key is deleted immediately for security.\n\n` +
        `<code>/disconnect</code>\n` +
        `Unlink your agent and stop all alerts.\n\n` +
        `<code>/subscribe</code>\n` +
        `Open an interactive menu to configure alert filters (tokens, visibility, events).\n\n` +
        `<code>/subscribe tokens=HYPE,PURR visibility=public events=created</code>\n` +
        `Set filters inline. Options:\n` +
        `  <code>tokens</code> — Comma-separated: ${allTokenSymbols().join(", ")}\n` +
        `  <code>visibility</code> — all, public, private\n` +
        `  <code>events</code> — created, filled, both\n` +
        `  <code>min_usd</code> — Minimum RFQ size in USD\n\n` +
        `<code>/unsubscribe</code>\n` +
        `Pause alerts without disconnecting.\n\n` +
        `<code>/status</code>\n` +
        `Show linked agent, connection state, and active filters.`,
      { parse_mode: "HTML" }
    );
  });

  // ---------------------------------------------------------------------------
  // /connect
  // ---------------------------------------------------------------------------

  bot.command("connect", async (ctx) => {
    // Only allow in private chat
    if (ctx.chat?.type !== "private") {
      await ctx.reply(
        "For security, /connect only works in private chat with the bot."
      );
      return;
    }

    // Immediately delete the user's message (contains the API key)
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message!.message_id);
    } catch {
      // May fail if bot doesn't have delete permission — continue anyway
    }

    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply(
        "Usage: <code>/connect hq_live_your_api_key</code>\n\n" +
          "Your message will be deleted immediately to protect your key.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const token = args;
    if (!token.startsWith("hq_live_")) {
      await ctx.reply(
        "Invalid API key format. Keys start with <code>hq_live_</code>.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Validate the token
    const agentInfo = await validateToken(token);
    if (!agentInfo) {
      await ctx.reply(
        "Invalid or expired API key. Please check and try again."
      );
      return;
    }

    const userId = ctx.from!.id.toString();
    const username = ctx.from!.username ?? null;

    // Check if already linked to a different agent
    const existing = getUser(userId);
    if (existing && existing.agentId !== agentInfo.id) {
      // Remove from old connection before linking new
      removeUserFromConnection(existing.agentId, userId);
    }

    // Store encrypted key and link user
    const encrypted = encryptApiKey(token);
    const user = linkUser({
      telegramUserId: userId,
      telegramUsername: username,
      agentId: agentInfo.id,
      agentWallet: agentInfo.wallet,
      apiKey: token,
    });

    // Ensure WS connection
    ensureConnection(agentInfo.id, userId, token, agentInfo.wallet, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    });

    await ctx.reply(
      `Connected to agent <b>${agentInfo.name}</b>\n` +
        `Wallet: <code>${fmtWallet(agentInfo.wallet)}</code>\n\n` +
        `You'll now receive RFQ alerts. Use /subscribe to customize filters.`,
      { parse_mode: "HTML" }
    );
  });

  // ---------------------------------------------------------------------------
  // /disconnect
  // ---------------------------------------------------------------------------

  bot.command("disconnect", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    const user = getUser(userId);
    if (!user) {
      await ctx.reply("You're not connected. Use /connect to link your agent.");
      return;
    }

    // Remove from WS pool
    removeUserFromConnection(user.agentId, userId);
    // Delete from database
    unlinkUser(userId);

    await ctx.reply(
      "Disconnected. You'll no longer receive alerts.\n" +
        "Use /connect to link again."
    );
  });

  // ---------------------------------------------------------------------------
  // /status
  // ---------------------------------------------------------------------------

  bot.command("status", async (ctx) => {
    const user = requireLinked(ctx);
    if (!user) {
      await ctx.reply("You're not connected. Use /connect to link your agent.");
      return;
    }

    const wsStatus = getConnectionStatus(user.agentId);
    const alertCount = getUserAlertCount(user.telegramUserId);

    const statusEmoji =
      wsStatus === "authenticated"
        ? "\u2705"
        : wsStatus === "connecting"
          ? "\u23f3"
          : "\u274c";

    const tokenDisplay =
      user.filterTokens.length > 0
        ? user.filterTokens
            .map((t) => t.slice(0, 8) + "...")
            .join(", ")
        : "All tokens";

    const eventsDisplay = user.filterEventTypes.join(", ");

    await ctx.reply(
      `<b>HyperQuote Alert Bot</b>\n\n` +
        `<b>Agent:</b> <code>${fmtWallet(user.agentWallet)}</code>\n` +
        `<b>Connection:</b> ${statusEmoji} ${wsStatus}\n` +
        `<b>Alerts:</b> ${user.alertsEnabled ? "Enabled" : "Paused"}\n\n` +
        `<b>Filters:</b>\n` +
        `  Tokens: ${tokenDisplay}\n` +
        `  Visibility: ${user.filterVisibility}\n` +
        `  Events: ${eventsDisplay}\n` +
        `  Min Size: $${user.filterMinUsd.toLocaleString()}\n\n` +
        `<b>Session:</b> ${alertCount} alert(s) delivered`,
      { parse_mode: "HTML" }
    );
  });

  // ---------------------------------------------------------------------------
  // /subscribe (inline keyboard mode when no args)
  // ---------------------------------------------------------------------------

  bot.command("subscribe", async (ctx) => {
    const user = requireLinked(ctx);
    if (!user) {
      await ctx.reply("You're not connected. Use /connect to link your agent.");
      return;
    }

    const args = ctx.match?.trim();

    if (args) {
      // Inline text mode: /subscribe tokens=HYPE,PURR visibility=public
      handleSubscribeText(ctx, user, args);
      return;
    }

    // Interactive keyboard mode
    await sendSubscribeKeyboard(ctx, user);
  });

  // ---------------------------------------------------------------------------
  // /unsubscribe
  // ---------------------------------------------------------------------------

  bot.command("unsubscribe", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    const user = getUser(userId);
    if (!user) {
      await ctx.reply("You're not connected. Use /connect to link your agent.");
      return;
    }

    updateFilters(userId, { alertsEnabled: false });
    refreshSubscription(user.agentId);

    await ctx.reply(
      "Alerts paused. Use /subscribe to re-enable and configure filters."
    );
  });

  // ---------------------------------------------------------------------------
  // Inline keyboard callback handler
  // ---------------------------------------------------------------------------

  bot.on("callback_query:data", async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = getUser(userId);
    if (!user) {
      await ctx.answerCallbackQuery("Not connected. Use /connect first.");
      return;
    }

    const data = ctx.callbackQuery.data;

    if (data.startsWith("sub_token_")) {
      const symbol = data.replace("sub_token_", "");
      handleTokenToggle(ctx, user, symbol);
      return;
    }

    if (data.startsWith("sub_vis_")) {
      const vis = data.replace("sub_vis_", "") as "all" | "public" | "private";
      updateFilters(userId, { visibility: vis });
      refreshSubscription(user.agentId);
      const updated = getUser(userId)!;
      await ctx.editMessageReplyMarkup({
        reply_markup: buildSubscribeKeyboard(updated),
      });
      await ctx.answerCallbackQuery(`Visibility: ${vis}`);
      return;
    }

    if (data.startsWith("sub_evt_")) {
      const evtKey = data.replace("sub_evt_", "");
      handleEventToggle(ctx, user, evtKey);
      return;
    }

    if (data === "sub_confirm") {
      // Re-enable alerts on confirm
      updateFilters(userId, { alertsEnabled: true });
      refreshSubscription(user.agentId);
      await ctx.editMessageText(
        "Subscription updated. You'll receive matching alerts.",
        { parse_mode: "HTML" }
      );
      await ctx.answerCallbackQuery("Subscription saved!");
      return;
    }

    await ctx.answerCallbackQuery();
  });
}

// ---------------------------------------------------------------------------
// Subscribe: inline text mode
// ---------------------------------------------------------------------------

async function handleSubscribeText(
  ctx: Context,
  user: ReturnType<typeof getUser> & {},
  args: string
): Promise<void> {
  const userId = ctx.from!.id.toString();
  const params: Parameters<typeof updateFilters>[1] = {
    alertsEnabled: true,
  };

  // Parse key=value pairs
  const pairs = args.split(/\s+/);
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (!key || !value) continue;

    switch (key.toLowerCase()) {
      case "tokens": {
        const symbols = value.split(",").map((s) => s.trim());
        const addresses: string[] = [];
        const invalid: string[] = [];

        for (const sym of symbols) {
          const addr = symbolToAddress(sym);
          if (addr) {
            addresses.push(addr);
          } else {
            invalid.push(sym);
          }
        }

        if (invalid.length > 0) {
          await ctx.reply(
            `Unknown token(s): ${invalid.join(", ")}. Available: ${allTokenSymbols().join(", ")}`,
          );
          return;
        }

        params.tokens = [...new Set(addresses)];
        break;
      }

      case "visibility":
      case "vis": {
        const v = value.toLowerCase();
        if (["all", "public", "private"].includes(v)) {
          params.visibility = v as "all" | "public" | "private";
        }
        break;
      }

      case "events":
      case "evt": {
        const evts = value.split(",").map((e) => e.trim().toLowerCase());
        const mapped: AlertEventType[] = [];
        for (const e of evts) {
          if (e === "created" || e === "rfq.created") mapped.push("rfq.created");
          if (e === "filled" || e === "rfq.filled") mapped.push("rfq.filled");
          if (e === "both" || e === "all") {
            mapped.push("rfq.created", "rfq.filled");
          }
        }
        if (mapped.length > 0) {
          params.eventTypes = [...new Set(mapped)];
        }
        break;
      }

      case "min_usd":
      case "min": {
        const num = parseFloat(value);
        if (!isNaN(num)) params.minUsd = num;
        break;
      }
    }
  }

  updateFilters(userId, params);
  refreshSubscription(user.agentId);

  const updated = getUser(userId)!;
  const tokenDisplay =
    updated.filterTokens.length > 0
      ? updated.filterTokens.map((t) => t.slice(0, 8) + "...").join(", ")
      : "All";

  await ctx.reply(
    `<b>Subscription updated</b>\n` +
      `Tokens: ${tokenDisplay}\n` +
      `Visibility: ${updated.filterVisibility}\n` +
      `Events: ${updated.filterEventTypes.join(", ")}\n` +
      `Min Size: $${updated.filterMinUsd.toLocaleString()}`,
    { parse_mode: "HTML" }
  );
}

// ---------------------------------------------------------------------------
// Subscribe: inline keyboard mode
// ---------------------------------------------------------------------------

const SUBSCRIBE_TOKENS = ["HYPE", "kHYPE", "PURR", "KNTQ", "HPL"];

function buildSubscribeKeyboard(
  user: ReturnType<typeof getUser> & {}
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Row 1: Token selection
  const userTokenAddrs = new Set(user.filterTokens.map((t) => t.toLowerCase()));
  for (const sym of SUBSCRIBE_TOKENS) {
    const addr = symbolToAddress(sym);
    const isActive = addr ? userTokenAddrs.has(addr.toLowerCase()) : false;
    const label = isActive ? `${sym} \u2713` : sym;
    kb.text(label, `sub_token_${sym}`);
  }
  // "All" button
  const allTokens = user.filterTokens.length === 0;
  kb.text(allTokens ? "All \u2713" : "All", "sub_token_ALL");
  kb.row();

  // Row 2: Visibility
  const visOptions = ["all", "public", "private"] as const;
  for (const v of visOptions) {
    const isActive = user.filterVisibility === v;
    const label = isActive
      ? `${v.charAt(0).toUpperCase() + v.slice(1)} \u2713`
      : v.charAt(0).toUpperCase() + v.slice(1);
    kb.text(label, `sub_vis_${v}`);
  }
  kb.row();

  // Row 3: Event types
  const hasCreated = user.filterEventTypes.includes("rfq.created");
  const hasFilled = user.filterEventTypes.includes("rfq.filled");
  kb.text(
    hasCreated ? "Created \u2713" : "Created",
    "sub_evt_created"
  );
  kb.text(
    hasFilled ? "Filled \u2713" : "Filled",
    "sub_evt_filled"
  );
  kb.row();

  // Row 4: Confirm
  kb.text("\u2705 Confirm", "sub_confirm");

  return kb;
}

async function sendSubscribeKeyboard(
  ctx: Context,
  user: ReturnType<typeof getUser> & {}
): Promise<void> {
  await ctx.reply("<b>Configure Alert Filters</b>\n\nSelect options below:", {
    parse_mode: "HTML",
    reply_markup: buildSubscribeKeyboard(user),
  });
}

function handleTokenToggle(
  ctx: Context & { answerCallbackQuery: (text?: string) => Promise<unknown> },
  user: ReturnType<typeof getUser> & {},
  symbol: string
): void {
  const userId = ctx.from!.id.toString();

  if (symbol === "ALL") {
    // Clear token filter = all tokens
    updateFilters(userId, { tokens: [] });
  } else {
    const addr = symbolToAddress(symbol);
    if (!addr) {
      ctx.answerCallbackQuery(`Unknown token: ${symbol}`);
      return;
    }

    const current = new Set(user.filterTokens.map((t) => t.toLowerCase()));

    if (current.has(addr.toLowerCase())) {
      current.delete(addr.toLowerCase());
    } else {
      current.add(addr.toLowerCase());
    }

    updateFilters(userId, { tokens: [...current] });
  }

  refreshSubscription(user.agentId);
  const updated = getUser(userId)!;

  // Update keyboard in place
  ctx.editMessageReplyMarkup({
    reply_markup: buildSubscribeKeyboard(updated),
  });
  ctx.answerCallbackQuery(`Token: ${symbol}`);
}

function handleEventToggle(
  ctx: Context & { answerCallbackQuery: (text?: string) => Promise<unknown> },
  user: ReturnType<typeof getUser> & {},
  evtKey: string
): void {
  const userId = ctx.from!.id.toString();
  const current = new Set(user.filterEventTypes);

  const eventType: AlertEventType =
    evtKey === "created" ? "rfq.created" : "rfq.filled";

  if (current.has(eventType)) {
    // Don't allow removing the last event type
    if (current.size <= 1) {
      ctx.answerCallbackQuery("At least one event type required");
      return;
    }
    current.delete(eventType);
  } else {
    current.add(eventType);
  }

  updateFilters(userId, {
    eventTypes: [...current] as AlertEventType[],
  });
  refreshSubscription(user.agentId);
  const updated = getUser(userId)!;

  ctx.editMessageReplyMarkup({
    reply_markup: buildSubscribeKeyboard(updated),
  });
  ctx.answerCallbackQuery(`Event: ${evtKey}`);
}
