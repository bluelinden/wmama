import { Command } from '@sapphire/framework';
import { APIGuildMember, APIGuildMemberJoined, APIInteractionGuildMember, PermissionsBitField } from 'discord.js';

const PAINT_ROLE_NAME_REGEX = /^Paint #[0-9A-F]{6}$/;

function normalizeHexColor(input: string) {
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

function getMemberRoleIds(interactionMember: APIGuildMember) {
  if (!interactionMember) return [];

  // In guild interactions this can be either a GuildMember or an APIInteractionGuildMember.
  // - GuildMember.roles is a GuildMemberRoleManager
  // - APIInteractionGuildMember.roles is an array of role IDs
  if (Array.isArray(interactionMember.roles)) return interactionMember.roles;

  if (interactionMember.roles) {
    return [...interactionMember.roles.cache.keys()];
  }

  return [];
}

class PaintCommand extends Command {
  constructor(context, options) {
    super(context, {
      ...options,
      description: 'Give yourself a role with a specific color (e.g. /paint #ff00ff)'
    });
  }

  registerApplicationCommands(registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addStringOption((option) =>
            option
              .setName('color')
              .setDescription('Hex color like #ff00ff (also accepts ff00ff)')
              .setRequired(true)
          ),
      {
        // If set, register commands to this guild for instant updates while developing.
        guildIds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined
      }
    );
  }

  async chatInputRun(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      if (!interaction.inGuild() || !interaction.guild) {
        return interaction.editReply('This command can only be used in a server.');
      }

      const normalized = normalizeHexColor(interaction.options.getString('color', true));
      if (!normalized) {
        return interaction.editReply('Please provide a hex color like `#ff00ff` (or `ff00ff`).');
      }

      const guild = interaction.guild;
      const me = guild.members.me ?? (await guild.members.fetchMe());

      if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.editReply('I need the `Manage Roles` permission to do that.');
      }

      const targetRoleName = `Paint ${normalized.hex}`;

      // Ensure roles are cached so we can find/reuse existing paint roles.
      if (guild.roles.cache.size === 0) {
        await guild.roles.fetch();
      }

      // Prefer an existing *safe* role if one already exists for this color.
      let role =
        guild.roles.cache.find((r) => r.name === targetRoleName && !r.managed && r.permissions.bitfield === 0n) ?? null;

      // If role doesn't exist, create it.
      if (!role) {
        // Discord hard-limits roles per guild (including @everyone).
        // If a guild is at/near the limit, role creation will fail.
        if (guild.roles.cache.size >= 250) {
          return interaction.editReply(
            'This server is at the role limit, so I cannot create a new color role. Ask an admin to delete unused roles.'
          );
        }

        role = await guild.roles.create({
          name: targetRoleName,
          color: normalized.int,
          hoist: false,
          mentionable: false,
          permissions: [],
          reason: `Paint role requested by ${interaction.user.tag} (${interaction.user.id})`
        });
      }

      // Safety checks to avoid letting users self-assign a powerful role if one exists with the expected name.
      if (role.managed) {
        return interaction.editReply('That role is managed by an integration, so I cannot assign it.');
      }

      if (role.permissions.bitfield !== 0n) {
        return interaction.editReply(
          `Refusing to assign ${role} because it has permissions. Ask an admin to remove its permissions or delete/recreate it.`
        );
      }

      if (me.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.editReply(
          `I can't assign ${role} because it's above (or equal to) my highest role. Move my bot role above it.`
        );
      }

      // Keep the role's actual color in sync with its name (best-effort).
      if (role.color !== normalized.int) {
        await role
          .edit({
            color: normalized.int,
            reason: `Sync paint role color to ${normalized.hex} (requested by ${interaction.user.tag} (${interaction.user.id}))`
          })
          .catch((error) => this.container.logger.warn(error));
      }

      const memberRoleIds = getMemberRoleIds(interaction.member);
      const paintRolesToRemove = memberRoleIds
        .map((id) => guild.roles.cache.get(id))
        .filter(
          (r) =>
            r &&
            PAINT_ROLE_NAME_REGEX.test(r.name) &&
            !r.managed &&
            r.permissions.bitfield === 0n &&
            r.id !== role.id
        )
        .filter((r) => me.roles.highest.comparePositionTo(r) > 0);

      // Remove any existing paint roles the user has (best-effort).
      const removalResults = await Promise.allSettled(
        paintRolesToRemove.map((r) =>
          guild.members.removeRole({
            user: interaction.user.id,
            role: r.id,
            reason: `Replacing paint role for ${interaction.user.tag} (${interaction.user.id})`
          })
        )
      );

      const removedCount = removalResults.filter((r) => r.status === 'fulfilled').length;

      // Add the requested paint role.
      await guild.members.addRole({
        user: interaction.user.id,
        role: role.id,
        reason: `Paint role assigned by /paint for ${interaction.user.tag} (${interaction.user.id})`
      });

      const removedText = removedCount ? ` Removed ${removedCount} previous paint role(s).` : '';

      return interaction.editReply(`Done! You are now ${role} (${normalized.hex}).${removedText}`);
    } catch (error) {
      this.container.logger.error(error);
      return interaction.editReply(
        'Something went wrong while updating your paint role. Make sure I have `Manage Roles` and my highest role is above the paint roles.'
      );
    }
  }
}

module.exports = { PaintCommand };
