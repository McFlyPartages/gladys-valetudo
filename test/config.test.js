import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, sameBroker } from '../src/config.js';

test('normalizeConfig returns the defaults for an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ mqtt_url: null, discovery_prefix: '  ' }), DEFAULT_CONFIG);
});

test('a bare host:port becomes an mqtt:// url, an explicit scheme is kept', () => {
  assert.equal(
    normalizeConfig({ mqtt_url: ' 192.168.1.10:1883 ' }).mqtt_url,
    'mqtt://192.168.1.10:1883',
  );
  assert.equal(
    normalizeConfig({ mqtt_url: 'mqtts://broker.lan:8883' }).mqtt_url,
    'mqtts://broker.lan:8883',
  );
});

test('the discovery prefix loses its trailing slash, the password is left untouched', () => {
  const config = normalizeConfig({ discovery_prefix: 'ha/', mqtt_password: ' secret ' });
  assert.equal(config.discovery_prefix, 'ha');
  assert.equal(config.mqtt_password, ' secret ');
});

test('sameBroker compares every key of the broker session', () => {
  const a = normalizeConfig({ mqtt_url: 'broker:1883' });
  assert.ok(sameBroker(a, normalizeConfig({ mqtt_url: 'mqtt://broker:1883' })));
  assert.ok(!sameBroker(a, normalizeConfig({ mqtt_url: 'broker:1883', mqtt_password: 'x' })));
});
