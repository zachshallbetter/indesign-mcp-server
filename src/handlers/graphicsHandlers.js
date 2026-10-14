/**
 * Graphics management handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, looksLikeFailure, str, num, index, bool, enumOf, validateFilePath, jsxPath } from '../utils/stringUtils.js';
import { sessionManager } from '../core/sessionManager.js';
import {
    jsxProgram, jsxPage, jsxItemAt, jsxSwatch, jsxBounds, resolveBox, mmToPt, JSX_HELPERS,
} from './pageItemHandlers.js';

const has = (v) => v !== undefined && v !== null && v !== '';

const FIT_MODES = ['PROPORTIONALLY', 'FILL_PROPORTIONALLY', 'CONTENT_TO_FRAME', 'FRAME_TO_CONTENT', 'CENTER_CONTENT', 'NONE'];
const FIT_ALIASES = { FILL_FRAME: 'FILL_PROPORTIONALLY', FIT_CONTENT: 'CONTENT_TO_FRAME', FIT_FRAME: 'FRAME_TO_CONTENT' };

/** Fill/stroke lines for a newly created shape `v`. Swatches are resolved before creation. */
function paintLines(v, { fillColor, strokeColor, strokeWeight }) {
    const pre = [];
    const post = [];
    if (has(fillColor)) {
        pre.push(...jsxSwatch('__fill', fillColor, 'fill'));
        post.push(`${v}.fillColor = __fill;`);
    }
    if (has(strokeColor)) {
        pre.push(...jsxSwatch('__stroke', strokeColor, 'stroke'));
        post.push(`${v}.strokeColor = __stroke;`);
    }
    if (has(strokeColor) || has(strokeWeight)) {
        post.push(`${v}.strokeWeight = ${num(has(strokeWeight) ? strokeWeight : 1, { name: 'strokeWeight', min: 0, max: 1000 })};`);
    }
    return { pre, post };
}

async function createShape(args, { kind, label, create, extra = [] }) {
    const box = resolveBox(args);
    const paint = paintLines('shape', args);

    const script = jsxProgram([
        ...JSX_HELPERS,
        ...jsxPage(args.pageIndex),
        ...paint.pre,
        ...jsxBounds('__bounds', box),
        ...create,
        'shape.geometricBounds = __bounds;',
        ...extra,
        ...paint.post,
        `return ${str(`${label} created on page `)} + page.name + " (ID " + shape.id + ")";`,
    ], { errorPrefix: `Error creating ${kind}` });

    const result = await ScriptExecutor.executeInDesignScript(script);
    if (!looksLikeFailure(result)) {
        sessionManager.setLastCreatedItem({
            type: kind,
            position: box,
            fillColor: args.fillColor,
            strokeColor: args.strokeColor,
            strokeWeight: args.strokeWeight,
        });
    }
    return formatResponse(result, `Create ${label}`);
}

export class GraphicsHandlers {
    /**
     * Create a rectangle on the active page (or pageIndex)
     */
    static async createRectangle(args) {
        const { cornerRadius = 0 } = args;
        const radius = mmToPt(cornerRadius, { name: 'cornerRadius', min: 0, max: 10000 });
        const corners = Number(radius) > 0
            ? ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].flatMap((c) => [
                `shape.${c}CornerOption = CornerOptions.ROUNDED_CORNER;`,
                `shape.${c}CornerRadius = ${radius};`,
            ])
            : [];
        return createShape(args, {
            kind: 'rectangle',
            label: 'Rectangle',
            create: ['var shape = page.rectangles.add();'],
            extra: corners,
        });
    }

    /**
     * Create an ellipse on the active page (or pageIndex)
     */
    static async createEllipse(args) {
        return createShape(args, {
            kind: 'ellipse',
            label: 'Ellipse',
            create: ['var shape = page.ovals.add();'],
        });
    }

    /**
     * Create a regular polygon on the active page (or pageIndex)
     */
    static async createPolygon(args) {
        const { sides = 6 } = args;
        const n = Number(index(sides, { name: 'sides', max: 100 }));
        if (n < 3) return formatResponse('Invalid sides: must be between 3 and 100', 'Create Polygon');
        return createShape(args, {
            kind: 'polygon',
            label: `Polygon (${n} sides)`,
            create: [`var shape = page.polygons.add(doc.activeLayer, ${n}, 0);`],
            extra: [
                // Older engines ignore numberOfSides; convert explicitly when needed.
                `if (shape.paths[0].pathPoints.length !== ${n}) {`,
                `  shape.convertShape(ConvertShapeOptions.CONVERT_TO_POLYGON, ${n}, 0, 0);`,
                '  shape.geometricBounds = __bounds;',
                '}',
            ],
        });
    }

    /**
     * Place an image on the active page (or pageIndex)
     */
    static async placeImage(args) {
        const {
            filePath,
            width,
            height,
            linkImage = true,
            scale = 100,
            fitMode = 'PROPORTIONALLY',
        } = args;
        const objectStyle = args.objectStyle ?? '';

        const resolvedPath = validateFilePath(filePath);
        const fileLit = jsxPath(resolvedPath);
        const autoSize = !has(width) && !has(height);
        const box = resolveBox(autoSize ? { x: args.x, y: args.y, width: 10, height: 10 } : args);
        const scaleN = num(scale, { name: 'scale', min: 1, max: 1000 });
        const modeRaw = String(fitMode).toUpperCase();
        const fit = enumOf(FIT_ALIASES[modeRaw] || modeRaw, FIT_MODES, { name: 'fitMode' });

        const fitLines = [];
        if (autoSize) {
            fitLines.push('frame.fit(FitOptions.FRAME_TO_CONTENT);');
        } else if (fit !== 'NONE') {
            fitLines.push(`frame.fit(FitOptions.${fit});`);
            if (fit === 'PROPORTIONALLY' || fit === 'FILL_PROPORTIONALLY') fitLines.push('frame.fit(FitOptions.CENTER_CONTENT);');
        }

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(args.pageIndex),
            `var imageFile = File(${fileLit});`,
            `if (!imageFile.exists) { return "Error: image file not found: " + ${fileLit}; }`,
            ...(has(objectStyle)
                ? [
                    `var __os = __styleByName(doc.allObjectStyles, ${str(objectStyle)});`,
                    `if (!__os) { return ${str(`Error: object style '${objectStyle}' not found`)}; }`,
                ]
                : []),
            ...jsxBounds('__bounds', box),
            'var frame = page.rectangles.add();',
            'frame.geometricBounds = __bounds;',
            ...(has(objectStyle) ? ['frame.appliedObjectStyle = __os;'] : []),
            'try {',
            '  frame.place(imageFile);',
            '} catch (placeError) {',
            '  frame.remove();',
            '  return "Error: failed to place image: " + placeError.message;',
            '}',
            'if (frame.graphics.length === 0) { frame.remove(); return "Error: nothing was placed from " + imageFile.fsName; }',
            'var graphic = frame.graphics[0];',
            ...(Number(scaleN) !== 100 && (autoSize || fit === 'NONE')
                ? [`graphic.horizontalScale = ${scaleN};`, `graphic.verticalScale = ${scaleN};`]
                : []),
            ...fitLines,
            ...(linkImage ? [] : ['if (graphic.itemLink) { graphic.itemLink.unlink(); }']),
            'var gb = frame.geometricBounds;',
            `return "Image placed: " + imageFile.fsName + " (frame ID " + frame.id + ", " + __mm(gb[3] - gb[1]) + " x " + __mm(gb[2] - gb[0]) + " mm, scale " + Math.round(graphic.horizontalScale * 100) / 100 + "%${linkImage ? '' : ', embedded'})";`,
        ], { errorPrefix: 'Error placing image' });

        const result = await ScriptExecutor.executeInDesignScript(script);

        if (!looksLikeFailure(result)) {
            sessionManager.setLastCreatedItem({
                type: 'image',
                filePath: resolvedPath,
                position: box,
                linkImage,
                objectStyle,
            });
        }

        return formatResponse(result, "Place Image");
    }

    /**
     * Create an object style
     */
    static async createObjectStyle(args) {
        const { name, fillColor, strokeColor, strokeWeight, cornerRadius = 0 } = args;
        const opacity = args.opacity;
        if (!has(name)) return formatResponse('Invalid style name: must be a non-empty string', 'Create Object Style');

        const pre = [];
        const set = [];
        if (has(fillColor)) {
            pre.push(...jsxSwatch('__fill', fillColor, 'fill'));
            set.push('style.enableFill = true;', 'style.fillColor = __fill;');
        }
        if (has(strokeColor)) {
            pre.push(...jsxSwatch('__stroke', strokeColor, 'stroke'));
            set.push('style.enableStroke = true;', 'style.strokeColor = __stroke;');
        }
        if (has(strokeColor) || has(strokeWeight)) {
            set.push('style.enableStroke = true;', `style.strokeWeight = ${num(has(strokeWeight) ? strokeWeight : 1, { name: 'strokeWeight', min: 0, max: 1000 })};`);
        }
        const radius = mmToPt(cornerRadius, { name: 'cornerRadius', min: 0, max: 10000 });
        if (Number(radius) > 0) {
            set.push('style.enableStrokeAndCornerOptions = true;');
            for (const c of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
                set.push(`style.${c}CornerOption = CornerOptions.ROUNDED_CORNER;`, `style.${c}CornerRadius = ${radius};`);
            }
        }
        if (has(opacity)) {
            set.push(
                'style.objectEffectsEnablingSettings.enableTransparency = true;',
                `style.transparencySettings.blendingSettings.opacity = ${num(opacity, { name: 'opacity', min: 0, max: 100 })};`,
            );
        }

        const script = jsxProgram([
            ...JSX_HELPERS,
            `if (__styleByName(doc.allObjectStyles, ${str(name)})) { return ${str(`Cannot create object style: '${name}' already exists`)}; }`,
            ...pre,
            `var style = doc.objectStyles.add({ name: ${str(name)} });`,
            ...set,
            `return ${str(`Object style '${name}' created`)};`,
        ], { errorPrefix: 'Error creating object style' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Object Style");
    }

    /**
     * List all object styles
     */
    static async listObjectStyles() {
        const script = jsxProgram([
            ...JSX_HELPERS,
            'var styles = doc.allObjectStyles;',
            'var info = "=== OBJECT STYLES (" + styles.length + ") ===\\n";',
            'for (var i = 0; i < styles.length; i++) {',
            '  var s = styles[i];',
            '  info += "Name: " + s.name + "\\n";',
            '  try { info += "  Fill: " + (s.enableFill ? __name(s.fillColor) : "(not included)") + "\\n"; } catch (__e1) {}',
            '  try { info += "  Stroke: " + (s.enableStroke ? __name(s.strokeColor) + ", " + s.strokeWeight + "pt" : "(not included)") + "\\n"; } catch (__e2) {}',
            '  try { if (s.enableStrokeAndCornerOptions && s.topLeftCornerOption !== CornerOptions.NONE) { info += "  Corner Radius: " + __mm(s.topLeftCornerRadius) + "mm\\n"; } } catch (__e3) {}',
            '  try { if (s.objectEffectsEnablingSettings.enableTransparency) { info += "  Opacity: " + s.transparencySettings.blendingSettings.opacity + "%\\n"; } } catch (__e4) {}',
            '}',
            'return info;',
        ], { errorPrefix: 'Error listing object styles' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "List Object Styles");
    }

    /**
     * Apply object style to a page item
     */
    static async applyObjectStyle(args) {
        const { styleName, itemType = 'rectangle', itemIndex = 0, pageIndex, clearOverrides = false } = args;
        const kind = enumOf(itemType, ['rectangle', 'ellipse', 'polygon', 'textFrame', 'pageItem'], { name: 'itemType' });
        const collection = {
            rectangle: 'page.rectangles',
            ellipse: 'page.ovals',
            polygon: 'page.polygons',
            textFrame: 'page.textFrames',
            pageItem: '__all',
        }[kind];

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            `var style = __styleByName(doc.allObjectStyles, ${str(styleName)});`,
            `if (!style) { return ${str(`Error: object style '${styleName}' not found`)}; }`,
            ...(kind === 'pageItem' ? ['var __all = page.allPageItems;'] : []),
            ...jsxItemAt('item', collection, itemIndex, `${kind} index`),
            'if (item.locked) { return "Cannot apply object style: item is locked"; }',
            `item.applyObjectStyle(style, ${bool(clearOverrides)});`,
            `return ${str(`Object style '${styleName}' applied to `)} + item.constructor.name + " (ID " + item.id + ")";`,
        ], { errorPrefix: 'Error applying object style' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Apply Object Style");
    }

    /**
     * Get information about a placed graphic on a page
     */
    static async getImageInfo(args = {}) {
        const { itemIndex = 0, pageIndex } = args;
        const i = index(itemIndex, { name: 'itemIndex' });

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            'var graphics = page.allGraphics;',
            `if (${i} >= graphics.length) { return "Image index ${i} out of range (" + graphics.length + " placed graphics on page " + page.name + ")"; }`,
            `var graphic = graphics[${i}];`,
            'function __linkStatus(s) {',
            '  var names = ["NORMAL", "LINK_MISSING", "LINK_OUT_OF_DATE", "LINK_EMBEDDED", "LINK_INACCESSIBLE"];',
            '  for (var k = 0; k < names.length; k++) { if (s === LinkStatus[names[k]]) { return names[k]; } }',
            '  return String(s);',
            '}',
            'var pb = page.bounds;',
            'var info = "=== IMAGE INFORMATION ===\\n";',
            `info += "Image ${i} of " + graphics.length + " on page " + page.name + "\\n";`,
            'info += "  Type: " + graphic.constructor.name + "\\n";',
            'try { info += "  Format: " + graphic.imageTypeName + "\\n"; } catch (__te) {}',
            'var link = null;',
            'try { link = graphic.itemLink; } catch (__le) { link = null; }',
            'if (link) {',
            '  info += "  File Path: " + link.filePath + "\\n";',
            '  info += "  File Name: " + link.name + "\\n";',
            '  info += "  Link Status: " + __linkStatus(link.status) + "\\n";',
            '} else {',
            '  info += "  Link: none (pasted or embedded without link)\\n";',
            '}',
            'if (graphic.constructor.name === "Image") {',
            '  info += "  Actual PPI: " + graphic.actualPpi.join(" x ") + "\\n";',
            '  info += "  Effective PPI: " + graphic.effectivePpi.join(" x ") + "\\n";',
            '}',
            'info += "  Scale: " + Math.round(graphic.horizontalScale * 100) / 100 + "% x " + Math.round(graphic.verticalScale * 100) / 100 + "%\\n";',
            'var gb = graphic.geometricBounds;',
            'info += "  Image bounds (mm from page top-left): x=" + __mm(gb[1] - pb[1]) + ", y=" + __mm(gb[0] - pb[0]) + ", " + __mm(gb[3] - gb[1]) + " x " + __mm(gb[2] - gb[0]) + "\\n";',
            'try {',
            '  var fb = graphic.parent.geometricBounds;',
            '  info += "  Frame: " + graphic.parent.constructor.name + " (ID " + graphic.parent.id + "), x=" + __mm(fb[1] - pb[1]) + ", y=" + __mm(fb[0] - pb[0]) + ", " + __mm(fb[3] - fb[1]) + " x " + __mm(fb[2] - fb[0]) + " mm\\n";',
            '} catch (__fe) {}',
            'return info;',
        ], { errorPrefix: 'Error getting image information' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Get Image Info");
    }
}
