/**
 * Colour swatches from Illustrator into InDesign, with their exact values.
 */
import { bool, json, formatResponse } from 'adobe-mcp-core';
import { script as illustratorScript } from 'adobe-mcp-illustrator';
import { JSON_FN, runIn } from './jsx.js';

/** InDesign swatches that cannot be renamed or redefined. */
const RESERVED = ['None', 'Paper', 'Black', 'Registration', 'Cyan', 'Magenta', 'Yellow'];

export const copySwatches = {
    name: 'copy_swatches_illustrator_to_indesign',
    requires: ['illustrator', 'indesign'],
    description: 'Copy colour swatches from the active Illustrator document to the active InDesign document with their exact values: process colours in CMYK or RGB, spot colours as spot inks (by their base colour), and grays as CMYK black. Gradients and patterns are reported, not copied. Existing InDesign swatches are left alone unless overwrite is true; InDesign\'s built-in swatches are never changed',
    inputSchema: {
        type: 'object',
        properties: {
            names: { type: 'array', items: { type: 'string' }, description: 'Only these swatches. Default: every colour swatch' },
            overwrite: { type: 'boolean', description: 'Redefine InDesign swatches that already have the same name. Default false' },
        },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(apps, a) {
        const { illustrator, indesign } = apps;
        const only = Array.isArray(a.names) && a.names.length ? a.names.map(String) : null;

        const source = await runIn(illustrator, illustratorScript(`
var only = ${json(only)}, out = [], skipped = [];
for (var i = 0; i < doc.swatches.length; i++) {
  var s = doc.swatches[i], c = s.color, kind = c.typename, e = { name: s.name };
  if (s.name === "[None]" || s.name === "[Registration]") continue;
  if (only) { var wanted = false; for (var k = 0; k < only.length; k++) if (only[k] === s.name) wanted = true; if (!wanted) continue; }
  if (kind === "SpotColor") { e.spot = true; c = c.spot.color; kind = c.typename; }
  if (kind === "CMYKColor") { e.space = "CMYK"; e.value = [c.cyan, c.magenta, c.yellow, c.black]; }
  else if (kind === "RGBColor") { e.space = "RGB"; e.value = [c.red, c.green, c.blue]; }
  else if (kind === "GrayColor") { e.space = "CMYK"; e.value = [0, 0, 0, c.gray]; e.fromGray = true; }
  else if (kind === "LabColor") { e.space = "LAB"; e.value = [c.l, c.a, c.b]; }
  else { skipped.push({ name: s.name, kind: kind }); continue; }
  out.push(e);
}
__result__ = { colorMode: String(doc.documentColorSpace).replace("DocumentColorSpace.", ""), swatches: out, skipped: skipped };`));

        if (only) {
            const found = new Set([...source.swatches, ...source.skipped].map((s) => s.name));
            const missing = only.filter((n) => !found.has(n));
            if (missing.length) throw new Error(`Illustrator has no swatch named: ${missing.join(', ')}`);
        }

        const result = source.swatches.length ? await runIn(indesign, `${JSON_FN}
if (app.documents.length === 0) throw new Error("No document open in InDesign");
var doc = app.activeDocument, list = ${json(source.swatches)}, reserved = ${json(RESERVED)};
var created = [], updated = [], kept = [];
for (var i = 0; i < list.length; i++) {
  var e = list[i], isReserved = false;
  for (var r = 0; r < reserved.length; r++) if (reserved[r] === e.name) isReserved = true;
  var c = doc.colors.itemByName(e.name);
  if (c.isValid && (isReserved || !${bool(a.overwrite)})) { kept.push(e.name); continue; }
  var isNew = !c.isValid;
  if (isNew) { c = doc.colors.add(); c.name = e.name; }
  c.model = e.spot ? ColorModel.SPOT : ColorModel.PROCESS;
  c.space = ColorSpace[e.space];
  c.colorValue = e.value;
  (isNew ? created : updated).push(e.name);
}
__json({ created: created, updated: updated, kept: kept });`) : { created: [], updated: [], kept: [] };

        return formatResponse({
            from: { colorMode: source.colorMode, swatches: source.swatches.length },
            ...result,
            notCopied: source.skipped,
            note: 'Spot colours are copied as their base ink. Tints are not copied.',
        }, 'Copy swatches from Illustrator to InDesign');
    },
};
