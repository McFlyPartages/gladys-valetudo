import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { RobotRegistry } from '../src/discovery.js';
import { VACUUM_MODE, VACUUM_STATE, buildRobot, featureKey, readValue } from '../src/robot.js';
import { IDENTIFIER, TOPICS, discoveryMessages } from './fixtures.js';

const gladys = createFakeGladys();
const ids = gladys.externalIds('robot', IDENTIFIER);

function robotFrom(messages) {
  const registry = new RobotRegistry();
  for (const [topic, payload] of messages) {
    registry.handleMessage(topic, payload);
  }
  return buildRobot(gladys, registry.list()[0]);
}

const statesOf = (robot, topic, payload) =>
  (robot.states.get(topic) ?? []).flatMap((handler) => handler(payload));

test('featureKey strips the robot identifier and keeps [a-z0-9-]', () => {
  assert.equal(
    featureKey('Abc', 'Abc_select_FanSpeedControlCapability'),
    'select-fanspeedcontrolcapability',
  );
  assert.equal(featureKey('Abc', 'other_thing'), 'other-thing');
});

test('readValue understands the templates Valetudo uses, and only those', () => {
  assert.equal(readValue(undefined, '42'), '42');
  assert.equal(readValue('{{ value }}', 'max'), 'max');
  assert.equal(readValue('{{ value_json.state }}', '{"state":"docked"}'), 'docked');
  assert.equal(readValue('{{ value_json.state }}', 'not json'), undefined);
  assert.equal(readValue('{{ value_json.missing }}', '{}'), undefined);
  assert.equal(readValue('{{ value | int }}', '42'), undefined);
});

test('a robot becomes one device that Gladys accepts', async () => {
  const robot = robotFrom(discoveryMessages());
  assert.equal(robot.device.name, 'Rocky');
  assert.equal(robot.device.external_id, ids.device);

  const keys = robot.device.features.map((f) => f.external_id.slice(ids.device.length + 1));
  assert.deepEqual(keys, [
    'state',
    'run-mode',
    'dock',
    'pause',
    'locate',
    'select-fanspeedcontrolcapability',
    'sensor-battery-level',
    'sensor-consumablemonitoringcapability-brush-main',
    'sensor-consumablemonitoringcapability-filter-main',
  ]);

  // The SDK fake validates the payload like the host API does.
  const fresh = createFakeGladys();
  await fresh.publishDiscoveredDevices([robot.device]);
  assert.equal(fresh.fake.discoveredDevices.length, 1);
});

test('the feature order does not depend on the arrival order of the announcements', () => {
  const a = robotFrom(discoveryMessages());
  const b = robotFrom(discoveryMessages().reverse());
  assert.deepEqual(a.device, b.device);
});

test('consumables follow the unit the robot reports', () => {
  const { features } = robotFrom(discoveryMessages()).device;
  const brush = features.find((f) => f.external_id.endsWith('brush-main'));
  const filter = features.find((f) => f.external_id.endsWith('filter-main'));
  assert.deepEqual([brush.category, brush.unit, brush.name], ['duration', 'minutes', 'Main Brush']);
  assert.deepEqual(
    [filter.category, filter.type, filter.unit],
    ['maintenance', 'life-remaining', 'percent'],
  );
});

test('no locate feature when the robot does not support it', () => {
  const robot = robotFrom(discoveryMessages({ locate: false }));
  assert.ok(!robot.device.features.some((f) => f.external_id === ids.feature('locate')));
  assert.ok(!robot.commands.has(ids.feature('locate')));
});

test('no device until the vacuum entity is announced', () => {
  assert.equal(robotFrom(discoveryMessages().slice(1)), null);
});

test('the vacuum state feeds the state and the run mode', () => {
  const robot = robotFrom(discoveryMessages());
  const expected = {
    cleaning: [VACUUM_STATE.RUNNING, VACUUM_MODE.CLEANING],
    docked: [VACUUM_STATE.DOCKED, VACUUM_MODE.IDLE],
    idle: [VACUUM_STATE.STOPPED, VACUUM_MODE.IDLE],
    paused: [VACUUM_STATE.PAUSED, VACUUM_MODE.IDLE],
    returning: [VACUUM_STATE.RETURNING_TO_DOCK, VACUUM_MODE.IDLE],
    error: [VACUUM_STATE.ERROR, VACUUM_MODE.IDLE],
  };
  for (const [haState, [state, mode]] of Object.entries(expected)) {
    assert.deepEqual(
      statesOf(robot, TOPICS.vacuumState, JSON.stringify({ state: haState, fan_speed: 'max' })),
      [
        { device_feature_external_id: ids.feature('state'), state },
        { device_feature_external_id: ids.feature('run-mode'), state: mode },
      ],
    );
  }
  assert.deepEqual(statesOf(robot, TOPICS.vacuumState, '{"state":"unknown"}'), []);
  assert.deepEqual(statesOf(robot, TOPICS.vacuumState, 'garbage'), []);
});

test('sensors publish numbers, selects publish text', () => {
  const robot = robotFrom(discoveryMessages());
  assert.deepEqual(statesOf(robot, TOPICS.battery, '87'), [
    { device_feature_external_id: ids.feature('sensor-battery-level'), state: 87 },
  ]);
  assert.deepEqual(statesOf(robot, TOPICS.battery, ''), []);
  assert.deepEqual(statesOf(robot, TOPICS.fan, 'max'), [
    { device_feature_external_id: ids.feature('select-fanspeedcontrolcapability'), text: 'max' },
  ]);
  // Unhandled entity: its topic is not even routed.
  assert.equal(robot.states.has(TOPICS.wifi), false);
});

test('commands become the MQTT messages the robot announced', () => {
  const { commands } = robotFrom(discoveryMessages());
  const message = (key, value) => commands.get(ids.feature(key))(value);
  assert.deepEqual(message('run-mode', 1), { topic: TOPICS.vacuumCommand, payload: 'START' });
  assert.deepEqual(message('run-mode', 0), { topic: TOPICS.vacuumCommand, payload: 'STOP' });
  assert.deepEqual(message('dock', 1), { topic: TOPICS.vacuumCommand, payload: 'HOME' });
  assert.deepEqual(message('pause', 1), { topic: TOPICS.vacuumCommand, payload: 'PAUSE' });
  assert.deepEqual(message('locate', 1), { topic: TOPICS.vacuumCommand, payload: 'LOCATE' });
  assert.deepEqual(message('select-fanspeedcontrolcapability', 'max'), {
    topic: `${TOPICS.fan}/set`,
    payload: 'max',
  });
  assert.throws(() => message('select-fanspeedcontrolcapability', 'warp'), /Unsupported option/);
});
