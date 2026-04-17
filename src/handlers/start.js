const { Markup } = require('telegraf');

module.exports = async (ctx) => {
  const telegramId = String(ctx.from.id);
  const name = ctx.from.first_name || 'User';
  
  let user = null;
  try {
    // Ultra-fast silent account linking
    const dummyEmail = `tg_${telegramId}@telegram.local`;
    user = await ctx.prisma.user.findUnique({ where: { email: dummyEmail } });
    if (!user) {
      user = await ctx.prisma.user.create({
        data: {
          name: name,
          email: dummyEmail,
        }
      });
    }
  } catch(e) {
    console.error('Database user creation error:', e);
  }

  let keyboard = [
      [Markup.button.callback('🛒 Browse Categories', 'BROWSE_CATEGORIES')],
      [Markup.button.callback('🛍️ View Cart', 'VIEW_CART')],
      [Markup.button.callback('📦 My Orders', 'MY_ORDERS')]
  ];

  if (user && user.role === 'ADMIN') {
    keyboard.push([Markup.button.callback('🛡️ Admin Panel', 'ADMIN_PANEL')]);
  }

  await ctx.reply(
    `Welcome to the FreshCart Grocery Bot, ${name}! 🥗🛒\n\nExperience our ultra-fast integrated store straight from Telegram! What would you like to do?`,
    Markup.inlineKeyboard(keyboard)
  );
};
