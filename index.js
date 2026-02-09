require('dotenv').config();

// Start the dashboard server
require('./src/api/server');

// Start the Telegram bot
require('./src/bot/bot');
