const { Markup } = require('telegraf');
const bcrypt = require('bcryptjs');
const fs = require('fs/promises');
const path = require('path');

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
           [Markup.button.callback('🛍️ Manage Products', 'ADMIN_PRODUCTS')],
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

  bot.action('ADMIN_PRODUCTS', async (ctx) => {
     await ctx.editMessageText('🛍️ *Manage Products Dashboard*\nChoose an action:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
           [Markup.button.callback('➕ Add New Product', 'ADMIN_PRODUCT_ADD')],
           [Markup.button.callback('📋 Edit/Delete Existing', 'ADMIN_PRODUCT_LIST')],
           [Markup.button.callback('🔙 Back to Dashboard', 'ADMIN_PANEL')]
        ])
     });
  });

  bot.action('ADMIN_PRODUCT_ADD', async (ctx) => {
     try {
       const categories = await ctx.prisma.category.findMany();
       if (categories.length === 0) {
          return ctx.answerCbQuery('❌ You must create at least one Category in the Web Admin Panel first!', { show_alert: true });
       }
       const buttons = categories.map(c => [Markup.button.callback(c.name, `ADMIN_ADDPRD_CAT_${c.id}`)]);
       buttons.push([Markup.button.callback('🔙 Cancel Add Product', 'ADMIN_PRODUCTS')]);
       await ctx.editMessageText('Step 1: Select a Category for the new product:', Markup.inlineKeyboard(buttons));
     } catch (e) {}
  });

  bot.action(/^ADMIN_ADDPRD_CAT_(.+)$/, async (ctx) => {
     ctx.session.newProduct = { categoryId: ctx.match[1] };
     ctx.session.adminState = 'waitingForProductName';
     await ctx.editMessageText('Step 2: Enter the *Name* of the product.\n\n_Send /cancel to abort._', { parse_mode: 'Markdown' });
  });

  bot.action('ADMIN_PRODUCT_LIST', async (ctx) => {
     try {
       const products = await ctx.prisma.product.findMany({ orderBy: { createdAt: 'desc' }, take: 25 });
       if (products.length === 0) return ctx.editMessageText('No products found.', Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'ADMIN_PRODUCTS')]]));
       
       const buttons = products.map(p => [Markup.button.callback(`${p.name} - ₹${p.price}`, `ADMIN_MANAGEPRD_${p.id}`)]);
       buttons.push([Markup.button.callback('🔙 Back', 'ADMIN_PRODUCTS')]);
       await ctx.editMessageText('📋 Select a product to edit or delete (Showing latest 25):', Markup.inlineKeyboard(buttons));
     } catch (e) {}
  });

  bot.action(/^ADMIN_MANAGEPRD_(.+)$/, async (ctx) => {
     const pId = ctx.match[1];
     try {
       const p = await ctx.prisma.product.findUnique({ where: { id: pId }});
       if(!p) return ctx.answerCbQuery('Not found.');
       
       let txt = `🛍️ *${p.name}*\n📝 Desc: _${p.description}_\n`;
       txt += `💰 Price: ₹${p.price} | 🏷️ Discount: ${p.discountPrice ? '₹'+p.discountPrice : 'None'}\n`;
       txt += `📦 Stock: ${p.stock}\n🌟 Featured: ${p.isFeatured ? '✅' : '❌'} | 🔥 Trending: ${p.isTrending ? '✅' : '❌'}\n\nWhat would you like to update?`;
       
       const btns = [
         [Markup.button.callback('✏️ Edit Name', `ADMIN_EDITPRD_NAME_${pId}`), Markup.button.callback('✏️ Edit Desc', `ADMIN_EDITPRD_DESC_${pId}`)],
         [Markup.button.callback('✏️ Edit Price', `ADMIN_EDITPRD_PRICE_${pId}`), Markup.button.callback('✏️ Edit Discount', `ADMIN_EDITPRD_DISC_${pId}`)],
         [Markup.button.callback('✏️ Edit Stock', `ADMIN_EDITPRD_STOCK_${pId}`), Markup.button.callback('✏️ Edit Image', `ADMIN_EDITPRD_IMG_${pId}`)],
         [Markup.button.callback(`Toggle Featured: ${p.isFeatured?'OFF':'ON'}`, `ADMIN_TOGGLEFEAT_${pId}`), Markup.button.callback(`Toggle Trending: ${p.isTrending?'OFF':'ON'}`, `ADMIN_TOGGLETREND_${pId}`)],
         [Markup.button.callback('🗑️ Delete Product', `ADMIN_DELETEPRDBTN_${pId}`)],
         [Markup.button.callback('🔙 Back to List', 'ADMIN_PRODUCT_LIST')]
       ];
       await ctx.editMessageText(txt, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
     } catch (e){}
  });

  bot.action(/^ADMIN_EDITPRD_(.+)_(.+)$/, async (ctx) => {
     const field = ctx.match[1]; // NAME, DESC, PRICE, DISC, STOCK, IMG
     const pId = ctx.match[2];
     ctx.session.editProductId = pId;
     ctx.session.adminState = `waitingForEdit_${field}`;
     
     const promptMsg = field === 'IMG' 
       ? `Upload a new **Photo** or send a **Direct Image URL**:\n\n_Send /cancel to abort._`
       : `Send the new value for **${field}**:\n\n_Send /cancel to abort._`;
       
     await ctx.editMessageText(promptMsg, { parse_mode: 'Markdown' });
  });

  bot.action(/^ADMIN_TOGGLE(.*)_(.+)$/, async (ctx) => {
     const toggleType = ctx.match[1]; // FEAT, TREND
     const pId = ctx.match[2];
     try {
       const p = await ctx.prisma.product.findUnique({ where: { id: pId }});
       if(toggleType === 'FEAT') await ctx.prisma.product.update({ where: { id: pId }, data: { isFeatured: !p.isFeatured }});
       if(toggleType === 'TREND') await ctx.prisma.product.update({ where: { id: pId }, data: { isTrending: !p.isTrending }});
       
       ctx.answerCbQuery('✅ Toggled successfully!');
       // Refresh via self-trigger
       ctx.match = [null, pId];
       bot.handleUpdate({ update_id: ctx.update.update_id, callback_query: { ...ctx.callbackQuery, data: `ADMIN_MANAGEPRD_${pId}` }});
     } catch(e) { ctx.answerCbQuery('Error toggling state'); }
  });

  bot.action(/^ADMIN_DELETEPRDBTN_(.+)$/, async (ctx) => {
     const btns = [
       [Markup.button.callback('⚠️ YES, DELETE', `ADMIN_DELETEPRDCONFIRM_${ctx.match[1]}`)],
       [Markup.button.callback('❌ NO, CANCEL', `ADMIN_MANAGEPRD_${ctx.match[1]}`)]
     ];
     await ctx.editMessageText('⚠️ Are you completely sure you want to delete this product? This cannot be undone!', Markup.inlineKeyboard(btns));
  });

  bot.action(/^ADMIN_DELETEPRDCONFIRM_(.+)$/, async (ctx) => {
     try {
       await ctx.prisma.product.delete({ where: { id: ctx.match[1] }});
       await ctx.answerCbQuery('✅ Product manually deleted from database!');
       // Route back to list using handleUpdate fallback
       ctx.match = null;
       bot.handleUpdate({ update_id: ctx.update.update_id, callback_query: { ...ctx.callbackQuery, data: 'ADMIN_PRODUCT_LIST' }});
     } catch(e) { ctx.answerCbQuery('Error deleting product.'); }
  });

  bot.action('ADMIN_BROADCAST', async (ctx) => {
    ctx.session.waitingForBroadcast = true;
    await ctx.editMessageText('📢 *Global Broadcast System*\n\nPlease type the message you want to blast to **ALL** users who have activated the bot. \n\n_Send /cancel to safely abort._', { parse_mode: 'Markdown' });
  });

  bot.on(['text', 'photo'], async (ctx, next) => {
     let txt = ctx.message.text || '';
     const state = ctx.session.adminState;

     if(ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.telegram.getFile(photo.file_id);
        const photoUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;
        
        try {
          const response = await fetch(photoUrl);
          const buffer = await response.arrayBuffer();
          const ext = file.file_path.split('.').pop() || 'jpg';
          const filename = `${Date.now()}-telegram-upload.${ext}`;
          // Use the domain API to store the image instead of writing horizontally to disk.
          // This allows the Telegram bot and the Next.js app to be hosted on completely different servers!
          const STORE_URL = process.env.STORE_URL || 'http://localhost:3000';
          
          const formData = new FormData();
          // We wrap the buffer in a natively supported Blob to emulate browser upload
          formData.append('file', new Blob([buffer]), filename);
          
          const uploadRes = await fetch(`${STORE_URL}/api/upload`, {
             method: 'POST',
             body: formData
          });
          
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.url) {
             txt = uploadData.url;
          } else {
             throw new Error(uploadData.error || "Upload failed");
          }
        } catch(err) {
          console.error("Photo download error", err);
          return ctx.reply("❌ Error downloading your photo. Please try a valid Direct Image URL instead.");
        }
     }

     if(txt === '/cancel' && (ctx.session.waitingForBroadcast || state)) {
        ctx.session.waitingForBroadcast = false;
        ctx.session.adminState = null;
        ctx.session.newProduct = null;
        return ctx.reply('✅ Action safely cancelled. Type /start to drop back into the menu.');
     }
     
     if(ctx.session.waitingForBroadcast) {
       ctx.session.waitingForBroadcast = false;
       try {
         const users = await ctx.prisma.user.findMany({ where: { email: { startsWith: 'tg_' } } });
         let count = 0;
         for (const u of users) {
            const m = u.email.match(/^tg_(.+)@telegram\.local$/);
            if (m) {
               try {
                 await bot.telegram.sendMessage(m[1], `📢 *Store Update:*\n\n${txt}`, { parse_mode: 'Markdown' });
                 count++;
               } catch(ex) {}
            }
         }
         ctx.reply(`✅ Broadcast sent to ${count} users! Type /start to return.`, { parse_mode: 'Markdown' });
       } catch(e) { ctx.reply('Error sending broadcast.'); }
       return;
     }

     if(state === 'waitingForProductName') {
       ctx.session.newProduct.name = txt;
       ctx.session.adminState = 'waitingForProductDesc';
       return ctx.reply('Step 3: Great! Now enter a short *Description* for the item.', { parse_mode: 'Markdown' });
     }
     
     if(state === 'waitingForProductDesc') {
       ctx.session.newProduct.description = txt;
       ctx.session.adminState = 'waitingForProductPrice';
       return ctx.reply('Step 4: Enter the *Price* (just the number, e.g., 299).', { parse_mode: 'Markdown' });
     }
     
     if(state === 'waitingForProductPrice') {
       const price = parseFloat(txt);
       if(isNaN(price)) return ctx.reply('❌ Invalid number. Please enter a valid Price (e.g., 299):');
       ctx.session.newProduct.price = price;
       ctx.session.adminState = 'waitingForProductDiscPrice';
       return ctx.reply('Step 5: Enter the *Discount Price* (e.g., 199), or type `skip` if there is no discount.', { parse_mode: 'Markdown' });
     }

     if(state === 'waitingForProductDiscPrice') {
       if (txt.toLowerCase() !== 'skip') {
         const disc = parseFloat(txt);
         if(isNaN(disc)) return ctx.reply('❌ Invalid number. Please enter a valid Discount Price, or `skip`:');
         ctx.session.newProduct.discountPrice = disc;
       }
       ctx.session.adminState = 'waitingForProductStock';
       return ctx.reply('Step 6: Enter the initial *Stock* quantity (e.g., 50).', { parse_mode: 'Markdown' });
     }
     
     if(state === 'waitingForProductStock') {
       const stock = parseInt(txt);
       if(isNaN(stock)) return ctx.reply('❌ Invalid number. Please enter a valid Stock (e.g., 50):');
       ctx.session.newProduct.stock = stock;
       ctx.session.adminState = 'waitingForProductImg';
       return ctx.reply('Last Step: Send a **Direct Image URL** OR simply upload a **Photo** now. Type `skip` to use a placeholder.', { parse_mode: 'Markdown' });
     }
     
     if(state === 'waitingForProductImg') {
       ctx.session.adminState = null;
       const img = txt.toLowerCase() === 'skip' ? '["/placeholder.png"]' : JSON.stringify([txt]);
       
       try {
         const { name, description, price, discountPrice, stock, categoryId } = ctx.session.newProduct;
         const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
         const p = await ctx.prisma.product.create({
           data: { name, slug, description, price, discountPrice: discountPrice || null, stock, categoryId, images: img }
         });
         ctx.session.newProduct = null;
         
         let txt = `✅ *Success! Product gracefully created.*\n\n🛍️ *${p.name}*\n📝 Desc: _${p.description}_\n`;
         txt += `💰 Price: ₹${p.price} | 🏷️ Discount: ${p.discountPrice ? '₹'+p.discountPrice : 'None'}\n`;
         txt += `📦 Stock: ${p.stock}\n🌟 Featured: ${p.isFeatured ? '✅' : '❌'} | 🔥 Trending: ${p.isTrending ? '✅' : '❌'}\n\nWhat would you like to update?`;
         
         const pId = p.id;
         const btns = [
           [Markup.button.callback('✏️ Edit Name', `ADMIN_EDITPRD_NAME_${pId}`), Markup.button.callback('✏️ Edit Desc', `ADMIN_EDITPRD_DESC_${pId}`)],
           [Markup.button.callback('✏️ Edit Price', `ADMIN_EDITPRD_PRICE_${pId}`), Markup.button.callback('✏️ Edit Discount', `ADMIN_EDITPRD_DISC_${pId}`)],
           [Markup.button.callback('✏️ Edit Stock', `ADMIN_EDITPRD_STOCK_${pId}`), Markup.button.callback('✏️ Edit Image', `ADMIN_EDITPRD_IMG_${pId}`)],
           [Markup.button.callback(`Toggle Featured: ${p.isFeatured?'OFF':'ON'}`, `ADMIN_TOGGLEFEAT_${pId}`), Markup.button.callback(`Toggle Trending: ${p.isTrending?'OFF':'ON'}`, `ADMIN_TOGGLETREND_${pId}`)],
           [Markup.button.callback('🗑️ Delete Product', `ADMIN_DELETEPRDBTN_${pId}`)],
           [Markup.button.callback('🔙 Back to List', 'ADMIN_PRODUCT_LIST')]
         ];
         return ctx.reply(txt, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
       } catch(e) {
         console.error(e);
         return ctx.reply('❌ Error saving to database. Ensure categories exist. Type /start to return.');
       }
     }

     if(state && state.startsWith('waitingForEdit_')) {
       const field = state.split('_')[1];
       const pId = ctx.session.editProductId;
       let data = {};
       
       if (field === 'NAME') { data.name = txt; data.slug = txt.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now(); }
       else if (field === 'DESC') data.description = txt;
       else if (field === 'PRICE') {
          const val = parseFloat(txt);
          if(isNaN(val)) return ctx.reply('❌ Invalid number.');
          data.price = val;
       }
       else if (field === 'DISC') {
          if (txt.toLowerCase() === 'none' || txt.toLowerCase() === 'skip') data.discountPrice = null;
          else {
            const val = parseFloat(txt);
            if(isNaN(val)) return ctx.reply('❌ Invalid number.');
            data.discountPrice = val;
          }
       }
       else if (field === 'STOCK') {
          const val = parseInt(txt);
          if(isNaN(val)) return ctx.reply('❌ Invalid number.');
          data.stock = val;
       }
       else if (field === 'IMG') {
          data.images = txt.toLowerCase() === 'skip' ? '["/placeholder.png"]' : JSON.stringify([txt]);
       }

       ctx.session.adminState = null;
       try {
         const p = await ctx.prisma.product.update({ where: { id: pId }, data });
         
         // Dynamically route back to the product dashboard instance with a success message included
         let txt = `✅ *Field ${field} successfully updated!*\n\n`;
         txt += `🛍️ *${p.name}*\n📝 Desc: _${p.description}_\n`;
         txt += `💰 Price: ₹${p.price} | 🏷️ Discount: ${p.discountPrice ? '₹'+p.discountPrice : 'None'}\n`;
         txt += `📦 Stock: ${p.stock}\n🌟 Featured: ${p.isFeatured ? '✅' : '❌'} | 🔥 Trending: ${p.isTrending ? '✅' : '❌'}\n\nWhat would you like to update?`;
         
         const btns = [
           [Markup.button.callback('✏️ Edit Name', `ADMIN_EDITPRD_NAME_${pId}`), Markup.button.callback('✏️ Edit Desc', `ADMIN_EDITPRD_DESC_${pId}`)],
           [Markup.button.callback('✏️ Edit Price', `ADMIN_EDITPRD_PRICE_${pId}`), Markup.button.callback('✏️ Edit Discount', `ADMIN_EDITPRD_DISC_${pId}`)],
           [Markup.button.callback('✏️ Edit Stock', `ADMIN_EDITPRD_STOCK_${pId}`), Markup.button.callback('✏️ Edit Image', `ADMIN_EDITPRD_IMG_${pId}`)],
           [Markup.button.callback(`Toggle Featured: ${p.isFeatured?'OFF':'ON'}`, `ADMIN_TOGGLEFEAT_${pId}`), Markup.button.callback(`Toggle Trending: ${p.isTrending?'OFF':'ON'}`, `ADMIN_TOGGLETREND_${pId}`)],
           [Markup.button.callback('🗑️ Delete Product', `ADMIN_DELETEPRDBTN_${pId}`)],
           [Markup.button.callback('🔙 Back to List', 'ADMIN_PRODUCT_LIST')]
         ];
         return ctx.reply(txt, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
       } catch(e) { return ctx.reply('Error updating.'); }
     }
     
     return next();
  });

};
