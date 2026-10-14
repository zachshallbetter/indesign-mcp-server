/**
 * Parameter aliases: every older parameter name or value a tool still accepts
 * must generate exactly the script the canonical name does. InDesign is not
 * contacted; the executor is stubbed and the generated scripts are compared.
 */
import assert from 'node:assert/strict';
import { ScriptExecutor } from '../../src/core/scriptExecutor.js';
import { InDesignMCPServer } from '../../src/core/InDesignMCPServer.js';
import { allToolDefinitions } from '../../src/types/index.js';
import { ALIGNMENT_ALIASES, aliasesFor, normalizeArgs } from '../../src/handlers/aliases.js';

let passed = 0;
const queue = [];
function test(name, fn) {
    queue.push({ name, fn });
}

let captured = [];
ScriptExecutor.executeInDesignScript = async (script) => {
    captured.push(script);
    return 'OK';
};
ScriptExecutor.executeViaUXP = ScriptExecutor.executeInDesignScript;
const server = new InDesignMCPServer();

async function scriptsFor(tool, args) {
    captured = [];
    const result = await server.handleToolCall(tool, args);
    assert.ok(captured.length, `${tool} generated no script for ${JSON.stringify(args)}: ${JSON.stringify(result)}`);
    return captured.join('\n/* --- */\n');
}

/** Assert that `alias` args produce the same script as `canonical` args, and return it. */
async function same(tool, canonical, alias) {
    const want = await scriptsFor(tool, canonical);
    const got = await scriptsFor(tool, alias);
    assert.equal(got, want, `${tool}: ${JSON.stringify(alias)} differs from ${JSON.stringify(canonical)}`);
    return want;
}

// Explicit geometry keeps create tools independent of session placement state.
const BOX = { x: 10, y: 10, width: 50, height: 30 };
const props = (tool) => allToolDefinitions.find((t) => t.name === tool).inputSchema.properties;

// --- strokeWidth -> strokeWeight ---
for (const tool of ['create_rectangle', 'create_ellipse', 'create_polygon']) {
    test(`${tool}: strokeWidth is an alias of strokeWeight`, async () => {
        const s = await same(tool, { ...BOX, strokeColor: 'Black', strokeWeight: 2.5 }, { ...BOX, strokeColor: 'Black', strokeWidth: 2.5 });
        assert.match(s, /shape\.strokeWeight = 2\.5;/);
    });
}
test('create_master_rectangle: strokeWidth is an alias of strokeWeight', async () => {
    const s = await same('create_master_rectangle',
        { masterName: 'A-Master', ...BOX, strokeWeight: 3 },
        { masterName: 'A-Master', ...BOX, strokeWidth: 3 });
    assert.match(s, /rect\.strokeWeight = "3pt";/);
});

// --- fontFamily (+ fontStyle) -> fontName ---
for (const tool of ['create_paragraph_style', 'create_character_style']) {
    test(`${tool}: fontFamily is an alias of fontName`, async () => {
        const s = await same(tool, { name: 'S', fontName: 'Arial\tBold' }, { name: 'S', fontFamily: 'Arial\tBold' });
        assert.match(s, /__font\("Arial\\tBold"\)/);
    });
}
test('create_text_frame: fontFamily is an alias of fontName', async () => {
    await same('create_text_frame', { ...BOX, content: 'x', fontName: 'Arial' }, { ...BOX, content: 'x', fontFamily: 'Arial' });
});
test('create_master_text_frame: fontFamily + fontStyle is an alias of fontName "Family\\tStyle"', async () => {
    const base = { masterName: 'A-Master', content: 'x' };
    const s = await same('create_master_text_frame', { ...base, fontName: 'Arial\tBold' }, { ...base, fontFamily: 'Arial', fontStyle: 'Bold' });
    assert.match(s, /t\.appliedFont = "Arial";/);
    assert.match(s, /t\.fontStyle = "Bold";/);
    await same('create_master_text_frame', { ...base, fontName: 'Arial' }, { ...base, fontFamily: 'Arial' });
});
test('create_master_text_frame: fontStyle alone applies to the default family', async () => {
    const base = { masterName: 'A-Master', content: 'x' };
    const s = await same('create_master_text_frame', { ...base, fontName: 'Helvetica Neue\tBold' }, { ...base, fontStyle: 'Bold' });
    assert.match(s, /t\.appliedFont = "Helvetica Neue";/);
});

// --- LEFT/CENTER/RIGHT/JUSTIFY -> Justification names ---
const ALIGN_TOOLS = {
    create_text_frame: { ...BOX, content: 'x' },
    edit_text_frame: { frameIndex: 0 },
    create_paragraph_style: { name: 'S' },
    create_master_text_frame: { masterName: 'A-Master', content: 'x' },
};
for (const [tool, base] of Object.entries(ALIGN_TOOLS)) {
    test(`${tool}: LEFT/CENTER/RIGHT/JUSTIFY are aliases of Justification names`, async () => {
        for (const [old, canonical] of Object.entries(ALIGNMENT_ALIASES)) {
            const s = await same(tool, { ...base, alignment: canonical }, { ...base, alignment: old });
            assert.ok(s.includes(`Justification.${canonical};`), `${tool}: ${old} -> ${canonical}`);
            await same(tool, { ...base, alignment: canonical }, { ...base, alignment: old.toLowerCase() });
        }
    });
}

// --- objectIndex -> itemIndex ---
test('apply_color: objectIndex is an alias of itemIndex', async () => {
    const s = await same('apply_color', { itemIndex: 3, colorName: 'Black' }, { objectIndex: 3, colorName: 'Black' });
    assert.match(s, /\b3\b/);
});

// --- every tool that takes a canonical name accepts its alias ---
const SAMPLE = {
    strokeWeight: 2, fontName: 'Arial', itemIndex: 2, outputPath: `${process.env.HOME}/Documents/out`,
    pages: '1-2', objectStyle: 'Frame', opacity: 50,
};
test('every advertised canonical parameter accepts its alias', async () => {
    let checked = 0;
    for (const tool of allToolDefinitions) {
        const p = tool.inputSchema?.properties || {};
        for (const { old, canonical } of aliasesFor(tool.name)) {
            const value = SAMPLE[canonical];
            assert.ok(value !== undefined, `no sample value for ${canonical}`);
            const base = { ...BOX, content: 'x', name: 'S', masterName: 'A-Master', colorName: 'Black', strokeColor: 'Black', frameIndex: 0 };
            for (const k of Object.keys(base)) if (!(k in p)) delete base[k];
            for (const r of tool.inputSchema.required || []) {
                if (r !== canonical && !(r in base)) base[r] = p[r].type === 'string' ? 'Sample' : 0;
            }
            const a = normalizeArgs(tool.name, { ...base, [old]: value });
            assert.deepEqual(a, normalizeArgs(tool.name, { ...base, [canonical]: value }), `${tool.name}.${old}`);
            await same(tool.name, { ...base, [canonical]: value }, { ...base, [old]: value });
            checked++;
        }
    }
    assert.ok(checked >= 10, `only ${checked} alias/tool pairs found`);
});

test('the canonical name wins when both are given', async () => {
    await same('create_rectangle',
        { ...BOX, strokeColor: 'Black', strokeWeight: 4 },
        { ...BOX, strokeColor: 'Black', strokeWeight: 4, strokeWidth: 9 });
    await same('create_paragraph_style', { name: 'S', fontName: 'Arial' }, { name: 'S', fontName: 'Arial', fontFamily: 'Times' });
});

test('aliases are left alone on tools that do not take the canonical name', () => {
    assert.ok(!('fontName' in props('create_rectangle')));
    assert.deepEqual(normalizeArgs('create_rectangle', { fontFamily: 'Arial' }), { fontFamily: 'Arial' });
    assert.deepEqual(normalizeArgs('no_such_tool', { strokeWidth: 1 }), { strokeWidth: 1 });
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
console.log(`\n${passed} alias tests passed`);
