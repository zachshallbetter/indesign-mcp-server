// The test run must never reach a real Illustrator: the executor refuses under node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executor } from '../src/executor.js';

test('scripts cannot reach Illustrator during tests', async () => {
    await assert.rejects(executor.runScript('var x = 1;'), /Tests must not run scripts in Illustrator/);
});
