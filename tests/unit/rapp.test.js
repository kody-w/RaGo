import test from 'node:test';
import assert from 'node:assert/strict';

import { allelesForRappid } from '../../src/lib/allele.js';
import {
  canonical,
  createRappFrame,
  hashBytes,
  hashValue,
  mintLocalRappid,
  nextRappFrame,
  uuidV4Bytes,
  verifyRappFrame
} from '../../src/lib/rapp.js';

const UTC = '2026-09-25T12:00:00.000Z';
const OTHER_STREAM = `rappid:@rago/other:${'0'.repeat(64)}`;
const uuid = (offset) => Uint8Array.from({ length: 16 }, (_value, index) => {
  const byte = (offset + index * 13) & 255;
  return index === 6 ? byte & 0x0f | 0x40 : index === 8 ? byte & 0x3f | 0x80 : byte;
});
const nest = (depth) => {
  let value = 0;
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
};
const b64url = (value) => Buffer.from(value).toString('base64url');
const outcome = async (frame, options = {}) => {
  const result = await verifyRappFrame(frame, options);
  return result.errors.length ? result.step : 'accepted';
};

test('canonical keeps the §4 domain: noncharacters refused, depth counts containers only', () => {
  assert.throws(() => canonical({ a: '\uffff' }), /noncharacter/);
  assert.throws(() => canonical({ '\ufdd0': 1 }), /noncharacter/);
  assert.throws(() => canonical(['\u{10ffff}']), /noncharacter/);
  assert.equal(canonical(nest(64)).length, 129);
  assert.throws(() => canonical(nest(65)), /nesting/);
});

test('H and Hb refuse tags outside §5 and tags of the other function', async () => {
  assert.match(await hashValue('rapp/1:particle', {}), /^[0-9a-f]{64}$/);
  assert.match(await hashBytes('rapp/1:rappid', new Uint8Array(16)), /^[0-9a-f]{64}$/);
  await assert.rejects(hashValue('rapp/1:rappid', {}), /§5/);
  await assert.rejects(hashBytes('rapp/1:particle', new Uint8Array()), /§5/);
  await assert.rejects(hashBytes('rapp/1:allele:coat', new Uint8Array()), /§5/);
});

test('supplied UUID octets must already be version 4, variant 0b10', async () => {
  const version = uuid(1);
  version[6] = 0x1f;
  const variant = uuid(1);
  variant[8] = 0x3f;
  assert.throws(() => uuidV4Bytes(version), /version 4/);
  assert.throws(() => uuidV4Bytes(variant), /version 4/);
  await assert.rejects(mintLocalRappid('sprout', { uuidBytes: version }), /version 4/);
  assert.deepEqual(uuidV4Bytes(uuid(1)), uuid(1));
});

test('conformant identities and their alleles are unchanged', async () => {
  const rappid = await mintLocalRappid('Sprout Leaf 1', { uuidBytes: uuid(1) });
  assert.equal(rappid, 'rappid:@rago/sprout-leaf-1:6401f85e8242a4b8ef3b7e10b10e9398caea6328b49f6ea0e89d9a6863700055');
  const alleles = await allelesForRappid(rappid);
  assert.deepEqual(
    Object.fromEntries(Object.entries(alleles).map(([key, allele]) => [key, allele.hex])),
    { coat: '0x6E', tempo: '0xFF', voice: '0xEF', glow: '0x40FC' }
  );
});

test('the frame producer refuses what rev-17 forbids it to emit', async () => {
  const streamId = await mintLocalRappid('sprout', { uuidBytes: uuid(2) });
  const build = (fields) => createRappFrame({ streamId, utc: UTC, payload: {}, ...fields });
  await assert.rejects(build({ utc: '2026-02-30T00:00:00.000Z' }), /utc/);
  await assert.rejects(build({ utc: '2026-01-01T24:00:00.000Z' }), /utc/);
  await assert.rejects(build({ kind: 'body--x.pulse' }), /kind/);
  await assert.rejects(build({ seq: -0 }), /uint53/);
  await assert.rejects(build({ payload: { 'cafe\u0301': 1 } }), /NFC/);
  await assert.rejects(build({ payload: { '\u0378': 1 } }), /unassigned/);
  await assert.rejects(build({ payload: { a: '\uffff' } }), /noncharacter/);
  await assert.rejects(build({ sig: 'not-a-jws' }), /JWS/);
  assert.equal((await build({ utc: '2024-02-29T23:59:59.999Z' })).seq, 0);
});

test('the frame consumer reports the first failing §7.5 step', async () => {
  const streamId = await mintLocalRappid('sprout', { uuidBytes: uuid(3) });
  const genesis = await createRappFrame({ streamId, utc: UTC, payload: { a: 1 } });
  const next = await nextRappFrame(genesis, { a: 2 }, { now: Date.parse(UTC) + 1 });
  const header = canonical({ alg: 'EdDSA', b64: false, crit: ['b64'], kid: streamId });
  const signed = await createRappFrame({ streamId, utc: UTC, payload: {}, sig: `${b64url(header)}..${b64url(new Uint8Array(64))}` });
  assert.equal(await outcome(next, { head: genesis, expectedStreamId: streamId }), 'accepted');
  assert.equal(await outcome(next), '4');
  assert.equal(await outcome({ ...next, seq: 5 }, { head: genesis }), '3');
  assert.equal(await outcome({ ...genesis, seq: 2 ** 53 }, { expectedStreamId: OTHER_STREAM }), '1');
  assert.equal(await outcome(genesis, { expectedStreamId: OTHER_STREAM }), '1a');
  assert.equal(await outcome({ ...genesis, utc: '2026-02-30T00:00:00.000Z' }), '1');
  assert.equal(await outcome({ ...genesis, sig: 'a..b' }), '1');
  assert.equal(await outcome(signed), '6');
  assert.equal(await outcome({ ...genesis, payload: { a: '\uffff' } }), null);
});
