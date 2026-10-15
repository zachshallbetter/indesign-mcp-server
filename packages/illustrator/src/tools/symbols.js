/**
 * Symbols: create symbols from artwork, place, replace and select instances,
 * break links, rename, duplicate and delete symbols, and open or save symbol
 * libraries.
 *
 * Symbols live in Document.symbols and instances are SymbolItems. A symbol's
 * type (dynamic or static) and 9-slice guides have no object-model member, so
 * symbols are made with Illustrator's default type. The built-in libraries
 * open as panels through their Window > Symbol Libraries commands; a library
 * file is opened with OpenOptions.openAs = LibraryType.SYMBOLS.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

export const REGISTRATION = {
    center: 'SYMBOLCENTERPOINT',
    topLeft: 'SYMBOLTOPLEFTPOINT',
    top: 'SYMBOLTOPMIDDLEPOINT',
    topRight: 'SYMBOLTOPRIGHTPOINT',
    left: 'SYMBOLMIDDLELEFTPOINT',
    right: 'SYMBOLMIDDLERIGHTPOINT',
    bottomLeft: 'SYMBOLBOTTOMLEFTPOINT',
    bottom: 'SYMBOLBOTTOMMIDDLEPOINT',
    bottomRight: 'SYMBOLBOTTOMRIGHTPOINT',
};

const COMMANDS = JSON.parse(readFileSync(new URL('../data/menu-commands.json', import.meta.url), 'utf8')).commands;

/** Built-in symbol libraries (Window > Symbol Libraries): key -> { name, command }. */
export const LIBRARIES = Object.fromEntries(COMMANDS
    .filter((c) => c.menu[1] === 'Symbol Libraries' && c.id.startsWith('_Base Library Menu Item '))
    .map((c) => [c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), { name: c.name, command: c.id }]));

/** ES3 helpers: a symbol by name; every instance of a symbol; the instances among items. */
const SYMBOLS = `
function __symbol(doc, name) {
  var s = null;
  try { s = doc.symbols.getByName(name); } catch (e) { s = null; }
  if (!s) throw new Error("Symbol " + name + " not found");
  return s;
}
function __hasSymbol(doc, name) {
  try { return !!doc.symbols.getByName(name); } catch (e) { return false; }
}
function __instancesOf(doc, name) {
  var out = [];
  for (var i = 0; i < doc.symbolItems.length; i++) if (doc.symbolItems[i].symbol.name === name) out.push(doc.symbolItems[i]);
  return out;
}
function __symbolItems(items) {
  for (var i = 0; i < items.length; i++) if (items[i].typename !== "SymbolItem") throw new Error("Item " + (items[i].name || i) + " is a " + items[i].typename + ", not a symbol instance");
  return items;
}
function __instanceInfo(doc, it) {
  var info = __itemInfo(doc, it);
  info.symbol = it.symbol.name;
  return info;
}`;

/** A symbol name argument. */
function symbolName(value, name = 'symbol') {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' must be a symbol name (list_symbols)`);
    if (value.length > 200) throw new Error(`'${name}' is too long`);
    return value;
}

/** A list of symbol names. */
function symbolNames(value, name = 'symbols') {
    if (!Array.isArray(value) || !value.length) throw new Error(`'${name}' must list at least one symbol name`);
    return value.map((v, i) => symbolName(v, `${name}[${i}]`));
}

export const tools = [
    {
        name: 'list_symbols',
        description: 'List the document\'s symbols (Symbols panel) with how many instances each has; unused symbols are marked (Symbols panel > Select All Unused)',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.symbols.symbol_object', 'illustrator.symbols.symbols_panel', 'illustrator.symbols.symbols_menu.select_all_unused'],
        hints: { readOnly: true, idempotent: true },
        handler: () => run('List symbols', script(`
var counts = {}, out = [], unused = [];
for (var i = 0; i < doc.symbolItems.length; i++) {
  var n = doc.symbolItems[i].symbol.name;
  counts[n] = (counts[n] || 0) + 1;
}
for (var j = 0; j < doc.symbols.length; j++) {
  var s = doc.symbols[j], c = counts.hasOwnProperty(s.name) ? counts[s.name] : 0;
  out.push({ name: s.name, instances: c, unused: c === 0 });
  if (!c) unused.push(s.name);
}
__result__ = { symbols: out, unused: unused, instances: doc.symbolItems.length };`)),
    },
    {
        name: 'create_symbol',
        description: 'Make a symbol from artwork (Symbols panel > New Symbol) with a registration point. By default the artwork is replaced by an instance of the new symbol, as the panel does. Several items become one symbol, or one symbol each with each: true',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                name: { type: 'string', description: 'Symbol name. With each: true, items are numbered after it ("Leaf 1", "Leaf 2"). Default: Illustrator names it' },
                registration: { type: 'string', enum: Object.keys(REGISTRATION), description: 'Registration point on the symbol\'s bounding box. Default center' },
                each: { type: 'boolean', description: 'One symbol per item instead of one for all. Default false', default: false },
                replace: { type: 'boolean', description: 'Replace the artwork with an instance of the symbol. Default true', default: true },
            },
            required: ['target'],
        },
        features: [
            'illustrator.symbols.new_symbol',
            'illustrator.symbols.symbol_object',
            'illustrator.symbols.symbol_registration',
            'illustrator.symbols.symbol_instance',
        ],
        handler: (a) => {
            const reg = REGISTRATION[enumOf(a.registration ?? 'center', Object.keys(REGISTRATION), { name: 'registration' })];
            const name = a.name === undefined ? null : symbolName(a.name, 'name');
            return run('Create symbol', script(`${SYMBOLS}
var items = __targets(doc, ${targetSpec(a.target)}), each = ${bool(a.each)}, replace = ${bool(a.replace ?? true)};
var base = ${name === null ? 'null' : str(name)}, made = [], placed = [];
var groups = each ? [] : [items];
if (each) for (var i = 0; i < items.length; i++) groups.push([items[i]]);
var names = [];
for (var g = 0; g < groups.length; g++) {
  var nm = base === null ? null : (each && groups.length > 1 ? base + " " + (g + 1) : base);
  if (nm !== null && __hasSymbol(doc, nm)) throw new Error("A symbol named " + nm + " already exists");
  names.push(nm);
}
for (var k = 0; k < groups.length; k++) {
  var set = groups[k], src;
  if (set.length === 1) src = set[0].duplicate();
  else {
    src = set[0].layer.groupItems.add();
    for (var m = set.length - 1; m >= 0; m--) set[m].duplicate(src, ElementPlacement.PLACEATBEGINNING);
  }
  var sym = doc.symbols.add(src, SymbolRegistrationPoint.${reg});
  try { src.remove(); } catch (e) {}
  if (names[k] !== null) sym.name = names[k];
  made.push(sym.name);
  if (replace) {
    var left = Infinity, top = -Infinity;
    for (var b = 0; b < set.length; b++) {
      var gb = set[b].geometricBounds;
      if (gb[0] < left) left = gb[0];
      if (gb[1] > top) top = gb[1];
    }
    var inst = doc.symbolItems.add(sym);
    inst.move(set[0], ElementPlacement.PLACEBEFORE);
    var ib = inst.geometricBounds;
    inst.translate(left - ib[0], top - ib[1]);
    for (var r = 0; r < set.length; r++) set[r].remove();
    placed.push(__instanceInfo(doc, inst));
  }
}
__result__ = { symbols: made, instances: placed };`));
        },
    },
    {
        name: 'place_symbol',
        description: 'Place instances of a symbol (Symbols panel > Place Symbol Instance). x and y are the instance\'s top-left corner; without them it goes in the centre of the artboard',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: 'Symbol name (list_symbols)' },
                x: { type: 'number' }, y: { type: 'number' },
                artboardIndex: ARTBOARD_SCHEMA,
                layer: { type: 'string', description: 'Layer to place on. Default the active layer' },
                count: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of instances, all at the same spot. Default 1' },
            },
            required: ['symbol'],
        },
        features: ['illustrator.symbols.symbol_panel_control.place_symbol_instance', 'illustrator.symbols.symbol_instance'],
        handler: (a) => {
            if ((a.x === undefined) !== (a.y === undefined)) throw new Error('Give both x and y, or neither');
            const at = a.x === undefined ? null : [num(a.x, { name: 'x' }), num(a.y, { name: 'y' })];
            return run('Place symbol', script(`${SYMBOLS}
var sym = __symbol(doc, ${str(symbolName(a.symbol))});
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })}), lay = __layer(doc, ${str(a.layer ?? '')}), out = [];
for (var i = 0; i < ${index(a.count ?? 1, { name: 'count', max: 1000 })}; i++) {
  var inst = lay.symbolItems.add(sym), b = inst.geometricBounds, p;
  ${at ? `p = __toDoc(doc, ab, ${at[0]}, ${at[1]});` : 'p = [(ab.left + ab.right) / 2 - (b[2] - b[0]) / 2, (ab.top + ab.bottom) / 2 + (b[1] - b[3]) / 2];'}
  inst.translate(p[0] - b[0], p[1] - b[1]);
  out.push(__instanceInfo(doc, inst));
}
__result__ = { instances: out };`));
        },
    },
    {
        name: 'replace_symbol',
        description: 'Make symbol instances use another symbol (Symbols panel > Replace Symbol)',
        inputSchema: {
            type: 'object',
            properties: { target: { ...TARGET_SCHEMA, description: 'Symbol instances' }, symbol: { type: 'string', description: 'The symbol they should use' } },
            required: ['target', 'symbol'],
        },
        features: ['illustrator.symbols.symbols_menu.replace_symbol'],
        hints: { idempotent: true },
        handler: (a) => run('Replace symbol', script(`${SYMBOLS}
var sym = __symbol(doc, ${str(symbolName(a.symbol))});
var items = __symbolItems(__targets(doc, ${targetSpec(a.target)})), out = [];
for (var i = 0; i < items.length; i++) { items[i].symbol = sym; out.push(__instanceInfo(doc, items[i])); }
__result__ = { instances: out };`)),
    },
    {
        name: 'break_symbol_link',
        description: 'Turn symbol instances into ordinary artwork (Symbols panel > Break Link to Symbol). The symbol stays in the document',
        inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA, description: 'Symbol instances' } }, required: ['target'] },
        features: ['illustrator.symbols.symbol_panel_control.break_link_to_symbol'],
        hints: { destructive: true },
        handler: (a) => run('Break link to symbol', script(`${SYMBOLS}
var items = __symbolItems(__targets(doc, ${targetSpec(a.target)})), names = [];
doc.selection = null;
for (var i = 0; i < items.length; i++) { names.push(items[i].symbol.name); items[i].selected = true; }
for (var j = 0; j < items.length; j++) items[j].breakLink();
var sel = doc.selection, out = [];
if (sel && sel.length) for (var k = 0; k < sel.length; k++) out.push(__itemInfo(doc, sel[k]));
__result__ = { broken: items.length, symbols: names, items: out };`)),
    },
    {
        name: 'rename_symbol',
        description: 'Rename a symbol (Symbols panel > Symbol Options: name). A symbol\'s type, registration point and 9-slice guides cannot be changed by script',
        inputSchema: {
            type: 'object',
            properties: { symbol: { type: 'string', description: 'Current name' }, newName: { type: 'string' } },
            required: ['symbol', 'newName'],
        },
        features: ['illustrator.symbols.symbol_panel_control.symbol_options'],
        hints: { idempotent: true },
        handler: (a) => {
            const from = symbolName(a.symbol);
            const to = symbolName(a.newName, 'newName');
            return run('Rename symbol', script(`${SYMBOLS}
var sym = __symbol(doc, ${str(from)});
if (${str(from)} !== ${str(to)} && __hasSymbol(doc, ${str(to)})) throw new Error("A symbol named " + ${str(to)} + " already exists");
sym.name = ${str(to)};
__result__ = { symbol: sym.name, previous: ${str(from)} };`));
        },
    },
    {
        name: 'duplicate_symbol',
        description: 'Copy a symbol under a new name (Symbols panel > Duplicate Symbol). The copy is registered at its centre',
        inputSchema: {
            type: 'object',
            properties: { symbol: { type: 'string' }, newName: { type: 'string', description: 'Default: Illustrator names it' } },
            required: ['symbol'],
        },
        features: ['illustrator.symbols.symbols_menu.duplicate_symbol'],
        handler: (a) => {
            const to = a.newName === undefined ? null : symbolName(a.newName, 'newName');
            return run('Duplicate symbol', script(`${SYMBOLS}
var sym = __symbol(doc, ${str(symbolName(a.symbol))});
${to === null ? '' : `if (__hasSymbol(doc, ${str(to)})) throw new Error("A symbol named " + ${str(to)} + " already exists");`}
var prevLayer = doc.activeLayer, work = doc.layers.add(), copy = null;
try {
  doc.activeLayer = work;
  var inst = work.symbolItems.add(sym);
  inst.breakLink();
  var art = work.groupItems.add(), i;
  for (i = work.pageItems.length - 1; i >= 0; i--) if (work.pageItems[i] !== art) work.pageItems[i].move(art, ElementPlacement.PLACEATBEGINNING);
  for (i = work.layers.length - 1; i >= 0; i--) {
    while (work.layers[i].pageItems.length) work.layers[i].pageItems[0].move(art, ElementPlacement.PLACEATEND);
  }
  copy = doc.symbols.add(art, SymbolRegistrationPoint.SYMBOLCENTERPOINT);
  ${to === null ? '' : `copy.name = ${str(to)};`}
} finally {
  work.remove();
  try { doc.activeLayer = prevLayer; } catch (e) {}
}
__result__ = { symbol: copy.name, from: sym.name };`));
        },
    },
    {
        name: 'delete_symbols',
        description: 'Delete symbols by name, or every unused symbol (Symbols panel > Select All Unused, then Delete Symbol). A symbol with instances is refused unless instances says to delete them or turn them into ordinary artwork (expand)',
        inputSchema: {
            type: 'object',
            properties: {
                symbols: { type: 'array', items: { type: 'string' }, description: 'Symbol names' },
                unused: { type: 'boolean', description: 'Delete every symbol with no instances' },
                instances: { type: 'string', enum: ['refuse', 'delete', 'expand'], description: 'What to do with instances of the symbols: refuse (default), delete them, or expand them (break their links)' },
            },
        },
        features: ['illustrator.symbols.symbol_panel_control.delete_symbol', 'illustrator.symbols.symbols_menu.select_all_unused'],
        hints: { destructive: true },
        auditArgs: { symbols: ['Leaf'], unused: undefined, instances: 'expand' },
        handler: (a) => {
            if (!a.unused === !a.symbols) throw new Error('Give symbols (names) or unused: true');
            const names = a.symbols ? symbolNames(a.symbols) : null;
            const mode = enumOf(a.instances ?? 'refuse', ['refuse', 'delete', 'expand'], { name: 'instances' });
            return run('Delete symbols', script(`${SYMBOLS}
var names = ${names ? json(names) : 'null'}, mode = ${str(mode)}, targets = [], deleted = [], removed = 0, expanded = 0;
if (names) for (var i = 0; i < names.length; i++) targets.push(__symbol(doc, names[i]));
else for (var j = 0; j < doc.symbols.length; j++) if (!__instancesOf(doc, doc.symbols[j].name).length) targets.push(doc.symbols[j]);
for (var k = 0; k < targets.length; k++) {
  var inst = __instancesOf(doc, targets[k].name);
  if (inst.length && mode === "refuse") throw new Error("Symbol " + targets[k].name + " has " + inst.length + " instance(s): give instances: \\"delete\\" or \\"expand\\"");
}
for (var m = 0; m < targets.length; m++) {
  var list = __instancesOf(doc, targets[m].name);
  for (var n = 0; n < list.length; n++) {
    if (mode === "delete") { list[n].remove(); removed++; } else { list[n].breakLink(); expanded++; }
  }
  deleted.push(targets[m].name);
  targets[m].remove();
}
__result__ = { deleted: deleted, instancesDeleted: removed, instancesExpanded: expanded, remaining: doc.symbols.length };`));
        },
    },
    {
        name: 'select_symbol_instances',
        description: 'Select every instance of the given symbols (Symbols panel > Select All Instances)',
        inputSchema: {
            type: 'object',
            properties: {
                symbols: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Symbol names' },
                add: { type: 'boolean', description: 'Add to the current selection instead of replacing it. Default false', default: false },
            },
            required: ['symbols'],
        },
        features: ['illustrator.symbols.symbols_menu.select_all_instances', 'illustrator.symbols.symbol_instance'],
        hints: { idempotent: true },
        handler: (a) => run('Select symbol instances', script(`${SYMBOLS}
var names = ${json(symbolNames(a.symbols))}, out = [];
for (var i = 0; i < names.length; i++) __symbol(doc, names[i]);
${a.add ? '' : 'doc.selection = null;'}
for (var j = 0; j < names.length; j++) {
  var list = __instancesOf(doc, names[j]);
  for (var k = 0; k < list.length; k++) {
    try { list[k].selected = true; out.push(__instanceInfo(doc, list[k])); } catch (e) {}
  }
}
__result__ = { selected: out.length, instances: out };`)),
    },
    {
        name: 'open_symbol_library',
        description: 'Open a symbol library as a panel: one of Illustrator\'s built-in libraries (Window > Symbol Libraries), or a library file such as one saved with save_symbol_library (Window > Symbol Libraries > Other Library). Drag or copy its symbols into the document from the panel',
        inputSchema: {
            type: 'object',
            properties: {
                library: { type: 'string', enum: Object.keys(LIBRARIES), description: 'A built-in library' },
                filePath: { type: 'string', description: 'Or an absolute path to a library (.ai) file' },
            },
        },
        features: [
            'illustrator.symbols.symbol_libraries',
            'illustrator.symbols.symbol_libraries_create',
            'illustrator.symbols.library.other_library',
            ...Object.keys(LIBRARIES).map((k) => `illustrator.symbols.library.${k}`),
        ],
        menuCommands: Object.values(LIBRARIES).map((l) => l.command),
        hints: { idempotent: true },
        auditArgs: { library: 'arrows', filePath: undefined },
        handler: (a) => {
            if ((a.library === undefined) === (a.filePath === undefined)) throw new Error('Give library (a built-in library) or filePath');
            if (a.library !== undefined) {
                const lib = LIBRARIES[enumOf(a.library, Object.keys(LIBRARIES), { name: 'library' })];
                return run('Open symbol library', script(`
app.executeMenuCommand(${str(lib.command)});
__result__ = { library: ${str(lib.name)} };`, { needsDocument: false }));
            }
            const p = paths.validate(a.filePath);
            if (path.extname(p).toLowerCase() !== '.ai') throw new Error('filePath must be an Illustrator (.ai) file');
            return run('Open symbol library', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var o = new OpenOptions();
o.openAs = LibraryType.SYMBOLS;
app.open(f, null, o);
__result__ = { library: f.displayName, file: f.fsName };`, { needsDocument: false }));
        },
    },
    {
        name: 'save_symbol_library',
        description: 'Save the document\'s symbols, or some of them, as a symbol library file (Symbols panel > Save Symbol Library). Open it later with open_symbol_library; files saved in Illustrator\'s Symbols presets folder also appear under Window > Symbol Libraries > User Defined',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the .ai library file to write' },
                symbols: { type: 'array', items: { type: 'string' }, description: 'Symbol names. Default all' },
            },
            required: ['filePath'],
        },
        features: ['illustrator.symbols.symbols_menu.save_symbol_library', 'illustrator.symbols.symbol_libraries_create'],
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'Symbols.ai') },
        handler: (a) => {
            const p = paths.validate(a.filePath);
            if (path.extname(p).toLowerCase() !== '.ai') throw new Error('filePath must end in .ai');
            const names = a.symbols === undefined ? null : symbolNames(a.symbols);
            return run('Save symbol library', script(`${SYMBOLS}
var names = ${names ? json(names) : 'null'}, syms = [], temp = [], i;
if (names) for (i = 0; i < names.length; i++) syms.push(__symbol(doc, names[i]));
else for (i = 0; i < doc.symbols.length; i++) syms.push(doc.symbols[i]);
if (!syms.length) throw new Error("The document has no symbols to save");
for (i = 0; i < syms.length; i++) temp.push(doc.activeLayer.symbolItems.add(syms[i]));
var lib = app.documents.add(doc.documentColorSpace), saved = [];
try {
  for (i = lib.symbols.length - 1; i >= 0; i--) { try { lib.symbols[i].remove(); } catch (e) {} }
  for (i = 0; i < temp.length; i++) temp[i].duplicate(lib, ElementPlacement.PLACEATEND);
  while (lib.symbolItems.length) lib.symbolItems[0].remove();
  for (i = 0; i < lib.symbols.length; i++) saved.push(lib.symbols[i].name);
  lib.saveAs(new File(${jsxPath(p)}), new IllustratorSaveOptions());
} finally {
  lib.close(SaveOptions.DONOTSAVECHANGES);
  doc.activate();
  for (i = 0; i < temp.length; i++) temp[i].remove();
}
__result__ = { file: ${str(p)}, symbols: saved };`));
        },
    },
];
