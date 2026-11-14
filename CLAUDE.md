# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for robot vacuums running
[Valetudo](https://valetudo.cloud/): a Node.js service (Node 22+, ESM, no build
step) that runs in its own sandboxed Docker container. It talks to Gladys
through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the robots through an MQTT broker (`mqtt`), the only two runtime
dependencies. It started from the official JavaScript template.

Robots are never listed by model: everything comes from the Home Assistant
autodiscovery messages Valetudo publishes (`backend/lib/mqtt/homeassistant` in
the Valetudo sources is the reference for their shape).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/robot.test.js            # one file
node --test --test-name-pattern "robot"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/discovery.js                  RobotRegistry: discovery messages -> robots and their entities
src/robot.js                      one robot -> one Gladys device + state/command routing tables
src/bridge.js                     MQTT session (client injected): subscriptions, states, commands
gladys-assistant-integration.json manifest: name, config_schema, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake MQTT client
test/fixtures.js                  discovery messages shaped like Valetudo's
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

Adding an entity type means adding a mapper to `MAPPERS` in `src/robot.js`
(features, state readers, command builders) and its announcement to
`test/fixtures.js`.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
