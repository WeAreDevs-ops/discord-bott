const express = require('express');
const path = require('path');
const session = require('express-session');
const fetch = require('node-fetch');
const app = express();

// Configure session middleware with memory store
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Parse JSON bodies
app.use(express.json());

// Parse cookies for persistent login
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Discord OAuth2 configuration
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1393887962772734104';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
// Dynamic redirect URI based on deployment platform
const getBaseUrl = () => {
    if (process.env.DISCORD_REDIRECT_URI) {
        return process.env.DISCORD_REDIRECT_URI;
    }

    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/auth/discord/callback`;
    }

    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}/auth/discord/callback`;
    }

    if (process.env.REPLIT_DEV_DOMAIN) {
        return `https://${process.env.REPLIT_DEV_DOMAIN}/auth/discord/callback`;
    }

    // Fallback for local development
    return `http://localhost:${process.env.PORT || 5000}/auth/discord/callback`;
};

const DISCORD_REDIRECT_URI = getBaseUrl();
// OAuth2 Scopes configuration
const OAUTH_SCOPES = {
    basic: ['identify', 'guilds'],
    admin: ['identify', 'guilds', 'guilds.join'],
    bot: ['identify', 'guilds', 'bot', 'applications.commands'],
    full: ['identify', 'email', 'guilds', 'guilds.join', 'guilds.members.read', 'bot', 'applications.commands']
};

// Token storage for enhanced OAuth2 flow
const userTokens = new Map(); // userId -> { access_token, refresh_token, expires_at, scope }

// Import the existing bot (this will start the Discord bot)
let client = null;
let commandStats = null;

// Function to set bot data from index.js
function setBotData(botClient, stats) {
    client = botClient;
    commandStats = stats;
    console.log('✅ Bot data connected to server');
}

// Initialize bot data after a delay to avoid circular dependency
setTimeout(() => {
    try {
        const indexModule = require('./index.js');
        if (indexModule && indexModule.client) {
            client = indexModule.client;
            commandStats = indexModule.commandStats;
            console.log('✅ Bot client connected to server');
        }
    } catch (error) {
        console.log('Bot will initialize separately');
    }
}, 2000);

// Bot owner Discord ID (replace with your actual Discord user ID)
const BOT_OWNER_ID = '593300598452125754';

// Middleware to check if user is bot owner
function requireBotOwner(req, res, next) {
    const userId = req.session.user?.id;

    if (userId === BOT_OWNER_ID) {
        next();
    } else {
        res.status(403).json({ 
            authorized: false, 
            message: 'Bot owner access required',
            currentUser: userId || 'not authenticated',
            requiredUser: BOT_OWNER_ID
        });
    }
}

// Discord OAuth Routes with enhanced scope support
app.get('/auth/discord', (req, res) => {
    const { guildId, scope = 'basic', permissions = '8' } = req.query;

    // Build state object with more information
    const stateData = {
        guildId: guildId || null,
        scope: scope,
        permissions: permissions,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(2, 15)
    };

    const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

    // Select appropriate scopes based on request
    let selectedScopes = OAUTH_SCOPES.basic;
    if (scope === 'admin' || permissions) {
        selectedScopes = OAUTH_SCOPES.admin;
    } else if (scope === 'bot') {
        selectedScopes = OAUTH_SCOPES.bot;
    } else if (scope === 'full') {
        selectedScopes = OAUTH_SCOPES.full;
    }

    const scopeString = selectedScopes.join('%20');
    let discordAuthURL = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${scopeString}&state=${encodeURIComponent(state)}`;
    
    // Add permissions parameter if provided
    if (permissions && permissions !== 'undefined') {
        discordAuthURL += `&permissions=${permissions}`;
    }

    console.log(`OAuth2 request: scope=${scope}, permissions=${permissions}, scopes=${selectedScopes.join(' ')}`);
    res.redirect(discordAuthURL);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        console.error('OAuth2 error from Discord:', error);
        return res.redirect(`/?error=${error}`);
    }

    if (!code) {
        return res.redirect('/?error=discord_auth_failed&reason=no_code');
    }

    let stateData = {};
    try {
        if (state) {
            stateData = JSON.parse(Buffer.from(state, 'base64').toString());

            // Validate state timestamp (prevent replay attacks)
            if (Date.now() - stateData.timestamp > 600000) { // 10 minutes
                return res.redirect('/?error=state_expired');
            }
        }
    } catch (e) {
        console.error('Invalid state parameter:', e);
        return res.redirect('/?error=invalid_state');
    }

    try {
        // Exchange code for access token with enhanced error handling
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'INC-Bot/1.0'
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
            console.error('Token exchange error:', tokenData);
            return res.redirect(`/?error=token_exchange_failed&reason=${tokenData.error}`);
        }

        // Calculate token expiration
        const expiresAt = Date.now() + (tokenData.expires_in * 1000);

        // Enhanced user data fetching with error handling
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                'User-Agent': 'INC-Bot/1.0'
            },
        });

        if (!userResponse.ok) {
            console.error('Failed to fetch user data:', userResponse.status);
            return res.redirect('/?error=user_fetch_failed');
        }

        const userData = await userResponse.json();

        // Enhanced guilds fetching with permissions check
        const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                'User-Agent': 'INC-Bot/1.0'
            },
        });

        const guildsData = guildsResponse.ok ? await guildsResponse.json() : [];

        // Store enhanced token information
        userTokens.set(userData.id, {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            token_type: tokenData.token_type || 'Bearer',
            scope: tokenData.scope,
            expires_at: expiresAt,
            granted_scopes: tokenData.scope ? tokenData.scope.split(' ') : [],
            stateData: stateData
        });

        // Store enhanced user session
        req.session.user = {
            id: userData.id,
            username: userData.username,
            discriminator: userData.discriminator,
            avatar: userData.avatar,
            email: userData.email || null,
            verified: userData.verified || false,
            access_token: tokenData.access_token,
            token_expires_at: expiresAt,
            granted_scopes: tokenData.scope ? tokenData.scope.split(' ') : []
        };
        req.session.guilds = guildsData;
        req.session.oauth_state = stateData;

        // Store enhanced token information in memory
        console.log(`Stored session for user ${userData.username}`)

        console.log(`OAuth2 success for ${userData.username} (${userData.id}) with scopes: ${tokenData.scope}`);

        // Set persistent login cookie
        res.cookie('user_id', userData.id, {
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        // Enhanced redirect logic based on state data
        if (stateData.type === 'bot_invite') {
            // Bot was successfully invited
            console.log(`Bot invited to guild ${stateData.guildId} by ${userData.username}`);

            if (stateData.guildId) {
                return res.redirect(`/servers?bot_added=${stateData.guildId}&oauth_success=true`);
            } else {
                return res.redirect('/servers?oauth_success=true&message=bot_added');
            }
        }

        if (stateData.guildId) {
            return res.redirect(`/dashboard/${stateData.guildId}?oauth_success=true`);
        }

        // Check for bot owner
        if (userData.id === BOT_OWNER_ID) {
            return res.redirect('/admin?oauth_success=true');
        }

        // Redirect based on granted permissions
        const hasGuildPermissions = tokenData.scope && tokenData.scope.includes('guilds');
        if (hasGuildPermissions && guildsData.length > 0) {
            res.redirect('/servers?oauth_success=true');
        } else {
            res.redirect('/?oauth_success=true&limited_access=true');
        }

    } catch (error) {
        console.error('Discord OAuth error:', error);
        res.redirect(`/?error=auth_failed&reason=${encodeURIComponent(error.message)}`);
    }
});

// Token refresh route for OAuth2
app.post('/auth/refresh', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const storedTokens = userTokens.get(userId);

    if (!storedTokens || !storedTokens.refresh_token) {
        return res.status(401).json({ error: 'No refresh token available' });
    }

    try {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'INC-Bot/1.0'
            },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: storedTokens.refresh_token,
            }),
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            console.error('Token refresh error:', tokenData);
            return res.status(401).json({ error: 'Failed to refresh token' });
        }

        // Update stored tokens
        const expiresAt = Date.now() + (tokenData.expires_in * 1000);
        userTokens.set(userId, {
            ...storedTokens,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || storedTokens.refresh_token,
            expires_at: expiresAt,
            scope: tokenData.scope || storedTokens.scope
        });

        // Update session
        req.session.user.access_token = tokenData.access_token;
        req.session.user.token_expires_at = expiresAt;

        console.log(`Token refreshed for user ${userId}`);
        res.json({ success: true, expires_at: expiresAt });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ error: 'Internal server error during token refresh' });
    }
});

// Enhanced logout route
app.get('/auth/logout', async (req, res) => {
    const userId = req.session.user?.id;
    if (userId) {
        userTokens.delete(userId);
        console.log(`User ${userId} logged out`);
    }

    req.session.destroy();

    // Clear persistent login cookie
    res.clearCookie('user_id');
    res.clearCookie('auth_token');

    res.redirect('/?logged_out=true');
});

// Enhanced middleware to check authentication with token validation and persistent login
async function requireAuth(req, res, next) {
    // First check Express session
    if (req.session.user) {
        // Check if token is expired and needs refresh
        const tokenExpiresAt = req.session.user.token_expires_at;
        const now = Date.now();

        if (tokenExpiresAt && now >= tokenExpiresAt - 300000) { // 5 minutes before expiry
            const storedTokens = userTokens.get(req.session.user.id);
            if (storedTokens && storedTokens.refresh_token) {
                // Token is about to expire, client should refresh
                res.setHeader('X-Token-Refresh-Required', 'true');
            }
        }
        return next();
    }

    // Check for stored tokens in memory
    const userIdFromCookie = req.cookies?.user_id;
    
    if (userIdFromCookie && userTokens.has(userIdFromCookie)) {
        const storedTokens = userTokens.get(userIdFromCookie);
        
        if (storedTokens.expires_at > Date.now()) {
            // Token is still valid, try to get user info from Discord
            try {
                const userResponse = await fetch('https://discord.com/api/users/@me', {
                    headers: {
                        Authorization: `Bearer ${storedTokens.access_token}`,
                        'User-Agent': 'INC-Bot/1.0'
                    },
                });

                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    
                    // Restore session from Discord API
                    req.session.user = {
                        id: userData.id,
                        username: userData.username,
                        discriminator: userData.discriminator,
                        avatar: userData.avatar,
                        access_token: storedTokens.access_token,
                        token_expires_at: storedTokens.expires_at,
                        granted_scopes: storedTokens.granted_scopes
                    };

                    console.log(`Restored session from Discord API for user ${userData.username}`);
                    return next();
                } else {
                    // Token invalid, remove it
                    userTokens.delete(userIdFromCookie);
                }
            } catch (error) {
                console.error('Error validating token with Discord:', error);
                userTokens.delete(userIdFromCookie);
            }
        } else {
            // Token expired, remove it
            userTokens.delete(userIdFromCookie);
        }
    }

    return res.status(401).json({ error: 'Not authenticated' });
}

// Middleware to check specific OAuth2 scopes
function requireScopes(requiredScopes) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userScopes = req.session.user.granted_scopes || [];
        const hasRequiredScopes = requiredScopes.every(scope => userScopes.includes(scope));

        if (!hasRequiredScopes) {
            const missingScopes = requiredScopes.filter(scope => !userScopes.includes(scope));
            return res.status(403).json({ 
                error: 'Insufficient permissions', 
                required_scopes: requiredScopes,
                missing_scopes: missingScopes,
                reauth_url: `/auth/discord?scope=full&permissions=${requiredScopes.join(',')}`
            });
        }

        next();
    };
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
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin API routes (bot owner only)
app.get('/api/admin/verify', requireAuth, (req, res) => {
    // Check if authenticated user is the bot owner
    const userId = req.session.user?.id;
    const isOwner = userId === BOT_OWNER_ID;

    if (isOwner) {
        res.json({ 
            authorized: true, 
            user: {
                id: req.session.user.id,
                username: req.session.user.username,
                avatar: req.session.user.avatar
            }
        });
    } else {
        res.json({ 
            authorized: false, 
            message: 'Bot owner access required',
            currentUser: userId || 'not authenticated'
        });
    }
});

app.get('/api/admin/server-overview', requireAuth, requireBotOwner, (req, res) => {
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

app.get('/api/admin/bot-metrics', requireAuth, requireBotOwner, (req, res) => {
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

app.get('/api/admin/command-usage', requireAuth, requireBotOwner, (req, res) => {
    res.json(commandStats || {});
});

app.get('/api/admin/system-status', requireAuth, requireBotOwner, (req, res) => {
    const uptime = process.uptime();
    const totalCommands = commandStats ? Object.values(commandStats).reduce((a, b) => a + b, 0) : 0;
    const commandsPerHour = Math.round(totalCommands / (uptime / 3600));

    res.json({
        lastRestart: new Date(Date.now() - uptime * 1000).toLocaleString(),
        commandsPerHour: commandsPerHour || 0,
        errorRate: 0.1 // You can track actual errors
    });
});

app.get('/api/admin/server-list', requireAuth, requireBotOwner, (req, res) => {
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

// Firebase data endpoint for admin monitoring
app.get('/api/admin/firebase-data', requireAuth, requireBotOwner, async (req, res) => {
    try {
        // Fetch all guilds data from Firebase
        const guildsSnapshot = await db.ref('guilds').once('value');
        const guildsData = guildsSnapshot.val() || {};

        // Calculate analytics
        const analytics = {
            totalGuilds: Object.keys(guildsData).length,
            guildsWithSettings: Object.values(guildsData).filter(guild => guild.settings).length,
            guildsWithAutomod: Object.values(guildsData).filter(guild => guild.automod).length,
            guildsWithEmbeds: Object.values(guildsData).filter(guild => guild.embeds).length,
            totalEmbeds: Object.values(guildsData).reduce((total, guild) => {
                return total + Object.keys(guild.embeds || {}).length;
            }, 0),
            totalRestrictedChannels: Object.values(guildsData).reduce((total, guild) => {
                return total + (guild.restrictedChannels ? guild.restrictedChannels.length : 0);
            }, 0)
        };

        // Get recent activity (last 24 hours of updates)
        const now = Date.now();
        const dayAgo = now - (24 * 60 * 60 * 1000);

        const recentActivity = [];
        Object.entries(guildsData).forEach(([guildId, guild]) => {
            if (guild.embeds) {
                Object.values(guild.embeds).forEach(embed => {
                    if (embed.createdAt && embed.createdAt > dayAgo) {
                        recentActivity.push({
                            type: 'embed_created',
                            guildId,
                            timestamp: embed.createdAt,
                            details: `Embed created: ${embed.title}`
                        });
                    }
                    if (embed.updatedAt && embed.updatedAt > dayAgo) {
                        recentActivity.push({
                            type: 'embed_updated',
                            guildId,
                            timestamp: embed.updatedAt,
                            details: `Embed updated: ${embed.title}`
                        });
                    }
                });
            }
        });

        // Sort recent activity by timestamp
        recentActivity.sort((a, b) => b.timestamp - a.timestamp);

        res.json({
            guilds: guildsData,
            analytics,
            recentActivity: recentActivity.slice(0, 20), // Last 20 activities
            lastUpdated: now
        });

    } catch (error) {
        console.error('Error fetching Firebase data for admin:', error);
        res.status(500).json({ 
            error: 'Failed to fetch Firebase data',
            guilds: {},
            analytics: {
                totalGuilds: 0,
                guildsWithSettings: 0,
                guildsWithAutomod: 0,
                guildsWithEmbeds: 0,
                totalEmbeds: 0,
                totalRestrictedChannels: 0
            },
            recentActivity: [],
            lastUpdated: Date.now()
        });
    }
});

// Direct server data route - bypasses Firebase and uses Discord client directly
app.get('/api/server/:serverId/data', requireAuth, requireGuildAdmin, async (req, res) => {
    const { serverId } = req.params;

    try {
        if (!client) {
            return res.status(503).json({ error: 'Bot not connected' });
        }

        // Get the guild from Discord directly
        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            return res.status(404).json({ error: 'Bot not in this server or server not found' });
        }

        // Fetch all channels
        const channelsCollection = await guild.channels.fetch();
        const channels = channelsCollection
            .filter(channel => channel && channel.type === 0) // Text channels only
            .map(channel => ({
                id: channel.id,
                name: channel.name
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        // Fetch all roles
        const rolesCollection = await guild.roles.fetch();
        const roles = rolesCollection
            .filter(role => role && role.id !== guild.id && !role.managed) // Exclude @everyone and managed roles
            .map(role => ({
                id: role.id,
                name: role.name
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        console.log(`Fetched ${channels.length} channels and ${roles.length} roles for guild ${guild.name}`);
        res.json({ channels, roles });

    } catch (error) {
        console.error('Error fetching server data:', error);
        res.status(500).json({ error: 'Failed to fetch server data', details: error.message });
    }
});

// Server Dashboard API Routes
app.get('/api/servers', requireAuth, async (req, res) => {
    try {
        const userGuilds = req.session.guilds || [];
        const adminGuilds = userGuilds.filter(guild => guild.permissions & 0x8); // ADMINISTRATOR permission

        // Check bot presence directly from Discord client
        const guildsWithBotInfo = adminGuilds.map(guild => {
            const botGuild = client ? client.guilds.cache.get(guild.id) : null;
            const botPresent = !!botGuild;

            return {
                ...guild,
                botPresent: botPresent,
                memberCount: botGuild ? botGuild.memberCount : guild.approximate_member_count,
                displayMemberCount: botGuild ? botGuild.memberCount.toLocaleString() : 'Unknown',
                botJoinedAt: botGuild ? botGuild.joinedTimestamp : null
            };
        });

        res.json(guildsWithBotInfo);
    } catch (error) {
        console.error('Error fetching servers:', error);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

app.get('/api/dashboard/:guildId/settings', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;

    try {
        // Get guild settings from Firebase
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

app.get('/api/dashboard/:guildId/channels', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;

    try {
        if (!client) {
            return res.status(503).json({ error: 'Bot not connected' });
        }

        // Get guild directly from Discord client cache
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Bot not in this server' });
        }

        // Fetch all channels
        const channelsCollection = await guild.channels.fetch();
        const channels = channelsCollection
            .filter(channel => channel && channel.type === 0) // Text channels only
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                position: channel.position || 0,
                parentId: channel.parentId || null
            }))
            .sort((a, b) => a.position - b.position);

        console.log(`Fetched ${channels.length} channels for guild ${guild.name}`);
        res.json(channels);

    } catch (error) {
        console.error('Error fetching channels:', error);
        res.status(500).json({ error: 'Failed to fetch channels', details: error.message });
    }
});

app.get('/api/dashboard/:guildId/roles', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;

    try {
        if (!client) {
            return res.status(503).json({ error: 'Bot not connected' });
        }

        // Get guild directly from Discord client cache
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Bot not in this server' });
        }

        // Fetch all roles
        const rolesCollection = await guild.roles.fetch();
        const roles = rolesCollection
            .filter(role => role && role.id !== guild.id && !role.managed) // Exclude @everyone and managed roles
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.hexColor || '#99aab5',
                position: role.position || 0,
                memberCount: role.members ? role.members.size : 0,
                managed: role.managed || false
            }))
            .sort((a, b) => b.position - a.position);

        console.log(`Fetched ${roles.length} roles for guild ${guild.name}`);
        res.json(roles);

    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({ error: 'Failed to fetch roles', details: error.message });
    }
});

app.get('/api/dashboard/:guildId/info', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;

    try {
        // Check Firebase first for bot presence
        const guildSnapshot = await db.ref(`guilds/${guildId}`).once('value');
        const guildData = guildSnapshot.val();

        if (!guildData || !guildData.botPresent) {
            return res.status(404).json({ error: 'Bot not in this server' });
        }

        if (!client) {
            return res.status(503).json({ error: 'Bot not connected' });
        }

        // Try to fetch the guild from Discord
        let guild;
        try {
            guild = await client.guilds.fetch(guildId);
        } catch (error) {
            console.error(`Error fetching guild ${guildId}:`, error);
            return res.status(404).json({ error: 'Cannot access guild data' });
        }

        // Get additional guild information
        const guildInfo = {
            id: guild.id,
            name: guild.name,
            description: guild.description || null,
            memberCount: guild.memberCount || guildData.memberCount || 0,
            icon: guild.iconURL({ size: 256 }) || guildData.iconURL,
            ownerId: guild.ownerId || guildData.ownerId,
            createdAt: guild.createdAt || new Date(guild.createdTimestamp),
            features: guild.features || [],
            verificationLevel: guild.verificationLevel || 0,
            botJoinedAt: guild.joinedAt || new Date(guildData.joinedAt || Date.now())
        };

        console.log(`Fetched guild info for ${guild.name}`);
        res.json(guildInfo);

    } catch (error) {
        console.error('Error fetching guild info:', error);
        res.status(500).json({ error: 'Failed to fetch guild info', details: error.message });
    }
});

// Force refresh server data endpoint
app.post('/api/servers/refresh', requireAuth, async (req, res) => {
    try {
        if (!client) {
            return res.status(500).json({ error: 'Bot not connected' });
        }

        // Sync all current guilds to Firebase
        const currentGuilds = client.guilds.cache;
        let syncedCount = 0;

        for (const guild of currentGuilds.values()) {
            try {
                await db.ref(`guilds/${guild.id}`).update({
                    name: guild.name,
                    memberCount: guild.memberCount,
                    ownerId: guild.ownerId,
                    botPresent: true,
                    iconURL: guild.iconURL() || null,
                    lastUpdated: Date.now()
                });
                syncedCount++;
            } catch (error) {
                console.error(`Error syncing guild ${guild.name}:`, error);
            }
        }

        console.log(`Manual refresh: synced ${syncedCount} guilds to Firebase`);
        res.json({ 
            success: true, 
            message: `Refreshed data for ${syncedCount} servers`,
            syncedCount 
        });

    } catch (error) {
        console.error('Error refreshing server data:', error);
        res.status(500).json({ error: 'Failed to refresh server data' });
    }
});

app.post('/api/dashboard/:guildId/settings/welcome', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { channelId, messages } = req.body;

    try {
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
    const { title, description, color, thumbnail, image, footer, timestamp, buttons, channelId } = req.body;

    try {
        const embedId = `embed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create embed data
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

        // Save to database
        await db.ref(`guilds/${guildId}/embeds/${embedId}`).set(embedData);

        // If channelId provided, send the embed to Discord
        if (channelId && client) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                const channel = guild.channels.cache.get(channelId);
                if (channel && channel.type === 0) { // Text channel
                    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

                    // Parse color
                    let embedColor = 0x5865f2;
                    if (color) {
                        if (color.startsWith('#')) {
                            embedColor = parseInt(color.slice(1), 16);
                        } else if (!isNaN(color)) {
                            embedColor = parseInt(color);
                        }
                    }

                    const embed = new EmbedBuilder()
                        .setColor(embedColor)
                        .setTitle(title)
                        .setDescription(description);

                    if (thumbnail) embed.setThumbnail(thumbnail);
                    if (image) embed.setImage(image);
                    if (footer) embed.setFooter({ text: footer });
                    if (timestamp) embed.setTimestamp();

                    // Parse buttons if provided
                    const components = [];
                    if (buttons) {
                        try {
                            const buttonPairs = buttons.split('|');
                            if (buttonPairs.length <= 5) {
                                const buttonComponents = [];

                                for (const pair of buttonPairs) {
                                    const [label, url] = pair.split(',').map(s => s.trim());
                                    if (label && url) {
                                        buttonComponents.push(
                                            new ButtonBuilder()
                                                .setLabel(label)
                                                .setStyle(ButtonStyle.Link)
                                                .setURL(url)
                                        );
                                    }
                                }

                                if (buttonComponents.length > 0) {
                                    components.push(new ActionRowBuilder().addComponents(buttonComponents));
                                }
                            }
                        } catch (buttonError) {
                            console.error('Error parsing buttons:', buttonError);
                        }
                    }

                    const messageOptions = { embeds: [embed] };
                    if (components.length > 0) {
                        messageOptions.components = components;
                    }

                    await channel.send(messageOptions);

                    res.json({ 
                        success: true, 
                        embedId, 
                        message: `Embed created and sent to #${channel.name} successfully`,
                        channelName: channel.name
                    });
                } else {
                    res.json({ 
                        success: true, 
                        embedId, 
                        message: 'Embed created successfully but channel not found or invalid'
                    });
                }
            } else {
                res.json({ 
                    success: true, 
                    embedId, 
                    message: 'Embed created successfully but guild not found'
                });
            }
        } else {
            res.json({ 
                success: true, 
                embedId, 
                message: 'Embed created successfully'
            });
        }

    } catch (error) {
        console.error('Error creating embed:', error);
        res.status(500).json({ error: 'Failed to create embed' });
    }
});

app.post('/api/dashboard/:guildId/automod', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { linkFilter, badWordFilter, badWords } = req.body;

    try {
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

app.post('/api/dashboard/:guildId/channels/restrict', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;
    const { channelId, restricted } = req.body;

    try {
        const snapshot = await db.ref(`guilds/${guildId}/restrictedChannels`).once('value');
        let restrictedChannels = snapshot.val() || [];

        if (restricted) {
            if (!restrictedChannels.includes(channelId)) {
                restrictedChannels.push(channelId);
            }
        } else {
            restrictedChannels = restrictedChannels.filter(id => id !== channelId);
        }

        await db.ref(`guilds/${guildId}/restrictedChannels`).set(restrictedChannels);
        res.json({ success: true, message: 'Channel restriction updated' });
    } catch (error) {
        console.error('Error updating channel restriction:', error);
        res.status(500).json({ error: 'Failed to update channel restriction' });
    }
});

// API endpoint for bot configuration (public)
app.get('/api/bot-config', (req, res) => {
    res.json({
        clientId: DISCORD_CLIENT_ID,
        requiresCodeGrant: true
    });
});

// OAuth2 bot invite endpoint
app.get('/auth/discord/bot-invite', (req, res) => {
    const { guildId, permissions = '8' } = req.query;

    // Build state object for bot invite
    const stateData = {
        type: 'bot_invite',
        guildId: guildId || null,
        permissions: permissions,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(2, 15)
    };

    const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

    // OAuth2 URL for bot with code grant
    const scope = 'bot%20applications.commands';
    const responseType = 'code';
    const redirectUri = encodeURIComponent(DISCORD_REDIRECT_URI);

    let authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=${responseType}&redirect_uri=${redirectUri}&scope=${scope}&state=${encodeURIComponent(state)}`;
    
    // Add permissions if provided and not undefined
    if (permissions && permissions !== 'undefined') {
        authUrl += `&permissions=${permissions}`;
    }

    if (guildId) {
        authUrl += `&guild_id=${guildId}`;
    }

    console.log(`Bot invite: guildId=${guildId}, permissions=${permissions}`);
    res.redirect(authUrl);
});

// API endpoint for session management
app.get('/api/session/check', async (req, res) => {
    try {
        if (req.session.user) {
            return res.json({ 
                authenticated: true,
                user: {
                    id: req.session.user.id,
                    username: req.session.user.username,
                    avatar: req.session.user.avatar
                },
                expiresAt: req.session.user.token_expires_at
            });
        }

        const userId = req.cookies?.user_id;
        if (!userId || !userTokens.has(userId)) {
            return res.json({ authenticated: false });
        }

        const storedTokens = userTokens.get(userId);
        if (storedTokens.expires_at > Date.now()) {
            // Verify token with Discord API
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: {
                    Authorization: `Bearer ${storedTokens.access_token}`,
                    'User-Agent': 'INC-Bot/1.0'
                },
            });

            if (userResponse.ok) {
                const userData = await userResponse.json();
                return res.json({ 
                    authenticated: true,
                    user: {
                        id: userData.id,
                        username: userData.username,
                        avatar: userData.avatar
                    },
                    expiresAt: storedTokens.expires_at
                });
            }
        }
        
        // Token invalid or expired
        userTokens.delete(userId);
        return res.json({ authenticated: false });
    } catch (error) {
        console.error('Error checking session:', error);
        res.json({ authenticated: false });
    }
});

app.post('/api/session/extend', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const newExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

        // Update in-memory token storage
        if (userTokens.has(userId)) {
            const storedTokens = userTokens.get(userId);
            storedTokens.expires_at = newExpiry;
            userTokens.set(userId, storedTokens);
        }

        // Update session
        req.session.user.token_expires_at = newExpiry;

        // Update cookie
        res.cookie('user_id', userId, {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        res.json({ success: true, expiresAt: newExpiry });
    } catch (error) {
        console.error('Error extending session:', error);
        res.status(500).json({ error: 'Failed to extend session' });
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
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
    console.log(`🌐 Website server running on ${HOST}:${PORT}`);

    // Dynamic URL detection for different deployment platforms
    const deploymentUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : `http://${HOST}:${PORT}`;

    console.log(`📱 Application URL: ${deploymentUrl}`);
    console.log(`🌍 Platform: ${process.env.RAILWAY_PUBLIC_DOMAIN ? 'Railway' : process.env.VERCEL_URL ? 'Vercel' : process.env.REPLIT_DEV_DOMAIN ? 'Replit' : 'Local'}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

server.on('error', (error) => {
    console.error('Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = app;