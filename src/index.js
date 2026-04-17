require('dotenv').config();
const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

if (!process.env.BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN is empty in .env. Please add it and restart.");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Create LocalSession using pure RAM memory for ultra-fast performance on an 8GB VPS
// This entirely eliminates disk I/O latency, making the bot incredibly responsive
const localSession = new LocalSession({ storage: LocalSession.storageMemory });
bot.use(localSession.middleware());

// Inject prisma into ctx
bot.context.prisma = prisma;

bot.use((ctx, next) => {
  ctx.session = ctx.session || {};
  ctx.session.cart = ctx.session.cart || [];
  return next();
});

const startHandler = require('./handlers/start');
const shopHandler = require('./handlers/shop');
const checkoutHandler = require('./handlers/checkout');
const adminHandler = require('./handlers/admin');

bot.command('start', startHandler);
adminHandler.setup(bot);
shopHandler.setup(bot);
checkoutHandler.setup(bot);

bot.launch().then(() => {
  console.log('Bot is running... Awaiting messages.');
}).catch(err => {
  console.error("Bot launch error:", err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
