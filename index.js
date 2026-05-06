require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');

const db = new QuickDB();
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1498319806812651600'; 
const ALLOWED_CHANNEL_ID = '1212751816966676510';

const commands = [
    new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your character name')
        .addStringOption(option => option.setName('name').setDescription('Your IGN').setRequired(true)),
    new SlashCommandBuilder()
        .setName('joinauction')
        .setDescription('Join the auction queue'),
    new SlashCommandBuilder()
        .setName('listauction')
        .setDescription('View the current queue'),
    new SlashCommandBuilder()
        .setName('confirmbid')
        .setDescription('Confirm your bid and specify the slot number')
        .addIntegerOption(option => option.setName('slot').setDescription('The slot number').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('undo')
        .setDescription('Undo your bid confirmation'),
    new SlashCommandBuilder()
        .setName('help') // NEW COMMAND
        .setDescription('Show instructions for all auction bot commands'),
    new SlashCommandBuilder()
        .setName('removeplayer')
        .setDescription('Officer only: Remove a player by position')
        .addIntegerOption(option => option.setName('position').setDescription('The # number to remove').setRequired(true)),
    new SlashCommandBuilder()
        .setName('movetop')
        .setDescription('Officer only: Move a player to #1')
        .addIntegerOption(option => option.setName('position').setDescription('The current # position').setRequired(true)),
    new SlashCommandBuilder()
        .setName('done')
        .setDescription('Officer only: Remove the first X players')
        .addIntegerOption(option => option.setName('count').setDescription('Number of players finished')),
    new SlashCommandBuilder()
        .setName('clearlistauction')
        .setDescription('Officer only: Reset the queue'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Refreshing global (/) commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Successfully reloaded global (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
        return interaction.reply({ content: "❌ Use this command in the auction channel.", ephemeral: true });
    }

    const { commandName, options, member, user } = interaction;
    const isOfficer = member.roles.cache.some(role => role.name.toLowerCase() === 'guild officer') || member.permissions.has('Administrator');

    // --- HELP COMMAND ---
    if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle("🛡️ ROO Auction Bot Guide")
            .setColor(0x00AE86)
            .setDescription("Follow these commands to manage your guild auction efficiently.")
            .addFields(
                { name: '👤 Player Commands', value: 
                    "`/register [name]` - Link your IGN to your Discord.\n" +
                    "`/joinauction` - Enter the queue.\n" +
                    "`/listauction` - View the current queue and bid status.\n" +
                    "`/confirmbid [slot]` - Confirm you placed a bid for a specific slot.\n" +
                    "`/undo` - Remove your bid confirmation if you made a mistake."
                },
                { name: '👮 Officer Commands', value: 
                    "`/movetop [pos]` - Move a player from the bottom to #1.\n" +
                    "`/removeplayer [pos]` - Remove a specific person from the list.\n" +
                    "`/done [count]` - Remove the top X players when they finish bidding.\n" +
                    "`/clearlistauction` - Reset the entire list for a new session."
                }
            )
            .setFooter({ text: "Use these commands in the designated auction channel." });

        return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }

    // --- REGISTER & JOIN ---
    if (commandName === 'register') {
        const newName = options.getString('name');
        await db.set(`user_${user.id}`, { name: newName });
        await interaction.reply({ content: `✅ Registered as **${newName}**!`, ephemeral: true });
    }

    if (commandName === 'joinauction') {
        const userData = await db.get(`user_${user.id}`);
        if (!userData) return interaction.reply({ content: "❌ Register first with `/register`", ephemeral: true });
        let queue = await db.get(`auction_queue`) || [];
        if (queue.some(p => p.id === user.id)) return interaction.reply({ content: "⚠️ Already in list.", ephemeral: true });
        queue.push({ id: user.id, name: userData.name, confirmed: false, slot: null });
        await db.set(`auction_queue`, queue);
        await interaction.reply({ content: `📝 Joined at **#${queue.length}**!`, ephemeral: true });
    }

    // --- LIST ---
    if (commandName === 'listauction') {
        const queue = await db.get(`auction_queue`) || [];
        const embed = new EmbedBuilder()
            .setTitle("📜 Current Auction Queue")
            .setColor(0x3498db)
            .setDescription(queue.length > 0 ? queue.map((p, i) => {
                const status = p.confirmed ? `✅ **[BID PLACED - Slot ${p.slot}]**` : "";
                return `**${i+1}.** ${p.name} ${status}`;
            }).join('\n') : "Empty.");
        await interaction.reply({ embeds: [embed] });
    }

    // --- CONFIRM BID ---
    if (commandName === 'confirmbid') {
        let queue = await db.get(`auction_queue`) || [];
        const playerIndex = queue.findIndex(p => p.id === user.id);
        const slotNum = options.getInteger('slot');
        if (playerIndex === -1) return interaction.reply({ content: "❌ You are not in the list!", ephemeral: true });

        queue[playerIndex].confirmed = true;
        queue[playerIndex].slot = slotNum;
        await db.set(`auction_queue`, queue);
        await interaction.reply({ content: `✅ **${queue[playerIndex].name}** confirmed bidding for **Slot ${slotNum}**!` });
    }

    // --- UNDO BID ---
    if (commandName === 'undo') {
        let queue = await db.get(`auction_queue`) || [];
        const playerIndex = queue.findIndex(p => p.id === user.id);
        if (playerIndex === -1) return interaction.reply({ content: "❌ You are not in the list!", ephemeral: true });
        if (!queue[playerIndex].confirmed) return interaction.reply({ content: "⚠️ Bid is already unconfirmed.", ephemeral: true });

        queue[playerIndex].confirmed = false;
        queue[playerIndex].slot = null;
        await db.set(`auction_queue`, queue);
        await interaction.reply({ content: `↩️ **${queue[playerIndex].name}** has undone their bid confirmation.` });
    }

    // --- OFFICER COMMANDS ---
    if (commandName === 'removeplayer') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        let queue = await db.get(`auction_queue`) || [];
        const pos = options.getInteger('position');
        if (pos < 1 || pos > queue.length) return interaction.reply({ content: `❌ Invalid position.`, ephemeral: true });
        const [removed] = queue.splice(pos - 1, 1);
        await db.set(`auction_queue`, queue);
        await interaction.reply({ content: `🗑️ Removed **${removed.name}**.` });
    }

    if (commandName === 'movetop') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        let queue = await db.get(`auction_queue`) || [];
        const pos = options.getInteger('position');
        if (pos < 1 || pos > queue.length) return interaction.reply({ content: `❌ Invalid position.`, ephemeral: true });
        const [movedPlayer] = queue.splice(pos - 1, 1);
        movedPlayer.confirmed = false;
        movedPlayer.slot = null;
        queue.unshift(movedPlayer);
        await db.set(`auction_queue`, queue);
        await interaction.reply({ content: `⬆️ **${movedPlayer.name}** moved to **#1**!` });
    }

    if (commandName === 'done') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        let queue = await db.get(`auction_queue`) || [];
        if (queue.length === 0) return interaction.reply({ content: "❌ List is empty.", ephemeral: true });
        const count = options.getInteger('count') || 1;
        const removed = queue.splice(0, count);
        await db.set(`auction_queue`, queue);
        await interaction.reply({ content: `🎊 Finished: **${removed.map(p => p.name).join(', ')}**.` });
    }

    if (commandName === 'clearlistauction') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        await db.set(`auction_queue`, []);
        await interaction.reply({ content: "🧹 Auction list reset." });
    }
});

client.login(TOKEN);