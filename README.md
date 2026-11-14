# gladys-valetudo

[Gladys Assistant](https://gladysassistant.com/) external integration for robot
vacuums running [Valetudo](https://valetudo.cloud/). Local only: the robot and
Gladys talk through an MQTT broker.

Robots are discovered from the Home Assistant autodiscovery messages Valetudo
publishes, so every robot supported by Valetudo works without a list of models.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Features

State, start, stop, pause, return to dock, locate, battery, fan speed, water
and mode presets, consumables. The map, rooms, zones, dock controls and
statistics are not handled yet.

## Development

```bash
npm install
npm test              # node --test, no network
npm run lint
npm run format:check
```

To run against a Gladys instance, create a development integration in Gladys
and start with the variables it gives you:

```bash
GLADYS_HOST_API_URL="http://<gladys>:1443" \
GLADYS_INTEGRATION_TOKEN=... \
GLADYS_INTEGRATION_SELECTOR=... \
LOG_LEVEL=debug npm start
```

The broker address and credentials are entered in the integration
configuration screen in Gladys, not in environment variables.

## How it works

| File               | Role                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `src/discovery.js` | Reads the discovery messages, keeps the Valetudo robots           |
| `src/robot.js`     | Turns a robot into a Gladys device, state and command routes      |
| `src/bridge.js`    | MQTT session: subscriptions, states to Gladys, commands to robots |
| `index.js`         | SDK wiring                                                        |
