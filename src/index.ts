require('dotenv').config();

import { SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits } from 'discord.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error(
    'Missing DISCORD_TOKEN. Create a .env file (see .env.example) or set DISCORD_TOKEN in your environment.'
  );
}

const client = new SapphireClient({
  intents: [GatewayIntentBits.Guilds],
  // Load commands/listeners relative to this directory (src/)
  baseUserDirectory: __dirname
});

client
  .login(token)
  .catch((error) => {
    client.logger.fatal(error);
    process.exit(1);
  });
