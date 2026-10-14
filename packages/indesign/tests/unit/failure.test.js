/**
 * looksLikeFailure decides `success` (and MCP isError) from a script's string
 * result. These cases pin the contract described in src/utils/stringUtils.js.
 */
import assert from 'node:assert/strict';
import { looksLikeFailure, formatResponse } from '../../src/utils/stringUtils.js';

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

test('failure prefixes are failures', () => {
    for (const s of [
        'No document open',
        'No documents open',
        'Error adding page: invalid object',
        'Error: something',
        'Invalid page index',
        'Cannot delete the last spread',
        'Could not find layer',
        'Failed to export',
        'Unable to place file',
    ]) assert.equal(looksLikeFailure(s), true, s);
});

test('short not-found / out-of-range messages are failures', () => {
    assert.equal(looksLikeFailure("Character style 'Body' not found"), true);
    assert.equal(looksLikeFailure('Page index out of range'), true);
    assert.equal(looksLikeFailure('Layer "Art" does not exist'), true);
});

test('success messages and listings are not failures', () => {
    for (const s of [
        'Page added successfully. Total pages: 3',
        'Document created and activated successfully. Document name: Untitled-1',
        'Layers:\n1. Layer 1\n2. Notes: search not found earlier',
        'Errors fixed: 0',
        '',
    ]) assert.equal(looksLikeFailure(s), false, JSON.stringify(s));
    assert.equal(looksLikeFailure({ ok: true }), false);
});

test('formatResponse sets success from the result', () => {
    assert.equal(formatResponse('No document open', 'X').success, false);
    assert.equal(formatResponse('Done', 'X').success, true);
});

console.log(`\n${passed} failure-detection tests passed`);
