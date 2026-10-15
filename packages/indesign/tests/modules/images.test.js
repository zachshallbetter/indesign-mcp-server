/**
 * Images and links tools: the object-model statements their scripts carry,
 * and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const T = { ids: [5] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const f = (n) => `${home}/${n}`;

await test('list_document_links reads every link by default, with XMP when asked', async () => {
    const s = await one('list_document_links', { includeXmp: true, xmpProperties: [{ namespace: 'http://ns.adobe.com/photoshop/1.0/', path: 'City' }] });
    assert.match(s, /__links\(doc, \[\], \[\], \[\], \[\], false, true\)/);
    assert.match(s, /__linkInfo\(links\[i\], true, \[\["http:\/\/ns\.adobe\.com\/photoshop\/1\.0\/", "City"\]\]\)/);
    assert.match(s, /var x = l\.linkXmp;/);
    assert.match(s, /r\.platformPath = File\(l\.filePath\)\.fsName;/);
    assert.match(s, /r\.uri = l\.linkResourceURI;/);
    const m = await one('list_document_links', { links: { status: ['missing', 'out_of_date'] } });
    assert.match(m, /\[LinkStatus\.LINK_MISSING, LinkStatus\.LINK_OUT_OF_DATE\], false, true\)/);
    assert.match(m, /__linkInfo\(links\[i\], false, \[\]\)/);
});

await test('list_document_links refuses bad link choices', () => {
    const list = tool('list_document_links').handler;
    assert.throws(() => list({ links: { status: ['broken'] } }), /Allowed: normal/);
    assert.throws(() => list({ links: { ids: [-1] } }), /Invalid index/);
    assert.throws(() => list({ links: { file: 'a' } }), /Unknown option 'links\.file'/);
    assert.throws(() => list({ xmpProperties: [{ namespace: 'n' }] }), /must be a string/);
});

await test('relink_document_links builds each mode', async () => {
    const file = await one('relink_document_links', { links: { ids: [7] }, mode: 'file', filePath: f('new.psd') });
    assert.match(file, /var target = File\(".*new\.psd"\);/);
    assert.match(file, /takes exactly one link/);
    assert.match(file, /l\.relink\(to\);/);
    const url = await one('relink_document_links', { links: { ids: [7] }, mode: 'url', url: 'https://example.com/a.jpg' });
    assert.match(url, /l\.reinitLink\("https:\/\/example\.com\/a\.jpg"\);/);
    const folder = await one('relink_document_links', { links: { names: ['a.tif'] }, mode: 'folder', folder: f('images'), extension: '.psd', searchSubfolders: true });
    assert.match(folder, /to = __find\(dir, __withExt\(lname, "psd"\), true\);/);
    const ext = await one('relink_document_links', { links: { all: true }, mode: 'extension', extension: 'tif' });
    assert.match(ext, /__withExt\(orig\.name, "tif"\)/);
    const copy = await one('relink_document_links', { links: { selection: true }, mode: 'copy_to_folder', folder: f('out') });
    assert.match(copy, /l\.copyLink\(dest, "", false\);/);
    assert.match(copy, /dir\.create\(\)/);
});

await test('relink_document_links refuses bad arguments', () => {
    const rl = tool('relink_document_links').handler;
    assert.throws(() => rl({ mode: 'file', filePath: f('a.psd') }), /Choose the links/);
    assert.throws(() => rl({ links: T, mode: 'move' }), /Allowed: file/);
    assert.throws(() => rl({ links: T, mode: 'file' }), /'filePath' is required/);
    assert.throws(() => rl({ links: T, mode: 'url', url: 'ftp://x/y' }), /http or https URL/);
    assert.throws(() => rl({ links: T, mode: 'url', url: 'https://x/"y' }), /http or https URL/);
    assert.throws(() => rl({ links: T, mode: 'extension', extension: 'p s d' }), /file extension/);
    assert.throws(() => rl({ links: T, mode: 'extension', folder: f('x'), extension: 'psd' }), /'folder' does not apply to mode extension/);
    assert.throws(() => rl({ links: T, mode: 'folder', folder: '/etc' }), /Access denied|outside|forbidden|denied/i);
});

await test('run_document_link_action maps each action to the Link object model', async () => {
    const L = { links: { ids: [3] } };
    const cases = {
        update: /l\.update\(\);/, embed: /l\.unlink\(\);/, edit_original: /l\.editOriginal\(\);/, reveal_in_system: /l\.revealInSystem\(\);/,
        reveal_in_bridge: /l\.revealInBridge\(\);/, go_to_link: /l\.show\(\);/, go_to_source: /l\.goToSource\(\);/,
        check_out: /m\.checkOut\(\)/, cancel_check_out: /m\.revert\(\)/,
    };
    for (const [action, re] of Object.entries(cases)) assert.match(await one('run_document_link_action', { action, ...L }), re, action);
    const all = await one('run_document_link_action', { action: 'update_all' });
    assert.match(all, /__links\(doc, \[\], \[\], \[\], \[LinkStatus\.LINK_OUT_OF_DATE\], false, true\)/);
    const un = await one('run_document_link_action', { action: 'unembed', ...L, folder: f('unembedded') });
    assert.match(un, /l\.unembed\(dir, "", false\);/);
    assert.match(await one('run_document_link_action', { action: 'unembed', ...L }), /l\.unembed\(\);/);
    assert.match(await one('run_document_link_action', { action: 'check_in', ...L, comment: 'Edits "1"' }), /m\.checkIn\("Edits \\"1\\"", false\)/);
});

await test('run_document_link_action refuses bad arguments', () => {
    const act = tool('run_document_link_action').handler;
    assert.throws(() => act({ action: 'delete', links: T }), /Allowed: update/);
    assert.throws(() => act({ action: 'update' }), /Choose the links/);
    assert.throws(() => act({ action: 'update_all', links: { all: true } }), /leave out 'links'/);
    assert.throws(() => act({ action: 'embed', links: T, folder: f('x') }), /'folder' applies to unembed/);
    assert.throws(() => act({ action: 'check_out', links: T, comment: 'x' }), /'comment' applies to check_in/);
});

await test('run_links_panel_command invokes Links panel menu actions', async () => {
    const s = await one('run_links_panel_command', { command: 'search_for_missing_links' });
    assert.match(s, /__menu\(\[132634\], "search_for_missing_links"\);/);
    const sel = await one('run_links_panel_command', { command: 'copy_info_for_selected_links', target: T });
    assert.match(sel, /doc\.select\(__targets\(doc, \{"ids":\[5\]\}\), SelectionOptions\.REPLACE_WITH\);/);
    assert.match(sel, /__menu\(\[132619\]/);
    assert.throws(() => tool('run_links_panel_command').handler({ command: 'panel_options' }), /Allowed: search_for_missing_links/);
    assert.throws(() => tool('run_links_panel_command').handler({ command: 'hide_thumbnail', target: {} }), /Choose the items/);
});

await test('place_graphic_with_options sets the import preferences and puts them back', async () => {
    const s = await one('place_graphic_with_options', {
        filePath: f('brochure.pdf'), pageIndex: 1, x: 20, y: 30,
        pdf: { page: 3, crop: 'CROP_BLEED', transparentBackground: true, password: 'pw' },
        indesignPage: { page: 2, crop: 'CROP_SLUG' },
        eps: { readOpiLinks: true, proxy: 'ALWAYS', createFrames: false },
        image: { applyClippingPath: true, alphaChannel: 'Alpha 1', profile: 'sRGB IEC61966-2.1', renderingIntent: 'PERCEPTUAL', layers: [{ name: 'Text/Title', visible: false }], whenUpdatingLink: 'KEEP_OVERRIDES' },
        fit: 'PROPORTIONALLY', staticCaption: true,
    });
    assert.match(s, /app\.pdfPlacePreferences\.pageNumber = 3;/);
    assert.match(s, /app\.pdfPlacePreferences\.pdfCrop = PDFCrop\.CROP_BLEED;/);
    assert.match(s, /app\.pdfPlacePreferences\.transparentBackground = true;/);
    assert.match(s, /app\.pdfPlacePreferences\.openDocumentPassword = "pw";/);
    assert.match(s, /app\.importedPageAttributes\.importedPageCrop = ImportedPageCropOptions\.CROP_SLUG;/);
    assert.match(s, /app\.epsImportPreferences\.opiComments = true;/);
    assert.match(s, /app\.epsImportPreferences\.epsProxy = CreateProxy\.ALWAYS;/);
    assert.match(s, /app\.epsImportPreferences\.epsFrames = false;/);
    assert.match(s, /app\.imageIOPreferences\.applyPhotoshopClippingPath = true;/);
    assert.match(s, /app\.imageIOPreferences\.alphaChannelName = "Alpha 1";/);
    assert.match(s, /__keep\(app\.pdfPlacePreferences, "openDocumentPassword", app\.pdfPlacePreferences\.openDocumentPassword\);/);
    assert.match(s, /__kept\[k\]\[0\]\[__kept\[k\]\[1\]\] = __kept\[k\]\[2\]/);
    assert.match(s, /page\.place\(f, __toPage\(page, 20, 30\), doc\.activeLayer, false, false\);/);
    assert.match(s, /g\.profile = "sRGB IEC61966-2\.1";/);
    assert.match(s, /g\.imageRenderingIntent = RenderingIntent\.PERCEPTUAL;/);
    assert.match(s, /g\.graphicLayerOptions\.updateLinkOption = UpdateLinkOptions\.KEEP_OVERRIDES;/);
    assert.match(s, /var lsets = \[\["Text\/Title", false\]\];/);
    assert.match(s, /gl\.currentVisibility = lsets\[li\]\[1\];/);
    assert.match(s, /fr\.fit\(FitOptions\.PROPORTIONALLY\); fr\.fit\(FitOptions\.CENTER_CONTENT\);/);
    assert.match(s, /__menu\(\[132651, 132652\], "Generate Static Caption"\);/);
    const into = await one('place_graphic_with_options', { filePath: f('a.psd'), frameId: 9, image: { profile: 'USE_DOCUMENT' } });
    assert.match(into, /var frame = __item\(doc, 9\);\s+placed = frame\.place\(f, false\);/);
    assert.match(into, /g\.profile = Profile\.USE_DOCUMENT;/);
    assert.match(await one('place_graphic_with_options', { filePath: f('a.psd'), intoSelection: true }), /placed = app\.selection\[0\]\.place\(f, false\);/);
});

await test('place_graphic_with_options refuses bad arguments', () => {
    const place = tool('place_graphic_with_options').handler;
    assert.throws(() => place({}), /'filePath' is required/);
    assert.throws(() => place({ filePath: f('a.pdf'), frameId: 1, intoSelection: true }), /not both/);
    assert.throws(() => place({ filePath: f('a.pdf'), frameId: 1, x: 3 }), /'x' does not apply/);
    assert.throws(() => place({ filePath: f('a.pdf'), pdf: { page: 0 } }), /at least 1/);
    assert.throws(() => place({ filePath: f('a.pdf'), pdf: { crop: 'CROP_BOX' } }), /Allowed: CROP_PDF/);
    assert.throws(() => place({ filePath: f('a.pdf'), pdf: { layers: true } }), /Unknown option 'pdf\.layers'/);
    assert.throws(() => place({ filePath: f('a.eps'), eps: { proxy: 'NEVER' } }), /Allowed: AS_NEEDED, ALWAYS/);
    assert.throws(() => place({ filePath: f('a.psd'), image: { layers: [] } }), /non-empty list/);
    assert.throws(() => place({ filePath: f('a.psd'), image: { layers: [{ name: 'A', visible: 'yes' }] } }), /true or false/);
    assert.throws(() => place({ filePath: f('a.psd'), image: { renderingIntent: 'VIVID' } }), /Allowed: USE_COLOR_SETTINGS/);
    assert.throws(() => place({ filePath: f('a.psd'), fit: 'STRETCH' }), /Allowed: PROPORTIONALLY/);
});

await test('get and set placed graphic options', async () => {
    const g = await one('get_placed_graphic_options', { target: T });
    assert.match(g, /r\.layers = __layerTree\(g\.graphicLayerOptions\.graphicLayers, 0\)/);
    assert.match(g, /r\.pdf = \{ page: pa\.pageNumber, crop: __enumName\(pa\.pdfCrop\)/);
    assert.match(g, /r\.indesignPage = \{ page: g\.pageNumber, crop: __enumName\(g\.importedPageCrop\) \}/);
    assert.match(g, /r\.useSVGAs = __enumName\(g\.useSVGAs\)/);
    const s = await one('set_placed_graphic_options', { target: T, applyClippingPath: false, alphaChannel: '', displayQuality: 'HIGH_QUALITY', layers: [{ name: 'Logo', visible: true }] });
    assert.match(s, /items\[i\]\.localDisplaySetting = DisplaySettingOptions\.HIGH_QUALITY;/);
    assert.match(s, /g\.imageIOPreferences\.applyPhotoshopClippingPath = false;/);
    assert.match(s, /g\.imageIOPreferences\.alphaChannelName = "";/);
    assert.match(s, /\["Logo", true\]/);
    const set = tool('set_placed_graphic_options').handler;
    assert.throws(() => set({ target: T }), /Nothing to set/);
    assert.throws(() => set({ target: T, renderingIntent: 'PERCEPTUAL' }), /set_image_color_settings/);
    assert.throws(() => set({ target: T, displayQuality: 'FAST' }), /Allowed: DEFAULT_VALUE/);
    assert.throws(() => set({ target: T, whenUpdatingLink: 'UNKNOWN' }), /Allowed: KEEP_OVERRIDES/);
    assert.throws(() => set({ target: T, layers: [{ name: 'A', visible: true, locked: true }] }), /Unknown option/);
});

await test('adjust_frame_content crops, moves and scales the content', async () => {
    const s = await one('adjust_frame_content', { target: T, crop: { top: 2, right: -1 }, moveContent: { dx: 3, dy: -4 }, scaleContent: { horizontal: 80, vertical: 80 } });
    assert.match(s, /g\.horizontalScale = 80;/);
    assert.match(s, /g\.verticalScale = 80;/);
    assert.match(s, /g\.move\(undefined, \[3, -4\]\);/);
    assert.match(s, /var nb = \[b\[0\] \+ 2, b\[1\] \+ 0, b\[2\] - 0, b\[3\] - -1\];/);
    assert.match(s, /fr\.geometricBounds = nb;/);
    assert.match(s, /g\.move\(undefined, \[gb\[1\] - ng\[1\], gb\[0\] - ng\[0\]\]\)/);
    const adj = tool('adjust_frame_content').handler;
    assert.throws(() => adj({ target: T }), /Nothing to do/);
    assert.throws(() => adj({ target: T, crop: { inside: 2 } }), /Unknown option 'crop\.inside'/);
    assert.throws(() => adj({ target: T, scaleContent: {} }), /needs horizontal or vertical/);
    assert.throws(() => adj({ target: T, scaleContent: { horizontal: 0 } }), /out of range/);
    assert.throws(() => adj({ target: T, moveContent: { dx: 'far' } }), /Invalid number/);
});

await test('place_contact_sheet lays files out in a grid', async () => {
    const s = await one('place_contact_sheet', { files: [f('a.jpg'), f('b.jpg')], columns: 4, rows: 2, gutter: 3, fit: 'FILL_PROPORTIONALLY', caption: 'live' });
    assert.match(s, /var cols = 4, rows = 2, gut = 3, per = cols \* rows;/);
    assert.match(s, /rect\.place\(files\[i\], false\);/);
    assert.match(s, /rect\.fit\(FitOptions\.FILL_PROPORTIONALLY\);\s+rect\.fit\(FitOptions\.CENTER_CONTENT\);/);
    assert.match(s, /doc\.pages\.add\(LocationOptions\.AT_END\);/);
    assert.match(s, /var mp = page\.marginPreferences/);
    assert.match(s, /__menu\(\[132644, 132643\]/);
    const d = await one('place_contact_sheet', { folder: f('shoot'), extensions: ['JPG', '.tif'], area: { x: 10, y: 20, width: 150, height: 200 }, addPages: false });
    assert.match(d, /var exts = "\|jpg\|tif\|"/);
    assert.match(d, /var ax = 10, ay = 20, aw = 150, ah = 200;/);
    assert.match(d, /if \(!false\)/);
    const cs = tool('place_contact_sheet').handler;
    assert.throws(() => cs({}), /Give files or folder/);
    assert.throws(() => cs({ files: [f('a.jpg')], folder: f('x') }), /Give files or folder/);
    assert.throws(() => cs({ files: [f('a.jpg')], extensions: ['jpg'] }), /goes with folder/);
    assert.throws(() => cs({ files: [] }), /1 to 1000 paths/);
    assert.throws(() => cs({ files: [f('a.jpg')], columns: 0 }), /at least 1/);
    assert.throws(() => cs({ folder: f('x'), extensions: ['j*g'] }), /file extension/);
    assert.throws(() => cs({ files: [f('a.jpg')], area: { x: 0, y: 0, width: 0, height: 5 } }), /out of range/);
});

await test('manage_place_cursor loads, rotates and clears the place gun', async () => {
    const s = await one('manage_place_cursor', { action: 'load', files: [f('a.jpg'), f('b.pdf')] });
    assert.match(s, /var gun = doc\.placeGuns;/);
    assert.match(s, /gun\.loadPlaceGun\(files, false\);/);
    assert.match(await one('manage_place_cursor', { action: 'rotate', direction: 'BACKWARD' }), /gun\.rotate\(RotationDirection\.BACKWARD\);/);
    assert.match(await one('manage_place_cursor', { action: 'clear' }), /gun\.abortPlaceGun\(\);/);
    const pc = tool('manage_place_cursor').handler;
    assert.throws(() => pc({ action: 'load' }), /needs 'files'/);
    assert.throws(() => pc({ action: 'status', files: [f('a.jpg')] }), /'files' applies to load/);
    assert.throws(() => pc({ action: 'rotate', direction: 'LEFT' }), /Allowed: FORWARD, BACKWARD/);
    assert.throws(() => pc({ action: 'fire' }), /Allowed: load/);
});

done();
