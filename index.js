// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration for Valetudo.
//
// This file only wires the SDK to the bridge (src/bridge.js): handlers are
// registered BEFORE connect(), all the MQTT and mapping logic lives in src/.
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK): GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import mqtt from 'mqtt';
import { Bridge } from './src/bridge.js';
import { normalizeConfig, sameBroker } from './src/config.js';

const gladys = new GladysIntegration();

const bridge = new Bridge(gladys, (config) =>
  mqtt.connect(config.mqtt_url, {
    username: config.mqtt_username || undefined,
    password: config.mqtt_password || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  }),
);

let config = null;

async function applyConfig(raw) {
  const next = normalizeConfig(raw);
  if (config && sameBroker(config, next)) {
    return;
  }
  config = next;
  await bridge.start(config);
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  await gladys.publishDiscoveredDevices(bridge.discoveredDevices());
});

// --- Command: the user acts on a controllable feature ------------------------
// A throw is acknowledged to Gladys as a failure, shown in the UI.
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await bridge.setValue(feature, value);
});

// --- Device lifecycle --------------------------------------------------------
// States sent before the user created the device were dropped by Gladys.
gladys.onDeviceCreated(() => bridge.replayStates());
gladys.onDeviceUpdated(() => bridge.replayStates());

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated((newConfig) => applyConfig(newConfig));

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await applyConfig(await gladys.getConfig());
    // After a reconnection the broker session is untouched: only refresh what
    // Gladys may have missed while the socket was down.
    await gladys.publishDiscoveredDevices(bridge.discoveredDevices());
    await bridge.replayStates();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await bridge.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Valetudo integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
