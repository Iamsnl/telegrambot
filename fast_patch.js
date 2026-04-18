const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'src/handlers/admin.js');
let code = fs.readFileSync(targetPath, 'utf8');

const cacheCode = `
const adminCache = new Set();
async function isAdminCheck(ctx) {
   if (!ctx || !ctx.from || !ctx.from.id) return false;
   const telegramId = String(ctx.from.id);
   if (adminCache.has(telegramId)) return true;
   try {
     const user = await ctx.prisma.user.findUnique({ where: { email: \`tg_\${telegramId}@telegram.local\` }});
     if (user?.role === 'ADMIN') { adminCache.add(telegramId); return true; }
   } catch(e) {}
   return false;
}

`;

code = code.replace("exports.setup = (bot) => {", cacheCode + "exports.setup = (bot) => {");

// Replace all DB checks
const dbCheckRegex = /const telegramId = String\(ctx\.from\.id\);\s*const dummyEmail = `tg_\$\{telegramId\}@telegram\.local`;\s*const user = await ctx\.prisma\.user\.findUnique\(.*?\);\s*if \(user\?\.role !== 'ADMIN'\) return(?: ctx\.answerCbQuery\('Unauthorized', .*?\))?;/gs;

code = code.replace(dbCheckRegex, "if (!(await isAdminCheck(ctx))) { try { await ctx.answerCbQuery('Unauthorized', { show_alert: true }); } catch(e){} return; }");

// Also add it to actions that missed it
code = code.replace(/bot\.action\('ADMIN_PRODUCTS', async \(ctx\) => \{/, "bot.action('ADMIN_PRODUCTS', async (ctx) => {\n     if (!(await isAdminCheck(ctx))) return;");

// Fix the setup add to cache
code = code.replace("ctx.reply('✅ Success! Your Telegram account has been granted ADMIN privileges.", "adminCache.add(telegramId);\n        ctx.reply('✅ Success! Your Telegram account has been granted ADMIN privileges.");

// Add immediate answerCbQuery to make buttons feel instant
code = code.replace(/bot\.action\((.*?),\s*async \(ctx\) =>\s*\{/g, "bot.action($1, async (ctx) => {\n     ctx.answerCbQuery().catch(()=>{});");

// Now we need to remove duplicate answerCbQuery() just to be perfectly clean, though it's technically handled by catch()
fs.writeFileSync(targetPath, code);
console.log("Patched admin.js successfully!");
