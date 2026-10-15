/**
 * Tools written as modules (src/tools): each claims atlas features that exist,
 * declares valid hints, and its handler refuses bad arguments before anything
 * runs. Their scripts are covered by the script audit with every other tool.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moduleTools } from '../../src/tools/index.js';
import { allToolDefinitions } from '../../src/types/index.js';

import { test, done } from './helpers.js';

const featureIds = new Set(JSON.parse(readFileSync(new URL('../fixtures/feature-ids.json', import.meta.url), 'utf8')).ids);
const HINTS = new Set(['readOnly', 'destructive', 'idempotent', 'openWorld']);

await test('every module tool claims atlas features that exist', () => {
    for (const t of moduleTools) {
        assert.ok(t.features?.length, `${t.name} claims no feature`);
        for (const f of t.features) assert.ok(featureIds.has(f), `${t.name}: unknown feature ${f}`);
    }
});

await test('module tools are advertised once, with valid hints', () => {
    const names = allToolDefinitions.map((t) => t.name);
    for (const t of moduleTools) {
        assert.equal(names.filter((n) => n === t.name).length, 1, `${t.name} advertised ${names.filter((n) => n === t.name).length} times`);
        for (const k of Object.keys(t.hints ?? {})) assert.ok(HINTS.has(k), `${t.name}: unknown hint ${k}`);
        assert.equal(typeof t.handler, 'function', t.name);
    }
});

await test('turn_items refuses an unknown operation and empty targets', async () => {
    const turn = moduleTools.find((t) => t.name === 'turn_items');
    assert.throws(() => turn.handler({ target: { ids: [1] }, operation: 'spin' }), /Allowed: rotate_90_cw/);
    assert.throws(() => turn.handler({ target: {}, operation: 'rotate_180' }), /Choose the items/);
});

done();
