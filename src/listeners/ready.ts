const { Listener, Events } = require('@sapphire/framework');

export class ReadyListener extends Listener {
  constructor(context, options) {
    super(context, {
      ...options,
      once: true,
      event: Events.ClientReady
    });
  }

  run() {
    this.container.logger.info(`Logged in as ${this.container.client.user.tag}`);
  }
}
