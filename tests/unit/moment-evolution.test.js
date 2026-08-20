import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLineage,
  createParallelOffspring,
  createCompanionProfile,
  currentFrame,
  currentCompanion,
  evolveCompanion,
  freezeRappid,
  lineageGenerations,
  migrateLegacyProfile,
  revertCompanion,
  selectOrganism,
  selectedOrganism,
  upsertOrganism,
  validateCompanionHistory,
  validateLineage,
  wakeRappid
} from '../../src/companion/evolution.js';
import { ARCHETYPES, SPECIES_CATALOG } from '../../src/data/species.js';
import { createMomentCreature } from '../../src/lib/creature.js';
import { createMoment, momentSourceLabel, thoughtTraits } from '../../src/lib/moment.js';
import { parseRappid } from '../../src/lib/rapp.js';

const location = { lat: 40.7128, lng: -74.006 };
const weather = { temperature: 19, code: 2, wind: 7, isDay: true };
const bucket = 981_000;

function memory(overrides = {}) {
  return createMoment({
    label: 'the station goodbye',
    thought: 'I wanted this minute to last longer',
    date: 1_767_700_800_000,
    mood: 'tender',
    picture: { palette: ['#aa5544', '#334477', '#eecb99'], luma: 0.56, contrast: 0.44 },
    sound: { energy: 0.72, texture: 0.31, durationBand: 3, kind: 'audio' },
    weather,
    location,
    placeLabel: 'the southbound platform',
    ...overrides
  });
}

test('the starting field guide contains exactly 151 unique original grounded species', () => {
  assert.equal(SPECIES_CATALOG.length, 151);
  assert.equal(new Set(SPECIES_CATALOG.map((species) => species.number)).size, 151);
  assert.equal(new Set(SPECIES_CATALOG.map((species) => species.name)).size, 151);
  assert.deepEqual([...new Set(SPECIES_CATALOG.map((species) => species.archetype))].sort(), [...ARCHETYPES].sort());
  assert.equal(ARCHETYPES.includes('orbital'), false);
  assert.ok(SPECIES_CATALOG.every((species) => species.animation && species.secondaryArchetype && species.temperament));
});

test('two individuals of one species keep the blueprint but receive different hallmark traits', async () => {
  const captured = memory();
  const first = await createMomentCreature({ seed: 'individual-a', location, weather, moment: captured.publicSignal, bucket, speciesNumber: 42 });
  const second = await createMomentCreature({ seed: 'individual-b', location, weather, moment: captured.publicSignal, bucket, speciesNumber: 42 });
  assert.equal(first.speciesNumber, 42);
  assert.equal(second.speciesNumber, 42);
  assert.equal(first.species, second.species);
  assert.notEqual(first.id, second.id);
  assert.notDeepEqual(first.genome.individual, second.genome.individual);
  assert.ok(first.distinctiveTrait);
  assert.ok(second.distinctiveTrait);
});

test('thoughts become deterministic traits while raw words stay private', () => {
  const first = thoughtTraits('a thought that stays with me');
  const second = thoughtTraits('a thought that stays with me');
  assert.deepEqual(first, second);
  assert.equal(first.hash.length, 8);

  const captured = memory();
  assert.match(captured.privateMemory.thought, /minute to last/u);
  assert.doesNotMatch(JSON.stringify(captured.publicSignal), /minute to last/u);
  assert.deepEqual(captured.publicSignal.sources, ['time', 'place', 'weather', 'picture', 'sound', 'thought']);
  assert.match(momentSourceLabel(captured.publicSignal), /picture/u);
  assert.match(momentSourceLabel(captured.publicSignal), /sound/u);
});

test('picture, sound, thought, weather, place, and time all enter the moment genome', async () => {
  const captured = memory();
  const creature = await createMomentCreature({
    seed: 'multimodal-memory',
    location,
    weather,
    moment: captured.publicSignal,
    bucket,
    variant: 0,
    axis: 'whole',
    origin: 'captured-moment'
  });
  assert.deepEqual(creature.genome.moment.sources, ['time', 'place', 'weather', 'picture', 'sound', 'thought']);
  assert.deepEqual(creature.genome.surface.palette, captured.publicSignal.picture.palette);
  assert.ok(creature.genome.motion.bob > 0.7);
  assert.doesNotMatch(JSON.stringify(creature), /station goodbye|minute to last/u);
});

const identityBytes = (offset) => Uint8Array.from({ length: 16 }, (_value, index) => (offset + index * 13) & 255);

test('splicing changes selected traits while preserving RAPPID identity and RAPP/1 history', async () => {
  const foundingMemory = memory();
  const donorMemory = memory({
    label: 'rain on the roof',
    thought: 'the whole room became percussion',
    picture: { palette: ['#225588', '#44aacc', '#dceeff'], luma: 0.38, contrast: 0.69 },
    sound: { energy: 0.94, texture: 0.82, durationBand: 5, kind: 'audio' },
    mood: 'stormy'
  });
  const starter = await createMomentCreature({ seed: 'starter', location, weather, moment: foundingMemory.publicSignal, bucket, axis: 'thought', origin: 'starter' });
  const donor = await createMomentCreature({ seed: 'donor', location, weather: { ...weather, code: 95 }, moment: donorMemory.publicSignal, bucket, axis: 'sound', origin: 'captured-moment' });
  const profile = await createCompanionProfile(
    starter,
    { ...foundingMemory.privateMemory, sources: foundingMemory.publicSignal.sources },
    { now: 1_000, uuidBytes: identityBytes(1) }
  );
  const evolved = await evolveCompanion(profile, donor, ['surface', 'motion'], 2_000);
  const current = currentCompanion(evolved);

  assert.ok(parseRappid(evolved.rappid));
  assert.equal(evolved.rappid, profile.rappid);
  assert.equal(evolved.frames.length, 2);
  assert.equal(Object.keys(evolved.frames[0]).length, 11);
  assert.equal(evolved.frames[0].spec, 'rapp/1');
  assert.equal(evolved.frames[0].seq, 0);
  assert.equal(evolved.frames[1].seq, 1);
  assert.equal(evolved.frames[1].prev, evolved.frames[0].payload_hash);
  assert.notEqual(evolved.frames[0].payload.creature.id, starter.id);
  assert.notEqual(current.id, starter.id);
  assert.equal(current.genome.form.species, starter.genome.form.species);
  assert.equal(current.genome.surface.palette[0], donor.genome.surface.palette[0]);
  assert.equal(current.genome.inheritance.donor, donor.id);
  assert.deepEqual(current.genome.inheritance.traits, ['surface', 'motion']);
  assert.doesNotMatch(JSON.stringify(evolved.frames), /station goodbye|minute to last|southbound platform/u);
  assert.equal(await validateCompanionHistory(evolved), true);

  const reverted = await revertCompanion(evolved, evolved.frames[0].frame_hash, 3_000);
  assert.equal(reverted.frames.length, 3);
  assert.equal(currentCompanion(reverted).id, evolved.frames[0].payload.creature.id);
  assert.equal(reverted.rappid, profile.rappid);
  assert.equal(await validateCompanionHistory(reverted), true);

  reverted.frames[1].payload.creature.name = 'tampered';
  assert.equal(await validateCompanionHistory(reverted), false);
});

test('quantum drill creates parallel RAPPID offspring with independent latest heads', async () => {
  const foundingMemory = memory();
  const starter = await createMomentCreature({
    seed: 'lineage-starter',
    location,
    weather,
    moment: foundingMemory.publicSignal,
    bucket,
    axis: 'thought',
    origin: 'starter'
  });
  const root = await createCompanionProfile(
    starter,
    { ...foundingMemory.privateMemory, sources: foundingMemory.publicSignal.sources },
    { now: 10_000, uuidBytes: identityBytes(2) }
  );
  const children = await createParallelOffspring(root, ['memory', 'context', 'purpose'], 3, {
    now: 20_000,
    uuidBytes: [identityBytes(3), identityBytes(4), identityBytes(5)]
  });

  assert.equal(children.length, 3);
  assert.equal(new Set(children.map((child) => child.rappid)).size, 3);
  assert.ok(children.every((child) => child.rappid !== root.rappid));
  assert.ok(children.every((child) => child.generation === 1));
  assert.ok(children.every((child) => child.parent.rappid === root.rappid));
  assert.ok(children.every((child) => child.parent.frameHash === root.head));
  assert.ok(children.every((child) => child.ancestor.objectHash === root.ancestor.objectHash));
  assert.equal(new Set(children.map((child) => currentCompanion(child).id)).size, 3);
  assert.ok((await Promise.all(children.map(validateCompanionHistory))).every(Boolean));

  let lineage = createLineage(root);
  for (const child of children) lineage = upsertOrganism(lineage, child, { select: false });
  lineage = selectOrganism(lineage, children[1].rappid);
  assert.equal(selectedOrganism(lineage).rappid, children[1].rappid);
  assert.equal(lineageGenerations(lineage).length, 2);
  assert.equal(lineageGenerations(lineage)[1].organisms.length, 3);
  assert.equal(await validateLineage(lineage), true);

  const frozen = await freezeRappid(children[1], 30_000);
  assert.equal(frozen.status, 'frozen');
  assert.equal(currentFrame(frozen).payload.event, 'freeze');
  const awake = await wakeRappid(frozen, 40_000);
  assert.equal(awake.status, 'awake');
  assert.equal(currentFrame(awake).payload.mutation.resumedFrom, frozen.head);
  assert.equal(await validateCompanionHistory(awake), true);
});

test('legacy companion history migrates into one RAPPID stream without leaking private memory', async () => {
  const foundingMemory = memory();
  const first = await createMomentCreature({
    seed: 'legacy-first',
    location,
    weather,
    moment: foundingMemory.publicSignal,
    bucket,
    origin: 'starter'
  });
  const second = await createMomentCreature({
    seed: 'legacy-second',
    location,
    weather,
    moment: foundingMemory.publicSignal,
    bucket,
    origin: 'companion'
  });
  const legacy = {
    schema: 'rapp-go-companion/1.0',
    companionId: 'legacy-companion',
    createdAt: 50_000,
    memory: foundingMemory.privateMemory,
    frames: [
      { sha: 'old-a', prev: '', at: 50_000, kind: 'birth', note: 'private start', creature: first },
      { sha: 'old-b', prev: 'old-a', at: 60_000, kind: 'splice', note: 'old change', creature: second }
    ]
  };
  const migrated = await migrateLegacyProfile(legacy, { now: 70_000 });
  assert.ok(parseRappid(migrated.rappid));
  assert.equal(migrated.frames.length, 2);
  assert.equal(migrated.frames[1].prev, migrated.frames[0].payload_hash);
  assert.equal(currentCompanion(migrated).genome.rappid.glowTier, migrated.frames[0].payload.alleles.glow.tier.name);
  assert.doesNotMatch(JSON.stringify(migrated.frames), /station goodbye|minute to last|southbound platform/u);
  assert.equal(await validateCompanionHistory(migrated), true);
});
