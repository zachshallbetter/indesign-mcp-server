/**
 * XML: the document's structure (Structure pane: elements, attributes,
 * comments, processing instructions, validation against a DTD), its tags
 * (Tags panel, tagging presets, tag-to-style mapping, autotagging), the view
 * and XML preferences, and XML import and export with their options.
 *
 * Elements are chosen by id (from list_xml_structure), by a path of child
 * indexes from the root element, by XPath, or by the Structure pane
 * selection.
 */
import { enumOf, num, index, bool, json, str, jsxPath } from 'adobe-mcp-core';
import { validateFilePath } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';

/** Structure helpers: finding elements and describing XML items. */
const XML_HELPERS = String.raw`
function __xmlRoot(doc) {
  if (!doc.xmlElements.length) throw new Error("The document has no XML structure");
  return doc.xmlElements.item(0);
}
function __xmlWalk(el, id) {
  if (el.id === id) return el;
  var i, hit;
  for (i = 0; i < el.xmlComments.length; i++) if (el.xmlComments.item(i).id === id) return el.xmlComments.item(i);
  for (i = 0; i < el.xmlInstructions.length; i++) if (el.xmlInstructions.item(i).id === id) return el.xmlInstructions.item(i);
  for (i = 0; i < el.xmlElements.length; i++) {
    hit = __xmlWalk(el.xmlElements.item(i), id);
    if (hit) return hit;
  }
  return null;
}
function __xmlItemById(doc, id) {
  var i;
  for (i = 0; i < doc.xmlComments.length; i++) if (doc.xmlComments.item(i).id === id) return doc.xmlComments.item(i);
  for (i = 0; i < doc.xmlInstructions.length; i++) if (doc.xmlInstructions.item(i).id === id) return doc.xmlInstructions.item(i);
  var hit = __xmlWalk(__xmlRoot(doc), id);
  if (!hit) throw new Error("No XML item with id " + id);
  return hit;
}
function __xmlById(doc, id) {
  var it = __xmlItemById(doc, id);
  if (it.constructor.name !== "XMLElement") throw new Error("XML item " + id + " is a " + it.constructor.name + ", not an element");
  return it;
}
function __xmlByPath(doc, steps) {
  var el = __xmlRoot(doc);
  for (var i = 0; i < steps.length; i++) {
    if (steps[i] >= el.xmlElements.length) throw new Error("Path step " + i + ": element <" + el.markupTag.name + "> has " + el.xmlElements.length + " child elements");
    el = el.xmlElements.item(steps[i]);
  }
  return el;
}
function __xmlAllByXPath(doc, expr) {
  var hits = __xmlRoot(doc).evaluateXPathExpression(expr), out = [];
  for (var i = 0; hits && i < hits.length; i++) out.push(hits[i]);
  return out;
}
function __xmlByXPath(doc, expr) {
  var hits = __xmlAllByXPath(doc, expr);
  if (!hits.length) throw new Error("No element matches " + expr);
  return hits[0];
}
function __xmlSelected(doc) {
  var sel = app.selection;
  for (var i = 0; i < sel.length; i++) {
    if (sel[i].constructor.name === "XMLElement") return sel[i];
    try { var e = sel[i].associatedXMLElement; if (e && e.isValid) return e; } catch (x) {}
  }
  throw new Error("Select an element in the Structure pane, or a tagged item");
}
function __xmlTag(doc, name) {
  var t = doc.xmlTags.itemByName(name);
  if (t.isValid) return t;
  return doc.xmlTags.add(name);
}
function __xmlOf(obj) {
  var c = obj;
  if (c.constructor.name === "TextFrame") c = c.parentStory;
  var e = null;
  try { e = c.associatedXMLElement; } catch (x) {}
  return e && e.isValid ? e : null;
}
function __xmlInfo(el) {
  var info = { id: el.id, tag: el.markupTag.name, index: el.index, children: el.xmlElements.length };
  var attrs = {};
  for (var i = 0; i < el.xmlAttributes.length; i++) {
    var a = el.xmlAttributes.item(i);
    attrs[a.name] = a.value;
  }
  info.attributes = attrs;
  try {
    var c = el.xmlContent;
    if (c && c.isValid) {
      info.content = c.constructor.name;
      try { if (c.id !== undefined) info.itemId = c.id; } catch (e) {}
    }
  } catch (e) {}
  return info;
}
`;

/** A module script with the structure helpers before the body. */
const xmlScript = (body, opts) => script(XML_HELPERS + body, opts);

/** XML names: tags, attribute names and instruction targets. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/** Validate an XML name and return it as a JSX string literal. */
export function xmlName(value, name) {
    const s = typeof value === 'string' ? value : '';
    if (!NAME_RE.test(s) || s.length > 200) {
        throw new Error(`'${name}' must be an XML name (a letter or _ then letters, digits, _ . - or :): ${JSON.stringify(value)}`);
    }
    return str(s);
}

/** A text value of at most `max` characters, as a JSX string literal. */
function text(value, name, max = 100000) {
    if (typeof value !== 'string') throw new Error(`'${name}' must be a string`);
    if (value.length > max) throw new Error(`'${name}' is longer than ${max} characters`);
    return str(value);
}

/** A boolean option as a JSX literal; anything but true or false is refused. */
function flag(value, name) {
    if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return bool(value);
}

/** Refuse option keys the schema does not define. */
function checkKeys(given, allowed, where) {
    for (const k of Object.keys(given)) {
        if (!allowed.includes(k)) throw new Error(`Unknown option '${where ? `${where}.` : ''}${k}'. Allowed: ${allowed.join(', ')}`);
    }
}

/** A plain options object, or a clear error. */
function object(value, name) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`'${name}' must be an object`);
    return value;
}

/** A file path through the server's path policy, as a JSX string literal. */
function filePath(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' must be a file path`);
    return jsxPath(validateFilePath(value));
}

export const ELEMENT_SCHEMA = {
    type: 'object',
    description: 'An XML element: its id (from list_xml_structure), its path of child indexes from the root element ([] is the root), the first element an XPath expression matches, or selection: true for the element selected in the Structure pane (or the selected tagged item). Give exactly one',
    properties: {
        id: { type: 'integer', minimum: 0, description: 'Element id' },
        path: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Child indexes from the root, e.g. [0, 2] is the third child of the root\'s first child' },
        xpath: { type: 'string', description: 'XPath expression evaluated from the root element, e.g. //article[@id="a1"]' },
        selection: { type: 'boolean', description: 'Use the element selected in the Structure pane' },
    },
};

/** An element reference as a JSX expression that resolves it. */
export function elementRef(ref, name = 'element') {
    const r = object(ref, name);
    checkKeys(r, Object.keys(ELEMENT_SCHEMA.properties), name);
    const given = Object.keys(r).filter((k) => r[k] !== undefined && r[k] !== false);
    if (given.length !== 1) throw new Error(`'${name}': give exactly one of id, path, xpath or selection: true`);
    const k = given[0];
    if (k === 'id') return `__xmlById(doc, ${index(r.id, { name: `${name}.id`, max: 1e9 })})`;
    if (k === 'path') {
        if (!Array.isArray(r.path) || r.path.length > 100) throw new Error(`'${name}.path' must be a list of up to 100 child indexes`);
        return `__xmlByPath(doc, [${r.path.map((i) => index(i, { name: `${name}.path` })).join(', ')}])`;
    }
    if (k === 'xpath') {
        if (typeof r.xpath !== 'string' || !r.xpath.trim()) throw new Error(`'${name}.xpath' must be a non-empty XPath expression`);
        return `__xmlByXPath(doc, ${text(r.xpath, `${name}.xpath`, 2000)})`;
    }
    if (r.selection !== true) throw new Error(`'${name}.selection' must be true`);
    return '__xmlSelected(doc)';
}

const UI_COLORS = ['BLACK', 'BLUE', 'BRICK_RED', 'BROWN', 'BURGUNDY', 'CHARCOAL', 'CUTE_TEAL', 'CYAN', 'DARK_BLUE', 'DARK_GREEN',
    'FIESTA', 'GOLD', 'GRASS_GREEN', 'GRAY', 'GREEN', 'GRID_BLUE', 'GRID_GREEN', 'GRID_ORANGE', 'LAVENDER', 'LIGHT_BLUE', 'LIGHT_GRAY',
    'LIGHT_OLIVE', 'LIPSTICK', 'MAGENTA', 'OCHRE', 'OLIVE_GREEN', 'ORANGE', 'PEACH', 'PINK', 'PURPLE', 'RED', 'SULPHUR', 'TAN', 'TEAL',
    'VIOLET', 'WHITE', 'YELLOW'];

const TAG_COLOR_SCHEMA = { type: 'string', description: `Tag colour: a UI colour (${UI_COLORS.join(', ')}) or "#RRGGBB"` };

/** A tag colour as a JSX value: a UIColors member or an [r, g, b] list. */
export function tagColor(value, name) {
    const v = String(value ?? '').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
        const n = parseInt(m[1], 16);
        return `[${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}]`;
    }
    return `UIColors.${enumOf(v.toUpperCase(), UI_COLORS, { name })}`;
}

/** Statements that read a tag colour `v` into a JSON value. */
const COLOR_READ = 'function __tagColor(v) { return v instanceof Array ? [v[0], v[1], v[2]] : __enumName(v); }';

const LOCATIONS = { start: 'AT_BEGINNING', end: 'AT_END', before: 'BEFORE', after: 'AFTER' };

/** Structure pane navigation (Structure Navigation menu actions, none opens a dialog). */
export const PANE_COMMANDS = {
    move_down: 78654, move_up: 78655, extend_down: 78656, extend_up: 78657,
    select_first: 78658, select_last: 78659, scroll_up: 78660, scroll_down: 78661,
    expand: 78662, collapse: 78663, expand_all: 78664, collapse_all: 78665,
    select_through_first: 78667, select_through_last: 78668,
    previous_error: 78673, next_error: 78674,
};

/** Structure pane and Tags panel menu items that only exist as menu toggles. */
const MENU_TOGGLES = {
    showComments: { id: 78806, label: 'Show Comments' },
    showProcessingInstructions: { id: 78807, label: 'Show Processing Instructions' },
    smallTagsPanelRows: { id: 78611, label: 'Small Panel Rows' },
};

/** XMLViewPreference properties (View > Structure, Structure pane menu). */
const VIEW_PROPS = {
    showStructure: 'Show the Structure pane (View > Structure > Show Structure)',
    showTaggedFrames: 'Colour frames by their tag (View > Structure > Show Tagged Frames)',
    showTagMarkers: 'Show coloured brackets around tagged text (View > Structure > Show Tag Markers)',
    showTextSnippets: 'Show the start of each element\'s text in the Structure pane (Show Text Snippets)',
    showAttributes: 'Show attributes in the Structure pane (Show Attributes)',
};

/** Tagging Preset Options: XMLPreference default tag names and colours. */
const PRESETS = {
    story: ['defaultStoryTagName', 'defaultStoryTagColor', 'Text frames (stories)'],
    table: ['defaultTableTagName', 'defaultTableTagColor', 'Tables'],
    cell: ['defaultCellTagName', 'defaultCellTagColor', 'Table cells'],
    image: ['defaultImageTagName', 'defaultImageTagColor', 'Images'],
};

const STYLE_TYPES = { paragraph: 'allParagraphStyles', character: 'allCharacterStyles', table: 'allTableStyles', cell: 'allCellStyles' };

/** XML Import Options, as XMLImportPreference properties. */
const IMPORT_FLAGS = {
    createLink: ['createLinkToXML', 'Create Link: link to the XML file so it can be updated'],
    cloneRepeatingText: ['repeatTextElements', 'Clone Repeating Text Elements (merge only)'],
    onlyMatching: ['ignoreUnmatchedIncoming', 'Only Import Elements That Match Existing Structure (merge only)'],
    importTextIntoTables: ['importTextIntoTables', 'Import Text Elements Into Tables If Tags Match (merge only)'],
    ignoreWhitespace: ['ignoreWhitespace', 'Do Not Import Contents Of Whitespace-Only Elements'],
    deleteUnmatched: ['removeUnmatchedExisting', 'Delete Elements, Frames, and Content That Do Not Match Imported XML (merge only)'],
    importCALSTables: ['importCALSTables', 'Import CALS Tables as InDesign Tables'],
    importToSelected: ['importToSelected', 'Import into the element selected in the Structure pane (Import into Selected Element)'],
};
const MERGE_ONLY = ['cloneRepeatingText', 'onlyMatching', 'importTextIntoTables', 'deleteUnmatched'];

const XSLT_SCHEMA = (where) => ({
    type: 'object',
    description: `Apply XSLT (${where}): a stylesheet file, or the stylesheet named in the XML; enabled: false turns it off`,
    properties: {
        enabled: { type: 'boolean', description: 'false turns XSLT off (default true when the object is given)' },
        file: { type: 'string', description: 'Absolute path of the XSLT file' },
        useStylesheetInXml: { type: 'boolean', description: 'Use the stylesheet the XML file names (Use Stylesheet Specified in XML)' },
        ...(where === 'import' ? {
            parameters: {
                type: 'array', description: 'Stylesheet parameters',
                items: { type: 'object', properties: { name: { type: 'string', description: 'Parameter name' }, value: { type: 'string', description: 'Parameter value' } }, required: ['name', 'value'] },
            },
        } : {}),
    },
});

/** Statements setting XSLT on preferences object `p`. */
function xsltStatements(x, where) {
    const o = object(x, 'xslt');
    checkKeys(o, Object.keys(XSLT_SCHEMA(where).properties), 'xslt');
    if (o.enabled === false) {
        if (Object.keys(o).length > 1) throw new Error("'xslt': options given with enabled: false");
        return ['p.allowTransform = false;'];
    }
    if (o.enabled !== undefined) flag(o.enabled, 'xslt.enabled');
    const lines = ['p.allowTransform = true;'];
    if ((o.file !== undefined) === (o.useStylesheetInXml === true)) throw new Error("'xslt': give file or useStylesheetInXml: true");
    if (o.file !== undefined) lines.push(`p.transformFilename = File(${filePath(o.file, 'xslt.file')});`);
    else lines.push('p.transformFilename = XMLTransformFile.STYLESHEET_IN_XML;');
    if (o.parameters !== undefined) {
        if (!Array.isArray(o.parameters) || o.parameters.length > 100) throw new Error("'xslt.parameters' must be a list of up to 100 { name, value }");
        const pairs = o.parameters.map((q, i) => {
            object(q, `xslt.parameters[${i}]`);
            checkKeys(q, ['name', 'value'], `xslt.parameters[${i}]`);
            if (typeof q.name !== 'string' || !q.name || typeof q.value !== 'string') throw new Error(`'xslt.parameters[${i}]' needs a name and a string value`);
            return [q.name, q.value];
        });
        lines.push(`p.transformParameters = ${json(pairs)};`);
    }
    return lines;
}

/** Export image options (XML Export Options > Images). */
const IMAGE_OPTIONS = {
    original: { prop: 'copyOriginalImages', kind: 'bool', description: 'Copy original images to the Images folder' },
    optimized: { prop: 'copyOptimizedImages', kind: 'bool', description: 'Copy optimized original images' },
    formatted: { prop: 'copyFormattedImages', kind: 'bool', description: 'Copy optimized formatted (cropped and scaled) images' },
    conversion: { prop: 'imageConversion', kind: 'enum', type: 'ImageConversion', values: ['AUTOMATIC', 'GIF', 'JPEG', 'PNG'], description: 'Image conversion of optimized images' },
    gifPalette: { prop: 'gifOptionsPalette', kind: 'enum', type: 'GIFOptionsPalette', values: ['ADAPTIVE_PALETTE', 'MACINTOSH_PALETTE', 'WEB_PALETTE', 'WINDOWS_PALETTE'], description: 'GIF palette' },
    gifInterlaced: { prop: 'gifOptionsInterlaced', kind: 'bool', description: 'Interlaced GIFs' },
    jpegQuality: { prop: 'jpegOptionsQuality', kind: 'enum', type: 'JPEGOptionsQuality', values: ['LOW', 'MEDIUM', 'HIGH', 'MAXIMUM'], description: 'JPEG image quality' },
    jpegFormat: { prop: 'jpegOptionsFormat', kind: 'enum', type: 'JPEGOptionsFormat', values: ['BASELINE_ENCODING', 'PROGRESSIVE_ENCODING'], description: 'JPEG format method' },
};

/** Read-back of the import or export preferences `p` the tools set. */
const IMPORT_READ = `{ mode: p.importStyle == XMLImportStyles.MERGE_IMPORT ? "merge" : "append", createLink: p.createLinkToXML,
  cloneRepeatingText: p.repeatTextElements, onlyMatching: p.ignoreUnmatchedIncoming, importTextIntoTables: p.importTextIntoTables,
  ignoreWhitespace: p.ignoreWhitespace, deleteUnmatched: p.removeUnmatchedExisting, importCALSTables: p.importCALSTables,
  importToSelected: p.importToSelected, xslt: p.allowTransform }`;
const EXPORT_READ = `{ includeDtd: !p.excludeDtd, viewAfterExport: p.viewAfterExport, untaggedTables: __enumName(p.exportUntaggedTablesFormat),
  remapCharacters: p.characterReferences, encoding: __enumName(p.fileEncoding), ruby: p.ruby, xslt: p.allowTransform,
  images: { original: p.copyOriginalImages, optimized: p.copyOptimizedImages, formatted: p.copyFormattedImages } }`;

const TEXT_TARGET = {
    type: 'object',
    description: 'Tag a range of text (Tag Text): characters start to end (inclusive, 0-based) of the story in a text frame; give frameId, start and end. An untagged story is first tagged with the default story tag, as InDesign does',
    properties: {
        frameId: { type: 'integer', minimum: 0, description: 'Id of a text frame of the story' },
        start: { type: 'integer', minimum: 0, description: 'First character index in the story' },
        end: { type: 'integer', minimum: 0, description: 'Last character index in the story' },
    },
};

export const tools = [
    {
        name: 'list_xml_structure',
        description: 'List the document\'s XML structure as a tree with element ids, tags, attributes, comments, processing instructions and what each element is tagged to (Structure pane). Ids are what the other XML tools take',
        inputSchema: {
            type: 'object',
            properties: {
                from: ELEMENT_SCHEMA,
                maxDepth: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'How many levels to descend' },
                maxElements: { type: 'integer', minimum: 1, maximum: 5000, default: 500, description: 'Stop after this many elements' },
                snippetLength: { type: 'integer', minimum: 0, maximum: 1000, default: 40, description: 'Characters of each element\'s text to include (0: none)' },
                includeComments: { type: 'boolean', default: true, description: 'Include XML comments and processing instructions' },
            },
        },
        features: ['indesign.xml.xml_element', 'indesign.xml.structure_pane'],
        hints: { readOnly: true, idempotent: true },
        auditArgs: { from: { path: [0] } },
        handler: (a) => {
            checkKeys(a, ['from', 'maxDepth', 'maxElements', 'snippetLength', 'includeComments'], '');
            const from = a.from === undefined ? '__xmlRoot(doc)' : elementRef(a.from, 'from');
            const depth = index(a.maxDepth ?? 10, { name: 'maxDepth', max: 50 });
            const max = index(a.maxElements ?? 500, { name: 'maxElements', max: 5000 });
            const snip = index(a.snippetLength ?? 40, { name: 'snippetLength', max: 1000 });
            const notes = flag(a.includeComments ?? true, 'includeComments');
            return run('List XML structure', xmlScript(`
var count = 0, truncated = false;
var walk = function (el, depth) {
  count++;
  var n = {}, base = __xmlInfo(el);
  for (var key in base) n[key] = base[key];
  if (${snip} > 0) { try { var t = String(el.contents); n.text = t.length > ${snip} ? t.substring(0, ${snip}) + "..." : t; } catch (e) {} }
  if (${notes}) {
    var cs = [], ps = [], i;
    for (i = 0; i < el.xmlComments.length; i++) cs.push({ id: el.xmlComments.item(i).id, value: el.xmlComments.item(i).value });
    for (i = 0; i < el.xmlInstructions.length; i++) ps.push({ id: el.xmlInstructions.item(i).id, target: el.xmlInstructions.item(i).target, data: el.xmlInstructions.item(i).data });
    if (cs.length) n.comments = cs;
    if (ps.length) n.instructions = ps;
  }
  if (el.xmlElements.length) {
    if (depth + 1 >= ${depth}) { n.more = true; return n; }
    var kids = [];
    for (var k = 0; k < el.xmlElements.length; k++) {
      if (count >= ${max}) { truncated = true; break; }
      kids.push(walk(el.xmlElements.item(k), depth + 1));
    }
    n.elements = kids;
  }
  return n;
};
var tree = walk(${from}, 0);
__result__ = { tree: tree, elements: count, truncated: truncated, tags: doc.xmlTags.length, dtd: doc.dtds.length > 0 };`));
        },
    },
    {
        name: 'add_xml_element',
        description: 'Add an XML element to the structure (Structure pane menu > New Element), or wrap existing sibling elements in a new parent element (New Parent Element). The tag is created if the document does not have it',
        inputSchema: {
            type: 'object',
            properties: {
                tag: { type: 'string', description: 'Tag name of the new element' },
                parent: { ...ELEMENT_SCHEMA, description: `Parent of the new element (default: the root). ${ELEMENT_SCHEMA.description}` },
                position: { type: 'string', enum: ['end', 'start'], default: 'end', description: 'Where under the parent: last or first child' },
                before: { ...ELEMENT_SCHEMA, description: 'Or: place the new element just before this sibling' },
                after: { ...ELEMENT_SCHEMA, description: 'Or: place the new element just after this sibling' },
                wrap: { type: 'array', items: ELEMENT_SCHEMA, description: 'Wrap these sibling elements, in order, in the new element (New Parent Element)' },
                contents: { type: 'string', description: 'Text content of the new element' },
                attributes: { type: 'object', description: 'Attributes of the new element, as { name: value }' },
            },
            required: ['tag'],
        },
        features: ['indesign.xml.structure_menu_new_element', 'indesign.xml.structure_new_parent_element'],
        hints: { readOnly: false },
        auditArgs: { parent: { id: 5 }, before: undefined, after: undefined, wrap: undefined, attributes: { id: 'a1' } },
        handler: (a) => {
            checkKeys(a, ['tag', 'parent', 'position', 'before', 'after', 'wrap', 'contents', 'attributes'], '');
            const tag = xmlName(a.tag, 'tag');
            const placements = ['parent', 'before', 'after', 'wrap'].filter((k) => a[k] !== undefined);
            if (placements.length > 1) throw new Error(`Give one of parent, before, after or wrap, not ${placements.join(' and ')}`);
            if (a.position !== undefined && (a.before || a.after || a.wrap)) throw new Error("'position' applies with parent");
            const lines = [`var tag = __xmlTag(doc, ${tag});`];
            if (a.wrap !== undefined) {
                if (!Array.isArray(a.wrap) || !a.wrap.length || a.wrap.length > 500) throw new Error("'wrap' must be a list of 1 to 500 elements");
                lines.push(
                    `var w = [${a.wrap.map((r, i) => elementRef(r, `wrap[${i}]`)).join(', ')}];`,
                    'var p = w[0].parent;',
                    'if (p.constructor.name !== "XMLElement") throw new Error("The root element cannot be wrapped");',
                    'for (var i = 1; i < w.length; i++) if (w[i].parent.id !== p.id) throw new Error("The elements to wrap must share one parent");',
                    'var el = p.xmlElements.add(tag);',
                    'el.move(LocationOptions.BEFORE, w[0]);',
                    'for (var j = 0; j < w.length; j++) w[j].move(LocationOptions.AT_END, el);',
                );
            } else if (a.before !== undefined || a.after !== undefined) {
                const where = a.before !== undefined ? 'before' : 'after';
                lines.push(
                    `var ref = ${elementRef(a[where], where)};`,
                    'if (ref.parent.constructor.name !== "XMLElement") throw new Error("The root element has no siblings");',
                    'var el = ref.parent.xmlElements.add(tag);',
                    `el.move(LocationOptions.${LOCATIONS[where]}, ref);`,
                );
            } else {
                const pos = enumOf(a.position ?? 'end', ['end', 'start'], { name: 'position' });
                lines.push(
                    `var p = ${a.parent === undefined ? '__xmlRoot(doc)' : elementRef(a.parent, 'parent')};`,
                    'var el = p.xmlElements.add(tag);',
                );
                if (pos === 'start') lines.push('el.move(LocationOptions.AT_BEGINNING, p);');
            }
            if (a.contents !== undefined) {
                if (a.wrap !== undefined) throw new Error("'contents' cannot be given with wrap");
                lines.push(`el.contents = ${text(a.contents, 'contents')};`);
            }
            if (a.attributes !== undefined) {
                for (const [k, v] of Object.entries(object(a.attributes, 'attributes'))) {
                    lines.push(`el.xmlAttributes.add(${xmlName(k, `attributes name ${JSON.stringify(k)}`)}, ${text(v, `attributes.${k}`, 10000)});`);
                }
            }
            return run('Add XML element', xmlScript(`${lines.join('\n')}
__result__ = __xmlInfo(el);`));
        },
    },
    {
        name: 'edit_xml_element',
        description: 'Change an XML element: retag it, replace its text, add, edit or delete attributes (Structure pane menu > New Attribute; Edit and Delete on an attribute), or move it before or after another element or into one',
        inputSchema: {
            type: 'object',
            properties: {
                element: ELEMENT_SCHEMA,
                tag: { type: 'string', description: 'New tag for the element (created if missing)' },
                contents: { type: 'string', description: 'Replace the element\'s text content' },
                setAttributes: { type: 'object', description: 'Attributes to add or change, as { name: value }' },
                removeAttributes: { type: 'array', items: { type: 'string' }, description: 'Names of attributes to delete' },
                move: {
                    type: 'object',
                    description: 'Move the element in the structure: give both to and reference',
                    properties: {
                        to: { type: 'string', enum: Object.keys(LOCATIONS), description: 'before or after the reference element, or as its first (start) or last (end) child' },
                        reference: ELEMENT_SCHEMA,
                    },
                },
            },
            required: ['element'],
        },
        features: ['indesign.xml.structure_menu_new_attribute', 'indesign.xml.context_xml_attribute_edit', 'indesign.xml.structure_edit'],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { element: { id: 7 }, setAttributes: { id: 'a2' }, removeAttributes: ['old'], move: { to: 'after', reference: { path: [1] } } },
        handler: (a) => {
            checkKeys(a, ['element', 'tag', 'contents', 'setAttributes', 'removeAttributes', 'move'], '');
            const lines = [`var el = ${elementRef(a.element, 'element')};`];
            if (a.tag !== undefined) lines.push(`el.markupTag = __xmlTag(doc, ${xmlName(a.tag, 'tag')});`);
            if (a.contents !== undefined) lines.push(`el.contents = ${text(a.contents, 'contents')};`);
            if (a.setAttributes !== undefined) {
                for (const [k, v] of Object.entries(object(a.setAttributes, 'setAttributes'))) {
                    const n = xmlName(k, `setAttributes name ${JSON.stringify(k)}`);
                    const val = text(v, `setAttributes.${k}`, 10000);
                    lines.push(`var a_ = el.xmlAttributes.itemByName(${n}); if (a_.isValid) a_.value = ${val}; else el.xmlAttributes.add(${n}, ${val});`);
                }
            }
            if (a.removeAttributes !== undefined) {
                if (!Array.isArray(a.removeAttributes)) throw new Error("'removeAttributes' must be a list of names");
                for (const k of a.removeAttributes) {
                    const n = xmlName(k, 'removeAttributes');
                    lines.push(`var r_ = el.xmlAttributes.itemByName(${n}); if (!r_.isValid) throw new Error("The element has no attribute " + ${n}); r_.remove();`);
                }
            }
            if (a.move !== undefined) {
                const m = object(a.move, 'move');
                checkKeys(m, ['to', 'reference'], 'move');
                const to = enumOf(m.to, Object.keys(LOCATIONS), { name: 'move.to' });
                lines.push(`el.move(LocationOptions.${LOCATIONS[to]}, ${elementRef(m.reference, 'move.reference')});`);
            }
            if (lines.length === 1) throw new Error('Nothing to change: give tag, contents, setAttributes, removeAttributes or move');
            return run('Edit XML element', xmlScript(`${lines.join('\n')}
__result__ = __xmlInfo(el);`));
        },
    },
    {
        name: 'set_xml_comment_or_instruction',
        description: 'Add an XML comment or processing instruction to an element (Structure pane menu > New Comment, New Processing Instruction), or edit an existing one by id (Edit)',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['comment', 'instruction'], description: 'An XML comment or a processing instruction' },
                id: { type: 'integer', minimum: 0, description: 'Edit the comment or instruction with this id (from list_xml_structure)' },
                parent: { ...ELEMENT_SCHEMA, description: `Or: add it to this element (default: the root). ${ELEMENT_SCHEMA.description}` },
                value: { type: 'string', description: 'Comment text' },
                target: { type: 'string', description: 'Processing instruction target (an XML name)' },
                data: { type: 'string', description: 'Processing instruction data' },
            },
            required: ['kind'],
        },
        features: ['indesign.xml.structure_menu_new_comment', 'indesign.xml.structure_menu_new_processing_instruction', 'indesign.xml.structure_edit'],
        hints: { readOnly: false },
        auditArgs: { kind: 'instruction', id: undefined, parent: { path: [] }, value: undefined, target: 'app-hint', data: 'keep' },
        handler: (a) => {
            checkKeys(a, ['kind', 'id', 'parent', 'value', 'target', 'data'], '');
            const kind = enumOf(a.kind, ['comment', 'instruction'], { name: 'kind' });
            if (a.id !== undefined && a.parent !== undefined) throw new Error('Give id (edit) or parent (add), not both');
            const lines = [];
            if (kind === 'comment') {
                if (a.target !== undefined || a.data !== undefined) throw new Error("'target' and 'data' are for instructions");
                if (a.value === undefined) throw new Error("Give the comment's 'value'");
                if (/--/.test(String(a.value)) || /-$/.test(String(a.value))) throw new Error("An XML comment cannot contain '--' or end with '-'");
                const v = text(a.value, 'value', 10000);
                if (a.id !== undefined) {
                    lines.push(`var n = __xmlItemById(doc, ${index(a.id, { name: 'id', max: 1e9 })});`,
                        'if (n.constructor.name !== "XMLComment") throw new Error("XML item " + n.id + " is not a comment");',
                        `n.value = ${v};`);
                } else {
                    lines.push(`var p = ${a.parent === undefined ? '__xmlRoot(doc)' : elementRef(a.parent, 'parent')};`, `var n = p.xmlComments.add(${v});`);
                }
                lines.push('__result__ = { id: n.id, kind: "comment", value: n.value, parentId: n.parent.id };');
            } else {
                if (a.value !== undefined) throw new Error("'value' is for comments; give target and data");
                if (a.target !== undefined && /^xml$/i.test(a.target)) throw new Error("'target' cannot be 'xml'");
                const target = a.target === undefined ? null : xmlName(a.target, 'target');
                if (a.data !== undefined && /\?>/.test(String(a.data))) throw new Error("'data' cannot contain '?>'");
                const data = a.data === undefined ? null : text(a.data, 'data', 10000);
                if (a.id !== undefined) {
                    if (!target && !data) throw new Error('Give target or data to change');
                    lines.push(`var n = __xmlItemById(doc, ${index(a.id, { name: 'id', max: 1e9 })});`,
                        'if (n.constructor.name !== "XMLInstruction") throw new Error("XML item " + n.id + " is not a processing instruction");');
                    if (target) lines.push(`n.target = ${target};`);
                    if (data) lines.push(`n.data = ${data};`);
                } else {
                    if (!target) throw new Error("Give the instruction's 'target'");
                    lines.push(`var p = ${a.parent === undefined ? '__xmlRoot(doc)' : elementRef(a.parent, 'parent')};`,
                        `var n = p.xmlInstructions.add(${target}, ${data ?? '""'});`);
                }
                lines.push('__result__ = { id: n.id, kind: "instruction", target: n.target, data: n.data, parentId: n.parent.id };');
            }
            return run('Set XML comment or instruction', xmlScript(lines.join('\n')));
        },
    },
    {
        name: 'remove_xml_items',
        description: 'Delete XML elements, comments or processing instructions (Structure pane menu > Delete), or untag elements, keeping their content in the layout (Untag Element). Deleting an element deletes the content tagged to it, as the Structure pane does',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['delete', 'untag'], default: 'delete', description: 'delete removes the items; untag removes the elements but keeps their content' },
                ids: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Ids of elements, comments or instructions (from list_xml_structure)' },
                xpath: { type: 'string', description: 'Or also: every element this XPath expression matches' },
                selection: { type: 'boolean', description: 'Or also: the element selected in the Structure pane' },
            },
        },
        features: ['indesign.xml.structure_menu_delete', 'indesign.xml.structure_menu_untag_element'],
        hints: { readOnly: false, destructive: true },
        auditArgs: { ids: [12, 13], xpath: '//note', selection: false },
        handler: (a) => {
            checkKeys(a, ['mode', 'ids', 'xpath', 'selection'], '');
            const mode = enumOf(a.mode ?? 'delete', ['delete', 'untag'], { name: 'mode' });
            const lines = ['var items = [];'];
            if (a.ids !== undefined) {
                if (!Array.isArray(a.ids) || a.ids.length > 1000) throw new Error("'ids' must be a list of up to 1000 ids");
                lines.push(`var ids = [${a.ids.map((i) => index(i, { name: 'ids', max: 1e9 })).join(', ')}];`,
                    'for (var i = 0; i < ids.length; i++) items.push(__xmlItemById(doc, ids[i]));');
            }
            if (a.xpath !== undefined) {
                if (typeof a.xpath !== 'string' || !a.xpath.trim()) throw new Error("'xpath' must be a non-empty XPath expression");
                lines.push(`var hits = __xmlAllByXPath(doc, ${text(a.xpath, 'xpath', 2000)});`, 'for (var h = 0; h < hits.length; h++) items.push(hits[h]);');
            }
            if (a.selection !== undefined && a.selection !== false) {
                flag(a.selection, 'selection');
                lines.push('items.push(__xmlSelected(doc));');
            }
            if (lines.length === 1) throw new Error('Choose the items: ids, xpath, or selection: true');
            return run(mode === 'delete' ? 'Delete XML items' : 'Untag XML elements', xmlScript(`${lines.join('\n')}
if (!items.length) throw new Error("No XML items matched");
var done = [];
for (var k = 0; k < items.length; k++) {
  var it = items[k];
  if (!it.isValid) continue;
  var type = it.constructor.name;
  if (type === "XMLElement" && it.parent.constructor.name !== "XMLElement") throw new Error("The root element cannot be ${mode === 'delete' ? 'deleted' : 'untagged'}");
  var info = { id: it.id, type: type };
  ${mode === 'delete' ? 'it.remove();' : 'if (type !== "XMLElement") throw new Error("XML item " + it.id + " is a " + type + "; only elements can be untagged");\n  info.tag = it.markupTag.name;\n  it.untag();'}
  done.push(info);
}
__result__ = { mode: "${mode}", items: done };`));
        },
    },
    {
        name: 'tag_xml_content',
        description: 'Tag frames, stories or text with an XML tag (Tag Element / Tag Frame / Tag Text), autotag frames and tables with the default tags (Tags panel > Autotag), untag frames (Tags panel > Untag), or add every untagged story and graphic to the structure (Structure pane menu > Add Untagged Items)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['tag', 'autotag', 'untag', 'add_untagged'], description: 'What to do' },
                tag: { type: 'string', description: 'Tag name for action tag (created if missing)' },
                target: { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}. A text frame stands for its story` },
                text: TEXT_TARGET,
                tables: {
                    type: 'array',
                    description: 'Tables to autotag, by text frame and table index',
                    items: {
                        type: 'object',
                        properties: {
                            frameId: { type: 'integer', minimum: 0, description: 'Id of the text frame holding the table' },
                            index: { type: 'integer', minimum: 0, description: 'Index of the table in the frame' },
                        },
                        required: ['frameId', 'index'],
                    },
                },
                parent: { ...ELEMENT_SCHEMA, description: `Parent element for newly tagged frames (default: the root). ${ELEMENT_SCHEMA.description}` },
            },
            required: ['action'],
        },
        features: [
            'indesign.xml.structure_tag_element',
            'indesign.xml.tags_menu_autotag',
            'indesign.xml.autotag_shortcut',
            'indesign.xml.tags_menu_untag',
            'indesign.xml.structure_add_untagged_items',
        ],
        hints: { readOnly: false },
        auditArgs: { action: 'tag', tag: 'figure', target: { ids: [21] }, text: { frameId: 22, start: 0, end: 9 }, tables: undefined, parent: { id: 3 } },
        handler: (a) => {
            checkKeys(a, ['action', 'tag', 'target', 'text', 'tables', 'parent'], '');
            const action = enumOf(a.action, ['tag', 'autotag', 'untag', 'add_untagged'], { name: 'action' });
            if (action !== 'tag' && (a.tag !== undefined || a.parent !== undefined || a.text !== undefined)) throw new Error("'tag', 'parent' and 'text' apply to action tag");
            if (action !== 'autotag' && a.tables !== undefined) throw new Error("'tables' applies to action autotag");
            if (action === 'add_untagged') {
                if (a.target !== undefined) throw new Error("'target' does not apply to add_untagged");
                return run('Add untagged items', xmlScript(`
__xmlRoot(doc);
var stories = 0, graphics = 0, i;
for (i = 0; i < doc.stories.length; i++) {
  var st = doc.stories.item(i);
  if (!__xmlOf(st)) { st.autoTag(); stories++; }
}
var gs = doc.allGraphics;
for (i = 0; i < gs.length; i++) {
  var fr = gs[i].parent;
  if (!__xmlOf(gs[i]) && !__xmlOf(fr)) { fr.autoTag(); graphics++; }
}
__result__ = { storiesTagged: stories, graphicsTagged: graphics };`));
            }
            const lines = ['var out = [];'];
            if (a.target !== undefined) lines.push(`var items = __targets(doc, ${targetSpec(a.target)});`);
            if (action === 'tag') {
                if (a.target === undefined && a.text === undefined) throw new Error('Choose what to tag: target (frames) or text');
                lines.push(`var tag = __xmlTag(doc, ${xmlName(a.tag, 'tag')});`);
                if (a.target !== undefined) {
                    lines.push(`var parent = ${a.parent === undefined ? '__xmlRoot(doc)' : elementRef(a.parent, 'parent')};`,
                        'for (var i = 0; i < items.length; i++) {',
                        '  var c = items[i].constructor.name === "TextFrame" ? items[i].parentStory : items[i];',
                        '  var cur = __xmlOf(c);',
                        '  if (cur) cur.markupTag = tag; else cur = parent.xmlElements.add(tag, c);',
                        '  out.push(__xmlInfo(cur));',
                        '}');
                }
                if (a.text !== undefined) {
                    const t = object(a.text, 'text');
                    checkKeys(t, ['frameId', 'start', 'end'], 'text');
                    const start = Number(index(t.start, { name: 'text.start', max: 1e8 }));
                    const end = Number(index(t.end, { name: 'text.end', max: 1e8 }));
                    if (end < start) throw new Error("'text.end' is before 'text.start'");
                    lines.push(`var fr = __item(doc, ${index(t.frameId, { name: 'text.frameId', max: 1e9 })});`,
                        'if (fr.constructor.name !== "TextFrame") throw new Error("Item " + fr.id + " is not a text frame");',
                        'var st = fr.parentStory;',
                        `if (${end} >= st.characters.length) throw new Error("The story has " + st.characters.length + " characters");`,
                        'var se = __xmlOf(st);',
                        'if (!se) { st.autoTag(); se = __xmlOf(st); }',
                        `var txt = st.characters.itemByRange(${start}, ${end}).texts.item(0);`,
                        'out.push(__xmlInfo(se.xmlElements.add(tag, txt)));');
                }
            } else if (action === 'autotag') {
                if (a.target === undefined && a.tables === undefined) throw new Error('Choose what to autotag: target (frames) or tables');
                if (a.target !== undefined) {
                    lines.push('for (var i = 0; i < items.length; i++) {',
                        '  var e = __xmlOf(items[i]);',
                        '  if (!e) { items[i].autoTag(); e = __xmlOf(items[i]); }',
                        '  out.push(e ? __xmlInfo(e) : { itemId: items[i].id, tagged: false });',
                        '}');
                }
                if (a.tables !== undefined) {
                    if (!Array.isArray(a.tables) || !a.tables.length || a.tables.length > 200) throw new Error("'tables' must be a list of 1 to 200 { frameId, index }");
                    const specs = a.tables.map((t, i) => {
                        object(t, `tables[${i}]`);
                        checkKeys(t, ['frameId', 'index'], `tables[${i}]`);
                        return [Number(index(t.frameId, { name: `tables[${i}].frameId`, max: 1e9 })), Number(index(t.index, { name: `tables[${i}].index` }))];
                    });
                    lines.push(`var specs = ${json(specs)};`,
                        'for (var s = 0; s < specs.length; s++) {',
                        '  var tf = __item(doc, specs[s][0]);',
                        '  if (tf.constructor.name !== "TextFrame") throw new Error("Item " + tf.id + " is not a text frame");',
                        '  if (specs[s][1] >= tf.tables.length) throw new Error("Text frame " + tf.id + " has " + tf.tables.length + " tables");',
                        '  var tb = tf.tables.item(specs[s][1]);',
                        '  var te = __xmlOf(tb);',
                        '  if (!te) { tb.autoTag(); te = __xmlOf(tb); }',
                        '  out.push(te ? __xmlInfo(te) : { frameId: tf.id, table: specs[s][1], tagged: false });',
                        '}');
                }
            } else {
                if (a.target === undefined) throw new Error('Choose the frames to untag: target');
                lines.push('for (var i = 0; i < items.length; i++) {',
                    '  var e = __xmlOf(items[i]);',
                    '  if (e) { out.push({ itemId: items[i].id, untagged: e.markupTag.name }); e.untag(); }',
                    '  else out.push({ itemId: items[i].id, untagged: null });',
                    '}');
            }
            return run(`XML ${action}`, xmlScript(`${lines.join('\n')}
__result__ = { action: "${action}", elements: out };`));
        },
    },
    {
        name: 'select_xml_element',
        description: 'Select an XML element in the Structure pane, or select its content in the layout (Go to Item); select the element of a tagged frame (Select in Structure); or move through the Structure pane with its navigation commands (expand, collapse, next validation error and so on)',
        inputSchema: {
            type: 'object',
            properties: {
                element: ELEMENT_SCHEMA,
                itemId: { type: 'integer', minimum: 0, description: 'Or: a tagged page item whose element to select (Select in Structure)' },
                show: { type: 'string', enum: ['structure', 'layout'], default: 'structure', description: 'structure selects the element in the Structure pane; layout selects its frame or text and shows its page (Go to Item)' },
                paneCommand: { type: 'string', enum: Object.keys(PANE_COMMANDS), description: 'A Structure pane navigation command, run after any selection (the pane must be open)' },
                repeat: { type: 'integer', minimum: 1, maximum: 100, default: 1, description: 'Run the navigation command this many times' },
            },
        },
        features: ['indesign.xml.structure_menu_go_to_item', 'indesign.xml.structure_select_in_structure', 'indesign.xml.structure_navigation_keys'],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { element: { xpath: '//title' }, itemId: undefined, show: 'layout', paneCommand: 'expand_all', repeat: 2 },
        handler: (a) => {
            checkKeys(a, ['element', 'itemId', 'show', 'paneCommand', 'repeat'], '');
            if (a.element !== undefined && a.itemId !== undefined) throw new Error('Give element or itemId, not both');
            const show = enumOf(a.show ?? 'structure', ['structure', 'layout'], { name: 'show' });
            const lines = ['var r = {};'];
            if (a.element !== undefined || a.itemId !== undefined) {
                if (a.element !== undefined) lines.push(`var el = ${elementRef(a.element, 'element')};`);
                else {
                    lines.push(`var it = __item(doc, ${index(a.itemId, { name: 'itemId', max: 1e9 })});`,
                        'var el = __xmlOf(it);',
                        'if (!el) throw new Error("Item " + it.id + " is not tagged");');
                }
                if (show === 'structure') lines.push('el.select();');
                else {
                    lines.push('var c = el.xmlContent;',
                        'if (!c || !c.isValid) throw new Error("Element " + el.id + " has no content in the layout");',
                        'if (c.constructor.name === "Story") c = c.texts.item(0);',
                        'c.select();',
                        'try { var pg = c.parentTextFrames ? c.parentTextFrames[0].parentPage : c.parentPage; if (pg) app.activeWindow.activePage = pg; } catch (e) {}');
                }
                lines.push('r.element = __xmlInfo(el);', `r.shown = "${show}";`);
            } else if (a.show !== undefined) throw new Error("'show' applies with element or itemId");
            if (a.paneCommand !== undefined) {
                const cmd = enumOf(a.paneCommand, Object.keys(PANE_COMMANDS), { name: 'paneCommand' });
                const times = index(a.repeat ?? 1, { name: 'repeat', max: 100 });
                if (Number(times) < 1) throw new Error("'repeat' must be at least 1");
                lines.push(`var m = app.menuActions.itemByID(${PANE_COMMANDS[cmd]});`,
                    `if (!m.isValid || !m.enabled) throw new Error("${cmd} is not available now: open the Structure pane (set_xml_preferences view.showStructure) and select an element");`,
                    'var ran = 0;',
                    `for (var n = 0; n < ${times}; n++) { if (!m.enabled) break; m.invoke(); ran++; }`,
                    `r.paneCommand = "${cmd}"; r.ran = ran;`);
            } else if (a.repeat !== undefined) throw new Error("'repeat' applies with paneCommand");
            if (lines.length === 1) throw new Error('Give element, itemId or paneCommand');
            return run('Select XML element', xmlScript(`${lines.join('\n')}
__result__ = r;`));
        },
    },
    {
        name: 'set_xml_preferences',
        description: 'Set or read the XML view and preferences: show the Structure pane, tagged frames, tag markers, text snippets, attributes, comments and processing instructions (View > Structure; Structure pane menu), small rows in the Tags panel, the Tagging Preset Options (default tags and colours for autotagging), and whether deleting content deletes its element. With no options, returns the current settings',
        inputSchema: {
            type: 'object',
            properties: {
                view: {
                    type: 'object',
                    description: 'What is shown',
                    properties: {
                        ...Object.fromEntries(Object.entries(VIEW_PROPS).map(([k, d]) => [k, { type: 'boolean', description: d }])),
                        showComments: { type: 'boolean', description: 'Show XML comments in the Structure pane (Show Comments)' },
                        showProcessingInstructions: { type: 'boolean', description: 'Show processing instructions in the Structure pane (Show Processing Instructions)' },
                        smallTagsPanelRows: { type: 'boolean', description: 'Compact rows in the Tags panel (Tags panel menu > Small Panel Rows)' },
                    },
                },
                tagging: {
                    type: 'object',
                    description: 'Tagging Preset Options: the tags autotagging applies, and their colours',
                    properties: Object.fromEntries(Object.entries(PRESETS).flatMap(([k, [, , label]]) => [
                        [`${k}Tag`, { type: 'string', description: `Default tag for ${label.toLowerCase()}` }],
                        [`${k}TagColor`, { ...TAG_COLOR_SCHEMA, description: `Colour of the default ${k} tag. ${TAG_COLOR_SCHEMA.description}` }],
                    ])),
                },
                deleteElementOnContentDeletion: { type: 'boolean', description: 'Delete an element when its content (a frame or text) is deleted (XML preferences)' },
            },
        },
        features: [
            'indesign.xml.structure_menu_show_text_snippets',
            'indesign.xml.structure_menu_show_attributes',
            'indesign.xml.structure_menu_show_comments',
            'indesign.xml.structure_menu_show_processing_instructions',
            'indesign.xml.show_tagged_frames',
            'indesign.xml.show_tag_markers',
            'indesign.xml.tags_menu_small_panel_rows',
            'indesign.xml.structure_menu_tagging_preset_options',
            'indesign.xml.tagging_preset_options',
            'indesign.xml.xml_preferences',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { tagging: { storyTag: 'Story', storyTagColor: 'BLUE', imageTagColor: '#336699' } },
        handler: (a) => {
            checkKeys(a, ['view', 'tagging', 'deleteElementOnContentDeletion'], '');
            const lines = [
                'var vp = doc.xmlViewPreferences, xp = doc.xmlPreferences;',
                'var __menu = function (id, label, on) {',
                '  var m = app.menuActions.itemByID(id);',
                '  if (!m.isValid) throw new Error(label + " is not available in this version");',
                '  if (m.checked !== on) {',
                '    if (!m.enabled) throw new Error(label + " is not available now: show the Structure pane (view.showStructure) or the Tags panel first");',
                '    m.invoke();',
                '  }',
                '};',
            ];
            if (a.view !== undefined) {
                const v = object(a.view, 'view');
                checkKeys(v, [...Object.keys(VIEW_PROPS), ...Object.keys(MENU_TOGGLES)], 'view');
                for (const k of Object.keys(VIEW_PROPS)) if (v[k] !== undefined) lines.push(`vp.${k} = ${flag(v[k], `view.${k}`)};`);
                for (const [k, m] of Object.entries(MENU_TOGGLES)) if (v[k] !== undefined) lines.push(`__menu(${m.id}, "${m.label}", ${flag(v[k], `view.${k}`)});`);
            }
            if (a.tagging !== undefined) {
                const t = object(a.tagging, 'tagging');
                checkKeys(t, Object.keys(PRESETS).flatMap((k) => [`${k}Tag`, `${k}TagColor`]), 'tagging');
                for (const [k, [nameProp, colorProp]] of Object.entries(PRESETS)) {
                    if (t[`${k}Tag`] !== undefined) lines.push(`xp.${nameProp} = ${xmlName(t[`${k}Tag`], `tagging.${k}Tag`)};`);
                    if (t[`${k}TagColor`] !== undefined) lines.push(`xp.${colorProp} = ${tagColor(t[`${k}TagColor`], `tagging.${k}TagColor`)};`);
                }
            }
            if (a.deleteElementOnContentDeletion !== undefined) lines.push(`xp.deleteElementOnContentDeletion = ${flag(a.deleteElementOnContentDeletion, 'deleteElementOnContentDeletion')};`);
            const viewRead = Object.keys(VIEW_PROPS).map((k) => `${k}: vp.${k}`).concat(
                Object.entries(MENU_TOGGLES).map(([k, m]) => `${k}: app.menuActions.itemByID(${m.id}).isValid ? app.menuActions.itemByID(${m.id}).checked : null`));
            const tagRead = Object.entries(PRESETS).flatMap(([k, [n, c]]) => [`${k}Tag: xp.${n}`, `${k}TagColor: __tagColor(xp.${c})`]);
            return run('Set XML preferences', xmlScript(`${COLOR_READ}
${lines.join('\n')}
__result__ = { view: { ${viewRead.join(', ')} }, tagging: { ${tagRead.join(', ')} }, deleteElementOnContentDeletion: xp.deleteElementOnContentDeletion };`));
        },
    },
    {
        name: 'list_xml_tags',
        description: 'List the document\'s XML tags with their colours and how many elements use each, marking unused tags (Tags panel; Select All Unused Tags)',
        inputSchema: { type: 'object', properties: {} },
        features: ['indesign.xml.tags_panel', 'indesign.xml.xml_tag', 'indesign.xml.tags_menu_select_all_unused_tags'],
        hints: { readOnly: true, idempotent: true },
        handler: (a = {}) => {
            checkKeys(a, [], '');
            return run('List XML tags', xmlScript(`${COLOR_READ}
var used = {};
var walk = function (el) {
  var n = el.markupTag.name;
  used[n] = (used[n] || 0) + 1;
  for (var i = 0; i < el.xmlElements.length; i++) walk(el.xmlElements.item(i));
};
for (var r = 0; r < doc.xmlElements.length; r++) walk(doc.xmlElements.item(r));
var tags = [], unused = [];
for (var t = 0; t < doc.xmlTags.length; t++) {
  var tg = doc.xmlTags.item(t), count = used[tg.name] || 0;
  tags.push({ id: tg.id, name: tg.name, color: __tagColor(tg.tagColor), elements: count });
  if (!count) unused.push(tg.name);
}
__result__ = { tags: tags, unused: unused };`));
        },
    },
    {
        name: 'set_xml_tag',
        description: 'Create an XML tag (Tags panel menu > New Tag), or rename or recolour one (Tag Options)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Tag name' },
                newName: { type: 'string', description: 'Rename the tag to this' },
                color: TAG_COLOR_SCHEMA,
                create: { type: 'boolean', default: true, description: 'Create the tag if the document does not have it' },
            },
            required: ['name'],
        },
        features: ['indesign.xml.tags_menu_new_tag', 'indesign.xml.tags_menu_tag_options'],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { name: 'article', newName: 'story', color: 'GRID_GREEN' },
        handler: (a) => {
            checkKeys(a, ['name', 'newName', 'color', 'create'], '');
            const name = xmlName(a.name, 'name');
            const create = flag(a.create ?? true, 'create');
            const lines = [`var t = doc.xmlTags.itemByName(${name}), created = false;`,
                `if (!t.isValid) { if (!${create}) throw new Error("No tag named " + ${name}); t = doc.xmlTags.add(${name}); created = true; }`];
            if (a.color !== undefined) lines.push(`t.tagColor = ${tagColor(a.color, 'color')};`);
            if (a.newName !== undefined) {
                const nn = xmlName(a.newName, 'newName');
                lines.push(`if (${nn} !== t.name) { if (doc.xmlTags.itemByName(${nn}).isValid) throw new Error("A tag named " + ${nn} + " already exists"); t.name = ${nn}; }`);
            }
            return run('Set XML tag', xmlScript(`${COLOR_READ}
${lines.join('\n')}
__result__ = { id: t.id, name: t.name, color: __tagColor(t.tagColor), created: created };`));
        },
    },
    {
        name: 'delete_xml_tags',
        description: 'Delete XML tags (Tags panel menu > Delete Tag), retagging their elements with a replacement tag, or delete every tag no element uses (Select All Unused Tags, then Delete Tag)',
        inputSchema: {
            type: 'object',
            properties: {
                names: { type: 'array', items: { type: 'string' }, description: 'Tags to delete' },
                replaceWith: { type: 'string', description: 'Tag that elements using a deleted tag get instead (needed when a tag is in use)' },
                unused: { type: 'boolean', description: 'Delete every tag no element uses' },
            },
        },
        features: ['indesign.xml.tags_menu_delete_tag', 'indesign.xml.tags_menu_select_all_unused_tags'],
        hints: { readOnly: false, destructive: true },
        auditArgs: { names: ['old'], replaceWith: 'para', unused: true },
        handler: (a) => {
            checkKeys(a, ['names', 'replaceWith', 'unused'], '');
            const unused = a.unused === undefined ? false : a.unused;
            flag(unused, 'unused');
            const lines = ['var deleted = [];'];
            if (a.names !== undefined) {
                if (!Array.isArray(a.names) || !a.names.length || a.names.length > 500) throw new Error("'names' must be a list of 1 to 500 tag names");
                const names = a.names.map((n) => xmlName(n, 'names'));
                const rw = a.replaceWith === undefined ? null : xmlName(a.replaceWith, 'replaceWith');
                if (rw && a.names.includes(a.replaceWith)) throw new Error("'replaceWith' is one of the tags being deleted");
                lines.push(
                    'var used = {};',
                    'var walk = function (el) { used[el.markupTag.name] = true; for (var i = 0; i < el.xmlElements.length; i++) walk(el.xmlElements.item(i)); };',
                    'for (var r = 0; r < doc.xmlElements.length; r++) walk(doc.xmlElements.item(r));',
                    `var names = [${names.join(', ')}];`,
                    rw ? `var rt = doc.xmlTags.itemByName(${rw}); if (!rt.isValid) throw new Error("No tag named " + ${rw});` : 'var rt = null;',
                    'for (var k = 0; k < names.length; k++) {',
                    '  var t = doc.xmlTags.itemByName(names[k]);',
                    '  if (!t.isValid) throw new Error("No tag named " + names[k]);',
                    '  if (used[names[k]] && !rt) throw new Error("Tag " + names[k] + " is in use: give replaceWith");',
                    '}',
                    'for (var d = 0; d < names.length; d++) {',
                    '  var dt = doc.xmlTags.itemByName(names[d]);',
                    '  if (rt) dt.remove(rt); else dt.remove();',
                    '  deleted.push(names[d]);',
                    '}',
                );
            } else if (a.replaceWith !== undefined) throw new Error("'replaceWith' applies with names");
            if (unused) {
                lines.push('var before = [], b;',
                    'for (b = 0; b < doc.xmlTags.length; b++) before.push(doc.xmlTags.item(b).name);',
                    'doc.deleteUnusedTags();',
                    'for (b = 0; b < before.length; b++) if (!doc.xmlTags.itemByName(before[b]).isValid) deleted.push(before[b]);');
            }
            if (lines.length === 1) throw new Error('Choose the tags: names, or unused: true');
            return run('Delete XML tags', xmlScript(`${lines.join('\n')}
__result__ = { deleted: deleted, remaining: doc.xmlTags.length };`));
        },
    },
    {
        name: 'transfer_xml_tags',
        description: 'Load XML tags from an XML or DTD file into the document (Tags panel menu > Load Tags), or save the document\'s tags to an XML file (Save Tags)',
        inputSchema: {
            type: 'object',
            properties: {
                direction: { type: 'string', enum: ['load', 'save'], description: 'load reads tags from the file; save writes the document\'s tags to it' },
                filePath: { type: 'string', description: 'Absolute path of the XML or DTD file' },
            },
            required: ['direction', 'filePath'],
        },
        features: ['indesign.xml.tags_menu_load_tags', 'indesign.xml.tags_menu_save_tags'],
        hints: { readOnly: false, destructive: true, idempotent: true },
        handler: (a) => {
            checkKeys(a, ['direction', 'filePath'], '');
            const dir = enumOf(a.direction, ['load', 'save'], { name: 'direction' });
            const p = filePath(a.filePath, 'filePath');
            const body = dir === 'load'
                ? `var f = File(${p});
if (!f.exists) throw new Error("No file at " + f.fsName);
var before = doc.xmlTags.length;
doc.loadXMLTags(f);
__result__ = { loaded: f.fsName, tags: doc.xmlTags.length, added: doc.xmlTags.length - before };`
                : `var f = File(${p});
if (!f.parent.exists) throw new Error("Folder does not exist: " + f.parent.fsName);
doc.saveXMLTags(f, "");
__result__ = { saved: f.fsName, tags: doc.xmlTags.length };`;
            return run(dir === 'load' ? 'Load XML tags' : 'Save XML tags', xmlScript(body));
        },
    },
    {
        name: 'map_xml_tags_and_styles',
        description: 'Map XML tags to paragraph, character, table or cell styles and style the tagged content (Structure pane or Tags panel menu > Map Tags to Styles), or map styles to tags and tag the styled content (Map Styles to Tags). Maps are kept in the document; map_by_name pairs tags and styles of the same name',
        inputSchema: {
            type: 'object',
            properties: {
                direction: { type: 'string', enum: ['tags_to_styles', 'styles_to_tags'], description: 'Which mapping' },
                maps: {
                    type: 'array',
                    description: 'Tag and style pairs to add or change',
                    items: {
                        type: 'object',
                        properties: {
                            tag: { type: 'string', description: 'Tag name (for styles_to_tags, created if missing)' },
                            style: { type: 'string', description: 'Style name' },
                            styleType: { type: 'string', enum: Object.keys(STYLE_TYPES), description: 'Kind of style (default paragraph)' },
                        },
                        required: ['tag', 'style'],
                    },
                },
                mapByName: { type: 'boolean', description: 'Also map every tag and paragraph or character style that share a name (Map By Name)' },
                replace: { type: 'boolean', default: false, description: 'Remove the existing maps of this direction first' },
                apply: { type: 'boolean', default: true, description: 'Apply the maps now: style the tagged content, or tag the styled content' },
                includeMasterPageStories: { type: 'boolean', description: 'styles_to_tags: include stories on parent (master) pages' },
                includePasteboardStories: { type: 'boolean', description: 'styles_to_tags: include stories on the pasteboard' },
                includeEmptyStories: { type: 'boolean', description: 'styles_to_tags: include empty stories' },
            },
            required: ['direction'],
        },
        features: [
            'indesign.xml.structure_menu_map_tags_to_styles',
            'indesign.xml.structure_menu_map_styles_to_tags',
            'indesign.xml.tags_menu_map_tags_to_styles',
            'indesign.xml.tags_menu_map_styles_to_tags',
            'indesign.xml.xml_import_maps',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { direction: 'styles_to_tags', maps: [{ tag: 'head', style: 'Heading 1' }, { tag: 'em', style: 'Emphasis', styleType: 'character' }] },
        handler: (a) => {
            const opts = ['includeMasterPageStories', 'includePasteboardStories', 'includeEmptyStories'];
            checkKeys(a, ['direction', 'maps', 'mapByName', 'replace', 'apply', ...opts], '');
            const dir = enumOf(a.direction, ['tags_to_styles', 'styles_to_tags'], { name: 'direction' });
            const toStyles = dir === 'tags_to_styles';
            const coll = toStyles ? 'doc.xmlImportMaps' : 'doc.xmlExportMaps';
            const lines = [
                `var maps = ${coll};`,
                'var __style = function (kind, name, need) {',
                '  var all = kind === "paragraph" ? doc.allParagraphStyles : kind === "character" ? doc.allCharacterStyles : kind === "table" ? doc.allTableStyles : doc.allCellStyles;',
                '  for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];',
                '  if (need) throw new Error("No " + kind + " style named " + name);',
                '  return null;',
                '};',
                'var __unmap = function (key) {',
                `  for (var i = maps.length - 1; i >= 0; i--) { var m = maps.item(i); if (${toStyles ? 'm.markupTag.name === key' : 'm.mappedStyle.id === key.id && m.mappedStyle.constructor.name === key.constructor.name'}) m.remove(); }`,
                '};',
            ];
            if (flag(a.replace ?? false, 'replace') === 'true') lines.push('for (var x = maps.length - 1; x >= 0; x--) maps.item(x).remove();');
            if (a.maps !== undefined) {
                if (!Array.isArray(a.maps) || a.maps.length > 500) throw new Error("'maps' must be a list of up to 500 { tag, style, styleType }");
                a.maps.forEach((m, i) => {
                    object(m, `maps[${i}]`);
                    checkKeys(m, ['tag', 'style', 'styleType'], `maps[${i}]`);
                    const tag = xmlName(m.tag, `maps[${i}].tag`);
                    if (typeof m.style !== 'string' || !m.style) throw new Error(`'maps[${i}].style' must be a style name`);
                    const kind = enumOf(m.styleType ?? 'paragraph', Object.keys(STYLE_TYPES), { name: `maps[${i}].styleType` });
                    const style = `__style("${kind}", ${text(m.style, `maps[${i}].style`, 500)}, true)`;
                    if (toStyles) {
                        lines.push(`var t${i} = doc.xmlTags.itemByName(${tag}); if (!t${i}.isValid) throw new Error("No tag named " + ${tag});`,
                            `__unmap(${tag}); maps.add(t${i}, ${style});`);
                    } else {
                        lines.push(`var s${i} = ${style}; __unmap(s${i}); maps.add(s${i}, __xmlTag(doc, ${tag}));`);
                    }
                });
            }
            if (a.mapByName !== undefined && flag(a.mapByName, 'mapByName') === 'true') {
                lines.push('var kinds = ["paragraph", "character"];',
                    'for (var bt = 0; bt < doc.xmlTags.length; bt++) {',
                    '  var tg = doc.xmlTags.item(bt);',
                    '  for (var bk = 0; bk < kinds.length; bk++) {',
                    '    var st = __style(kinds[bk], tg.name, false);',
                    '    if (!st) continue;',
                    toStyles ? '    __unmap(tg.name); maps.add(tg, st); break;' : '    __unmap(st); maps.add(st, tg);',
                    '  }',
                    '}');
            }
            for (const k of opts) {
                if (a[k] === undefined) continue;
                if (toStyles) throw new Error(`'${k}' applies to styles_to_tags`);
                lines.push(`for (var o_${k} = 0; o_${k} < maps.length; o_${k}++) maps.item(o_${k}).${k} = ${flag(a[k], k)};`);
            }
            const apply = flag(a.apply ?? true, 'apply') === 'true';
            if (apply) lines.push(toStyles ? 'doc.mapXMLTagsToStyles();' : 'doc.mapStylesToXMLTags();');
            return run('Map XML tags and styles', xmlScript(`${lines.join('\n')}
var list = [];
for (var q = 0; q < maps.length; q++) {
  var mp = maps.item(q);
  list.push({ tag: mp.markupTag.name, style: mp.mappedStyle.name, styleType: mp.mappedStyle.constructor.name });
}
__result__ = { direction: "${dir}", maps: list, applied: ${bool(apply)} };`));
        },
    },
    {
        name: 'import_xml',
        description: 'Import an XML file into the structure (File > Import XML; Structure pane menu > Import XML) with the XML Import Options: merge or append, link to the file, XSLT, clone repeating text elements, only import matching elements, import text into tables, skip whitespace-only elements, delete unmatched content, CALS tables, and import into an element. The options given are kept as the document\'s XML import settings',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the XML file' },
                into: { ...ELEMENT_SCHEMA, description: `Import under this element instead of the root (Import into Selected Element). ${ELEMENT_SCHEMA.description}` },
                mode: { type: 'string', enum: ['merge', 'append'], description: 'Merge Content (fill matching placeholders) or Append Content' },
                ...Object.fromEntries(Object.entries(IMPORT_FLAGS).map(([k, [, d]]) => [k, { type: 'boolean', description: d }])),
                xslt: XSLT_SCHEMA('import'),
            },
            required: ['filePath'],
        },
        features: [
            'indesign.xml.import_xml',
            'indesign.xml.structure_menu_import_xml',
            'indesign.xml.xml_import_mode_merge_content_append_content',
            'indesign.xml.xml_import_create_link_xml',
            'indesign.xml.xml_import_apply_xslt',
            'indesign.xml.xml_import_clone_repeating_text_elements',
            'indesign.xml.xml_import_only_import_elements_that_match_existing_structure',
            'indesign.xml.xml_import_import_text_elements_into_tables_if_tags_match',
            'indesign.xml.xml_import_do_not_import_contents_of_whitespace_only_elements',
            'indesign.xml.xml_import_delete_elements_frames_and_content_that_do_not_match_imported_xml',
            'indesign.xml.xml_import_import_cals_tables_as_indesign_tables',
            'indesign.xml.xml_import_import_into_selected_element',
        ],
        hints: { readOnly: false, destructive: true },
        auditArgs: {
            into: { id: 4 }, mode: 'merge', importToSelected: false,
            xslt: { file: `${process.env.HOME ?? '/tmp'}/Documents/in.xsl`, parameters: [{ name: 'lang', value: 'en' }] },
        },
        handler: (a) => {
            checkKeys(a, ['filePath', 'into', 'mode', ...Object.keys(IMPORT_FLAGS), 'xslt'], '');
            const p = filePath(a.filePath, 'filePath');
            const lines = ['var p = doc.xmlImportPreferences;'];
            const mode = a.mode === undefined ? null : enumOf(a.mode, ['merge', 'append'], { name: 'mode' });
            if (mode) lines.push(`p.importStyle = XMLImportStyles.${mode === 'merge' ? 'MERGE_IMPORT' : 'APPEND_IMPORT'};`);
            for (const [k, [prop]] of Object.entries(IMPORT_FLAGS)) {
                if (a[k] === undefined) continue;
                const v = flag(a[k], k);
                if (mode === 'append' && MERGE_ONLY.includes(k) && v === 'true') throw new Error(`'${k}' applies only to mode: merge`);
                lines.push(`p.${prop} = ${v};`);
            }
            if (a.into !== undefined && a.importToSelected === true) throw new Error('Give into or importToSelected, not both');
            if (a.xslt !== undefined) lines.push(...xsltStatements(a.xslt, 'import'));
            const into = a.into === undefined ? null : elementRef(a.into, 'into');
            return run('Import XML', xmlScript(`var f = File(${p});
if (!f.exists) throw new Error("No file at " + f.fsName);
${lines.join('\n')}
${into ? `var target = ${into};\ntarget.importXML(f);` : 'doc.importXML(f);\nvar target = __xmlRoot(doc);'}
__result__ = { imported: f.fsName, into: __xmlInfo(target), settings: ${IMPORT_READ} };`));
        },
    },
    {
        name: 'export_xml',
        description: 'Export the XML structure, or one element of it, to a file with the XML Export Options: include the DTD declaration, view the XML afterwards, export from the selected element, untagged tables as CALS, remap break, whitespace and special characters, XSLT, encoding, ruby, and image copying and conversion (File > Export > XML; Structure pane menu > Export XML). The options given are kept as the document\'s XML export settings',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the XML file to write' },
                fromElement: { ...ELEMENT_SCHEMA, description: `Export only this element and its children. ${ELEMENT_SCHEMA.description}` },
                fromSelection: { type: 'boolean', description: 'Export from the element selected in the Structure pane (Export From Selected Element)' },
                includeDtd: { type: 'boolean', description: 'Include DTD Declaration' },
                viewAfterExport: { type: 'boolean', description: 'Open the exported file afterwards (View XML Using)' },
                viewer: { type: 'string', description: 'Path of the application to view the XML with (View XML Using); must be inside the allowed directories' },
                untaggedTables: { type: 'string', enum: ['cals', 'none'], description: 'Export Untagged Tables as CALS XML (cals) or not (none)' },
                remapCharacters: { type: 'boolean', description: 'Remap Break, Whitespace, and Special Characters as character references' },
                xslt: XSLT_SCHEMA('export'),
                encoding: { type: 'string', enum: ['UTF8', 'UTF16', 'SHIFT_JIS'], description: 'File encoding' },
                ruby: { type: 'boolean', description: 'Export ruby annotations' },
                images: {
                    type: 'object',
                    description: 'Image options (XML Export Options > Images)',
                    properties: Object.fromEntries(Object.entries(IMAGE_OPTIONS).map(([k, o]) => [k, o.kind === 'bool'
                        ? { type: 'boolean', description: o.description }
                        : { type: 'string', enum: o.values, description: o.description }])),
                },
            },
            required: ['filePath'],
        },
        features: [
            'indesign.xml.export_xml',
            'indesign.xml.structure_menu_export_xml',
            'indesign.xml.xml_export_include_dtd_declaration',
            'indesign.xml.xml_export_view_xml_using',
            'indesign.xml.xml_export_export_from_selected_element',
            'indesign.xml.xml_export_export_untagged_tables_as_cals_xml',
            'indesign.xml.xml_export_remap_break_whitespace_and_special_characters',
            'indesign.xml.xml_export_apply_xslt_export',
            'indesign.xml.xml_export_encoding',
            'indesign.xml.xml_export_ruby_xml',
            'indesign.xml.xml_export_image_options',
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: {
            filePath: `${process.env.HOME ?? '/tmp'}/Documents/out.xml`, fromElement: undefined, fromSelection: true, viewer: undefined,
            xslt: { useStylesheetInXml: true }, images: { original: true, conversion: 'JPEG', jpegQuality: 'HIGH' },
        },
        handler: (a) => {
            checkKeys(a, ['filePath', 'fromElement', 'fromSelection', 'includeDtd', 'viewAfterExport', 'viewer', 'untaggedTables', 'remapCharacters', 'xslt', 'encoding', 'ruby', 'images'], '');
            const p = filePath(a.filePath, 'filePath');
            if (a.fromElement !== undefined && a.fromSelection === true) throw new Error('Give fromElement or fromSelection, not both');
            const lines = ['var p = doc.xmlExportPreferences;'];
            if (a.includeDtd !== undefined) lines.push(`p.excludeDtd = ${bool(!(flag(a.includeDtd, 'includeDtd') === 'true'))};`);
            if (a.viewAfterExport !== undefined) lines.push(`p.viewAfterExport = ${flag(a.viewAfterExport, 'viewAfterExport')};`);
            if (a.viewer !== undefined) lines.push(`p.preferredBrowser = File(${filePath(a.viewer, 'viewer')});`);
            if (a.untaggedTables !== undefined) lines.push(`p.exportUntaggedTablesFormat = XMLExportUntaggedTablesFormat.${enumOf(a.untaggedTables, ['cals', 'none'], { name: 'untaggedTables' }).toUpperCase()};`);
            if (a.remapCharacters !== undefined) lines.push(`p.characterReferences = ${flag(a.remapCharacters, 'remapCharacters')};`);
            if (a.xslt !== undefined) lines.push(...xsltStatements(a.xslt, 'export'));
            if (a.encoding !== undefined) lines.push(`p.fileEncoding = XMLFileEncoding.${enumOf(a.encoding, ['UTF8', 'UTF16', 'SHIFT_JIS'], { name: 'encoding' })};`);
            if (a.ruby !== undefined) lines.push(`p.ruby = ${flag(a.ruby, 'ruby')};`);
            if (a.images !== undefined) {
                const im = object(a.images, 'images');
                checkKeys(im, Object.keys(IMAGE_OPTIONS), 'images');
                for (const [k, o] of Object.entries(IMAGE_OPTIONS)) {
                    if (im[k] === undefined) continue;
                    lines.push(`p.${o.prop} = ${o.kind === 'bool' ? flag(im[k], `images.${k}`) : `${o.type}.${enumOf(im[k], o.values, { name: `images.${k}` })}`};`);
                }
            }
            const fromSel = a.fromSelection === undefined ? 'false' : flag(a.fromSelection, 'fromSelection');
            const exportLine = a.fromElement !== undefined
                ? `var el = ${elementRef(a.fromElement, 'fromElement')};\n  el.exportFile(ExportFormat.XML, f, false);\n  from = __xmlInfo(el);`
                : `p.exportFromSelected = ${fromSel};\n  doc.exportFile(ExportFormat.XML, f, false);`;
            return run('Export XML', xmlScript(`var f = File(${p});
if (!f.parent.exists) throw new Error("Folder does not exist: " + f.parent.fsName);
${lines.join('\n')}
var oldSel = p.exportFromSelected, from = ${fromSel === 'true' ? '"selection"' : '"root"'};
try {
  ${exportLine}
} finally {
  p.exportFromSelected = oldSel;
}
__result__ = { exported: f.fsName, from: from, settings: ${EXPORT_READ} };`));
        },
    },
    {
        name: 'manage_xml_dtd',
        description: 'Load a DTD for validating the XML structure (Structure pane menu > Load DTD), view it (View DTD), set its root element (DTD Options), or delete it (Delete DTD)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['load', 'view', 'set_root', 'delete'], description: 'What to do' },
                filePath: { type: 'string', description: 'load: absolute path of the DTD file' },
                rootTag: { type: 'string', description: 'load or set_root: the tag of the root element' },
                maxLength: { type: 'integer', minimum: 0, maximum: 1000000, default: 20000, description: 'view: return at most this many characters of the DTD' },
            },
            required: ['action'],
        },
        features: [
            'indesign.xml.structure_menu_load_dtd',
            'indesign.xml.structure_menu_view_dtd',
            'indesign.xml.structure_menu_delete_dtd',
            'indesign.xml.structure_dtd_options',
            'indesign.xml.dtd',
        ],
        hints: { readOnly: false, destructive: true },
        auditArgs: { action: 'load', rootTag: 'book', maxLength: undefined },
        handler: (a) => {
            checkKeys(a, ['action', 'filePath', 'rootTag', 'maxLength'], '');
            const action = enumOf(a.action, ['load', 'view', 'set_root', 'delete'], { name: 'action' });
            if (action !== 'load' && a.filePath !== undefined) throw new Error("'filePath' applies to action load");
            if (!['load', 'set_root'].includes(action) && a.rootTag !== undefined) throw new Error("'rootTag' applies to load and set_root");
            if (action !== 'view' && a.maxLength !== undefined) throw new Error("'maxLength' applies to action view");
            const info = 'function __dtd(d, max) { var c = String(d.contents); return { rootTag: d.rootTag && d.rootTag.isValid ? d.rootTag.name : null, publicId: d.publicId, systemId: d.systemId, length: c.length, contents: max ? c.substring(0, max) : undefined }; }';
            const need = 'if (!doc.dtds.length) throw new Error("The document has no DTD");\nvar d = doc.dtds.item(0);';
            const setRoot = (tag) => `var rt = doc.xmlTags.itemByName(${xmlName(tag, 'rootTag')});
if (!rt.isValid) throw new Error("No tag named " + ${str(tag)} + "; the DTD's elements are loaded as tags");
d.rootTag = rt;`;
            let body;
            if (action === 'load') {
                body = `var f = File(${filePath(a.filePath, 'filePath')});
if (!f.exists) throw new Error("No file at " + f.fsName);
doc.importDtd(f);
${need}
${a.rootTag !== undefined ? setRoot(a.rootTag) : ''}
__result__ = { loaded: f.fsName, dtd: __dtd(d, 0) };`;
            } else if (action === 'view') {
                const max = index(a.maxLength ?? 20000, { name: 'maxLength', max: 1000000 });
                body = `__result__ = doc.dtds.length ? { dtd: __dtd(doc.dtds.item(0), ${max}) } : { dtd: null };`;
            } else if (action === 'set_root') {
                if (a.rootTag === undefined) throw new Error("Give 'rootTag'");
                body = `${need}\n${setRoot(a.rootTag)}\n__result__ = { dtd: __dtd(d, 0) };`;
            } else {
                body = `${need}\nd.remove();\n__result__ = { deleted: true };`;
            }
            return run('Manage XML DTD', xmlScript(`${info}\n${body}`));
        },
    },
    {
        name: 'validate_xml_structure',
        description: 'Validate the XML structure against the loaded DTD from the root element or from a chosen or selected element (Structure pane menu > Validate from Root Element / Validate from Selected Element), and list the errors (View List of Errors)',
        inputSchema: {
            type: 'object',
            properties: {
                from: { ...ELEMENT_SCHEMA, description: `Validate from this element (default: the root). ${ELEMENT_SCHEMA.description}` },
                maxErrors: { type: 'integer', minimum: 1, maximum: 1000, default: 50, description: 'Stop after this many errors' },
            },
        },
        features: [
            'indesign.xml.structure_menu_validate_from_root_element',
            'indesign.xml.structure_menu_validate_from_selected_element',
            'indesign.xml.structure_view_errors',
            'indesign.xml.dtd',
        ],
        hints: { readOnly: true, idempotent: true },
        auditArgs: { from: { selection: true } },
        handler: (a) => {
            checkKeys(a, ['from', 'maxErrors'], '');
            const from = a.from === undefined ? '__xmlRoot(doc)' : elementRef(a.from, 'from');
            const max = index(a.maxErrors ?? 50, { name: 'maxErrors', max: 1000 });
            if (Number(max) < 1) throw new Error("'maxErrors' must be at least 1");
            return run('Validate XML structure', xmlScript(`
if (!doc.dtds.length) throw new Error("Load a DTD first (manage_xml_dtd action load)");
var el = ${from};
var errs = el.validate(${max}) || [], out = [];
for (var i = 0; i < errs.length; i++) {
  var e = errs[i], row = { message: e.errorMessage, attribute: e.attributeName || null };
  try { row.elementId = e.element.id; row.tag = e.element.markupTag.name; } catch (x) {}
  out.push(row);
}
__result__ = { valid: out.length === 0, from: __xmlInfo(el), errors: out };`));
        },
    },
];
