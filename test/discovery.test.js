import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RobotRegistry, parseDiscoveryTopic } from '../src/discovery.js';
import { FOREIGN_MESSAGE, IDENTIFIER, discoveryMessages } from './fixtures.js';

test('parseDiscoveryTopic only accepts <prefix>/<component>/<node>/<object>/config', () => {
  assert.deepEqual(
    parseDiscoveryTopic('homeassistant', 'homeassistant/vacuum/abc/abc_vacuum/config'),
    {
      component: 'vacuum',
      identifier: 'abc',
      objectId: 'abc_vacuum',
    },
  );
  assert.equal(parseDiscoveryTopic('homeassistant', 'homeassistant/vacuum/abc/config'), null);
  assert.equal(parseDiscoveryTopic('homeassistant', 'other/vacuum/abc/abc_vacuum/config'), null);
  assert.equal(
    parseDiscoveryTopic('homeassistant', 'homeassistant/vacuum/abc/abc_vacuum/state'),
    null,
  );
});

test('the registry groups the entities of a robot and ignores other devices', () => {
  const registry = new RobotRegistry();
  for (const [topic, payload] of discoveryMessages()) {
    assert.equal(registry.handleMessage(topic, payload), true);
  }
  assert.equal(registry.handleMessage(...FOREIGN_MESSAGE), false);
  assert.equal(registry.handleMessage('homeassistant/sensor/x/y/config', 'not json'), false);

  const robots = registry.list();
  assert.equal(robots.length, 1);
  assert.equal(robots[0].identifier, IDENTIFIER);
  assert.equal(robots[0].name, 'Rocky');
  assert.equal(robots[0].model, 'Roborock S5');
  assert.equal(robots[0].entities.size, discoveryMessages().length);
});

test('an identical announcement is not a change, an empty payload removes the entity', () => {
  const registry = new RobotRegistry();
  const messages = discoveryMessages();
  for (const [topic, payload] of messages) {
    registry.handleMessage(topic, payload);
  }
  assert.equal(registry.handleMessage(...messages[0]), false);

  assert.equal(registry.handleMessage(messages[1][0], ''), true);
  assert.equal(registry.handleMessage(messages[1][0], ''), false);
  assert.equal(registry.list()[0].entities.size, messages.length - 1);

  for (const [topic] of messages) {
    registry.handleMessage(topic, '');
  }
  assert.equal(registry.list().length, 0);
});

test('a custom discovery prefix is honored', () => {
  const registry = new RobotRegistry('ha');
  const [topic, payload] = discoveryMessages()[0];
  assert.equal(registry.handleMessage(topic, payload), false);
  assert.equal(registry.handleMessage(topic.replace('homeassistant/', 'ha/'), payload), true);
  assert.equal(registry.subscription, 'ha/+/+/+/config');
});
