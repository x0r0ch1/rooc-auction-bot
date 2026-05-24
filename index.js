require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const path = require('path');

const db = new QuickDB();
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1498319806812651600'; 
const ALLOWED_CHANNEL_ID = '1212751816966676510';

// Helper function to add the Type selection (Puppet vs Illusion)
const addTypeOption = (option) => 
    option.setName('type')
        .setDescription('Select the auction list')
        .setRequired(true)
        .addChoices(
            { name: 'Puppet Card', value: 'puppet' },
            { name: 'Illusion Card', value: 'illusion' }
        );

const commands = [
    new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your character name')
        .addStringOption(option => option.setName('name').setDescription('Your IGN').setRequired(true)),
    new SlashCommandBuilder()
        .setName('joinauction')
        .setDescription('Join an auction queue')
        .addStringOption(addTypeOption), // Choice added
    new SlashCommandBuilder()
        .setName('listauction')
        .setDescription('View a current queue')
        .addStringOption(addTypeOption), // Choice added
    new SlashCommandBuilder()
        .setName('confirmbid')
        .setDescription('Confirm your bid and specify the slot number')
        .addStringOption(addTypeOption) // Choice added so it knows which list to update
        .addIntegerOption(option => option.setName('slot').setDescription('The slot number').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('undo')
        .setDescription('Undo your bid confirmation')
        .addStringOption(addTypeOption), // Choice added
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show instructions and a visual bidding guide'),
    new SlashCommandBuilder()
        .setName('removeplayer')
        .setDescription('Officer only: Remove a player by position')
        .addStringOption(addTypeOption) // Choice added
        .addIntegerOption(option => option.setName('position').setDescription('The # number to remove').setRequired(true)),
    new SlashCommandBuilder()
        .setName('movetop')
        .setDescription('Officer only: Move a player to #1')
        .addStringOption(addTypeOption) // Choice added
        .addIntegerOption(option => option.setName('position').setDescription('The current # position').setRequired(true)),
    new SlashCommandBuilder()
        .setName('done')
        .setDescription('Officer only: Remove the first X players')
        .addStringOption(addTypeOption) // Choice added
        .addIntegerOption(option => option.setName('count').setDescription('Number of players finished')),
    new SlashCommandBuilder()
        .setName('clearlistauction')
        .setDescription('Officer only: Reset a queue')
        .addStringOption(addTypeOption), // Choice added
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

    // Get the queue key dynamically based on user choice (auction_queue_puppet or auction_queue_illusion)
    const auctionType = options.getString('type');
    const queueKey = auctionType ? `auction_queue_${auctionType}` : null;
    const listName = auctionType === 'puppet' ? '🎭 Puppet Card' : '✨ Illusion Card';

    // --- HELP COMMAND ---
    if (commandName === 'help') {
        const imagePath = path.join(__dirname, 'bid_guide.png');
        const file = new AttachmentBuilder(imagePath);

        const helpEmbed = new EmbedBuilder()
            .setTitle("🛡️ ROO Auction Bot Guide")
            .setColor(0x00AE86)
            .setDescription("Every queue command now asks you to choose between **Puppet Card** or **Illusion Card** lists.")
            .addFields(
                { name: '👤 Player Commands', value: 
                    "`/register [name]` - Link your IGN to your Discord.\n" +
                    "`/joinauction [type]` - Enter your chosen queue.\n" +
                    "`/listauction [type]` - View that specific queue and bid status.\n" +
                    "`/confirmbid [type] [slot]` - Confirm a placed bid for a specific slot.\n" +
                    "`/undo [type]` - Remove your confirmation if you messed up."
                },
                { name: '👮 Officer Commands', value: 
                    "`/movetop [type] [pos]` - Move a player to #1.\n" +
                    "`/removeplayer [type] [pos]` - Remove a specific person.\n" +
                    "`/done [type] [count]` - Remove top X players who finished bidding.\n" +
                    "`/clearlistauction [type]` - Reset that specific list entirely."
                }
            )
            .setImage('attachment://bid_guide.png')
            .setFooter({ text: "Use these commands in the designated auction channel." });

        try {
            return await interaction.reply({ embeds: [helpEmbed], files: [file], ephemeral: true });
        } catch (error) {
            return await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        }
    }

    // --- REGISTER ---
    if (commandName === 'register') {
        const newName = options.getString('name');
        await db.set(`user_${user.id}`, { name: newName });
        await interaction.reply({ content: `✅ Registered as **${newName}**!`, ephemeral: true });
    }

    // --- JOIN ---
    if (commandName === 'joinauction') {
        const userData = await db.get(`user_${user.id}`);
        if (!userData) return interaction.reply({ content: "❌ Register first with `/register`", ephemeral: true });
        
        let queue = await db.get(queueKey) || [];
        if (queue.some(p => p.id === user.id)) {
            return interaction.reply({ content: `⚠️ Already in the **${listName}** list.`, ephemeral: true });
        }
        
        queue.push({ id: user.id, name: userData.name, confirmed: false, slot: null });
        await db.set(queueKey, queue);
        await interaction.reply({ content: `📝 Joined **${listName}** queue at **#${queue.length}**!`, ephemeral: true });
    }

    // --- LIST ---
    if (commandName === 'listauction') {
        const queue = await db.get(queueKey) || [];
        const embed = new EmbedBuilder()
            .setTitle(`📜 Current ${listName} Queue`)
            .setColor(auctionType === 'puppet' ? 0xe74c3c : 0x9b59b6) // Distinct colors for lists
            .setDescription(queue.length > 0 ? queue.map((p, i) => {
                const status = p.confirmed ? `✅ **[BID PLACED - Slot ${p.slot}]**` : "";
                return `**${i+1}.** ${p.name} ${status}`;
            }).join('\n') : "This list is empty.");
        await interaction.reply({ embeds: [embed] });
    }

    // --- CONFIRM BID ---
    if (commandName === 'confirmbid') {
        let queue = await db.get(queueKey) || [];
        const playerIndex = queue.findIndex(p => p.id === user.id);
        const slotNum = options.getInteger('slot');
        if (playerIndex === -1) return interaction.reply({ content: `❌ You are not in the **${listName}** list!`, ephemeral: true });

        queue[playerIndex].confirmed = true;
        queue[playerIndex].slot = slotNum;
        await db.set(queueKey, queue);
        await interaction.reply({ content: `✅ **${queue[playerIndex].name}** confirmed bidding on **${listName}** for **Slot ${slotNum}**!` });
    }

    // --- UNDO ---
    if (commandName === 'undo') {
        let queue = await db.get(queueKey) || [];
        const playerIndex = queue.findIndex(p => p.id === user.id);
        if (playerIndex === -1) return interaction.reply({ content: `❌ You are not in the **${listName}** list!`, ephemeral: true });
        if (!queue[playerIndex].confirmed) return interaction.reply({ content: "⚠️ Bid is already unconfirmed.", ephemeral: true });

        queue[playerIndex].confirmed = false;
        queue[playerIndex].slot = null;
        await db.set(queueKey, queue);
        await interaction.reply({ content: `↩️ **${queue[playerIndex].name}** undid their bid confirmation on **${listName}**.` });
    }

    // --- OFFICER COMMANDS ---
    if (commandName === 'removeplayer') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        let queue = await db.get(queueKey) || [];
        const pos = options.getInteger('position');
        if (pos < 1 || pos > queue.length) return interaction.reply({ content: `❌ Invalid position in **${listName}**.`, ephemeral: true });
        
        const [removed] = queue.splice(pos - 1, 1);
        await db.set(queueKey, queue);
        await interaction.reply({ content: `🗑️ Removed **${removed.name}** from **${listName}**.` });
    }

    if (commandName === 'movetop') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        let queue = await db.get(queueKey) || [];
        const pos = options.getInteger('position');
        if (pos < 1 || pos > queue.length) return interaction.reply({ content: `❌ Invalid position in **${listName}**.`, ephemeral: true });
        
        const [movedPlayer] = queue.splice(pos - 1, 1);
        movedPlayer.confirmed = false;
        movedPlayer.slot = null;
        queue.unshift(movedPlayer);
        await db.set(queueKey, queue);
        await interaction.reply({ content: `⬆️ **${movedPlayer.name}** moved to #1 on **${listName}**!` });
    }

    if (commandName === 'done') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        let queue = await db.get(queueKey) || [];
        if (queue.length === 0) return interaction.reply({ content: `❌ The **${listName}** list is empty.`, ephemeral: true });
        
        const count = options.getInteger('count') || 1;
        const removed = queue.splice(0, count);
        await db.set(queueKey, queue);
        await interaction.reply({ content: `🎊 Finished on **${listName}**: **${removed.map(p => p.name).join(', ')}**.` });
    }

    if (commandName === 'clearlistauction') {
        if (!isOfficer) return interaction.reply({ content: "🚫 Officers only.", ephemeral: true });
        await db.set(queueKey, []);
        await interaction.reply({ content: `🧹 **${listName}** list has been completely reset.` });
    }
});

client.on('error', console.error);

client.login(TOKEN);