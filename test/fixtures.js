// Discovery messages of a robot, shaped like the ones Valetudo publishes
// (backend/lib/mqtt/homeassistant in the Valetudo sources).

export const IDENTIFIER = 'GentleVividLynx';
const BASE = `valetudo/${IDENTIFIER}`;

const device = {
  manufacturer: 'Valetudo',
  model: 'Roborock S5',
  name: 'Rocky',
  identifiers: [IDENTIFIER],
  sw_version: '2026.02.0',
};

const common = (uniqueId) => ({
  unique_id: uniqueId,
  availability_topic: `${BASE}/$state`,
  payload_available: 'ready',
  payload_not_available: 'lost',
  device,
});

const entity = (component, name, config) => {
  const uniqueId = name ? `${IDENTIFIER}_${component}_${name}` : `${IDENTIFIER}_${component}`;
  return [
    `homeassistant/${component}/${IDENTIFIER}/${uniqueId}/config`,
    JSON.stringify({ ...config, ...common(uniqueId) }),
  ];
};

export const TOPICS = {
  availability: `${BASE}/$state`,
  vacuumState: `${BASE}/hass/${IDENTIFIER}_vacuum/state`,
  vacuumCommand: `${BASE}/hass/${IDENTIFIER}_vacuum/command`,
  battery: `${BASE}/BatteryStateAttribute/level`,
  fan: `${BASE}/FanSpeedControlCapability/preset`,
  mainBrush: `${BASE}/hass/${IDENTIFIER}_sensor_ConsumableMonitoringCapability_brush_main`,
  filter: `${BASE}/hass/${IDENTIFIER}_sensor_ConsumableMonitoringCapability_filter_main`,
  wifi: `${BASE}/hass/${IDENTIFIER}_sensor_wifi_configuration`,
};

export function discoveryMessages({ locate = true } = {}) {
  return [
    entity('vacuum', '', {
      name: 'Robot',
      supported_features: [
        'status',
        'start',
        'stop',
        'pause',
        'return_home',
        ...(locate ? ['locate'] : []),
        'fan_speed',
      ],
      state_topic: TOPICS.vacuumState,
      command_topic: TOPICS.vacuumCommand,
      payload_start: 'START',
      payload_pause: 'PAUSE',
      payload_return_to_base: 'HOME',
      payload_stop: 'STOP',
      payload_locate: 'LOCATE',
      fan_speed_list: ['low', 'medium', 'high', 'max'],
      set_fan_speed_topic: `${TOPICS.fan}/set`,
    }),
    entity('sensor', 'battery_level', {
      name: 'Battery level',
      state_topic: TOPICS.battery,
      unit_of_measurement: '%',
      device_class: 'battery',
      state_class: 'measurement',
    }),
    entity('select', 'FanSpeedControlCapability', {
      name: 'Fan',
      state_topic: TOPICS.fan,
      value_template: '{{ value }}',
      command_topic: `${TOPICS.fan}/set`,
      options: ['low', 'medium', 'high', 'max'],
    }),
    // Roborock reports the remaining life in minutes...
    entity('sensor', 'ConsumableMonitoringCapability_brush_main', {
      name: 'Main Brush',
      state_topic: TOPICS.mainBrush,
      unit_of_measurement: 'min',
      device_class: 'duration',
    }),
    // ...other vendors in percent.
    entity('sensor', 'ConsumableMonitoringCapability_filter_main', {
      name: 'Main Filter',
      state_topic: TOPICS.filter,
      unit_of_measurement: '%',
    }),
    // Not handled: must be ignored without breaking the device.
    entity('sensor', 'wifi_configuration', {
      name: 'Wi-Fi configuration',
      state_topic: TOPICS.wifi,
      value_template: '{{ value_json.state }}',
      unit_of_measurement: 'dBm',
      device_class: 'signal_strength',
    }),
  ];
}

// An entity of another Home Assistant device sharing the broker.
export const FOREIGN_MESSAGE = [
  'homeassistant/sensor/0x00158d0001a2b3c4/temperature/config',
  JSON.stringify({
    name: 'Temperature',
    state_topic: 'zigbee2mqtt/living-room',
    device: { manufacturer: 'Aqara', name: 'Living room sensor' },
  }),
];
