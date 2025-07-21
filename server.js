const express = require('express');
const path = require('path');
const session = require('express-session');
const fetch = require('node-fetch');
const cookieParser = require('cookie-parser');
const app = express();

// Configure session middleware with memory store (no Firebase)
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Parse JSON bodies and cookies
app.use(express.json());
app.use(cookieParser());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Discord OAuth2 configuration
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1393887962772734104';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

// Dynamic redirect URI based on deployment platform
const getBaseUrl = () => {
    if (process.env.DISCORD_REDIRECT_URI) {
        console.log('Using explicit DISCORD_REDIRECT_URI:', process.env.DISCORD_REDIRECT_URI);
        return process.env.DISCORD_REDIRECT_URI;
    }

    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        const url = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/auth/discord/callback`;
        console.log('Using Railway URL:', url);
        return url;
    }

    if (process.env.VERCEL_URL) {
        const url = `https://${process.env.VERCEL_URL}/auth/discord/callback`;
        console.log('Using Vercel URL:', url);
        return url;
    }

    if (process.env.REPLIT_DEV_DOMAIN) {
        const url = `https://${process.env.REPLIT_DEV_DOMAIN}/auth/discord/callback`;
        console.log('Using Replit URL:', url);
        return url;
    }

    // Fallback for local development
    const url = `http://localhost:${process.env.PORT || 5000}/auth/discord/callback`;
    console.log('Using localhost URL:', url);
    return url;
};

const DISCORD_REDIRECT_URI = getBaseUrl();
console.log('🔗 Discord OAuth Redirect URI configured:', DISCORD_REDIRECT_URI);

// OAuth2 Scopes configuration
const OAUTH_SCOPES = {
    basic: ['identify', 'guilds'],
    admin: ['identify', 'guilds', 'guilds.join'],
    bot: ['identify', 'guilds', 'bot', 'applications.commands'],
    full: ['identify', 'email', 'guilds', 'guilds.join', 'guilds.members.read', 'bot', 'applications.commands']
};

// In-memory token storage for Discord tokens
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

// Discord OAuth Routes
app.get('/auth/discord', (req, res) => {
    const { guildId, scope = 'basic', permissions = '8' } = req.query;

    console.log('OAuth2 initiation:', { guildId, scope, permissions });
    console.log('Using redirect URI:', DISCORD_REDIRECT_URI);

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
    
    // Ensure redirect_uri matches exactly what Discord expects
    const redirectUri = encodeURIComponent(DISCORD_REDIRECT_URI);
    
    let discordAuthURL = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scopeString}&state=${encodeURIComponent(state)}`;

    // Add permissions parameter if provided
    if (permissions && permissions !== 'undefined') {
        discordAuthURL += `&permissions=${permissions}`;
    }

    console.log(`OAuth2 request: scope=${scope}, permissions=${permissions}, scopes=${selectedScopes.join(' ')}`);
    console.log('Generated auth URL (without secrets):', discordAuthURL.replace(DISCORD_CLIENT_ID, '[CLIENT_ID]'));
    
    res.redirect(discordAuthURL);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state, error, guild_id } = req.query;

    console.log('OAuth callback received:', { 
        code: code ? 'present' : 'missing', 
        state: state ? 'present' : 'missing', 
        error,
        guild_id 
    });

    if (error) {
        console.error('OAuth2 error from Discord:', error);
        return res.redirect(`/?error=${error}`);
    }

    if (!code) {
        console.error('No authorization code received');
        return res.redirect('/?error=discord_auth_failed&reason=no_code');
    }

    let stateData = {};
    try {
        if (state) {
            stateData = JSON.parse(Buffer.from(decodeURIComponent(state), 'base64').toString());

            // Validate state timestamp (prevent replay attacks)
            if (Date.now() - stateData.timestamp > 600000) { // 10 minutes
                console.error('State expired:', Date.now() - stateData.timestamp);
                return res.redirect('/?error=state_expired');
            }
        }
    } catch (e) {
        console.error('Invalid state parameter:', e);
        // Continue without state validation for now
        stateData = {};
    }

    try {
        console.log('Attempting token exchange with Discord...');
        console.log('Using redirect URI:', DISCORD_REDIRECT_URI);

        // Ensure the redirect URI matches exactly what was sent in the authorization request
        const exactRedirectUri = DISCORD_REDIRECT_URI;

        // Exchange code for access token
        const tokenPayload = {
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: exactRedirectUri
        };

        console.log('Token exchange payload (without secret):', { 
            ...tokenPayload, 
            client_secret: '[HIDDEN]',
            code: code ? `${code.substring(0, 10)}...` : 'missing'
        });

        // Validate required fields before making request
        if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !code) {
            console.error('Missing required OAuth parameters:', {
                client_id: !!DISCORD_CLIENT_ID,
                client_secret: !!DISCORD_CLIENT_SECRET,
                code: !!code
            });
            return res.redirect('/?error=oauth_config_error');
        }

        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams(tokenPayload),
        });

        const tokenData = await tokenResponse.json();
        console.log('Token response status:', tokenResponse.status);
        console.log('Token response data:', { 
            access_token: tokenData.access_token ? 'present' : 'missing',
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
            scope: tokenData.scope,
            error: tokenData.error,
            error_description: tokenData.error_description
        });

        if (!tokenResponse.ok || tokenData.error) {
            console.error('Token exchange failed:', {
                status: tokenResponse.status,
                error: tokenData.error,
                description: tokenData.error_description
            });
            
            // More specific error handling
            if (tokenData.error === 'invalid_grant') {
                console.error('Invalid grant error - code may have expired or been used already');
                console.error('Redirect URI used:', exactRedirectUri);
                console.error('Code received:', code ? `${code.substring(0, 10)}...` : 'none');
                return res.redirect('/?error=oauth_failed&message=Authorization expired, please try again');
            }
            
            return res.redirect(`/?error=token_exchange_failed&reason=${tokenData.error}`);
        }

        // Calculate token expiration
        const expiresAt = Date.now() + (tokenData.expires_in * 1000);

        // Fetch user data from Discord
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

        // Fetch user's guilds
        const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                'User-Agent': 'INC-Bot/1.0'
            },
        });

        const guildsData = guildsResponse.ok ? await guildsResponse.json() : [];

        // Store token information in memory
        userTokens.set(userData.id, {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            token_type: tokenData.token_type || 'Bearer',
            scope: tokenData.scope,
            expires_at: expiresAt,
            granted_scopes: tokenData.scope ? tokenData.scope.split(' ') : [],
            stateData: stateData
        });

        // Store user session with proper error handling
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

        // Force session save before redirect
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    reject(err);
                } else {
                    console.log('Session saved successfully');
                    resolve();
                }
            });
        });

        console.log(`OAuth2 success for ${userData.username} (${userData.id}) with scopes: ${tokenData.scope}`);

        // Set persistent login cookie
        res.cookie('user_id', userData.id, {
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax' // Changed from 'strict' for better compatibility
        });

        // Enhanced redirect logic based on state data
        if (stateData.type === 'bot_invite') {
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

                    // Fetch guilds again
                    const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
                        headers: {
                            Authorization: `Bearer ${storedTokens.access_token}`,
                            'User-Agent': 'INC-Bot/1.0'
                        },
                    });

                    if (guildsResponse.ok) {
                        req.session.guilds = await guildsResponse.json();
                    }

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
        errorRate: 0.1
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

// Direct server data route using Discord client
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

// Server API Routes using Discord client directly
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

app.get('/api/dashboard/:guildId/channels', requireAuth, requireGuildAdmin, async (req, res) => {
    const { guildId } = req.params;

    try {
        if (!client) {
            return res.status(503).json({ error: 'Bot not connected' });
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Bot not in this server' });
        }

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

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Bot not in this server' });
        }

        const rolesCollection = await guild.roles.fetch();
        const roles = rolesCollection
            .filter(role => role && role.id !== guild.id && !role.managed)
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
        if (!client) {
            return res.status(503).json({ error: 'Bot not connected' });
        }

        let guild;
        try {
            guild = await client.guilds.fetch(guildId);
        } catch (error) {
            console.error(`Error fetching guild ${guildId}:`, error);
            return res.status(404).json({ error: 'Cannot access guild data' });
        }

        const guildInfo = {
            id: guild.id,
            name: guild.name,
            description: guild.description || null,
            memberCount: guild.memberCount || 0,
            icon: guild.iconURL({ size: 256 }),
            ownerId: guild.ownerId,
            createdAt: guild.createdAt || new Date(guild.createdTimestamp),
            features: guild.features || [],
            verificationLevel: guild.verificationLevel || 0,
            botJoinedAt: guild.joinedAt || new Date()
        };

        console.log(`Fetched guild info for ${guild.name}`);
        res.json(guildInfo);

    } catch (error) {
        console.error('Error fetching guild info:', error);
        res.status(500).json({ error: 'Failed to fetch guild info', details: error.message });
    }
});

// Session extension endpoint
app.post('/api/session/extend', requireAuth, (req, res) => {
    const userId = req.session.user?.id;
    const storedTokens = userTokens.get(userId);
    
    if (storedTokens) {
        // Extend token expiry by 7 days
        storedTokens.expires_at = Date.now() + (7 * 24 * 60 * 60 * 1000);
        req.session.user.token_expires_at = storedTokens.expires_at;
        
        res.json({ success: true, expiresAt: storedTokens.expires_at });
    } else {
        res.status(400).json({ success: false, error: 'No token to extend' });
    }
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

// OAuth2 bot invite endpoint
app.get('/auth/discord/bot-invite', (req, res) => {
    const { guildId, permissions = '8' } = req.query;

    const stateData = {
        type: 'bot_invite',
        guildId: guildId || null,
        permissions: permissions,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(2, 15)
    };

    const state = Buffer.from(JSON.stringify(stateData)).toString('base64');
    const scope = 'bot%20applications.commands';
    const responseType = 'code';
    const redirectUri = encodeURIComponent(DISCORD_REDIRECT_URI);

    let authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=${responseType}&redirect_uri=${redirectUri}&scope=${scope}&state=${encodeURIComponent(state)}`;

    if (permissions && permissions !== 'undefined') {
        authUrl += `&permissions=${permissions}`;
    }

    if (guildId) {
        authUrl += `&guild_id=${guildId}`;
    }

    console.log(`Bot invite: guildId=${guildId}, permissions=${permissions}`);
    res.redirect(authUrl);
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
    const uptime = Math.round((process.uptime() / 86400) * 10) / 10;

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
        console.error(`Port ${PORT} is already in use`);    }
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = app;