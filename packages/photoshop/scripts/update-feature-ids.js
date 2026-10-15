#!/usr/bin/env node
/**
 * Regenerate tests/fixtures/feature-ids.json from the capability atlas's Photoshop
 * features (corpus/photoshop/features/*.json), so the tests can check
 * every id a tool claims without the atlas checked out. Run it when the atlas
 * changes:
 *
 *   node scripts/update-feature-ids.js <path to adobe-capability-atlas>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const atlas = process.argv[2];
if (!atlas) {
    console.error('usage: node scripts/update-feature-ids.js <path to adobe-capability-atlas>');
    process.exit(1);
}
const dir = path.join(atlas, 'corpus', 'photoshop', 'features');
const ids = [];
for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || file === 'taxonomy.json') continue;
    for (const feature of JSON.parse(readFileSync(path.join(dir, file), 'utf8'))) ids.push(feature.id);
}
ids.sort();
const note = 'Photoshop feature ids from the capability atlas. A tool may claim only ids listed here.';
const out = new URL('../tests/fixtures/feature-ids.json', import.meta.url);
writeFileSync(out, `{\n"note": ${JSON.stringify(note)},\n"ids": [\n${ids.map((i) => JSON.stringify(i)).join(',\n')}\n]\n}`);
console.log(`${ids.length} feature ids written to tests/fixtures/feature-ids.json`);
