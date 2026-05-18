import { Listener } from "@sapphire/framework";
import { GuildMember } from "discord.js";

export class GuildMemberAddListener extends Listener {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      once: true,
      event: 'guildMemberAdd'
    });
  }

  run(member: GuildMember) {

  }
}
