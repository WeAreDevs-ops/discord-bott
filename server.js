const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
const db = require('./firebase.js');

const app = express();
const PORT = process.env.PORT || 5000;

// Discord OAuth2 configuration
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `https://${process.env.RAILWAY_STATIC_URL || 'localhost:5000'}/auth/discord/callback`;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https:; img-src 'self' https: data:; font-src 'self' https: data:;");
  next();
});

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Helper functions
function requireAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/auth/discord');
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
    // Verify permissions
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));

    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
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
    // Verify permissions
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const guild = userGuilds.find(g => g.id === guildId && hasManageGuildPermission(g.permissions));

    if (!guild) {
      return res.status(403).json({ error: 'No permission' });
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
      discordEmbed.footer = { text: footer };
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

// Admin panel routes
function requireAdmin(req, res, next) {
  console.log(`Admin check: User ID: ${req.session.user?.id}, Admin ID: ${process.env.ADMIN_ID}`);

  if (!req.session.user) {
    console.log('No user in session for admin check');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.session.user.id === process.env.ADMIN_ID) {
    console.log('Admin access granted');
    next();
  } else {
    console.log(`Access denied: ${req.session.user.id} is not admin (${process.env.ADMIN_ID})`);
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
    // First, try to get guild info for logging (optional, but helpful)
    let guildName = 'Unknown Server';
    let memberCount = 'Unknown';
    let guildOwner = 'Unknown';

    try {
      // Try to get guild info first via REST API for logging
      const guildResponse = await axios.get(`https://discord.com/api/v10/guilds/${serverId}`, {
        headers: {
          'Authorization': `Bot ${process.env.BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (guildResponse.data) {
        guildName = guildResponse.data.name;
        memberCount = guildResponse.data.approximate_member_count || guildResponse.data.member_count || 'Unknown';
        guildOwner = guildResponse.data.owner_id;
        console.log(`Retrieved guild info: ${guildName} with ${memberCount} members`);
      }
    } catch (guildInfoError) {
      console.log('Could not retrieve guild info, proceeding with removal anyway');
    }

    // Use Discord REST API directly to leave the server
    // This works regardless of your personal membership in the server
    console.log(`Attempting to remove bot from guild: ${guildName} (${serverId})`);

    const response = await axios.delete(`https://discord.com/api/v10/users/@me/guilds/${serverId}`, {
      headers: {
        'Authorization': `Bot ${process.env.BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 204) {
      console.log(`Successfully left guild ${serverId} via REST API`);

      // Log the removal activity
      try {
        const activity = {
          type: 'removal',
          title: 'Bot Removed from Server',
          description: `Bot was removed from ${guildName} by admin via REST API. Reason: ${reason || 'No reason provided'}`,
          timestamp: Date.now(),
          serverId: serverId,
          serverName: guildName,
          memberCount: memberCount,
          adminId: req.session.user.id,
          reason: reason || 'No reason provided',
          method: 'REST_API'
        };

        await db.ref('admin/activities').push(activity);
        await db.ref(`guilds/${serverId}/removed`).set({
          timestamp: Date.now(),
          reason: reason || 'No reason provided',
          adminId: req.session.user.id,
          guildName: guildName,
          memberCount: memberCount,
          method: 'REST_API'
        });

        console.log('Logged removal activity to database');
      } catch (error) {
        console.error('Error logging removal activity:', error);
      }

      // Clean up guild data from database
      try {
        await db.ref(`guilds/${serverId}/settings`).remove();
        await db.ref(`guilds/${serverId}/automod`).remove();
        await db.ref(`guilds/${serverId}/autorole`).remove();
        await db.ref(`guilds/${serverId}/embeds`).remove();
        await db.ref(`guilds/${serverId}/commandAssignments`).remove();
        await db.ref(`guilds/${serverId}/restrictedChannels`).remove();
        await db.ref(`guilds/${serverId}/stats`).remove();
        await db.ref(`guilds/${serverId}/recentCommands`).remove();
        console.log('Cleaned up guild data from database');
      } catch (error) {
        console.error('Error cleaning up guild data:', error);
      }

      return res.json({
        success: true,
        message: `Successfully removed bot from ${guildName}`,
        details: {
          serverName: guildName,
          serverId: serverId,
          memberCount: memberCount,
          method: 'REST_API',
          reason: reason || 'No reason provided'
        }
      });
    } else {
      console.error(`Unexpected response status: ${response.status}`);
      return res.status(500).json({
        error: 'Unexpected response from Discord API',
        details: `Status: ${response.status}`
      });
    }

  } catch (error) {
      console.error('Error removing bot from server:', error);
      console.error('Bot token being used:', process.env.BOT_TOKEN ? `${process.env.BOT_TOKEN.substring(0, 10)}...` : 'NOT SET');

      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;

        console.error(`Discord API Error ${status}:`, errorData);

        if (status === 404) {
          return res.json({
            success: false,
            error: 'Bot is not in this server or server does not exist',
            details: `Server not found (404). Server ID: ${serverId}`
          });
        } else if (status === 403) {
          return res.json({
            success: false,
            error: 'Bot does not have permission to leave this server',
            details: errorData?.message || 'Forbidden (403) - This should not happen with bot token'
          });
        } else if (status === 401) {
          return res.json({
            success: false,
            error: 'Bot token is invalid or expired',
            details: 'Unauthorized (401) - Check BOT_TOKEN environment variable'
          });
        } else {
          return res.status(500).json({
            error: `Discord API error: ${status}`,
            details: errorData?.message || error.message
          });
        }
      } else {
        return res.status(500).json({
          error: 'Network error or bot token issue',
          details: error.message
        });
      }
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