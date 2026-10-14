/**
 * Style management handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, str, num, index, enumOf } from '../utils/stringUtils.js';
import { jsxProgram, jsxPage, jsxItemAt, jsxSwatch, jsxFont, JSX_HELPERS } from './pageItemHandlers.js';
import { justificationOf } from './aliases.js';

const has = (v) => v !== undefined && v !== null && v !== '';

const JSX_NAMES = [
    'function __justName(j) {',
    '  var names = ["LEFT_ALIGN", "CENTER_ALIGN", "RIGHT_ALIGN", "LEFT_JUSTIFIED", "RIGHT_JUSTIFIED", "CENTER_JUSTIFIED", "FULLY_JUSTIFIED", "TO_BINDING_SIDE", "AWAY_FROM_BINDING_SIDE"];',
    '  for (var i = 0; i < names.length; i++) { if (j === Justification[names[i]]) { return names[i]; } }',
    '  return String(j);',
    '}',
    'function __fontName(f) {',
    '  try { if (f === null || f === undefined) { return "[Not set]"; } return (typeof f === "string") ? f : f.name; } catch (__fe) { return "[Not set]"; }',
    '}',
];

export class StyleHandlers {
    /**
     * Create a paragraph style
     */
    static async createParagraphStyle(args) {
        const { name, fontName, fontSize, textColor, alignment, leading, spaceBefore, spaceAfter } = args;
        if (!has(name)) return formatResponse('Invalid style name: must be a non-empty string', 'Create Paragraph Style');

        const pre = [];
        const set = [];
        if (has(fontName)) { pre.push(...jsxFont('__font1', fontName)); set.push('style.appliedFont = __font1;'); }
        if (has(textColor)) { pre.push(...jsxSwatch('__color', textColor, 'text')); set.push('style.fillColor = __color;'); }
        if (has(fontSize)) set.push(`style.pointSize = ${num(fontSize, { name: 'fontSize', min: 0.1, max: 1296 })};`);
        if (has(alignment)) set.push(`style.justification = Justification.${justificationOf(alignment)};`);
        if (has(leading)) set.push(`style.leading = ${num(leading, { name: 'leading', min: 0, max: 5000 })};`);
        if (has(spaceBefore)) set.push(`style.spaceBefore = ${num(spaceBefore, { name: 'spaceBefore', min: 0, max: 10000 })};`);
        if (has(spaceAfter)) set.push(`style.spaceAfter = ${num(spaceAfter, { name: 'spaceAfter', min: 0, max: 10000 })};`);

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...JSX_NAMES,
            `if (__styleByName(doc.allParagraphStyles, ${str(name)})) { return ${str(`Cannot create paragraph style: '${name}' already exists`)}; }`,
            ...pre,
            `var style = doc.paragraphStyles.add({ name: ${str(name)} });`,
            ...set,
            `return ${str(`Paragraph style '${name}' created: font `)} + __fontName(style.appliedFont) + ", " + style.pointSize + "pt, " + __justName(style.justification);`,
        ], { errorPrefix: 'Error creating paragraph style' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Paragraph Style");
    }

    /**
     * Create a character style
     */
    static async createCharacterStyle(args) {
        const { name, fontName, fontSize, textColor, bold = false, italic = false, underline = false } = args;
        if (!has(name)) return formatResponse('Invalid style name: must be a non-empty string', 'Create Character Style');

        const pre = [];
        const set = [];
        if (has(fontName)) { pre.push(...jsxFont('__font1', fontName)); set.push('style.appliedFont = __font1;'); }
        if (has(textColor)) { pre.push(...jsxSwatch('__color', textColor, 'text')); set.push('style.fillColor = __color;'); }
        if (has(fontSize)) set.push(`style.pointSize = ${num(fontSize, { name: 'fontSize', min: 0.1, max: 1296 })};`);
        // Bold/italic select the font style of the applied (or inherited) family.
        const fontStyle = bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : null;
        if (fontStyle) set.push(`style.fontStyle = ${str(fontStyle)};`);
        if (underline) set.push('style.underline = true;');

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...JSX_NAMES,
            `if (__styleByName(doc.allCharacterStyles, ${str(name)})) { return ${str(`Cannot create character style: '${name}' already exists`)}; }`,
            ...pre,
            `var style = doc.characterStyles.add({ name: ${str(name)} });`,
            ...set,
            `return ${str(`Character style '${name}' created`)} + ${has(fontName) ? '": font " + __fontName(style.appliedFont)' : '""'} + ${fontStyle ? '", style " + style.fontStyle' : '""'};`,
        ], { errorPrefix: 'Error creating character style' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Character Style");
    }

    /**
     * Apply a paragraph style to all paragraphs in a text frame
     */
    static async applyParagraphStyle(args) {
        const { styleName, frameIndex = 0, pageIndex } = args;

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            ...jsxItemAt('textFrame', 'page.textFrames', frameIndex, 'Text frame index'),
            `var style = __styleByName(doc.allParagraphStyles, ${str(styleName)});`,
            `if (!style) { return ${str(`Error: paragraph style '${styleName}' not found`)}; }`,
            'textFrame.texts[0].appliedParagraphStyle = style;',
            `return ${str(`Paragraph style '${styleName}' applied to `)} + textFrame.paragraphs.length + " paragraph(s)";`,
        ], { errorPrefix: 'Error applying paragraph style' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Apply Paragraph Style");
    }

    /**
     * Apply a character style to a text frame's text or a character range
     */
    static async applyCharacterStyle(args) {
        const { styleName, frameIndex = 0, startIndex = 0, endIndex = -1, pageIndex } = args;
        const whole = Number(endIndex) === -1;
        const start = index(startIndex, { name: 'startIndex', max: 1e7 });
        const end = whole ? null : index(endIndex, { name: 'endIndex', max: 1e7 });
        if (!whole && Number(end) < Number(start)) {
            return formatResponse('Invalid range: endIndex must be >= startIndex (or -1 for the whole frame)', 'Apply Character Style');
        }

        const target = whole
            ? ['textFrame.texts[0].appliedCharacterStyle = style;', 'var count = textFrame.texts[0].characters.length;']
            : [
                'var chars = textFrame.texts[0].characters;',
                `if (${end} >= chars.length) { return "Character index ${end} out of range (frame has " + chars.length + " characters)"; }`,
                `chars.itemByRange(${start}, ${end}).appliedCharacterStyle = style;`,
                `var count = ${Number(end) - Number(start) + 1};`,
            ];

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            ...jsxItemAt('textFrame', 'page.textFrames', frameIndex, 'Text frame index'),
            `var style = __styleByName(doc.allCharacterStyles, ${str(styleName)});`,
            `if (!style) { return ${str(`Error: character style '${styleName}' not found`)}; }`,
            ...target,
            `return ${str(`Character style '${styleName}' applied to `)} + count + " character(s)";`,
        ], { errorPrefix: 'Error applying character style' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Apply Character Style");
    }

    /**
     * List all styles in the document
     */
    static async listStyles(args = {}) {
        const { styleType = 'ALL' } = args;
        const type = enumOf(String(styleType).toUpperCase(), ['PARAGRAPH', 'CHARACTER', 'ALL'], { name: 'styleType' });
        const para = type !== 'CHARACTER';
        const chr = type !== 'PARAGRAPH';

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...JSX_NAMES,
            'var info = "=== STYLES LIST ===\\n";',
            ...(para ? [
                'var ps = doc.allParagraphStyles;',
                'info += "\\n=== PARAGRAPH STYLES (" + ps.length + ") ===\\n";',
                'for (var i = 0; i < ps.length; i++) {',
                '  var p = ps[i];',
                '  info += "Name: " + p.name + "\\n";',
                '  try { info += "  Font: " + __fontName(p.appliedFont) + (p.fontStyle ? " " + p.fontStyle : "") + "\\n"; } catch (__e1) {}',
                '  try { info += "  Size: " + p.pointSize + "pt\\n"; } catch (__e2) {}',
                '  try { info += "  Alignment: " + __justName(p.justification) + "\\n"; } catch (__e3) {}',
                '  try { info += "  Color: " + __name(p.fillColor) + "\\n"; } catch (__e4) {}',
                '}',
            ] : []),
            ...(chr ? [
                'var cs = doc.allCharacterStyles;',
                'info += "\\n=== CHARACTER STYLES (" + cs.length + ") ===\\n";',
                'for (var j = 0; j < cs.length; j++) {',
                '  var c = cs[j];',
                '  info += "Name: " + c.name + "\\n";',
                '  try { info += "  Font: " + __fontName(c.appliedFont) + "\\n"; } catch (__e5) {}',
                '  try { if (typeof c.fontStyle === "string") { info += "  Style: " + c.fontStyle + "\\n"; } } catch (__e6) {}',
                '  try { if (typeof c.pointSize === "number") { info += "  Size: " + c.pointSize + "pt\\n"; } } catch (__e7) {}',
                '  try { info += "  Color: " + __name(c.fillColor) + "\\n"; } catch (__e8) {}',
                '}',
            ] : []),
            'return info;',
        ], { errorPrefix: 'Error listing styles' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "List Styles");
    }

    /**
     * Create a color swatch from RGB values (stored as RGB or converted to CMYK)
     */
    static async createColorSwatch(args) {
        const { name, colorType = 'PROCESS', colorSpace = 'RGB', red, green, blue } = args;
        if (!has(name)) return formatResponse('Invalid swatch name: must be a non-empty string', 'Create Color Swatch');

        const model = enumOf(String(colorType).toUpperCase(), ['PROCESS', 'SPOT'], { name: 'colorType' });
        const space = enumOf(String(colorSpace).toUpperCase(), ['RGB', 'CMYK'], { name: 'colorSpace' });
        const r = Number(num(red, { name: 'red', min: 0, max: 255 }));
        const g = Number(num(green, { name: 'green', min: 0, max: 255 }));
        const b = Number(num(blue, { name: 'blue', min: 0, max: 255 }));

        let values;
        if (space === 'RGB') {
            values = [r, g, b];
        } else {
            // Naive RGB -> CMYK (no colour management).
            const rr = r / 255, gg = g / 255, bb = b / 255;
            const max = Math.max(rr, gg, bb);
            const k = 1 - max;
            const c = max === 0 ? 0 : (max - rr) / max;
            const m = max === 0 ? 0 : (max - gg) / max;
            const y = max === 0 ? 0 : (max - bb) / max;
            values = [c, m, y, k].map((v) => Math.round(v * 100));
        }

        const script = jsxProgram([
            ...JSX_HELPERS,
            `if (doc.swatches.itemByName(${str(name)}).isValid) { return ${str(`Cannot create swatch: '${name}' already exists`)}; }`,
            `var color = doc.colors.add({ name: ${str(name)}, model: ColorModel.${model}, space: ColorSpace.${space}, colorValue: [${values.join(', ')}] });`,
            `return ${str(`Color swatch '${name}' created (${model} ${space} [`)} + color.colorValue.join(", ") + ${str(`] from RGB ${r}, ${g}, ${b})`)};`,
        ], { errorPrefix: 'Error creating color swatch' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Color Swatch");
    }

    /**
     * List all color swatches
     */
    static async listColorSwatches() {
        const script = jsxProgram([
            'function __enumName(v, e, names) {',
            '  for (var i = 0; i < names.length; i++) { if (v === e[names[i]]) { return names[i]; } }',
            '  return String(v);',
            '}',
            'var info = "=== COLOR SWATCHES ===\\n";',
            'var sw = doc.swatches.everyItem().getElements();',
            'for (var i = 0; i < sw.length; i++) {',
            '  var s = sw[i];',
            '  info += "Name: " + s.name + " (" + s.constructor.name + ")\\n";',
            '  if (s.constructor.name === "Color") {',
            '    try {',
            '      info += "  Model: " + __enumName(s.model, ColorModel, ["PROCESS", "SPOT", "REGISTRATION", "MIXEDINKMODEL"]) + "\\n";',
            '      info += "  Space: " + __enumName(s.space, ColorSpace, ["CMYK", "RGB", "LAB", "HSB", "MIXEDINK"]) + "\\n";',
            '      info += "  Values: [" + s.colorValue.join(", ") + "]\\n";',
            '    } catch (__ce) {}',
            '  }',
            '}',
            'return info;',
        ], { errorPrefix: 'Error listing swatches' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "List Color Swatches");
    }

    /**
     * Apply a swatch as fill or stroke to a page item or to a text frame's text
     */
    static async applyColor(args) {
        const { itemIndex = 0, colorName, colorType = 'FILL', targetType = 'pageItem', pageIndex } = args;
        if (!has(colorName)) return formatResponse('Invalid colorName: must be a swatch name or #RRGGBB', 'Apply Color');

        const prop = enumOf(String(colorType).toUpperCase(), ['FILL', 'STROKE'], { name: 'colorType' }) === 'FILL' ? 'fillColor' : 'strokeColor';
        const kind = enumOf(targetType, ['pageItem', 'text', 'textFrame', 'rectangle', 'ellipse', 'polygon'], { name: 'targetType' });
        const collection = {
            pageItem: '__all',
            text: 'page.textFrames',
            textFrame: 'page.textFrames',
            rectangle: 'page.rectangles',
            ellipse: 'page.ovals',
            polygon: 'page.polygons',
        }[kind];

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            ...jsxSwatch('color', colorName),
            ...(kind === 'pageItem' ? ['var __all = page.allPageItems;'] : []),
            ...jsxItemAt('obj', collection, itemIndex, `${kind} index`),
            ...(kind === 'text'
                ? [`obj.texts[0].${prop} = color;`]
                : ['if (obj.locked) { return "Cannot apply color: object is locked"; }', `obj.${prop} = color;`]),
            `return ${str(`Color '${colorName}' applied as ${prop === 'fillColor' ? 'fill' : 'stroke'} to ${kind} `)} + ${index(itemIndex, { name: 'itemIndex' })} + " (" + obj.constructor.name + ")";`,
        ], { errorPrefix: 'Error applying color' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Apply Color");
    }
}
