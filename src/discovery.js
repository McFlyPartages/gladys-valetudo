// -----------------------------------------------------------------------------
// Home Assistant MQTT discovery, restricted to what Valetudo publishes.
//
// Valetudo announces every entity of a robot on
//   <prefix>/<component>/<identifier>/<unique_id>/config
// with a retained JSON payload carrying the real topics of that robot. Reading
// them (instead of hardcoding a list of models) is what makes every robot
// supported by Valetudo work: a robot only announces the capabilities it has.
// -----------------------------------------------------------------------------

const VALETUDO_MANUFACTURER = 'Valetudo';

/**
 * @param {string} prefix discovery prefix, e.g. "homeassistant"
 * @param {string} topic
 * @returns {{ component: string, identifier: string, objectId: string } | null}
 */
export function parseDiscoveryTopic(prefix, topic) {
  if (!topic.startsWith(`${prefix}/`)) {
    return null;
  }
  const parts = topic.slice(prefix.length + 1).split('/');
  if (parts.length !== 4 || parts[3] !== 'config') {
    return null;
  }
  const [component, identifier, objectId] = parts;
  return { component, identifier, objectId };
}

/**
 * In-memory registry of the robots announced on the broker.
 */
export class RobotRegistry {
  constructor(prefix = 'homeassistant') {
    this.prefix = prefix;
    /** @type {Map<string, { identifier: string, name: string, model: string, entities: Map<string, object> }>} */
    this.robots = new Map();
  }

  /** Topic filter matching every discovery message. */
  get subscription() {
    return `${this.prefix}/+/+/+/config`;
  }

  /**
   * Feed one discovery message.
   * @param {string} topic
   * @param {string} payload raw payload; empty means "entity removed"
   * @returns {boolean} true when the registry changed
   */
  handleMessage(topic, payload) {
    const parsed = parseDiscoveryTopic(this.prefix, topic);
    if (!parsed) {
      return false;
    }
    const { component, identifier, objectId } = parsed;

    if (payload === '') {
      const robot = this.robots.get(identifier);
      if (!robot || !robot.entities.delete(objectId)) {
        return false;
      }
      if (robot.entities.size === 0) {
        this.robots.delete(identifier);
      }
      return true;
    }

    let config;
    try {
      config = JSON.parse(payload);
    } catch {
      return false;
    }
    // The broker is shared with every other Home Assistant device: keep only
    // what Valetudo announced.
    if (config?.device?.manufacturer !== VALETUDO_MANUFACTURER) {
      return false;
    }

    let robot = this.robots.get(identifier);
    if (!robot) {
      robot = { identifier, name: identifier, model: '', entities: new Map() };
      this.robots.set(identifier, robot);
    }
    const previous = robot.entities.get(objectId);
    const serialized = JSON.stringify(config);
    if (previous?.serialized === serialized) {
      return false;
    }
    robot.name = config.device.name || identifier;
    robot.model = config.device.model || '';
    robot.entities.set(objectId, { component, objectId, config, serialized });
    return true;
  }

  list() {
    return [...this.robots.values()];
  }
}
