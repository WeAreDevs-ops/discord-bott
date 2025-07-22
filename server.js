
const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const db = require('./firebase.js');

const app = express();
const PORT = process.env.PORT || 5000;

// Discord OAuth2 configuration
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

// HTML sanitization helper
function sanitizeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>&"']/g, function(match) {
    return {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;'
    }[match];
  });
}

// Sanitize user data before rendering
function sanitizeUserData(data) {
  if (Array.isArray(data)) {
    return data.map(sanitizeUserData);
  } else if (typeof data === 'object' && data !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && ['name', 'username', 'displayName', 'description', 'title', 'footer'].includes(key)) {
        sanitized[key] = sanitizeHtml(value);
      } else {
        sanitized[key] = sanitizeUserData(value);
      }
    }
    return sanitized;
  }
  return data;
}

// Enhanced input validation functions
function validateEmbedData(data) {
  const { title, description, color, thumbnail, image, footer, buttons } = data;
  
  // Validate title and description length
  if (title && title.length > 256) {
    throw new Error('Title must be 256 characters or less');
  }
  if (description && description.length > 4096) {
    throw new Error('Description must be 4096 characters or less');
  }
  if (footer && footer.length > 2048) {
    throw new Error('Footer must be 2048 characters or less');
  }
  
  // Validate URLs
  if (thumbnail && !isValidUrl(thumbnail)) {
    throw new Error('Invalid thumbnail URL');
  }
  if (image && !isValidUrl(image)) {
    throw new Error('Invalid image URL');
  }
  
  return true;
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function validateChannelId(channelId) {
  return /^\d{17,19}$/.test(channelId);
}

function validateRoleId(roleId) {
  return /^\d{17,19}$/.test(roleId);
}

const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `https://${process.env.RAILWAY_STATIC_URL || 'localhost:5000'}/auth/discord/callback`;

// Security middleware
app.use((req, res, next) => {
  // Make request available globally for security logging
  global.currentRequest = req;
  
  // Log suspicious activity
  const suspiciousPatterns = [
    /\.\./,  // Path traversal
    /<script/i,  // XSS attempts
    /union.*select/i,  // SQL injection
    /javascript:/i  // Javascript URLs
  ];
  
  const requestData = JSON.stringify(req.body) + req.url + (req.get('User-Agent') || '');
  if (suspiciousPatterns.some(pattern => pattern.test(requestData))) {
    logSecurityEvent('SUSPICIOUS_REQUEST', req.session?.user?.id || 'anonymous', 
      `Suspicious pattern in request: ${req.method} ${req.url}`);
  }
  
  next();
});

// Middleware
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Stricter rate limiting for admin routes
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // limit each IP to 20 requests per windowMs for admin routes
  message: 'Too many admin requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/admin/', adminLimiter);
app.use('/admin', adminLimiter);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com; img-src 'self' https://cdn.discordapp.com https://cdn.jsdelivr.net data:; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; connect-src 'self';");
  next();
});

// Firebase session store
const FirebaseStore = require('connect-session-firebase')(session);

// Session configuration
app.use(session({
  store: new FirebaseStore({
    database: db
  }),
  secret: process.env.SESSION_SECRET || (() => {
    console.warn('⚠️ SESSION_SECRET not set! Using generated secret (not suitable for production)');
    return require('crypto').randomBytes(64).toString('hex');
  })(),
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on activity
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // HTTPS in production
    httpOnly: true, // Prevent XSS access to cookies
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' // CSRF protection
  },
  name: 'sessionId' // Hide default session name
}));

// Helper functions
function requireAuth(req, res, next) {
  if (req.session.user && req.session.user.id) {
    // Validate session freshness (24 hours)
    const sessionAge = Date.now() - (req.session.createdAt || 0);
    if (sessionAge > 24 * 60 * 60 * 1000) {
      req.session.destroy(() => {
        res.redirect('/auth/discord');
      });
      return;
    }
    next();
  } else {
    res.redirect('/auth/discord');
  }
}

// Enhanced permission validation
async function validateGuildAccess(userId, guildId, accessToken) {
  try {
    const userGuilds = await getUserGuilds(accessToken);
    const guild = userGuilds.find(g => g.id === guildId);
    
    if (!guild) {
      return { valid: false, reason: 'Guild not found or no access' };
    }
    
    if (!hasManageGuildPermission(guild.permissions)) {
      return { valid: false, reason: 'Insufficient permissions' };
    }
    
    return { valid: true, guild };
  } catch (error) {
    console.error('Guild access validation error:', error);
    return { valid: false, reason: 'Validation failed' };
  }
}

async function getUserGuilds(accessToken) {
  try {
    const response = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user guilds:', error);
    return [];
  }
}

async function getBotGuilds() {
  try {
    const response = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: {
        'Authorization': `Bot ${process.env.BOT_TOKEN}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching bot guilds:', error);
    return [];
  }
}

async function isBotInGuild(guildId) {
  try {
    const response = await axios.get(`https://discord.com/api/guilds/${guildId}/members/@me`, {
      headers: {
        'Authorization': `Bot ${process.env.BOT_TOKEN}`
      }
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

function generateBotInviteLink(guildId) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const permissions = '8'; // Administrator permission
  const scope = 'bot%20applications.commands';
  const redirectUri = encodeURIComponent(DISCORD_REDIRECT_URI);
  
  // Include OAuth flow with redirect for proper authentication
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&guild_id=${guildId}&scope=${scope}&response_type=code&redirect_uri=${redirectUri}&disable_guild_select=true`;
}

async function getGuildChannels(guildId) {
  try {
    const response = await axios.get(`https://discord.com/api/guilds/${guildId}/channels`, {
      headers: {
        'Authorization': `Bot ${process.env.BOT_TOKEN}`
      }
    });
    return response.data.filter(channel => channel.type === 0); // Only text channels
  } catch (error) {
    console.error('Error fetching guild channels:', error);
    return [];
  }
}

async function getGuildRoles(guildId) {
  try {
    const response = await axios.get(`https://discord.com/api/guilds/${guildId}/roles`, {
      headers: {
        'Authorization': `Bot ${process.env.BOT_TOKEN}`
      }
    });
    return response.data.filter(role => role.name !== '@everyone'); // Exclude @everyone role
  } catch (error) {
    console.error('Error fetching guild roles:', error);
    return [];
  }
}

function hasManageGuildPermission(permissions) {
  const MANAGE_GUILD = 0x00000020;
  const ADMINISTRATOR = 0x00000008;
  return (permissions & (MANAGE_GUILD | ADMINISTRATOR)) !== 0;
}

// Routes
app.get('/', (req, res) => {
  res.render('index', { user: req.session.user });
});

app.get('/auth/discord', (req, res) => {
  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
  res.redirect(authUrl);
});

app.get('/auth/discord/bot-invite', requireAuth, (req, res) => {
  const guildId = req.query.guild_id;
  if (!guildId) {
    return res.redirect('/dashboard');
  }
  
  // Generate bot invite URL that includes OAuth flow
  const botInviteUrl = generateBotInviteLink(guildId);
  res.redirect(botInviteUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, guild_id } = req.query;
  
  if (!code) {
    return res.redirect('/');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: DISCORD_REDIRECT_URI
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    req.session.user = {
      ...userResponse.data,
      access_token: access_token
    };
    req.session.createdAt = Date.now();
    
    // Log successful authentication
    logSecurityEvent('USER_LOGIN', userResponse.data.id, 
      `Successful Discord OAuth login: ${userResponse.data.username}`);

    // If this was a bot invitation (guild_id present), redirect to that guild's config
    if (guild_id) {
      // Wait a moment for Discord to process the bot addition, then redirect to guild config
      setTimeout(() => {
        res.redirect(`/guild/${guild_id}?invited=true`);
      }, 2000);
    } else {
      res.redirect('/dashboard');
    }
  } catch (error) {
    console.error('OAuth error:', error);
    res.redirect('/');
  }
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const accessToken = req.session.user.access_token;
    
    // Get user guilds
    const userGuildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const userGuilds = userGuildsResponse.data;

    // Get bot guild IDs using direct bot client access
    let botGuildIds = [];
    try {
      const botModule = require('./index.js');
      if (botModule && botModule.client && botModule.client.guilds) {
        botGuildIds = botModule.client.guilds.cache.map(g => g.id);
        console.log('Bot is in guilds:', botGuildIds);
      }
    } catch (error) {
      console.log('Bot client not available:', error.message);
    }

    // Only show guilds the user owns
    const ownedGuilds = userGuilds.filter(g => g.owner);

    // Add bot presence flag for each guild
    const finalGuilds = ownedGuilds.map(guild => {
      const botIsIn = botGuildIds.includes(guild.id);
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: guild.owner,
        permissions: guild.permissions,
        botIsIn: botIsIn,
        inviteLink: !botIsIn ? generateBotInviteLink(guild.id) : null
      };
    });

    console.log('Final guilds with bot status:', finalGuilds.map(g => ({ name: g.name, botIsIn: g.botIsIn })));

    res.render('dashboard', { 
      user: req.session.user, 
      guilds: finalGuilds,
      clientId: process.env.DISCORD_CLIENT_ID
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    if (error.response && error.response.status === 401) {
      // Token expired, redirect to re-auth
      req.session.destroy(() => {
        res.redirect('/auth/discord');
      });
    } else {
      res.redirect('/');
    }
  }
});

app.get('/guild/:id', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  
  try {
    // Verify user has permission to manage this guild
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));
    
    if (!guild) {
      return res.redirect('/dashboard');
    }

    // Fetch guild data from Discord API
    const [channels, roles, guildSettings, autoModSettings, autoRoleSettings, commandAssignments, restrictedChannels, embeds] = await Promise.all([
      getGuildChannels(guildId),
      getGuildRoles(guildId),
      getGuildSettings(guildId),
      getAutoModSettings(guildId),
      getAutoRoleSettings(guildId),
      getCommandAssignments(guildId),
      getRestrictedChannels(guildId),
      getAllEmbeds(guildId)
    ]);

    console.log(`Guild ${guildId} data:`, {
      channelsCount: channels.length,
      rolesCount: roles.length,
      channels: channels.map(c => ({ id: c.id, name: c.name })),
      roles: roles.map(r => ({ id: r.id, name: r.name }))
    });

    res.render('guild-config', {
      user: req.session.user,
      guild: guild,
      channels: channels,
      roles: roles,
      settings: {
        welcome: guildSettings,
        automod: autoModSettings,
        autorole: autoRoleSettings,
        commands: commandAssignments,
        restricted: restrictedChannels,
        embeds: embeds
      }
    });
  } catch (error) {
    console.error('Guild config error:', error);
    res.redirect('/dashboard');
  }
});

// API Routes for updating settings
app.post('/api/guild/:id/welcome', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const { channelId, messages, enabled } = req.body;

  try {
    // Input validation
    if (!validateChannelId(guildId)) {
      return res.status(400).json({ error: 'Invalid guild ID format' });
    }
    
    if (channelId && !validateChannelId(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID format' });
    }
    
    // Verify permissions with enhanced validation
    const accessValidation = await validateGuildAccess(req.session.user.id, guildId, req.session.user.access_token);
    if (!accessValidation.valid) {
      return res.status(403).json({ error: accessValidation.reason });
    }

    // Get existing settings to preserve leave settings
    const existingSettings = await getGuildSettings(guildId);

    // Parse messages from comma-separated string if it's a string
    let parsedMessages = messages;
    if (typeof messages === 'string') {
      parsedMessages = messages.split(',').map(msg => msg.trim()).filter(msg => msg.length > 0);
    }

    // Update settings in Firebase
    const settings = {
      ...existingSettings,
      welcomeChannel: channelId,
      welcomeMessages: parsedMessages || ['Welcome {user} to {server}! You are the {membercount} member!'],
      welcomeEnabled: enabled
    };

    await saveGuildSettings(guildId, settings);
    res.json({ success: true });
  } catch (error) {
    console.error('Welcome settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.post('/api/guild/:id/leave', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const { channelId, messages, enabled } = req.body;

  try {
    // Verify permissions
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));
    
    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
    }

    // Get existing settings to preserve welcome settings
    const existingSettings = await getGuildSettings(guildId);

    // Parse messages from comma-separated string if it's a string
    let parsedMessages = messages;
    if (typeof messages === 'string') {
      parsedMessages = messages.split(',').map(msg => msg.trim()).filter(msg => msg.length > 0);
    }

    // Update settings in Firebase
    const settings = {
      ...existingSettings,
      leaveChannel: channelId,
      leaveMessages: parsedMessages || ['{username} has left {server}. We\'ll miss you! 👋'],
      leaveEnabled: enabled
    };

    await saveGuildSettings(guildId, settings);
    res.json({ success: true });
  } catch (error) {
    console.error('Leave settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.post('/api/guild/:id/automod', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const { linkFilter, badWordFilter, badWords } = req.body;

  try {
    // Verify permissions
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));
    
    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
    }

    // Parse bad words from comma-separated string if it's a string
    let parsedBadWords = badWords;
    if (typeof badWords === 'string') {
      parsedBadWords = badWords.split(',').map(word => word.trim().toLowerCase()).filter(word => word.length > 0);
    }

    const settings = {
      linkFilter: linkFilter || false,
      badWordFilter: badWordFilter || false,
      badWords: parsedBadWords || []
    };

    await saveAutoModSettings(guildId, settings);
    res.json({ success: true });
  } catch (error) {
    console.error('Automod settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.post('/api/guild/:id/autorole', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const { roleId } = req.body;

  try {
    // Verify permissions
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));
    
    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
    }

    if (roleId) {
      await saveAutoRoleSettings(guildId, roleId);
    } else {
      await deleteAutoRoleSettings(guildId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Autorole settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Embed management routes
app.post('/api/guild/:id/embed/create', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const { title, description, color, thumbnail, image, footer, timestamp, buttons, channelId } = req.body;

  try {
    // Input validation
    if (!validateChannelId(guildId)) {
      return res.status(400).json({ error: 'Invalid guild ID format' });
    }
    
    if (!validateChannelId(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID format' });
    }
    
    // Validate embed data
    try {
      validateEmbedData({ title, description, color, thumbnail, image, footer, buttons });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Verify permissions with enhanced validation
    const accessValidation = await validateGuildAccess(req.session.user.id, guildId, req.session.user.access_token);
    if (!accessValidation.valid) {
      return res.status(403).json({ error: accessValidation.reason });
    }

    // Validate required fields
    if (!title || !description || !channelId) {
      return res.status(400).json({ error: 'Title, description, and channel are required' });
    }

    // Parse color input
    let embedColor = 0x0099ff; // Default blue color
    if (color) {
      // Handle hex colors
      if (color.startsWith('#')) {
        const hexColor = parseInt(color.slice(1), 16);
        if (!isNaN(hexColor)) {
          embedColor = hexColor;
        }
      } else if (color.startsWith('0x')) {
        const hexColor = parseInt(color, 16);
        if (!isNaN(hexColor)) {
          embedColor = hexColor;
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
        
        const lowerColor = color.toLowerCase();
        if (colorNames[lowerColor]) {
          embedColor = colorNames[lowerColor];
        }
      }
    }

    // Create Discord embed object
    const discordEmbed = {
      title: title,
      description: description,
      color: embedColor
    };

    // Add optional elements
    if (thumbnail) {
      try {
        new URL(thumbnail); // Validate URL
        discordEmbed.thumbnail = { url: thumbnail };
      } catch {
        return res.status(400).json({ error: 'Invalid thumbnail URL provided' });
      }
    }

    if (image) {
      try {
        new URL(image); // Validate URL
        discordEmbed.image = { url: image };
      } catch {
        return res.status(400).json({ error: 'Invalid image URL provided' });
      }
    }

    if (footer) {
      discordEmbed.footer = { text: footer };
    }

    if (timestamp) {
      discordEmbed.timestamp = new Date().toISOString();
    }

    // Parse and create buttons
    const components = [];
    if (buttons && buttons.trim()) {
      try {
        // Split buttons by | separator
        const buttonPairs = buttons.split('|').map(pair => pair.trim()).filter(pair => pair);
        
        if (buttonPairs.length > 5) {
          return res.status(400).json({ error: 'Maximum 5 buttons allowed' });
        }

        const buttonComponents = [];

        for (const pair of buttonPairs) {
          // Match optional emoji, label, and URL - supports both <:name:id> and <a:name:id>
          const emojiMatch = pair.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>\s*(.*?),\s*(https:\/\/\S+)$/);

          let buttonData;
          if (emojiMatch) {
            const animated = emojiMatch[1] === 'a';
            const name = emojiMatch[2];
            const id = emojiMatch[3];
            const label = emojiMatch[4].trim();
            const url = emojiMatch[5].trim();

            if (!label || !url) {
              return res.status(400).json({ error: 'Invalid button format. Label and URL are required.' });
            }

            buttonData = {
              type: 2, // Button component type
              style: 5, // Link style
              label: label,
              url: url,
              emoji: { name, id, animated }
            };
          } else {
            // Fallback if no emoji - standard format
            const [label, url] = pair.split(',').map(s => s.trim());
            
            if (!label || !url) {
              return res.status(400).json({ error: 'Invalid button format. Use: "Label,URL" or "<:emoji:id> Label,URL"' });
            }

            // Validate URL
            try {
              new URL(url);
            } catch {
              return res.status(400).json({ error: `Invalid URL for button "${label}": ${url}` });
            }

            if (label.length > 80) {
              return res.status(400).json({ error: `Button label "${label}" is too long (max 80 characters)` });
            }

            buttonData = {
              type: 2, // Button component type
              style: 5, // Link style
              label: label,
              url: url
            };
          }

          buttonComponents.push(buttonData);
        }

        // Create action row (max 5 buttons per row)
        if (buttonComponents.length > 0) {
          components.push({
            type: 1, // Action row type
            components: buttonComponents
          });
        }

      } catch (error) {
        console.error('Button parsing error:', error);
        return res.status(400).json({ error: 'Error parsing buttons. Format: "Label1,URL1|Label2,URL2|Label3,URL3"' });
      }
    }

    // Generate unique embed ID
    const embedId = `embed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Send embed via Discord API
    let sentMessage;
    try {
      const messagePayload = { 
        embeds: [discordEmbed]
      };
      
      if (components.length > 0) {
        messagePayload.components = components;
      }

      const response = await axios.post(`https://discord.com/api/channels/${channelId}/messages`, messagePayload, {
        headers: {
          'Authorization': `Bot ${process.env.BOT_TOKEN}`,
          'Content-Type': 'application/json',
        }
      });

      sentMessage = response.data;
      console.log(`Embed sent to channel ${channelId}, message ID: ${sentMessage.id}`);
    } catch (error) {
      console.error('Error sending embed to channel:', error.response?.data || error.message);
      return res.status(500).json({ 
        error: 'Failed to send embed to channel. Please check the channel ID and bot permissions.',
        details: error.response?.data?.message || error.message
      });
    }

    // Create embed data for database storage
    const embedData = {
      id: embedId,
      title,
      description,
      color: color || null,
      thumbnail: thumbnail || null,
      image: image || null,
      footer: footer || null,
      timestamp: timestamp || false,
      buttons: buttons || null,
      channelId: channelId,
      createdBy: req.session.user.id,
      createdAt: Date.now(),
      guildId: guildId,
      messageId: sentMessage.id,
      lastUpdated: Date.now()
    };

    // Save embed data to database
    await saveEmbed(guildId, embedId, embedData);

    res.json({ 
      success: true, 
      embedId: embedId,
      messageId: sentMessage.id,
      channelId: channelId,
      message: 'Embed created and sent successfully to channel'
    });
  } catch (error) {
    console.error('Embed creation error:', error);
    res.status(500).json({ error: 'Failed to create embed', details: error.message });
  }
});

app.post('/api/guild/:id/embed/:embedId/update', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const embedId = req.params.embedId;
  const { title, description, color, thumbnail, image, footer, timestamp, buttons, channelId } = req.body;

  try {
    // Verify permissions
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));
    
    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
    }

    // Get existing embed
    const existingEmbed = await getEmbed(guildId, embedId);
    if (!existingEmbed) {
      return res.status(404).json({ error: 'Embed not found' });
    }

    // Merge new data with existing data
    const updatedData = {
      title: title !== undefined ? title : existingEmbed.title,
      description: description !== undefined ? description : existingEmbed.description,
      color: color !== undefined ? color : existingEmbed.color,
      thumbnail: thumbnail !== undefined ? thumbnail : existingEmbed.thumbnail,
      image: image !== undefined ? image : existingEmbed.image,
      footer: footer !== undefined ? footer : existingEmbed.footer,
      timestamp: timestamp !== undefined ? timestamp : existingEmbed.timestamp,
      buttons: buttons !== undefined ? buttons : existingEmbed.buttons,
      channelId: channelId !== undefined ? channelId : existingEmbed.channelId
    };

    // Validate required fields
    if (!updatedData.title || !updatedData.description || !updatedData.channelId) {
      return res.status(400).json({ error: 'Title, description, and channel are required' });
    }

    // Parse color input
    let embedColor = 0x0099ff; // Default blue color
    if (updatedData.color) {
      if (updatedData.color.startsWith('#')) {
        const hexColor = parseInt(updatedData.color.slice(1), 16);
        if (!isNaN(hexColor)) {
          embedColor = hexColor;
        }
      } else if (updatedData.color.startsWith('0x')) {
        const hexColor = parseInt(updatedData.color, 16);
        if (!isNaN(hexColor)) {
          embedColor = hexColor;
        }
      } else {
        const colorNames = {
          'red': 0xff0000, 'green': 0x00ff00, 'blue': 0x0000ff, 'yellow': 0xffff00,
          'orange': 0xffa500, 'purple': 0x800080, 'pink': 0xffc0cb, 'cyan': 0x00ffff,
          'magenta': 0xff00ff, 'lime': 0x00ff00, 'black': 0x000000, 'white': 0xffffff,
          'gray': 0x808080, 'grey': 0x808080, 'silver': 0xc0c0c0, 'gold': 0xffd700,
          'navy': 0x000080, 'teal': 0x008080, 'maroon': 0x800000, 'olive': 0x808000
        };
        const lowerColor = updatedData.color.toLowerCase();
        if (colorNames[lowerColor]) {
          embedColor = colorNames[lowerColor];
        }
      }
    }

    // Create Discord embed object
    const discordEmbed = {
      title: updatedData.title,
      description: updatedData.description,
      color: embedColor
    };

    // Add optional elements
    if (updatedData.thumbnail) {
      try {
        new URL(updatedData.thumbnail);
        discordEmbed.thumbnail = { url: updatedData.thumbnail };
      } catch {
        return res.status(400).json({ error: 'Invalid thumbnail URL provided' });
      }
    }

    if (updatedData.image) {
      try {
        new URL(updatedData.image);
        discordEmbed.image = { url: updatedData.image };
      } catch {
        return res.status(400).json({ error: 'Invalid image URL provided' });
      }
    }

    if (updatedData.footer) {
      discordEmbed.footer = { text: updatedData.footer };
    }

    if (updatedData.timestamp) {
      discordEmbed.timestamp = new Date().toISOString();
    }

    // Parse and create buttons
    const components = [];
    if (updatedData.buttons && updatedData.buttons.trim()) {
      try {
        const buttonPairs = updatedData.buttons.split('|').map(pair => pair.trim()).filter(pair => pair);
        
        if (buttonPairs.length > 5) {
          return res.status(400).json({ error: 'Maximum 5 buttons allowed' });
        }

        const buttonComponents = [];

        for (const pair of buttonPairs) {
          const emojiMatch = pair.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>\s*(.*?),\s*(https:\/\/\S+)$/);

          let buttonData;
          if (emojiMatch) {
            const animated = emojiMatch[1] === 'a';
            const name = emojiMatch[2];
            const id = emojiMatch[3];
            const label = emojiMatch[4].trim();
            const url = emojiMatch[5].trim();

            buttonData = {
              type: 2,
              style: 5,
              label: label,
              url: url,
              emoji: { name, id, animated }
            };
          } else {
            const [label, url] = pair.split(',').map(s => s.trim());
            
            if (!label || !url) {
              return res.status(400).json({ error: 'Invalid button format. Use: "Label,URL"' });
            }

            try {
              new URL(url);
            } catch {
              return res.status(400).json({ error: `Invalid URL for button "${label}": ${url}` });
            }

            buttonData = {
              type: 2,
              style: 5,
              label: label,
              url: url
            };
          }

          buttonComponents.push(buttonData);
        }

        if (buttonComponents.length > 0) {
          components.push({
            type: 1,
            components: buttonComponents
          });
        }
      } catch (error) {
        console.error('Button parsing error:', error);
        return res.status(400).json({ error: 'Error parsing buttons' });
      }
    }

    // Send updated embed to channel
    let sentMessage;
    try {
      const messagePayload = { 
        embeds: [discordEmbed]
      };
      
      if (components.length > 0) {
        messagePayload.components = components;
      }

      const response = await axios.post(`https://discord.com/api/channels/${updatedData.channelId}/messages`, messagePayload, {
        headers: {
          'Authorization': `Bot ${process.env.BOT_TOKEN}`,
          'Content-Type': 'application/json',
        }
      });

      sentMessage = response.data;
      console.log(`Updated embed sent to channel ${updatedData.channelId}, message ID: ${sentMessage.id}`);
    } catch (error) {
      console.error('Error sending updated embed to channel:', error.response?.data || error.message);
      return res.status(500).json({ 
        error: 'Failed to send updated embed to channel. Please check the channel ID and bot permissions.',
        details: error.response?.data?.message || error.message
      });
    }

    // Update embed data in database
    const updatedEmbedData = {
      ...existingEmbed,
      ...updatedData,
      updatedBy: req.session.user.id,
      updatedAt: Date.now(),
      messageId: sentMessage.id // Update with new message ID
    };

    await saveEmbed(guildId, embedId, updatedEmbedData);
    
    res.json({ 
      success: true, 
      message: 'Embed updated and sent to channel successfully',
      messageId: sentMessage.id,
      channelId: updatedData.channelId
    });
  } catch (error) {
    console.error('Embed update error:', error);
    res.status(500).json({ error: 'Failed to update embed', details: error.message });
  }
});

app.delete('/api/guild/:id/embed/:embedId', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const embedId = req.params.embedId;

  try {
    // Verify permissions
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));
    
    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
    }

    await deleteEmbed(guildId, embedId);
    res.json({ success: true });
  } catch (error) {
    console.error('Embed deletion error:', error);
    res.status(500).json({ error: 'Failed to delete embed' });
  }
});

// API endpoint to check bot presence
app.get('/api/guild/:id/bot-presence', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  
  try {
    // Verify user has permission to manage this guild
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));
    
    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
    }

    // Check bot presence using bot client
    let botPresent = false;
    try {
      const botModule = require('./index.js');
      if (botModule && botModule.client && botModule.client.guilds) {
        const botGuildIds = botModule.client.guilds.cache.map(g => g.id);
        botPresent = botGuildIds.includes(guildId);
      }
    } catch (error) {
      console.log('Bot client not available, using fallback');
      botPresent = await isBotInGuild(guildId);
    }

    res.json({ 
      botPresent,
      inviteLink: !botPresent ? generateBotInviteLink(guildId) : null
    });
  } catch (error) {
    console.error('Bot presence check error:', error);
    res.status(500).json({ error: 'Failed to check bot presence' });
  }
});

// Security logging function
function logSecurityEvent(type, userId, details) {
  const timestamp = new Date().toISOString();
  console.log(`[SECURITY] ${timestamp} - ${type} - User: ${userId} - ${details}`);
  
  // Store in database for audit trail
  try {
    db.ref('security/events').push({
      timestamp: Date.now(),
      type,
      userId,
      details,
      userAgent: global.currentRequest?.get('User-Agent') || 'Unknown'
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

// Admin panel routes with security logging
function requireAdmin(req, res, next) {
  const userId = req.session.user?.id;
  const adminId = process.env.ADMIN_ID;
  
  if (!req.session.user) {
    logSecurityEvent('ADMIN_ACCESS_DENIED', 'anonymous', 'No user session');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  if (userId === adminId) {
    logSecurityEvent('ADMIN_ACCESS_GRANTED', userId, `Admin panel access: ${req.path}`);
    next();
  } else {
    logSecurityEvent('ADMIN_ACCESS_DENIED', userId, `Unauthorized admin attempt: ${req.path}`);
    res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
}

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.render('admin', { user: req.session.user });
});

app.get('/api/admin/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get bot guilds data
    let botGuilds = [];
    let totalUsers = 0;
    let totalCommands = 0;

    try {
      const botModule = require('./index.js');
      if (botModule && botModule.client && botModule.client.guilds) {
        for (const [guildId, guild] of botModule.client.guilds.cache) {
          const guildData = {
            id: guild.id,
            name: guild.name,
            iconURL: guild.iconURL({ size: 64 }),
            memberCount: guild.memberCount,
            owner: {
              id: guild.ownerId,
              username: 'Unknown'
            },
            joinedAt: guild.joinedTimestamp,
            commandsUsed: 0,
            flagged: false,
            banned: false
          };

          // Try to get owner information
          try {
            const owner = await guild.fetchOwner();
            guildData.owner.username = owner.user.username;
          } catch (error) {
            console.log('Could not fetch owner for guild:', guild.name);
          }

          // Get command usage from database if available
          try {
            const guildSettings = await getGuildSettings(guild.id);
            const snapshot = await db.ref(`guilds/${guild.id}/stats`).once('value');
            const stats = snapshot.val();
            if (stats) {
              guildData.commandsUsed = stats.totalCommands || 0;
              totalCommands += guildData.commandsUsed;
            }
          } catch (error) {
            console.log('Could not fetch stats for guild:', guild.name);
          }

          botGuilds.push(guildData);
          totalUsers += guild.memberCount;
        }
      }
    } catch (error) {
      console.error('Error fetching bot guilds:', error);
    }

    // Get recent activities from database
    let recentActivities = [];
    try {
      const activitiesSnapshot = await db.ref('admin/activities').orderByChild('timestamp').limitToLast(20).once('value');
      const activitiesData = activitiesSnapshot.val();
      if (activitiesData) {
        recentActivities = Object.values(activitiesData).reverse();
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
    }

    const stats = {
      totalServers: botGuilds.length,
      totalUsers: totalUsers,
      totalCommands: totalCommands,
      flaggedServers: botGuilds.filter(g => g.flagged).length
    };

    res.json({
      success: true,
      stats: stats,
      servers: botGuilds,
      activities: recentActivities
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

app.post('/api/admin/remove-server', requireAuth, requireAdmin, async (req, res) => {
  const { serverId, reason } = req.body;

  console.log(`Admin ${req.session.user.id} attempting to remove server ${serverId}`);

  if (!serverId) {
    return res.status(400).json({ error: 'Server ID is required' });
  }

  try {
    // Get bot client with better error handling
    let botClient;
    try {
      const botModule = require('./index.js');
      botClient = botModule?.client;
    } catch (error) {
      console.error('Error accessing bot module:', error);
      return res.status(500).json({ error: 'Bot module not accessible' });
    }

    if (!botClient || !botClient.isReady()) {
      console.error('Bot client not ready');
      return res.status(500).json({ error: 'Bot client not ready' });
    }

    const guild = botClient.guilds.cache.get(serverId);
    if (!guild) {
      console.error(`Guild ${serverId} not found in bot cache`);
      return res.status(404).json({ error: 'Server not found or bot not in server' });
    }

    const guildName = guild.name;
    const guildOwner = guild.ownerId;
    const memberCount = guild.memberCount;

    console.log(`Removing bot from guild: ${guildName} (${serverId}) - Members: ${memberCount}`);

    // Log the removal activity first
    try {
      const activity = {
        type: 'removal',
        title: 'Bot Removed from Server',
        description: `Bot was removed from ${guildName} by admin. Reason: ${reason || 'No reason provided'}`,
        timestamp: Date.now(),
        serverId: serverId,
        serverName: guildName,
        memberCount: memberCount,
        adminId: req.session.user.id,
        reason: reason || 'No reason provided'
      };
      
      await db.ref('admin/activities').push(activity);
      await db.ref(`guilds/${serverId}/removed`).set({
        timestamp: Date.now(),
        reason: reason || 'No reason provided',
        adminId: req.session.user.id,
        guildName: guildName,
        memberCount: memberCount
      });
      
      console.log('Logged removal activity to database');
    } catch (error) {
      console.error('Error logging removal activity:', error);
    }

    // Clean up guild data from database before leaving
    try {
      await db.ref(`guilds/${serverId}/settings`).remove();
      await db.ref(`guilds/${serverId}/automod`).remove();
      await db.ref(`guilds/${serverId}/autorole`).remove();
      await db.ref(`guilds/${serverId}/embeds`).remove();
      await db.ref(`guilds/${serverId}/commandAssignments`).remove();
      await db.ref(`guilds/${serverId}/restrictedChannels`).remove();
      console.log('Cleaned up guild data from database');
    } catch (error) {
      console.error('Error cleaning up guild data:', error);
    }

    // Leave the guild - this should work regardless of your permissions in the server
    // The bot can always leave a server, even if the bot owner doesn't have permissions
    try {
      await guild.leave();
      console.log(`Successfully left guild: ${guildName}`);
      
      res.json({
        success: true,
        message: `Successfully removed bot from ${guildName}`,
        details: {
          serverName: guildName,
          serverId: serverId,
          memberCount: memberCount,
          reason: reason || 'No reason provided'
        }
      });
    } catch (leaveError) {
      console.error('Error leaving guild:', leaveError);
      
      // If leaving fails, try alternative approaches
      if (leaveError.code === 50001) { // Missing Access
        res.json({
          success: false,
          error: 'Bot does not have access to this server (may have already been removed)',
          details: leaveError.message
        });
      } else if (leaveError.code === 50013) { // Missing Permissions
        res.json({
          success: false,
          error: 'Bot lacks permissions to leave this server (unusual Discord error)',
          details: leaveError.message
        });
      } else {
        // For any other error, still mark as partially successful since we logged it
        res.json({
          success: true,
          message: `Removal logged but bot may still be in ${guildName}. Discord API error occurred.`,
          warning: true,
          details: leaveError.message
        });
      }
    }
  } catch (error) {
    console.error('Error removing bot from server:', error);
    res.status(500).json({ 
      error: 'Failed to remove bot from server',
      details: error.message 
    });
  }
});

app.get('/api/admin/server/:id/details', requireAuth, requireAdmin, async (req, res) => {
  const serverId = req.params.id;

  try {
    const botModule = require('./index.js');
    if (!botModule || !botModule.client) {
      return res.status(500).json({ error: 'Bot client not available' });
    }

    const guild = botModule.client.guilds.cache.get(serverId);
    if (!guild) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // Get detailed server information
    const serverData = {
      id: guild.id,
      name: guild.name,
      iconURL: guild.iconURL({ size: 128 }),
      memberCount: guild.memberCount,
      channelCount: guild.channels.cache.size,
      roleCount: guild.roles.cache.size,
      ownerId: guild.ownerId,
      joinedAt: guild.joinedTimestamp,
      totalCommands: 0,
      lastActivity: null,
      recentCommands: []
    };

    // Get stats and recent commands from database
    try {
      const statsSnapshot = await db.ref(`guilds/${serverId}/stats`).once('value');
      const stats = statsSnapshot.val();
      if (stats) {
        serverData.totalCommands = stats.totalCommands || 0;
        serverData.lastActivity = stats.lastActivity;
      }

      const commandsSnapshot = await db.ref(`guilds/${serverId}/recentCommands`).orderByChild('timestamp').limitToLast(10).once('value');
      const commands = commandsSnapshot.val();
      if (commands) {
        serverData.recentCommands = Object.values(commands).reverse();
      }
    } catch (error) {
      console.error('Error fetching server stats:', error);
    }

    res.json({
      success: true,
      data: serverData
    });
  } catch (error) {
    console.error('Error fetching server details:', error);
    res.status(500).json({ error: 'Failed to fetch server details' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Import Firebase functions from your existing bot
async function saveGuildSettings(guildId, settings) {
  try {
    await db.ref(`guilds/${guildId}/settings`).set(settings);
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

async function saveAutoRoleSettings(guildId, roleId) {
  try {
    await db.ref(`guilds/${guildId}/autorole`).set(roleId);
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
  } catch (error) {
    console.error('Error deleting auto role settings:', error);
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
  } catch (error) {
    console.error('Error deleting embed:', error);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Dashboard server running on port ${PORT}`);
  if (process.env.RAILWAY_STATIC_URL) {
    console.log(`🔗 Railway URL: https://${process.env.RAILWAY_STATIC_URL}`);
  } else {
    console.log(`🔗 Local URL: https://localhost:${PORT}`);
  }
});
