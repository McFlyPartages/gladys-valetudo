// -----------------------------------------------------------------------------
// Integration configuration, filled in by the user in Gladys from the
// `config_schema` of the manifest. This module provides the defaults and
// normalizes the received object, so the rest of the code never sees
// `undefined`.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  mqtt_url: '',
  mqtt_username: '',
  mqtt_password: '',
  // Home Assistant discovery prefix, as configured in Valetudo (rarely changed).
  discovery_prefix: 'homeassistant',
};

const trimmed = (value, fallback) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? fallback : text;
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  let mqttUrl = trimmed(raw.mqtt_url, DEFAULT_CONFIG.mqtt_url);
  // A bare "host:port" is what most users type: assume plain MQTT.
  if (mqttUrl !== '' && !/^[a-z]+:\/\//i.test(mqttUrl)) {
    mqttUrl = `mqtt://${mqttUrl}`;
  }
  return {
    mqtt_url: mqttUrl,
    mqtt_username: trimmed(raw.mqtt_username, DEFAULT_CONFIG.mqtt_username),
    // Never trimmed: a password may legitimately start or end with a space.
    mqtt_password: typeof raw.mqtt_password === 'string' ? raw.mqtt_password : '',
    discovery_prefix: trimmed(raw.discovery_prefix, DEFAULT_CONFIG.discovery_prefix).replace(
      /\/+$/,
      '',
    ),
  };
}

/** True when two normalized configs lead to the same broker session. */
export function sameBroker(a, b) {
  return Object.keys(DEFAULT_CONFIG).every((key) => a[key] === b[key]);
}
