/**
 * Tools written as modules: each area file exports `tools`, each tool carrying
 * its definition, handler, the atlas feature ids it performs (`features`) and
 * its annotation hints (`hints`). New areas are added to AREAS with the help
 * category they appear under.
 */
import { tools as transformTools } from './transform.js';
import { tools as textFrameTools } from './text-frames.js';
import { tools as tableTools } from './tables.js';
import { tools as paragraphTools } from './paragraph.js';
import { tools as effectsTools } from './effects.js';

/** [area id, tools, help category { name, description }] */
export const AREAS = [
    ['transform', transformTools, { name: 'Transformations', description: 'Rotate, flip, scale, shear and align items, and transform them again' }],
    ['text_frames', textFrameTools, { name: 'Text frames and stories', description: 'Text Frame Options, text wrap, threading, type on a path, notes, track changes, Story Editor and editorial preferences' }],
    ['tables', tableTools, { name: 'Tables', description: 'Table and cell options, rows and columns, merging and splitting, converting text and tables, and selecting in tables' }],
    ['paragraph', paragraphTools, { name: 'Paragraph formatting', description: 'Indents, spacing, alignment, justification, hyphenation, keep options, rules, borders, shading, span columns, drop caps and nested styles; underline and strikethrough options' }],
    ['effects', effectsTools, { name: 'Effects and transparency', description: 'Opacity, blending and effects on items, global light, blend space and transparency flattening' }],
];

/** Every module tool, with its area. */
export const moduleTools = AREAS.flatMap(([area, list]) => list.map((t) => ({ ...t, area })));

/** Help categories for the module areas, in the shape HelpHandlers uses. */
export const moduleCategories = Object.fromEntries(AREAS.map(([area, list, info]) => [area, { ...info, tools: list.map((t) => t.name) }]));
