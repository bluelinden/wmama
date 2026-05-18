const { Command } = require('@sapphire/framework');

class PingCommand extends Command {
  constructor(context, options) {
    super(context, {
      ...options,
      description: 'Replies with Pong!'
    });
  }

  registerApplicationCommands(registry) {
    registry.registerChatInputCommand(
      (builder) => builder.setName(this.name).setDescription(this.description),
      {
        // If set, register commands to this guild for instant updates while developing.
        guildIds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined
      }
    );
  }

  async chatInputRun(interaction) {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    const roundtripMs = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPingMs = Math.round(this.container.client.ws.ping);

    return interaction.editReply(`Pong! Roundtrip: ${roundtripMs}ms | WS: ${wsPingMs}ms`);
  }
}

module.exports = { PingCommand };
