
// Main entry point - starts both Discord bot and web server
require('dotenv').config();

console.log('🚀 Starting INC BOT application...');

// Start the Discord bot
console.log('🤖 Initializing Discord bot...');
require('./index.js');

// Start the web server
console.log('🌐 Starting web server...');
require('./server.js');

console.log('✅ Application startup complete!');
