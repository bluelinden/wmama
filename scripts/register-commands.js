require('dotenv').config();

const DISCORD_API_BASE = 'https://discord.com/api/v10';

const applicationId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId) throw new Error('Missing DISCORD_APPLICATION_ID');
if (!token) throw new Error('Missing DISCORD_TOKEN');

const commands = [
  {
    name: 'ping',
    description: 'Replies with Pong!',
    type: 1
  },
  {
    name: 'paint',
    description: 'Give yourself a role with a specific color',
    type: 1,
    dm_permission: false,
    options: [
      {
        type: 3,
        name: 'color',
        description: 'Hex color like #ff00ff (also accepts ff00ff)',
        required: true
      }
    ]
  }
];

const url = guildId
  ? `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`
  : `${DISCORD_API_BASE}/applications/${applicationId}/commands`;

(async () => {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bot ${token}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(commands)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to register commands (${res.status}): ${text || res.statusText}`);
  }

  const data = text ? JSON.parse(text) : [];
  const names = Array.isArray(data) ? data.map((c) => c.name).join(', ') : '(unknown)';
  console.log(`Registered commands (${guildId ? 'guild' : 'global'}): ${names}`);
  console.log(`Endpoint: ${url}`);
})();
