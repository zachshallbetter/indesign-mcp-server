#!/usr/bin/env node
/**
 * Regenerate src/data/effects.json, the effect catalog set_effect_controls and
 * find_effects use, from the capability atlas's After Effects effect records
 * (corpus/aftereffects/features/effects.json): each effect on the Effect menu
 * with its category and published match name, and the controls the After
 * Effects help pages list for it. Run it when the atlas changes:
 *
 *   node scripts/update-effects.js <path to adobe-capability-atlas>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const atlas = process.argv[2];
if (!atlas) {
    console.error('usage: node scripts/update-effects.js <path to adobe-capability-atlas>');
    process.exit(1);
}

/**
 * Controls the help pages list that are not properties a script can set:
 * panel widgets, buttons and data only the interface edits.
 */
const NOT_SETTABLE = {
    'aftereffects.effects.curves_option.the': 'Not a control: a fragment of the help text. The curves themselves are a custom-data property that scripts cannot read or set.',
    'aftereffects.effects.levels_option.histogram': 'The histogram is a display in the Effect Controls panel, not a value.',
    'aftereffects.effects.color_difference_key_option.thumbnail_eyedropper': 'An eyedropper button in the Effect Controls panel; it samples the image interactively. Set Key Color instead.',
    'aftereffects.effects.color_difference_key_option.key_color_eyedropper': 'An eyedropper button in the Effect Controls panel; it samples the image interactively. Set Key Color instead.',
    'aftereffects.effects.color_stabilizer_option.set_frame': 'A button in the Effect Controls panel that samples the current frame; scripts cannot press it.',
    'aftereffects.effects.reshape_option.correspondence_pairs': 'Correspondence points are placed on the masks interactively in the Composition panel; no property holds them.',
    'aftereffects.effects.mesh_warp_option.distortion_mesh': 'The mesh is custom data edited by dragging in the Composition panel; scripts cannot set it.',
};

const records = JSON.parse(readFileSync(path.join(atlas, 'corpus', 'aftereffects', 'features', 'effects.json'), 'utf8'));
const byId = new Map(records.map((r) => [r.id, r]));

function matchName(r) {
    const notes = r.automation?.notes ?? '';
    const quoted = /[Mm]atch name "([^"]+)"/.exec(notes);
    if (quoted && quoted[1] !== 'ADBE Effect Parade') return quoted[1];
    const bare = /match name (ADBE [\w -]+?) to the/.exec(notes);
    return bare ? bare[1] : null;
}

const effects = [];
for (const r of records) {
    const menu = r.menu_path ?? [];
    if (r.kind !== 'menu_command' || menu.length !== 3 || menu[0] !== 'Effect') continue;
    const prefix = `${r.id}_option.`;
    const controls = records.filter((o) => o.id.startsWith(prefix)).map((o) => {
        const c = { id: o.id, name: o.name };
        const reason = NOT_SETTABLE[o.id] ?? (o.automation?.route !== 'dom' ? o.automation?.notes || 'No scripting route.' : null);
        if (reason) { c.settable = false; c.reason = reason; }
        return c;
    });
    effects.push({ id: r.id, name: menu[2], matchName: matchName(r), category: menu[1], controls });
}
for (const id of Object.keys(NOT_SETTABLE)) if (!byId.has(id)) throw new Error(`NOT_SETTABLE names a missing record: ${id}`);

const note = 'Effects on the After Effects Effect menu, by category, with the match names published in the scripting guide (null where none is published: the effect is found by display name in app.effects at run time) and the controls the help pages list. From adobe-capability-atlas; regenerate with scripts/update-effects.js.';
const out = new URL('../src/data/effects.json', import.meta.url);
writeFileSync(out, `${JSON.stringify({ note, effects }, null, 1)}\n`);
const controls = effects.reduce((n, e) => n + e.controls.length, 0);
console.log(`${effects.length} effects (${effects.filter((e) => !e.matchName).length} without a published match name), ${controls} controls written to src/data/effects.json`);
