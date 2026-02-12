require('dotenv').config();

// Start the Telegram bot first (creates the polling instance)
const { bot } = require('./src/bot/bot');

// Start the dashboard server (shares the bot instance)
require('./src/api/server');
