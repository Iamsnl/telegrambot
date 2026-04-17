const { Markup } = require('telegraf');

exports.setup = (bot) => {
  bot.action('BROWSE_CATEGORIES', async (ctx) => {
    try {
      const categories = await ctx.prisma.category.findMany();
      if (categories.length === 0) {
        return ctx.editMessageText('No categories available right now.');
      }
      
      const buttons = categories.map(cat => [Markup.button.callback(cat.name, `CATEGORY_${cat.id}`)]);
      buttons.push([Markup.button.callback('🔙 Back to Main Menu', 'MAIN_MENU')]);
      
      await ctx.editMessageText('Select a category to browse:', Markup.inlineKeyboard(buttons));
    } catch(err) { console.error(err); }
  });

  bot.action(/^CATEGORY_(.+)$/, async (ctx) => {
    const categoryId = ctx.match[1];
    try {
      const products = await ctx.prisma.product.findMany({ where: { categoryId: categoryId } });
      if (products.length === 0) {
         return ctx.editMessageText('We are out of stock for products in this category right now.', Markup.inlineKeyboard([
           [Markup.button.callback('🔙 Back to Categories', 'BROWSE_CATEGORIES')]
         ]));
      }

      const buttons = products.map(p => [Markup.button.callback(`➕ ${p.name} - ₹${p.price.toFixed(2)}`, `ADD_${p.id}`)]);
      buttons.push([Markup.button.callback('🔙 Back to Categories', 'BROWSE_CATEGORIES')]);
      
      await ctx.editMessageText('Select a product to seamlessly add it to your cart:', Markup.inlineKeyboard(buttons));
    } catch (err){ console.error(err); }
  });

  bot.action(/^ADD_(.+)$/, async (ctx) => {
    const productId = ctx.match[1];
    
    const product = await ctx.prisma.product.findUnique({ where: { id: productId }});
    if(!product) return ctx.answerCbQuery('Product unavailable.');
    
    const existing = ctx.session.cart.find(i => i.id === productId);
    if(existing) { existing.quantity += 1; }
    else { ctx.session.cart.push({ id: product.id, name: product.name, price: product.price, quantity: 1 }); }
    
    await ctx.answerCbQuery(`✅ Added ${product.name} to cart!`);
  });

  bot.action('VIEW_CART', async (ctx) => {
     if(!ctx.session.cart || ctx.session.cart.length === 0) {
       return ctx.editMessageText('Your cart is completely empty! 🛒', Markup.inlineKeyboard([
          [Markup.button.callback('🛒 Browse Categories', 'BROWSE_CATEGORIES')],
          [Markup.button.callback('🔙 Back to Main Menu', 'MAIN_MENU')]
       ]));
     }
     
     let text = '*Your Superfast Cart:*\n\n';
     let total = 0;
     ctx.session.cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        text += `${index + 1}. ${item.name} x${item.quantity} = ₹${itemTotal.toFixed(2)}\n`;
     });
     text += `\n*Total:* ₹${total.toFixed(2)}`;
     
     await ctx.editMessageText(text, {
       parse_mode: 'Markdown',
       ...Markup.inlineKeyboard([
         [Markup.button.callback('💳 Checkout', 'CHECKOUT')],
         [Markup.button.callback('🧹 Clear Cart', 'CLEAR_CART')],
         [Markup.button.callback('🔙 Back to Main Menu', 'MAIN_MENU')]
       ])
     });
  });

  bot.action('CLEAR_CART', async (ctx) => {
    ctx.session.cart = [];
    await ctx.answerCbQuery('🗑️ Cart successfully cleared!');
    await ctx.editMessageText('Your cart is completely empty! 🛒', Markup.inlineKeyboard([
      [Markup.button.callback('🛒 Browse Categories', 'BROWSE_CATEGORIES')]
    ]));
  });

  bot.action('MAIN_MENU', async (ctx) => {
    const telegramId = String(ctx.from.id);
    const dummyEmail = `tg_${telegramId}@telegram.local`;
    const user = await ctx.prisma.user.findUnique({ where: { email: dummyEmail }});

    let keyboard = [
      [Markup.button.callback('🛒 Browse Categories', 'BROWSE_CATEGORIES')],
      [Markup.button.callback('🛍️ View Cart', 'VIEW_CART')],
      [Markup.button.callback('📦 My Orders', 'MY_ORDERS')]
    ];
    
    if (user && user.role === 'ADMIN') {
      keyboard.push([Markup.button.callback('🛡️ Admin Panel', 'ADMIN_PANEL')]);
    }

    await ctx.editMessageText('Welcome back to the main menu! What would you like to do?', Markup.inlineKeyboard(keyboard));
  });
  
  bot.action('MY_ORDERS', async (ctx) => {
     const telegramId = String(ctx.from.id);
     const dummyEmail = `tg_${telegramId}@telegram.local`;
     try {
       const user = await ctx.prisma.user.findUnique({ where: { email: dummyEmail }});
       if(!user) return ctx.editMessageText('No orders placed yet.', Markup.inlineKeyboard([[Markup.button.callback('🔙 Main Menu', 'MAIN_MENU')]]));
       
       const orders = await ctx.prisma.order.findMany({ 
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 5 
       });
       
       if (orders.length === 0) return ctx.editMessageText('No orders placed yet.', Markup.inlineKeyboard([[Markup.button.callback('🔙 Main Menu', 'MAIN_MENU')]]));
       
       let text = '*Your recent bot orders:*\n\n';
       orders.forEach(o => {
          text += `🆔 ${o.id.substring(0,8)} | 🚦 ${o.status}\n💰 Total: ₹${o.total.toFixed(2)} | 📍 ${o.deliveryAddress}\n\n`;
       });
       
       await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Main Menu', 'MAIN_MENU')]]) });
     } catch(e) { console.error(e); }
  });
};
