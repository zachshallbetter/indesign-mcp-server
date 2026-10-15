/**
 * Masks: add rectangle, ellipse or path masks to layers, and set their mode,
 * feather, opacity, expansion and inversion.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, compSpec, layerSpec } from '../args.js';

const MODES = { add: 'ADD', subtract: 'SUBTRACT', intersect: 'INTERSECT', lighten: 'LIGHTEN', darken: 'DARKEN', difference: 'DIFFERENCE', none: 'NONE' };
const KAPPA = 0.5522847498;

/** Vertices and tangents for a rectangle or ellipse in layer coordinates. */
function shapeOf(kind, b, points) {
    if (kind === 'path') {
        if (!Array.isArray(points) || points.length < 2) throw new Error('A path mask needs at least two points');
        const v = points.map((p, i) => [Number(num(p?.[0], { name: `points[${i}][0]` })), Number(num(p?.[1], { name: `points[${i}][1]` }))]);
        return { v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) };
    }
    const x = Number(num(b?.x, { name: 'bounds.x' })), y = Number(num(b?.y, { name: 'bounds.y' }));
    const w = Number(num(b?.width, { min: 0.1, name: 'bounds.width' })), h = Number(num(b?.height, { min: 0.1, name: 'bounds.height' }));
    if (kind === 'rectangle') return { v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]] };
    const cx = x + w / 2, cy = y + h / 2, kx = (w / 2) * KAPPA, ky = (h / 2) * KAPPA;
    return {
        v: [[cx, y], [x + w, cy], [cx, y + h], [x, cy]],
        i: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
        o: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
    };
}

export const tools = [
    {
        name: 'add_mask',
        description: 'Add a mask to layers: a rectangle or ellipse from bounds, or a path from points, all in the layer\'s own pixel coordinates; with its mode, feather, opacity, expansion and inversion',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                shape: { type: 'string', enum: ['rectangle', 'ellipse', 'path'], description: 'Default rectangle' },
                bounds: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, description: 'Rectangle or ellipse bounds' },
                points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Path points [[x, y], ...]' },
                closed: { type: 'boolean', description: 'Path: closed. Default true', default: true },
                mode: { type: 'string', enum: Object.keys(MODES), description: 'Default add' },
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels' },
                opacity: { type: 'number', minimum: 0, maximum: 100 },
                expansion: { type: 'number', minimum: -1000, maximum: 1000, description: 'Pixels' },
                inverted: { type: 'boolean' },
                name: { type: 'string' },
            },
            required: ['layers'],
        },
        auditArgs: { shape: 'ellipse', bounds: { x: 10, y: 10, width: 200, height: 100 } },
        features: [],
        handler: (a) => {
            const kind = enumOf(a.shape ?? 'rectangle', ['rectangle', 'ellipse', 'path'], { name: 'shape' });
            const s = shapeOf(kind, a.bounds, a.points);
            return run('Add mask', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var masks = ls[i].property("ADBE Mask Parade");
  if (!masks) throw new Error(ls[i].name + " cannot take masks");
  var m = masks.addProperty("ADBE Mask Atom"), sh = new Shape();
  sh.vertices = ${json(s.v)}; sh.inTangents = ${json(s.i)}; sh.outTangents = ${json(s.o)}; sh.closed = ${kind === 'path' ? bool(a.closed ?? true) : 'true'};
  m.property("ADBE Mask Shape").setValue(sh);
  m.maskMode = MaskMode.${MODES[enumOf(a.mode ?? 'add', Object.keys(MODES), { name: 'mode' })]};
  ${a.feather !== undefined ? `m.property("ADBE Mask Feather").setValue([${num(a.feather, { min: 0, max: 1000, name: 'feather' })}, ${num(a.feather, { min: 0, max: 1000, name: 'feather' })}]);` : ''}
  ${a.opacity !== undefined ? `m.property("ADBE Mask Opacity").setValue(${num(a.opacity, { min: 0, max: 100, name: 'opacity' })});` : ''}
  ${a.expansion !== undefined ? `m.property("ADBE Mask Offset").setValue(${num(a.expansion, { min: -1000, max: 1000, name: 'expansion' })});` : ''}
  ${a.inverted !== undefined ? `m.inverted = ${bool(a.inverted)};` : ''}
  ${a.name ? `m.name = ${str(a.name)};` : ''}
  out.push({ layer: ls[i].index, mask: m.name, index: m.propertyIndex });
}
__result__ = { masks: out };`, { undo: 'Add mask' }));
        },
    },
];
