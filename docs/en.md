# Valetudo

This integration adds the robot vacuums running
[Valetudo](https://valetudo.cloud/) to Gladys. Everything stays on your local
network: the robot and Gladys talk through your MQTT broker, with no cloud.

Any robot supported by Valetudo works: the integration reads what each robot
announces on the broker instead of relying on a list of models.

## What you get

One device per robot, with:

- **State**: cleaning, paused, returning to the dock, docked, stopped, error.
- **Mode**: start a cleaning, or stop it.
- **Pause** and **Return to dock** buttons.
- **Locate**: the robot plays a sound (robots that support it).
- **Battery** level.
- **Fan** speed, and **Water** and **Mode** presets when the robot has them.
- **Consumables**: remaining life of the brushes, filter and sensors, in
  percent or in minutes depending on the robot.

## Before you start

You need an MQTT broker reachable by both the robot and Gladys (Mosquitto, or
the one of Home Assistant).

In the Valetudo web interface, open **Connectivity → MQTT**, then:

1. Enable **MQTT** and enter the address of your broker (and its credentials).
2. Enable **Home Assistant autodiscovery**. Home Assistant itself is not
   needed: the integration only reads the announcement format.
3. Save.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Enter the **broker address**, for example `mqtt://192.168.1.10:1883`, and
   the username and password if your broker asks for them.
3. Save. The status turns to connected, and your robots appear in the
   **Discovery** tab, ready to be added.

## Troubleshooting

- **Broker unreachable or credentials refused**: check the address, the port
  and the credentials. Gladys must be allowed to reach the broker on your
  network (firewall, VLAN).
- **Connected, but no robot in Discovery**: check that the Home Assistant
  autodiscovery is enabled in Valetudo, and that the discovery prefix is the
  same on both sides (`homeassistant` by default).
- **The robot shows as unreachable**: Valetudo lost its connection to the
  broker (robot off, out of Wi-Fi range, MQTT disabled). Commands are refused
  until it is back.
- **A control is missing**: a robot only exposes what it can do. A robot
  without a mop has no water preset, for example.

## Not supported yet

The map, cleaning by room or by zone, the dock controls and the statistics are
not available in this version.
