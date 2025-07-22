
// Validation and sanitization utilities

function validateGuildId(guildId) {
  // Discord guild IDs are 17-19 digit snowflakes
  return /^\d{17,19}$/.test(guildId);
}

function validateChannelId(channelId) {
  // Discord channel IDs are 17-19 digit snowflakes
  return /^\d{17,19}$/.test(channelId);
}

function sanitizeInput(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }
  
  // Remove potentially dangerous characters and limit length
  return input
    .replace(/[<>'"&]/g, '') // Remove HTML/XSS characters
    .trim()
    .substring(0, 2000); // Limit to 2000 characters
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  try {
    const urlObj = new URL(url);
    // Only allow http/https protocols
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

module.exports = {
  validateGuildId,
  validateChannelId,
  sanitizeInput,
  validateUrl
};
