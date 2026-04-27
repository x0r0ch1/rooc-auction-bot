require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');

const db = new QuickDB();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const PREFIX = '!';

// --- CONFIGURATION ---
// 1. Right-click your auction channel in Discord and "Copy ID"
// 2. Paste that ID between the quotes below
const ALLOWED_CHANNEL_ID = '1212751816966676510'; 

client.once('ready', () => {
    console.log(`⚔️ ROO Auction Bot is online as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    // 1. Ignore bots and messages without the prefix
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    // 2. CHANNEL LOCK: Ignore messages that are NOT in the specific auction channel
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Officer check: Role must be named "Guild Officer"
    const isOfficer = message.member.roles.cache.some(role => 
        role.name.toLowerCase() === 'guild officer'
    ) || message.member.permissions.has('Administrator');

    // -----------------------------------------
    // MEMBER COMMANDS
    // -----------------------------------------

    if (command === 'register') {
        const name = args[0];
        if (!name) return message.reply("❌ Usage: `!register [Name]`");
        await db.set(`user_${message.author.id}`, { name });
        message.reply(`✅ **${name}** is now registered!`);
    }

    if (command === 'join') {
        const userData = await db.get(`user_${message.author.id}`);
        if (!userData) return message.reply("❌ You must `!register [Name]` first!");

        let queue = await db.get(`auction_queue`) || [];
        const isAlreadyInQueue = queue.some(player => player.id === message.author.id);
        
        if (isAlreadyInQueue) {
            return message.reply("⚠️ You are already in the list.");
        }

        queue.push({ id: message.author.id, name: userData.name });
        await db.set(`auction_queue`, queue);
        message.reply(`📝 **${userData.name}** joined at position **#${queue.length}**!`);
    }

    if (command === 'list') {
        const queue = await db.get(`auction_queue`) || [];
        const embed = new EmbedBuilder()
            .setTitle("📜 Current Auction Queue")
            .setColor(0x3498db)
            .setDescription(queue.length > 0 
                ? queue.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n') 
                : "The list is currently empty.");

        message.channel.send({ embeds: [embed] });
    }

    // -----------------------------------------
    // GUILD OFFICER COMMANDS
    // -----------------------------------------

    if (command === 'done') {
        if (!isOfficer) return message.reply("🚫 Only **Guild Officers** can use this.");
        const count = parseInt(args[0]) || 1;
        let queue = await db.get(`auction_queue`) || [];
        if (queue.length === 0) return message.reply("❌ The list is empty.");

        const removed = queue.splice(0, count);
        await db.set(`auction_queue`, queue);
        const names = removed.map(p => p.name).join(', ');
        message.channel.send(`🎊 **Auction Complete!**\nRemoved: **${names}**.`);
    }

    if (command === 'remove') {
        if (!isOfficer) return message.reply("🚫 Only **Guild Officers** can use this.");
        const pos = parseInt(args[0]);
        let queue = await db.get(`auction_queue`) || [];
        if (isNaN(pos) || pos < 1 || pos > queue.length) return message.reply("❌ Invalid position.");

        const removedPlayer = queue.splice(pos - 1, 1);
        await db.set(`auction_queue`, queue);
        message.reply(`🗑️ Removed **${removedPlayer[0].name}** from position **#${pos}**.`);
    }

    if (command === 'clearlist') {
        if (!isOfficer) return message.reply("🚫 Only **Guild Officers** can use this.");
        await db.set(`auction_queue`, []);
        message.reply("🧹 List reset.");
    }
});

client.login(process.env.TOKEN);