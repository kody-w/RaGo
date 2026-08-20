import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPECIES_CATALOG } from '../src/data/species.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const entries = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'sw.js',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'registry.json',
  'api',
  'src'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of entries) await cp(join(root, entry), join(output, entry), { recursive: true });
await mkdir(join(output, 'vendor'), { recursive: true });
await cp(join(root, 'node_modules/three/build/three.module.js'), join(output, 'vendor/three.module.js'));
await cp(join(root, 'node_modules/three/build/three.core.js'), join(output, 'vendor/three.core.js'));
await writeFile(join(output, 'api/v1/species.json'), `${JSON.stringify({
  schema: 'rapp-go-species-catalog/1.0',
  product: 'RaGo',
  version: '2.2.0',
  count: SPECIES_CATALOG.length,
  species: SPECIES_CATALOG
}, null, 2)}\n`);
await writeFile(join(output, '.nojekyll'), '');
await cp(join(root, 'index.html'), join(output, '404.html'));
console.log(`Built ${entries.length} entries into dist/`);
