/**
 * Tool definition quality: what agents see in tools/list. Every tool needs a
 * useful description, a title, MCP annotations and a described, typed
 * parameter list with consistent required/enum/default values.
 */
import assert from 'node:assert/strict';
import { allToolDefinitions } from '../../src/types/index.js';
import { unknownAnnotationNames } from '../../src/types/annotations.js';

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`ok - ${name}`);
    } catch (e) {
        console.error(`not ok - ${name}`);
        console.error('  ', e.message);
        process.exitCode = 1;
    }
}

const each = (fn) => {
    const problems = [];
    for (const tool of allToolDefinitions) fn(tool, problems);
    assert.deepEqual(problems, []);
};

test('tool names are snake_case and unique', () => each((t, p) => {
    if (!/^[a-z]+(_[a-z]+)*$/.test(t.name)) p.push(t.name);
    if (allToolDefinitions.filter((x) => x.name === t.name).length > 1) p.push(`duplicate ${t.name}`);
}));

test('every tool has a description of at least 35 characters', () => each((t, p) => {
    if ((t.description || '').length < 35) p.push(`${t.name}: "${t.description}"`);
}));

test('every tool has a title and complete annotations', () => each((t, p) => {
    if (!t.title) p.push(`${t.name}: no title`);
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        if (typeof t.annotations?.[k] !== 'boolean') p.push(`${t.name}: ${k}`);
    }
    if (t.annotations?.readOnlyHint && t.annotations?.destructiveHint) p.push(`${t.name}: read-only and destructive`);
}));

test('annotation lists only name real tools', () => {
    assert.deepEqual(unknownAnnotationNames(allToolDefinitions.map((t) => t.name)), []);
});

test('every parameter has a type and a description', () => each((t, p) => {
    for (const [k, v] of Object.entries(t.inputSchema?.properties || {})) {
        if (!v.type && !v.enum && !v.anyOf && !v.oneOf) p.push(`${t.name}.${k}: no type`);
        if (!v.description) p.push(`${t.name}.${k}: no description`);
        if (v.type === 'array' && !v.items) p.push(`${t.name}.${k}: array without items`);
    }
}));

test('required parameters exist, and enums contain their defaults', () => each((t, p) => {
    const props = t.inputSchema?.properties || {};
    for (const r of t.inputSchema?.required || []) if (!(r in props)) p.push(`${t.name}: required '${r}' not defined`);
    for (const [k, v] of Object.entries(props)) {
        if (v.enum && v.default !== undefined && v.default !== null && !v.enum.includes(v.default)) {
            p.push(`${t.name}.${k}: default ${JSON.stringify(v.default)} not in enum`);
        }
        if ('required' in v) p.push(`${t.name}.${k}: 'required' belongs in the schema's required list`);
    }
}));

console.log(`\n${passed} definition tests passed`);
