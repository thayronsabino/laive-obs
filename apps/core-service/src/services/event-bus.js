const { EventEmitter } = require("events");

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.wsServer = null;
  }

  attachWebSocketServer(wsServer) {
    this.wsServer = wsServer;
  }

  publish(type, payload = {}) {
    const event = {
      type,
      payload,
      timestamp: new Date().toISOString()
    };

    this.emit(type, event);
    this.emit("*", event);

    if (!this.wsServer) {
      return;
    }

    const serialized = JSON.stringify(event);
    this.wsServer.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(serialized);
      }
    });
  }
}

module.exports = {
  EventBus
};
