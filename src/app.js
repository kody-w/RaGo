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
  wakeRappid
} from './companion/evolution.js';
import { rollCatch, throwQuality } from './game/catch.js';
import {
  ITEMS,
  activateLure,
  inventoryCount,
  isLured,
  placeStatus,
  spendItem,
  spinPlace
} from './game/economy.js';
import { generateSpawns } from './game/spawns.js';
import {
  createCreature,
  createMomentCreature,
  decodeCreatureToken,
  encodeCreatureToken,
  toLanternCartridge,
  weatherLabel
} from './lib/creature.js';
import { geohashEncode, normalizeLocation, offsetLocation } from './lib/geo.js';
import { analyzeImage, analyzeSound, createMoment, momentIcon, momentSourceLabel } from './lib/moment.js';
import { hashString, secureRandom } from './lib/rng.js';
import { getPlaces } from './services/places.js';
import { CollectionStore, CompanionStore, JsonStore, resetStoredApp } from './services/storage.js';
import { DEMO_WEATHER, getWeather } from './services/weather.js';
import { CanvasMap } from './ui/canvas-map.js';
import { CreatureRenderer, drawCreatureFrame } from './ui/creature-renderer.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO_LOCATION = { lat: 40.7128, lng: -74.006, accuracy: 7 };
const DEMO_TIME = 1_767_700_800_000;
const fixedTime = Number(params.get('t'));
const sessionNow = () => Number.isFinite(fixedTime) && fixedTime > 0
  ? fixedTime
  : (state.demo ? DEMO_TIME : Date.now());
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (params.get('reset') === '1') await resetStoredApp();

const store = new JsonStore();
const collectionStore = new CollectionStore();
const companionStore = new CompanionStore();
const state = {
  demo: params.get('demo') === '1',
  location: null,
  weather: null,
  places: [],
  spawns: [],
  collection: [],
  companion: null,
  lineage: null,
  inventory: store.getInventory(),
  spinState: store.get('spins', {}),
  lureState: store.get('lures', {}),
  suppressed: new Set(),
  selectedSpawn: null,
  selectedPlace: null,
  selectedOrb: null,
  ringStartedAt: 0,
  encounterRenderer: null,
  starterRenderers: [],
  companionRenderer: null,
  encounterBusy: false,
  lastCaught: null,
  spliceDonor: null,
  shareCreature: null,
  importCreature: null,
  pendingImport: null
};

const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
const map = new CanvasMap($('world-map'), {
  center: DEMO_LOCATION,
  theme,
  onMarker: (marker) => marker.type === 'creature' ? openEncounter(marker.spawn) : openPlace(marker.place)
});

function parseFixedLocation() {
  const raw = params.get('fix');
  if (!raw) return null;
  const [lat, lng] = raw.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { ...normalizeLocation({ lat, lng }), accuracy: 8 };
}

function formatDistance(distance) {
  if (distance < 1_000) return `${Math.max(1, Math.round(distance))} m`;
  return `${(distance / 1_000).toFixed(1)} km`;
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function speciesLabel(creature) {
  const number = String(creature.speciesNumber || creature.genome.form?.speciesNumber || 0).padStart(3, '0');
  return `#${number}/151 · ${creature.species}`;
}

function placeGlyph(kind) {
  return { water: '≈', nature: '⌁', landmark: '◇', civic: '▦', rest: '·' }[kind] || '·';
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

let toastTimer = null;
function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2_800);
}

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('theme-button').textContent = dark ? '☾' : '☀';
  $('theme-button').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#09120f' : '#e9f0e8';
  map.setTheme(dark ? 'dark' : 'light');
}

function persistInventory() {
  store.set('inventory', state.inventory);
  updateCounts();
}

function updateCounts() {
  $('bag-count').textContent = inventoryCount(state.inventory);
  $('collection-count').textContent = state.collection.length;
  $('generation-count').textContent = state.companion?.generation || 0;
  $('lineage-count').textContent = state.lineage?.organisms?.length || 0;
}

async function persistOrganism(profile, { select = true } = {}) {
  state.lineage = state.lineage
    ? upsertOrganism(state.lineage, profile, { select })
    : createLineage(profile);
  state.companion = selectedOrganism(state.lineage);
  await companionStore.setLineage(state.lineage);
  updateCounts();
  return state.companion;
}

async function chooseRappid(rappid) {
  state.lineage = selectOrganism(state.lineage, rappid);
  state.companion = selectedOrganism(state.lineage);
  await companionStore.setLineage(state.lineage);
  renderCompanion();
  renderLineage();
}

function updateWeatherPill() {
  if (!state.weather) return;
  const label = weatherLabel(state.weather);
  const source = state.weather.source === 'offline' ? ' · offline sky' : '';
  $('weather-pill').innerHTML = `<span aria-hidden="true">${state.weather.isDay ? '◌' : '☾'}</span>${Math.round(state.weather.temperature)}° · ${label}${source}`;
  $('privacy-pill').textContent = state.demo ? 'private demo field' : 'coarse-area weather';
}

function markerData() {
  const creatures = state.spawns
    .filter((spawn) => !state.suppressed.has(spawn.id))
    .map((spawn, index) => ({
      type: 'creature',
      id: spawn.id,
      lat: spawn.lat,
      lng: spawn.lng,
      spawn,
      creature: spawn.creature,
      phase: hashString(spawn.id) % 100 / 10 + index
    }));
  const places = state.places.map((place, index) => ({
    type: 'place',
    id: place.id,
    lat: place.lat,
    lng: place.lng,
    place,
    phase: hashString(place.id) % 100 / 10 + index
  }));
  return [...places, ...creatures];
}

function makeNearbyCard(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nearby-card';
  const visual = item.type === 'creature' ? document.createElement('canvas') : document.createElement('span');
  if (item.type === 'creature') {
    visual.width = 80;
    visual.height = 80;
    visual.dataset.creatureId = item.spawn.creature.id;
    visual.setAttribute('aria-hidden', 'true');
  } else {
    visual.className = 'nearby-symbol';
    visual.textContent = placeGlyph(item.place.kind);
    visual.setAttribute('aria-hidden', 'true');
  }
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  const detail = document.createElement('small');
  if (item.type === 'creature') {
    title.textContent = item.spawn.creature.name;
    detail.textContent = `${formatDistance(item.spawn.distanceM)} · #${String(item.spawn.creature.speciesNumber || 0).padStart(3, '0')}`;
    button.setAttribute('aria-label', `Encounter ${item.spawn.creature.name}, ${formatDistance(item.spawn.distanceM)} away`);
    button.addEventListener('click', () => openEncounter(item.spawn));
  } else {
    title.textContent = item.place.name;
    detail.textContent = `${formatDistance(item.place.distanceM)} · ${item.place.kind}`;
    button.setAttribute('aria-label', `Visit ${item.place.name}, ${formatDistance(item.place.distanceM)} away`);
    button.addEventListener('click', () => openPlace(item.place));
  }
  copy.append(title, detail);
  button.append(visual, copy);
  return button;
}

function renderNearby() {
  const list = $('nearby-list');
  list.replaceChildren();
  const items = [
    ...state.spawns.filter((spawn) => !state.suppressed.has(spawn.id)).slice(0, 5).map((spawn) => ({ type: 'creature', spawn, distance: spawn.distanceM })),
    ...state.places.slice(0, 5).map((place) => ({ type: 'place', place, distance: place.distanceM }))
  ].sort((a, b) => a.distance - b.distance).slice(0, 8);

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-copy';
    empty.textContent = 'The field is quiet. Refresh after walking a little farther.';
    list.append(empty);
    return;
  }
  for (const item of items) list.append(makeNearbyCard(item));
  requestAnimationFrame(() => {
    for (const canvas of list.querySelectorAll('canvas[data-creature-id]')) {
      const spawn = state.spawns.find((entry) => entry.creature.id === canvas.dataset.creatureId);
      if (spawn) drawCreatureFrame(canvas, spawn.creature, hashString(spawn.id), { aura: false });
    }
  });
}

function refreshWorldUI() {
  map.setMarkers(markerData());
  renderNearby();
  renderBag();
  renderCollection();
  updateCounts();
  updateWeatherPill();
}

async function initializeWorld(locationValue, { refresh = false } = {}) {
  const locationPoint = { ...normalizeLocation(locationValue), accuracy: Number(locationValue.accuracy) || 10 };
  state.location = locationPoint;
  map.setLocation(locationPoint);
  $('world-loading').classList.remove('done');
  if (!state.demo) store.set('last-location', { lat: locationPoint.lat, lng: locationPoint.lng });

  const weatherPromise = state.weather && !refresh
    ? Promise.resolve(state.weather)
    : getWeather(locationPoint, { demo: state.demo, now: sessionNow(), store });
  const placesPromise = getPlaces(locationPoint, { demo: state.demo, now: sessionNow(), store });
  const [weather, places] = await Promise.all([weatherPromise, placesPromise]);
  state.weather = weather;
  state.places = places;
  const luredPlaces = places.filter((place) => isLured(place.id, state.lureState, sessionNow()));
  state.spawns = await generateSpawns({ location: locationPoint, weather, now: sessionNow(), luredPlaces });
  refreshWorldUI();
  $('world-loading').classList.add('done');
  document.body.dataset.ready = 'true';
}

function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      () => reject(new Error('Location was not shared. You can still try the private demo.')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 }
    );
  });
}

function introMarkup() {
  const demoLead = state.demo ? 'The demo uses a fixed Manhattan field and never asks for location.' : 'Choose a live local field or a deterministic, offline-friendly demo.';
  return `<div class="onboarding-wrap">
    <div class="onboarding-orbit" aria-hidden="true"><span>◉</span></div>
    <p class="eyebrow">the RAPPID field guide</p>
    <h1 id="onboarding-title">Welcome to RaGo. Meet the RAPPIDs.</h1>
    <p class="onboarding-lead">RAPPIDs are living, local-first beings. Every one has a mint-once identity, grows through immutable frames, and may create independent offspring without erasing its own life. ${demoLead}</p>
    <div class="rappid-primer">
      <article class="primer-card"><span>◉</span><strong>Identity stays</strong><p>A RAPPID receives one identity. Its body can evolve, but its address remains its own.</p></article>
      <article class="primer-card"><span>▤</span><strong>Frames remember</strong><p>Every meaningful change appends a verified frame. Earlier forms remain reachable.</p></article>
      <article class="primer-card"><span>∞</span><strong>Offspring branch</strong><p>A child starts from one exact parent head, then lives forward on an independent stream.</p></article>
    </div>
    <div class="onboarding-actions">
      <button class="primary-button" id="onboard-location" type="button">Enter my local field</button>
      <button class="secondary-button" id="onboard-demo" type="button">${state.demo ? 'Enter the demo field' : 'Meet starter RAPPIDs in demo'}</button>
    </div>
    <p class="onboarding-fineprint">No sign-in, personal profile, analytics, ads, or backend. Exact coordinates and private memories stay on this device.</p>
  </div>`;
}

function showIntro(message = '') {
  for (const renderer of state.starterRenderers) renderer.dispose();
  state.starterRenderers = [];
  const content = $('onboarding-content');
  content.innerHTML = introMarkup();
  if (message) {
    const note = document.createElement('p');
    note.className = 'onboarding-fineprint';
    note.textContent = message;
    content.querySelector('.onboarding-actions').after(note);
  }
  $('onboard-demo').addEventListener('click', async () => {
    state.demo = true;
    await showMemoryCeremony(DEMO_LOCATION);
  });
  $('onboard-location').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Waiting for permission…';
    try {
      state.demo = false;
      await showMemoryCeremony(await requestLocation());
    } catch (error) {
      showIntro(error.message);
    }
  });
  showDialog($('onboarding-dialog'));
}

function localDateTimeValue(milliseconds) {
  const date = new Date(milliseconds - new Date(milliseconds).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function memoryFormMarkup() {
  return `<div class="onboarding-wrap memory-ceremony">
    <div class="starter-heading"><p class="eyebrow">the starter bond</p><h1 id="onboarding-title">What should your starter RAPPID begin by remembering?</h1><p>This private signal calls three possible starters. Picture and sound are reduced to traits and released; raw words stay on this device.</p></div>
    <form class="moment-form onboarding-moment-form" id="onboarding-memory-form">
      <label><span>Name this memory</span><input name="label" maxlength="120" value="the moment I began"></label>
      <label><span>A thought, phrase, or person</span><textarea name="thought" maxlength="2000" rows="3" placeholder="what should it carry with you?"></textarea></label>
      <div class="moment-file-grid">
        <label class="file-field"><span aria-hidden="true">▧</span><strong>Picture</strong><small>camera or library</small><input name="picture" type="file" accept="image/*" capture="environment"></label>
        <label class="file-field"><span aria-hidden="true">∿</span><strong>Sound</strong><small>record or library</small><input name="sound" type="file" accept="audio/*" capture></label>
      </div>
      <div class="moment-inline-fields">
        <label><span>When</span><input name="date" type="datetime-local"></label>
        <label><span>Feeling</span><select name="mood"><option value="open">open</option><option value="still">still</option><option value="bright">bright</option><option value="tender">tender</option><option value="stormy">stormy</option><option value="strange">strange</option></select></label>
      </div>
      <label><span>Place name (private)</span><input name="placeLabel" maxlength="120" placeholder="the kitchen at midnight"></label>
      <label class="weather-check"><input name="weather" type="checkbox" checked><span>Let the weather at this place color the memory</span></label>
      <p class="capture-status" id="onboarding-memory-status" role="status"></p>
      <button class="primary-button" type="submit">Reveal three starter RAPPIDs</button>
    </form>
  </div>`;
}

async function momentFromForm(form, locationPoint, statusElement) {
  const data = new FormData(form);
  statusElement.textContent = 'Reading the signals locally…';
  const pictureFile = data.get('picture');
  const soundFile = data.get('sound');
  const [picture, sound, liveWeather] = await Promise.all([
    pictureFile instanceof File && pictureFile.size ? analyzeImage(pictureFile).catch(() => null) : null,
    soundFile instanceof File && soundFile.size ? analyzeSound(soundFile).catch(() => null) : null,
    getWeather(locationPoint, { demo: state.demo, now: sessionNow(), store })
  ]);
  const includeWeather = data.get('weather') === 'on';
  const rawDate = String(data.get('date') || '');
  const parsedDate = rawDate ? Date.parse(rawDate) : sessionNow();
  const memory = createMoment({
    label: data.get('label'),
    thought: data.get('thought'),
    date: Number.isFinite(parsedDate) ? parsedDate : sessionNow(),
    mood: data.get('mood'),
    picture,
    sound,
    weather: includeWeather ? liveWeather : null,
    location: locationPoint,
    placeLabel: data.get('placeLabel')
  });
  state.weather = liveWeather;
  return { ...memory, weather: liveWeather };
}

async function showMemoryCeremony(locationPoint) {
  const content = $('onboarding-content');
  content.innerHTML = memoryFormMarkup();
  const form = $('onboarding-memory-form');
  form.elements.date.value = localDateTimeValue(sessionNow());
  if (state.demo) {
    form.elements.thought.value = 'the first step into a larger world';
    form.elements.placeLabel.value = 'the demo field';
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const memory = await momentFromForm(form, locationPoint, $('onboarding-memory-status'));
      await showStarters(locationPoint, memory);
    } catch (error) {
      $('onboarding-memory-status').textContent = `That signal could not be read: ${error.message}`;
      submit.disabled = false;
    }
  });
}

async function showStarters(locationPoint, memory) {
  const content = $('onboarding-content');
  content.innerHTML = `<div class="onboarding-wrap"><div class="onboarding-orbit" aria-hidden="true"><span>◌</span></div><h1 id="onboarding-title">Calling three starter RAPPIDs…</h1><p class="onboarding-lead">Picture, sound, thought, place, time, and weather each pull on different species and traits.</p></div>`;
  const weather = memory.weather;
  const cell = geohashEncode(locationPoint.lat, locationPoint.lng, 6);
  const bucket = Math.floor(sessionNow() / (30 * 60 * 1000));
  const axes = ['picture', 'sound', 'thought'];
  const starters = await Promise.all(axes.map((axis, variant) => createMomentCreature({
    seed: `${cell}:starter:${JSON.stringify(memory.publicSignal)}`,
    location: locationPoint,
    weather,
    moment: memory.publicSignal,
    bucket,
    variant,
    axis,
    origin: 'starter'
  })));

  content.innerHTML = `<div class="onboarding-wrap">
    <div class="starter-heading"><p class="eyebrow">your first RAPPID</p><h1 id="onboarding-title">Choose your starter RAPPID.</h1><p>Each candidate interprets the same private memory differently. Your choice becomes generation zero—the ancestor of every branch you may grow.</p></div>
    <div class="starter-grid" id="starter-grid"></div>
  </div>`;
  const grid = $('starter-grid');
  for (const [index, creature] of starters.entries()) {
    const card = document.createElement('article');
    card.className = 'starter-card';
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 280;
    const heading = document.createElement('h2');
    heading.textContent = creature.name;
    const copy = document.createElement('p');
    copy.textContent = `${axes[index]}-led · ${creature.species}`;
    const choose = document.createElement('button');
    choose.className = 'primary-button';
    choose.type = 'button';
    choose.textContent = `Choose ${creature.name} as my starter`;
    choose.addEventListener('click', async () => {
      choose.disabled = true;
      const profile = await createCompanionProfile(
        creature,
        { ...memory.privateMemory, sources: memory.publicSignal.sources },
        { now: sessionNow() }
      );
      const starterRappid = currentCompanion(profile);
      await collectionStore.put(starterRappid, {
        capturedAt: sessionNow(),
        capture: { kind: 'starter', memoryLabel: memory.privateMemory.label, sources: memory.publicSignal.sources, cell }
      });
      state.lineage = createLineage(profile);
      state.companion = profile;
      await companionStore.setLineage(state.lineage);
      store.set('profile', { onboarded: true, starterId: starterRappid.id, rappid: profile.rappid, startedAt: sessionNow() });
      for (const renderer of state.starterRenderers) renderer.dispose();
      state.starterRenderers = [];
      state.collection = await collectionStore.list();
      closeDialog($('onboarding-dialog'));
      await initializeWorld(locationPoint);
      renderCompanion();
      toast(`${starterRappid.name} became your starter RAPPID.`);
      await processIncomingCreature();
    });
    card.append(canvas, heading, copy, choose);
    grid.append(card);
    const renderer = new CreatureRenderer(canvas, creature, { interactive: true });
    renderer.start();
    state.starterRenderers.push(renderer);
  }
}

function openMomentCapture() {
  if (!state.location) {
    toast('Choose a field before capturing a moment.');
    return;
  }
  const form = $('capture-form');
  form.reset();
  form.elements.date.value = localDateTimeValue(Date.now());
  form.elements.weather.checked = true;
  $('capture-status').textContent = '';
  showDialog($('capture-dialog'));
}

async function captureMomentFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $('capture-submit');
  submit.disabled = true;
  try {
    const memory = await momentFromForm(form, state.location, $('capture-status'));
    $('capture-status').textContent = 'Giving the moment a body…';
    const bucket = Math.floor(sessionNow() / (30 * 60 * 1000));
    const creature = await createMomentCreature({
      seed: `${memory.privateMemory.label}:${JSON.stringify(memory.publicSignal)}`,
      location: state.location,
      weather: memory.weather,
      moment: memory.publicSignal,
      bucket,
      variant: 0,
      axis: 'whole',
      origin: 'captured-moment'
    });
    const point = offsetLocation(state.location, 7, 5);
    const spawn = {
      id: `moment-${creature.id}-${Date.now().toString(36)}`,
      lat: point.lat,
      lng: point.lng,
      anchor: point,
      distanceM: 9,
      creature,
      privateMemory: memory.privateMemory,
      customMoment: true
    };
    form.reset();
    closeDialog($('capture-dialog'));
    openEncounter(spawn);
  } catch (error) {
    $('capture-status').textContent = `That moment could not take form: ${error.message}`;
  } finally {
    submit.disabled = false;
  }
}

function renderOrbOptions() {
  const options = $('orb-options');
  options.replaceChildren();
  const orbIds = ['orb.glass', 'orb.dew', 'orb.prism'];
  const available = orbIds.filter((id) => (state.inventory[id] || 0) > 0);
  if (!available.includes(state.selectedOrb)) state.selectedOrb = available[0] || null;
  for (const id of orbIds) {
    const item = ITEMS[id];
    const count = state.inventory[id] || 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `orb-option${state.selectedOrb === id ? ' selected' : ''}`;
    button.disabled = count === 0 || state.encounterBusy;
    button.setAttribute('aria-pressed', String(state.selectedOrb === id));
    button.innerHTML = `<strong>${item.glyph} ${item.name.replace(' orb', '')}</strong><small>${count} left</small>`;
    button.addEventListener('click', () => { state.selectedOrb = id; renderOrbOptions(); });
    options.append(button);
  }
  $('throw-button').disabled = !state.selectedOrb || state.encounterBusy;
  $('offering-count').textContent = state.inventory['treat.mint'] || 0;
  $('offering-toggle').disabled = !(state.inventory['treat.mint'] || 0) || state.encounterBusy;
}

function openEncounter(spawn) {
  if (!spawn || state.encounterBusy) return;
  state.selectedSpawn = spawn;
  state.ringStartedAt = performance.now();
  state.selectedOrb = ['orb.glass', 'orb.dew', 'orb.prism'].find((id) => (state.inventory[id] || 0) > 0) || null;
  $('encounter-name').textContent = spawn.creature.name;
  $('encounter-rarity').textContent = `${spawn.creature.rarity} · ${speciesLabel(spawn.creature)} · ${spawn.creature.distinctiveTrait}`;
  const sourcePhrase = momentSourceLabel(spawn.creature.genome.moment);
  $('encounter-origin').textContent = spawn.privateMemory?.label
    ? `${spawn.privateMemory.label} · ${sourcePhrase}`
    : `${sourcePhrase} · ${formatDistance(spawn.distanceM)} away`;
  $('encounter-result').textContent = '';
  $('throw-grade').textContent = '';
  $('encounter-actions').hidden = true;
  $('throw-button').hidden = false;
  $('throw-button').textContent = 'Throw when the ring is small';
  $('offering-toggle').checked = false;
  $('catch-ring').classList.remove('paused');
  $('encounter-dialog').dataset.catchState = 'ready';
  renderOrbOptions();
  if (state.encounterRenderer) state.encounterRenderer.setCreature(spawn.creature);
  else state.encounterRenderer = new CreatureRenderer($('encounter-creature'), spawn.creature);
  state.encounterRenderer.start();
  showDialog($('encounter-dialog'));
}

function closeEncounter() {
  if (state.encounterBusy) return;
  state.encounterRenderer?.stop();
  state.selectedSpawn = null;
  closeDialog($('encounter-dialog'));
}

function tone(frequency, duration = 0.06) {
  try {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return;
    const context = tone.context || (tone.context = new AudioContext());
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.035;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.stop(context.currentTime + duration);
  } catch {}
}

async function attemptCatch() {
  const spawn = state.selectedSpawn;
  if (!spawn || state.encounterBusy || !state.selectedOrb) return;
  const orb = ITEMS[state.selectedOrb];
  const orbSpend = spendItem(state.inventory, state.selectedOrb, 1);
  if (!orbSpend.ok) {
    toast('That vessel is no longer in your satchel.');
    renderOrbOptions();
    return;
  }

  const useOffering = $('offering-toggle').checked && (state.inventory['treat.mint'] || 0) > 0;
  let inventory = orbSpend.inventory;
  let offering = null;
  if (useOffering) {
    const spent = spendItem(inventory, 'treat.mint', 1);
    inventory = spent.inventory;
    offering = ITEMS['treat.mint'];
  }
  state.inventory = inventory;
  persistInventory();
  state.encounterBusy = true;
  renderOrbOptions();
  $('catch-ring').classList.add('paused');
  $('encounter-dialog').dataset.catchState = 'throwing';

  const quality = throwQuality(performance.now() - state.ringStartedAt, true);
  $('throw-grade').textContent = quality.label;
  const result = rollCatch({
    rarity: spawn.creature.rarity,
    orbMultiplier: orb.catchMultiplier,
    treatMultiplier: offering?.catchMultiplier || 1,
    fleeMultiplier: offering?.fleeMultiplier || 1,
    throwMultiplier: quality.multiplier
  }, state.demo ? () => 0.01 : secureRandom);

  for (let wobble = 1; wobble <= result.wobbles; wobble += 1) {
    $('encounter-result').textContent = `${['One quiet wobble', 'Two steady wobbles', 'The vessel settles'][wobble - 1]}…`;
    $('encounter-dialog').dataset.catchState = `wobble-${wobble}`;
    tone(500 + wobble * 95);
    try { navigator.vibrate?.(35); } catch {}
    await delay(360);
  }

  if (result.caught) {
    $('encounter-dialog').dataset.catchState = 'caught';
    $('encounter-result').textContent = `Caught — ${spawn.creature.name} holds this moment.`;
    $('throw-grade').textContent = 'caught';
    tone(880, 0.13);
    const saved = await collectionStore.put(spawn.creature, {
      capturedAt: sessionNow(),
      capture: {
        kind: spawn.customMoment ? 'moment' : 'ambient',
        memory: spawn.privateMemory || null,
        sources: spawn.creature.genome.moment?.sources || ['weather', 'place', 'time'],
        weather: weatherLabel(state.weather),
        temperature: state.weather.temperature,
        cell: spawn.creature.birth.cell,
        orb: state.selectedOrb,
        offering: useOffering ? 'treat.mint' : null,
        throw: quality.label
      }
    });
    state.suppressed.add(spawn.id);
    state.spawns = state.spawns.filter((entry) => entry.id !== spawn.id);
    state.collection = await collectionStore.list();
    state.lastCaught = saved;
    $('throw-button').hidden = true;
    $('encounter-actions').hidden = false;
    refreshWorldUI();
  } else if (result.fled) {
    $('encounter-dialog').dataset.catchState = 'fled';
    $('encounter-result').textContent = `${spawn.creature.name} slipped back into the moment.`;
    state.suppressed.add(spawn.id);
    state.spawns = state.spawns.filter((entry) => entry.id !== spawn.id);
    $('throw-button').hidden = true;
    refreshWorldUI();
  } else {
    $('encounter-dialog').dataset.catchState = 'escaped';
    $('encounter-result').textContent = `${spawn.creature.name} broke free. The encounter is still open.`;
    $('throw-button').textContent = 'Try another throw';
    $('catch-ring').classList.remove('paused');
    state.ringStartedAt = performance.now();
  }
  state.encounterBusy = false;
  renderOrbOptions();
}

function updatePlaceDialog() {
  const place = state.selectedPlace;
  if (!place || !state.location) return;
  const status = placeStatus(place, state.location, state.spinState, sessionNow());
  $('place-distance').textContent = `${formatDistance(status.distanceM)} away · ${status.inRange ? 'close enough to gather' : 'walk closer to gather'}`;
  const spinButton = $('spin-button');
  if (!status.inRange) {
    spinButton.disabled = true;
    spinButton.textContent = `Walk closer (${formatDistance(status.distanceM)})`;
  } else if (!status.ready) {
    spinButton.disabled = true;
    spinButton.textContent = `Resting · ${formatTime(status.readyInMs)}`;
  } else {
    spinButton.disabled = false;
    spinButton.textContent = 'Gather from this place';
  }
  const lureAvailable = (state.inventory.lure || 0) > 0 && status.inRange && !isLured(place.id, state.lureState, sessionNow());
  $('lure-button').hidden = !lureAvailable;
}

function openPlace(place) {
  state.selectedPlace = place;
  $('place-symbol').textContent = placeGlyph(place.kind);
  $('place-kind').textContent = `${place.kind} place`;
  $('place-name').textContent = place.name;
  $('drop-list').replaceChildren();
  $('place-note').textContent = isLured(place.id, state.lureState, sessionNow())
    ? 'A lure is quickening the weather around this place.'
    : 'Places replenish your satchel, then rest for five minutes.';
  $('place-source').textContent = place.source === 'openstreetmap' || place.source === 'cache'
    ? 'Place data © OpenStreetMap contributors'
    : `${place.source === 'demo' ? 'Demo' : 'Offline'} place · no live network required`;
  updatePlaceDialog();
  showDialog($('place-dialog'));
}

function gatherPlace() {
  const result = spinPlace({
    place: state.selectedPlace,
    location: state.location,
    inventory: state.inventory,
    spinState: state.spinState,
    now: sessionNow()
  });
  if (!result.ok) {
    updatePlaceDialog();
    return;
  }
  state.inventory = result.inventory;
  state.spinState = result.spinState;
  store.set('spins', state.spinState);
  persistInventory();
  const list = $('drop-list');
  list.replaceChildren();
  for (const drop of result.drops) {
    const chip = document.createElement('span');
    chip.className = 'drop-chip';
    chip.textContent = `${drop.item.glyph} ${drop.item.name} ×${drop.count}`;
    list.append(chip);
  }
  $('place-note').textContent = result.full ? 'Your satchel is full; anything extra stayed here.' : 'The place gives, then grows quiet for a while.';
  updatePlaceDialog();
  renderBag();
  toast(`Gathered ${result.drops.reduce((sum, drop) => sum + drop.count, 0)} items.`);
}

async function leaveLure() {
  const result = activateLure({
    place: state.selectedPlace,
    inventory: state.inventory,
    lureState: state.lureState,
    now: sessionNow()
  });
  if (!result.ok) return;
  state.inventory = result.inventory;
  state.lureState = result.lureState;
  store.set('lures', state.lureState);
  persistInventory();
  $('place-note').textContent = 'A weather lure is active here for twenty minutes.';
  $('lure-button').hidden = true;
  await initializeWorld(state.location, { refresh: true });
  toast('The nearby field quickened.');
}

function renderBag() {
  const grid = $('bag-grid');
  grid.replaceChildren();
  for (const item of Object.values(ITEMS)) {
    const card = document.createElement('article');
    card.className = 'bag-item';
    const glyph = document.createElement('span');
    glyph.className = 'bag-glyph';
    glyph.textContent = item.glyph;
    const copy = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = item.name;
    const description = document.createElement('p');
    description.textContent = item.description;
    copy.append(heading, description);
    const count = document.createElement('strong');
    count.textContent = state.inventory[item.id] || 0;
    count.setAttribute('aria-label', `${state.inventory[item.id] || 0} held`);
    card.append(glyph, copy, count);
    grid.append(card);
  }
  $('bag-summary').textContent = `${inventoryCount(state.inventory)} of 120 spaces filled. Gather at nearby places to replenish supplies.`;
}

function renderCompanionSources() {
  const container = $('companion-sources');
  container.replaceChildren();
  for (const source of state.companion?.memory?.sources || []) {
    const pill = document.createElement('span');
    pill.className = 'source-pill';
    pill.textContent = `${momentIcon(source)} ${source}`;
    container.append(pill);
  }
}

function companionDonors() {
  return state.collection.filter((creature) => creature.capture?.kind !== 'starter');
}

function renderCompanionDonors() {
  const strip = $('companion-donors');
  strip.replaceChildren();
  const donors = companionDonors();
  if (!donors.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-journal';
    empty.innerHTML = '<strong>No spliceable moments yet.</strong>Catch an ambient moment or capture a thought, picture, or sound.';
    strip.append(empty);
    return;
  }
  for (const donor of donors) {
    const card = document.createElement('article');
    card.className = 'donor-card';
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 240;
    const heading = document.createElement('h3');
    heading.textContent = donor.name;
    const detail = document.createElement('p');
    detail.textContent = `${speciesLabel(donor)} · ${donor.distinctiveTrait}`;
    const button = document.createElement('button');
    button.className = 'primary-button';
    button.type = 'button';
    button.textContent = 'Splice traits';
    button.addEventListener('click', () => openSplice(donor));
    card.append(canvas, heading, detail, button);
    strip.append(card);
    requestAnimationFrame(() => drawCreatureFrame(canvas, donor, hashString(donor.id)));
  }
}

function renderEvolutionTimeline() {
  const timeline = $('evolution-timeline');
  timeline.replaceChildren();
  const frames = state.companion?.frames || [];
  for (const [reverseIndex, frame] of [...frames].reverse().entries()) {
    const isCurrent = reverseIndex === 0;
    const event = frame.payload.event;
    const creature = frame.payload.creature;
    const item = document.createElement('article');
    item.className = 'evolution-frame';
    const icon = document.createElement('span');
    icon.className = 'frame-icon';
    icon.textContent = event === 'birth' ? '◉' : event === 'splice' ? '🧬' : event === 'freeze' ? '❄' : event === 'wake' ? '↟' : '↶';
    const copy = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = `${event} · ${creature.name}`;
    const note = document.createElement('p');
    note.textContent = `${state.companion.localNotes?.[frame.frame_hash] || 'verified body frame'} · ${frame.frame_hash.slice(0, 8)}`;
    copy.append(heading, note);
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = isCurrent;
    button.textContent = isCurrent ? 'current' : 'return here';
    button.addEventListener('click', async () => {
      const reverted = await revertCompanion(state.companion, frame.frame_hash, Date.now());
      await persistOrganism(reverted);
      renderCompanion();
      renderLineage();
      toast('The RAPPID returned to an earlier form. Nothing was erased.');
    });
    item.append(icon, copy, button);
    timeline.append(item);
  }
}

function renderCompanion() {
  const creature = currentCompanion(state.companion);
  if (!creature) return;
  if (state.companionRenderer) state.companionRenderer.setCreature(creature);
  else state.companionRenderer = new CreatureRenderer($('companion-creature'), creature, { interactive: true });
  if (!$('companion-view').hidden) state.companionRenderer.start();
  $('companion-name').textContent = creature.name;
  $('companion-memory').textContent = state.companion.memory?.thought
    ? `${state.companion.memory.label} — “${state.companion.memory.thought.slice(0, 180)}”`
    : state.companion.memory?.label || 'A private memory began this RAPPID.';
  $('companion-id').textContent = state.companion.rappid;
  $('companion-id').title = state.companion.rappid;
  $('companion-genome').textContent = creature.id;
  $('companion-frame-count').textContent = state.companion.frames.length;
  const frame = currentFrame(state.companion);
  const glow = frame?.payload?.alleles?.glow?.tier?.name || creature.rarity;
  $('companion-generation').textContent = `generation ${state.companion.generation} · frame ${frame?.seq || 0} · ${glow} glow · ${speciesLabel(creature)}`;
  $('companion-freeze-button').textContent = state.companion.status === 'frozen'
    ? 'Wake from latest head'
    : 'Freeze at latest head';
  renderCompanionSources();
  renderCompanionDonors();
  renderEvolutionTimeline();
  updateCounts();
}

function renderLineage() {
  const summary = $('lineage-summary');
  const graph = $('lineage-graph');
  summary.replaceChildren();
  graph.replaceChildren();
  if (!state.lineage?.organisms?.length) return;
  const generations = lineageGenerations(state.lineage);
  const maxGeneration = Math.max(...state.lineage.organisms.map((organism) => organism.generation));
  const stats = [
    `${state.lineage.organisms.length} living RAPPID${state.lineage.organisms.length === 1 ? '' : 's'}`,
    `${maxGeneration + 1} generation${maxGeneration ? 's' : ''}`,
    `${state.lineage.organisms.filter((organism) => organism.status === 'frozen').length} frozen`,
    `ancestor ${state.lineage.ancestorHash.slice(0, 10)}`
  ];
  for (const value of stats) {
    const pill = document.createElement('span');
    pill.className = 'lineage-stat';
    pill.textContent = value;
    summary.append(pill);
  }
  for (const group of generations) {
    const section = document.createElement('section');
    section.className = 'lineage-generation';
    const heading = document.createElement('h3');
    heading.textContent = group.generation === 0 ? 'generation 0 · ancestor' : `generation ${group.generation}`;
    const column = document.createElement('div');
    column.className = 'lineage-column';
    for (const organism of group.organisms) {
      const creature = currentCompanion(organism);
      const frame = currentFrame(organism);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `rappid-card${organism.rappid === state.lineage.selectedRappid ? ' selected' : ''}`;
      card.setAttribute('aria-label', `Select ${creature.name}, generation ${organism.generation}, ${organism.status}`);
      const canvas = document.createElement('canvas');
      canvas.width = 140;
      canvas.height = 140;
      canvas.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = creature.name;
      const status = document.createElement('span');
      status.className = organism.status;
      status.textContent = `${organism.status} · head ${frame.frame_hash.slice(0, 7)}`;
      const mutation = document.createElement('span');
      mutation.textContent = frame.payload.mutation?.dimensions?.join(' + ') || 'starter ancestor';
      copy.append(name, status, mutation);
      card.append(canvas, copy);
      card.addEventListener('click', async () => {
        await chooseRappid(organism.rappid);
        toast(`${creature.name} is now the selected RAPPID.`);
      });
      column.append(card);
      requestAnimationFrame(() => drawCreatureFrame(canvas, creature, hashString(creature.id), { aura: false }));
    }
    section.append(heading, column);
    graph.append(section);
  }
}

async function drillParallelOffspring() {
  if (!state.companion || !state.lineage) return;
  if (state.companion.status === 'frozen') {
    toast('Wake the selected RAPPID before drilling offspring.');
    return;
  }
  const dimensions = [...document.querySelectorAll('input[name="offspring-dimension"]:checked')]
    .map((input) => input.value);
  if (!dimensions.length) {
    toast('Choose at least one dimension.');
    return;
  }
  const count = Number($('offspring-count').value);
  const button = $('drill-button');
  button.disabled = true;
  button.textContent = 'Drilling parallel frames…';
  try {
    const children = await createParallelOffspring(state.companion, dimensions, count, { now: Date.now() });
    for (const child of children) state.lineage = upsertOrganism(state.lineage, child, { select: false });
    state.lineage = selectOrganism(state.lineage, children[0].rappid);
    state.companion = selectedOrganism(state.lineage);
    await companionStore.setLineage(state.lineage);
    renderCompanion();
    renderLineage();
    updateCounts();
    toast(`${children.length} parallel offspring woke. Every parent and sibling remains alive.`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Drill from selected head';
  }
}

async function toggleSelectedRappid() {
  if (!state.companion) return;
  const button = $('companion-freeze-button');
  button.disabled = true;
  try {
    const next = state.companion.status === 'frozen'
      ? await wakeRappid(state.companion, Date.now())
      : await freezeRappid(state.companion, Date.now());
    await persistOrganism(next);
    renderCompanion();
    renderLineage();
    toast(`${currentCompanion(next).name} ${next.status === 'awake' ? 'woke from' : 'froze at'} its latest verified head.`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function openSplice(donor) {
  const primary = currentCompanion(state.companion);
  if (!primary || !donor) {
    toast('A selected RAPPID and a captured donor are both required.');
    return;
  }
  if (state.companion.status === 'frozen') {
    toast('Wake the selected RAPPID before splicing traits.');
    return;
  }
  state.spliceDonor = donor;
  $('splice-title').textContent = `Splice ${donor.name} into your selected RAPPID`;
  $('splice-copy').textContent = `${momentSourceLabel(donor.genome.moment)} can lend selected traits while ${state.companion.rappid.slice(0, 28)}… remains the same identity.`;
  $('splice-donor-name').textContent = donor.name;
  for (const input of document.querySelectorAll('input[name="splice-trait"]')) input.checked = input.value === 'surface';
  drawCreatureFrame($('splice-primary'), primary, hashString(primary.id));
  drawCreatureFrame($('splice-donor'), donor, hashString(donor.id));
  showDialog($('splice-dialog'));
}

async function applySplice() {
  if (!state.spliceDonor || !state.companion) return;
  const traits = [...document.querySelectorAll('input[name="splice-trait"]:checked')].map((input) => input.value);
  if (!traits.length) {
    toast('Choose at least one trait family.');
    return;
  }
  const button = $('splice-apply');
  button.disabled = true;
  button.textContent = 'Absorbing the moment…';
  try {
    const evolved = await evolveCompanion(state.companion, state.spliceDonor, traits, Date.now());
    await persistOrganism(evolved);
    closeDialog($('splice-dialog'));
    closeEncounter();
    switchView('companion');
    renderCompanion();
    renderLineage();
    toast(`Your RAPPID absorbed ${traits.join(' + ')} from ${state.spliceDonor.name}.`);
  } finally {
    button.disabled = false;
    button.textContent = 'Absorb selected traits';
  }
}

function captureSummary(creature) {
  if (creature.capture?.kind === 'starter') return `founding memory · ${(creature.capture.sources || []).join(' + ')}`;
  if (creature.capture?.memory?.label) return `${creature.capture.memory.label} · ${(creature.capture.sources || []).join(' + ')}`;
  if (creature.capture?.sources?.length) return creature.capture.sources.join(' + ');
  if (creature.capture?.weather) return `${creature.capture.weather} · ${creature.capture.throw || 'caught'}`;
  return `moment cell ${creature.birth.cell}`;
}

function renderCollection() {
  const grid = $('collection-grid');
  grid.replaceChildren();
  if (!state.collection.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-journal';
    empty.innerHTML = '<strong>Your moments are waiting.</strong>Capture a thought, picture, sound, or ambient place-and-weather being.';
    grid.append(empty);
    return;
  }
  for (const creature of state.collection) {
    const card = document.createElement('article');
    card.className = 'collection-card';
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 260;
    canvas.setAttribute('aria-label', `${creature.name}, ${speciesLabel(creature)}, with ${creature.distinctiveTrait}`);
    const rarity = document.createElement('p');
    rarity.className = 'rarity-label';
    rarity.textContent = `${creature.rarity} · ${speciesLabel(creature)}`;
    const heading = document.createElement('h2');
    heading.textContent = creature.name;
    const detail = document.createElement('p');
    detail.textContent = `${creature.distinctiveTrait || 'unique individual'} · ${captureSummary(creature)}`;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const verify = document.createElement('button');
    verify.type = 'button';
    verify.textContent = `✓ ${creature.id.slice(0, 8)}`;
    verify.title = 'Content-verified genome id';
    verify.addEventListener('click', () => toast(`Genome ${creature.id} is content-addressed.`));
    const share = document.createElement('button');
    share.type = 'button';
    share.textContent = '↗ Share';
    share.addEventListener('click', () => openShare(creature));
    actions.append(verify);
    if (creature.capture?.kind !== 'starter') {
      const splice = document.createElement('button');
      splice.type = 'button';
      splice.textContent = '🧬 Splice';
      splice.addEventListener('click', () => openSplice(creature));
      actions.append(splice);
    }
    actions.append(share);
    card.append(canvas, rarity, heading, detail, actions);
    grid.append(card);
    requestAnimationFrame(() => drawCreatureFrame(canvas, creature, hashString(creature.id)));
  }
}

function openShare(creature) {
  if (!creature) return;
  state.shareCreature = creature;
  const url = new URL(location.href);
  url.search = '';
  url.hash = `creature=${encodeCreatureToken(creature)}`;
  $('share-title').textContent = `Send ${creature.name}`;
  $('share-url').value = url.href;
  $('native-share').hidden = !navigator.share;
  showDialog($('share-dialog'));
}

function base64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function openInLantern(creature) {
  if (!creature) return;
  const target = window.open('about:blank', '_blank', 'noopener');
  try {
    const cartridge = await toLanternCartridge(creature);
    const url = `https://kody-w.github.io/rapp-lantern/player.html#${base64UrlJson(cartridge)}`;
    if (target) target.location.href = url;
    else location.href = url;
  } catch (error) {
    target?.close();
    toast(`Lantern export failed: ${error.message}`);
  }
}

async function copyShareLink() {
  const input = $('share-url');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  $('copy-share').textContent = 'Copied';
  toast('Creature link copied.');
}

async function nativeShare() {
  if (!navigator.share || !state.shareCreature) return;
  try {
    await navigator.share({
      title: `${state.shareCreature.name} from RaGo`,
      text: 'A verified captured RAPPID is waiting for you.',
      url: $('share-url').value
    });
  } catch {}
}

async function processIncomingCreature() {
  const hash = location.hash;
  if (!hash.startsWith('#creature=')) return;
  if ($('onboarding-dialog').open) {
    state.pendingImport = hash.slice('#creature='.length);
    return;
  }
  try {
    const creature = await decodeCreatureToken(hash.slice('#creature='.length));
    state.importCreature = creature;
    $('import-status').textContent = '✓ genome verified on this device';
    $('import-title').textContent = `${creature.name} arrived`;
    $('import-copy').textContent = `${speciesLabel(creature)}, a ${creature.rarity} individual with ${creature.distinctiveTrait}, carrying intact public moment traits. No private memory was included.`;
    $('import-keep').disabled = false;
    drawCreatureFrame($('import-creature'), creature, hashString(creature.id));
    showDialog($('import-dialog'));
  } catch (error) {
    state.importCreature = null;
    $('import-status').textContent = 'Verification failed';
    $('import-title').textContent = 'This link is wearing a disguise';
    $('import-copy').textContent = error.message;
    $('import-keep').disabled = true;
    showDialog($('import-dialog'));
  }
}

async function keepImportedCreature() {
  if (!state.importCreature) return;
  await collectionStore.put(state.importCreature, {
    capturedAt: Date.now(),
    capture: { kind: 'gift', from: 'verified link' }
  });
  state.collection = await collectionStore.list();
  renderCollection();
  updateCounts();
  closeDialog($('import-dialog'));
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  toast(`${state.importCreature.name} joined your journal.`);
}

async function processPendingImport() {
  if (!state.pendingImport) return;
  const token = state.pendingImport;
  state.pendingImport = null;
  history.replaceState(null, '', `${location.pathname}${location.search}#creature=${token}`);
  await processIncomingCreature();
}

function switchView(view) {
  const views = {
    explore: $('explore-view'),
    companion: $('companion-view'),
    lineage: $('lineage-view'),
    collection: $('collection-view'),
    bag: $('bag-view')
  };
  for (const [name, element] of Object.entries(views)) element.hidden = name !== view;
  for (const button of document.querySelectorAll('[data-view-target]')) {
    const active = button.dataset.viewTarget === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('app').dataset.view = view;
  if (view === 'companion') renderCompanion();
  else state.companionRenderer?.stop();
  if (view === 'lineage') renderLineage();
  if (view === 'collection') renderCollection();
  if (view === 'bag') renderBag();
}

async function boot() {
  state.collection = await collectionStore.list();
  state.lineage = await companionStore.getLineage();
  state.companion = selectedOrganism(state.lineage);
  const profile = store.get('profile');
  if (!state.lineage) {
    const legacy = await companionStore.get();
    if (legacy?.frames?.length) {
      const migrated = await migrateLegacyProfile(legacy, { now: profile?.startedAt || Date.now() });
      state.lineage = createLineage(migrated);
      state.companion = migrated;
      await companionStore.setLineage(state.lineage);
    }
  }
  if (profile?.onboarded && !state.lineage) {
    const starter = state.collection.find((creature) => creature.capture?.kind === 'starter') || state.collection[0];
    if (starter) {
      const migrated = await createCompanionProfile(starter, {
        label: starter.capture?.memoryLabel || 'the moment I began',
        thought: '',
        sources: starter.capture?.sources || starter.genome.moment?.sources || ['time', 'place', 'weather'],
        mediaReleased: true
      }, { now: profile.startedAt || Date.now() });
      state.lineage = createLineage(migrated);
      state.companion = migrated;
      await companionStore.setLineage(state.lineage);
    }
  }
  renderCollection();
  renderBag();
  renderCompanion();
  renderLineage();
  updateCounts();
  updateThemeButton();

  const fixed = parseFixedLocation();
  const saved = store.get('last-location');
  if (!profile?.onboarded) {
    showIntro();
  } else if (state.demo) {
    await initializeWorld(DEMO_LOCATION);
  } else if (fixed) {
    await initializeWorld(fixed);
  } else if (saved) {
    await initializeWorld({ ...saved, accuracy: 70 });
  } else {
    showIntro('Share location once to rebuild the nearby field, or use demo mode.');
  }
  await processIncomingCreature();
}

$('theme-button').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
  updateThemeButton();
});
$('zoom-in').addEventListener('click', () => map.zoomBy(0.55));
$('zoom-out').addEventListener('click', () => map.zoomBy(-0.55));
$('recenter').addEventListener('click', () => map.recenter());
$('capture-moment-button').addEventListener('click', openMomentCapture);
$('companion-capture-button').addEventListener('click', openMomentCapture);
$('companion-lantern-button').addEventListener('click', () => openInLantern(currentCompanion(state.companion)));
$('companion-freeze-button').addEventListener('click', toggleSelectedRappid);
$('drill-button').addEventListener('click', drillParallelOffspring);
$('capture-close').addEventListener('click', () => closeDialog($('capture-dialog')));
$('capture-form').addEventListener('submit', captureMomentFromForm);
$('refresh-button').addEventListener('click', async (event) => {
  if (!state.location) return;
  event.currentTarget.disabled = true;
  await initializeWorld(state.location, { refresh: true });
  event.currentTarget.disabled = false;
  toast('The nearby field is fresh.');
});
for (const button of document.querySelectorAll('[data-view-target]')) button.addEventListener('click', () => switchView(button.dataset.viewTarget));
$('encounter-close').addEventListener('click', closeEncounter);
$('throw-button').addEventListener('click', attemptCatch);
$('encounter-stage').addEventListener('click', () => { if (!state.encounterBusy) attemptCatch(); });
$('encounter-journal').addEventListener('click', () => { closeEncounter(); switchView('collection'); });
$('encounter-splice').addEventListener('click', () => {
  const donor = state.lastCaught;
  closeEncounter();
  openSplice(donor);
});
$('encounter-share').addEventListener('click', () => openShare(state.lastCaught));
$('splice-close').addEventListener('click', () => closeDialog($('splice-dialog')));
$('splice-apply').addEventListener('click', applySplice);
$('place-close').addEventListener('click', () => closeDialog($('place-dialog')));
$('spin-button').addEventListener('click', gatherPlace);
$('lure-button').addEventListener('click', leaveLure);
$('share-close').addEventListener('click', () => closeDialog($('share-dialog')));
$('copy-share').addEventListener('click', copyShareLink);
$('native-share').addEventListener('click', nativeShare);
$('open-lantern').addEventListener('click', () => openInLantern(state.shareCreature));
$('import-close').addEventListener('click', () => closeDialog($('import-dialog')));
$('import-keep').addEventListener('click', keepImportedCreature);
$('about-button').addEventListener('click', () => showDialog($('about-dialog')));
$('about-close').addEventListener('click', () => closeDialog($('about-dialog')));
$('reset-button').addEventListener('click', async () => {
  if (!confirm('Reset this local adventure? Your journal and satchel will be cleared from this browser.')) return;
  await resetStoredApp();
  location.href = new URL('./', location.href).href;
});
$('onboarding-dialog').addEventListener('close', processPendingImport);
window.addEventListener('hashchange', processIncomingCreature);
setInterval(() => { if ($('place-dialog').open) updatePlaceDialog(); }, 1_000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.__RAGO__ = {
  version: '2.2.0',
  get state() { return state; },
  get map() { return map; },
  refresh: () => initializeWorld(state.location, { refresh: true }),
  openEncounter,
  openPlace,
  switchView
};
window.__RAPP_GO__ = window.__RAGO__;

await boot();
