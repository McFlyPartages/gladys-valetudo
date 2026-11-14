import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Bridge, MESSAGES } from '../src/bridge.js';
import { normalizeConfig } from '../src/config.js';
import { FOREIGN_MESSAGE, IDENTIFIER, TOPICS, discoveryMessages } from './fixtures.js';

// Minimal stand-in for an mqtt.js client: no socket, everything recorded.
class FakeMqtt extends EventEmitter {
  connected = false;
  subscriptions = new Set();
  published = [];
  ended = false;

  subscribe(topics, callback) {
    for (const topic of [topics].flat()) {
      this.subscriptions.add(topic);
    }
    callback?.(null);
  }

  unsubscribe(topics) {
    for (const topic of [topics].flat()) {
      this.subscriptions.delete(topic);
    }
  }

  async publishAsync(topic, payload) {
    this.published.push({ topic, payload });
  }

  end(force, options, callback) {
    this.ended = true;
    this.connected = false;
    callback?.();
  }

  // Test helpers.
  open() {
    this.connected = true;
    this.emit('connect');
  }

  receive(topic, payload) {
    this.emit('message', topic, Buffer.from(payload));
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

async function startBridge(raw = { mqtt_url: 'broker:1883' }) {
  const gladys = createFakeGladys();
  const statuses = [];
  gladys.setConnectionStatus = async (connected, message) => {
    statuses.push({ connected, message });
  };
  const clients = [];
  const bridge = new Bridge(
    gladys,
    () => {
      const client = new FakeMqtt();
      clients.push(client);
      return client;
    },
    { debounceMs: 1 },
  );
  await bridge.start(normalizeConfig(raw));
  return { gladys, bridge, clients, statuses, ids: gladys.externalIds('robot', IDENTIFIER) };
}

async function announce(client) {
  client.open();
  for (const [topic, payload] of discoveryMessages()) {
    client.receive(topic, payload);
  }
  client.receive(...FOREIGN_MESSAGE);
  await tick();
}

test('without a broker address nothing connects and the status says why', async () => {
  const { clients, statuses } = await startBridge({});
  assert.equal(clients.length, 0);
  assert.deepEqual(statuses.at(-1), { connected: false, message: MESSAGES.notConfigured });
});

test('robots announced on the broker are published to Gladys once', async () => {
  const { gladys, bridge, clients, statuses } = await startBridge();
  const [client] = clients;
  await announce(client);

  assert.ok(client.subscriptions.has('homeassistant/+/+/+/config'));
  assert.deepEqual(statuses.at(-1), { connected: true, message: undefined });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(bridge.discoveredDevices().length, 1);
  // The whole burst of announcements leads to a single publication.
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 1);
  // Only the handled state topics are subscribed.
  assert.ok(client.subscriptions.has(TOPICS.vacuumState));
  assert.ok(client.subscriptions.has(TOPICS.battery));
  assert.ok(!client.subscriptions.has(TOPICS.wifi));
  await bridge.stop();
});

test('states reach Gladys once the device exists, and only when they change', async () => {
  const { gladys, bridge, clients, ids } = await startBridge();
  const [client] = clients;
  await announce(client);
  gladys.fake.upsertDevice(bridge.discoveredDevices()[0]);

  client.receive(TOPICS.battery, '87');
  client.receive(TOPICS.vacuumState, '{"state":"cleaning"}');
  client.receive(TOPICS.fan, 'max');
  await tick();
  assert.equal(gladys.fake.lastState(ids.feature('sensor-battery-level')), 87);
  assert.equal(gladys.fake.lastState(ids.feature('state')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('run-mode')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('select-fanspeedcontrolcapability')), 'max');

  const before = gladys.fake.bodies('POST', '/state').length;
  client.receive(TOPICS.battery, '87');
  await tick();
  assert.equal(gladys.fake.bodies('POST', '/state').length, before);
  await bridge.stop();
});

test('commands are published on the robot topics, and refused when offline', async () => {
  const { bridge, clients, ids } = await startBridge();
  const [client] = clients;
  await announce(client);

  await bridge.setValue({ external_id: ids.feature('run-mode') }, 1);
  await bridge.setValue({ external_id: ids.feature('dock') }, 1);
  assert.deepEqual(client.published, [
    { topic: TOPICS.vacuumCommand, payload: 'START' },
    { topic: TOPICS.vacuumCommand, payload: 'HOME' },
  ]);

  await assert.rejects(
    bridge.setValue({ external_id: 'ext:x:robot:nope:dock' }, 1),
    /not announced/,
  );
  client.connected = false;
  await assert.rejects(bridge.setValue({ external_id: ids.feature('dock') }, 1), /not connected/);
  await bridge.stop();
});

test('a robot removed from the broker disappears and its topics are released', async () => {
  const { gladys, bridge, clients } = await startBridge();
  const [client] = clients;
  await announce(client);
  for (const [topic] of discoveryMessages()) {
    client.receive(topic, '');
  }
  await tick();
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.ok(!client.subscriptions.has(TOPICS.vacuumState));
  await bridge.stop();
});

test('a lost broker is reported, a restart closes the previous session', async () => {
  const { bridge, clients, statuses } = await startBridge();
  const [client] = clients;
  client.open();
  client.connected = false;
  client.emit('close');
  assert.deepEqual(statuses.at(-1), { connected: false, message: MESSAGES.unreachable });

  await bridge.start(normalizeConfig({ mqtt_url: 'other:1883' }));
  assert.equal(client.ended, true);
  assert.equal(clients.length, 2);
  await bridge.stop();
});
