/**
 * Essential Graphics and Motion Graphics templates: make a composition the
 * primary one in the Essential Graphics panel, name the template and its
 * controls, add property controls and media replacement, fill dropdown menus,
 * protect regions for Responsive Design - Time, and export a .mogrt file.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, PROPERTY_SCHEMA, compSpec, propertyPath } from '../args.js';
import { paths } from './project.js';

/** ES3: the composition's Essential Graphics controls, by 1-based index. */
const CONTROLS = `
function __controls(c) {
  var out = [];
  for (var i = 1; i <= c.motionGraphicsTemplateControllerCount; i++) out.push({ index: i, name: c.getMotionGraphicsTemplateControllerName(i) });
  return { comp: c.name, id: c.id, templateName: c.motionGraphicsTemplateName, controls: out };
}`;

/** A layer reference (1-based index or name) as a __layers() spec. */
function layerRef(value, name) {
    if (typeof value === 'number') return { indexes: [Number(num(value, { min: 1, max: 10000, name }))] };
    if (typeof value === 'string' && value.trim()) return { names: [value] };
    throw new Error(`'${name}' must be a layer index (1-based) or a layer name`);
}

/** Dropdown Menu Control items: 1 to 100 unique, non-empty strings without "|". */
function dropdownItems(items, name) {
    if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error(`'${name}' must list 1 to 100 menu items`);
    const out = items.map(String);
    for (const v of out) if (!v.trim() || v.includes('|')) throw new Error(`'${name}': menu items must be non-empty and must not contain "|"`);
    if (new Set(out).size !== out.length) throw new Error(`'${name}': menu items must be unique`);
    return out;
}

export const tools = [
    {
        name: 'set_essential_graphics',
        description: 'Open a composition in the Essential Graphics panel as its primary composition (Composition > Open in Essential Graphics), set the template name, rename controls, and list the controls',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                open: { type: 'boolean', description: 'Open the composition in the Essential Graphics panel. Default true', default: true },
                templateName: { type: 'string', description: 'Template name shown in the panel and in Premiere Pro; also the exported file name' },
                renameControls: {
                    type: 'array',
                    description: 'Controls to rename',
                    items: {
                        type: 'object',
                        properties: { index: { type: 'integer', minimum: 1, description: '1-based control index in the panel' }, name: { type: 'string', description: 'New control name' } },
                        required: ['index', 'name'],
                    },
                },
            },
        },
        auditArgs: { templateName: 'Lower Third', renameControls: [{ index: 1, name: 'Title' }] },
        hints: { idempotent: true },
        features: [
            'aftereffects.essential_graphics.essential_graphics_panel',
            'aftereffects.essential_graphics.open_in_essential_graphics',
            'aftereffects.essential_graphics.primary_composition',
            'aftereffects.essential_graphics.template_name',
            'aftereffects.essential_graphics.control_names',
        ],
        handler: (a) => {
            const renames = (a.renameControls ?? []).map((r, i) => {
                if (!r || typeof r.name !== 'string' || !r.name.trim()) throw new Error(`'renameControls[${i}].name' must be text`);
                const n = Number(index(r.index, { name: `renameControls[${i}].index`, max: 10000 }));
                if (n < 1) throw new Error(`'renameControls[${i}].index' is 1-based`);
                return [n, r.name];
            });
            if (a.templateName !== undefined && (typeof a.templateName !== 'string' || !a.templateName.trim())) throw new Error("'templateName' must be text");
            return run('Essential Graphics', script(`${CONTROLS}
var c = __comp(${compSpec(a.comp)}), renames = ${json(renames)};
${a.open === false ? '' : 'c.openInEssentialGraphics();'}
${a.templateName !== undefined ? `c.motionGraphicsTemplateName = ${str(a.templateName)};` : ''}
for (var i = 0; i < renames.length; i++) {
  if (renames[i][0] > c.motionGraphicsTemplateControllerCount) throw new Error("Control " + renames[i][0] + " does not exist; the panel has " + c.motionGraphicsTemplateControllerCount);
  c.setMotionGraphicsControllerName(renames[i][0], renames[i][1]);
}
__result__ = __controls(c);`, { undo: 'Essential Graphics' }));
        },
    },
    {
        name: 'add_essential_graphics_controls',
        description: 'Add controls to a composition\'s Essential Graphics panel (Animation > Add Property to Essential Graphics): properties such as Source Text, colours, sliders, checkboxes, angles, 2D points and scale, Dropdown Menu Controls (optionally setting their menu items) and 3D shadow colour, or footage and precomposition layers as media replacement. A nested composition then shows them as Essential Properties',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                controls: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 200,
                    description: 'Controls to add, in order',
                    items: {
                        type: 'object',
                        properties: {
                            layer: { description: 'Layer index (1-based) or name', oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }] },
                            property: { ...PROPERTY_SCHEMA, description: `${PROPERTY_SCHEMA.description}. Omit to add the layer itself as media replacement` },
                            name: { type: 'string', description: 'Control name in the panel' },
                            menuItems: { type: 'array', items: { type: 'string' }, description: 'For a Dropdown Menu Control\'s Menu property: the menu items (unique, no "|")' },
                        },
                        required: ['layer'],
                    },
                },
            },
            required: ['controls'],
        },
        auditArgs: { controls: [{ layer: 1, property: 'source_text', name: 'Title' }, { layer: 'Menu', property: ['ADBE Effect Parade', 'Dropdown Menu Control', 'Menu'], menuItems: ['Left', 'Right'] }, { layer: 2 }] },
        features: [
            'aftereffects.essential_graphics.add_property_to_essential_graphics',
            'aftereffects.essential_graphics.control_type.checkbox',
            'aftereffects.essential_graphics.control_type.color',
            'aftereffects.essential_graphics.control_type.numerical_slider',
            'aftereffects.essential_graphics.control_type.source_text',
            'aftereffects.essential_graphics.control_type.n2d_point',
            'aftereffects.essential_graphics.control_type.n2d_scale',
            'aftereffects.essential_graphics.control_type.angle',
            'aftereffects.essential_graphics.control_type.dropdown_menu',
            'aftereffects.essential_graphics.control_type.shadow_color_3d_layer',
            'aftereffects.essential_graphics.control_type.media_replacement',
            'aftereffects.essential_graphics.control_names',
            'aftereffects.essential_graphics.essential_properties',
            'aftereffects.essential_graphics.media_replacement',
            'aftereffects.essential_graphics.dropdown_menu_controls',
        ],
        handler: (a) => {
            if (!Array.isArray(a.controls) || !a.controls.length) throw new Error("'controls' must list at least one control");
            if (a.controls.length > 200) throw new Error("'controls' takes at most 200 controls");
            const specs = a.controls.map((c, i) => {
                const at = `controls[${i}]`;
                if (!c || typeof c !== 'object') throw new Error(`'${at}' must be an object`);
                const s = { layer: layerRef(c.layer, `${at}.layer`) };
                if (c.property !== undefined) s.path = JSON.parse(propertyPath(c.property, `${at}.property`));
                if (c.name !== undefined) {
                    if (typeof c.name !== 'string' || !c.name.trim()) throw new Error(`'${at}.name' must be text`);
                    s.label = c.name;
                }
                if (c.menuItems !== undefined) {
                    if (!s.path) throw new Error(`'${at}.menuItems' needs the Dropdown Menu Control's Menu property`);
                    s.items = dropdownItems(c.menuItems, `${at}.menuItems`);
                }
                return s;
            });
            return run('Add Essential Graphics controls', script(`${CONTROLS}
var c = __comp(${compSpec(a.comp)}), specs = ${json(specs)}, added = [];
for (var i = 0; i < specs.length; i++) {
  var s = specs[i], l = __layers(c, s.layer)[0], ok;
  if (s.path) {
    var p = __prop(l, s.path);
    if (s.items) {
      if (!p.isDropdownEffect) throw new Error(p.name + " on layer " + l.name + " is not a Dropdown Menu Control's Menu property");
      p = p.setPropertyParameters(s.items);
    }
    if (!p.canAddToMotionGraphicsTemplate(c)) throw new Error(p.name + " on layer " + l.name + " cannot be added to the Essential Graphics panel");
    ok = s.label ? p.addToMotionGraphicsTemplateAs(c, s.label) : p.addToMotionGraphicsTemplate(c);
    added.push({ layer: l.index, property: p.name, added: ok });
  } else {
    if (!(l instanceof AVLayer) || !l.canAddToMotionGraphicsTemplate(c)) throw new Error("Layer " + l.name + " cannot be added as media replacement: use a footage or precomposition layer");
    ok = s.label ? l.addToMotionGraphicsTemplateAs(c, s.label) : l.addToMotionGraphicsTemplate(c);
    added.push({ layer: l.index, mediaReplacement: true, added: ok });
  }
}
var info = __controls(c); info.added = added;
__result__ = info;`, { undo: 'Add Essential Graphics controls' }));
        },
    },
    {
        name: 'add_protected_region',
        description: 'Protect part of a composition\'s timing so it keeps its length when the composition is nested or the template is stretched (Composition > Responsive Design - Time > Create Intro, Create Outro or Create Protected Region from Work Area), or protect a custom span: a composition marker with Protected Region on',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                region: { type: 'string', enum: ['intro', 'outro', 'work_area', 'custom'], description: 'intro: the first 15% of the duration; outro: the last 15%; work_area; custom: start and duration' },
                start: { type: 'number', minimum: 0, description: 'custom: start, seconds' },
                duration: { type: 'number', minimum: 0.001, description: 'custom: duration, seconds' },
                comment: { type: 'string', description: 'Marker comment' },
            },
            required: ['region'],
        },
        auditArgs: { region: 'custom', start: 1, duration: 2, comment: 'Hold' },
        features: [
            'aftereffects.essential_graphics.responsive_design_time',
            'aftereffects.essential_graphics.responsive_design_create_intro',
            'aftereffects.essential_graphics.responsive_design_create_outro',
            'aftereffects.essential_graphics.responsive_design_create_protected_region_from_work_area',
            'aftereffects.essential_graphics.protected_region_marker',
        ],
        handler: (a) => {
            const region = enumOf(a.region, ['intro', 'outro', 'work_area', 'custom'], { name: 'region' });
            if (region === 'custom' && (a.start === undefined || a.duration === undefined)) throw new Error("A custom region needs start and duration");
            if (region !== 'custom' && (a.start !== undefined || a.duration !== undefined)) throw new Error("start and duration go with region: 'custom'");
            const span = {
                intro: 'var t = 0, d = c.duration * 0.15;',
                outro: 'var d = c.duration * 0.15, t = c.duration - d;',
                work_area: 'var t = c.workAreaStart, d = c.workAreaDuration;',
                custom: region === 'custom' ? `var t = ${num(a.start, { min: 0, name: 'start' })}, d = ${num(a.duration, { min: 0.001, name: 'duration' })};` : '',
            }[region];
            return run('Protected region', script(`
var c = __comp(${compSpec(a.comp)});
${span}
if (t + d > c.duration + 0.0001) throw new Error("The region ends after the composition (" + c.duration + " s)");
var m = new MarkerValue(${str(a.comment ?? '')});
m.duration = d;
m.protectedRegion = true;
c.markerProperty.setValueAtTime(t, m);
__result__ = { comp: c.name, region: ${str(region)}, start: t, duration: d, markers: c.markerProperty.numKeys };`, { undo: 'Protected region' }));
        },
    },
    {
        name: 'export_motion_graphics_template',
        description: 'Export a composition as a Motion Graphics template (.mogrt) (File > Export > Export As Motion Graphics Template) to the Local Templates Folder or a folder on a local drive. The file is named after the template name',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                folder: { type: 'string', description: 'Absolute folder to save into. Omit for the Local Templates Folder (Essential Graphics templates)' },
                templateName: { type: 'string', description: 'Set the template name (and file name) first. Default: the current template name, or the composition name' },
                overwrite: { type: 'boolean', description: 'Replace a file of the same name. Default false', default: false },
            },
        },
        auditArgs: { folder: `${process.env.HOME ?? '/tmp'}/Documents/templates`, templateName: 'Lower Third' },
        hints: { destructive: true },
        features: [
            'aftereffects.essential_graphics.export_motion_graphics_template',
            'aftereffects.essential_graphics.export_destination.local_templates_folder',
            'aftereffects.essential_graphics.export_destination.local_drive',
            'aftereffects.essential_graphics.mogrt_file',
            'aftereffects.essential_graphics.template_name',
        ],
        handler: (a) => {
            if (a.templateName !== undefined && (typeof a.templateName !== 'string' || !a.templateName.trim())) throw new Error("'templateName' must be text");
            const dir = a.folder === undefined ? null : paths.validate(a.folder);
            return run('Export Motion Graphics template', script(`
var c = __comp(${compSpec(a.comp)});
${a.templateName !== undefined ? `c.motionGraphicsTemplateName = ${str(a.templateName)};` : 'if (!c.motionGraphicsTemplateName) c.motionGraphicsTemplateName = c.name;'}
${dir ? `var f = new Folder(${jsxPath(dir)});
if (!f.exists) throw new Error("Folder not found: " + f.fsName);
var ok = c.exportAsMotionGraphicsTemplate(${bool(a.overwrite)}, f.fsName);` : `var ok = c.exportAsMotionGraphicsTemplate(${bool(a.overwrite)});`}
if (!ok) throw new Error("After Effects did not export the template: check that the file does not exist (or pass overwrite: true) and that the composition uses only features templates support (Classic 3D renderer, no third-party effects)");
__result__ = { exported: true, templateName: c.motionGraphicsTemplateName, folder: ${dir ? 'f.fsName' : 'null'}, file: ${dir ? 'f.fsName + "/" + c.motionGraphicsTemplateName + ".mogrt"' : 'null'}, controls: c.motionGraphicsTemplateControllerCount };`));
        },
    },
];
