// -----------------------------------------------------------------------------
// Translation of one Valetudo robot (its Home Assistant entities) into one
// Gladys device, plus the two routing tables that go with it:
//   - `states`:   MQTT topic            -> Gladys feature states
//   - `commands`: feature external_id   -> MQTT message to publish
//
// Pure functions: no MQTT client, no SDK connection. Everything here is
// derived from what the robot announced, never from a list of models.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'robot';

// Values of the Gladys core enums (server/utils/constants.js). The SDK exports
// the categories and types but not these value sets.
export const VACUUM_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING_TO_DOCK: 4,
  CHARGING: 5,
  DOCKED: 6,
};
export const VACUUM_MODE = { IDLE: 0, CLEANING: 1 };

// States of a Home Assistant `vacuum` entity, as Valetudo publishes them.
const HA_STATE_TO_GLADYS = {
  cleaning: VACUUM_STATE.RUNNING,
  docked: VACUUM_STATE.DOCKED,
  idle: VACUUM_STATE.STOPPED,
  paused: VACUUM_STATE.PAUSED,
  returning: VACUUM_STATE.RETURNING_TO_DOCK,
  error: VACUUM_STATE.ERROR,
};

// Feature keys are part of the external ids users' dashboards and scenes are
// keyed on: never rename one.
export const FEATURE = {
  STATE: 'state',
  RUN_MODE: 'run-mode',
  DOCK: 'dock',
  PAUSE: 'pause',
  LOCATE: 'locate',
};

const CONSUMABLE_MARKER = '_sensor_ConsumableMonitoringCapability_';

/**
 * Stable feature key of an entity: its unique id without the robot identifier
 * (already part of the device external id), reduced to [a-z0-9-].
 */
export function featureKey(identifier, objectId) {
  const local = objectId.startsWith(`${identifier}_`)
    ? objectId.slice(identifier.length + 1)
    : objectId;
  return local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Read the value an entity publishes. Valetudo only uses three shapes: the raw
 * payload (no template or `{{ value }}`) and one JSON key
 * (`{{ value_json.key }}`). Anything else is not understood: undefined.
 */
export function readValue(template, payload) {
  if (!template || /^\{\{\s*value\s*\}\}$/.test(template)) {
    return payload;
  }
  const jsonKey = template.match(/^\{\{\s*value_json\.([A-Za-z0-9_]+)\s*\}\}$/);
  if (!jsonKey) {
    return undefined;
  }
  try {
    const value = JSON.parse(payload)?.[jsonKey[1]];
    return value === undefined || value === null ? undefined : String(value);
  } catch {
    return undefined;
  }
}

const toNumber = (text) => {
  const value = Number(text);
  return text === '' || !Number.isFinite(value) ? undefined : value;
};

// --- One mapper per kind of entity -------------------------------------------
// Each returns { features, states: [[topic, handler]], commands: [[key, handler]] }
// or null when the entity is not handled.

function mapVacuum({ config }) {
  if (!config.state_topic || !config.command_topic) {
    return null;
  }
  const supported = new Set(config.supported_features ?? []);
  const command = (payload) => ({ topic: config.command_topic, payload });
  const base = { min: 0, max: 1, has_feedback: false, keep_history: false };

  const features = [
    {
      key: FEATURE.STATE,
      name: 'State',
      category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
      type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE,
      min: 0,
      max: 6,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    {
      key: FEATURE.RUN_MODE,
      name: 'Mode',
      category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
      type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.RUN_MODE,
      ...base,
      read_only: false,
      has_feedback: true,
      // No "mapping" entry: Home Assistant discovery has no command for it.
      supported_options: [
        { value: VACUUM_MODE.IDLE, sort_order: 0 },
        { value: VACUUM_MODE.CLEANING, sort_order: 1 },
      ],
    },
    {
      key: FEATURE.DOCK,
      name: 'Return to dock',
      category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
      type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK,
      ...base,
      read_only: false,
    },
    {
      key: FEATURE.PAUSE,
      name: 'Pause',
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      ...base,
      read_only: false,
    },
  ];
  const commands = [
    [
      FEATURE.RUN_MODE,
      (value) =>
        command(
          Number(value) === VACUUM_MODE.CLEANING
            ? (config.payload_start ?? 'START')
            : (config.payload_stop ?? 'STOP'),
        ),
    ],
    [FEATURE.DOCK, () => command(config.payload_return_to_base ?? 'HOME')],
    [FEATURE.PAUSE, () => command(config.payload_pause ?? 'PAUSE')],
  ];
  if (supported.has('locate')) {
    features.push({
      key: FEATURE.LOCATE,
      name: 'Locate',
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      ...base,
      read_only: false,
    });
    commands.push([FEATURE.LOCATE, () => command(config.payload_locate ?? 'LOCATE')]);
  }

  const states = [
    [
      config.state_topic,
      (payload) => {
        const state = HA_STATE_TO_GLADYS[readValue('{{ value_json.state }}', payload)];
        if (state === undefined) {
          return [];
        }
        return [
          [FEATURE.STATE, state],
          [
            FEATURE.RUN_MODE,
            state === VACUUM_STATE.RUNNING ? VACUUM_MODE.CLEANING : VACUUM_MODE.IDLE,
          ],
        ];
      },
    ],
  ];
  return { features, states, commands };
}

function mapSensor({ objectId, config }, identifier) {
  if (!config.state_topic) {
    return null;
  }
  const key = featureKey(identifier, objectId);
  let feature;
  if (config.device_class === 'battery') {
    feature = {
      name: 'Battery',
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
    };
  } else if (objectId.includes(CONSUMABLE_MARKER)) {
    // Remaining life of a wear part: a percentage on some robots, a duration
    // in minutes on others (Roborock).
    feature =
      config.unit_of_measurement === '%'
        ? {
            category: DEVICE_FEATURE_CATEGORIES.MAINTENANCE,
            type: DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING,
            unit: DEVICE_FEATURE_UNITS.PERCENT,
            min: 0,
            max: 100,
          }
        : {
            category: DEVICE_FEATURE_CATEGORIES.DURATION,
            type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
            unit: DEVICE_FEATURE_UNITS.MINUTES,
            min: 0,
            max: 100000,
          };
    feature.name = config.name || key;
  } else {
    return null;
  }
  return {
    features: [{ key, ...feature, read_only: true, has_feedback: false, keep_history: true }],
    states: [
      [
        config.state_topic,
        (payload) => {
          const value = toNumber(readValue(config.value_template, payload) ?? '');
          return value === undefined ? [] : [[key, value]];
        },
      ],
    ],
    commands: [],
  };
}

function mapSelect({ objectId, config }, identifier) {
  const options = Array.isArray(config.options) ? config.options.map(String) : [];
  if (!config.state_topic || !config.command_topic || options.length === 0) {
    return null;
  }
  const key = featureKey(identifier, objectId);
  return {
    features: [
      {
        key,
        name: config.name || key,
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
        min: 0,
        max: 0,
        read_only: false,
        has_feedback: true,
        keep_history: false,
        supported_options: options.map((value, index) => ({
          value,
          label: value,
          sort_order: index,
        })),
      },
    ],
    states: [
      [
        config.state_topic,
        (payload) => {
          const value = readValue(config.value_template, payload);
          return value === undefined || value === '' ? [] : [[key, { text: value }]];
        },
      ],
    ],
    commands: [
      [
        key,
        (value) => {
          if (!options.includes(String(value))) {
            throw new Error(`Unsupported option "${value}" for ${config.name || key}`);
          }
          return { topic: config.command_topic, payload: String(value) };
        },
      ],
    ],
  };
}

const MAPPERS = { vacuum: mapVacuum, sensor: mapSensor, select: mapSelect };

/**
 * Build the Gladys device of a robot and its routing tables.
 * @param {object} gladys SDK instance (only `externalIds` is used)
 * @param {{ identifier: string, name: string, model: string, entities: Map<string, object> }} robot
 * @returns {{ device: object, states: Map<string, Function[]>, commands: Map<string, Function> } | null}
 *   null while the robot has not announced its `vacuum` entity yet.
 */
export function buildRobot(gladys, robot) {
  const ids = gladys.externalIds(DEVICE_TYPE, robot.identifier);
  const features = [];
  const states = new Map();
  const commands = new Map();
  let hasVacuum = false;

  // Sorted so the feature order does not depend on the arrival order of the
  // retained messages: a different order would look like a structure change.
  const entities = [...robot.entities.values()].sort((a, b) =>
    a.component === b.component
      ? a.objectId.localeCompare(b.objectId)
      : a.component === 'vacuum'
        ? -1
        : b.component === 'vacuum'
          ? 1
          : a.component.localeCompare(b.component),
  );

  for (const entity of entities) {
    const mapped = MAPPERS[entity.component]?.(entity, robot.identifier);
    if (!mapped) {
      continue;
    }
    hasVacuum ||= entity.component === 'vacuum';
    for (const { key, ...feature } of mapped.features) {
      features.push({ ...feature, external_id: ids.feature(key) });
    }
    for (const [topic, read] of mapped.states) {
      const handlers = states.get(topic) ?? [];
      handlers.push((payload) =>
        read(payload).map(([key, state]) => ({
          device_feature_external_id: ids.feature(key),
          // Text features carry `text`, every other one a numeric `state`.
          ...(typeof state === 'object' ? state : { state }),
        })),
      );
      states.set(topic, handlers);
    }
    for (const [key, toMessage] of mapped.commands) {
      commands.set(ids.feature(key), toMessage);
    }
  }

  if (!hasVacuum) {
    return null;
  }
  return {
    device: {
      name: robot.name,
      external_id: ids.device,
      ...(robot.model ? { model: robot.model } : {}),
      features,
    },
    states,
    commands,
  };
}
