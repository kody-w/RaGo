// Honest visual alleles derived only from a mint-once RAPPID tail.

import { hashBytes, rappidTail } from './rapp.js';

export const TRAITS = Object.freeze([
  Object.freeze({ key: 'coat', bits: 8 }),
  Object.freeze({ key: 'tempo', bits: 8 }),
  Object.freeze({ key: 'voice', bits: 8 }),
  Object.freeze({ key: 'glow', bits: 16 })
]);

export function glowTier(value) {
  if (value === 0xffff) return { name: 'mythic', odds: '1 in 65,536' };
  if (value >= 0xff00) return { name: 'ultra', odds: '~1 in 257' };
  if (value >= 0xf000) return { name: 'rare', odds: '~1 in 17' };
  if (value >= 0xc000) return { name: 'uncommon', odds: '~1 in 5' };
  return { name: 'common', odds: '3 in 4' };
}

export async function allelesForRappid(rappid) {
  const tail = rappidTail(rappid);
  const output = {};
  for (const trait of TRAITS) {
    const digest = await hashBytes(`rapp/1:allele:${trait.key}`, new TextEncoder().encode(tail));
    const value = parseInt(digest.slice(0, trait.bits / 4), 16);
    output[trait.key] = {
      value,
      bits: trait.bits,
      hex: `0x${value.toString(16).padStart(trait.bits / 4, '0').toUpperCase()}`,
      tier: trait.bits === 16 ? glowTier(value) : null
    };
  }
  return output;
}
