// RAPP/1 identity and body-frame primitives used by RaGo.
//
// RaGo creates keyless local RAPPIDs under an application namespace. Their
// byte integrity and frame continuity are verifiable; estate authority remains
// explicitly unlinked because the app has no account, owner key, or §13 root.

export const RAPP_SPEC = 'rapp/1';
export const LOCAL_RAPPID_OWNER = 'rago';
export const LOCAL_BODY_KINDS = Object.freeze(new Set(['body.pulse']));

const FRAME_KEYS = Object.freeze([
  'frame_hash', 'kind', 'payload', 'payload_hash', 'prev', 'prev_wave',
  'seq', 'sig', 'spec', 'stream_id', 'utc'
]);
const RAPPID_RE = /^rappid:@([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*):([0-9a-f]{64})$/;
const KIND_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d\.\d{3}Z$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function hasUnpairedSurrogate(value) {
  return !/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/.test(value);
}

function assertJson(value, depth = 1, seen = new Set()) {
  if (depth > 64) throw new TypeError('JSON nesting exceeds 64');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) throw new TypeError('string contains an unpaired surrogate');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('value is not I-JSON');
  if (seen.has(value)) throw new TypeError('cyclic values are not JSON');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, depth + 1, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (hasUnpairedSurrogate(key)) throw new TypeError('object key contains an unpaired surrogate');
      assertJson(item, depth + 1, seen);
    }
  }
  seen.delete(value);
}

export function canonical(value) {
  assertJson(value);
  function encode(item) {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
  }
  const output = encode(value);
  if (new TextEncoder().encode(output).byteLength > 1024 * 1024) {
    throw new TypeError('canonical form exceeds 1 MiB');
  }
  return output;
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashValue(space, value) {
  const prefix = new TextEncoder().encode(`${space}\n`);
  const body = new TextEncoder().encode(canonical(value));
  const bytes = new Uint8Array(prefix.length + body.length);
  bytes.set(prefix);
  bytes.set(body, prefix.length);
  return sha256(bytes);
}

export async function hashBytes(space, value) {
  const prefix = new TextEncoder().encode(`${space}\n`);
  const body = value instanceof Uint8Array ? value : new Uint8Array(value);
  const bytes = new Uint8Array(prefix.length + body.length);
  bytes.set(prefix);
  bytes.set(body, prefix.length);
  return sha256(bytes);
}

export async function localObjectHash(value) {
  return sha256(new TextEncoder().encode(canonical(value)));
}

export function slugify(value, fallback = 'rappid') {
  const slug = String(value || '').toLowerCase()
    .replace(/^@/u, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
    .slice(0, 100)
    .replace(/-+$/gu, '');
  return slug || fallback;
}

export function uuidV4Bytes(input = null) {
  const bytes = input == null ? crypto.getRandomValues(new Uint8Array(16)) : new Uint8Array(input);
  if (bytes.length !== 16) throw new TypeError('UUIDv4 input must be exactly 16 octets');
  const output = new Uint8Array(bytes);
  output[6] = output[6] & 0x0f | 0x40;
  output[8] = output[8] & 0x3f | 0x80;
  return output;
}

export async function mintLocalRappid(slug, { uuidBytes = null } = {}) {
  const label = slugify(slug);
  const tail = await hashBytes('rapp/1:rappid', uuidV4Bytes(uuidBytes));
  return `rappid:@${LOCAL_RAPPID_OWNER}/${label}:${tail}`;
}

export function parseRappid(rappid) {
  const match = RAPPID_RE.exec(String(rappid || ''));
  if (!match || match[1].length > 39 || match[2].length > 100) return null;
  return { owner: match[1], slug: match[2], tail: match[3] };
}

export function rappidTail(rappid) {
  const parsed = parseRappid(rappid);
  if (!parsed) throw new TypeError('invalid canonical RAPPID');
  return parsed.tail;
}

export function utcFrom(now = Date.now()) {
  const utc = new Date(Number(now)).toISOString();
  if (!UTC_RE.test(utc)) throw new TypeError('time must produce canonical millisecond UTC');
  return utc;
}

function waveValue(frame) {
  const value = { ...frame };
  delete value.frame_hash;
  delete value.sig;
  return value;
}

export async function createRappFrame({
  kind = 'body.pulse',
  streamId,
  seq = 0,
  utc = utcFrom(),
  payload = {},
  prev = null,
  sig = null
}) {
  if (!parseRappid(streamId)) throw new TypeError('body stream_id must be a canonical RAPPID');
  if (!KIND_RE.test(kind)) throw new TypeError('kind must match the RAPP/1 grammar');
  if (!Number.isSafeInteger(seq) || seq < 0) throw new TypeError('seq must be uint53');
  if (!UTC_RE.test(utc) || Number.isNaN(Date.parse(utc))) throw new TypeError('utc must use canonical millisecond UTC');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('payload must be an object');
  if (seq === 0 && prev !== null) throw new TypeError('genesis prev must be null');
  if (seq > 0 && !HASH_RE.test(prev || '')) throw new TypeError('non-genesis prev must be a particle hash');
  const frame = {
    spec: RAPP_SPEC,
    kind,
    stream_id: streamId,
    seq,
    utc,
    payload,
    payload_hash: await hashValue('rapp/1:particle', payload),
    frame_hash: '',
    prev,
    prev_wave: null,
    sig
  };
  frame.frame_hash = await hashValue('rapp/1:wave', waveValue(frame));
  return frame;
}

export async function nextRappFrame(head, payload, { now = Date.now(), kind = null } = {}) {
  const checked = await verifyRappFrame(head, { expectedStreamId: head?.stream_id });
  if (checked.errors.length) throw new TypeError(`cannot extend an invalid head: ${checked.errors.join('; ')}`);
  const utc = utcFrom(now);
  if (utc < head.utc) throw new TypeError('successor utc cannot precede its head');
  return createRappFrame({
    kind: kind || head.kind,
    streamId: head.stream_id,
    seq: head.seq + 1,
    utc,
    payload,
    prev: head.payload_hash
  });
}

export function rappFrameErrors(frame, {
  expectedStreamId = null,
  head = null,
  registeredKinds = LOCAL_BODY_KINDS
} = {}) {
  const errors = [];
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return ['frame must be an object'];
  if (Object.keys(frame).sort().join('\n') !== [...FRAME_KEYS].sort().join('\n')) errors.push('frame must have exactly eleven RAPP/1 keys');
  if (frame.spec !== RAPP_SPEC) errors.push('spec must be rapp/1');
  if (!KIND_RE.test(frame.kind || '')) errors.push('kind is invalid');
  else if (registeredKinds && !registeredKinds.has(frame.kind)) errors.push('kind is not in the local registry view');
  if (!parseRappid(frame.stream_id)) errors.push('stream_id is not a canonical body-stream RAPPID');
  if (expectedStreamId && frame.stream_id !== expectedStreamId) errors.push('stream binding failed');
  if (!Number.isSafeInteger(frame.seq) || frame.seq < 0) errors.push('seq is not uint53');
  if (!UTC_RE.test(frame.utc || '') || Number.isNaN(Date.parse(frame.utc))) errors.push('utc is invalid');
  if (!frame.payload || typeof frame.payload !== 'object' || Array.isArray(frame.payload)) errors.push('payload must be an object');
  if (!HASH_RE.test(frame.payload_hash || '')) errors.push('payload_hash is invalid');
  if (!HASH_RE.test(frame.frame_hash || '')) errors.push('frame_hash is invalid');
  if (frame.prev !== null && !HASH_RE.test(frame.prev || '')) errors.push('prev is invalid');
  if (frame.prev_wave !== null) errors.push('body stream prev_wave must be null');
  if (frame.sig !== null && typeof frame.sig !== 'string') errors.push('sig must be null or a JWS string');
  if (frame.seq === 0 && frame.prev !== null) errors.push('genesis prev must be null');
  if (frame.seq > 0 && frame.prev === null) errors.push('successor prev is required');
  if (head) {
    if (frame.stream_id !== head.stream_id) errors.push('successor stream differs from head');
    if (frame.seq !== head.seq + 1) errors.push('successor seq is not contiguous');
    if (frame.prev !== head.payload_hash) errors.push('successor prev does not match head particle');
    if (frame.utc < head.utc) errors.push('successor utc precedes head');
  }
  return errors;
}

export async function verifyRappFrame(frame, options = {}) {
  const errors = rappFrameErrors(frame, options);
  if (!errors.length && await hashValue('rapp/1:particle', frame.payload) !== frame.payload_hash) {
    errors.push('particle hash mismatch');
  }
  if (!errors.length && await hashValue('rapp/1:wave', waveValue(frame)) !== frame.frame_hash) {
    errors.push('wave hash mismatch');
  }
  return {
    errors,
    integrity: errors.length ? 'refused' : 'verified',
    authority: 'unlinked'
  };
}
