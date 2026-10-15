/**
 * Frames and objects tools: the object-model statements their scripts carry,
 * and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const T = { ids: [5] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const h = (name) => tool(name).handler;

await test('draw_shape draws placeholder frames, polygons and lines', async () => {
    const r = await one('draw_shape', { pageIndex: 1, shape: 'rectangle', x: 10, y: 20, width: 50, height: 30, name: 'Photo' });
    assert.match(r, /var it = pg\.rectangles\.add\(\);/);
    assert.match(r, /it\.geometricBounds = \[o\[1\], o\[0\], o\[1\] \+ 30, o\[0\] \+ 50\];/);
    assert.match(r, /it\.contentType = ContentType\.GRAPHIC_TYPE;/);
    assert.match(r, /it\.name = "Photo";/);
    const t = await one('draw_shape', { pageIndex: 0, shape: 'rectangle', x: 0, y: 0, width: 5, height: 5, content: 'text' });
    assert.match(t, /pg\.textFrames\.add\(\)/);
    assert.doesNotMatch(t, /contentType/);
    const p = await one('draw_shape', { pageIndex: 0, shape: 'polygon', x: 0, y: 0, width: 5, height: 5, sides: 6, starInset: 40, content: 'unassigned' });
    assert.match(p, /pg\.polygons\.add\(doc\.activeLayer, 6, 40\);/);
    assert.match(p, /ContentType\.UNASSIGNED/);
    const d = await one('draw_shape', { pageIndex: 0, shape: 'polygon', x: 0, y: 0, width: 5, height: 5 });
    assert.match(d, /app\.polygonPreferences\.numberOfSides, app\.polygonPreferences\.insetPercentage/);
    const e = await one('draw_shape', { pageIndex: 0, shape: 'ellipse', x: 0, y: 0, width: 5, height: 5 });
    assert.match(e, /pg\.ovals\.add\(\)/);
    const l = await one('draw_shape', { pageIndex: 0, shape: 'line', from: [0, 0], to: [100, 50] });
    assert.match(l, /pg\.graphicLines\.add\(\);/);
    assert.match(l, /it\.paths\[0\]\.entirePath = \[__toPage\(pg, 0, 0\), __toPage\(pg, 100, 50\)\];/);
});

await test('draw_shape refuses bad arguments', () => {
    const d = h('draw_shape');
    assert.throws(() => d({ pageIndex: 0, shape: 'star', x: 0, y: 0, width: 1, height: 1 }), /Allowed: rectangle/);
    assert.throws(() => d({ pageIndex: 0, shape: 'line', from: [0, 0] }), /'to' must be \[x, y\]/);
    assert.throws(() => d({ pageIndex: 0, shape: 'line', from: [0, 0], to: [1, 1], width: 3 }), /does not apply to a line/);
    assert.throws(() => d({ pageIndex: 0, shape: 'rectangle', x: 0, y: 0, width: 0, height: 1 }), /out of range/);
    assert.throws(() => d({ pageIndex: 0, shape: 'ellipse', x: 0, y: 0, width: 1, height: 1, sides: 5 }), /apply to polygons/);
    assert.throws(() => d({ pageIndex: 0, shape: 'polygon', x: 0, y: 0, width: 1, height: 1, sides: 2 }), /3 to 100/);
    assert.throws(() => d({ pageIndex: 0, shape: 'rectangle', x: 0, y: 0, width: 1, height: 1, content: 'image' }), /Allowed: graphic/);
    assert.throws(() => d({ pageIndex: -1, shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }), /pageIndex/);
});

await test('set_item_stroke writes every Stroke panel option', async () => {
    const s = await one('set_item_stroke', {
        target: T, weight: 2, type: 'Dashed', color: '#ff0000', tint: 50, cap: 'round', join: 'bevel', miterLimit: 6,
        align: 'inside', start: 'triangle', end: 'circle_solid', startScale: 150, endScale: 80, arrowAlignment: 'outside',
        gapColor: 'Paper', gapTint: 40, cornerAdjustment: 'dashes_and_gaps', dashAndGap: [6, 2, 1, 2],
    });
    assert.match(s, /it\.strokeWeight = "2pt";/);
    assert.match(s, /var __st = doc\.strokeStyles\.itemByName\("Dashed"\);/);
    assert.match(s, /it\.strokeType = __st;/);
    assert.match(s, /it\.strokeColor = __c0;/);
    assert.match(s, /it\.strokeTint = 50;/);
    assert.match(s, /it\.endCap = EndCap\.ROUND_END_CAP;/);
    assert.match(s, /it\.endJoin = EndJoin\.BEVEL_END_JOIN;/);
    assert.match(s, /it\.miterLimit = 6;/);
    assert.match(s, /it\.strokeAlignment = StrokeAlignment\.INSIDE_ALIGNMENT;/);
    assert.match(s, /it\.leftLineEnd = ArrowHead\.TRIANGLE_ARROW_HEAD;/);
    assert.match(s, /it\.rightLineEnd = ArrowHead\.CIRCLE_SOLID_ARROW_HEAD;/);
    assert.match(s, /it\.leftArrowHeadScale = 150;/);
    assert.match(s, /it\.rightArrowHeadScale = 80;/);
    assert.match(s, /it\.arrowHeadAlignment = ArrowHeadAlignmentEnum\.OUTSIDE_PATH;/);
    assert.match(s, /it\.gapColor = __c1;/);
    assert.match(s, /it\.gapTint = 40;/);
    assert.match(s, /it\.strokeCornerAdjustment = StrokeCornerAdjustment\.DASHES_AND_GAPS;/);
    assert.match(s, /it\.strokeDashAndGap = \["6pt", "2pt", "1pt", "2pt"\];/);
});

await test('set_item_stroke refuses bad arguments', () => {
    const s = h('set_item_stroke');
    assert.throws(() => s({ target: T }), /Nothing to set/);
    assert.throws(() => s({ target: {}, weight: 1 }), /Choose the items/);
    assert.throws(() => s({ target: T, weight: -1 }), /out of range/);
    assert.throws(() => s({ target: T, cap: 'square' }), /Allowed: butt, round, projecting/);
    assert.throws(() => s({ target: T, start: 'arrow' }), /Allowed: none, simple/);
    assert.throws(() => s({ target: T, dashAndGap: [1, 2, 3] }), /2, 4 or 6/);
    assert.throws(() => s({ target: T, type: ' ' }), /'type' is empty/);
    assert.throws(() => s({ target: T, miterLimit: 0 }), /out of range/);
});

await test('manage_stroke_styles creates, deletes, saves and loads styles', async () => {
    const [c, d, x, i, l] = await scriptsFor([
        ['manage_stroke_styles', { action: 'create', kind: 'dashed', name: 'Long', pattern: [6, 2], cap: 'round', cornerAdjustment: 'gaps' }],
        ['manage_stroke_styles', { action: 'delete', name: 'Long' }],
        ['manage_stroke_styles', { action: 'export', path: `${home}/Documents/strokes.inst` }],
        ['manage_stroke_styles', { action: 'import', path: `${home}/Documents/strokes.inst` }],
        ['manage_stroke_styles', { action: 'list' }],
    ]);
    assert.match(c, /doc\.dashedStrokeStyles\.add\(\{ name: "Long", dashArray: \["6pt", "2pt"\], endCap: EndCap\.ROUND_END_CAP, strokeCornerAdjustment: StrokeCornerAdjustment\.GAPS \}\)/);
    assert.match(d, /s\.remove\(r\);/);
    assert.match(d, /itemByName\("Solid"\)/);
    assert.match(x, /doc\.exportStrokeStyles\(new File\(".*strokes\.inst"\), list, ""\);/);
    assert.match(x, /__customStrokeStyles\(doc\)/);
    assert.match(i, /doc\.importStyles\(ImportFormat\.STROKE_STYLES_FORMAT, f\);/);
    assert.match(l, /strokeStyleType/);
    const dot = await one('manage_stroke_styles', { action: 'create', kind: 'dotted', name: 'Dots', pattern: [0, 3] });
    assert.match(dot, /dottedStrokeStyles\.add\(\{ name: "Dots", dotArray: \["0pt", "3pt"\] \}\)/);
    const str = await one('manage_stroke_styles', { action: 'create', kind: 'striped', name: 'Rails', pattern: [0, 30, 70, 100] });
    assert.match(str, /stripedStrokeStyles\.add\(\{ name: "Rails", stripeArray: \[0, 30, 70, 100\] \}\)/);
});

await test('manage_stroke_styles refuses bad arguments', () => {
    const m = h('manage_stroke_styles');
    assert.throws(() => m({ action: 'edit' }), /Allowed: list/);
    assert.throws(() => m({ action: 'create', kind: 'wavy', name: 'W', pattern: [1, 1] }), /Allowed: dashed/);
    assert.throws(() => m({ action: 'create', kind: 'dashed', name: 'D', pattern: [1] }), /in pairs/);
    assert.throws(() => m({ action: 'create', kind: 'striped', name: 'S', pattern: [0, 120] }), /out of range/);
    assert.throws(() => m({ action: 'create', kind: 'dotted', name: 'D', pattern: [1], cap: 'round' }), /'cap' applies to dashed/);
    assert.throws(() => m({ action: 'list', path: 'x.inst' }), /does not apply to action 'list'/);
    assert.throws(() => m({ action: 'export', path: `${home}/Documents/strokes.txt` }), /must end in \.inst/);
    assert.throws(() => m({ action: 'import', path: '/etc/strokes.inst' }), /outside the allowed directories|Access denied/);
});

await test('set_frame_content_type, arrange_objects and reveal_spread_items', async () => {
    const [a, b, c, d] = await scriptsFor([
        ['set_frame_content_type', { target: T, contentType: 'text' }],
        ['arrange_objects', { target: T, order: 'bring_forward' }],
        ['reveal_spread_items', { spreadIndex: 2, show: false }],
        ['reveal_spread_items', {}],
    ]);
    assert.match(a, /it\.contentType = ContentType\.TEXT_TYPE;/);
    assert.match(a, /it = __reresolve\(doc, oid, it\);/);
    assert.match(b, /items\[i\]\.bringForward\(\);/);
    assert.match(c, /var sp = doc\.spreads\[si\];/);
    assert.match(c, /it\.locked = false;/);
    assert.doesNotMatch(c, /it\.visible = true/);
    assert.match(d, /app\.activeWindow\.activeSpread/);
    assert.match(d, /it\.visible = true;/);
    assert.throws(() => h('set_frame_content_type')({ target: T }), /Allowed: graphic/);
    assert.throws(() => h('set_frame_content_type')({ target: {}, contentType: 'text' }), /Choose the items/);
    assert.throws(() => h('arrange_objects')({ target: T, order: 'to_top' }), /Allowed: bring_to_front/);
    assert.throws(() => h('reveal_spread_items')({ unlock: false, show: false }), /Nothing to do/);
    assert.throws(() => h('reveal_spread_items')({ unlock: 'no' }), /true or false/);
});

await test('set_object_preferences sets polygon settings and locked-object selection', async () => {
    const s = await one('set_object_preferences', { polygonSides: 8, starInset: 25, preventSelectingLocked: true });
    assert.match(s, /app\.polygonPreferences\.numberOfSides = 8;/);
    assert.match(s, /app\.polygonPreferences\.insetPercentage = 25;/);
    assert.match(s, /app\.generalPreferences\.preventSelectingLockedItems = true;/);
    assert.doesNotMatch(s, /var doc = __doc\(\);/);
    assert.throws(() => h('set_object_preferences')({ polygonSides: 2 }), /3 to 100/);
    assert.throws(() => h('set_object_preferences')({ starInset: 101 }), /out of range/);
});

await test('set_frame_fitting sets, clears and applies fitting', async () => {
    const s = await one('set_frame_fitting', {
        target: T, clear: true, fitting: 'fill_proportionally', referencePoint: 'center', autoFit: true,
        crop: { top: 2, left: -1 }, fitNow: 'content_aware',
    });
    assert.match(s, /it\.clearFrameFittingOptions\(\);/);
    assert.match(s, /ff\.fittingOnEmptyFrame = EmptyFrameFittingOptions\.FILL_PROPORTIONALLY;/);
    assert.match(s, /ff\.fittingAlignment = AnchorPoint\.CENTER_ANCHOR;/);
    assert.match(s, /ff\.autoFit = true;/);
    assert.match(s, /ff\.topCrop = 2;/);
    assert.match(s, /ff\.leftCrop = -1;/);
    assert.match(s, /it\.fit\(FitOptions\.CONTENT_AWARE_FIT\);/);
    assert.ok(s.indexOf('clearFrameFittingOptions') < s.indexOf('fittingOnEmptyFrame ='), 'clearing comes first');
    const f = h('set_frame_fitting');
    assert.throws(() => f({ target: T }), /Nothing to do/);
    assert.throws(() => f({ target: T, crop: { middle: 1 } }), /Unknown option 'crop\.middle'/);
    assert.throws(() => f({ target: T, fitNow: 'stretch' }), /Allowed: content_aware/);
});

await test('get_object_options reads the chosen sections', async () => {
    const s = await one('get_object_options', { target: T, include: ['stroke', 'anchored'] });
    assert.match(s, /MeasurementUnits\.POINTS/);
    assert.match(s, /s\.weight = it\.strokeWeight;/);
    assert.match(s, /r\.anchored = __isAnchored\(it\) \? __anchoredInfo\(it\) : null;/);
    assert.doesNotMatch(s, /frameFittingOptions/);
    assert.throws(() => h('get_object_options')({ target: T, include: ['effects'] }), /Allowed: stroke/);
    assert.throws(() => h('get_object_options')({ target: T, include: [] }), /non-empty list/);
});

await test('anchored object tools insert, set, transform, release and set defaults', async () => {
    const [ins, ex, set, rel, def] = await scriptsFor([
        ['insert_anchored_object', { at: { storyId: 3, characterIndex: 10 }, create: { shape: 'text_frame', width: 30 }, options: { position: 'above_line', horizontalAlignment: 'right', spaceAbove: 3 } }],
        ['insert_anchored_object', { at: { selection: true }, itemId: 44, options: { position: 'custom', verticalReferencePoint: 'page_edge' } }],
        ['set_anchored_object_options', { target: T, options: { anchorPoint: 'bottom_right', pinPosition: false, yOffset: -2 }, transform: { rotationAngle: 30, horizontalScale: 120 } }],
        ['set_anchored_object_options', { target: T, release: true }],
        ['set_anchored_object_defaults', { content: 'graphic', objectStyle: 'Fig', paragraphStyle: 'Caption', width: 40, height: 30 }],
    ]);
    assert.match(ins, /var it = ip\.textFrames\.add\(\);/);
    assert.match(ins, /g\[0\] \+ \(doc\.anchoredObjectDefaults\.initialAnchorHeight\), g\[1\] \+ \(30\)/);
    assert.match(ins, /s\.anchoredPosition = AnchorPosition\.ABOVE_LINE;/);
    assert.match(ins, /s\.horizontalAlignment = HorizontalAlignment\.RIGHT_ALIGN;/);
    assert.match(ins, /s\.anchorSpaceAbove = 3;/);
    assert.match(ex, /it\.anchoredObjectSettings\.insertAnchoredObject\(ip, AnchorPosition\.ANCHORED\);/);
    assert.match(ex, /s\.verticalReferencePoint = VerticallyRelativeTo\.PAGE_EDGE;/);
    assert.match(set, /s\.anchorPoint = AnchorPoint\.BOTTOM_RIGHT_ANCHOR;/);
    assert.match(set, /s\.pinPosition = false;/);
    assert.match(set, /s\.anchorYoffset = -2;/);
    assert.match(set, /it\.rotationAngle = 30;/);
    assert.match(set, /it\.horizontalScale = 120;/);
    assert.match(set, /is not an anchored object/);
    assert.match(rel, /s\.releaseAnchoredObject\(\);/);
    assert.match(def, /d\.anchorContent = ContentType\.GRAPHIC_TYPE;/);
    assert.match(def, /d\.anchoredObjectStyle = os;/);
    assert.match(def, /d\.anchoredParagraphStyle = ps;/);
    assert.match(def, /d\.initialAnchorWidth = 40;/);
    assert.match(def, /d\.initialAnchorHeight = 30;/);
});

await test('anchored object tools refuse bad arguments', () => {
    const ins = h('insert_anchored_object');
    assert.throws(() => ins({ at: { storyId: 1 } }), /Give itemId .* or create/);
    assert.throws(() => ins({ at: { storyId: 1 }, itemId: 3, create: { shape: 'rectangle' } }), /not both/);
    assert.throws(() => ins({ at: {}, itemId: 3 }), /give one of frameId, storyId/);
    assert.throws(() => ins({ at: { storyId: 1 }, create: { shape: 'star' } }), /Allowed: rectangle/);
    assert.throws(() => ins({ at: { storyId: 1 }, create: {} }), /Allowed: rectangle/);
    assert.throws(() => ins({ at: { storyId: 1 }, itemId: 3, options: { position: 'floating' } }), /Allowed: inline/);
    assert.throws(() => ins({ at: { storyId: 1 }, itemId: 3, options: { offset: 2 } }), /Unknown option 'options\.offset'/);
    const set = h('set_anchored_object_options');
    assert.throws(() => set({ target: T }), /Nothing to do/);
    assert.throws(() => set({ target: T, transform: { rotationAngle: 400 } }), /out of range/);
    assert.throws(() => set({ target: T, options: { lockPosition: 'yes' } }), /true or false/);
    assert.throws(() => h('set_anchored_object_defaults')({ content: 'movie' }), /Allowed: graphic/);
});

await test('manage_object_library lists, closes, views and sorts', async () => {
    const [l, cl, v, s] = await scriptsFor([
        ['manage_object_library', { action: 'list', library: 'parts.indl', filter: { name: 'Logo', type: 'image' } }],
        ['manage_object_library', { action: 'close' }],
        ['manage_object_library', { action: 'view', view: 'list' }],
        ['manage_object_library', { action: 'sort', sort: 'newest' }],
    ]);
    assert.match(l, /__lib\("parts\.indl"\)/);
    assert.match(l, /indexOf\("logo"\) < 0/);
    assert.match(l, /x\.assetType != AssetType\.IMAGE_TYPE/);
    assert.match(cl, /__lib_\.close\(\);/);
    assert.match(v, /app\.menuActions\.itemByID\(34314\)/);
    assert.match(v, /ma\.invoke\(\);/);
    assert.match(s, /app\.menuActions\.itemByID\(34316\)/);
    const m = h('manage_object_library');
    assert.throws(() => m({ action: 'open' }), /Allowed: list, close, view, sort/);
    assert.throws(() => m({ action: 'view', view: 'grid' }), /Allowed: thumbnails/);
    assert.throws(() => m({ action: 'close', view: 'list' }), /does not apply to action 'close'/);
    assert.throws(() => m({ action: 'list', filter: { size: 2 } }), /Unknown option 'filter\.size'/);
});

await test('manage_library_items adds, places, updates, edits and deletes items', async () => {
    const [add, page, pageSep, place, upd, info, del] = await scriptsFor([
        ['manage_library_items', { action: 'add', target: T, name: 'Logo', description: 'Main logo', type: 'geometry' }],
        ['manage_library_items', { action: 'add_page', pageIndex: 2, name: 'Page 3' }],
        ['manage_library_items', { action: 'add_page', pageIndex: 2, separately: true }],
        ['manage_library_items', { action: 'place', items: { names: ['Logo'] } }],
        ['manage_library_items', { action: 'update', target: T, items: { ids: [9] } }],
        ['manage_library_items', { action: 'info', items: { ids: [9] }, name: 'Logo 2', type: 'text' }],
        ['manage_library_items', { action: 'delete', items: { ids: [9, 10] } }],
    ]);
    assert.match(add, /__lib_\.store\(items, \{ name: "Logo", description: "Main logo", assetType: AssetType\.GEOMETRY_TYPE \}\)/);
    assert.match(page, /__lib_\.store\(all, \{ name: "Page 3", assetType: AssetType\.PAGE_TYPE \}\)/);
    assert.match(pageSep, /__lib_\.store\(\[all\[i\]\], \{\}\)/);
    assert.match(place, /list\[i\]\.placeAsset\(doc\);/);
    assert.match(upd, /list\[0\]\.select\(SelectionOptions\.REPLACE_WITH\);/);
    assert.match(upd, /app\.menuActions\.itemByID\(34410\)/);
    assert.match(info, /list\[i\]\.name = "Logo 2";/);
    assert.match(info, /list\[i\]\.assetType = AssetType\.TEXT_TYPE;/);
    assert.match(del, /list\[i\]\.remove\(\);/);
    const m = h('manage_library_items');
    assert.throws(() => m({ action: 'place' }), /Choose the library items/);
    assert.throws(() => m({ action: 'add_page' }), /'pageIndex' is required/);
    assert.throws(() => m({ action: 'add_page', pageIndex: 0, separately: true, name: 'X' }), /stored as one item/);
    assert.throws(() => m({ action: 'info', items: { ids: [1] } }), /Nothing to set/);
    assert.throws(() => m({ action: 'delete', items: { ids: [1] }, target: T }), /does not apply to action 'delete'/);
    assert.throws(() => m({ action: 'add', target: T, type: 'video' }), /Allowed: eps/);
});

await test('create_qr_code generates and edits each kind of code', async () => {
    const [u, e, s, v] = await scriptsFor([
        ['create_qr_code', { type: 'url', data: { url: 'https://example.com' }, pageIndex: 0, x: 10, y: 10, size: 25 }],
        ['create_qr_code', { type: 'email', data: { address: 'a@example.com', subject: 'Hi' }, frameId: 12, color: '#000080' }],
        ['create_qr_code', { type: 'sms', data: { number: '555', message: 'Yes' }, frameId: 12 }],
        ['create_qr_code', { type: 'vcard', data: { firstName: 'Ada', city: 'London' }, frameId: 12 }],
    ]);
    assert.match(u, /f\.createHyperlinkQRCode\("https:\/\/example\.com", sw\);/);
    assert.match(u, /o\[1\] \+ 25, o\[0\] \+ 25/);
    assert.match(e, /f\.createEmailQRCode\("a@example\.com", "Hi", "", sw\);/);
    assert.match(e, /var f = __item\(doc, 12\);/);
    assert.match(s, /f\.createTextMsgQRCode\("555", "Yes", sw\);/);
    assert.match(v, /f\.createVCardQRCode\("Ada", "", "", "", "", "", "", "", "London", "", "", "", "", sw\);/);
    const q = h('create_qr_code');
    assert.throws(() => q({ type: 'url', data: {}, frameId: 1 }), /'data\.url' is required/);
    assert.throws(() => q({ type: 'url', data: { url: 'x', subject: 'y' }, frameId: 1 }), /does not apply to a url QR code/);
    assert.throws(() => q({ type: 'url', data: { url: 'x' } }), /Give frameId, or pageIndex, x and y/);
    assert.throws(() => q({ type: 'url', data: { url: 'x' }, frameId: 1, size: 20 }), /not with frameId/);
    assert.throws(() => q({ type: 'vcard', data: {}, frameId: 1 }), /at least one/);
    assert.throws(() => q({ type: 'barcode', data: {}, frameId: 1 }), /Allowed: url/);
});

await test('manage_math_objects adds, lists, edits and sets defaults', async () => {
    const ml = '<math><mi>a</mi></math>';
    const [add, list, edit, set] = await scriptsFor([
        ['manage_math_objects', { action: 'add', mathml: ml, pageIndex: 1, x: 5, y: 6, fontSize: 14, color: 'Black' }],
        ['manage_math_objects', { action: 'list' }],
        ['manage_math_objects', { action: 'edit', id: 77, mathml: ml }],
        ['manage_math_objects', { action: 'settings', fontSize: 11, exportAsMathML: true }],
    ]);
    assert.match(add, /__maths\(doc\)\.add\("<math><mi>a<\/mi><\/math>", pg, doc\.activeLayer, __toPage\(pg, 5, 6\)\);/);
    assert.match(add, /m\.appliedMathMLFontSize = 14;/);
    assert.match(add, /m\.appliedMathMLSwatch = __mc;/);
    assert.match(list, /out\.push\(__mathInfo\(ms\[i\]\)\)/);
    assert.match(edit, /itemByID\(77\)/);
    assert.match(edit, /m\.mathmlDescription = "<math><mi>a<\/mi><\/math>";/);
    assert.match(set, /doc\.appliedMathMLFontSize = 11;/);
    assert.match(set, /doc\.preferMathMLInEpubExport = true;/);
    const m = h('manage_math_objects');
    assert.throws(() => m({ action: 'add', mathml: '\\frac{a}{b}' }), /MathML <math> element/);
    assert.throws(() => m({ action: 'edit', mathml: ml }), /'id' is required/);
    assert.throws(() => m({ action: 'edit', id: 1 }), /Nothing to change/);
    assert.throws(() => m({ action: 'list', id: 1 }), /does not apply to action 'list'/);
    assert.throws(() => m({ action: 'settings', fontSize: 0 }), /out of range/);
});

done();
