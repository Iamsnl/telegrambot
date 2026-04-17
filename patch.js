const fs = require('fs');
let content = fs.readFileSync('src/handlers/admin.js', 'utf8');

// Add the button
content = content.replace(
  "[Markup.button.callback('🔙 Back to Queue', 'ADMIN_ORDERS')]",
  "[Markup.button.callback('🗑️ Delete Order', `ADMIN_DELETEORDERBTN_${order.id}`)],\n          [Markup.button.callback('🔙 Back to Queue', 'ADMIN_ORDERS')]"
);

// Add the handlers after the catch block of ADMIN_SETSTATUS
const actionProductsIdx = content.indexOf("bot.action('ADMIN_PRODUCTS'");

const deleteHandlers = `
  bot.action(/^ADMIN_DELETEORDERBTN_(.+)$/, async (ctx) => {
     const orderId = ctx.match[1];
     const btns = [
       [Markup.button.callback('⚠️ YES, DELETE', \`ADMIN_DELETEORDERCONFIRM_\${orderId}\`)],
       [Markup.button.callback('❌ NO, CANCEL', \`ADMIN_ORDER_\${orderId}\`)]
     ];
     await ctx.editMessageText('⚠️ Are you completely sure you want to permanently delete this order? This cannot be undone!', Markup.inlineKeyboard(btns));
  });

  bot.action(/^ADMIN_DELETEORDERCONFIRM_(.+)$/, async (ctx) => {
     const orderId = ctx.match[1];
     try {
       await ctx.prisma.orderItem.deleteMany({ where: { orderId: orderId } });
       await ctx.prisma.order.delete({ where: { id: orderId } });
       await ctx.answerCbQuery('✅ Order permanently deleted!');
       ctx.match = null;
       bot.handleUpdate({ update_id: ctx.update.update_id, callback_query: { ...ctx.callbackQuery, data: 'ADMIN_ORDERS' }});
     } catch(e) { 
       console.error(e);
       ctx.answerCbQuery('Error deleting order.'); 
     }
  });

`;

content = content.substring(0, actionProductsIdx) + deleteHandlers + content.substring(actionProductsIdx);

fs.writeFileSync('src/handlers/admin.js', content, 'utf8');
console.log("Injected handlers");
