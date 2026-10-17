/**
 * Graphics and captions: the Motion Graphics templates Premiere Pro has
 * installed, templates from Creative Cloud Libraries, the languages Speech to
 * Text supports and whether their language packs are installed, and importing
 * caption files.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { formatResponse, formatErrorResponse, json, str, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, sequenceSpec, itemSpec, seconds } from '../args.js';
import { checkedPath } from './project.js';

/** Caption files Premiere Pro imports (File > Import). */
export const CAPTION_EXTENSIONS = ['.srt', '.scc', '.mcc', '.dfxp', '.stl', '.xml'];

/** .mogrt files under dir, at most limit of them and depth folders down. */
function findTemplates(dir, filter, limit, depth = 6) {
    const out = [];
    const visit = (d, level) => {
        let entries;
        try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (out.length >= limit) return;
            const full = path.join(d, e.name);
            if (e.isDirectory() && level < depth) visit(full, level + 1);
            else if (e.isFile() && path.extname(e.name).toLowerCase() === '.mogrt') {
                const name = path.basename(e.name, path.extname(e.name));
                if (!filter || name.toLowerCase().includes(filter)) out.push({ name, filePath: full, folder: path.relative(dir, d) || '.' });
            }
        }
    };
    visit(dir, 1);
    return out;
}

export const tools = [
    {
        name: 'list_graphics_templates',
        description: 'List the Motion Graphics templates (.mogrt) installed in Premiere Pro\'s local templates folder (Window > Graphics Templates, Browse). Each filePath can be placed with insert_mogrt. The folder must be inside your home folder or PREMIERE_ALLOWED_DIRS to be listed',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'string', description: 'Only templates whose name contains this text (case-insensitive)' },
                limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'At most this many. Default 500', default: 500 },
            },
        },
        auditArgs: { filter: 'lower third' },
        hints: { readOnly: true },
        features: ['premiere.graphics_captions.graphics_templates_panel'],
        handler: async (a) => {
            const filter = a.filter === undefined ? null : String(a.filter).toLowerCase();
            const limit = Number(index(a.limit ?? 500, { name: 'limit', max: 5000 }));
            if (limit < 1) throw new Error("'limit' must be at least 1");
            const r = await executor.runStructured(script(`
const folder = await ppro.SequenceEditor.getInstalledMogrtPath();
if (!folder) throw new Error("Premiere Pro reported no Motion Graphics templates folder");
return { folder: folder };`));
            if (!r.ok) return formatErrorResponse(r.error, 'List graphics templates');
            const folder = r.result?.folder;
            if (typeof folder !== 'string' || !folder) return formatErrorResponse('Premiere Pro reported no Motion Graphics templates folder', 'List graphics templates');
            let dir;
            try {
                dir = checkedPath(folder, 'folder');
            } catch (e) {
                return formatResponse({ folder, listed: false, reason: e.message }, 'List graphics templates', () => false);
            }
            const templates = findTemplates(dir, filter, limit);
            return formatResponse({ folder: dir, listed: true, count: templates.length, templates }, 'List graphics templates', () => false);
        },
    },
    {
        name: 'insert_library_mogrt',
        description: 'Place a Motion Graphics template from a Creative Cloud Library in a sequence at a time on the given tracks (Libraries panel, or Graphics Templates > Libraries). Needs Creative Cloud Libraries signed in and synced. Its parameters can then be set as effect parameters (list_clip_effects, set_effect_param)',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                library: { type: 'string', description: 'Library name, as the Libraries panel shows it' },
                element: { type: 'string', description: 'The template\'s name in that library' },
                time: { type: 'number', minimum: 0, description: 'Sequence time in seconds' },
                videoTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: '0 = V1. Default 1 (V2)', default: 1 },
                audioTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: '0 = A1. Default 0', default: 0 },
            },
            required: ['library', 'element', 'time'],
        },
        auditArgs: { library: 'Brand', element: 'Lower third', time: 4 },
        hints: { openWorld: true },
        features: ['premiere.graphics_captions.mogrt_from_libraries', 'premiere.graphics_captions.add_mogrt_to_sequence'],
        handler: (a) => {
            for (const k of ['library', 'element']) if (typeof a[k] !== 'string' || !a[k].trim()) throw new Error(`'${k}' is empty`);
            const time = seconds(a.time, 'time');
            const v = index(a.videoTrackIndex ?? 1, { name: 'videoTrackIndex', max: 99 });
            const au = index(a.audioTrackIndex ?? 0, { name: 'audioTrackIndex', max: 99 });
            return run('Insert library Motion Graphics template', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const editor = ppro.SequenceEditor.getEditor(seq);
let placed;
project.lockedAccess(() => { placed = editor.insertMogrtFromLibrary(${str(a.library)}, ${str(a.element)}, __t(${time}), ${v}, ${au}); });
placed = await placed;
if (!placed || !placed.length) throw new Error("Premiere Pro did not place " + ${str(a.element)} + " from the library " + ${str(a.library)} + " (check both names and that Creative Cloud Libraries are synced)");
const out = [];
for (const c of placed) out.push(await __clipInfo(c));
return { sequence: seq.name, library: ${str(a.library)}, element: ${str(a.element)}, placed: out };`));
        },
    },
    {
        name: 'list_transcription_languages',
        description: 'List the languages Speech to Text can transcribe (Premiere Pro 26.3 or later) and whether each one\'s language pack is installed (Preferences > Transcription), or check given language codes such as "en-US". Language packs are installed from Creative Cloud or Premiere Pro, not here',
        inputSchema: {
            type: 'object',
            properties: {
                languages: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'Only check these language codes, e.g. ["en-US", "fr-FR"] (works before 26.3 too)' },
            },
        },
        auditArgs: { languages: undefined },
        hints: { readOnly: true },
        guarded: ['querySupportedLanguages', 'isLanguagePackAvailable'],
        features: ['premiere.graphics_captions.supported_languages', 'premiere.graphics_captions.language_packs'],
        handler: (a) => {
            if (a.languages !== undefined && !Array.isArray(a.languages)) throw new Error("'languages' must be a list of codes");
            const codes = (a.languages ?? []).map((c, i) => {
                if (typeof c !== 'string' || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(c)) throw new Error(`languages[${i}] must be a language code such as "en-US"`);
                return c;
            });
            return run('List transcription languages', script(`
const T = ppro.Transcript;
const codes = ${json(codes)};
const pack = (code) => (typeof T.isLanguagePackAvailable === "function" ? Boolean(T.isLanguagePackAvailable(code)) : null);
let languages;
if (codes.length) {
  languages = codes.map((code) => ({ code: code, packInstalled: pack(code) }));
} else {
  if (typeof T.querySupportedLanguages !== "function") throw new Error("Listing the languages needs Premiere Pro 26.3 or later; pass languages to check given codes");
  languages = [];
  for (const l of (await T.querySupportedLanguages()) || []) {
    const { displayString, languageCode, locale } = l;
    languages.push({ name: displayString, code: languageCode, locale: locale, packInstalled: pack(languageCode) });
  }
}
return { count: languages.length, languages: languages };`));
        },
    },
    {
        name: 'import_captions',
        description: `Import caption files (${CAPTION_EXTENSIONS.join(', ')}: SubRip, Scenarist, MacCaption, DFXP, EBU STL, W3C/SMPTE/EBU Timed Text XML) into the project without Premiere Pro's dialogs (File > Import), into the root or a bin. Each becomes a captions item to place on a caption track`,
        inputSchema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: 'Absolute paths of caption files' },
                bin: { ...ITEM_SCHEMA, description: 'Import into this bin. Default: the project root' },
            },
            required: ['files'],
        },
        auditArgs: { files: [`${process.env.HOME ?? '/tmp'}/Documents/episode.srt`], bin: { path: 'Captions' } },
        features: ['premiere.graphics_captions.caption_formats', 'premiere.graphics_captions.import_caption_file'],
        handler: (a) => {
            if (!Array.isArray(a.files) || !a.files.length) throw new Error("'files' must list at least one caption file");
            const files = a.files.map((f, i) => checkedPath(f, `files[${i}]`, CAPTION_EXTENSIONS));
            return run('Import captions', script(`
const project = await __project();
const target = await __bin(project, ${a.bin ? itemSpec(a.bin, 'bin') : 'null'});
const before = new Set((target.children || []).map((c) => c.getId()));
const ok = await project.importFiles(${json(files)}, true, target.item, false);
if (!ok) throw new Error("Premiere Pro did not import the caption files (check that they exist and are a supported caption format)");
const after = await __entry(target.item, target.path);
const added = (after.children || []).filter((c) => !before.has(c.getId())).map((c) => ({ name: c.name, id: c.getId() }));
return { imported: added.length, bin: target.path || "(root)", items: added };`));
        },
    },
];
