import test from 'node:test';
import assert from 'node:assert/strict';

import { getPlaces } from '../../src/services/places.js';
import { JsonStore } from '../../src/services/storage.js';
import { getWeather } from '../../src/services/weather.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  key(index) { return [...this.values.keys()][index] ?? null; }
}

const location = { lat: 33.7490123, lng: -84.3879824 };

test('weather requests use a coarse cell center and cache the result', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      json: async () => ({ current: { temperature_2m: 24, weather_code: 1, wind_speed_10m: 6, is_day: 1 } })
    };
  };
  const store = new JsonStore(new MemoryStorage());
  const first = await getWeather(location, { fetchImpl, store, now: 100_000_000 });
  const second = await getWeather(location, { fetchImpl, store, now: 100_000_001 });
  assert.equal(first.temperature, 24);
  assert.equal(second.source, 'cache');
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0], /33\.7490123|-84\.3879824/u);
});

test('place requests use a geohash-cell box and normalize Overpass data', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: options.body.toString() });
    return {
      ok: true,
      json: async () => ({
        elements: [
          { type: 'node', id: 7, lat: 33.7492, lon: -84.388, tags: { amenity: 'fountain', name: 'Test Fountain' } },
          { type: 'node', id: 8, lat: 33.7494, lon: -84.3881, tags: { natural: 'tree' } }
        ]
      })
    };
  };
  const places = await getPlaces(location, { fetchImpl, store: new JsonStore(new MemoryStorage()), now: 50_000 });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].body, /33\.7490123|84\.3879824/u);
  assert.equal(places[0].name, 'Test Fountain');
  assert.equal(places[0].kind, 'water');
  assert.equal(places[1].kind, 'nature');
});

test('JSON storage survives malformed backing values through safe fallbacks', () => {
  const storage = new MemoryStorage();
  storage.setItem('rapp-go-v2.bad', '{broken');
  storage.setItem('rapp-go-v2.legacy', JSON.stringify({ kept: true }));
  const store = new JsonStore(storage);
  assert.equal(store.get('bad', 'fallback'), 'fallback');
  assert.deepEqual(store.get('legacy'), { kept: true });
  store.set('good', { ok: true });
  assert.deepEqual(store.get('good'), { ok: true });
  assert.equal(storage.getItem('rago-v2.good'), JSON.stringify({ ok: true }));
});
