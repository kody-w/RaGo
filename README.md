# RaGo

[![RaGo v2](https://img.shields.io/endpoint?url=https://kody-w.github.io/RaGo/api/v1/badge.json)](https://kody-w.github.io/RaGo/)

**RAPPID Go.** A private, no-backend 3D field for meeting RAPPIDs, choosing a starter, capturing moments, evolving individuals, and growing parallel offspring lineages.

- **Live app:** https://kody-w.github.io/RaGo/
- **Deterministic demo:** https://kody-w.github.io/RaGo/?demo=1&reset=1

## What was rebuilt

Version 2.2 is the standalone RAPPID lineage release. It preserves the moment/genome field while making RAPPID identity, frames, starters, and offspring the explicit game.

The new repository includes:

- a low-angle, perspective Three.js world that keeps real CARTO/OpenStreetMap streets as its geographic ground
- actual animated 3D creature rigs standing at geographic positions on the map—no flat creature markers
- deterministic moment genomes derived from any combination of thought, picture, sound, time, place, mood, and weather
- an original field-guide introduction that teaches identity, frames, and offspring before the player chooses one of three starter RAPPIDs
- a private starter bond; raw image/audio bytes are reduced to traits and released
- canonical mint-once RAPPID identities with honest coat, tempo, voice, and glow alleles
- exact eleven-key RAPP/1 body frames with per-organism latest-head pointers
- trait-wise RAPPID evolution: captured beings can splice form, surface, and/or motion into the selected body
- Quantum Drill branching across identity, memory, capabilities, context, purpose, and embodiment
- parallel offspring with fresh RAPPIDs and alleles, shared ancestor-object proof, explicit parent provenance, and independent freeze/wake streams
- real-time Three.js/WebGL geometry with perspective, flat-shaded meshes, dynamic lights, ground shadows, orbit controls, breathing, gait, and articulated parts
- **151 original starting species** across twelve grounded body plans, each with a stable field-guide number and animation rig
- moment-derived individual traits—proportions, markings, finish, asymmetry, crest, tail, ears, gait, and a hallmark feature—so same-species catches are not clones
- a three-wobble catch model with vessel, offering, rarity, and flee modifiers
- public OpenStreetMap Overpass places with range checks, cooldowns, deterministic drops, and lures
- an IndexedDB field journal plus local-only satchel and preferences
- content-addressed creature links that are verified before import
- `hologram-cartridge/1.0` export into [rapp-lantern](https://github.com/kody-w/rapp-lantern)
- deterministic demo, fixed-coordinate, and live-geolocation modes
- service-worker offline shell caching and an installable web manifest
- unit and browser-level end-to-end coverage in CI

The deployed machine-readable field guide is available at [`api/v1/species.json`](https://kody-w.github.io/RaGo/api/v1/species.json).

## Privacy model

Exact GPS is used only in the browser for distance and map placement. Weather requests use the center of a precision-5 geohash; place requests use a precision-6 geohash cell. There is no app backend, account, telemetry, ad system, or server inventory. See [PRIVACY.md](PRIVACY.md).

## Run locally

Requires Node.js 20 or later.

```sh
npm install
npx playwright install chromium
npm run serve
```

Open http://127.0.0.1:4173/?demo=1&reset=1.

## Validate

```sh
npm test
npm run test:e2e
npm run build
```

`npm run check` runs all three stages. GitHub Actions repeats the same checks before deploying `dist/` to Pages.

## Test modes

| URL option | Behavior |
| --- | --- |
| `?demo=1` | Fixed weather, location, places, time, and guaranteed first demo catch |
| `?fix=LAT,LNG` | Use a desktop-friendly fixed coordinate after onboarding |
| `?t=EPOCH_MS` | Pin the 30-minute creature field bucket |
| `?reset=1` | Clear only RaGo's local browser state before boot |

## Architecture

```text
src/
  app.js                  UI state machine and complete journey
  companion/              RAPPID identity, frames, splice/revert, offspring
  data/                   151 deterministic species blueprints
  game/                   catch, economy, and spawn rules
  lib/                    moment signals, geo, RNG, identity, sharing, Lantern export
  services/               local storage, weather, and place adapters
  ui/                     tilted WebGL map and shared procedural 3D anatomy engine
tests/
  unit/                   deterministic rule tests
  e2e/                    mobile and desktop browser journeys
```

Legacy `rapp-go-*` schema and storage tokens remain readable to preserve existing public creatures and local saves; new product metadata and UI use RaGo. Map tiles are © OpenStreetMap contributors and © CARTO. Public place data is © OpenStreetMap contributors. Code is available under the [MIT License](LICENSE).
