import test from 'node:test';
import assert from 'node:assert/strict';
import {
    autoCaptureResult, wrapScriptForStructuredResult, parseStructuredResult,
    looksLikeFailure, createFailureDetector, formatResponse, withWarnings,
} from '../src/index.js';
import { checkScript, loadTypings } from '../src/testing/audit.js';

test('autoCaptureResult assigns the trailing expression', () => {
    const out = autoCaptureResult('var x = 1;\n"hello";');
    assert.ok(out.includes('var __result__ = "hello"'));
});

test('autoCaptureResult follows an expression across lines', () => {
    const out = autoCaptureResult('var a = 1;\n"x" +\n  a;');
    assert.match(out, /var __result__ = "x" \+/);
});

test('autoCaptureResult leaves statements and explicit results alone', () => {
    assert.equal(autoCaptureResult('var __result__ = 1;\n__result__;'), 'var __result__ = 1;\n__result__;');
    assert.equal(autoCaptureResult('var a = 1;\nreturnValue(a);\nvar b = 2;'), 'var a = 1;\nreturnValue(a);\nvar b = 2;');
});

test('autoCaptureResult captures the last expression inside a trailing block, as ExtendScript evaluates it', () => {
    assert.equal(autoCaptureResult('if (a) {\n  b();\n}'), 'if (a) {\n  var __result__ = b();\n}');
});

test('the structured wrapper is ES3-safe JavaScript', () => {
    const wrapped = wrapScriptForStructuredResult('var d = app.activeDocument;\nd.name;');
    const findings = checkScript(wrapped, { members: new Set(['activeDocument', 'name', 'message', 'charAt', 'charCodeAt', 'length', 'toString', 'slice']), globals: new Set(['app', 'String', 'undefined']) });
    assert.deepEqual(findings, []);
    assert.ok(wrapped.includes('__payload'));
});

test('parseStructuredResult handles JSON, legacy strings and empty output', () => {
    assert.deepEqual(parseStructuredResult('{"ok":true,"result":"hi"}').result, 'hi');
    assert.equal(parseStructuredResult('{"ok":false,"error":"boom"}').error, 'boom');
    assert.equal(parseStructuredResult('ERROR: boom').ok, false);
    assert.equal(parseStructuredResult('Document created').ok, true);
    assert.match(parseStructuredResult('', { appLabel: 'Illustrator' }).error, /Empty response from Illustrator/);
});

test('looksLikeFailure recognises the failure contract', () => {
    for (const s of ['No document open', 'There is no document', 'Error adding page: x', 'Failed to export', 'Swatch not found']) {
        assert.equal(looksLikeFailure(s), true, s);
    }
    for (const s of ['Document created', 'Exported 3 artboards', 'Found 0 matches\nnot found in story 2']) {
        assert.equal(looksLikeFailure(s), false, s);
    }
    assert.equal(looksLikeFailure({ success: false }), false);
});

test('a server can add failure patterns', () => {
    const detect = createFailureDetector({ start: [/^artboard \d+ is empty/i] });
    assert.equal(detect('Artboard 2 is empty'), true);
    assert.equal(formatResponse('Artboard 2 is empty', 'Export', detect).success, false);
});

test('withWarnings appends to objects only', () => {
    assert.deepEqual(withWarnings({ a: 1 }, ['w']), { a: 1, warnings: ['w'] });
    assert.deepEqual(withWarnings({ a: 1, warnings: ['x'] }, ['w']).warnings, ['x', 'w']);
    assert.equal(withWarnings('text', ['w']), 'text');
    assert.deepEqual(withWarnings({ a: 1 }, []), { a: 1 });
});

test('checkScript reports ES5 violations and unknown names', () => {
    const typings = loadTypings({ files: [], allowedNames: ['activeDocument'] });
    assert.match(checkScript('let x = 1;', typings)[0], /parse error/);
    assert.match(checkScript('app.activeDocument.notAMember;', typings).join(), /unknown member: \.notAMember/);
    assert.match(checkScript('mystery();', typings).join(), /unknown global: mystery/);
    assert.deepEqual(checkScript('var o = {}; o.anything = 1; app.activeDocument;', typings), []);
});
