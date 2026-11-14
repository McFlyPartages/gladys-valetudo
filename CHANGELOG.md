# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Discovery of the Valetudo robots announced on an MQTT broker (Home Assistant
  autodiscovery format), whatever the model.
- Robot state, start, stop, pause, return to dock and locate.
- Battery level, fan speed, water and mode presets, consumables.
- A robot disconnected from the broker shows as unreachable, and its commands
  are refused instead of being lost.
