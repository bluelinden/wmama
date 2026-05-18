import nacl from 'tweetnacl';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const PAINT_ROLE_NAME_REGEX = /^Paint #[0-9A-F]{6}$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hexToUint8Array(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }

  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return out;
}

function verifyDiscordSignature({ signature, timestamp, body, publicKey }) {
  try {
    const signatureBytes = hexToUint8Array(signature);
    const publicKeyBytes = hexToUint8Array(publicKey);
    const timestampBytes = textEncoder.encode(timestamp);

    const message = new Uint8Array(timestampBytes.length + body.length);
    message.set(timestampBytes, 0);
    message.set(body, timestampBytes.length);

    return nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

function normalizeHexColor(input) {
  if (!input) return null;

  const trimmed = input.trim();
  const match = /^(?:#|0x)?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) return null;

  let hex = match[1].toUpperCase();
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  const int = Number.parseInt(hex, 16);
  if (!Number.isFinite(int) || int < 0x000000 || int > 0xffffff) return null;

  return {
    hex: `#${hex}`,
    int
  };
}

function getStringOption(interaction, name) {
  const options = interaction?.data?.options;
  if (!Array.isArray(options)) return null;
  const option = options.find((o) => o?.name === name);
  return typeof option?.value === 'string' ? option.value : null;
}

function getInteractionUserId(interaction) {
  return interaction?.member?.user?.id ?? interaction?.user?.id ?? null;
}

function getInteractionUserTag(interaction) {
  const user = interaction?.member?.user ?? interaction?.user;
  if (!user) return 'unknown';
  return user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : user.username;
}

async function discordFetch(env, endpoint, { method = 'GET', jsonBody, reason } = {}) {
  if (!env.DISCORD_TOKEN) {
    throw new Error('Missing DISCORD_TOKEN');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${DISCORD_API_BASE}${endpoint}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = new Headers();
    headers.set('authorization', `Bot ${env.DISCORD_TOKEN}`);
    if (jsonBody !== undefined) headers.set('content-type', 'application/json; charset=utf-8');
    if (reason) headers.set('x-audit-log-reason', encodeURIComponent(reason));

    const res = await fetch(url, {
      method,
      headers,
      body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined
    });

    if (res.status !== 429) return res;

    // Rate limited. Sleep and retry.
    const data = await res.json().catch(() => null);
    const retryAfterSeconds = Number(data?.retry_after ?? 1);
    await sleep(Math.ceil(retryAfterSeconds * 1000) + 50);
  }

  throw new Error(`Discord API rate-limited too many times for ${method} ${endpoint}`);
}

async function discordJson(env, endpoint, options) {
  const res = await discordFetch(env, endpoint, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`Discord API error ${res.status}: ${text || res.statusText}`);
  }

  return data;
}

async function discordOk(env, endpoint, options) {
  const res = await discordFetch(env, endpoint, options);
  if (res.ok) return;
  const text = await res.text();
  throw new Error(`Discord API error ${res.status}: ${text || res.statusText}`);
}

async function editOriginalInteractionResponse(interaction, content) {
  const appId = interaction.application_id;
  const token = interaction.token;
  if (!appId || !token) throw new Error('Missing interaction application_id or token');

  const url = `${DISCORD_API_BASE}/webhooks/${appId}/${token}/messages/@original`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({ content })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to edit interaction response (${res.status}): ${text || res.statusText}`);
  }
}

async function handlePaintInBackground(interaction, env) {
  const guildId = interaction.guild_id;
  if (!guildId) {
    await editOriginalInteractionResponse(interaction, 'This command can only be used in a server.');
    return;
  }

  const userId = getInteractionUserId(interaction);
  if (!userId) {
    await editOriginalInteractionResponse(interaction, 'Could not determine your user ID.');
    return;
  }

  const colorInput = getStringOption(interaction, 'color');
  const normalized = normalizeHexColor(colorInput);
  if (!normalized) {
    await editOriginalInteractionResponse(interaction, 'Please provide a hex color like `#ff00ff` (or `ff00ff`).');
    return;
  }

  const userTag = getInteractionUserTag(interaction);
  const targetRoleName = `Paint ${normalized.hex}`;

  const reason = `Paint role requested by ${userTag} (${userId})`;

  const roles = await discordJson(env, `/guilds/${guildId}/roles`);
  if (!Array.isArray(roles)) throw new Error('Expected roles array');

  const rolesById = new Map(roles.map((r) => [r.id, r]));

  const isSafePaintRole = (role) => {
    if (!role) return false;
    if (!PAINT_ROLE_NAME_REGEX.test(role.name)) return false;
    if (role.managed) return false;
    try {
      return BigInt(role.permissions) === 0n;
    } catch {
      return false;
    }
  };

  // Prefer an existing safe role for this exact color.
  let role = roles.find((r) => r.name === targetRoleName && isSafePaintRole(r)) ?? null;

  // Create if needed.
  if (!role) {
    if (roles.length >= 250) {
      await editOriginalInteractionResponse(
        interaction,
        'This server is at the role limit, so I cannot create a new color role. Ask an admin to delete unused roles.'
      );
      return;
    }

    role = await discordJson(env, `/guilds/${guildId}/roles`, {
      method: 'POST',
      jsonBody: {
        name: targetRoleName,
        color: normalized.int,
        hoist: false,
        mentionable: false,
        permissions: '0'
      },
      reason
    });
    rolesById.set(role.id, role);
  }

  if (role.managed) {
    await editOriginalInteractionResponse(interaction, 'That role is managed by an integration, so I cannot assign it.');
    return;
  }

  try {
    if (BigInt(role.permissions) !== 0n) {
      await editOriginalInteractionResponse(
        interaction,
        `Refusing to assign @${role.name} because it has permissions. Ask an admin to remove its permissions or delete/recreate it.`
      );
      return;
    }
  } catch {
    await editOriginalInteractionResponse(interaction, 'Refusing to assign that role because its permissions were unexpected.');
    return;
  }

  // Best-effort: sync role color to its name.
  if (typeof role.color === 'number' && role.color !== normalized.int) {
    await discordOk(env, `/guilds/${guildId}/roles/${role.id}`, {
      method: 'PATCH',
      jsonBody: { color: normalized.int },
      reason: `Sync paint role color to ${normalized.hex} (requested by ${userTag} (${userId}))`
    }).catch((err) => console.warn(err));
  }

  const memberRoleIds = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  const paintRolesToRemove = memberRoleIds
    .map((id) => rolesById.get(id))
    .filter((r) => isSafePaintRole(r) && r.id !== role.id);

  let removedCount = 0;
  for (const r of paintRolesToRemove) {
    try {
      await discordOk(env, `/guilds/${guildId}/members/${userId}/roles/${r.id}`, {
        method: 'DELETE',
        reason: `Replacing paint role for ${userTag} (${userId})`
      });
      removedCount++;
    } catch (err) {
      console.warn(err);
    }
  }

  // Add the requested paint role.
  await discordOk(env, `/guilds/${guildId}/members/${userId}/roles/${role.id}`, {
    method: 'PUT',
    reason: `Paint role assigned by /paint for ${userTag} (${userId})`
  });

  const removedText = removedCount ? ` Removed ${removedCount} previous paint role(s).` : '';
  await editOriginalInteractionResponse(interaction, `Done! You now have <@&${role.id}> (${normalized.hex}).${removedText}`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      return new Response('ok', { status: 200 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname !== '/interactions') {
      return new Response('Not Found', { status: 404 });
    }

    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');

    if (!signature || !timestamp) {
      return new Response('Bad Request', { status: 400 });
    }

    if (!env.DISCORD_PUBLIC_KEY) {
      console.error('Missing DISCORD_PUBLIC_KEY');
      return new Response('Server Misconfigured', { status: 500 });
    }

    const body = new Uint8Array(await request.arrayBuffer());
    const isValid = verifyDiscordSignature({ signature, timestamp, body, publicKey: env.DISCORD_PUBLIC_KEY });
    if (!isValid) {
      return new Response('Invalid request signature', { status: 401 });
    }

    const interaction = JSON.parse(textDecoder.decode(body));

    // 1 = PING
    if (interaction.type === 1) {
      return json({ type: 1 });
    }

    // 2 = APPLICATION_COMMAND
    if (interaction.type === 2) {
      const name = interaction?.data?.name;

      if (name === 'ping') {
        return json({
          type: 4,
          data: {
            content: 'Pong!'
          }
        });
      }

      if (name === 'paint') {
        ctx.waitUntil(
          handlePaintInBackground(interaction, env).catch((error) => {
            console.error(error);
            return editOriginalInteractionResponse(
              interaction,
              'Something went wrong while updating your paint role. Make sure I have `Manage Roles` and my highest role is above the paint roles.'
            ).catch((err) => console.error(err));
          })
        );

        return json({
          type: 5,
          data: {
            flags: 64
          }
        });
      }

      return json({
        type: 4,
        data: {
          content: `Unknown command: ${name ?? 'unknown'}`,
          flags: 64
        }
      });
    }

    return new Response('Unhandled interaction type', { status: 400 });
  }
};
