import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
    str, num, index, bool, enumOf, json, numList, measure,
    buildAllowedDirs, validateFilePath, jsxPath, createPathPolicy,
} from '../src/index.js';

test('str escapes quotes and control characters', () => {
    assert.equal(str('hello'), '"hello"');
    assert.equal(str('a"b'), '"a\\"b"');
    assert.ok(str('line\nbreak').includes('\\n'));
    assert.equal(str(null), '""');
});

test('str keeps injection payloads inside the string literal', () => {
    const evil = '"); app.system("rm -rf /"); ("';
    const out = str(evil);
    assert.ok(out.startsWith('"') && out.endsWith('"'));
    assert.equal(JSON.parse(out), evil);
});

test('str and json escape the JS line separators', () => {
    assert.equal(str('a\u2028b\u2029c'), '"a\\u2028b\\u2029c"');
    assert.equal(json(['\u2028']), '["\\u2028"]');
});

test('num validates finite numbers and ranges', () => {
    assert.equal(num(12), '12');
    assert.equal(num('3.5', { name: 'x' }), '3.5');
    assert.throws(() => num('nope', { name: 'x' }), /Invalid number for 'x'/);
    assert.throws(() => num(99999, { min: 0, max: 10, name: 'x' }), /out of range/);
    assert.throws(() => num(Infinity));
});

test('index requires a non-negative integer', () => {
    assert.equal(index(0), '0');
    assert.throws(() => index(-1));
    assert.throws(() => index(1.5));
    assert.throws(() => index('1; app.quit()'));
});

test('bool never passes a string through', () => {
    assert.equal(bool(true), 'true');
    assert.equal(bool('yes'), 'true');
    assert.equal(bool(''), 'false');
});

test('enumOf allows only listed values', () => {
    assert.equal(enumOf('CMYK', ['CMYK', 'RGB']), 'CMYK');
    assert.throws(() => enumOf('CMYK); app.quit(', ['CMYK', 'RGB'], { name: 'colorMode' }), /Allowed: CMYK, RGB/);
});

test('numList and measure', () => {
    assert.equal(numList([0, 50.5, 100], { min: 0, max: 100 }), '0, 50.5, 100');
    assert.throws(() => numList([0, 101], { max: 100 }));
    assert.throws(() => numList('1,2'));
    assert.equal(measure(20, { unit: 'mm' }), '"20mm"');
    assert.throws(() => measure(1, { unit: 'parsecs' }));
});

test('paths: home is always allowed, system directories never', () => {
    const allowed = buildAllowedDirs('ADOBE_MCP_TEST_DIRS');
    assert.ok(allowed.includes(path.resolve(os.homedir())));
    const inside = path.join(os.homedir(), 'Documents', 'a.ai');
    assert.equal(validateFilePath(inside, allowed), path.resolve(inside));
    assert.throws(() => validateFilePath('/etc/passwd', allowed), /outside the allowed directories/);
    assert.throws(() => validateFilePath('', allowed), /Invalid file path/);
});

test('paths: the env variable adds directories', () => {
    const extra = path.resolve(os.tmpdir(), 'adobe-mcp-core-extra');
    process.env.ADOBE_MCP_TEST_DIRS = extra;
    try {
        const policy = createPathPolicy({ envVar: 'ADOBE_MCP_TEST_DIRS' });
        assert.ok(policy.allowedDirs().includes(extra));
        assert.equal(policy.validate(path.join(extra, 'x.pdf')), path.join(extra, 'x.pdf'));
    } finally {
        delete process.env.ADOBE_MCP_TEST_DIRS;
    }
});

test('jsxPath uses forward slashes inside a literal', () => {
    assert.equal(jsxPath('C:\\Users\\me\\a.ai'), '"C:/Users/me/a.ai"');
});
