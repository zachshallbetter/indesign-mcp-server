import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';
import { readFileInfo, fileInfoBlock } from '../src/tools/document-setup.js';
import { toolDefinitions } from '../src/server.js';

const docs = path.join(home, 'Documents');

test('templates, Save a Copy, revert and close all', async () => {
    const [tpl, copy, revert, closeSave, closeDiscard] = await scriptsFor([
        ['new_from_template', { filePath: path.join(docs, 'Brochure.ait') }],
        ['save_document_copy', { filePath: path.join(docs, 'copy.ai') }],
        ['revert_document', {}],
        ['close_all_documents', { save: true }],
        ['close_all_documents', {}],
    ]);
    assert.match(tpl, /var d = app\.open\(f\);/);
    assert.match(copy, /if \(!doc\.saved\) throw/);
    assert.match(copy, /if \(have !== "\.ai"\)/);
    assert.match(copy, /target\.exists && !false/);
    assert.match(copy, /src\.copy\(target\.fsName\)/);
    assert.doesNotMatch(copy, /saveAs/, 'the document keeps referring to its own file');
    assert.match(revert, /doc\.close\(SaveOptions\.DONOTSAVECHANGES\);\n {2}var d = app\.open\(f\);/);
    assert.match(closeSave, /!docs\[j\]\.saved && !__file\(docs\[j\]\)/, 'untitled documents would open a Save dialog');
    assert.match(closeSave, /SaveOptions\.SAVECHANGES/);
    assert.match(closeDiscard, /SaveOptions\.DONOTSAVECHANGES/);
    assert.doesNotMatch(closeDiscard, /unsaved\.push/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('new_from_template', { filePath: path.join(docs, 'Brochure.ai') }), /\.ait/);
    await assert.rejects(mcp.handleToolCall('new_from_template', { filePath: '/etc/x.ait' }), /Access denied/);
    await assert.rejects(mcp.handleToolCall('save_document_copy', { filePath: path.join(docs, 'copy') }), /extension/);
});

test('document presets set the new document options', async () => {
    const [list, make, plain] = await scriptsFor([
        ['list_document_presets', {}],
        ['create_document_from_preset', {
            preset: 'Print', title: 'Poster', width: 1190, height: 842, orientation: 'portrait', units: 'millimeters', colorMode: 'CMYK',
            rasterEffects: 'high', previewMode: 'overprint', transparencyGrid: 'dark', bleed: 9,
        }],
        ['create_document_from_preset', { preset: 'Web' }],
    ]);
    assert.match(list, /app\.startupPresetsList/);
    assert.match(list, /app\.getPresetSettings\(names\[i\]\)/);
    for (const re of [
        /p\.title = "Poster";/, /p\.width = 1190;/, /p\.height = 842;/, /p\.units = RulerUnits\.Millimeters;/,
        /p\.colorMode = DocumentColorSpace\.CMYK;/, /p\.rasterResolution = DocumentRasterResolution\.HighResolution;/,
        /p\.previewMode = DocumentPreviewMode\.OverprintPreview;/, /p\.transparencyGrid = DocumentTransparencyGrid\.TransparencyGridDark;/,
        /if \(p\.width > p\.height\) \{ var w = p\.width; p\.width = p\.height; p\.height = w; \}/,
        /p\.documentBleedLink = true;\np\.documentBleedOffset = \[9, 9, 9, 9\];/,
        /app\.documents\.addDocument\(name, p, false\)/,
    ]) assert.match(make, re);
    assert.doesNotMatch(plain, /p\.(width|units|title) =/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_document_from_preset', { preset: 'Print', units: 'furlongs' }), /Allowed: points/);
    await assert.rejects(mcp.handleToolCall('create_document_from_preset', { preset: 'Print', bleed: 100 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('create_document_from_preset', { preset: 'Print', orientation: 'square' }), /Allowed: portrait, landscape/);
});

test('Document Setup sets what the object model reaches', async () => {
    const [read, mode, origin, rest] = await scriptsFor([
        ['get_document_setup', {}],
        ['set_document_setup', { colorMode: 'RGB' }],
        ['set_document_setup', { rulerOrigin: { x: 36, y: 72 }, artboardIndex: 2 }],
        ['set_document_setup', { largeCanvas: true, editArtboards: true }],
    ]);
    assert.match(read, /doc\.rulerUnits/);
    assert.match(read, /doc\.showPlacedImages/);
    assert.match(read, /doc\.artboards\[i\]\.rulerOrigin/);
    assert.match(mode, /app\.executeMenuCommand\("doc-color-rgb"\);/);
    assert.match(mode, /if \(doc\.documentColorSpace != DocumentColorSpace\.RGB\) throw/);
    assert.match(origin, /var ai = 2;/);
    assert.match(origin, /doc\.artboards\[ai\]\.rulerOrigin = \[__len\(doc, 36\), __len\(doc, 72\)\];/);
    assert.doesNotMatch(origin, /executeMenuCommand|convertToLargeCanvas/);
    assert.match(rest, /if \(__sf\(doc\) === 1\) doc\.convertToLargeCanvas\(\);/);
    assert.match(rest, /app\.selectTool\("Adobe Crop Tool"\);/);
    for (const s of [read, mode, origin, rest]) assert.doesNotMatch(s, /"document"/, 'never opens the Document Setup dialog');

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_document_setup', {}), /at least one/);
    await assert.rejects(mcp.handleToolCall('set_document_setup', { largeCanvas: false }), /cannot be converted back/);
    await assert.rejects(mcp.handleToolCall('set_document_setup', { colorMode: 'LAB' }), /Allowed: CMYK, RGB/);
    await assert.rejects(mcp.handleToolCall('set_document_setup', { artboardIndex: 1, colorMode: 'RGB' }), /applies with rulerOrigin/);
    await assert.rejects(mcp.handleToolCall('set_document_setup', { rulerOrigin: { x: 'left', y: 0 } }), /Invalid number/);
});

test('open options are set on an OpenOptions object', async () => {
    const [legacy, library] = await scriptsFor([
        ['open_document_with_options', {
            filePath: path.join(docs, 'old.ai'), updateLegacyText: true, updateLegacyGradientMesh: false, preserveLegacyArtboard: false,
            convertCropAreaToArtboard: true, convertTilesToArtboards: true, createArtboardFromArtworkBounds: false, addToRecentFiles: false,
        }],
        ['open_document_with_options', { filePath: path.join(docs, 'Brand.ai'), openAs: 'swatches' }],
    ]);
    for (const re of [
        /o\.updateLegacyText = true;/, /o\.updateLegacyGradientMesh = false;/, /o\.preserveLegacyArtboard = false;/,
        /o\.convertCropAreaToArtboard = true;/, /o\.convertTilesToArtboard = true;/, /o\.createArtboardWithArtworkBoundingBox = false;/,
        /o\.addToRecentFiles = false;/, /app\.open\(f, null, o\)/,
    ]) assert.match(legacy, re);
    assert.doesNotMatch(legacy, /openAs/);
    assert.match(library, /o\.openAs = LibraryType\.SWATCHES;/);
    assert.doesNotMatch(library, /updateLegacyText/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('open_document_with_options', { filePath: path.join(docs, 'a.ai') }), /use open_document/);
    await assert.rejects(mcp.handleToolCall('open_document_with_options', { filePath: path.join(docs, 'a.ai'), openAs: 'fonts' }), /Allowed: document/);
    await assert.rejects(mcp.handleToolCall('open_document_with_options', { filePath: '/System/a.ai', addToRecentFiles: false }), /Access denied/);
});

const PACKET = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Adobe Illustrator 28.0">
<dc:format>application/postscript</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Spring &amp; Summer</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Ana</rdf:li><rdf:li>Ben</rdf:li></rdf:Seq></dc:creator>
<xmp:CreateDate>2026-01-02T03:04:05Z</xmp:CreateDate>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;

test('file info reads and writes XMP fields', async () => {
    assert.deepEqual(readFileInfo(PACKET), {
        title: 'Spring & Summer', authors: ['Ana', 'Ben'], description: null, keywords: [], copyright: null, copyrighted: null,
        format: 'application/postscript', creatorTool: 'Adobe Illustrator 28.0', created: '2026-01-02T03:04:05Z', modified: null,
    });
    const block = fileInfoBlock({ title: 'A <b> & "c"', keywords: ['one', 'two'], authors: [] });
    assert.equal(block, '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        + '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">A &lt;b&gt; &amp; &quot;c&quot;</rdf:li></rdf:Alt></dc:title>'
        + '<dc:subject><rdf:Bag><rdf:li>one</rdf:li><rdf:li>two</rdf:li></rdf:Bag></dc:subject></rdf:Description>');
    assert.equal(fileInfoBlock({ title: '' }), '');

    const [read, fields, raw] = await scriptsFor([
        ['get_file_info', {}],
        ['set_file_info', { title: 'Poster $1', authors: [], copyright: '© 2026' }],
        ['set_file_info', { xmp: PACKET }],
    ]);
    assert.match(read, /__result__ = \{ xmp: doc\.XMPString \};/);
    assert.match(fields, /var drop = \["dc:title","dc:creator","dc:rights"\];/);
    assert.match(fields, /function \(m\) \{ return m \+ add; \}/, 'a $ in a value is not a replacement pattern');
    assert.match(fields, /Poster \$1/);
    assert.doesNotMatch(fields, /<dc:creator>/, 'an empty list removes the field');
    assert.match(raw, /doc\.XMPString = "<\?xpacket/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_file_info', {}), /at least one/);
    await assert.rejects(mcp.handleToolCall('set_file_info', { xmp: PACKET, title: 'x' }), /not both/);
    await assert.rejects(mcp.handleToolCall('set_file_info', { xmp: '<x/>' }), /rdf:RDF/);
    await assert.rejects(mcp.handleToolCall('set_file_info', { keywords: 'a, b' }), /list of strings/);
});

test('get_file_info parses the packet Illustrator returns', async () => {
    const { executor } = await import('../src/executor.js');
    const mcp = await server();
    const original = executor.runScript;
    executor.runScript = async () => JSON.stringify({ ok: true, result: JSON.stringify({ xmp: PACKET }) });
    try {
        const r = await mcp.handleToolCall('get_file_info', {});
        assert.equal(r.success, true);
        assert.equal(r.result.title, 'Spring & Summer');
        assert.equal(r.result.xmp, undefined);
        const full = await mcp.handleToolCall('get_file_info', { includeXmp: true });
        assert.equal(full.result.xmp, PACKET);
    } finally {
        executor.runScript = original;
    }
});

test('clipboard and document switching', async () => {
    const [cut, copy, paste, inPlace, all, plain, byName, byIndex, next, group] = await scriptsFor([
        ['use_clipboard', { action: 'cut', target: { ids: ['a1'] } }],
        ['use_clipboard', { action: 'copy' }],
        ['use_clipboard', { action: 'paste' }],
        ['use_clipboard', { action: 'paste_in_place', artboardIndex: 1 }],
        ['use_clipboard', { action: 'paste_on_all_artboards' }],
        ['use_clipboard', { action: 'paste_without_formatting' }],
        ['switch_document', { name: 'Logo.ai' }],
        ['switch_document', { index: 2 }],
        ['switch_document', { direction: 'next' }],
        ['switch_document', { direction: 'previous_group' }],
    ]);
    assert.match(cut, /__targets\(doc, \{"ids":\["a1"\]\}\)/);
    assert.match(cut, /app\.cut\(\);/);
    assert.match(copy, /app\.copy\(\);/);
    assert.doesNotMatch(copy, /var items = __targets/);
    assert.match(paste, /app\.paste\(\);/);
    assert.match(inPlace, /doc\.artboards\.setActiveArtboardIndex\(ai\);[\s\S]*app\.executeMenuCommand\("pasteInPlace"\);/);
    assert.match(all, /app\.executeMenuCommand\("pasteInAllArtboard"\);/);
    assert.match(plain, /app\.executeMenuCommand\("pasteWithoutFormatting"\);/);
    assert.doesNotMatch(plain, /doc\.selection = null/, 'keeps a text insertion point');
    assert.match(byName, /var want = "Logo\.ai"/);
    assert.match(byName, /d\.activate\(\);\napp\.redraw\(\);/);
    assert.match(byIndex, /app\.documents\[i\]\.activate\(\);/);
    assert.match(next, /app\.executeMenuCommand\("navigateToNextDocument"\);/);
    assert.match(group, /app\.executeMenuCommand\("navigateToPreviousDocumentGroup"\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('use_clipboard', { action: 'paste_in_front' }), /Allowed: cut/);
    await assert.rejects(mcp.handleToolCall('use_clipboard', { action: 'paste', target: { selection: true } }), /applies to cut and copy/);
    await assert.rejects(mcp.handleToolCall('use_clipboard', { action: 'copy', artboardIndex: 0 }), /applies to paste_in_place/);
    await assert.rejects(mcp.handleToolCall('use_clipboard', { action: 'cut', target: {} }), /Choose the items/);
    await assert.rejects(mcp.handleToolCall('switch_document', {}), /exactly one/);
    await assert.rejects(mcp.handleToolCall('switch_document', { name: 'a', index: 0 }), /exactly one/);
    await assert.rejects(mcp.handleToolCall('switch_document', { direction: 'up' }), /Allowed: next/);
});

test('document commands carry the right annotations', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['list_document_presets', 'get_document_setup', 'get_file_info']) assert.equal(byName[n].readOnlyHint, true, n);
    for (const n of ['revert_document', 'close_all_documents', 'set_file_info', 'set_document_setup', 'use_clipboard', 'save_document_copy']) {
        assert.equal(byName[n].destructiveHint, true, n);
    }
});
