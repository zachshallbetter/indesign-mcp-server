/**
 * Argument warnings: a tool result lists, under `warnings`, every argument the
 * tool did not use as written (unknown names, with a suggestion, and
 * deprecated aliases). Results without warnings keep their exact shape, and
 * handlers may only read advertised parameters, so "was ignored" is true.
 * InDesign is not contacted; the executor is stubbed.
 */
import assert from 'node:assert/strict';
import { ScriptExecutor } from '../../src/core/scriptExecutor.js';
import { InDesignMCPServer } from '../../src/core/InDesignMCPServer.js';
import { allToolDefinitions } from '../../src/types/index.js';
import { unknownArgWarnings } from '../../src/handlers/aliases.js';

let passed = 0;
const queue = [];
function test(name, fn) {
    queue.push({ name, fn });
}

let captured = [];
let reply = 'OK';
ScriptExecutor.executeInDesignScript = async (script) => {
    captured.push(script);
    return reply;
};
ScriptExecutor.executeViaUXP = ScriptExecutor.executeInDesignScript;
const server = new InDesignMCPServer();

const BOX = { x: 10, y: 10, width: 50, height: 30 };
async function call(tool, args) {
    captured = [];
    const result = await server.handleToolCall(tool, args);
    return { result, script: captured.join('\n') };
}

test('a call with only known arguments has no warnings key and the usual shape', async () => {
    const { result } = await call('create_rectangle', { ...BOX, strokeColor: 'Black' });
    assert.deepEqual(Object.keys(result).sort(), ['operation', 'result', 'success', 'timestamp']);
});

test('an unknown argument is reported with the closest parameter name', async () => {
    const { result, script } = await call('create_rectangle', { ...BOX, strokeColour: 'Black' });
    assert.deepEqual(result.warnings, ["Unknown parameter 'strokeColour' was ignored; did you mean 'strokeColor'?"]);
    assert.equal(result.success, true);
    assert.equal(script, (await call('create_rectangle', BOX)).script, 'unknown argument changed the script');
});

test('case slips and far-off names', () => {
    assert.deepEqual(unknownArgWarnings('create_rectangle', { pageindex: 0 }), ["Unknown parameter 'pageindex' was ignored; did you mean 'pageIndex'?"]);
    assert.deepEqual(unknownArgWarnings('create_rectangle', { zebra: 1 }), ["Unknown parameter 'zebra' was ignored"]);
    assert.deepEqual(unknownArgWarnings('no_such_tool', { zebra: 1 }), []);
});

test('an alias on a tool it does not apply to is unknown, pointing at the canonical name', async () => {
    const { result } = await call('move_page_item', { pageIndex: 0, itemIndex: 1, x: 5, y: 5, objectIndex: 1 });
    assert.deepEqual(result.warnings, ["Unknown parameter 'objectIndex' was ignored; did you mean 'itemIndex'?"]);
});

test('deprecated aliases are reported and still generate the canonical script', async () => {
    const cases = [
        ['create_rectangle', { ...BOX, strokeWidth: 2 }, { ...BOX, strokeWeight: 2 }, "'strokeWidth' is deprecated; use 'strokeWeight'"],
        ['create_paragraph_style', { name: 'S', fontFamily: 'Arial' }, { name: 'S', fontName: 'Arial' }, "'fontFamily' is deprecated; use 'fontName'"],
        ['apply_color', { objectIndex: 1, colorName: 'Black' }, { itemIndex: 1, colorName: 'Black' }, "'objectIndex' is deprecated; use 'itemIndex'"],
        ['create_text_frame', { ...BOX, content: 'x', alignment: 'center' }, { ...BOX, content: 'x', alignment: 'CENTER_ALIGN' }, 'alignment "center" is deprecated; use "CENTER_ALIGN"'],
        ['create_object_style', { name: 'S', transparency: 50 }, { name: 'S', opacity: 50 }, "'transparency' is deprecated; use 'opacity'"],
        ['place_image', { filePath: `${process.env.HOME}/a.png`, applyObjectStyle: 'F' }, { filePath: `${process.env.HOME}/a.png`, objectStyle: 'F' }, "'applyObjectStyle' is deprecated; use 'objectStyle'"],
        ['export_images', { folderPath: `${process.env.HOME}/out`, pageRange: '1-2' }, { outputPath: `${process.env.HOME}/out`, pages: '1-2' }, "'folderPath' is deprecated; use 'outputPath'"],
    ];
    for (const [tool, alias, canonical, warning] of cases) {
        const a = await call(tool, alias);
        const c = await call(tool, canonical);
        assert.ok(a.result.warnings?.includes(warning), `${tool}: ${JSON.stringify(a.result.warnings)}`);
        assert.equal(c.result.warnings, undefined, `${tool}: canonical call has warnings`);
        assert.ok(a.script, `${tool}: no script`);
        assert.equal(a.script, c.script, `${tool}: alias script differs`);
    }
});

test('fontStyle is folded into fontName with a warning', async () => {
    const { result } = await call('create_master_text_frame', { masterName: 'A-Master', content: 'x', fontFamily: 'Arial', fontStyle: 'Bold' });
    assert.deepEqual(result.warnings, ["'fontFamily' is deprecated; use 'fontName'", "'fontStyle' is deprecated; use fontName \"Arial\\tBold\""]);
    const both = await call('create_master_text_frame', { masterName: 'A-Master', content: 'x', fontName: 'Arial\tBold', fontStyle: 'Italic' });
    assert.deepEqual(both.result.warnings, ["'fontStyle' is deprecated and was ignored because fontName already names a style"]);
});

test('an alias given with its canonical name is reported as ignored', async () => {
    const { result } = await call('create_rectangle', { ...BOX, strokeWeight: 1, strokeWidth: 5 });
    assert.deepEqual(result.warnings, ["'strokeWidth' is deprecated and was ignored because 'strokeWeight' was also given"]);
});

test('a failed call keeps success false and still carries warnings', async () => {
    reply = 'Error: something went wrong';
    try {
        const { result } = await call('create_rectangle', { ...BOX, colour: 'Black' });
        assert.equal(result.success, false);
        assert.equal(result.warnings.length, 1);
    } finally {
        reply = 'OK';
    }
});

test('a call rejected by argument validation passes its warnings on the error', async () => {
    await assert.rejects(
        server.handleToolCall('create_rectangle', { ...BOX, strokeColor: 'Black', strokeWeight: 'heavy', strokeColour: 'x' }),
        (e) => {
            assert.deepEqual(e.warnings, ["Unknown parameter 'strokeColour' was ignored; did you mean 'strokeColor'?"]);
            return true;
        },
    );
});

// "was ignored" is only true if no handler reads a parameter its schema does not list.
test('handlers read only advertised parameters', async () => {
    const problems = [];
    for (const tool of allToolDefinitions) {
        const props = tool.inputSchema?.properties || {};
        for (const withDefaults of [true, false]) {
            const base = {};
            if (withDefaults) for (const [k, v] of Object.entries(props)) if (v.default !== undefined) base[k] = v.default;
            const read = new Set();
            const spy = new Proxy(base, {
                get(o, k) { if (typeof k === 'string') read.add(k); return o[k]; },
                has(o, k) { if (typeof k === 'string') read.add(k); return k in o; },
            });
            try { await server.dispatch(tool.name, spy); } catch { /* invalid sample arguments are fine here */ }
            for (const k of read) if (!(k in props) && !['then', 'toJSON', 'constructor'].includes(k)) problems.push(`${tool.name} reads '${k}'`);
        }
    }
    assert.deepEqual([...new Set(problems)], []);
});

for (const { name, fn } of queue) {
    try {
        await fn();
        passed++;
        console.log(`ok - ${name}`);
    } catch (e) {
        console.error(`not ok - ${name}`);
        console.error('  ', e.message);
        process.exitCode = 1;
    }
}
console.log(`\n${passed} warning tests passed`);
