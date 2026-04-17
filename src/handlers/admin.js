const { Markup } = require('telegraf');
const bcrypt = require('bcryptjs');

exports.setup = (bot) => {
  bot.command('adminlogin', async (ctx) => {
     const args = ctx.message.text.split(' ');
     if (args.length !== 3) {
       return ctx.reply('Usage: /adminlogin <email> <password>');
     }
     const email = args[1];
     const password = args[2];
     
     try {
        const adminUser = await ctx.prisma.user.findUnique({ where: { email } });
        if (!adminUser || !adminUser.password) return ctx.reply('Invalid credentials.');
        
        const isMatch = await bcrypt.compare(password, adminUser.password);
        if (!isMatch) return ctx.reply('Invalid credentials.');
        
        if (adminUser.role !== 'ADMIN') return ctx.reply('This account is not an ADMIN on the main store.');
        
        const telegramId = String(ctx.from.id);
        const dummyEmail = `tg_${telegramId}@telegram.local`;
        
        await ctx.prisma.user.update({
           where: { email: dummyEmail },
           data: { role: 'ADMIN' }
        });
        
        ctx.reply('✅ Success! Your Telegram account has been granted ADMIN privileges.\nSend /start to access the Admin Panel.', { parse_mode: 'Markdown' });
     } catch (e) {
        console.error("Admin Login Error:", e);
        ctx.reply('Authentication error.');
     }
  });

  bot.action('ADMIN_PANEL', async (ctx) => {
     const telegramId = String(ctx.from.id);
     const dummyEmail = `tg_${telegramId}@telegram.local`;
     const user = await ctx.prisma.user.findUnique({ where: { email: dummyEmail }});
     if (user?.role !== 'ADMIN') return ctx.answerCbQuery('Unauthorized', { show_alert: true });
     
     await ctx.editMessageText('🛡️ *Advanced Admin Dashboard*\nSelect an administration task below:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
           [Markup.button.callback('📊 Store Statistics', 'ADMIN_STATS')],
           [Markup.button.callback('📦 Manage Orders (All)', 'ADMIN_ORDERS')],
           [Markup.button.callback('📢 Global Push Broadcast', 'ADMIN_BROADCAST')],
           [Markup.button.callback('🔙 Exit Admin Mode', 'MAIN_MENU')]
        ])
     });
  });

  bot.action('ADMIN_STATS', async (ctx) => {
     const telegramId = String(ctx.from.id);
     const dummyEmail = `tg_${telegramId}@telegram.local`;
     const user = await ctx.prisma.user.findUnique({ where: { email: dummyEmail }});
     if (user?.role !== 'ADMIN') return;
     
     try {
       const userCount = await ctx.prisma.user.count();
       const orderAgg = await ctx.prisma.order.aggregate({ _sum: { total: true }, _count: { id: true } });
       
       const totalRev = orderAgg._sum.total || 0;
       const orderCount = orderAgg._count.id;
       const pendingCount = await ctx.prisma.order.count({ where: { status: 'PENDING' }});
       
       const text = `📊 *Live Store Statistics*\n\n👥 *Registered Connects:* ${userCount}\n📦 *Total Life Orders:* ${orderCount}\n🕒 *Pending Fulfillment:* ${pendingCount}\n💰 *Gross Revenue:* ₹${totalRev.toFixed(2)}`;
       
       await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Dashboard', 'ADMIN_PANEL')]])
       });
     } catch (e) { console.error(e); }
  });

  bot.action('ADMIN_ORDERS', async (ctx) => {
     const telegramId = String(ctx.from.id);
     const dummyEmail = `tg_${telegramId}@telegram.local`;
     const user = await ctx.prisma.user.findUnique({ where: { email: dummyEmail }});
     if (user?.role !== 'ADMIN') return;
     
     try {
       const recentOrders = await ctx.prisma.order.findMany({ 
          orderBy: { createdAt: 'desc' },
          take: 10
       });
       
       if (recentOrders.length === 0) {
         return ctx.editMessageText('✅ No orders found.', Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Dashboard', 'ADMIN_PANEL')]]));
       }
       
       const buttons = recentOrders.map(o => [Markup.button.callback(`[${o.status}] Order ${o.id.substring(0,6)} | ₹${o.total}`, `ADMIN_ORDER_${o.id}`)]);
       buttons.push([Markup.button.callback('🔙 Back to Dashboard', 'ADMIN_PANEL')]);
       
       await ctx.editMessageText('📦 *Recent Orders Queue*\nSelect any order below to view details and update its status:', {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
       });
     } catch (e) {}
  });

  bot.action(/^ADMIN_ORDER_(.+)$/, async (ctx) => {
     const orderId = ctx.match[1];
     try {
       const order = await ctx.prisma.order.findUnique({ 
         where: { id: orderId }, 
         include: { 
           orderItems: { include: { product: true } },
           user: true 
         } 
       });
       if (!order) return ctx.answerCbQuery('Order not found.');
       
       let userName = order.user?.name || "Unknown";
       let userAccount = order.user?.email || "Unknown";
       if (userAccount.startsWith('tg_')) {
          const m = userAccount.match(/^tg_(.+)@telegram\.local$/);
          if (m && m[1]) userAccount = `Telegram ID: ${m[1]}`;
       }
       
       let text = `📦 *Order Sheet:* \`${order.id}\`\n`;
       text += `👤 *Customer:* ${userName} (${userAccount})\n`;
       text += `📍 *Delivery Address:* _${order.deliveryAddress}_\n`;
       text += `💰 *Total Billed:* ₹${order.total.toFixed(2)}\n`;
       text += `🚦 *Current Status:* ${order.status}\n\n*Manifest:*\n`;
       
       order.orderItems.forEach(i => {
         text += `- ${i.product.name} x${i.quantity}\n`;
       });
       
       const buttons = [
         [Markup.button.callback('🚀 Mark PROCESSING', `ADMIN_SETSTATUS_${order.id}_PROCESSING`)],
         [Markup.button.callback('🚚 Mark SHIPPED', `ADMIN_SETSTATUS_${order.id}_SHIPPED`)],
         [Markup.button.callback('✅ Mark DELIVERED', `ADMIN_SETSTATUS_${order.id}_DELIVERED`)],
         [Markup.button.callback('🔙 Back to Queue', 'ADMIN_ORDERS')]
       ];
       
       await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
     } catch(e){}
  });

  bot.action(/^ADMIN_SETSTATUS_(.+?)_(.+)$/, async (ctx) => {
     const orderId = ctx.match[1];
     const status = ctx.match[2];
     try {
        await ctx.prisma.order.update({ where: { id: orderId }, data: { status } });
        await ctx.answerCbQuery(`Order status updated to ${status}!`);
        // Refresh the orders viewer essentially by simulating a click back on ADMIN_ORDERS
        ctx.match = null;
        bot.handleUpdate({
           update_id: ctx.update.update_id,
           callback_query: { ...ctx.callbackQuery, data: 'ADMIN_ORDERS' }
        });
     } catch(e){ ctx.answerCbQuery('Error mutating status.'); }
  });

  bot.action('ADMIN_BROADCAST', async (ctx) => {
    ctx.session.waitingForBroadcast = true;
    await ctx.editMessageText('📢 *Global Broadcast System*\n\nPlease type the message you want to blast to **ALL** users who have activated the bot. \n\n_Send /cancel to safely abort._', { parse_mode: 'Markdown' });
  });

  bot.on('text', async (ctx, next) => {
     if(ctx.message.text === '/cancel' && ctx.session.waitingForBroadcast) {
        ctx.session.waitingForBroadcast = false;
        return ctx.reply('✅ Broadcast aborted. Type /start to drop back into the menu.');
     }
     
     if(ctx.session.waitingForBroadcast) {
       ctx.session.waitingForBroadcast = false;
       const msg = ctx.message.text;
       try {
         const users = await ctx.prisma.user.findMany({ where: { email: { startsWith: 'tg_' } } });
         let count = 0;
         for (const u of users) {
            const m = u.email.match(/^tg_(.+)@telegram\.local$/);
            if (m) {
               const chatId = m[1];
               try {
                 await bot.telegram.sendMessage(chatId, `📢 *Store Update:*\n\n${msg}`, { parse_mode: 'Markdown' });
                 count++;
               } catch(ex) { /* Do not crash if user blocked bot */ }
            }
         }
         ctx.reply(`✅ Massive success. Signal broadcast sent to ${count} active telegram user channels! Type /start to return.`, { parse_mode: 'Markdown' });
       } catch(e) {
         ctx.reply('Transmission error sending broadcast.');
       }
       return; // Stop propagating since we handled the explicit wait
     }
     
     return next();
  });

};
