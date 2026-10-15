/**
 * Tools written as modules: each area file exports `tools`, each tool carrying
 * its definition, handler, the atlas feature ids it performs (`features`) and
 * its annotation hints (`hints`). New areas are added to AREAS with the help
 * category they appear under.
 */
import { tools as transformTools } from './transform.js';
import { tools as paragraphTools } from './paragraph.js';

/** [area id, tools, help category { name, description }] */
export const AREAS = [
    ['transform', transformTools, { name: 'Transformations', description: 'Rotate, flip, scale, shear and align items, and transform them again' }],
    ['paragraph', paragraphTools, { name: 'Paragraph formatting', description: 'Indents, spacing, alignment, justification, hyphenation, keep options, rules, borders, shading, span columns, drop caps and nested styles; underline and strikethrough options' }],
];

/** Every module tool, with its area. */
export const moduleTools = AREAS.flatMap(([area, list]) => list.map((t) => ({ ...t, area })));

/** Help categories for the module areas, in the shape HelpHandlers uses. */
export const moduleCategories = Object.fromEntries(AREAS.map(([area, list, info]) => [area, { ...info, tools: list.map((t) => t.name) }]));
