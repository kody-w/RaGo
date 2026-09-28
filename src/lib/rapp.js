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
const KIND_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const LCLABEL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):[0-5]\d\.\d{3}Z$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const B64URL_RE = /^[A-Za-z0-9_-]*$/;
// §5 (rev-17 E-7): every tag belongs to exactly one function; any other tag is refused.
const H_SPACES = Object.freeze(new Set([
  'rapp/1:particle', 'rapp/1:wave', 'rapp/1:egg-manifest', 'rapp/1:sealed-aad', 'rapp/1:sealed-key-request'
]));
const HB_SPACES = Object.freeze(new Set(['rapp/1:egg', 'rapp/1:rappid', 'rapp/1:grail', 'rapp/1:seal']));
const isHash = (value) => typeof value === 'string' && HASH_RE.test(value);
// §7.4 (rev-17 E-9): uint53 excludes -0.
const isUint53 = (value) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

function hasUnpairedSurrogate(value) {
  return !/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/.test(value);
}

// §4 (b), rev-17 E-3: U+FDD0-U+FDEF and every code point whose low 16 bits are FFFE or FFFF.
function hasNoncharacter(value) {
  for (const char of value) {
    const point = char.codePointAt(0);
    if ((point >= 0xfdd0 && point <= 0xfdef) || (point & 0xfffe) === 0xfffe) return true;
  }
  return false;
}

function assertJson(value, depth = 1, seen = new Set()) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) throw new TypeError('string contains an unpaired surrogate');
    if (hasNoncharacter(value)) throw new TypeError('string contains a Unicode noncharacter');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('value is not I-JSON');
  if (depth > 64) throw new TypeError('JSON nesting exceeds 64');
  if (seen.has(value)) throw new TypeError('cyclic values are not JSON');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, depth + 1, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (hasUnpairedSurrogate(key)) throw new TypeError('object key contains an unpaired surrogate');
      if (hasNoncharacter(key)) throw new TypeError('object key contains a Unicode noncharacter');
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
  if (!H_SPACES.has(space)) throw new TypeError(`H is used only with the §5 value tags; refused ${String(space)}`);
  const prefix = new TextEncoder().encode(`${space}\n`);
  const body = new TextEncoder().encode(canonical(value));
  const bytes = new Uint8Array(prefix.length + body.length);
  bytes.set(prefix);
  bytes.set(body, prefix.length);
  return sha256(bytes);
}

export async function hashBytes(space, value) {
  if (!HB_SPACES.has(space)) throw new TypeError(`Hb is used only with the §5 octet tags; refused ${String(space)}`);
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
  if (input == null) {
    const output = crypto.getRandomValues(new Uint8Array(16));
    output[6] = output[6] & 0x0f | 0x40;
    output[8] = output[8] & 0x3f | 0x80;
    return output;
  }
  const bytes = new Uint8Array(input);
  if (bytes.length !== 16) throw new TypeError('UUIDv4 input must be exactly 16 octets');
  // §6.2 (rev-17 E-8): supplied octets that are not a UUIDv4 are refused, never repaired.
  if (bytes[6] >> 4 !== 4 || bytes[8] >> 6 !== 0b10) throw new TypeError('UUID octets must be version 4, variant 0b10');
  return bytes;
}

export async function mintLocalRappid(slug, { uuidBytes = null } = {}) {
  const label = slugify(slug);
  const tail = await hashBytes('rapp/1:rappid', uuidV4Bytes(uuidBytes));
  return `rappid:@${LOCAL_RAPPID_OWNER}/${label}:${tail}`;
}

export function parseRappid(rappid) {
  const match = typeof rappid === 'string' ? RAPPID_RE.exec(rappid) : null;
  if (!match || match[1].length > 39 || match[2].length > 100) return null;
  return { owner: match[1], slug: match[2], tail: match[3] };
}

export function rappidTail(rappid) {
  const parsed = parseRappid(rappid);
  if (!parsed) throw new TypeError('invalid canonical RAPPID');
  return parsed.tail;
}

// §7.4 (rev-17 E-1): the fixed ASCII form and a calendar-valid time (years 0000-9999, second 00-59).
function utcValid(value) {
  const match = typeof value === 'string' ? UTC_RE.exec(value) : null;
  if (!match) return false;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59;
}

// §6.1.1: kind = lclabel "." lclabel, each label 1-64 characters.
function kindValid(kind) {
  const match = typeof kind === 'string' ? KIND_RE.exec(kind) : null;
  return Boolean(match && match[1].length <= 64 && match[2].length <= 64);
}

function streamForm(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('net:')) return LCLABEL_RE.test(value.slice(4)) ? 'swarm-stream' : null;
  if (parseRappid(value)) return 'body-stream';
  const cut = value.lastIndexOf(':');
  const instance = value.slice(cut + 1);
  return cut > 0 && parseRappid(value.slice(0, cut)) && LCLABEL_RE.test(instance) && instance.length <= 64
    ? 'memory-stream'
    : null;
}

function base64UrlDecode(value) {
  if (typeof value !== 'string' || !B64URL_RE.test(value) || value.length % 4 === 1) {
    throw new TypeError('base64url value must be unpadded');
  }
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  if (btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== value) {
    throw new TypeError('base64url value is not canonical');
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// §10 detached JWS form and protected-header profile, as §7.5 step 1 checks it. No cryptography.
export function parseDetachedJws(sig) {
  const parts = typeof sig === 'string' ? sig.split('.') : [];
  if (parts.length !== 3 || parts[1] !== '') throw new TypeError('JWS must use detached compact serialization');
  const headerText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(base64UrlDecode(parts[0]));
  const header = JSON.parse(headerText);
  if (!header || typeof header !== 'object' || Array.isArray(header)
    || Object.keys(header).sort().join() !== 'alg,b64,crit,kid') {
    throw new TypeError('JWS protected header must have exactly alg, b64, crit, kid');
  }
  if (header.alg !== 'EdDSA' && header.alg !== 'ES256') throw new TypeError('JWS alg must be EdDSA or ES256');
  if (header.b64 !== false || !Array.isArray(header.crit) || header.crit.length !== 1 || header.crit[0] !== 'b64') {
    throw new TypeError('JWS must use b64 false with crit ["b64"]');
  }
  if (!parseRappid(header.kid)) throw new TypeError('JWS kid must be a canonical RAPPID');
  if (canonical(header) !== headerText) throw new TypeError('JWS protected header is not canonical');
  const signature = base64UrlDecode(parts[2]);
  if (signature.length !== 64) throw new TypeError('JWS signature must be exactly 64 octets');
  return { header, protected: parts[0], signature };
}

const isRegenesis = (kind) => kindValid(kind) && kind.endsWith('.re-genesis');

// §12.1 step 2 (rev-17 E-22): the one re-genesis payload shape.
function regenesisPayloadError(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).join() !== 'migrated_from') {
    return 're-genesis payload must be exactly {"migrated_from": {...}}';
  }
  const moved = payload.migrated_from;
  if (!moved || typeof moved !== 'object' || Array.isArray(moved)
    || Object.keys(moved).sort().join() !== 'stream_id,terminal_seal,terminal_seq') {
    return 're-genesis migrated_from must be exactly stream_id, terminal_seal, terminal_seq';
  }
  if (!streamForm(moved.stream_id)) return 're-genesis migrated_from.stream_id is not a stream_id';
  if (!isHash(moved.terminal_seal)) return 're-genesis migrated_from.terminal_seal is not 64 lowercase hex';
  if (!isUint53(moved.terminal_seq)) return 're-genesis migrated_from.terminal_seq is not uint53';
  return null;
}

const UNASSIGNED_RE = /\p{Cn}/u;

// §4 (rev-17 E-5, E-6): a producer refuses, never normalizes, a payload member name that is not NFC or that
// holds a code point unassigned in the Unicode version this JavaScript engine implements.
function assertPayloadNames(value) {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (current && typeof current === 'object') {
      for (const [name, item] of Object.entries(current)) {
        if (name.normalize('NFC') !== name) throw new TypeError('payload member names must be NFC');
        if (UNASSIGNED_RE.test(name)) throw new TypeError('payload member names must not hold unassigned code points');
        stack.push(item);
      }
    }
  }
}

export function utcFrom(now = Date.now()) {
  const utc = new Date(Number(now)).toISOString();
  if (!utcValid(utc)) throw new TypeError('time must produce canonical millisecond UTC');
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
  if (!kindValid(kind)) throw new TypeError('kind must match the RAPP/1 grammar');
  if (!isUint53(seq)) throw new TypeError('seq must be uint53');
  if (!utcValid(utc)) throw new TypeError('utc must use canonical millisecond UTC');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('payload must be an object');
  assertPayloadNames(payload);
  if (seq === 0 && prev !== null) throw new TypeError('genesis prev must be null');
  if (seq > 0 && !isHash(prev)) throw new TypeError('non-genesis prev must be a particle hash');
  if (sig !== null) parseDetachedJws(sig);
  if (isRegenesis(kind)) {
    if (seq !== 0 || sig === null) throw new TypeError('a re-genesis frame is an owner-signed genesis');
    const why = regenesisPayloadError(payload);
    if (why) throw new TypeError(why);
  }
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
  canonical(frame);
  return frame;
}

export async function nextRappFrame(head, payload, { now = Date.now(), kind = null } = {}) {
  // The head's own chain position was verified when it was accepted; here only its integrity is rechecked.
  const checked = await verifyRappFrame(head, { expectedStreamId: head?.stream_id, chain: false });
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

// The synchronous §7.5 checks as [step, message] pairs; steps 2 and 3 (the hashes) are added by verifyRappFrame.
function frameChecks(frame, {
  expectedStreamId = null,
  head = null,
  registeredKinds = LOCAL_BODY_KINDS,
  chain = true
} = {}) {
  try {
    canonical(frame);
  } catch (error) {
    return [[null, `frame is not an I-JSON value: ${error.message}`]];
  }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return [['1', 'frame must be an object']];
  const checks = [];
  const fail = (step, message) => checks.push([step, message]);
  if (Object.keys(frame).sort().join('\n') !== [...FRAME_KEYS].sort().join('\n')) fail('1', 'frame must have exactly eleven RAPP/1 keys');
  if (frame.spec !== RAPP_SPEC) fail('1', 'spec must be rapp/1');
  if (!kindValid(frame.kind)) fail('1', 'kind is invalid');
  else if (registeredKinds && !registeredKinds.has(frame.kind)) fail('1', 'kind is not in the local registry view');
  if (!parseRappid(frame.stream_id)) fail('1', 'stream_id is not a canonical body-stream RAPPID');
  if (!isUint53(frame.seq)) fail('1', 'seq is not uint53');
  if (!utcValid(frame.utc)) fail('1', 'utc is invalid');
  if (!frame.payload || typeof frame.payload !== 'object' || Array.isArray(frame.payload)) fail('1', 'payload must be an object');
  if (!isHash(frame.payload_hash)) fail('1', 'payload_hash is invalid');
  if (!isHash(frame.frame_hash)) fail('1', 'frame_hash is invalid');
  if (frame.prev !== null && !isHash(frame.prev)) fail('1', 'prev is invalid');
  if (frame.prev_wave !== null && !isHash(frame.prev_wave)) fail('1', 'prev_wave is invalid');
  if (frame.sig !== null) {
    try {
      parseDetachedJws(frame.sig);
    } catch (error) {
      fail('1', `sig must be null or a detached JWS: ${error.message}`);
    }
  }
  const regenesis = isRegenesis(frame.kind);
  const regenesisError = regenesis ? regenesisPayloadError(frame.payload) : null;
  if (regenesisError) fail('1', regenesisError);
  if (expectedStreamId && frame.stream_id !== expectedStreamId) fail('1a', 'stream binding failed');
  if (head && frame.stream_id !== head.stream_id) fail('1a', 'successor stream differs from head');
  if (regenesis && (frame.seq !== 0 || frame.prev !== null)) fail('4', 'a re-genesis frame must be a genesis');
  if (frame.seq === 0 && frame.prev !== null) fail('4', 'genesis prev must be null');
  if (frame.seq > 0 && frame.prev === null) fail('4', 'successor prev is required');
  if (head) {
    if (frame.seq !== head.seq + 1) fail('4', 'successor seq is not contiguous');
    if (frame.prev !== head.payload_hash) fail('4', 'successor prev does not match head particle');
    if (frame.utc < head.utc) fail('4', 'successor utc precedes head');
  } else if (chain && frame.seq !== 0) {
    fail('4', 'a frame without a head must be the genesis');
  }
  if (frame.prev_wave !== null) fail('5', 'body stream prev_wave must be null');
  if (frame.sig !== null) fail('6', 'a signed frame cannot be verified: RaGo has no key discovery');
  else if (regenesis) fail('6', 'a re-genesis frame must be owner-signed');
  return checks;
}

export function rappFrameErrors(frame, options = {}) {
  return frameChecks(frame, options).map(([, message]) => message);
}

const STEP_ORDER = [null, '1', '1a', '2', '3', '4', '5', '6'];

export async function verifyRappFrame(frame, options = {}) {
  const checks = frameChecks(frame, options);
  if (!checks.some(([step]) => step === null || step === '1')) {
    if (await hashValue('rapp/1:particle', frame.payload) !== frame.payload_hash) checks.push(['2', 'particle hash mismatch']);
    if (await hashValue('rapp/1:wave', waveValue(frame)) !== frame.frame_hash) checks.push(['3', 'wave hash mismatch']);
  }
  // §7.5 order: the first failing checklist step is the one reported.
  checks.sort((left, right) => STEP_ORDER.indexOf(left[0]) - STEP_ORDER.indexOf(right[0]));
  const errors = checks.map(([, message]) => message);
  return {
    errors,
    step: errors.length ? checks[0][0] : null,
    integrity: errors.length ? 'refused' : 'verified',
    authority: 'unlinked'
  };
}
