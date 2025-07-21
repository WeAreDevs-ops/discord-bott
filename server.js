
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
    // This would need to be implemented in your bot or through Discord API
    // For now, we'll fetch from Firebase or return static data
    return []; // You'll need to implement this based on your bot's guild cache
  } catch (error) {
    console.error('Error fetching bot guilds:', error);
    return [];
  }
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

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  
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

    res.redirect('/dashboard');
  } catch (error) {
    console.error('OAuth error:', error);
    res.redirect('/');
  }
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userGuilds = await getUserGuilds(req.session.user.access_token);
    const managedGuilds = userGuilds.filter(guild => 
      hasManageGuildPermission(guild.permissions) && guild.owner
    );

    res.render('dashboard', { 
      user: req.session.user, 
      guilds: managedGuilds 
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.redirect('/');
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
    const [channels, roles, guildSettings, autoModSettings, autoRoleSettings, commandAssignments, restrictedChannels] = await Promise.all([
      getGuildChannels(guildId),
      getGuildRoles(guildId),
      getGuildSettings(guildId),
      getAutoModSettings(guildId),
      getAutoRoleSettings(guildId),
      getCommandAssignments(guildId),
      getRestrictedChannels(guildId)
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
        restricted: restrictedChannels
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

    // Update settings in Firebase
    const settings = {
      ...existingSettings,
      welcomeChannel: channelId,
      welcomeMessages: messages || ['Welcome {user} to {server}! You are the {membercount} member!'],
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

    // Update settings in Firebase
    const settings = {
      ...existingSettings,
      leaveChannel: channelId,
      leaveMessages: messages || ['{username} has left {server}. We\'ll miss you! 👋'],
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

    const settings = {
      linkFilter: linkFilter || false,
      badWordFilter: badWordFilter || false,
      badWords: badWords || []
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Dashboard server running on port ${PORT}`);
  if (process.env.RAILWAY_STATIC_URL) {
    console.log(`🔗 Railway URL: https://${process.env.RAILWAY_STATIC_URL}`);
  } else {
    console.log(`🔗 Local URL: http://localhost:${PORT}`);
  }
});
