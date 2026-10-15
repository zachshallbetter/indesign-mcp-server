/**
 * Tools written as modules: each area file exports `tools`, each tool carrying
 * its definition, handler, the atlas feature ids it performs (`features`) and
 * its annotation hints (`hints`). New areas are added to AREAS with the help
 * category they appear under.
 */
import { tools as transformTools } from './transform.js';
import { tools as characterTools } from './character.js';
import { tools as textFrameTools } from './text-frames.js';
import { tools as tableTools } from './tables.js';
import { tools as paragraphTools } from './paragraph.js';
import { tools as effectsTools } from './effects.js';
import { tools as xmlTools } from './xml.js';
import { tools as longDocumentTools } from './long-documents.js';
import { tools as stylesTools } from './styles.js';
import { tools as formatsTools } from './formats.js';
import { tools as interactiveTools } from './interactive.js';

/** [area id, tools, help category { name, description }] */
export const AREAS = [
    ['transform', transformTools, { name: 'Transformations', description: 'Rotate, flip, scale, shear and align items, and transform them again' }],
    ['character', characterTools, { name: 'Character formatting', description: 'Character, OpenType and CJK formatting, type commands, special characters and glyphs, change case, fonts, tabs, GREP styles, and bullets and numbering' }],
    ['text_frames', textFrameTools, { name: 'Text frames and stories', description: 'Text Frame Options, text wrap, threading, type on a path, notes, track changes, Story Editor and editorial preferences' }],
    ['tables', tableTools, { name: 'Tables', description: 'Table and cell options, rows and columns, merging and splitting, converting text and tables, and selecting in tables' }],
    ['paragraph', paragraphTools, { name: 'Paragraph formatting', description: 'Indents, spacing, alignment, justification, hyphenation, keep options, rules, borders, shading, span columns, drop caps and nested styles; underline and strikethrough options' }],
    ['effects', effectsTools, { name: 'Effects and transparency', description: 'Opacity, blending and effects on items, global light, blend space and transparency flattening' }],
    ['xml', xmlTools, { name: 'XML structure and tags', description: 'XML elements, attributes, comments and processing instructions; tags, tagging presets and tag-to-style maps; DTD validation; XML import and export options' }],
    ['long_documents', longDocumentTools, { name: 'Long documents', description: 'Tables of contents, footnotes and endnotes, the index, conditional text, hyperlinks, cross-references, bookmarks, text variables, captions and books' }],
    ['styles', stylesTools, { name: 'Styles & Colors', description: 'Paragraph, character, object, table and cell styles: create, edit, group, apply, clear overrides, nested and GREP styles, load and defaults; swatches and colors' }],
    ['formats', formatsTools, { name: 'Import and export formats', description: 'Export PDF, interactive PDF, EPUB, HTML, JPEG, PNG, EPS and text with every option; place Word, Excel and text with import options; object export options, articles, and library, preflight, swatch and snippet files' }],
    ['interactive', interactiveTools, { name: 'Interactive documents', description: 'Buttons and their actions, form fields, multi-state objects, animation and timing, video and sound, page transitions and interactivity preview' }],
];

/** Every module tool, with its area. */
export const moduleTools = AREAS.flatMap(([area, list]) => list.map((t) => ({ ...t, area })));

/** Help categories for the module areas, in the shape HelpHandlers uses. */
export const moduleCategories = Object.fromEntries(AREAS.map(([area, list, info]) => [area, { ...info, tools: list.map((t) => t.name) }]));
