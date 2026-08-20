# Privacy

RaGo has no application backend, account system, analytics, advertising, or telemetry.

## Moment inputs

Pictures are sampled locally into a small color/luminance/contrast trait summary. Sounds are decoded locally into energy/texture/duration traits. Raw picture and sound bytes are not written to app storage or included in a creature. Thoughts and private memory labels remain only in the local companion or capture record; the public genome receives a deterministic non-reversible trait summary instead of the raw words.

## Location

The browser provides an exact location only after the player grants permission. That point is used locally for map position, distance checks, and spawn placement. Network requests use the center of a coarse geohash cell rather than the exact point:

- weather: geohash precision 5 (a several-kilometer area)
- nearby places: geohash precision 6 (a neighborhood-scale area)

CARTO receives ordinary map-tile coordinates for the map currently in view. Open-Meteo supplies weather, and OpenStreetMap Overpass supplies public place data. Their own privacy policies apply to those requests.

## Local data

The journal and RAPPID lineages are stored in IndexedDB. Theme, satchel, cooldown, coarse cached weather/place data, and the last map position are stored locally in the browser. Clearing site data removes them.

Private founding memories are stored beside the local RAPPID profile and are never copied into RAPP/1 body frames. Offspring inherit public ancestor and parent references, not private thoughts, media, or exact locations.

## Sharing

A RAPPID link contains its public procedural genome and content id. It does not contain an account, device identifier, exact GPS coordinate, private memory, or the player's location history. Recipients verify the content id locally before they can keep it.
