import { DEFAULT_INVENTORY, normalizeInventory } from '../game/economy.js';

export const STORAGE_PREFIX = 'rago-v2.';
const LEGACY_STORAGE_PREFIX = 'rapp-go-v2.';
const DATABASE_NAME = 'rapp-go-v2';
const STORE_NAME = 'creatures';
const COMPANION_DATABASE_NAME = 'rapp-go-companion-v2';
const COMPANION_STORE_NAME = 'state';

export class JsonStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.memory = new Map();
  }

  get(key, fallback = null) {
    try {
      const raw = this.storage?.getItem(`${STORAGE_PREFIX}${key}`)
        ?? this.storage?.getItem(`${LEGACY_STORAGE_PREFIX}${key}`);
      if (raw != null) return JSON.parse(raw);
    } catch {}
    return this.memory.has(key) ? this.memory.get(key) : fallback;
  }

  set(key, value) {
    this.memory.set(key, value);
    try { this.storage?.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value)); } catch {}
    return value;
  }

  remove(key) {
    this.memory.delete(key);
    try { this.storage?.removeItem(`${STORAGE_PREFIX}${key}`); } catch {}
  }

  getInventory() {
    const stored = this.get('inventory');
    if (!stored) return this.set('inventory', { ...DEFAULT_INVENTORY });
    return normalizeInventory(stored);
  }
}

export class CollectionStore {
  constructor(indexedDB = globalThis.indexedDB) {
    this.indexedDB = indexedDB;
    this.memory = new Map();
    this.databasePromise = null;
  }

  async database() {
    if (!this.indexedDB) return null;
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve) => {
        try {
          const request = this.indexedDB.open(DATABASE_NAME, 1);
          request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          request.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.databasePromise;
  }

  async put(creature, metadata = {}) {
    const record = {
      ...creature,
      capturedAt: Number(metadata.capturedAt ?? creature.capturedAt ?? Date.now()),
      capture: metadata.capture ?? creature.capture ?? null
    };
    this.memory.set(record.id, record);
    const database = await this.database();
    if (!database) return record;
    await new Promise((resolve) => {
      try {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
        transaction.onabort = resolve;
      } catch { resolve(); }
    });
    return record;
  }

  async list() {
    const database = await this.database();
    if (!database) return [...this.memory.values()].sort((a, b) => b.capturedAt - a.capturedAt);
    const records = await new Promise((resolve) => {
      try {
        const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
    for (const record of records) this.memory.set(record.id, record);
    return records.sort((a, b) => b.capturedAt - a.capturedAt);
  }

  async get(id) {
    const database = await this.database();
    if (!database) return this.memory.get(id) || null;
    return new Promise((resolve) => {
      try {
        const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result || this.memory.get(id) || null);
        request.onerror = () => resolve(this.memory.get(id) || null);
      } catch { resolve(this.memory.get(id) || null); }
    });
  }

  async remove(id) {
    this.memory.delete(id);
    const database = await this.database();
    if (!database) return;
    await new Promise((resolve) => {
      try {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(id);
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
      } catch { resolve(); }
    });
  }
}

export class CompanionStore {
  constructor(indexedDB = globalThis.indexedDB) {
    this.indexedDB = indexedDB;
    this.memory = null;
    this.lineageMemory = null;
    this.databasePromise = null;
  }

  async database() {
    if (!this.indexedDB) return null;
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve) => {
        try {
          const request = this.indexedDB.open(COMPANION_DATABASE_NAME, 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(COMPANION_STORE_NAME)) {
              request.result.createObjectStore(COMPANION_STORE_NAME, { keyPath: 'key' });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          request.onblocked = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    return this.databasePromise;
  }

  async get() {
    const database = await this.database();
    if (!database) return this.memory;
    const value = await new Promise((resolve) => {
      try {
        const request = database.transaction(COMPANION_STORE_NAME, 'readonly').objectStore(COMPANION_STORE_NAME).get('profile');
        request.onsuccess = () => resolve(request.result?.value || null);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    if (value) this.memory = value;
    return value || this.memory;
  }

  async set(profile) {
    this.memory = profile;
    const database = await this.database();
    if (!database) return profile;
    await new Promise((resolve) => {
      try {
        const transaction = database.transaction(COMPANION_STORE_NAME, 'readwrite');
        transaction.objectStore(COMPANION_STORE_NAME).put({ key: 'profile', value: profile });
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
        transaction.onabort = resolve;
      } catch { resolve(); }
    });
    return profile;
  }

  async getLineage() {
    const database = await this.database();
    if (!database) return this.lineageMemory || null;
    const value = await new Promise((resolve) => {
      try {
        const request = database.transaction(COMPANION_STORE_NAME, 'readonly').objectStore(COMPANION_STORE_NAME).get('lineage');
        request.onsuccess = () => resolve(request.result?.value || null);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    if (value) this.lineageMemory = value;
    return value || this.lineageMemory || null;
  }

  async setLineage(lineage) {
    this.lineageMemory = lineage;
    const database = await this.database();
    if (!database) return lineage;
    await new Promise((resolve) => {
      try {
        const transaction = database.transaction(COMPANION_STORE_NAME, 'readwrite');
        transaction.objectStore(COMPANION_STORE_NAME).put({ key: 'lineage', value: lineage });
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
        transaction.onabort = resolve;
      } catch { resolve(); }
    });
    return lineage;
  }
}

export async function resetStoredApp(storage = globalThis.localStorage, indexedDB = globalThis.indexedDB) {
  try {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_PREFIX) || key?.startsWith(LEGACY_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {}
  if (indexedDB) for (const databaseName of [DATABASE_NAME, COMPANION_DATABASE_NAME]) {
    await new Promise((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = resolve;
        request.onerror = resolve;
        request.onblocked = resolve;
      } catch { resolve(); }
    });
  }
}
