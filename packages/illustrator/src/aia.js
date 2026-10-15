/**
 * Reading, editing and composing Action files (.aia).
 *
 * An .aia file is the text Illustrator writes with Save Actions and reads with
 * Load Actions: one action set (/name, /actionCount and /action-N blocks), each
 * action a list of recorded steps (/eventCount and /event-N blocks). Names are
 * UTF-8 bytes in hex after their byte count. Each step has an on/off flag
 * (/isOn) and, when its command has a dialog (/hasDialog 1), a flag for showing
 * that dialog during playback (/showDialog). The layout follows the files
 * Illustrator saves and the scripts that write them (BlendSp; see blend.js and
 * NOTICE).
 *
 * Edits are made on the file's text: names and flags are replaced in place, and
 * removed actions or steps are cut out and the rest renumbered, so every other
 * recorded value is kept exactly as it was.
 */

const MAX_NAME_BYTES = 255;

/** Split .aia text into keys, brackets, (strings) and words, with their offsets. */
function tokenize(text) {
    const out = [];
    const plain = /[^\s{}[\]()/]/;
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (/\s/.test(c)) { i++; continue; }
        const start = i;
        if ('{}[]'.includes(c)) {
            out.push({ t: c, start, end: ++i });
        } else if (c === '(') {
            let depth = 0;
            let closed = false;
            for (; i < text.length; i++) {
                if (text[i] === '\\') { i++; continue; }
                if (text[i] === '(') depth++;
                else if (text[i] === ')' && --depth === 0) { i++; closed = true; break; }
            }
            if (!closed) throw new Error(`unterminated ( at character ${start}`);
            out.push({ t: 'str', start, end: i, text: text.slice(start + 1, i - 1) });
        } else if (c === '/') {
            i++;
            while (i < text.length && plain.test(text[i])) i++;
            out.push({ t: 'key', start, end: i, text: text.slice(start + 1, i) });
        } else {
            while (i < text.length && plain.test(text[i])) i++;
            if (i === start) throw new Error(`unexpected ${JSON.stringify(c)} at character ${start}`);
            out.push({ t: 'word', start, end: i, text: text.slice(start, i) });
        }
    }
    return out;
}

/** Entries (/key value) up to a closing brace, or to the end at the top level. */
function parseEntries(tokens, pos, nested) {
    const entries = [];
    while (pos.i < tokens.length) {
        const tok = tokens[pos.i];
        if (tok.t === '}') {
            if (!nested) throw new Error(`unexpected } at character ${tok.start}`);
            return { entries, end: tok.end };
        }
        if (tok.t !== 'key') throw new Error(`expected a /key at character ${tok.start}`);
        pos.i++;
        const value = parseValue(tokens, pos);
        entries.push({ key: tok.text, keyTok: tok, start: tok.start, end: value.end, value });
    }
    if (nested) throw new Error('a { block is not closed');
    return { entries };
}

function parseValue(tokens, pos) {
    const tok = tokens[pos.i++];
    if (!tok) throw new Error('the file ends where a value was expected');
    if (tok.t === '{') {
        const body = parseEntries(tokens, pos, true);
        pos.i++;
        return { kind: 'object', entries: body.entries, start: tok.start, end: body.end };
    }
    if (tok.t === '[') {
        const words = [];
        while (tokens[pos.i]?.t === 'word') words.push(tokens[pos.i++].text);
        const close = tokens[pos.i++];
        if (close?.t !== ']') throw new Error(`a [ list at character ${tok.start} is not closed`);
        return { kind: 'list', words, start: tok.start, end: close.end };
    }
    if (tok.t === 'str' || tok.t === 'word') return { kind: tok.t, text: tok.text, start: tok.start, end: tok.end };
    throw new Error(`unexpected ${tok.t} at character ${tok.start}`);
}

const find = (entries, key) => entries.find((e) => e.key === key);
const numbered = (entries, prefix) => entries
    .map((e) => ({ e, m: e.key.match(new RegExp(`^${prefix}-(\\d+)$`)) }))
    .filter((x) => x.m && x.e.value.kind === 'object')
    .map((x) => ({ entry: x.e, index: Number(x.m[1]) }))
    .sort((a, b) => a.index - b.index);

/** A /name [ count hex ] list as text. */
function decodeName(entry) {
    if (!entry || entry.value.kind !== 'list' || !entry.value.words.length) return null;
    const hex = entry.value.words.slice(1).join('');
    if (!/^([0-9a-f]{2})*$/i.test(hex)) return null;
    return Buffer.from(hex, 'hex').toString('utf8');
}

/** A name as an .aia list: the UTF-8 byte count, then the bytes in hex. */
export function encodeName(text, label = 'name') {
    const s = String(text ?? '');
    const bytes = Buffer.from(s, 'utf8');
    if (!s.trim()) throw new Error(`'${label}' is empty`);
    if (bytes.length > MAX_NAME_BYTES) throw new Error(`'${label}' is longer than ${MAX_NAME_BYTES} bytes`);
    return `[ ${bytes.length}\n\t${bytes.toString('hex')}\n]`;
}

const flag = (entries, key) => {
    const e = find(entries, key);
    return e && e.value.kind === 'word' ? e.value.text === '1' : null;
};

/**
 * Parse .aia text. Throws "Not an Action file: ..." when it is not one.
 * @returns {{ text: string, name: string, nameEntry: object, countEntry: object, actions: object[] }}
 */
export function readActions(text) {
    const src = String(text).replace(/^﻿/, '');
    let root;
    try {
        root = parseEntries(tokenize(src), { i: 0 }, false).entries;
    } catch (e) {
        throw new Error(`Not an Action file: ${e.message}`);
    }
    const nameEntry = find(root, 'name');
    const countEntry = find(root, 'actionCount');
    const name = decodeName(nameEntry);
    if (!find(root, 'version') || name === null || !countEntry) throw new Error('Not an Action file: /version, /name or /actionCount is missing');
    const actions = numbered(root, 'action').map(({ entry, index }) => {
        const body = entry.value.entries;
        const events = numbered(body, 'event').map((ev) => {
            const e = ev.entry.value.entries;
            const internal = find(e, 'internalName');
            return {
                index: ev.index,
                entry: ev.entry,
                command: internal?.value.kind === 'str' ? internal.value.text : null,
                name: decodeName(find(e, 'localizedName')),
                enabled: flag(e, 'isOn'),
                hasDialog: flag(e, 'hasDialog') === true,
                showDialog: flag(e, 'showDialog'),
            };
        });
        return { index, entry, name: decodeName(find(body, 'name')), nameEntry: find(body, 'name'), countEntry: find(body, 'eventCount'), events };
    });
    if (String(actions.length) !== countEntry.value.text) {
        throw new Error(`Not an Action file: /actionCount is ${countEntry.value.text} but there are ${actions.length} actions`);
    }
    return { text: src, name, nameEntry, countEntry, actions };
}

/** What a parsed file holds, for results: set name, actions and their steps. */
export function describeActions(file) {
    return {
        set: file.name,
        actions: file.actions.map((a) => ({
            name: a.name,
            steps: a.events.map((e, i) => {
                const step = { step: i + 1, name: e.name, command: e.command, enabled: e.enabled };
                if (e.hasDialog) step.showDialog = e.showDialog;
                return step;
            }),
        })),
    };
}

/** Replace spans of text, latest first. Spans must not overlap. */
function splice(text, edits) {
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    let out = text;
    let limit = Infinity;
    for (const e of sorted) {
        if (e.end > limit) throw new Error('Overlapping edits to the Action file');
        out = out.slice(0, e.start) + e.text + out.slice(e.end);
        limit = e.start;
    }
    return out;
}

/** Edits that remove some numbered blocks (and the line break after each), renumber the rest and fix the count. */
function removeAndRenumber(text, items, removed, countEntry, prefix) {
    const edits = [];
    let gone = 0;
    for (const it of items) {
        if (removed.has(it)) {
            const end = it.entry.end + /^[ \t]*(\r\n|\r|\n)?/.exec(text.slice(it.entry.end))[0].length;
            edits.push({ start: it.entry.start, end, text: '' });
            gone++;
            continue;
        }
        const n = it.index - gone;
        if (gone) edits.push({ start: it.entry.keyTok.start, end: it.entry.keyTok.end, text: `/${prefix}-${n}` });
    }
    if (gone) edits.push({ start: countEntry.value.start, end: countEntry.value.end, text: String(items.length - gone) });
    return edits;
}

/** Edits that set a step's on/off and dialog flags. */
function stepFlagEdits(action, event, stepNo, { enabled, showDialog }) {
    const edits = [];
    const e = event.entry.value.entries;
    const where = `${action.name}, step ${stepNo}`;
    if (enabled !== undefined) {
        const on = find(e, 'isOn');
        if (!on || on.value.kind !== 'word') throw new Error(`${where} has no on/off setting`);
        edits.push({ start: on.value.start, end: on.value.end, text: enabled ? '1' : '0' });
    }
    if (showDialog !== undefined) {
        const sd = find(e, 'showDialog');
        if (!event.hasDialog || !sd || sd.value.kind !== 'word') throw new Error(`${where} (${event.name ?? event.command}) has no dialog to show or skip`);
        edits.push({ start: sd.value.start, end: sd.value.end, text: showDialog ? '1' : '0' });
    }
    return edits;
}

/**
 * Apply edits to a parsed Action file and return the new text.
 * @param {ReturnType<typeof readActions>} file
 * @param {{ setName?: string, actions?: Array<{ name: string, rename?: string, remove?: boolean,
 *   steps?: Array<{ step: number, enabled?: boolean, showDialog?: boolean, remove?: boolean }> }> }} edits
 */
export function editActions(file, { setName, actions = [] } = {}) {
    const edits = [];
    if (setName !== undefined) edits.push({ start: file.nameEntry.value.start, end: file.nameEntry.value.end, text: encodeName(setName, 'setName') });
    const removedActions = new Set();
    const seen = new Set();
    for (const [i, change] of actions.entries()) {
        const label = `actions[${i}]`;
        if (!change || typeof change !== 'object' || typeof change.name !== 'string') throw new Error(`${label} needs the name of an action in the file`);
        const action = file.actions.find((a) => a.name === change.name);
        if (!action) throw new Error(`No action named ${JSON.stringify(change.name)} in the file. It has: ${file.actions.map((a) => a.name).join(', ')}`);
        if (seen.has(action)) throw new Error(`${label}: ${change.name} is listed twice`);
        seen.add(action);
        if (change.remove) {
            if (change.rename !== undefined || change.steps) throw new Error(`${label}: an action that is removed cannot also be renamed or edited`);
            removedActions.add(action);
            continue;
        }
        if (change.rename !== undefined) {
            if (!action.nameEntry) throw new Error(`${change.name} has no name entry`);
            edits.push({ start: action.nameEntry.value.start, end: action.nameEntry.value.end, text: encodeName(change.rename, `${label}.rename`) });
        }
        if (change.steps !== undefined) {
            if (!Array.isArray(change.steps)) throw new Error(`${label}.steps must be a list`);
            const removedSteps = new Set();
            for (const [j, s] of change.steps.entries()) {
                const stepNo = Number(s?.step);
                if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > action.events.length) {
                    throw new Error(`${label}.steps[${j}].step must be 1 to ${action.events.length} (the action's steps, in order)`);
                }
                const event = action.events[stepNo - 1];
                if (s.remove) {
                    if (s.enabled !== undefined || s.showDialog !== undefined) throw new Error(`${label}.steps[${j}]: a removed step takes no other setting`);
                    removedSteps.add(event);
                    continue;
                }
                if (s.enabled === undefined && s.showDialog === undefined) throw new Error(`${label}.steps[${j}]: give enabled, showDialog or remove`);
                edits.push(...stepFlagEdits(action, event, stepNo, { enabled: s.enabled === undefined ? undefined : Boolean(s.enabled), showDialog: s.showDialog === undefined ? undefined : Boolean(s.showDialog) }));
            }
            if (removedSteps.size === action.events.length) throw new Error(`${label}: removing every step would leave ${change.name} empty; remove the action instead`);
            if (removedSteps.size) {
                if (!action.countEntry) throw new Error(`${change.name} has no /eventCount`);
                edits.push(...removeAndRenumber(file.text, action.events, removedSteps, action.countEntry, 'event'));
            }
        }
    }
    if (removedActions.size === file.actions.length) throw new Error('Removing every action would leave the set empty');
    edits.push(...removeAndRenumber(file.text, file.actions, removedActions, file.countEntry, 'action'));
    return splice(file.text, edits);
}

/**
 * Compose a new action set from steps copied out of parsed Action files.
 * @param {string} setName
 * @param {Array<{ name: string, steps: Array<{ file: ReturnType<typeof readActions>, filePath: string, action: string, step?: number }> }>} actions
 * @returns {{ text: string, sources: object[][] }} the .aia text, and for each action the step spec each of its steps came from
 */
export function composeActions(setName, actions) {
    const sources = [];
    const lines = ['/version 3', `/name ${encodeName(setName, 'name')}`, '/isOpen 1', `/actionCount ${actions.length}`];
    actions.forEach((a, i) => {
        const events = [];
        for (const s of a.steps) {
            const action = s.file.actions.find((x) => x.name === s.action);
            if (!action) throw new Error(`No action named ${JSON.stringify(s.action)} in ${s.filePath}. It has: ${s.file.actions.map((x) => x.name).join(', ')}`);
            if (s.step === undefined) events.push(...action.events.map((ev) => ({ spec: s, ev })));
            else {
                const ev = action.events[s.step - 1];
                if (!ev) throw new Error(`${s.action} in ${s.filePath} has ${action.events.length} steps; step ${s.step} does not exist`);
                events.push({ spec: s, ev });
            }
        }
        if (!events.length) throw new Error(`Action ${a.name} has no steps`);
        lines.push(`/action-${i + 1} {`, `/name ${encodeName(a.name, `actions[${i}].name`)}`, '/keyIndex 0', '/colorIndex 0', '/isOpen 1', `/eventCount ${events.length}`);
        events.forEach(({ spec, ev }, k) => {
            lines.push(`/event-${k + 1} ${spec.file.text.slice(ev.entry.value.start, ev.entry.value.end).replace(/\r\n?/g, '\n')}`);
        });
        lines.push('}');
        sources.push(events.map((e) => e.spec));
    });
    return { text: lines.join('\n'), sources };
}
