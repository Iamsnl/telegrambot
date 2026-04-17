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

// Create LocalSession for an ultra-fast temporary cart DB
const localSession = new LocalSession({ database: 'session_db.json' });
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
