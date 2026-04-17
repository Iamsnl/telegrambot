const { Markup } = require('telegraf');

exports.setup = (bot) => {
  bot.action('CHECKOUT', async (ctx) => {
    if(!ctx.session.cart || ctx.session.cart.length === 0) return ctx.answerCbQuery('Cart is empty!');
    
    ctx.session.waitingForAddress = true;
    await ctx.editMessageText('🚚 To proceed with the ultra-fast checkout, please reply to this message with your full delivery address:');
  });

  bot.on('text', async (ctx, next) => {
    if(!ctx.session.waitingForAddress) return next();
    
    const address = ctx.message.text;
    ctx.session.waitingForAddress = false;
    
    const telegramId = String(ctx.from.id);
    const dummyEmail = `tg_${telegramId}@telegram.local`;
    
    try {
       const user = await ctx.prisma.user.findUnique({ where: { email: dummyEmail }});
       if (!user) return ctx.reply('Error finding your profile. Please send /start again!');
       
       let total = 0;
       ctx.session.cart.forEach(i => total += i.price * i.quantity);
       
       const order = await ctx.prisma.order.create({
          data: {
             userId: user.id,
             total: total,
             status: 'PENDING',
             paymentMethod: 'CASH_ON_DELIVERY', // Supported out-of-the-box by our DB
             paymentStatus: 'PENDING',
             deliveryAddress: address,
             orderItems: {
               create: ctx.session.cart.map(item => ({
                  productId: item.id,
                  quantity: item.quantity,
                  price: item.price
               }))
             }
          }
       });

       try {
          const telegramAdmins = await ctx.prisma.user.findMany({
             where: { role: 'ADMIN', email: { startsWith: 'tg_' } }
          });
          
          let orderDetailsText = '';
          ctx.session.cart.forEach(item => {
             orderDetailsText += `- ${item.name} x${item.quantity} (₹${item.price.toFixed(2)} each)\n`;
          });
          
          const msg = `🔔 *New Order Alert (Telegram Bot)!*\n\nOrder ID: \`${order.id}\`\nAddress: _${address}_\n\n*Items:*\n${orderDetailsText}\n*Totals*\nSubtotal: ₹${total.toFixed(2)}\nShipping: ₹0.00\n*Grand Total:* ₹${total.toFixed(2)}`;
          
          for(const admin of telegramAdmins) {
             const match = admin.email?.match(/^tg_(.+)@telegram\.local$/);
             if (match && match[1]) {
                await bot.telegram.sendMessage(match[1], msg, { parse_mode: 'Markdown' }).catch(()=>{});
             }
          }
       } catch (e) { console.error("Broadcast to admins failed", e); }
       
       ctx.session.cart = []; // clear cart after successful order sync
       await ctx.reply(
          `✅ **Order Successfully Synchronized!**\n\n` +
          `Order ID: \`${order.id}\`\nDelivery Address: _${address}_\nTotal Billed: ₹${total.toFixed(2)}\n\n` + 
          `Your order has been routed to the main website's system!`, 
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Main Menu', 'MAIN_MENU')]
            ])
          }
       );
    } catch(e) {
       console.error("Order Checkout Flow Error:", e);
       ctx.reply('An error occurred whilst generating your order.');
    }
  });
};
