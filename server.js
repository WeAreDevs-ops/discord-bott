
const express = require('express');
const path = require('path');
const session = require('express-session');
const fetch = require('node-fetch');
const app = express();

// Configure session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Parse JSON bodies
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Discord OAuth2 configuration
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1393887962772734104';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:5000/auth/discord/callback';

// Import the existing bot (this will start the Discord bot)
let client = null;
let commandStats = null;

// Function to get bot data (will be called from index.js)
function setBotData(botClient, stats) {
    client = botClient;
    commandStats = stats;
}

// Initialize bot data after a delay to avoid circular dependency
setTimeout(() => {
    try {
        const indexModule = require('./index.js');
        // Bot data will be set via setBotData function
    } catch (error) {
        console.log('Bot will initialize separately');
    }
}, 1000);

// Bot owner Discord ID (replace with your actual Discord user ID)
const BOT_OWNER_ID = '1392169655398977619';

// Middleware to check if user is bot owner
function requireBotOwner(req, res, next) {
    // In a real implementation, you'd verify the Discord user ID
    // For now, we'll use a simple header check or session
    const userAgent = req.get('User-Agent');
    const adminKey = req.get('X-Admin-Key');
    
    // Simple admin verification - in production, implement proper Discord OAuth
    if (adminKey === 'bot_owner_access' || req.query.admin === 'true') {
        next();
    } else {
        res.status(403).json({ authorized: false, message: 'Bot owner access required' });
    }
}

// Discord OAuth Routes
app.get('/auth/discord', (req, res) => {
    const { guildId } = req.query;
    const state = guildId ? `guild:${guildId}` : 'general';
    
    const discordAuthURL = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20guilds&state=${state}`;
    res.redirect(discordAuthURL);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.redirect('/?error=discord_auth_failed');
    }
    
    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI,
            }),
        });
        
        const tokenData = await tokenResponse.json();
        
        if (tokenData.error) {
            return res.redirect('/?error=token_exchange_failed');
        }
        
        // Get user info
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
        });
        
        const userData = await userResponse.json();
        
        // Get user's guilds
        const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
        });
        
        const guildsData = await guildsResponse.json();
        
        // Store user session
        req.session.user = {
            id: userData.id,
            username: userData.username,
            discriminator: userData.discriminator,
            avatar: userData.avatar,
            access_token: tokenData.access_token
        };
        req.session.guilds = guildsData;
        
        // Check if this is for a specific guild
        if (state && state.startsWith('guild:')) {
            const guildId = state.replace('guild:', '');
            return res.redirect(`/dashboard/${guildId}`);
        }
        
        // Redirect to server selection or admin dashboard
        const BOT_OWNER_ID = '1392169655398977619';
        if (userData.id === BOT_OWNER_ID) {
            res.redirect('/admin');
        } else {
            res.redirect('/servers');
        }
        
    } catch (error) {
        console.error('Discord OAuth error:', error);
        res.redirect('/?error=auth_failed');
    }
});

// Logout route
app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Middleware to check authentication
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// Middleware to check guild ownership/admin
function requireGuildAdmin(req, res, next) {
    const { guildId } = req.params;
    const userGuilds = req.session.guilds || [];
    
    const guild = userGuilds.find(g => g.id === guildId);
    if (!guild || !(guild.permissions & 0x8)) { // Check for ADMINISTRATOR permission
        return res.status(403).json({ error: 'Not authorized for this server' });
    }
    
    req.guild = guild;
    next();
}

// Server selection page
app.get('/servers', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'servers.html'));
});

// Server dashboard
app.get('/dashboard/:guildId', requireAuth, requireGuildAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Admin dashboard route (bot owner only)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin API routes (bot owner only)
app.get('/api/admin/verify', (req, res) => {
    // Simple verification - in production, implement proper Discord OAuth
    const adminKey = req.get('X-Admin-Key');
    const adminParam = req.query.admin;
    
    if (adminKey === 'bot_owner_access' || adminParam === 'true') {
        res.json({ authorized: true });
    } else {
        res.json({ authorized: false });
    }
});

app.get('/api/admin/server-overview', requireBotOwner, (req, res) => {
    if (!client) {
        return res.json({
            totalServers: 0,
            totalUsers: 0,
            largestServer: 'N/A',
            avgMembers: 0
        });
    }

    const guilds = client.guilds.cache;
    const totalServers = guilds.size;
    const totalUsers = guilds.reduce((acc, guild) => acc + guild.memberCount, 0);
    const largestServer = guilds.reduce((largest, guild) => 
        guild.memberCount > (largest?.memberCount || 0) ? guild : largest, null);
    const avgMembers = totalUsers / totalServers || 0;

    res.json({
        totalServers,
        totalUsers,
        largestServer: largestServer ? `${largestServer.name} (${largestServer.memberCount})` : 'N/A',
        avgMembers
    });
});

app.get('/api/admin/bot-metrics', requireBotOwner, (req, res) => {
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const totalCommands = commandStats ? Object.values(commandStats).reduce((a, b) => a + b, 0) : 0;
    const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const ping = client ? client.ws.ping : 0;

    res.json({
        totalCommands,
        uptime: `${uptimeHours}h ${uptimeMinutes}m`,
        memoryUsage,
        ping
    });
});

app.get('/api/admin/command-usage', requireBotOwner, (req, res) => {
    res.json(commandStats || {});
});

app.get('/api/admin/system-status', requireBotOwner, (req, res) => {
    const uptime = process.uptime();
    const totalCommands = commandStats ? Object.values(commandStats).reduce((a, b) => a + b, 0) : 0;
    const commandsPerHour = Math.round(totalCommands / (uptime / 3600));
    
    res.json({
        lastRestart: new Date(Date.now() - uptime * 1000).toLocaleString(),
        commandsPerHour: commandsPerHour || 0,
        errorRate: 0.1 // You can track actual errors
    });
});

app.get('/api/admin/server-list', requireBotOwner, (req, res) => {
    if (!client) {
        return res.json([]);
    }

    const serverList = client.guilds.cache.map(guild => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        owner: guild.ownerId,
        joinedAt: guild.joinedAt ? guild.joinedAt.toLocaleDateString() : 'Unknown',
        icon: guild.iconURL()
    })).sort((a, b) => b.memberCount - a.memberCount);

    res.json(serverList);
});

// Server Dashboard API Routes
app.get('/api/servers', requireAuth, (req, res) => {
    const userGuilds = req.session.guilds || [];
    const adminGuilds = userGuilds.filter(guild => guild.permissions & 0x8); // ADMINISTRATOR permission
    
    // Add bot presence info
    const guildsWithBotInfo = adminGuilds.map(guild => {
        const botGuild = client ? client.guilds.cache.get(guild.id) : null;
        return {
            ...guild,
            botPresent: !!botGuild,
            memberCount: botGuild ? botGuild.memberCount : null
        };
    });
    
    res.json(guildsWithBotInfo);
});

app.get('/api/dashboard/:guildId/settings', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    
    try {
        // Get guild settings from Firebase
        const db = require('./firebase.js');
        const snapshot = await db.ref(`guilds/${guildId}`).once('value');
        const guildData = snapshot.val() || {};
        
        res.json({
            settings: guildData.settings || {},
            automod: guildData.automod || {},
            autorole: guildData.autorole || null,
            embeds: guildData.embeds || {},
            restrictedChannels: guildData.restrictedChannels || []
        });
    } catch (error) {
        console.error('Error fetching guild settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

app.get('/api/dashboard/:guildId/channels', requireAuth, requireGuildAdmin, (req, res) => {
    const { guildId } = req.params;
    
    if (!client) {
        return res.json([]);
    }
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return res.status(404).json({ error: 'Guild not found' });
    }
    
    const channels = guild.channels.cache
        .filter(channel => channel.type === 0) // Text channels only
        .map(channel => ({
            id: channel.id,
            name: channel.name,
            position: channel.position
        }))
        .sort((a, b) => a.position - b.position);
    
    res.json(channels);
});

app.get('/api/dashboard/:guildId/roles', requireAuth, requireGuildAdmin, (req, res) => {
    const { guildId } = req.params;
    
    if (!client) {
        return res.json([]);
    }
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return res.status(404).json({ error: 'Guild not found' });
    }
    
    const roles = guild.roles.cache
        .filter(role => role.id !== guild.id) // Exclude @everyone
        .map(role => ({
            id: role.id,
            name: role.name,
            color: role.hexColor,
            position: role.position,
            memberCount: role.members.size
        }))
        .sort((a, b) => b.position - a.position);
    
    res.json(roles);
});

app.post('/api/dashboard/:guildId/settings/welcome', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { channelId, messages } = req.body;
    
    try {
        const db = require('./firebase.js');
        const settings = {
            welcomeChannel: channelId,
            welcomeMessages: messages || ['Welcome {user} to {server}! You are the {membercount} member!']
        };
        
        await db.ref(`guilds/${guildId}/settings`).update(settings);
        res.json({ success: true, message: 'Welcome settings updated' });
    } catch (error) {
        console.error('Error updating welcome settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

app.post('/api/dashboard/:guildId/settings/leave', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { channelId, messages } = req.body;
    
    try {
        const db = require('./firebase.js');
        const settings = {
            leaveChannel: channelId,
            leaveMessages: messages || ['{username} has left {server}. We\'ll miss you! 👋']
        };
        
        await db.ref(`guilds/${guildId}/settings`).update(settings);
        res.json({ success: true, message: 'Leave settings updated' });
    } catch (error) {
        console.error('Error updating leave settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

app.post('/api/dashboard/:guildId/autorole', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { roleId } = req.body;
    
    try {
        const db = require('./firebase.js');
        
        if (roleId) {
            await db.ref(`guilds/${guildId}/autorole`).set(roleId);
            res.json({ success: true, message: 'Auto role set successfully' });
        } else {
            await db.ref(`guilds/${guildId}/autorole`).remove();
            res.json({ success: true, message: 'Auto role removed successfully' });
        }
    } catch (error) {
        console.error('Error updating auto role:', error);
        res.status(500).json({ error: 'Failed to update auto role' });
    }
});

app.post('/api/dashboard/:guildId/embed', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { title, description, color, thumbnail, image, footer, timestamp, buttons } = req.body;
    
    try {
        const db = require('./firebase.js');
        const embedId = `embed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const embedData = {
            id: embedId,
            title,
            description,
            color,
            thumbnail,
            image,
            footer,
            timestamp,
            buttons,
            createdBy: req.session.user.id,
            createdAt: Date.now(),
            guildId
        };
        
        await db.ref(`guilds/${guildId}/embeds/${embedId}`).set(embedData);
        res.json({ success: true, embedId, message: 'Embed created successfully' });
    } catch (error) {
        console.error('Error creating embed:', error);
        res.status(500).json({ error: 'Failed to create embed' });
    }
});

app.post('/api/dashboard/:guildId/automod', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { linkFilter, badWordFilter, badWords } = req.body;
    
    try {
        const db = require('./firebase.js');
        const automodSettings = {
            linkFilter: linkFilter || false,
            badWordFilter: badWordFilter || false,
            badWords: badWords || []
        };
        
        await db.ref(`guilds/${guildId}/automod`).set(automodSettings);
        res.json({ success: true, message: 'Auto-moderation settings updated' });
    } catch (error) {
        console.error('Error updating automod settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// API endpoint for bot stats (public)
app.get('/api/bot-stats', (req, res) => {
    if (!client) {
        return res.json({
            servers: 0,
            users: 0,
            commands: 0,
            uptime: 0
        });
    }

    const guilds = client.guilds.cache;
    const totalUsers = guilds.reduce((acc, guild) => acc + guild.memberCount, 0);
    const totalCommands = commandStats ? Object.values(commandStats).reduce((a, b) => a + b, 0) : 0;
    const uptime = Math.round((process.uptime() / 86400) * 10) / 10; // Days with 1 decimal

    res.json({
        servers: guilds.size,
        users: totalUsers,
        commands: totalCommands,
        uptime: uptime
    });
});

// Export the setBotData function
module.exports = { app, setBotData };

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve the main website
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404s
app.use((req, res) => {
    res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>404 - Page Not Found</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    text-align: center; 
                    padding: 50px; 
                    background: #2c2f33; 
                    color: white; 
                }
                h1 { color: #5865f2; }
                a { color: #5865f2; text-decoration: none; }
            </style>
        </head>
        <body>
            <h1>404 - Page Not Found</h1>
            <p>The page you're looking for doesn't exist.</p>
            <a href="/">← Back to Home</a>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Website server running on port ${PORT}`);
    console.log(`📱 Visit your website at: http://localhost:${PORT}`);
});

module.exports = app;
