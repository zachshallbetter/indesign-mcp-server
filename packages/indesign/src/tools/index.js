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
import { tools as prepressTools } from './prepress.js';
import { tools as colorTools } from './color.js';
import { tools as framesTools } from './frames.js';
import { tools as layoutTools } from './layout.js';
import { tools as imagesTools } from './images.js';
import { tools as pathTools } from './paths.js';
import { tools as documentTools } from './documents.js';
import { tools as pageTools } from './pages.js';
import { tools as layerTools } from './layers.js';
import { tools as selectionTools } from './selection.js';
import { tools as historyTools } from './history.js';

/** [area id, tools, help category { name, description }] */
export const AREAS = [
    ['transform', transformTools, { name: 'Transformations', description: 'Rotate, flip, scale, shear and align items, and transform them again' }],
    ['character', characterTools, { name: 'Character formatting', description: 'Character, OpenType and CJK formatting, type commands, special characters and glyphs, change case, fonts, tabs, GREP styles, and bullets and numbering' }],
    ['text_frames', textFrameTools, { name: 'Text frames and stories', description: 'Text Frame Options, text wrap, threading, type on a path, notes, track changes, Story Editor and editorial preferences' }],
    ['tables', tableTools, { name: 'Tables', description: 'Table and cell options, rows and columns, merging and splitting, converting text and tables, and selecting in tables' }],
    ['paragraph', paragraphTools, { name: 'Paragraph formatting', description: 'Indents, spacing, alignment, justification, hyphenation, keep options, rules, borders, shading, span columns, drop caps and nested styles; underline and strikethrough options' }],
    ['paths', pathTools, { name: 'Paths and pathfinder', description: 'Drawing and editing paths and anchor points, joining, cutting, compound paths, Pathfinder, Convert Shape, corner options, clipping paths and Create Outlines' }],
    ['effects', effectsTools, { name: 'Effects and transparency', description: 'Opacity, blending and effects on items, global light, blend space and transparency flattening' }],
    ['xml', xmlTools, { name: 'XML structure and tags', description: 'XML elements, attributes, comments and processing instructions; tags, tagging presets and tag-to-style maps; DTD validation; XML import and export options' }],
    ['long_documents', longDocumentTools, { name: 'Long documents', description: 'Tables of contents, footnotes and endnotes, the index, conditional text, hyperlinks, cross-references, bookmarks, text variables, captions and books' }],
    ['styles', stylesTools, { name: 'Styles & Colors', description: 'Paragraph, character, object, table and cell styles: create, edit, group, apply, clear overrides, nested and GREP styles, load and defaults; swatches and colors' }],
    ['formats', formatsTools, { name: 'Import and export formats', description: 'Export PDF, interactive PDF, EPUB, HTML, JPEG, PNG, EPS and text with every option; place Word, Excel and text with import options; object export options, articles, and library, preflight, swatch and snippet files' }],
    ['interactive', interactiveTools, { name: 'Interactive documents', description: 'Buttons and their actions, form fields, multi-state objects, animation and timing, video and sound, page transitions and interactivity preview' }],
    ['prepress', prepressTools, { name: 'Printing and prepress', description: 'Print and Print Booklet with every option or a preset, to a printer or PostScript file; print and trap presets; preflight profiles, rules and options; inks, separations and overprint preview; print attributes; package report and options' }],
    ['color', colorTools, { name: 'Colour', description: 'Swatches, tints, mixed inks, colour groups, loading and saving swatches, the Ink Manager, gradients, fills and strokes, the eyedropper, colour settings, document profiles, proofing and image colour settings' }],
    ['frames', framesTools, { name: 'Frames and objects', description: 'Frames, shapes and lines; strokes and stroke styles; frame content type; stacking order; frame fitting; anchored objects; object library items; QR codes and math expressions' }],
    ['layout_tools', layoutTools, { name: 'Layout tools', description: 'Liquid, alternate and flex layouts, named grids, frame grids and the layout grid, linked content and the Content Collector, rulers and units, guides, measuring, gaps and accessible context breaks' }],
    ['images', imagesTools, { name: 'Images and links', description: 'Links panel: list, relink, update, embed and unembed links, open and reveal originals, InCopy check-in and check-out; placing images, PDF, InDesign pages, EPS and SVG with import options; image import and object layer options, cropping and moving frame content, contact sheets and the place cursor' }],
    ['documents', documentTools, { name: 'Documents and windows', description: 'New documents with every New Document option, document presets, Save a Copy, Save All, Revert, Close All, IDML for earlier versions, File Info, window arrangement, and margins and columns' }],
    ['pages_spreads', pageTools, { name: 'Pages, spreads and parents', description: 'Multi-page and split spreads, hidden spreads, page and spread navigation, Rotate Spread View, page number and section markers, parent page commands, page numbering and ruler views, and the Pages and Layers panels' }],
    ['layers', layerTools, { name: 'Layers', description: 'Layer Options, Layers panel commands, moving items between layers, and the objects on each layer' }],
    ['selection', selectionTools, { name: 'Selection and clipboard', description: 'Select commands, selection tools, cut, copy and paste variants, duplicating and Step and Repeat, and clipboard and drag-and-drop preferences' }],
    ['history', historyTools, { name: 'Undo and history', description: 'Undo, redo, stepping through and listing the document history' }],
];

/** Every module tool, with its area. */
export const moduleTools = AREAS.flatMap(([area, list]) => list.map((t) => ({ ...t, area })));

/** Help categories for the module areas, in the shape HelpHandlers uses. */
export const moduleCategories = Object.fromEntries(AREAS.map(([area, list, info]) => [area, { ...info, tools: list.map((t) => t.name) }]));
