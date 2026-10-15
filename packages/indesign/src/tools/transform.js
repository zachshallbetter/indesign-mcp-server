/**
 * Transformations: rotate and flip in fixed steps, and clear transformations.
 */
import { enumOf } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';

/** Object > Transform commands, as object-model calls on `it`. */
export const TURNS = {
    rotate_90_cw: 'it.rotationAngle = it.rotationAngle - 90;',
    rotate_90_ccw: 'it.rotationAngle = it.rotationAngle + 90;',
    rotate_180: 'it.rotationAngle = it.rotationAngle + 180;',
    flip_horizontal: 'it.flipItem(Flip.HORIZONTAL);',
    flip_vertical: 'it.flipItem(Flip.VERTICAL);',
    clear_transformations: 'it.clearTransformations();',
};

export const tools = [
    {
        name: 'turn_items',
        description: 'Rotate items 90° clockwise, 90° counter-clockwise or 180°, flip them horizontally or vertically, or clear their transformations (Object > Transform)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(TURNS), description: 'What to do to each item' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'indesign.transformations.rotate_90_cw',
            'indesign.transformations.rotate_90_ccw',
            'indesign.transformations.rotate_180',
            'indesign.transformations.flip_horizontal',
            'indesign.transformations.flip_vertical',
            'indesign.transformations.clear_transformations',
        ],
        hints: { readOnly: false },
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(TURNS), { name: 'operation' });
            return run('Turn items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${TURNS[op]}
  out.push(__itemInfo(it));
}
__result__ = { operation: "${op}", items: out };`));
        },
    },
];
