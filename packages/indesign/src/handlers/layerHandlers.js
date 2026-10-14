/**
 * Layer management handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, str, bool, num, enumOf, ALLOWED } from '../utils/stringUtils.js';

/**
 * Turn a caller-supplied color into a JSX expression valid for
 * Layer.layerColor / Spread.createGuides(guideColor):
 *   - a UIColors name ("BLUE", "light blue", "Light_Blue") -> UIColors.LIGHT_BLUE
 *   - "R,G,B" (0-255 each) or [R, G, B]                    -> [R, G, B]
 * Throws on anything else, so no raw caller text reaches the script.
 */
export function uiColorExpr(value, { name = 'color' } = {}) {
    let parts = null;
    if (Array.isArray(value)) parts = value;
    else if (typeof value === 'string' && value.includes(',')) parts = value.split(',').map((s) => s.trim());
    if (parts) {
        if (parts.length !== 3) {
            throw new Error(`Invalid value for '${name}': expected 3 RGB components, got ${JSON.stringify(value)}`);
        }
        return `[${parts.map((p) => num(p === '' ? NaN : p, { min: 0, max: 255, name })).join(', ')}]`;
    }
    const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
    return `UIColors.${enumOf(key, ALLOWED.uiColor, { name })}`;
}

const NO_DOC = [
    'if (app.documents.length === 0) {',
    '  "No document open";',
    '} else {',
    '  var doc = app.activeDocument;',
];

export class LayerHandlers {
    /**
     * Create a new layer in the active document.
     */
    static async createLayer(args = {}) {
        const { name, visible = true, locked = false, color = 'BLUE' } = args;
        if (typeof name !== 'string' || !name.trim()) {
            throw new Error("Invalid value for 'name': layer name must be a non-empty string");
        }
        const colorExpr = uiColorExpr(color, { name: 'color' });

        const script = [
            ...NO_DOC,
            `  var layerName = ${str(name)};`,
            '  if (doc.layers.itemByName(layerName).isValid) {',
            '    "Cannot create layer: a layer named \\"" + layerName + "\\" already exists";',
            '  } else {',
            '    try {',
            `      var layer = doc.layers.add({ name: layerName, layerColor: ${colorExpr}, visible: ${bool(visible)} });`,
            // Lock last: properties of a locked layer can still be set, but locking
            // after creation keeps the intent explicit.
            `      layer.locked = ${bool(locked)};`,
            '      "Layer created: " + layer.name + " (index " + layer.index + ", visible: " + layer.visible + ", locked: " + layer.locked + ", color: " + layer.layerColor + "). Total layers: " + doc.layers.length;',
            '    } catch (error) {',
            '      "Error creating layer: " + error.message;',
            '    }',
            '  }',
            '}',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Create Layer');
    }

    /**
     * Make an existing layer the document's active layer.
     */
    static async setActiveLayer(args = {}) {
        const { layerName } = args;
        if (typeof layerName !== 'string' || !layerName.trim()) {
            throw new Error("Invalid value for 'layerName': must be a non-empty string");
        }

        const script = [
            ...NO_DOC,
            `  var layerName = ${str(layerName)};`,
            '  var layer = doc.layers.itemByName(layerName);',
            '  if (!layer.isValid) {',
            '    "Error: layer \\"" + layerName + "\\" not found";',
            '  } else {',
            '    try {',
            '      doc.activeLayer = layer;',
            '      var note = "";',
            '      if (!layer.visible) note += " (layer is hidden)";',
            '      if (layer.locked) note += " (layer is locked)";',
            '      "Active layer set to: " + doc.activeLayer.name + note;',
            '    } catch (error) {',
            '      "Error setting active layer: " + error.message;',
            '    }',
            '  }',
            '}',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Set Active Layer');
    }

    /**
     * List all layers in the active document (top of the stack first).
     */
    static async listLayers() {
        const script = [
            ...NO_DOC,
            '  var layers = doc.layers;',
            '  var activeName = doc.activeLayer ? doc.activeLayer.name : "";',
            '  var out = "=== LAYERS ===\\n";',
            '  out += "Total layers: " + layers.length + "\\n";',
            '  out += "Active layer: " + activeName + "\\n\\n";',
            '  for (var i = 0; i < layers.length; i++) {',
            '    var layer = layers[i];',
            '    out += "Layer " + i + ": " + layer.name + (layer.name === activeName ? " [active]" : "") + "\\n";',
            '    out += "  Visible: " + layer.visible + "\\n";',
            '    out += "  Locked: " + layer.locked + "\\n";',
            '    out += "  Printable: " + layer.printable + "\\n";',
            '    out += "  Color: " + layer.layerColor + "\\n";',
            '    out += "  Page items: " + layer.pageItems.length + "\\n";',
            '    out += "  Guides: " + layer.guides.length + "\\n";',
            '  }',
            '  out;',
            '}',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'List Layers');
    }
}
