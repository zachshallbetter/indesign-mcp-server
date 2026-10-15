import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';

const docs = path.join(home, 'Documents');
const sel = { selection: true };

test('list_images reports links, embedded images and other non-native art', async () => {
    const [all, missing, some] = await scriptsFor([
        ['list_images', {}],
        ['list_images', { missingOnly: true }],
        ['list_images', { kinds: ['plugin', 'embedded_file'] }],
    ]);
    for (const col of ['placedItems', 'rasterItems', 'embeddedItems', 'nonNativeItems', 'pluginItems']) assert.match(all, new RegExp(`add\\(doc\\.${col},`));
    assert.match(all, /try \{ f = it\.file; \} catch/);
    assert.match(all, /it\.imageColorSpace/);
    assert.match(all, /it\.isTracing/);
    assert.match(missing, /add\(doc\.placedItems, "linked"\)/);
    assert.doesNotMatch(missing, /add\(doc\.rasterItems/);
    assert.match(some, /add\(doc\.pluginItems, "plugin"\)/);
    assert.doesNotMatch(some, /add\(doc\.placedItems/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('list_images', { kinds: ['vector'] }), /Allowed: linked/);
});

test('relink_images: one file, every instance, or missing links from a folder', async () => {
    const [one, every, folder] = await scriptsFor([
        ['relink_images', { target: { ids: ['a'] }, filePath: path.join(docs, 'new.png') }],
        ['relink_images', { target: { ids: ['a'] }, filePath: path.join(docs, 'new.png'), allInstances: true }],
        ['relink_images', { folder: docs }],
    ]);
    assert.match(one, /items\[j\]\.relink\(f\)/);
    assert.doesNotMatch(one, /from\[lp\]/);
    assert.match(every, /doc\.placedItems\[i\]/);
    assert.match(every, /from\[cp\]/);
    assert.match(folder, /var items = doc\.placedItems;/);
    assert.match(folder, /it\.relink\(cand\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('relink_images', { target: sel }), /either filePath/);
    await assert.rejects(mcp.handleToolCall('relink_images', { target: sel, filePath: path.join(docs, 'a.png'), folder: docs }), /either filePath/);
    await assert.rejects(mcp.handleToolCall('relink_images', { filePath: path.join(docs, 'a.png') }), /Choose the items/);
    await assert.rejects(mcp.handleToolCall('relink_images', { target: sel, filePath: '/etc/passwd' }), /outside the allowed|Access denied/);
});

test('update_links reloads or embeds, and needs a choice of links', async () => {
    const [update, embed] = await scriptsFor([
        ['update_links', { all: true }],
        ['update_links', { operation: 'embed', target: sel }],
    ]);
    assert.match(update, /it\.relink\(f\);/);
    assert.match(embed, /it\.embed\(\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('update_links', {}), /target, or all: true/);
    await assert.rejects(mcp.handleToolCall('update_links', { all: true, operation: 'unembed' }), /Allowed: update, embed/);
});

test('go_to_link selects one item and centres the view on it', async () => {
    const [s] = await scriptsFor([['go_to_link', { target: { ids: ['a'] }, zoom: 2 }]]);
    assert.match(s, /it\.selected = true;/);
    assert.match(s, /v\.zoom = 2;/);
    assert.match(s, /v\.centerPoint = /);
});

test('place_images lays files out in a grid and sets, then restores, the Photoshop import options', async () => {
    const files = [path.join(docs, 'a.psd'), path.join(docs, 'b.psd'), path.join(docs, 'c.png')];
    const [psd, plain] = await scriptsFor([
        ['place_images', { files, columns: 2, gap: 12, embed: true, photoshop: { layersToObjects: true, hiddenLayers: false, layerComp: 'Web "home"' } }],
        ['place_images', { files: files.slice(2) }],
    ]);
    assert.match(psd, /var psd = \{"preserveLayers":true,"preserveHiddenLayers":false,"layerComp":"Web \\"home\\""\}/);
    assert.match(psd, /po = app\.preferences\.photoshopFileOptions/);
    assert.match(psd, /\} finally \{\n {2}if \(was\)/);
    assert.match(psd, /cols = 2/);
    assert.match(psd, /it\.embed\(\);/);
    assert.match(plain, /var psd = null/);
    assert.doesNotMatch(plain, /it\.embed\(\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('place_images', { files: [] }), /at least one/);
    await assert.rejects(mcp.handleToolCall('place_images', { files, photoshop: { layersToObjects: true } }), /needs embed: true/);
    await assert.rejects(mcp.handleToolCall('place_images', { files, columns: 0 }), /at least 1/);
    await assert.rejects(mcp.handleToolCall('place_images', { files: ['/etc/hosts'] }), /outside the allowed|Access denied/);
});

test('rasterize_items sets each Rasterize dialog option', async () => {
    const [s, apart] = await scriptsFor([
        ['rasterize_items', {
            target: sel, resolution: 150, colorModel: 'grayscale', background: 'black', antiAliasing: 'none', clippingMask: true,
            padding: 9, preserveSpotColors: false, convertTextToOutlines: true, includeLayers: true, clipBounds: { x: 0, y: 0, width: 100, height: 50 },
        }],
        ['rasterize_items', { target: sel, background: 'transparent', separately: true }],
    ]);
    for (const line of [
        'o.resolution = 150;', 'o.colorModel = RasterizationColorModel.GRAYSCALE;', 'o.transparency = false;', 'o.backgroundBlack = true;',
        'o.antiAliasingMethod = AntiAliasingMethod.None;', 'o.clippingMask = true;', 'o.padding = __len(doc, 9);', 'o.convertSpotColors = true;',
        'o.convertTextToOutlines = true;', 'o.includeLayers = true;',
    ]) assert.ok(s.includes(line), line);
    assert.match(s, /var clip = \[tl\[0\], tl\[1\], br\[0\], br\[1\]\];/);
    assert.match(s, /doc\.rasterize\(items\.length === 1 \? items\[0\] : items, clip \|\| __union\(items\), o\)/);
    assert.match(apart, /o\.transparency = true;/);
    assert.match(apart, /o\.convertSpotColors = false;/);
    assert.match(apart, /doc\.rasterize\(items\[i\], clip \|\| items\[i\]\.visibleBounds, o\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('rasterize_items', { target: sel, resolution: 10 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('rasterize_items', { target: sel, background: 'red' }), /Allowed: white, transparent, black/);
    await assert.rejects(mcp.handleToolCall('rasterize_items', { target: sel, clipBounds: { x: 0, y: 0, width: 0, height: 5 } }), /out of range/);
});

test('crop_image rasterizes each image inside the crop rectangle', async () => {
    const [s] = await scriptsFor([['crop_image', { target: sel, bounds: { x: 10, y: 20, width: 30, height: 40 }, resolution: 600 }]]);
    assert.match(s, /o\.resolution = 600;/);
    assert.match(s, /doc\.rasterize\(items\[i\], r, o\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('crop_image', { target: sel }), /'bounds' needs/);
    await assert.rejects(mcp.handleToolCall('crop_image', { target: sel, bounds: { x: 0, y: 0, width: 'wide', height: 4 } }), /Invalid number/);
});

test('colorize_image needs an RGB or CMYK colour', async () => {
    const [s] = await scriptsFor([['colorize_image', { target: sel, color: '#FF6600' }]]);
    assert.match(s, /it\.colorize\(c\);/);
    assert.match(s, /ImageColorSpace\.GrayScale/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('colorize_image', { target: sel, color: 'gray(40)' }), /RGB or CMYK/);
    await assert.rejects(mcp.handleToolCall('colorize_image', { target: sel, color: 'none' }), /RGB or CMYK/);
});

test('run_image_command runs only the listed commands on the targets', async () => {
    const { IMAGE_COMMANDS } = await import('../src/tools/images.js');
    const scripts = await scriptsFor(Object.keys(IMAGE_COMMANDS).map((operation) => ['run_image_command', { target: sel, operation }]));
    Object.values(IMAGE_COMMANDS).forEach((id, i) => assert.ok(scripts[i].includes(`app.executeMenuCommand(${JSON.stringify(id)});`), id));
    assert.match(scripts[1], /make_mockup needs the vector art and the image/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_image_command', { target: sel, operation: 'crop' }), /Allowed: remove_background/);
});

test('image tools carry their annotations', async () => {
    const { toolDefinitions } = await import('../src/server.js');
    const by = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    assert.equal(by.list_images.readOnlyHint, true);
    for (const n of ['rasterize_items', 'crop_image', 'relink_images', 'update_links', 'run_image_command']) assert.equal(by[n].destructiveHint, true, n);
    assert.equal(by.run_image_command.openWorldHint, true);
    assert.equal(by.place_images.destructiveHint, false);
});
