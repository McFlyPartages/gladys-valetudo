// -----------------------------------------------------------------------------
// Bridge between the MQTT broker Valetudo publishes on and Gladys.
//
//   discovery messages -> RobotRegistry -> devices published to Gladys
//   state messages     -> feature states published to Gladys (changes only)
//   availability       -> "unreachable" badge of the device in Gladys
//   Gladys commands    -> MQTT messages published to the robot
//
// The MQTT client is injected (`connectMqtt`) so the tests never open a socket.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { RobotRegistry } from './discovery.js';
import { buildRobot } from './robot.js';

const logger = createLogger({ name: 'bridge' });

// Valetudo announces ~30 entities per robot in a burst: wait for the burst to
// end before publishing the devices once.
const DISCOVERY_DEBOUNCE_MS = 1000;

export const MESSAGES = {
  notConfigured: {
    en: 'Enter the address of your MQTT broker in the configuration.',
    fr: "Renseignez l'adresse de votre broker MQTT dans la configuration.",
  },
  connecting: {
    en: 'Connecting to the MQTT broker…',
    fr: 'Connexion au broker MQTT en cours…',
  },
  unreachable: {
    en: 'MQTT broker unreachable or credentials refused, check the configuration.',
    fr: 'Broker MQTT injoignable ou identifiants refusés, vérifiez la configuration.',
  },
};

export class Bridge {
  /**
   * @param {object} gladys SDK instance
   * @param {(config: object) => object} connectMqtt returns an mqtt.js client
   * @param {{ debounceMs?: number }} [options]
   */
  constructor(gladys, connectMqtt, { debounceMs = DISCOVERY_DEBOUNCE_MS } = {}) {
    this.gladys = gladys;
    this.connectMqtt = connectMqtt;
    this.debounceMs = debounceMs;
    this.client = null;
    this.registry = new RobotRegistry();
    this.stateHandlers = new Map(); // topic -> handlers
    this.commands = new Map(); // feature external_id -> message builder
    this.devices = [];
    this.lastPayloads = new Map(); // state topic -> last payload received
    this.availability = new Map(); // availability topic -> [{ externalId, online }]
    this.reachable = new Map(); // device external_id -> last transport published
    this.syncTimer = null;
  }

  /** (Re)start the broker session with a normalized config. */
  async start(config) {
    await this.stop();
    this.registry = new RobotRegistry(config.discovery_prefix);
    if (!config.mqtt_url) {
      await this.setStatus(false, MESSAGES.notConfigured);
      return;
    }
    await this.setStatus(false, MESSAGES.connecting);

    const client = this.connectMqtt(config);
    this.client = client;
    client.on('connect', () => {
      logger.info('Connected to the MQTT broker');
      // mqtt.js re-subscribes by itself after a reconnection.
      client.subscribe(this.registry.subscription, (err) => {
        if (err) {
          logger.error('Subscription to the discovery topics failed', err);
        }
      });
      this.setStatus(true);
    });
    client.on('error', (err) => {
      logger.warn(`MQTT error: ${err.message}`);
      if (!client.connected) {
        this.setStatus(false, MESSAGES.unreachable);
      }
    });
    client.on('close', () => {
      if (this.client === client) {
        this.setStatus(false, MESSAGES.unreachable);
        // Without the broker no robot can be reached. The retained
        // availability comes back with the subscriptions on reconnection.
        for (const topic of this.availability.keys()) {
          this.lastPayloads.delete(topic);
        }
        this.publishAvailability().catch((err) =>
          logger.debug(`publishTransports failed: ${err.message}`),
        );
      }
    });
    client.on('message', (topic, payload) => {
      this.onMessage(topic, payload.toString()).catch((err) =>
        logger.error(`Handling of ${topic} failed`, err),
      );
    });
  }

  async stop() {
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    const client = this.client;
    this.client = null;
    this.stateHandlers = new Map();
    this.commands = new Map();
    this.devices = [];
    this.lastPayloads = new Map();
    this.availability = new Map();
    this.reachable = new Map();
    if (client) {
      await new Promise((resolve) => client.end(true, {}, resolve));
    }
  }

  async setStatus(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`setConnectionStatus failed: ${err.message}`);
    }
  }

  async onMessage(topic, payload) {
    if (this.registry.handleMessage(topic, payload)) {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.sync().catch((err) => logger.error('Device synchronization failed', err));
      }, this.debounceMs);
      return;
    }
    if (this.availability.has(topic)) {
      this.lastPayloads.set(topic, payload);
      await this.publishAvailability();
    }
    if (this.stateHandlers.has(topic)) {
      this.lastPayloads.set(topic, payload);
      await this.publishTopicStates([topic]);
    }
  }

  /** Rebuild the devices from the registry and align the subscriptions. */
  async sync() {
    const built = this.registry
      .list()
      .map((robot) => buildRobot(this.gladys, robot))
      .filter(Boolean);

    const stateHandlers = new Map();
    const commands = new Map();
    const availability = new Map();
    for (const robot of built) {
      if (robot.availability) {
        const { topic, online } = robot.availability;
        const entry = { externalId: robot.device.external_id, online };
        availability.set(topic, [...(availability.get(topic) ?? []), entry]);
      }
      for (const [topic, handlers] of robot.states) {
        stateHandlers.set(topic, [...(stateHandlers.get(topic) ?? []), ...handlers]);
      }
      for (const [externalId, toMessage] of robot.commands) {
        commands.set(externalId, toMessage);
      }
    }

    const wanted = new Set([...stateHandlers.keys(), ...availability.keys()]);
    const current = new Set([...this.stateHandlers.keys(), ...this.availability.keys()]);
    const added = [...wanted].filter((topic) => !current.has(topic));
    const removed = [...current].filter((topic) => !wanted.has(topic));
    this.stateHandlers = stateHandlers;
    this.commands = commands;
    this.availability = availability;
    this.devices = built.map((robot) => robot.device);
    for (const topic of removed) {
      this.lastPayloads.delete(topic);
    }

    logger.info(`${this.devices.length} Valetudo robot(s) discovered`);
    await this.gladys.publishDiscoveredDevices(this.devices);
    await this.publishAvailability();

    if (this.client) {
      if (removed.length > 0) {
        this.client.unsubscribe(removed);
      }
      if (added.length > 0) {
        // The states are retained: subscribing delivers the current values.
        this.client.subscribe(added);
      }
    }
  }

  async publishTopicStates(topics) {
    const states = [];
    for (const topic of topics) {
      const payload = this.lastPayloads.get(topic);
      if (payload === undefined) {
        continue;
      }
      for (const handler of this.stateHandlers.get(topic) ?? []) {
        states.push(...handler(payload));
      }
    }
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states);
    }
  }

  /** True when the robot owning this device said it is connected to the broker. */
  isReachable(deviceExternalId) {
    for (const [topic, entries] of this.availability) {
      const entry = entries.find(({ externalId }) => externalId === deviceExternalId);
      if (entry) {
        return this.lastPayloads.get(topic) === entry.online;
      }
    }
    // A robot announcing no availability topic is assumed reachable.
    return Boolean(this.client?.connected);
  }

  /** Publish the transport badge of the devices whose reachability changed. */
  async publishAvailability({ force = false } = {}) {
    const entries = [];
    for (const { external_id: externalId } of this.devices) {
      const transport = this.isReachable(externalId) ? 'local' : 'unreachable';
      if (force || this.reachable.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    await this.gladys.publishTransports(entries);
    for (const { external_id: externalId, transport } of entries) {
      this.reachable.set(externalId, transport);
    }
  }

  /**
   * Gladys drops the states of a device the user has not created yet: send
   * the last known values again once it exists.
   */
  async replayStates() {
    await this.publishAvailability({ force: true });
    await this.publishTopicStates(
      [...this.lastPayloads.keys()].filter((topic) => this.stateHandlers.has(topic)),
    );
  }

  /** Devices to publish on a scan request. */
  discoveredDevices() {
    return this.devices;
  }

  /** Send a Gladys command to the robot. Throws when it cannot be sent. */
  async setValue(feature, value) {
    const toMessage = this.commands.get(feature.external_id);
    if (!toMessage) {
      throw new Error(`No command for ${feature.external_id}: robot not announced on the broker`);
    }
    if (!this.client?.connected) {
      throw new Error('MQTT broker not connected');
    }
    // The robot is not listening: the command would be lost silently.
    const deviceExternalId = this.devices.find((device) =>
      device.features.some((f) => f.external_id === feature.external_id),
    )?.external_id;
    if (!this.isReachable(deviceExternalId)) {
      throw new Error('Robot unreachable: it is not connected to the MQTT broker');
    }
    const { topic, payload } = toMessage(value);
    await this.client.publishAsync(topic, payload);
  }
}
