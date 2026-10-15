/**
 * Colour: Edit > Edit Colors, swatch management, swatch libraries, gradients
 * placed on objects, colour settings and proofing.
 *
 * The Edit Colors commands without a dialog run as menu commands on the
 * selection. The dialog-based ones (Saturate, Adjust Color Balance, Overprint
 * Black) and the Color panel's Complement are done by script on fill and
 * stroke colours, following what each dialog describes. Swatches, swatch
 * groups and libraries use the object model; a swatch library is an
 * Illustrator file whose swatches are copied in or out.
 */
import { readFileSync } from 'node:fs';
import { str, num, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';
import { EACH_PATH } from './appearance.js';
import { paths } from './documents.js';

/** Edit > Edit Colors commands that run without a dialog. */
export const EDIT_COLORS = {
    convert_to_cmyk: 'Colors8',
    convert_to_rgb: 'Colors9',
    convert_to_grayscale: 'Colors7',
    invert: 'Colors6',
    blend_front_to_back: 'Colors3',
    blend_horizontally: 'Colors4',
    blend_vertically: 'Colors5',
};

/** ES3: the name Illustrator gives a process colour's swatch, or null for other colours. */
const COLOR_NAME = `
function __colorName(c) {
  var r = Math.round;
  switch (c.typename) {
    case "CMYKColor": return "C=" + r(c.cyan) + " M=" + r(c.magenta) + " Y=" + r(c.yellow) + " K=" + r(c.black);
    case "RGBColor": return "R=" + r(c.red) + " G=" + r(c.green) + " B=" + r(c.blue);
    case "GrayColor": return "K=" + r(c.gray);
  }
  return null;
}`;

/** ES3: the swatch group with a name, created when asked. */
const GROUP = `
function __swatchGroup(doc, name, create) {
  for (var g = 0; g < doc.swatchGroups.length; g++) if (doc.swatchGroups[g].name === name) return doc.swatchGroups[g];
  if (!create) throw new Error("Swatch group " + name + " not found");
  var grp = doc.swatchGroups.add();
  grp.name = name;
  return grp;
}
function __addToGroup(doc, grp, sw) {
  try { grp.addSwatch(sw); return; } catch (e) {}
  grp.addSpot(doc.spots.getByName(sw.name));
}`;

/** Window > Swatch Libraries entries: their menu path and command id. */
export const SWATCH_LIBRARIES = JSON.parse(readFileSync(new URL('../data/menu-commands.json', import.meta.url), 'utf8')).commands
    .filter((c) => c.menu[0] === 'Window' && c.menu[1] === 'Swatch Libraries' && c.menu.length > 2 && !c.menu[c.menu.length - 1].endsWith('...'))
    .map((c) => ({ name: c.menu.slice(2).join(' > '), parts: c.menu.slice(2), command: c.id }));

/** A built-in swatch library from its menu path ("Gradients > Water") or a unique last part ("Water"). */
export function swatchLibrary(value) {
    const want = String(value ?? '').split(/\s*[>/\\]\s*/).map((s) => s.trim()).filter(Boolean).join(' > ').toLowerCase();
    if (!want) throw new Error("Give the library's Window > Swatch Libraries path, e.g. \"Gradients > Water\"");
    const exact = SWATCH_LIBRARIES.find((l) => l.name.toLowerCase() === want);
    if (exact) return exact;
    const leaf = SWATCH_LIBRARIES.filter((l) => l.parts[l.parts.length - 1].toLowerCase() === want);
    if (leaf.length === 1) return leaf[0];
    const near = (leaf.length ? leaf : SWATCH_LIBRARIES.filter((l) => l.name.toLowerCase().includes(want))).slice(0, 10).map((l) => l.name);
    throw new Error(`Unknown swatch library "${value}". ${near.length ? `Did you mean: ${near.join('; ')}` : 'Give its Window > Swatch Libraries path, e.g. "Gradients > Water"'}`);
}

/**
 * JSX for the File of a swatch library: a built-in library (found under
 * Illustrator's Presets/<locale>/Swatches folder) or a caller's .ai file.
 */
function libraryFile(a, { optional = false } = {}) {
    if (a.library !== undefined && a.filePath !== undefined) throw new Error("Give 'library' or 'filePath', not both");
    if (a.filePath !== undefined) {
        const p = paths.validate(a.filePath);
        if (!/\.ai$/i.test(p)) throw new Error("'filePath' must be an Illustrator (.ai) swatch library");
        return { expr: `new File(${jsxPath(p)})`, label: p };
    }
    if (a.library === undefined) {
        if (optional) return null;
        throw new Error("Give 'library' (a Window > Swatch Libraries path such as \"Gradients > Water\") or 'filePath' (an .ai swatch library)");
    }
    const lib = swatchLibrary(a.library);
    if (lib.parts[0] === 'Color Books') throw new Error(`${lib.name} is a colour book (.acb), which only opens as a panel: use open_swatch_library`);
    return { expr: `__libraryFile(${json(lib.parts)})`, label: lib.name };
}

/** ES3: find a built-in swatch library file from its menu path parts. */
const LIBRARY_FILE = `
function __findFile(folder, name) {
  var items = folder.getFiles();
  for (var i = 0; i < items.length; i++) {
    if (items[i] instanceof Folder) { var f = __findFile(items[i], name); if (f) return f; }
    else if (decodeURI(items[i].name) === name) return items[i];
  }
  return null;
}
function __libraryFile(parts) {
  var roots = ["Presets.localized", "Presets"], locales = [app.locale, "en_US"], dir = new Folder(app.path);
  for (var up = 0; up < 4 && dir; up++) {
    for (var r = 0; r < roots.length; r++) for (var l = 0; l < locales.length; l++) {
      var base = new Folder(dir.fsName + "/" + roots[r] + "/" + locales[l] + "/Swatches");
      if (!base.exists) continue;
      var f = new File(base.fsName + "/" + parts.join("/") + ".ai");
      if (f.exists) return f;
      var found = __findFile(base, parts[parts.length - 1] + ".ai");
      if (found) return found;
    }
    dir = dir.parent;
  }
  throw new Error("Swatch library " + parts.join(" > ") + " was not found in Illustrator's Presets folder");
}`;

/** ES3: the document already open on a file, or null. */
const OPEN_DOC = `
function __openDoc(f) {
  for (var d = 0; d < app.documents.length; d++) if (__isFile(app.documents[d], f)) return app.documents[d];
  return null;
}
function __isFile(d, f) {
  try { return d.fullName.fsName === f.fsName; } catch (e) { return false; }
}`;

/**
 * ES3: copy colours, spots, gradients and swatches into a document (the same
 * one, or another such as a swatch library). Patterns cannot be copied.
 */
const COPY = `
function __cloneColor(dst, c) {
  var n;
  switch (c.typename) {
    case "RGBColor": n = new RGBColor(); n.red = c.red; n.green = c.green; n.blue = c.blue; return n;
    case "CMYKColor": n = new CMYKColor(); n.cyan = c.cyan; n.magenta = c.magenta; n.yellow = c.yellow; n.black = c.black; return n;
    case "GrayColor": n = new GrayColor(); n.gray = c.gray; return n;
    case "LabColor": n = new LabColor(); n.l = c.l; n.a = c.a; n.b = c.b; return n;
    case "SpotColor": n = new SpotColor(); n.spot = __copySpot(dst, c.spot, c.spot.name, false); n.tint = c.tint; return n;
    case "GradientColor": n = new GradientColor(); n.gradient = __copyGradient(dst, c.gradient, c.gradient.name, false); return n;
  }
  return new NoColor();
}
function __copySpot(dst, sp, name, replace) {
  var t = null;
  try { t = dst.spots.getByName(name); } catch (e) { t = null; }
  if (t && !replace) return t;
  var v = __cloneColor(dst, sp.color), type = sp.colorType;
  if (!t) { t = dst.spots.add(); t.name = name; }
  if (v.typename === "LabColor") { try { t.spotKind = SpotColorKind.SPOTLAB; } catch (e) {} }
  t.color = v;
  t.colorType = type;
  return t;
}
function __copyGradient(dst, g, name, replace) {
  var t = null;
  try { t = dst.gradients.getByName(name); } catch (e) { t = null; }
  if (t && !replace) return t;
  var src = g.gradientStops, stops = [];
  for (var i = 0; i < src.length; i++) stops.push({ rampPoint: src[i].rampPoint, midPoint: src[i].midPoint, opacity: src[i].opacity, color: __cloneColor(dst, src[i].color) });
  if (!t) { t = dst.gradients.add(); t.name = name; }
  t.type = g.type;
  var d = t.gradientStops;
  while (d.length < stops.length) d.add();
  while (d.length > stops.length) d[d.length - 1].remove();
  for (var j = 0; j < stops.length; j++) {
    d[j].rampPoint = stops[j].rampPoint; d[j].midPoint = stops[j].midPoint; d[j].opacity = stops[j].opacity; d[j].color = stops[j].color;
  }
  return t;
}
function __copySwatch(dst, sw, name, replace) {
  var c = sw.color, ex = null;
  if (c.typename === "SpotColor" && sw.name === c.spot.name) { __copySpot(dst, c.spot, name, replace); return dst.swatches.getByName(name); }
  if (c.typename === "GradientColor" && sw.name === c.gradient.name) { __copyGradient(dst, c.gradient, name, replace); return dst.swatches.getByName(name); }
  try { ex = dst.swatches.getByName(name); } catch (e) { ex = null; }
  if (ex && !replace) return ex;
  var v = __cloneColor(dst, c);
  if (!ex) { ex = dst.swatches.add(); ex.name = name; }
  ex.color = v;
  return ex;
}
function __groupOf(d, name) {
  for (var g = 1; g < d.swatchGroups.length; g++) {
    var m = d.swatchGroups[g].getAllSwatches();
    for (var i = 0; i < m.length; i++) if (m[i].name === name) return d.swatchGroups[g];
  }
  return null;
}
function __copyInto(dst, src, names, replace) {
  var want = null, seen = {}, copied = {}, out = { copied: [], existing: [], skipped: [], notFound: [] };
  if (names) { want = {}; for (var n = 0; n < names.length; n++) want[names[n]] = true; }
  for (var i = 0; i < src.swatches.length; i++) {
    var sw = src.swatches[i], nm = sw.name, t = sw.color.typename;
    if (want && !want.hasOwnProperty(nm)) continue;
    seen[nm] = true;
    if (nm === "[None]" || nm === "[Registration]") continue;
    if (t === "PatternColor" || t === "NoColor") { out.skipped.push(nm); continue; }
    var ex = null;
    try { ex = dst.swatches.getByName(nm); } catch (e) { ex = null; }
    if (ex && !replace) { out.existing.push(nm); continue; }
    __copySwatch(dst, sw, nm, true);
    copied[nm] = true;
    out.copied.push(nm);
  }
  if (want) for (var w = 0; w < names.length; w++) if (!seen.hasOwnProperty(names[w])) out.notFound.push(names[w]);
  for (var g = 1; g < src.swatchGroups.length; g++) {
    var sg = src.swatchGroups[g], members = sg.getAllSwatches(), grp = null;
    for (var m = 0; m < members.length; m++) {
      if (!copied.hasOwnProperty(members[m].name)) continue;
      if (!grp) grp = __swatchGroup(dst, sg.name, true);
      __addToGroup(dst, grp, dst.swatches.getByName(members[m].name));
    }
  }
  return out;
}`;

/** ES3: a comparable key for a colour value, or null for gradients, patterns and none. */
const COLOR_KEY = `
function __colorKey(c) {
  var r = function (v) { return Math.round(v * 100) / 100; };
  switch (c.typename) {
    case "RGBColor": return "rgb:" + r(c.red) + "," + r(c.green) + "," + r(c.blue);
    case "CMYKColor": return "cmyk:" + r(c.cyan) + "," + r(c.magenta) + "," + r(c.yellow) + "," + r(c.black);
    case "GrayColor": return "gray:" + r(c.gray);
    case "LabColor": return "lab:" + r(c.l) + "," + r(c.a) + "," + r(c.b);
    case "SpotColor": return "spot:" + c.spot.name + "@" + r(c.tint);
  }
  return null;
}`;

/**
 * ES3: offer every fill and stroke colour in the document (paths, including
 * those in groups and compound paths, text characters, and optionally the
 * stops of every gradient) to fn, which returns a replacement or null.
 */
const EACH_PAINT = `
function __eachPaint(doc, fn, counts, stops) {
  var r;
  for (var i = 0; i < doc.pathItems.length; i++) {
    var p = doc.pathItems[i];
    try {
      if (p.filled) { r = fn(p.fillColor); if (r) { p.fillColor = r; counts.paths++; } }
      if (p.stroked) { r = fn(p.strokeColor); if (r) { p.strokeColor = r; counts.paths++; } }
    } catch (e) { counts.locked++; }
  }
  for (var t = 0; t < doc.textFrames.length; t++) {
    var chars = doc.textFrames[t].textRange.characters;
    for (var k = 0; k < chars.length; k++) {
      try {
        var ca = chars[k].characterAttributes;
        r = fn(ca.fillColor); if (r) { ca.fillColor = r; counts.text++; }
        r = fn(ca.strokeColor); if (r) { ca.strokeColor = r; counts.text++; }
      } catch (e) { counts.locked++; }
    }
  }
  if (stops) for (var g = 0; g < doc.gradients.length; g++) {
    var st = doc.gradients[g].gradientStops;
    for (var s = 0; s < st.length; s++) { r = fn(st[s].color); if (r) { st[s].color = r; counts.gradientStops++; } }
  }
}`;

/** ES3: a document swatch by name, or an error naming it. */
const GET_SWATCH = `
function __swatch(doc, name) {
  var sw = null;
  try { sw = doc.swatches.getByName(name); } catch (e) { sw = null; }
  if (!sw) throw new Error("Swatch " + name + " not found");
  return sw;
}
function __kind(sw) {
  var c = sw.color;
  if (c.typename === "SpotColor") {
    if (c.spot.colorType === ColorModel.REGISTRATION) return "registration";
    if (sw.name !== c.spot.name) return "tint";
    return c.spot.colorType === ColorModel.PROCESS ? "global" : "spot";
  }
  if (c.typename === "GradientColor") return "gradient";
  if (c.typename === "PatternColor") return "pattern";
  if (c.typename === "NoColor") return "none";
  return "process";
}`;

/** Edit Colors done by script: what each operation does to one colour. */
const ADJUSTMENTS = ['saturate', 'adjust_balance', 'complement', 'web_safe', 'printable'];
const BALANCE_MODES = ['cmyk', 'rgb', 'gray', 'global'];
const BALANCE_CHANNELS = { cmyk: ['cyan', 'magenta', 'yellow', 'black'], rgb: ['red', 'green', 'blue'], gray: ['black'], global: ['tint'] };
const PERCENT = { type: 'number', minimum: -100, maximum: 100 };

/** ES3 source of __adjust(c): the adjusted colour, or null when the operation does not apply to c. */
function adjustFunction(a) {
    const op = enumOf(a.operation, ADJUSTMENTS, { name: 'operation' });
    const clamp = 'function __clamp(v, hi) { return v < 0 ? 0 : (v > hi ? hi : v); }';
    if (op === 'saturate') {
        if (a.amount === undefined) throw new Error("saturate needs 'amount', -100 to 100 percent");
        const f = 1 + Number(num(a.amount, { min: -100, max: 100, name: 'amount' })) / 100;
        return `${clamp}
function __adjust(c) {
  var n, f = ${f};
  if (c.typename === "CMYKColor") { n = new CMYKColor(); n.cyan = __clamp(c.cyan * f, 100); n.magenta = __clamp(c.magenta * f, 100); n.yellow = __clamp(c.yellow * f, 100); n.black = __clamp(c.black * f, 100); return n; }
  if (c.typename === "RGBColor") { n = new RGBColor(); n.red = 255 - __clamp((255 - c.red) * f, 255); n.green = 255 - __clamp((255 - c.green) * f, 255); n.blue = 255 - __clamp((255 - c.blue) * f, 255); return n; }
  if (c.typename === "GrayColor") { n = new GrayColor(); n.gray = __clamp(c.gray * f, 100); return n; }
  if (c.typename === "SpotColor") { n = new SpotColor(); n.spot = c.spot; n.tint = __clamp(c.tint * f, 100); return n; }
  return null;
}`;
    }
    if (op === 'adjust_balance') {
        const mode = enumOf(a.mode ?? '', BALANCE_MODES, { name: 'mode' });
        const allChannels = [...new Set(Object.values(BALANCE_CHANNELS).flat())];
        const stray = allChannels.filter((ch) => a[ch] !== undefined && !BALANCE_CHANNELS[mode].includes(ch));
        if (stray.length) throw new Error(`mode ${mode} adjusts ${BALANCE_CHANNELS[mode].join(', ')}; ${stray.join(', ')} do not apply`);
        const d = Object.fromEntries(BALANCE_CHANNELS[mode].map((ch) => [ch, Number(num(a[ch] ?? 0, { min: -100, max: 100, name: ch }))]));
        if (Object.values(d).every((v) => v === 0)) throw new Error(`adjust_balance needs at least one of ${BALANCE_CHANNELS[mode].join(', ')}, -100 to 100`);
        const body = {
            cmyk: `if (c.typename !== "CMYKColor") return null;
  var n = new CMYKColor(); n.cyan = __clamp(c.cyan + ${d.cyan}, 100); n.magenta = __clamp(c.magenta + ${d.magenta}, 100); n.yellow = __clamp(c.yellow + ${d.yellow}, 100); n.black = __clamp(c.black + ${d.black}, 100); return n;`,
            rgb: `if (c.typename !== "RGBColor") return null;
  var n = new RGBColor(); n.red = __clamp(c.red + ${d.red} * 2.55, 255); n.green = __clamp(c.green + ${d.green} * 2.55, 255); n.blue = __clamp(c.blue + ${d.blue} * 2.55, 255); return n;`,
            gray: `if (c.typename !== "GrayColor") return null;
  var n = new GrayColor(); n.gray = __clamp(c.gray + ${d.black}, 100); return n;`,
            global: `if (c.typename !== "SpotColor") return null;
  var n = new SpotColor(); n.spot = c.spot; n.tint = __clamp(c.tint + ${d.tint}, 100); return n;`,
        }[mode];
        return `${clamp}
function __adjust(c) {
  ${body}
}`;
    }
    if (op === 'complement') {
        return `function __adjust(c) {
  var n, s;
  if (c.typename === "RGBColor") {
    s = Math.max(c.red, c.green, c.blue) + Math.min(c.red, c.green, c.blue);
    n = new RGBColor(); n.red = s - c.red; n.green = s - c.green; n.blue = s - c.blue; return n;
  }
  if (c.typename === "CMYKColor") {
    s = Math.max(c.cyan, c.magenta, c.yellow) + Math.min(c.cyan, c.magenta, c.yellow);
    n = new CMYKColor(); n.cyan = s - c.cyan; n.magenta = s - c.magenta; n.yellow = s - c.yellow; n.black = c.black; return n;
  }
  return null;
}`;
    }
    if (op === 'web_safe') {
        return `function __adjust(c) {
  if (c.typename !== "RGBColor") return null;
  var n = new RGBColor(); n.red = Math.round(c.red / 51) * 51; n.green = Math.round(c.green / 51) * 51; n.blue = Math.round(c.blue / 51) * 51; return n;
}`;
    }
    return `function __adjust(c) {
  if (c.typename !== "RGBColor") return null;
  var k = app.convertSampleColor(ImageColorSpace.RGB, [c.red, c.green, c.blue], ImageColorSpace.CMYK, ColorConvertPurpose.defaultpurpose);
  var v = app.convertSampleColor(ImageColorSpace.CMYK, k, ImageColorSpace.RGB, ColorConvertPurpose.defaultpurpose);
  var n = new RGBColor(); n.red = v[0]; n.green = v[1]; n.blue = v[2]; return n;
}`;
}

/** View > Proof Setup entries (no dialog) and their menu commands. */
export const PROOF_SETUPS = {
    working_cmyk: 'proof-document',
    legacy_mac_rgb: 'proof-mac-rgb',
    srgb: 'proof-win-rgb',
    monitor_rgb: 'proof-monitor-rgb',
    protanopia: 'proof-colorblindp',
    deuteranopia: 'proof-colorblindd',
};

export const tools = [
    {
        name: 'edit_colors',
        description: 'Recolour the targets with an Edit > Edit Colors command: convert to CMYK, RGB or grayscale, invert, or blend the fills between the frontmost and backmost (or leftmost and rightmost, topmost and bottommost) objects',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(EDIT_COLORS) },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.color.convert_to_cmyk',
            'illustrator.color.convert_to_rgb',
            'illustrator.color.convert_to_grayscale',
            'illustrator.color.convert_color_modes',
            'illustrator.color.invert_colors',
            'illustrator.color.color_invert',
            'illustrator.color.blend_front_to_back',
            'illustrator.color.blend_horizontally',
            'illustrator.color.blend_vertically',
        ],
        menuCommands: Object.values(EDIT_COLORS),
        handler: (a) => {
            const command = EDIT_COLORS[enumOf(a.operation, Object.keys(EDIT_COLORS), { name: 'operation' })];
            return run('Edit colours', script(`
var items = __targets(doc, ${targetSpec(a.target)});
if (${a.operation.startsWith('blend_')} && items.length < 3) throw new Error("Blending colours needs at least three filled objects");
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand(${str(command)});
var out = [];
for (var j = 0; j < items.length; j++) out.push(__itemInfo(doc, items[j]));
__result__ = { operation: ${str(a.operation)}, items: out };`));
        },
    },
    {
        name: 'create_swatch_group',
        description: 'Create a swatch group (a colour group in the Swatches panel), optionally moving existing swatches into it',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                swatches: { type: 'array', items: { type: 'string' }, description: 'Names of existing swatches to move into the group' },
            },
            required: ['name'],
        },
        features: [
            'illustrator.color.swatch_group',
            'illustrator.color.swatches_menu.new_swatch_group',
            'illustrator.color.group_swatches',
            'illustrator.color.move_colors_into_groups',
            'illustrator.color.color_groups',
        ],
        handler: (a) => run('Create swatch group', script(`${GROUP}
for (var g = 0; g < doc.swatchGroups.length; g++) if (doc.swatchGroups[g].name === ${str(a.name)}) throw new Error("A swatch group named " + ${str(a.name)} + " already exists");
var names = ${json((a.swatches ?? []).map(String))}, found = [];
for (var i = 0; i < names.length; i++) {
  var sw = null;
  try { sw = doc.swatches.getByName(names[i]); } catch (e) { sw = null; }
  if (!sw) throw new Error("Swatch " + names[i] + " not found");
  found.push(sw);
}
var grp = __swatchGroup(doc, ${str(a.name)}, true);
for (var j = 0; j < found.length; j++) __addToGroup(doc, grp, found[j]);
var all = grp.getAllSwatches(), members = [];
for (var m = 0; m < all.length; m++) members.push(all[m].name);
__result__ = { group: grp.name, swatches: members };`)),
    },
    {
        name: 'delete_swatches',
        description: 'Delete swatches by name',
        inputSchema: {
            type: 'object',
            properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            required: ['names'],
        },
        features: ['illustrator.color.swatches_menu.delete_swatch'],
        handler: (a) => {
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("'names' must list at least one swatch");
            return run('Delete swatches', script(`
var names = ${json(a.names.map(String))}, deleted = [], missing = [];
for (var i = 0; i < names.length; i++) {
  if (names[i] === "[None]" || names[i] === "[Registration]") throw new Error(names[i] + " cannot be deleted");
  var sw = null;
  try { sw = doc.swatches.getByName(names[i]); } catch (e) { sw = null; }
  if (!sw) { missing.push(names[i]); continue; }
  sw.remove();
  deleted.push(names[i]);
}
__result__ = { deleted: deleted, notFound: missing };`));
        },
    },
    {
        name: 'add_used_colors',
        description: 'Add a swatch for each process colour used in the fills and strokes of the artwork (Swatches panel > Add Used Colors), skipping colours that already have one. Swatches are named the way Illustrator names them, e.g. "C=0 M=60 Y=100 K=0"',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Only these items. Default the whole document' },
                group: { type: 'string', description: 'Put the new swatches in this swatch group, created if needed' },
            },
        },
        features: [
            'illustrator.color.swatches_menu.add_used_colors',
            'illustrator.color.add_colors_to_swatches',
            'illustrator.color.swatch_group',
            'illustrator.color.color_groups',
        ],
        handler: (a) => run('Add used colours', script(`${EACH_PATH}${COLOR_NAME}${GROUP}
var known = {}, colors = [], names = {}, counts = { paths: 0, skipped: [] };
for (var s = 0; s < doc.swatches.length; s++) { var kn = __colorName(doc.swatches[s].color); if (kn) known[kn] = true; }
function consider(c) { var n = __colorName(c); if (n && !known[n] && !names[n]) { names[n] = true; colors.push(c); } }
function paint(p) { if (p.filled) consider(p.fillColor); if (p.stroked) consider(p.strokeColor); }
var items = ${a.target ? `__targets(doc, ${targetSpec(a.target)})` : 'null'}, texts = [];
if (items) {
  for (var i = 0; i < items.length; i++) { if (items[i].typename === "TextFrame") texts.push(items[i]); else __eachPath(items[i], paint, counts); }
} else {
  for (var p = 0; p < doc.pathItems.length; p++) { paint(doc.pathItems[p]); counts.paths++; }
  for (var t = 0; t < doc.textFrames.length; t++) texts.push(doc.textFrames[t]);
}
for (var x = 0; x < texts.length; x++) {
  try { consider(texts[x].textRange.characterAttributes.fillColor); } catch (e) {}
  try { consider(texts[x].textRange.characterAttributes.strokeColor); } catch (e) {}
}
var grp = ${a.group ? `__swatchGroup(doc, ${str(a.group)}, true)` : 'null'}, added = [];
for (var c = 0; c < colors.length; c++) {
  var sw = doc.swatches.add();
  sw.name = __colorName(colors[c]);
  sw.color = colors[c];
  if (grp) __addToGroup(doc, grp, sw);
  added.push(sw.name);
}
__result__ = { added: added, group: grp ? grp.name : null, pathsScanned: counts.paths, textFrames: texts.length };`)),
    },

    // Swatch management
    {
        name: 'edit_swatch',
        description: 'Change a swatch the way Swatch Options does (Swatches panel > Swatch Options): rename it, change its colour, or change its type between process, global process and spot. Changing a global or spot swatch\'s colour updates every object that uses it. Making a process swatch global or spot recreates it as a new global or spot colour; making a global or spot swatch process deletes the global colour, and objects that used it keep its colour as a process colour',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The swatch to change' },
                newName: { type: 'string' },
                color: { ...COLOR_SCHEMA, description: 'New colour value: "cmyk(c,m,y,k)", "rgb(r,g,b)", "#RRGGBB" or "gray(g)"' },
                type: { type: 'string', enum: ['process', 'global', 'spot'] },
            },
            required: ['name'],
        },
        features: [
            'illustrator.color.swatches_menu.swatch_options',
            'illustrator.color.recolor_edit_individual',
        ],
        hints: { idempotent: true },
        auditArgs: { name: 'Brand Blue', newName: 'Brand Navy', color: 'cmyk(100,80,0,20)', type: 'global' },
        handler: (a) => {
            if (a.newName === undefined && a.color === undefined && a.type === undefined) throw new Error('Give at least one of newName, color, type');
            const spec = a.color === undefined ? null : colorSpec(a.color, 'color');
            if (spec && ['swatch', 'none'].includes(JSON.parse(spec).kind)) throw new Error("'color' must be a colour value, not a swatch name or none");
            const type = a.type === undefined ? null : enumOf(a.type, ['process', 'global', 'spot'], { name: 'type' });
            if (a.newName !== undefined && !String(a.newName).trim()) throw new Error("'newName' cannot be empty");
            return run('Edit swatch', script(`${GROUP}${GET_SWATCH}${COPY}
var sw = __swatch(doc, ${str(a.name)}), kind = __kind(sw), nm = sw.name;
if (kind === "none" || kind === "registration") throw new Error(nm + " cannot be edited");
if ((kind === "gradient" || kind === "pattern") && ${bool(spec || type)}) throw new Error("Only the name of a " + kind + " swatch can be changed here");
if (kind === "tint" && ${bool(spec || type)}) throw new Error(nm + " is a tint of " + sw.color.spot.name + "; edit that swatch instead");
${a.newName !== undefined ? `var clash = null;
try { clash = doc.swatches.getByName(${str(a.newName)}); } catch (e) { clash = null; }
if (clash && ${str(a.newName)} !== nm) throw new Error("A swatch named " + ${str(a.newName)} + " already exists");` : ''}
${type ? `var want = ${str(type)}, grp = __groupOf(doc, nm);
if (want !== kind) {
  if (want === "process") {
    var value = __cloneColor(doc, sw.color.spot.color);
    sw.remove();
    sw = doc.swatches.add(); sw.name = nm; sw.color = value;
    if (grp) __addToGroup(doc, grp, sw);
  } else if (kind === "process") {
    var base = __cloneColor(doc, sw.color);
    sw.remove();
    var sp = doc.spots.add(); sp.name = nm; sp.color = base; sp.colorType = want === "spot" ? ColorModel.SPOT : ColorModel.PROCESS;
    sw = doc.swatches.getByName(nm);
    if (grp) __addToGroup(doc, grp, sw);
  } else {
    sw.color.spot.colorType = want === "spot" ? ColorModel.SPOT : ColorModel.PROCESS;
  }
}` : ''}
${spec ? `var nc = __color(doc, ${spec});
if (sw.color.typename === "SpotColor") sw.color.spot.color = nc; else sw.color = nc;` : ''}
${a.newName !== undefined ? `if (sw.color.typename === "SpotColor" && __kind(sw) !== "tint") sw.color.spot.name = ${str(a.newName)}; else sw.name = ${str(a.newName)};` : ''}
sw = doc.swatches.getByName(${a.newName !== undefined ? str(a.newName) : 'nm'});
__result__ = { name: sw.name, kind: __kind(sw), color: __colorInfo(sw.color), value: sw.color.typename === "SpotColor" ? __colorInfo(sw.color.spot.color) : null };`));
        },
    },
    {
        name: 'duplicate_swatches',
        description: 'Duplicate swatches (Swatches panel > Duplicate Swatch). Each copy is named "<name> copy" (then "copy 2" and so on) and goes in the same swatch group; a global or spot swatch becomes a new global or spot colour and a gradient swatch a new gradient. Pattern swatches cannot be duplicated by script',
        inputSchema: {
            type: 'object',
            properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Swatches to duplicate' } },
            required: ['names'],
        },
        features: [
            'illustrator.color.swatches_menu.duplicate_swatch',
            'illustrator.color.duplicate_swatches',
        ],
        auditArgs: { names: ['Brand Blue', 'Sky'] },
        handler: (a) => {
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("'names' must list at least one swatch");
            return run('Duplicate swatches', script(`${GROUP}${GET_SWATCH}${COPY}
var names = ${json(a.names.map(String))}, out = [], skipped = [];
for (var i = 0; i < names.length; i++) {
  var sw = __swatch(doc, names[i]), kind = __kind(sw);
  if (kind === "none" || kind === "registration" || kind === "pattern") { skipped.push(names[i]); continue; }
  var nm = names[i] + " copy", k = 2, taken = true;
  while (taken) {
    try { taken = !!doc.swatches.getByName(nm); } catch (e) { taken = false; }
    if (taken) nm = names[i] + " copy " + k++;
  }
  var copy = __copySwatch(doc, sw, nm, false), grp = __groupOf(doc, names[i]);
  if (grp) __addToGroup(doc, grp, copy);
  out.push({ source: names[i], name: copy.name, kind: __kind(copy) });
}
__result__ = { duplicated: out, skipped: skipped };`));
        },
    },
    {
        name: 'merge_swatches',
        description: 'Merge swatches into the first one named (Swatches panel > Merge Swatches): every fill, stroke, text colour and gradient stop that uses one of the other swatches is repainted with the first, then the others are deleted. A global or spot swatch is matched wherever it is used, keeping each use\'s tint; a process swatch is matched by colour value. Works on colour swatches, not gradients or patterns',
        inputSchema: {
            type: 'object',
            properties: { names: { type: 'array', items: { type: 'string' }, minItems: 2, description: 'The swatch to keep first, then the swatches to merge into it' } },
            required: ['names'],
        },
        features: ['illustrator.color.replace_merge_delete_swatches'],
        hints: { destructive: true },
        auditArgs: { names: ['Brand Blue', 'Old Blue', 'Blue 2'] },
        handler: (a) => {
            if (!Array.isArray(a.names) || a.names.length < 2) throw new Error("'names' needs the swatch to keep and at least one to merge into it");
            const names = a.names.map(String);
            if (new Set(names).size !== names.length) throw new Error("'names' lists a swatch twice");
            return run('Merge swatches', script(`${GET_SWATCH}${COLOR_KEY}${EACH_PAINT}
var names = ${json(names)}, keep = __swatch(doc, names[0]), others = [], spots = {}, keys = {};
var colourKinds = { process: true, global: true, spot: true, tint: true };
if (!colourKinds[__kind(keep)]) throw new Error(names[0] + " is not a colour swatch");
for (var i = 1; i < names.length; i++) {
  var sw = __swatch(doc, names[i]), kind = __kind(sw);
  if (!colourKinds[kind]) throw new Error(names[i] + " is not a colour swatch");
  if (kind === "global" || kind === "spot") {
    if (keep.color.typename === "SpotColor" && keep.color.spot.name === sw.color.spot.name) throw new Error(names[i] + " is the colour of " + names[0]);
    spots[sw.color.spot.name] = true;
  } else keys[__colorKey(sw.color)] = true;
  others.push(sw);
}
var keepBase = __kind(keep) === "global" || __kind(keep) === "spot";
function swap(c) {
  var tint = 100, hit = false;
  if (c.typename === "SpotColor" && spots.hasOwnProperty(c.spot.name)) { hit = true; tint = c.tint; }
  else { var k = __colorKey(c); if (k !== null && keys.hasOwnProperty(k)) hit = true; }
  if (!hit) return null;
  if (keepBase) { var n = new SpotColor(); n.spot = keep.color.spot; n.tint = tint; return n; }
  return keep.color;
}
var counts = { paths: 0, text: 0, gradientStops: 0, locked: 0 };
__eachPaint(doc, swap, counts, true);
var merged = [];
for (var j = 0; j < others.length; j++) { merged.push(others[j].name); others[j].remove(); }
__result__ = { kept: keep.name, merged: merged, repainted: counts };`));
        },
    },
    {
        name: 'find_unused_swatches',
        description: 'List the swatches no artwork uses, as Swatches panel > Select All Unused finds them (a script cannot select swatches in the panel; delete them with delete_swatches). Scans the fills and strokes of every path and text character and the gradients in use; a process swatch counts as used when an object has its exact colour values. Colours used only inside symbols, brushes, graphic styles or effects are not seen, so check the list before deleting',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.color.swatches_menu.select_all_unused'],
        hints: { readOnly: true, idempotent: true },
        handler: () => run('Find unused swatches', script(`${GET_SWATCH}${COLOR_KEY}${EACH_PAINT}
var keys = {}, spots = {}, grads = {}, pats = {};
function mark(c) {
  switch (c.typename) {
    case "SpotColor": spots[c.spot.name] = true; break;
    case "PatternColor": pats[c.pattern.name] = true; break;
    case "GradientColor":
      if (grads.hasOwnProperty(c.gradient.name)) return null;
      grads[c.gradient.name] = true;
      var st = c.gradient.gradientStops;
      for (var i = 0; i < st.length; i++) mark(st[i].color);
      return null;
  }
  var k = __colorKey(c);
  if (k !== null) keys[k] = true;
  return null;
}
var counts = { paths: 0, text: 0, gradientStops: 0, locked: 0 };
__eachPaint(doc, mark, counts, false);
for (var g = 0; g < doc.gradients.length; g++) {
  var gs = doc.gradients[g].gradientStops;
  for (var s = 0; s < gs.length; s++) if (gs[s].color.typename === "SpotColor") spots[gs[s].color.spot.name] = true;
}
var unused = [];
for (var w = 0; w < doc.swatches.length; w++) {
  var sw = doc.swatches[w], kind = __kind(sw), c = sw.color, used = true;
  if (kind === "none" || kind === "registration") continue;
  if (kind === "global" || kind === "spot") used = spots.hasOwnProperty(c.spot.name);
  else if (kind === "gradient") used = grads.hasOwnProperty(c.gradient.name);
  else if (kind === "pattern") used = pats.hasOwnProperty(c.pattern.name);
  else used = keys.hasOwnProperty(__colorKey(c));
  if (!used) unused.push({ name: sw.name, kind: kind });
}
__result__ = { unused: unused, scanned: { paths: doc.pathItems.length, textFrames: doc.textFrames.length } };`)),
    },
    {
        name: 'add_current_color',
        description: 'Add the current colour as a swatch (Color panel > Create New Swatch): the fill or stroke of the first selected object, or the default fill or stroke when nothing is selected. Named after its values the way Illustrator names them unless a name is given',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', enum: ['fill', 'stroke'], description: 'Default fill' },
                name: { type: 'string' },
                type: { type: 'string', enum: ['process', 'global', 'spot'], description: 'Default process' },
            },
        },
        features: ['illustrator.color.color_create_swatch'],
        handler: (a) => {
            const source = enumOf(a.source ?? 'fill', ['fill', 'stroke'], { name: 'source' });
            const type = enumOf(a.type ?? 'process', ['process', 'global', 'spot'], { name: 'type' });
            const prop = source === 'fill' ? 'fillColor' : 'strokeColor';
            const dflt = source === 'fill' ? 'defaultFillColor' : 'defaultStrokeColor';
            return run('Add current colour', script(`${COLOR_NAME}
var sel = doc.selection, c = null;
if (sel instanceof Array && sel.length) {
  var it = sel[0];
  if (it.typename === "TextFrame") c = it.textRange.characterAttributes.${prop};
  else if (it.typename === "PathItem") c = it.${prop};
  else if (it.typename === "CompoundPathItem" && it.pathItems.length) c = it.pathItems[0].${prop};
}
if (!c) c = doc.${dflt};
if (c.typename === "SpotColor") throw new Error("The current colour is already the swatch " + c.spot.name);
var plain = { RGBColor: true, CMYKColor: true, GrayColor: true, LabColor: true };
if (!plain.hasOwnProperty(c.typename)) throw new Error("The current ${source} is " + c.typename + ", not a colour that can become a swatch");
var nm = ${a.name !== undefined ? str(a.name) : '__colorName(c)'} || "Lab colour";
var clash = null;
try { clash = doc.swatches.getByName(nm); } catch (e) { clash = null; }
if (clash) throw new Error("A swatch named " + nm + " already exists");
${type === 'process' ? `var sw = doc.swatches.add(); sw.name = nm; sw.color = c;` : `var sp = doc.spots.add(); sp.name = nm; sp.color = c; sp.colorType = ColorModel.${type === 'spot' ? 'SPOT' : 'PROCESS'};
var sw = doc.swatches.getByName(nm);`}
__result__ = { name: sw.name, kind: ${str(type)}, color: __colorInfo(c) };`));
        },
    },
    {
        name: 'edit_swatch_group',
        description: 'Change a colour group (swatch group): rename it, move swatches into it, delete some of its swatches, or delete the group with its swatches, as the Swatches panel and Recolor Artwork\'s colour groups do',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The swatch group' },
                newName: { type: 'string' },
                add: { type: 'array', items: { type: 'string' }, description: 'Swatches to move into the group' },
                delete: { type: 'array', items: { type: 'string' }, description: 'Swatches in the group to delete from the document' },
                deleteGroup: { type: 'boolean', description: 'Delete the group and every swatch in it. Default false', default: false },
            },
            required: ['name'],
        },
        features: [
            'illustrator.color.recolor_add_remove',
            'illustrator.color.recolor_delete_groups',
        ],
        hints: { destructive: true },
        auditArgs: { name: 'Brand', newName: 'Brand 2024', add: ['Sky'], delete: ['Old Blue'], deleteGroup: false },
        handler: (a) => {
            const add = (a.add ?? []).map(String);
            const del = (a.delete ?? []).map(String);
            if (a.deleteGroup && (add.length || del.length || a.newName !== undefined)) throw new Error('deleteGroup removes the whole group: give it alone');
            if (!a.deleteGroup && !add.length && !del.length && a.newName === undefined) throw new Error('Give newName, add, delete or deleteGroup: true');
            return run('Edit swatch group', script(`${GROUP}${GET_SWATCH}
var grp = __swatchGroup(doc, ${str(a.name)}, false), members = grp.getAllSwatches(), inGroup = {};
for (var m = 0; m < members.length; m++) inGroup[members[m].name] = members[m];
${a.deleteGroup ? `var removed = [];
for (var r = members.length - 1; r >= 0; r--) { removed.push(members[r].name); members[r].remove(); }
grp.remove();
__result__ = { deletedGroup: ${str(a.name)}, deletedSwatches: removed };` : `
var dels = ${json(del)}, adds = ${json(add)};
for (var d = 0; d < dels.length; d++) if (!inGroup.hasOwnProperty(dels[d])) throw new Error("Swatch " + dels[d] + " is not in group " + ${str(a.name)});
for (var x = 0; x < adds.length; x++) __swatch(doc, adds[x]);
${a.newName !== undefined ? `for (var g = 0; g < doc.swatchGroups.length; g++) if (doc.swatchGroups[g].name === ${str(a.newName)} && ${str(a.newName)} !== ${str(a.name)}) throw new Error("A swatch group named " + ${str(a.newName)} + " already exists");` : ''}
for (var e = 0; e < dels.length; e++) inGroup[dels[e]].remove();
for (var y = 0; y < adds.length; y++) __addToGroup(doc, grp, doc.swatches.getByName(adds[y]));
${a.newName !== undefined ? `grp.name = ${str(a.newName)};` : ''}
var now = grp.getAllSwatches(), list = [];
for (var n = 0; n < now.length; n++) list.push(now[n].name);
__result__ = { group: grp.name, swatches: list, deleted: dels };`}`));
        },
    },

    // Swatch libraries
    {
        name: 'open_swatch_library',
        description: 'Open a built-in swatch library panel (Window > Swatch Libraries), e.g. "Gradients > Water", "Color Books > PANTONE+ Solid Coated". The panel only shows the library; load_swatch_library copies its swatches into the document',
        inputSchema: {
            type: 'object',
            properties: { library: { type: 'string', description: 'The library\'s Window > Swatch Libraries path, or its last part when that is unique' } },
            required: ['library'],
        },
        features: ['illustrator.color.swatches_menu.open_swatch_library'],
        menuCommands: SWATCH_LIBRARIES.map((l) => l.command),
        hints: { idempotent: true },
        auditArgs: { library: 'Gradients > Water' },
        handler: (a) => {
            const lib = swatchLibrary(a.library);
            return run('Open swatch library', script(`
app.executeMenuCommand(${str(lib.command)});
__result__ = { opened: ${str(lib.name)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'load_swatch_library',
        description: 'Copy swatches from a swatch library into the document, the way dragging them from a library panel does: a built-in library (Window > Swatch Libraries, e.g. "Gradients > Wood", including the gradient presets) or a library .ai file. Keeps the library\'s swatch groups. Colour books (.acb) and pattern swatches cannot be copied by script',
        inputSchema: {
            type: 'object',
            properties: {
                library: { type: 'string', description: 'A built-in library\'s Window > Swatch Libraries path, e.g. "Gradients > Water", or its last part when that is unique' },
                filePath: { type: 'string', description: 'Or an absolute path to a swatch library .ai file' },
                swatches: { type: 'array', items: { type: 'string' }, description: 'Only these swatches. Default all' },
                replace: { type: 'boolean', description: 'Overwrite document swatches with the same name. Default false (they are left as they are)', default: false },
            },
        },
        features: [
            'illustrator.color.move_from_library',
            'illustrator.color.gradient_presets',
        ],
        hints: { idempotent: true },
        auditArgs: { library: 'Gradients > Water', filePath: undefined, swatches: ['Water 1'], replace: false },
        handler: (a) => {
            const file = libraryFile(a);
            return run('Load swatch library', script(`${GROUP}${COPY}${LIBRARY_FILE}${OPEN_DOC}
var f = ${file.expr};
if (!f.exists) throw new Error("File not found: " + f.fsName);
if (__isFile(doc, f)) throw new Error("That library is the active document");
var lib = __openDoc(f), opened = false;
if (!lib) { lib = app.open(f); opened = true; }
var res;
try { res = __copyInto(doc, lib, ${a.swatches ? json(a.swatches.map(String)) : 'null'}, ${bool(a.replace)}); }
finally { if (opened) lib.close(SaveOptions.DONOTSAVECHANGES); doc.activate(); }
__result__ = { library: f.fsName, copied: res.copied, alreadyInDocument: res.existing, notCopied: res.skipped, notFound: res.notFound };`));
        },
    },
    {
        name: 'save_swatch_library',
        description: 'Save the document\'s swatches as a swatch library (Swatches panel > Save Swatch Library as AI): an Illustrator file holding just the swatches and their groups, which Window > Swatch Libraries > Other Library opens. Save it in Illustrator\'s user Swatches folder to see it under User Defined. With ifExists: "merge", adds the swatches to an existing library, replacing ones with the same name. Pattern swatches cannot be copied by script',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the .ai library file' },
                swatches: { type: 'array', items: { type: 'string' }, description: 'Only these swatches. Default all' },
                ifExists: { type: 'string', enum: ['error', 'replace', 'merge'], description: 'When the file exists: refuse (default), overwrite it, or add to the library in it' },
            },
            required: ['filePath'],
        },
        features: [
            'illustrator.color.swatches_menu.save_swatch_library_as_ai',
            'illustrator.color.swatch_libraries_create',
            'illustrator.color.swatch_libraries_edit',
        ],
        hints: { destructive: true },
        auditArgs: { filePath: `${process.env.HOME ?? '/tmp'}/Documents/Brand.ai`, swatches: ['Brand Blue'], ifExists: 'merge' },
        handler: (a) => {
            const file = libraryFile({ filePath: a.filePath });
            const mode = enumOf(a.ifExists ?? 'error', ['error', 'replace', 'merge'], { name: 'ifExists' });
            return run('Save swatch library', script(`${GROUP}${COPY}${OPEN_DOC}
var f = ${file.expr}, mode = ${str(mode)}, merging = f.exists && mode === "merge";
if (f.exists && mode === "error") throw new Error("File exists: " + f.fsName + ". Pass ifExists: replace or merge");
if (__isFile(doc, f)) throw new Error("That file is the active document");
var lib = merging ? __openDoc(f) : null, opened = false;
if (!lib) {
  if (merging) lib = app.open(f);
  else {
    lib = app.documents.add(doc.documentColorSpace);
    for (var g = lib.swatchGroups.length - 1; g > 0; g--) { try { lib.swatchGroups[g].remove(); } catch (e) {} }
    for (var s = lib.swatches.length - 1; s >= 0; s--) {
      var n = lib.swatches[s].name;
      if (n !== "[None]" && n !== "[Registration]") { try { lib.swatches[s].remove(); } catch (e) {} }
    }
  }
  opened = true;
}
var res;
try {
  res = __copyInto(lib, doc, ${a.swatches ? json(a.swatches.map(String)) : 'null'}, true);
  if (merging) lib.save(); else lib.saveAs(f, new IllustratorSaveOptions());
} finally { if (opened) lib.close(SaveOptions.DONOTSAVECHANGES); doc.activate(); }
__result__ = { file: f.fsName, merged: merging, saved: res.copied, notSaved: res.skipped, notFound: res.notFound };`));
        },
    },

    // Edit Colors dialogs and the Color panel, done by script
    {
        name: 'adjust_colors',
        description: 'Change colours by script, following Illustrator\'s colour commands: saturate (Edit > Edit Colors > Saturate: scales each ink, RGB colour amount or spot tint by a percentage), adjust_balance (Edit > Edit Colors > Adjust Color Balance: adds percentages to the CMYK, RGB, gray or global-tint values of colours already in that mode; convert first with edit_colors), complement (Color panel > Complement: the sum of the highest and lowest component minus each component), web_safe (each RGB value to the nearest web-safe step) or printable (RGB brought into the CMYK gamut, like clicking the Color panel\'s out-of-gamut warning). Works on the fills and strokes of targets (paths, groups, compound paths, text), or on the swatches in a colour group (recolouring global and spot colours updates the artwork, as Recolor Artwork does for a colour group). Gradient stops change only with gradients: true, and then everywhere the gradient is used',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ADJUSTMENTS },
                target: { ...TARGET_SCHEMA, description: 'Items whose colours change' },
                swatchGroup: { type: 'string', description: 'Or a swatch group whose swatches change' },
                amount: { ...PERCENT, description: 'saturate: percent, -100 to 100' },
                mode: { type: 'string', enum: BALANCE_MODES, description: 'adjust_balance: which colours to adjust; global adjusts the tint of global and spot colours' },
                cyan: PERCENT, magenta: PERCENT, yellow: PERCENT, black: { ...PERCENT, description: 'cmyk or gray mode' },
                red: PERCENT, green: PERCENT, blue: PERCENT,
                tint: { ...PERCENT, description: 'global mode' },
                fill: { type: 'boolean', description: 'Change fills. Default true', default: true },
                stroke: { type: 'boolean', description: 'Change strokes. Default true', default: true },
                gradients: { type: 'boolean', description: 'Also change the stops of gradients the targets use. Default false', default: false },
            },
            required: ['operation'],
        },
        features: [
            'illustrator.color.saturate',
            'illustrator.color.adjust_color_balance',
            'illustrator.color.color_complement',
            'illustrator.color.web_safe_colors',
            'illustrator.color.recolor_change_group',
        ],
        hints: { destructive: true },
        auditArgs: { operation: 'adjust_balance', target: { selection: true }, swatchGroup: undefined, amount: undefined, mode: 'cmyk', cyan: 10, black: -5, red: undefined, green: undefined, blue: undefined, tint: undefined, gradients: true },
        handler: (a) => {
            if (!a.target === !a.swatchGroup) throw new Error("Give target (items) or swatchGroup, not both");
            const fn = adjustFunction(a);
            if (a.operation !== 'saturate' && a.amount !== undefined) throw new Error("'amount' applies to saturate");
            if (a.operation !== 'adjust_balance' && a.mode !== undefined) throw new Error("'mode' applies to adjust_balance");
            if (a.swatchGroup) return run('Adjust colours', script(`${GROUP}${fn}
var grp = __swatchGroup(doc, ${str(a.swatchGroup)}, false), members = grp.getAllSwatches(), changed = [], unchanged = [];
for (var i = 0; i < members.length; i++) {
  var sw = members[i], c = sw.color, r = null;
  if (c.typename === "SpotColor" && sw.name === c.spot.name) { r = __adjust(c.spot.color); if (r) c.spot.color = r; }
  else if (c.typename === "GradientColor") {
    var st = c.gradient.gradientStops;
    for (var s = 0; s < st.length; s++) { var rs = __adjust(st[s].color); if (rs) { st[s].color = rs; r = rs; } }
  } else { r = __adjust(c); if (r) sw.color = r; }
  (r ? changed : unchanged).push(sw.name);
}
__result__ = { operation: ${str(a.operation)}, group: grp.name, changed: changed, unchanged: unchanged };`));
            const fill = a.fill ?? true;
            const stroke = a.stroke ?? true;
            if (!fill && !stroke) throw new Error('Give fill, stroke or both');
            return run('Adjust colours', script(`${EACH_PATH}${fn}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, changed: 0, unchanged: 0, gradients: 0, textCharacters: 0, skipped: [] }, done = {};
function recolor(c) {
  if (c.typename === "GradientColor") {
    if (${bool(a.gradients)} && !done.hasOwnProperty(c.gradient.name)) {
      done[c.gradient.name] = true; counts.gradients++;
      var st = c.gradient.gradientStops;
      for (var s = 0; s < st.length; s++) { var rs = __adjust(st[s].color); if (rs) { st[s].color = rs; counts.changed++; } }
    }
    return null;
  }
  var r = __adjust(c);
  if (r) counts.changed++; else counts.unchanged++;
  return r;
}
function paint(p) {
  var r;
  ${fill ? 'if (p.filled) { r = recolor(p.fillColor); if (r) p.fillColor = r; }' : ''}
  ${stroke ? 'if (p.stroked) { r = recolor(p.strokeColor); if (r) p.strokeColor = r; }' : ''}
}
for (var i = 0; i < items.length; i++) {
  if (items[i].typename !== "TextFrame") { __eachPath(items[i], paint, counts); continue; }
  var chars = items[i].textRange.characters;
  for (var k = 0; k < chars.length; k++) {
    var ca = chars[k].characterAttributes, r;
    ${fill ? 'r = recolor(ca.fillColor); if (r) ca.fillColor = r;' : ''}
    ${stroke ? 'r = recolor(ca.strokeColor); if (r) ca.strokeColor = r;' : ''}
    counts.textCharacters++;
  }
}
__result__ = { operation: ${str(a.operation)}, paths: counts.paths, textCharacters: counts.textCharacters, coloursChanged: counts.changed, coloursUnchanged: counts.unchanged, gradientsChanged: counts.gradients, skipped: counts.skipped };`));
        },
    },
    {
        name: 'overprint_black',
        description: 'Set or clear overprint on black, as Edit > Edit Colors > Overprint Black does, by script: fills and strokes whose black is at least the given percentage. By default only pure black (no cyan, magenta or yellow) and gray qualify; includeCmyBlacks adds rich blacks and includeSpotBlacks adds spot colours whose CMYK equivalent holds that much black. Overprint matters in separated CMYK output',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                remove: { type: 'boolean', description: 'Clear overprint instead of setting it. Default false', default: false },
                percentage: { type: 'number', minimum: 0, maximum: 100, description: 'Minimum black percentage. Default 100' },
                fill: { type: 'boolean', description: 'Default true', default: true },
                stroke: { type: 'boolean', description: 'Default true', default: true },
                includeCmyBlacks: { type: 'boolean', description: 'Include blacks that also contain cyan, magenta or yellow. Default false', default: false },
                includeSpotBlacks: { type: 'boolean', description: 'Include spot colours. Default false', default: false },
            },
            required: ['target'],
        },
        features: ['illustrator.color.overprint_black'],
        hints: { idempotent: true },
        auditArgs: { target: { selection: true }, percentage: 95, includeCmyBlacks: true, includeSpotBlacks: true },
        handler: (a) => {
            const fill = a.fill ?? true;
            const stroke = a.stroke ?? true;
            if (!fill && !stroke) throw new Error('Give fill, stroke or both');
            const pct = num(a.percentage ?? 100, { min: 0, max: 100, name: 'percentage' });
            const on = bool(!a.remove);
            return run('Overprint black', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, changed: 0, textCharacters: 0, skipped: [] };
function black(c) {
  if (c.typename === "GrayColor") return c.gray >= ${pct};
  if (c.typename === "CMYKColor") return c.black >= ${pct} && (${bool(a.includeCmyBlacks)} || (c.cyan === 0 && c.magenta === 0 && c.yellow === 0));
  if (${bool(a.includeSpotBlacks)} && c.typename === "SpotColor") {
    var v = c.spot.color;
    if (v.typename === "CMYKColor") return v.black * c.tint / 100 >= ${pct};
    if (v.typename === "GrayColor") return v.gray * c.tint / 100 >= ${pct};
  }
  return false;
}
function paint(p) {
  ${fill ? `if (p.filled && black(p.fillColor)) { p.fillOverprint = ${on}; counts.changed++; }` : ''}
  ${stroke ? `if (p.stroked && black(p.strokeColor)) { p.strokeOverprint = ${on}; counts.changed++; }` : ''}
}
for (var i = 0; i < items.length; i++) {
  if (items[i].typename !== "TextFrame") { __eachPath(items[i], paint, counts); continue; }
  var chars = items[i].textRange.characters;
  for (var k = 0; k < chars.length; k++) {
    var ca = chars[k].characterAttributes;
    ${fill ? `if (black(ca.fillColor)) { ca.overprintFill = ${on}; counts.changed++; }` : ''}
    ${stroke ? `if (black(ca.strokeColor)) { ca.overprintStroke = ${on}; counts.changed++; }` : ''}
    counts.textCharacters++;
  }
}
__result__ = { overprint: ${on}, percentage: ${pct}, changed: counts.changed, paths: counts.paths, textCharacters: counts.textCharacters, skipped: counts.skipped };`));
        },
    },

    // Gradients on objects
    {
        name: 'apply_gradient',
        description: 'Fill (or stroke) items with a gradient swatch and place it the way the Gradient tool does: on each object, or with across: true as one gradient spanning all of them (one gradient across several objects). Give an angle, or from and to points to place it exactly like dragging the Gradient tool (for a radial gradient, from is the centre and to a point on its edge). The gradient can be a document swatch or come from a built-in gradient library (Window > Swatch Libraries > Gradients, the gradient presets), which is loaded first',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                gradient: { type: 'string', description: 'Gradient swatch name' },
                library: { type: 'string', description: 'Built-in library to load the gradient from when the document lacks it, e.g. "Gradients > Water"' },
                stroke: { type: 'boolean', description: 'Apply to strokes instead of fills. Default false', default: false },
                across: { type: 'boolean', description: 'One gradient spanning the combined bounds of all the targets. Default false (each object gets its own)', default: false },
                angle: { type: 'number', minimum: -360, maximum: 360, description: 'Degrees, counter-clockwise; 0 runs left to right. Default 0' },
                from: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], description: 'Start point, artboard points from the top-left' },
                to: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], description: 'End point' },
                artboardIndex: ARTBOARD_SCHEMA,
            },
            required: ['target', 'gradient'],
        },
        features: [
            'illustrator.color.gradient_tool',
            'illustrator.color.predefined_gradient',
            'illustrator.color.gradient_across_objects',
            'illustrator.color.gradient_presets',
        ],
        hints: { idempotent: true },
        auditArgs: { target: { selection: true }, gradient: 'Water 1', library: 'Gradients > Water', across: true, angle: 45, from: undefined, to: undefined },
        handler: (a) => {
            if (!a.from !== !a.to) throw new Error("Give both 'from' and 'to', or neither");
            if (a.from && a.angle !== undefined) throw new Error("Give 'angle' or 'from' and 'to', not both");
            if (a.from && a.across) throw new Error("'from' and 'to' already place one gradient for every target; leave out 'across'");
            const file = libraryFile({ library: a.library }, { optional: true });
            const angle = num(a.angle ?? 0, { min: -360, max: 360, name: 'angle' });
            const ab = a.artboardIndex ?? 0;
            const xy = (p, n) => `__toDoc(doc, ab, ${num(p.x, { name: `${n}.x` })}, ${num(p.y, { name: `${n}.y` })})`;
            const prop = a.stroke ? 'strokeColor' : 'fillColor';
            const flag = a.stroke ? 'stroked' : 'filled';
            return run('Apply gradient', script(`${file ? `${GROUP}${COPY}${LIBRARY_FILE}${OPEN_DOC}` : ''}
var g = null, loaded = false;
try { g = doc.gradients.getByName(${str(a.gradient)}); } catch (e) { g = null; }
${file ? `if (!g) {
  var f = ${file.expr};
  if (__isFile(doc, f)) throw new Error("That library is the active document");
  var lib = __openDoc(f), opened = false;
  if (!lib) { lib = app.open(f); opened = true; }
  var res;
  try { res = __copyInto(doc, lib, [${str(a.gradient)}], false); }
  finally { if (opened) lib.close(SaveOptions.DONOTSAVECHANGES); doc.activate(); }
  if (res.notFound.length) throw new Error("Library " + ${str(file.label)} + " has no swatch named " + ${str(a.gradient)});
  g = doc.gradients.getByName(${str(a.gradient)});
  loaded = true;
}` : ''}
if (!g) throw new Error("Gradient " + ${str(a.gradient)} + " not found${file ? '' : '; give library to load it from a gradient library'}");
var items = __targets(doc, ${targetSpec(a.target)}), list = [], skipped = [];
function collect(it) {
  if (it.typename === "PathItem") list.push({ path: it, bounds: it.geometricBounds });
  else if (it.typename === "CompoundPathItem") { for (var c = 0; c < it.pathItems.length; c++) list.push({ path: it.pathItems[c], bounds: it.geometricBounds }); }
  else if (it.typename === "GroupItem") { for (var m = 0; m < it.pageItems.length; m++) collect(it.pageItems[m]); }
  else skipped.push(it.typename);
}
for (var i = 0; i < items.length; i++) collect(items[i]);
if (!list.length) throw new Error("No paths among the targets");
var radial = g.type === GradientType.RADIAL, ang = ${angle};
function place(b) {
  var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, w = b[2] - b[0], h = b[1] - b[3];
  if (radial) return { origin: [cx, cy], angle: ang, length: Math.max(w, h) / 2 };
  var r = ang * Math.PI / 180, len = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
  return { origin: [cx - len / 2 * Math.cos(r), cy - len / 2 * Math.sin(r)], angle: ang, length: len };
}
var fixed = null;
${a.from ? `var ab = __artboard(doc, ${num(ab, { min: 0, max: 1000, name: 'artboardIndex' })}), p0 = ${xy(a.from, 'from')}, p1 = ${xy(a.to, 'to')};
var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
if (dx === 0 && dy === 0) throw new Error("'from' and 'to' are the same point");
fixed = { origin: p0, angle: Math.atan2(dy, dx) * 180 / Math.PI, length: Math.sqrt(dx * dx + dy * dy) };` : ''}
${a.across ? `var u = list[0].bounds.slice(0);
for (var j = 1; j < list.length; j++) {
  var gb = list[j].bounds;
  u[0] = Math.min(u[0], gb[0]); u[1] = Math.max(u[1], gb[1]); u[2] = Math.max(u[2], gb[2]); u[3] = Math.min(u[3], gb[3]);
}
fixed = place(u);` : ''}
for (var k = 0; k < list.length; k++) {
  var pl = fixed || place(list[k].bounds), gc = new GradientColor();
  gc.gradient = g;
  gc.origin = pl.origin;
  gc.angle = pl.angle;
  gc.length = pl.length;
  list[k].path.${flag} = true;
  list[k].path.${prop} = gc;
}
__result__ = { gradient: g.name, type: radial ? "radial" : "linear", loadedFromLibrary: loaded, paths: list.length, across: ${bool(a.across || a.from)}, skipped: skipped };`));
        },
    },

    // Colour settings and proofing
    {
        name: 'get_color_settings',
        description: 'List the colour settings files Illustrator offers (Edit > Color Settings), the default for this locale, and the active document\'s colour mode and assigned profile (Edit > Assign Profile shows it)',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.color.color_settings'],
        hints: { readOnly: true, idempotent: true },
        handler: () => run('Get colour settings', script(`
var files = app.colorSettingsList, list = [], dflt = null, d = null;
for (var i = 0; i < files.length; i++) list.push({ name: decodeURI(files[i].name).replace(/\\.csf$/i, ""), file: files[i].fsName });
try { dflt = app.defaultColorSettings.fsName; } catch (e) { dflt = null; }
if (app.documents.length) {
  var ad = app.activeDocument;
  d = { name: ad.name, colorMode: String(ad.documentColorSpace).replace("DocumentColorSpace.", ""), profile: ad.colorProfileName };
}
__result__ = { settings: list, defaultSettings: dflt, document: d };`, { needsDocument: false })),
    },
    {
        name: 'load_color_settings',
        description: 'Apply a colour settings file (Edit > Color Settings > Settings): a name from get_color_settings, such as "North America General Purpose 2", or an absolute path to a .csf file. This changes Illustrator\'s colour management for every document',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'A settings name from get_color_settings' },
                filePath: { type: 'string', description: 'Or an absolute path to a .csf file' },
            },
        },
        features: ['illustrator.color.color_settings'],
        hints: { idempotent: true },
        auditArgs: { name: 'North America General Purpose 2', filePath: undefined },
        handler: (a) => {
            if (!a.name === !a.filePath) throw new Error("Give 'name' or 'filePath'");
            const find = a.filePath ? (() => {
                const p = paths.validate(a.filePath);
                if (!/\.csf$/i.test(p)) throw new Error("'filePath' must be a colour settings (.csf) file");
                return `var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);`;
            })() : `var want = ${str(String(a.name).toLowerCase())}, files = app.colorSettingsList, f = null, names = [];
for (var i = 0; i < files.length; i++) {
  var n = decodeURI(files[i].name).replace(/\\.csf$/i, "");
  names.push(n);
  if (n.toLowerCase() === want) f = files[i];
}
if (!f) throw new Error("No colour settings named " + ${str(a.name)} + ". Available: " + names.join(", "));`;
            return run('Load colour settings', script(`${find}
app.loadColorSettings(f);
__result__ = { loaded: f.fsName };`, { needsDocument: false }));
        },
    },
    {
        name: 'set_color_view',
        description: 'Colour display in the document window: choose the soft-proof condition (View > Proof Setup: working CMYK, legacy Mac RGB, sRGB, monitor RGB, or the protanopia and deuteranopia colour-blindness simulations), toggle View > Proof Colors, and toggle View > Show/Hide Gradient Annotator. Illustrator does not report whether a toggle is on, so each toggle flips the current state',
        inputSchema: {
            type: 'object',
            properties: {
                proofSetup: { type: 'string', enum: Object.keys(PROOF_SETUPS) },
                toggleProofColors: { type: 'boolean', description: 'Turn soft-proofing on or off. Default false', default: false },
                toggleGradientAnnotator: { type: 'boolean', description: 'Show or hide the gradient annotator. Default false', default: false },
            },
        },
        features: [
            'illustrator.color.proof_working_cmyk',
            'illustrator.color.proof_mac_rgb',
            'illustrator.color.proof_srgb',
            'illustrator.color.proof_monitor_rgb',
            'illustrator.color.proof_protanopia',
            'illustrator.color.proof_deuteranopia',
            'illustrator.color.proof_colors',
            'illustrator.color.color_blindness_proof',
            'illustrator.color.gradient_annotator',
        ],
        menuCommands: [...Object.values(PROOF_SETUPS), 'proofColors', 'Gradient Feedback'],
        handler: (a) => {
            const commands = [];
            if (a.proofSetup !== undefined) commands.push(PROOF_SETUPS[enumOf(a.proofSetup, Object.keys(PROOF_SETUPS), { name: 'proofSetup' })]);
            if (a.toggleProofColors) commands.push('proofColors');
            if (a.toggleGradientAnnotator) commands.push('Gradient Feedback');
            if (!commands.length) throw new Error('Give proofSetup, toggleProofColors: true or toggleGradientAnnotator: true');
            return run('Set colour view', script(`
${commands.map((c) => `app.executeMenuCommand(${str(c)});`).join('\n')}
__result__ = { ran: ${json(commands)}${a.proofSetup ? `, proofSetup: ${str(a.proofSetup)}` : ''} };`));
        },
    },
];
