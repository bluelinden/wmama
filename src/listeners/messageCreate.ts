import { Listener } from "@sapphire/framework";
import { Message } from "discord.js";

export class MessageCreateListener extends Listener {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      once: true,
      event: 'messageCreate'
    });
  }

  async run(message: Message) {
    await message.reply("testing, sorry!");
  }
}
