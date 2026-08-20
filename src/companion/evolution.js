import { allelesForRappid } from '../lib/allele.js';
import { sha256Hex, stableStringify } from '../lib/creature.js';
import {
  createRappFrame,
  localObjectHash,
  mintLocalRappid,
  nextRappFrame,
  parseRappid,
  rappidTail,
  verifyRappFrame
} from '../lib/rapp.js';
import { createRng } from '../lib/rng.js';

export const RAPPID_PROFILE_SCHEMA = 'rago-rappid/2.0';
export const LINEAGE_SCHEMA = 'rago-lineage/2.0';

export const MUTATION_DIMENSIONS = Object.freeze([
  Object.freeze({ key: 'identity', label: 'identity', description: 'a fresh mint-once RAPPID and voice' }),
  Object.freeze({ key: 'memory', label: 'memory', description: 'which public engrams influence the branch' }),
  Object.freeze({ key: 'capabilities', label: 'capabilities', description: 'eyes, appendages, and physical reach' }),
  Object.freeze({ key: 'context', label: 'context', description: 'palette, finish, and environmental expression' }),
  Object.freeze({ key: 'purpose', label: 'purpose', description: 'gait, tempo, and behavioral direction' }),
  Object.freeze({ key: 'embodiment', label: 'embodiment', description: 'proportions, silhouette, and hallmark form' })
]);
const DIMENSION_KEYS = new Set(MUTATION_DIMENSIONS.map((dimension) => dimension.key));
const clone = (value) => structuredClone(value);

function cleanPublicCreature(creature) {
  return clone(creature);
}

function publicAlleles(alleles) {
  return Object.fromEntries(Object.entries(alleles).map(([key, allele]) => [
    key,
    {
      value: allele.value,
      bits: allele.bits,
      hex: allele.hex,
      tier: allele.tier ? { ...allele.tier } : null
    }
  ]));
}

function rotateHex(hex, amount) {
  const value = parseInt(String(hex || '#6688aa').slice(1), 16);
  const red = value >> 16 & 255;
  const green = value >> 8 & 255;
  const blue = value & 255;
  const shift = Math.max(1, Math.round(amount * 127));
  const channel = (number) => (number % 256).toString(16).padStart(2, '0');
  return `#${channel(green + shift)}${channel(blue + shift * 2)}${channel(red + shift * 3)}`;
}

function wrap(value, minimum, maximum, amount) {
  const span = maximum - minimum;
  const base = Math.max(minimum, Math.min(maximum, Number(value) || minimum));
  return Math.round((minimum + ((base - minimum + amount) % span)) * 1_000) / 1_000;
}

async function bindRappid(creature, rappid, lineage = null) {
  const bound = cleanPublicCreature(creature);
  const alleles = await allelesForRappid(rappid);
  const tail = rappidTail(rappid);
  const rng = createRng(`rappid-body:${tail}`);
  bound.genome.rappid = {
    tailHint: `${tail.slice(0, 8)}…${tail.slice(-8)}`,
    coat: alleles.coat.value,
    tempo: alleles.tempo.value,
    voice: alleles.voice.value,
    glow: alleles.glow.value,
    glowTier: alleles.glow.tier.name
  };
  bound.genome.surface.palette = bound.genome.surface.palette.map((color, index) =>
    rotateHex(color, 0.08 + (alleles.coat.value / 255) * 0.18 + index * 0.03)
  );
  bound.genome.surface.glow = {
    common: 0.18,
    uncommon: 0.32,
    rare: 0.5,
    ultra: 0.72,
    mythic: 0.94
  }[alleles.glow.tier.name];
  bound.genome.motion.pulse = Math.round((0.8 + alleles.tempo.value / 255 * 2.2) * 1_000) / 1_000;
  bound.genome.form.voiceAllele = alleles.voice.value;
  if (lineage) bound.genome.lineage = clone(lineage);
  bound.id = (await sha256Hex(stableStringify(bound.genome))).slice(0, 16);
  bound.rarity = alleles.glow.tier.name;
  bound.distinctiveTrait = bound.distinctiveTrait || `RAPPID ${tail.slice(0, 6)}`;
  bound.name = lineage?.generation
    ? `${creature.name.split(' · ')[0]} · ${tail.slice(0, 4).toUpperCase()}`
    : creature.name;
  return { creature: bound, alleles: publicAlleles(alleles), rng };
}

function normalizedDimensions(dimensions) {
  const selected = [...new Set(dimensions || [])];
  if (!selected.length) throw new TypeError('Select at least one dimension');
  const invalid = selected.filter((dimension) => !DIMENSION_KEYS.has(dimension));
  if (invalid.length) throw new TypeError(`Unknown mutation dimension: ${invalid.join(', ')}`);
  return selected;
}

async function mutateOffspringCreature(parentCreature, rappid, dimensions, lineage) {
  const { creature, alleles, rng } = await bindRappid(parentCreature, rappid, lineage);
  const genome = creature.genome;
  for (const dimension of dimensions) {
    if (dimension === 'memory') {
      genome.moment = {
        ...genome.moment,
        sources: [...new Set([...(genome.moment?.sources || []), 'lineage'])]
      };
      genome.surface.markingDensity = wrap(genome.surface.markingDensity, 0.1, 0.96, 0.11 + rng() * 0.18);
    } else if (dimension === 'capabilities') {
      genome.form.appendages = (Number(genome.form.appendages) + 1 + Math.floor(rng() * 3)) % 9;
      genome.form.eyes = 1 + ((Number(genome.form.eyes) - 1 + 1 + Math.floor(rng() * 3)) % 4);
      genome.form.limbScale = wrap(genome.form.limbScale, 0.5, 1.8, 0.13 + rng() * 0.24);
    } else if (dimension === 'context') {
      genome.surface.palette = genome.surface.palette.map((color, index) => rotateHex(color, 0.22 + rng() * 0.45 + index * 0.04));
      genome.surface.finish = ['velvet', 'matte', 'pearl', 'stone', 'glass', 'bark', 'satin', 'speckled'][
        (Math.floor(rng() * 8) + 1) % 8
      ];
    } else if (dimension === 'purpose') {
      genome.motion.bob = wrap(genome.motion.bob, 0.25, 2.2, 0.17 + rng() * 0.28);
      genome.motion.sway = wrap(genome.motion.sway, 0.2, 2.1, 0.13 + rng() * 0.31);
      genome.motion.pulse = wrap(genome.motion.pulse, 0.5, 4.2, 0.21 + rng() * 0.42);
    } else if (dimension === 'embodiment') {
      genome.individual.stature = wrap(genome.individual.stature, 0.65, 1.45, 0.08 + rng() * 0.17);
      genome.individual.headScale = wrap(genome.individual.headScale, 0.65, 1.5, 0.07 + rng() * 0.16);
      genome.individual.tailCurl = wrap(genome.individual.tailCurl, -1, 1.01, 0.23 + rng() * 0.4);
      genome.form.headRatio = wrap(genome.form.headRatio, 0.45, 1.7, 0.09 + rng() * 0.18);
    }
  }
  creature.id = (await sha256Hex(stableStringify(genome))).slice(0, 16);
  return { creature, alleles };
}

function framePayload({ event, creature, ancestor, generation, parent, mutation, alleles }) {
  return {
    event,
    creature: cleanPublicCreature(creature),
    ancestor: clone(ancestor),
    generation,
    parent: clone(parent),
    mutation: clone(mutation),
    alleles: clone(alleles)
  };
}

export function currentFrame(profile) {
  return profile?.frames?.find((frame) => frame.frame_hash === profile.head) || profile?.frames?.at(-1) || null;
}

export function currentCompanion(profile) {
  return currentFrame(profile)?.payload?.creature || null;
}

export async function createCompanionProfile(starter, memory, {
  now = Date.now(),
  uuidBytes = null
} = {}) {
  const rappid = await mintLocalRappid(starter.genome.form?.speciesKey || starter.species || 'starter', { uuidBytes });
  const ancestor = {
    objectHash: await localObjectHash(starter),
    creatureId: starter.id,
    speciesKey: starter.genome.form?.speciesKey || null,
    object: cleanPublicCreature(starter)
  };
  const { creature, alleles } = await bindRappid(starter, rappid, {
    ancestorHash: ancestor.objectHash,
    parentRappid: null,
    parentFrame: null,
    generation: 0,
    dimensions: []
  });
  const frame = await createRappFrame({
    streamId: rappid,
    utc: new Date(now).toISOString(),
    payload: framePayload({
      event: 'birth',
      creature,
      ancestor,
      generation: 0,
      parent: null,
      mutation: null,
      alleles
    })
  });
  return {
    schema: RAPPID_PROFILE_SCHEMA,
    rappid,
    authority: 'unlinked',
    ancestor,
    generation: 0,
    parent: null,
    status: 'awake',
    createdAt: now,
    memory: clone(memory),
    frames: [frame],
    head: frame.frame_hash,
    localNotes: {
      [frame.frame_hash]: `born from ${memory.label || 'a private founding memory'}`
    }
  };
}

export async function spliceCreature(primary, donor, traits = ['surface'], seed = '') {
  const selected = traits.length ? traits : ['surface'];
  const rng = createRng(seed || `${primary.id}×${donor.id}`);
  const genome = clone(primary.genome);
  const blendNumber = (base, incoming) => {
    if (!Number.isFinite(base)) return incoming;
    if (!Number.isFinite(incoming)) return base;
    const choice = rng();
    if (choice < 0.28) return incoming;
    if (choice < 0.55) return base * 0.35 + incoming * 0.65;
    return (base + incoming) / 2;
  };
  const pickDifferent = (base, incoming) => base === incoming ? incoming : (rng() < 0.38 ? base : incoming);
  if (selected.includes('form')) {
    const result = { ...genome.form };
    for (const key of new Set([...Object.keys(genome.form), ...Object.keys(donor.genome.form)])) {
      if (['species', 'lobes', 'eyes', 'appendages'].includes(key)) result[key] = pickDifferent(genome.form[key], donor.genome.form[key]);
      else if (typeof donor.genome.form[key] === 'number') result[key] = blendNumber(genome.form[key], donor.genome.form[key]);
      else if (donor.genome.form[key] !== undefined && rng() > 0.45) result[key] = donor.genome.form[key];
    }
    result.species = donor.genome.form.species || result.species;
    genome.form = result;
  }
  if (selected.includes('surface')) {
    const basePalette = genome.surface.palette || [];
    const donorPalette = donor.genome.surface.palette || [];
    const length = Math.max(basePalette.length, donorPalette.length, 3);
    genome.surface = {
      ...genome.surface,
      palette: Array.from({ length }, (_, index) => {
        if (index === 0 && donorPalette.length) return donorPalette[index % donorPalette.length];
        return rng() < 0.45
          ? basePalette[index % Math.max(1, basePalette.length)] || donorPalette[index % donorPalette.length]
          : donorPalette[index % Math.max(1, donorPalette.length)] || basePalette[index % basePalette.length];
      }),
      pattern: donor.genome.surface.pattern || genome.surface.pattern,
      glow: blendNumber(genome.surface.glow, donor.genome.surface.glow)
    };
  }
  if (selected.includes('motion')) {
    const result = { ...genome.motion };
    for (const key of new Set([...Object.keys(genome.motion), ...Object.keys(donor.genome.motion)])) {
      result[key] = typeof donor.genome.motion[key] === 'number'
        ? blendNumber(genome.motion[key], donor.genome.motion[key])
        : (genome.motion[key] ?? donor.genome.motion[key]);
    }
    genome.motion = result;
  }
  genome.inheritance = {
    ...(genome.inheritance || {}),
    donor: donor.id,
    traits: selected
  };
  const id = (await sha256Hex(stableStringify(genome))).slice(0, 16);
  return {
    ...clone(primary),
    id,
    species: genome.form.species || primary.species,
    speciesNumber: genome.form.speciesNumber || primary.speciesNumber,
    distinctiveTrait: genome.form.signatureTrait || primary.distinctiveTrait,
    genome,
    origin: 'rappid'
  };
}

async function appendProfileFrame(profile, creature, event, mutation, now, localNote) {
  const head = currentFrame(profile);
  const frame = await nextRappFrame(head, framePayload({
    event,
    creature,
    ancestor: profile.ancestor,
    generation: profile.generation,
    parent: profile.parent,
    mutation,
    alleles: head.payload.alleles
  }), { now });
  return {
    ...clone(profile),
    status: event === 'freeze' ? 'frozen' : 'awake',
    frames: [...clone(profile.frames), frame],
    head: frame.frame_hash,
    localNotes: {
      ...(profile.localNotes || {}),
      [frame.frame_hash]: localNote
    }
  };
}

export async function evolveCompanion(profile, donor, traits, now = Date.now()) {
  const primary = currentCompanion(profile);
  if (!primary) throw new Error('A primary RAPPID is required before splicing');
  const head = currentFrame(profile);
  const seed = `${primary.id}×${donor.id}×${head.frame_hash}`;
  const evolved = await spliceCreature(primary, donor, traits, seed);
  return appendProfileFrame(
    profile,
    evolved,
    'splice',
    { dimensions: [...traits], donorId: donor.id },
    now,
    `absorbed ${traits.join(' + ')} from ${donor.name}`
  );
}

export async function revertCompanion(profile, targetHash, now = Date.now()) {
  const target = profile.frames.find((frame) => frame.frame_hash === targetHash);
  if (!target) throw new Error('That RAPPID frame does not exist');
  return appendProfileFrame(
    profile,
    target.payload.creature,
    'revert',
    { targetFrame: targetHash },
    now,
    `returned to frame ${targetHash.slice(0, 8)}`
  );
}

export async function freezeRappid(profile, now = Date.now()) {
  if (profile.status === 'frozen') throw new Error('This RAPPID is already frozen');
  return appendProfileFrame(profile, currentCompanion(profile), 'freeze', null, now, 'frozen at this head');
}

export async function wakeRappid(profile, now = Date.now()) {
  if (profile.status !== 'frozen') throw new Error('Only a frozen RAPPID can wake');
  return appendProfileFrame(profile, currentCompanion(profile), 'wake', { resumedFrom: profile.head }, now, 'woke from its latest head');
}

export async function createOffspringProfile(parent, dimensions, {
  now = Date.now(),
  uuidBytes = null
} = {}) {
  const selected = normalizedDimensions(dimensions);
  const parentCreature = currentCompanion(parent);
  const parentFrame = currentFrame(parent);
  const rappid = await mintLocalRappid(`${parentCreature.genome.form?.speciesKey || parentCreature.species}-g${parent.generation + 1}`, { uuidBytes });
  const lineage = {
    ancestorHash: parent.ancestor.objectHash,
    parentRappid: parent.rappid,
    parentFrame: parent.head,
    generation: parent.generation + 1,
    dimensions: selected
  };
  const { creature, alleles } = await mutateOffspringCreature(parentCreature, rappid, selected, lineage);
  const parentRef = {
    rappid: parent.rappid,
    frameHash: parent.head,
    creatureId: parentCreature.id
  };
  const frame = await createRappFrame({
    streamId: rappid,
    utc: new Date(now).toISOString(),
    payload: framePayload({
      event: 'birth',
      creature,
      ancestor: parent.ancestor,
      generation: parent.generation + 1,
      parent: parentRef,
      mutation: { dimensions: selected },
      alleles
    })
  });
  return {
    schema: RAPPID_PROFILE_SCHEMA,
    rappid,
    authority: 'unlinked',
    ancestor: clone(parent.ancestor),
    generation: parent.generation + 1,
    parent: parentRef,
    status: 'awake',
    createdAt: now,
    memory: {
      label: `offspring of ${parentCreature.name}`,
      thought: '',
      sources: ['lineage'],
      mediaReleased: true
    },
    frames: [frame],
    head: frame.frame_hash,
    localNotes: {
      [frame.frame_hash]: `branched through ${selected.join(' + ')}`
    }
  };
}

export async function createParallelOffspring(parent, dimensions, count = 3, options = {}) {
  const total = Math.max(1, Math.min(6, Number(count) || 1));
  return Promise.all(Array.from({ length: total }, (_, index) => createOffspringProfile(parent, dimensions, {
    ...options,
    now: Number(options.now ?? Date.now()) + index,
    uuidBytes: options.uuidBytes?.[index] || null
  })));
}

export function createLineage(root) {
  return {
    schema: LINEAGE_SCHEMA,
    ancestorHash: root.ancestor.objectHash,
    selectedRappid: root.rappid,
    organisms: [clone(root)]
  };
}

export function selectedOrganism(lineage) {
  return lineage?.organisms?.find((organism) => organism.rappid === lineage.selectedRappid)
    || lineage?.organisms?.[0]
    || null;
}

export function upsertOrganism(lineage, organism, { select = true } = {}) {
  const organisms = (lineage?.organisms || []).filter((item) => item.rappid !== organism.rappid);
  organisms.push(clone(organism));
  return {
    schema: LINEAGE_SCHEMA,
    ancestorHash: lineage?.ancestorHash || organism.ancestor.objectHash,
    selectedRappid: select ? organism.rappid : (lineage?.selectedRappid || organism.rappid),
    organisms
  };
}

export function selectOrganism(lineage, rappid) {
  if (!lineage?.organisms?.some((organism) => organism.rappid === rappid)) {
    throw new Error('That RAPPID is not in this lineage');
  }
  return { ...clone(lineage), selectedRappid: rappid };
}

export function lineageGenerations(lineage) {
  const generations = [];
  for (const organism of lineage?.organisms || []) {
    if (!generations[organism.generation]) generations[organism.generation] = [];
    generations[organism.generation].push(organism);
  }
  return generations.map((organisms, generation) => ({ generation, organisms: organisms || [] }));
}

export async function validateCompanionHistory(profile) {
  if (!profile || profile.schema !== RAPPID_PROFILE_SCHEMA || !parseRappid(profile.rappid)) return false;
  if (await localObjectHash(profile.ancestor.object) !== profile.ancestor.objectHash) return false;
  let head = null;
  for (const frame of profile.frames || []) {
    const result = await verifyRappFrame(frame, { expectedStreamId: profile.rappid, head });
    if (result.errors.length) return false;
    head = frame;
  }
  if (!head || head.frame_hash !== profile.head) return false;
  const privateStrings = [profile.memory?.label, profile.memory?.thought, profile.memory?.placeLabel]
    .filter((value) => typeof value === 'string' && value.trim().length > 3);
  const publicFrames = stableStringify(profile.frames);
  if (privateStrings.some((value) => publicFrames.includes(value))) return false;
  return true;
}

export async function validateLineage(lineage) {
  if (!lineage || lineage.schema !== LINEAGE_SCHEMA || !Array.isArray(lineage.organisms) || !lineage.organisms.length) return false;
  if (!lineage.organisms.some((organism) => organism.rappid === lineage.selectedRappid)) return false;
  if (!lineage.organisms.every((organism) => organism.ancestor.objectHash === lineage.ancestorHash)) return false;
  return (await Promise.all(lineage.organisms.map(validateCompanionHistory))).every(Boolean);
}

export async function migrateLegacyProfile(legacy, { now = Date.now() } = {}) {
  const frames = legacy?.frames || [];
  const starter = frames[0]?.creature;
  if (!starter) throw new Error('Legacy companion has no founding creature');
  let profile = await createCompanionProfile(starter, legacy.memory || {
    label: 'the moment I began',
    thought: '',
    sources: ['time', 'place', 'weather'],
    mediaReleased: true
  }, { now: Number(legacy.createdAt || frames[0]?.at || now) });
  for (const oldFrame of frames.slice(1)) {
    if (!oldFrame.creature) continue;
    const rebound = await bindRappid(oldFrame.creature, profile.rappid, {
      ancestorHash: profile.ancestor.objectHash,
      parentRappid: null,
      parentFrame: null,
      generation: 0,
      dimensions: []
    });
    profile = await appendProfileFrame(
      profile,
      rebound.creature,
      oldFrame.kind === 'revert' ? 'revert' : 'splice',
      { migratedFrom: oldFrame.sha || null },
      Math.max(Number(oldFrame.at || now), new Date(currentFrame(profile).utc).getTime()),
      oldFrame.note || 'migrated legacy frame'
    );
  }
  return profile;
}
