/**
 * Motion and Opacity, copying effects, source clip effects, replacing
 * transitions, keyframe tools, fades, Lumetri Color, Input LUT overrides,
 * audio volume, pan and source range, and the graphics and caption tools.
 * Premiere Pro is never contacted: scriptsFor() stubs the executor and audits
 * each script.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { toolTable } from '../src/server.js';
import { scriptsFor, server, body, docs } from './helpers.js';

const clip = (track, trackIndex, clipIndex) => ({ track, trackIndex, clipIndex });
const tool = (name) => toolTable.find((t) => t.name === name);

test('the new tools claim their atlas features', () => {
    const claims = {
        set_clip_transform: ['premiere.effects_transitions.intrinsic_motion', 'premiere.effects_transitions.intrinsic_opacity', 'premiere.effects_transitions.blend_modes', 'premiere.effects_transitions.vector_motion', 'premiere.effects_transitions.compositing'],
        copy_clip_effects: ['premiere.effects_transitions.copy_paste_effects'],
        manage_source_effects: ['premiere.effects_transitions.source_clip_effects'],
        add_transition: ['premiere.effects_transitions.replace_transitions'],
        jump_to_keyframe: ['premiere.effects_transitions.navigate_keyframes'],
        copy_keyframes: ['premiere.effects_transitions.copy_paste_keyframes'],
        retime_keyframes: ['premiere.effects_transitions.adjust_effect_speed'],
        fade_clips: ['premiere.effects_transitions.create_fade_in', 'premiere.audio.fade_audio'],
        set_lumetri_color: ['premiere.color.lumetri_color_panel', 'premiere.color.basic_correction', 'premiere.color.input_lut', 'premiere.color.creative', 'premiere.color.looks', 'premiere.color.color_wheels', 'premiere.color.hsl_secondary', 'premiere.color.vignette', 'premiere.effects_transitions.vignettes'],
        set_clip_input_lut: ['premiere.color.clip_input_lut_override'],
        adjust_clip_audio: ['premiere.audio.increase_clip_volume', 'premiere.audio.audio_clip_mixer', 'premiere.audio.pan_balance', 'premiere.audio.properties_panel_audio'],
        set_source_in_out: ['premiere.audio.source_monitor_audio'],
        control_source_monitor: ['premiere.audio.source_monitor_audio'],
        list_graphics_templates: ['premiere.graphics_captions.graphics_templates_panel'],
        insert_library_mogrt: ['premiere.graphics_captions.mogrt_from_libraries'],
        list_transcription_languages: ['premiere.graphics_captions.language_packs', 'premiere.graphics_captions.supported_languages'],
        import_captions: ['premiere.graphics_captions.caption_formats'],
    };
    for (const [name, ids] of Object.entries(claims)) {
        for (const id of ids) assert.ok(tool(name).features.includes(id), `${name} should claim ${id}`);
    }
    assert.equal(tool('list_graphics_templates').hints.readOnly, true);
    assert.equal(tool('insert_library_mogrt').hints.openWorld, true);
    assert.equal(tool('manage_source_effects').hints.destructive, true);
});

test('motion and opacity: settings by display name, blend modes, and refusals', async () => {
    const mcp = await server();
    const clips = { items: [clip('video', 1, 0)] };
    await assert.rejects(mcp.handleToolCall('set_clip_transform', { clips }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_clip_transform', { clips, motion: { skew: 3 } }), /Unknown motion setting 'skew'/);
    await assert.rejects(mcp.handleToolCall('set_clip_transform', { clips, motion: { position: 5 } }), /must be \{ x, y \}/);
    await assert.rejects(mcp.handleToolCall('set_clip_transform', { clips, motion: { scale: 'big' } }), /must be a number/);
    await assert.rejects(mcp.handleToolCall('set_clip_transform', { clips, opacity: 140 }), /out of range|opacity/);
    await assert.rejects(mcp.handleToolCall('set_clip_transform', { clips, blendMode: 'screen', blendModeIndex: 8 }), /not both/);
    await assert.rejects(mcp.handleToolCall('set_clip_transform', { clips, blendMode: 'glow' }), /Allowed: normal/);

    const [motion, vector] = await scriptsFor([
        ['set_clip_transform', { clips, motion: { position: { x: 0.25, y: 0.75 }, scale: 50, uniformScale: true }, opacity: 60, blendMode: 'multiply' }],
        ['set_clip_transform', { clips: { selected: true }, vectorMotion: true, motion: { rotation: 45 }, blendModeIndex: 12, clearKeyframes: true }],
    ]);
    assert.match(body(motion), /\{ component: "Motion", name: "Position", v: \{"x":0\.25,"y":0\.75\} \}/);
    assert.match(body(motion), /\{ component: "Motion", name: "Uniform Scale", v: true \}/);
    assert.match(body(motion), /\{ component: "Opacity", name: "Opacity", v: 60 \}/);
    assert.match(body(motion), /\{ component: "Opacity", name: "Blend Mode", v: 3 \}/);
    assert.match(body(motion), /if \(param\.isTimeVarying\(\) && !false\)/);
    assert.match(body(motion), /add\(t\.param\.createSetValueAction\(kf, true\)\);/);
    assert.match(body(vector), /\{ component: "Vector Motion", name: "Rotation", v: 45 \}/);
    assert.match(body(vector), /name: "Blend Mode", v: 12 \}/);
});

test('copying effects and source clip effects', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('copy_clip_effects', { from: clip('video', 0, 0), to: { items: [clip('video', 0, 1)] }, components: [] }), /'components' is empty/);
    await assert.rejects(mcp.handleToolCall('copy_clip_effects', { from: clip('video', 0, 0), to: {} }), /Choose the clips/);
    await assert.rejects(mcp.handleToolCall('manage_source_effects', { item: { path: 'a.mov' }, action: 'apply' }), /apply needs 'effect'/);
    await assert.rejects(mcp.handleToolCall('manage_source_effects', { item: { path: 'a.wav' }, action: 'apply', media: 'audio', effect: 'Amplify' }), /apply_effect/);
    await assert.rejects(mcp.handleToolCall('manage_source_effects', { item: { path: 'a.mov' }, action: 'remove' }), /remove needs 'component'/);
    await assert.rejects(mcp.handleToolCall('manage_source_effects', { item: { path: 'a.mov' }, action: 'delete' }), /Allowed: list, apply, remove/);

    const [copy, picked, list, apply, remove] = await scriptsFor([
        ['copy_clip_effects', { from: clip('video', 0, 0), to: { items: [clip('video', 0, 1), clip('video', 1, 0)] } }],
        ['copy_clip_effects', { from: clip('audio', 0, 0), to: { selected: true }, components: [2, 4], keyframes: false }],
        ['manage_source_effects', { item: { path: 'Footage/a.mov' } }],
        ['manage_source_effects', { item: { id: '000f4' }, action: 'apply', effect: 'Gaussian Blur' }],
        ['manage_source_effects', { item: { path: 'Footage/a.wav' }, action: 'remove', media: 'audio', component: 3 }],
    ]);
    assert.match(body(copy), /const pick = null;/);
    assert.match(body(copy), /if \(pick === null && fixed && !false\) continue;/);
    assert.match(body(copy), /await ppro\.VideoFilterFactory\.createComponent\(c\.matchName\)/);
    assert.match(body(copy), /await ppro\.AudioFilterFactory\.createComponentByDisplayName\(c\.displayName, clip\)/);
    assert.match(body(copy), /add\(p\.chain\.createAppendComponentAction\(n\.component\)\)/);
    assert.match(body(copy), /if \(s\.keys\.length\) __kfAdd\(s\.param, s\.keys, add, true\);/);
    assert.match(body(copy), /const shift = p\.times\.inPoint - sourceTimes\.inPoint;/);
    assert.match(body(picked), /const pick = \[2,4\];/);
    assert.match(body(picked), /keys: false \? await __kfRead\(e\.param\) : \[\]/);
    assert.match(body(list), /clip\.getComponentChain\(__C\.MediaType\.VIDEO\)/);
    assert.doesNotMatch(body(list), /transact\(/);
    assert.match(body(apply), /transact\(project, "Apply source effect", \(add\) => add\(chain\.createAppendComponentAction\(created\)\)\);/);
    assert.match(body(remove), /clip\.getComponentChain\(__C\.MediaType\.AUDIO\)/);
    assert.match(body(remove), /const target = __component\(chain, 3\);/);
    assert.match(body(remove), /chain\.createRemoveComponentAction\(target\)/);
});

test('replacing a transition removes the one at that end first; adding alone does not', async () => {
    const [replace, plain] = await scriptsFor([
        ['add_transition', { clips: { items: [clip('video', 0, 1)] }, transition: 'AE.ADBE Cross Dissolve New', at: 'both', replace: true }],
        ['add_transition', { clips: { items: [clip('video', 0, 1)] }, transition: 'AE.ADBE Cross Dissolve New', at: 'end' }],
    ]);
    assert.match(body(replace), /transact\(project, "Replace transition"/);
    assert.match(body(replace), /add\(c\.createRemoveVideoTransitionAction\(atStart \? __C\.TransitionPosition\.START : __C\.TransitionPosition\.END\)\);\n {6}const options = new ppro\.AddTransitionOptions\(\);/);
    assert.match(body(replace), /replaced: true/);
    assert.doesNotMatch(body(plain), /createRemoveVideoTransitionAction/);
    assert.match(body(plain), /transact\(project, "Add transition"/);
});

test('keyframes: jumping, copying, retiming and fades', async () => {
    const mcp = await server();
    const at = { clip: clip('video', 0, 0), component: 1, param: 'Scale' };
    await assert.rejects(mcp.handleToolCall('jump_to_keyframe', { ...at, direction: 'up' }), /Allowed: next, previous/);
    await assert.rejects(mcp.handleToolCall('jump_to_keyframe', { clip: at.clip, component: 1, direction: 'next' }), /param \(name\) or paramIndex/);
    await assert.rejects(mcp.handleToolCall('copy_keyframes', { ...at, toParam: 'Rotation', toParamIndex: 2 }), /toParam or toParamIndex, not both/);
    await assert.rejects(mcp.handleToolCall('retime_keyframes', { ...at }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('retime_keyframes', { ...at, scale: 0 }), /scale/);
    await assert.rejects(mcp.handleToolCall('fade_clips', { clips: { selected: true } }), /fadeIn, fadeOut or both/);
    await assert.rejects(mcp.handleToolCall('fade_clips', { clips: { selected: true }, fadeIn: -1 }), /fadeIn/);

    const [next, previous, copy, onto, retime, fade] = await scriptsFor([
        ['jump_to_keyframe', { ...at, direction: 'next' }],
        ['jump_to_keyframe', { ...at, direction: 'previous', from: 12.5 }],
        ['copy_keyframes', { ...at, to: { items: [clip('video', 1, 0)] }, offset: 0.5, replace: true }],
        ['copy_keyframes', { ...at, toComponent: 2, toParamIndex: 0 }],
        ['retime_keyframes', { ...at, scale: 2, anchor: 'last', offset: -1 }],
        ['fade_clips', { clips: { items: [clip('video', 0, 0), clip('audio', 0, 0)] }, fadeIn: 1, fadeOut: 2 }],
    ]);
    assert.match(body(next), /const from = __s\(await seq\.getPlayerPosition\(\)\);/);
    assert.match(body(next), /await param\.findNextKeyframe\(local\)/);
    assert.match(body(next), /await seq\.setPlayerPosition\(__t\(Math\.max\(0, target\)\)\)/);
    assert.match(body(previous), /const from = 12\.5;/);
    assert.match(body(previous), /await param\.findPreviousKeyframe\(local\)/);
    assert.match(body(copy), /const keys = await __kfRead\(source\.param\);/);
    assert.match(body(copy), /const param = __param\(__component\(await __chain\(clip\), 1\), \{"param":"Scale"\}\);/);
    assert.match(body(copy), /times\.inPoint - sourceTimes\.inPoint \+ 0\.5/);
    assert.match(body(copy), /__kfAdd\(p\.param, p\.keys, add, true\)/);
    assert.match(body(copy), /__kfModes\(p\.param, p\.keys, add\)/);
    assert.match(body(onto), /__param\(__component\(await __chain\(clip\), 2\), \{"paramIndex":0\}\)/);
    assert.match(body(onto), /__kfAdd\(p\.param, p\.keys, add, false\)/);
    assert.match(body(retime), /const pivot = keys\[keys\.length - 1\]\.t;/);
    assert.match(body(retime), /\(k\.t - pivot\) \* 2 \+ -1/);
    assert.match(body(retime), /transact\(project, "Retime keyframes", \(add\) => __kfAdd\(param, moved, add, true\)\);/);
    assert.match(body(fade), /\[isVideo \? "Opacity" : "Volume"\]/);
    assert.match(body(fade), /isVideo \? "Opacity" : "Level"/);
    assert.match(body(fade), /keys\.push\(\{ t: times\.inPoint, v: 0 \}, \{ t: times\.inPoint \+ fadeIn, v: full \}\);/);
    assert.match(body(fade), /keys\.push\(\{ t: times\.outPoint - fadeOut, v: full \}, \{ t: times\.outPoint, v: 0 \}\);/);
    assert.match(body(fade), /const fadeIn = 1;\nconst fadeOut = 2;/);
});

test('Lumetri Color: settings by section and name, byIndex, adding the effect, and refusals', async () => {
    const mcp = await server();
    const clips = { items: [clip('video', 0, 0)] };
    await assert.rejects(mcp.handleToolCall('set_lumetri_color', { clips }), /Nothing to set/);
    await assert.rejects(mcp.handleToolCall('set_lumetri_color', { clips, basic: 3 }), /'basic' must be an object/);
    await assert.rejects(mcp.handleToolCall('set_lumetri_color', { clips, basic: { Exposure: [1] } }), /must be a number, text/);
    await assert.rejects(mcp.handleToolCall('set_lumetri_color', { clips, byIndex: [{ paramIndex: -1, value: 1 }] }), /byIndex\[0\]\.paramIndex/);
    await assert.rejects(mcp.handleToolCall('set_lumetri_color', { clips, byIndex: { paramIndex: 1 } }), /must be a list/);

    const [grade, fixed] = await scriptsFor([
        ['set_lumetri_color', { clips, basic: { Exposure: 0.5, Saturation: 120 }, creative: { Look: 'SL CLEAN FUJI', 'Shadow Tint': { red: 0.1, green: 0.2, blue: 0.3 } }, vignette: { Amount: -2 } }],
        ['set_lumetri_color', { clips: { selected: true }, hsl: { Denoise: 10 }, byIndex: [{ paramIndex: 7, value: true }], component: 4, add: false }],
    ]);
    assert.match(body(grade), /\{"section":"basic","header":"Basic Correction","name":"Exposure","v":0\.5\}/);
    assert.match(body(grade), /\{"section":"creative","header":"Creative","name":"Shadow Tint","v":\{"red":0\.1,"green":0\.2,"blue":0\.3,"alpha":1\}\}/);
    assert.match(body(grade), /"Color Wheels & Match":"wheels"/);
    assert.match(body(grade), /let at = null;/);
    assert.match(body(grade), /if \(!true\) throw new Error\(clipName \+ " has no Lumetri Color effect/);
    assert.match(body(grade), /plan\.created = await ppro\.VideoFilterFactory\.createComponent\(lumetriMatch\);/);
    assert.match(body(grade), /transact\(project, "Apply Lumetri Color"/);
    assert.match(body(grade), /e\.section === s\.section && e\.name\.toLowerCase\(\) === wanted/);
    assert.match(body(fixed), /let at = 4;/);
    assert.match(body(fixed), /const byIndex = \[\{"paramIndex":7,"v":true\}\];/);
    assert.match(body(fixed), /if \(!false\) throw new Error/);
});

test('Input LUT override: an id or another clip\'s LUT', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_clip_input_lut', { items: [{ path: 'a.mov' }] }), /Give lutId or fromItem/);
    await assert.rejects(mcp.handleToolCall('set_clip_input_lut', { items: [{ path: 'a.mov' }], lutId: 'x', fromItem: { path: 'b.mov' } }), /Give lutId or fromItem/);
    await assert.rejects(mcp.handleToolCall('set_clip_input_lut', { items: [], lutId: 'x' }), /at least one clip/);
    await assert.rejects(mcp.handleToolCall('set_clip_input_lut', { items: [{ path: 'a.mov' }], lutId: ' ' }), /'lutId' is empty/);

    const [byId, copied] = await scriptsFor([
        ['set_clip_input_lut', { items: [{ path: 'Footage/a.mov' }, { id: '00a1' }], lutId: '7c2d0f3e-1111-2222-3333-444455556666' }],
        ['set_clip_input_lut', { items: [{ path: 'Footage/a.mov' }], fromItem: { path: 'Footage/b.mov' }, embedded: true }],
    ]);
    assert.match(body(byId), /const lutId = "7c2d0f3e-1111-2222-3333-444455556666";/);
    assert.match(body(byId), /add\(b\.clip\.createSetInputLUTIDAction\(lutId\)\)/);
    assert.match(body(copied), /const lutId = await __clipItem\(await __item\(project, \{"path":"Footage\/b\.mov"\}\)\)\.getEmbeddedLUTID\(\);/);
});

test('audio: decibel gain and pan', async () => {
    const mcp = await server();
    const clips = { items: [clip('audio', 0, 0)] };
    await assert.rejects(mcp.handleToolCall('adjust_clip_audio', { clips }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('adjust_clip_audio', { clips, gainDb: 200 }), /gainDb/);
    await assert.rejects(mcp.handleToolCall('adjust_clip_audio', { clips, pan: 150 }), /pan/);

    const [gain, pan] = await scriptsFor([
        ['adjust_clip_audio', { clips, gainDb: 6 }],
        ['adjust_clip_audio', { clips: { selected: true }, pan: -50 }],
    ]);
    const factor = Number(/const factor = ([\d.]+);/.exec(body(gain))[1]);
    assert.ok(Math.abs(factor - 1.99526) < 0.0001, `factor ${factor}`);
    assert.match(body(gain), /const pan = null;/);
    assert.match(body(gain), /__fxFind\(chain, \["Volume"\]\)/);
    assert.match(body(gain), /if \(t\.level && t\.keys\.length\) __kfAdd\(t\.level, t\.keys, add, true\);/);
    assert.match(body(gain), /t\.level\.createKeyframe\(t\.start \* factor\)/);
    assert.match(body(pan), /const factor = null;\nconst pan = -50;/);
    assert.match(body(pan), /__fxParam\(panner\.component, "Balance"\) \|\| __fxParam\(panner\.component, "Pan"\)/);
});

test('graphics and captions: templates, libraries, languages and caption files', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('insert_library_mogrt', { library: 'Brand', element: ' ', time: 1 }), /'element' is empty/);
    await assert.rejects(mcp.handleToolCall('list_transcription_languages', { languages: ['en US; x'] }), /language code/);
    await assert.rejects(mcp.handleToolCall('import_captions', { files: [path.join(docs, 'a.txt')] }), /must end in \.srt/);
    await assert.rejects(mcp.handleToolCall('import_captions', { files: ['/etc/a.srt'] }), /outside the allowed directories|system directory/);
    await assert.rejects(mcp.handleToolCall('import_captions', { files: [] }), /at least one caption file/);

    const [library, all, some, captions] = await scriptsFor([
        ['insert_library_mogrt', { library: 'Brand "kit"', element: 'Lower third', time: 4, videoTrackIndex: 2 }],
        ['list_transcription_languages', {}],
        ['list_transcription_languages', { languages: ['en-US', 'fr-FR'] }],
        ['import_captions', { files: [path.join(docs, 'ep1.srt'), path.join(docs, 'ep1.scc')], bin: { path: 'Captions' } }],
    ]);
    assert.match(body(library), /editor\.insertMogrtFromLibrary\("Brand \\"kit\\"", "Lower third", __t\(4\), 2, 0\)/);
    assert.match(body(all), /const codes = \[\];/);
    assert.match(body(all), /await T\.querySupportedLanguages\(\)/);
    assert.match(body(some), /const codes = \["en-US","fr-FR"\];/);
    assert.match(body(some), /T\.isLanguagePackAvailable\(code\)/);
    assert.match(body(captions), /await project\.importFiles\(\[".*ep1\.srt",".*ep1\.scc"\], true, target\.item, false\)/);

    // The templates folder Premiere Pro reports is listed by the server.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'premiere-mogrt-'));
    const previous = process.env.PREMIERE_ALLOWED_DIRS;
    process.env.PREMIERE_ALLOWED_DIRS = dir;
    try {
        mkdirSync(path.join(dir, 'Titles'));
        writeFileSync(path.join(dir, 'Titles', 'Lower Third.mogrt'), '');
        writeFileSync(path.join(dir, 'Slate.mogrt'), '');
        writeFileSync(path.join(dir, 'notes.txt'), '');
        const { executor } = await import('../src/executor.js');
        const original = executor.runScript;
        let sent = null;
        executor.runScript = async (s) => { sent = s; return { ok: true, result: { folder: dir } }; };
        try {
            const r = await mcp.handleToolCall('list_graphics_templates', { filter: 'third' });
            assert.equal(r.success, true, JSON.stringify(r));
            assert.match(body(sent), /await ppro\.SequenceEditor\.getInstalledMogrtPath\(\)/);
            const text = JSON.stringify(r);
            assert.match(text, /Lower Third/);
            assert.doesNotMatch(text, /Slate|notes/);
            executor.runScript = async () => ({ ok: true, result: { folder: '/Library/Application Support/Adobe/Templates' } });
            const outside = JSON.stringify(await mcp.handleToolCall('list_graphics_templates', {}));
            assert.match(outside, /listed.*false/);
        } finally {
            executor.runScript = original;
        }
    } finally {
        if (previous === undefined) delete process.env.PREMIERE_ALLOWED_DIRS; else process.env.PREMIERE_ALLOWED_DIRS = previous;
        rmSync(dir, { recursive: true, force: true });
    }
});
