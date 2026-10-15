/**
 * Effects and transparency: opacity, blending and the nine effects on an
 * item's object, stroke, fill or content (Effects panel and dialog), clearing
 * them, global light, transparency blend space and display, transparency
 * flattener presets and spread flattening.
 *
 * Effect sizes, distances and widths are millimetres; angles are degrees;
 * opacity, noise, spread and choke are percentages.
 */
import { enumOf, num, index, bool, json, str } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec, COLOR_SCHEMA, colorSpec } from './run.js';

/** The Effects panel targets, as PageItem properties. */
export const EFFECT_TARGETS = {
    object: 'transparencySettings',
    stroke: 'strokeTransparencySettings',
    fill: 'fillTransparencySettings',
    content: 'contentTransparencySettings',
};

const BLEND_MODES = ['NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'COLOR_DODGE', 'COLOR_BURN',
    'DARKEN', 'LIGHTEN', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'];

// Field builders: each field is { prop, kind, ... } and becomes a schema property.
const pct = (prop, description) => ({ prop, kind: 'num', min: 0, max: 100, description });
const mm = (prop, description, min = 0, max = 1000) => ({ prop, kind: 'num', min, max, description: `${description} (mm)` });
const deg = (prop, description, min = -180, max = 180) => ({ prop, kind: 'num', min, max, description: `${description} (degrees, ${min} to ${max})` });
const flag = (prop, description) => ({ prop, kind: 'bool', description });
const pick = (prop, type, values, description) => ({ prop, kind: 'enum', type, values, description });
const blend = (prop = 'blendMode', what = 'the effect') => pick(prop, 'BlendMode', BLEND_MODES, `Blending mode of ${what}`);
const color = (prop = 'effectColor', what = 'The effect colour') => ({ prop, kind: 'color', description: `${what}: ${COLOR_SCHEMA.description}` });

/**
 * The effects of the Effects dialog. `enable` says how an effect is switched
 * on: a boolean `applied`, or a mode enum. Fields are listed in the order they
 * are written (global light before angle, distance before offsets).
 */
export const EFFECTS = {
    dropShadow: {
        prop: 'dropShadowSettings', label: 'Drop Shadow',
        enable: { prop: 'mode', on: 'ShadowMode.DROP', off: 'ShadowMode.NONE', test: 'ShadowMode.DROP' },
        fields: {
            blendMode: blend(), effectColor: color(), opacity: pct('opacity', 'Opacity (%)'),
            useGlobalLight: flag('useGlobalLight', 'Use the document\'s global light angle'),
            angle: deg('angle', 'Light angle'), distance: mm('distance', 'Distance from the item'),
            xOffset: mm('xOffset', 'Horizontal offset', -1000, 1000), yOffset: mm('yOffset', 'Vertical offset', -1000, 1000),
            size: mm('size', 'Blur size', 0, 50.8), spread: pct('spread', 'Spread (%)'), noise: pct('noise', 'Noise (%)'),
            knockedOut: flag('knockedOut', 'Object knocks out shadow'),
            honorOtherEffects: flag('honorOtherEffects', 'Shadow honors other effects'),
        },
    },
    innerShadow: {
        prop: 'innerShadowSettings', label: 'Inner Shadow',
        enable: { prop: 'applied' },
        fields: {
            blendMode: blend(), effectColor: color(), opacity: pct('opacity', 'Opacity (%)'),
            useGlobalLight: flag('useGlobalLight', 'Use the document\'s global light angle'),
            angle: deg('angle', 'Light angle'), distance: mm('distance', 'Distance from the edge'),
            xOffset: mm('xOffset', 'Horizontal offset', -1000, 1000), yOffset: mm('yOffset', 'Vertical offset', -1000, 1000),
            size: mm('size', 'Blur size', 0, 50.8), chokeAmount: pct('chokeAmount', 'Choke (%)'), noise: pct('noise', 'Noise (%)'),
        },
    },
    outerGlow: {
        prop: 'outerGlowSettings', label: 'Outer Glow',
        enable: { prop: 'applied' },
        fields: {
            blendMode: blend(), effectColor: color(), opacity: pct('opacity', 'Opacity (%)'),
            technique: pick('technique', 'GlowTechnique', ['SOFTER', 'PRECISE'], 'Glow technique'),
            size: mm('size', 'Glow size', 0, 50.8), spread: pct('spread', 'Spread (%)'), noise: pct('noise', 'Noise (%)'),
        },
    },
    innerGlow: {
        prop: 'innerGlowSettings', label: 'Inner Glow',
        enable: { prop: 'applied' },
        fields: {
            blendMode: blend(), effectColor: color(), opacity: pct('opacity', 'Opacity (%)'),
            technique: pick('technique', 'GlowTechnique', ['SOFTER', 'PRECISE'], 'Glow technique'),
            source: pick('source', 'InnerGlowSource', ['EDGE_SOURCED', 'CENTER_SOURCED'], 'Glow from the edge or the centre'),
            size: mm('size', 'Glow size', 0, 50.8), spread: pct('spread', 'Choke (%)'), noise: pct('noise', 'Noise (%)'),
        },
    },
    bevelAndEmboss: {
        prop: 'bevelAndEmbossSettings', label: 'Bevel and Emboss',
        enable: { prop: 'applied' },
        fields: {
            style: pick('style', 'BevelAndEmbossStyle', ['INNER_BEVEL', 'OUTER_BEVEL', 'EMBOSS', 'PILLOW_EMBOSS'], 'Bevel or emboss style'),
            technique: pick('technique', 'BevelAndEmbossTechnique', ['SMOOTH_CONTOUR', 'CHISEL_HARD', 'CHISEL_SOFT'], 'Technique'),
            size: mm('size', 'Size', 0, 50.8), direction: pick('direction', 'BevelAndEmbossDirection', ['UP', 'DOWN'], 'Direction'),
            depth: { prop: 'depth', kind: 'num', min: 1, max: 1000, description: 'Depth (%)' },
            soften: mm('soften', 'Soften', 0, 50.8),
            useGlobalLight: flag('useGlobalLight', 'Use the document\'s global light'),
            angle: deg('angle', 'Light angle'), altitude: deg('altitude', 'Light altitude', 0, 90),
            highlightColor: color('highlightColor', 'Highlight colour'), highlightBlendMode: blend('highlightBlendMode', 'the highlight'),
            highlightOpacity: pct('highlightOpacity', 'Highlight opacity (%)'),
            shadowColor: color('shadowColor', 'Shadow colour'), shadowBlendMode: blend('shadowBlendMode', 'the shadow'),
            shadowOpacity: pct('shadowOpacity', 'Shadow opacity (%)'),
        },
    },
    satin: {
        prop: 'satinSettings', label: 'Satin',
        enable: { prop: 'applied' },
        fields: {
            blendMode: blend(), effectColor: color(), opacity: pct('opacity', 'Opacity (%)'),
            angle: deg('angle', 'Angle'), distance: mm('distance', 'Distance'), size: mm('size', 'Size', 0, 50.8),
            invertEffect: flag('invertEffect', 'Invert the satin'),
        },
    },
    basicFeather: {
        prop: 'featherSettings', label: 'Basic Feather',
        enable: { prop: 'mode', on: 'FeatherMode.STANDARD', off: 'FeatherMode.NONE', test: 'FeatherMode.STANDARD' },
        fields: {
            width: mm('width', 'Feather width', 0, 352.778), chokeAmount: pct('chokeAmount', 'Choke (%)'),
            cornerType: pick('cornerType', 'FeatherCornerType', ['SHARP', 'ROUNDED', 'DIFFUSION'], 'Corners'),
            noise: pct('noise', 'Noise (%)'),
        },
    },
    directionalFeather: {
        prop: 'directionalFeatherSettings', label: 'Directional Feather',
        enable: { prop: 'applied' },
        fields: {
            topWidth: mm('topWidth', 'Top feather width', 0, 352.778), bottomWidth: mm('bottomWidth', 'Bottom feather width', 0, 352.778),
            leftWidth: mm('leftWidth', 'Left feather width', 0, 352.778), rightWidth: mm('rightWidth', 'Right feather width', 0, 352.778),
            chokeAmount: pct('chokeAmount', 'Choke (%)'),
            followShapeMode: pick('followShapeMode', 'FollowShapeModeOptions', ['NONE', 'LEADING_EDGE', 'ALL_EDGES'], 'Shape: first edge only, leading edges, or all edges'),
            angle: deg('angle', 'Angle'), noise: pct('noise', 'Noise (%)'),
        },
    },
    gradientFeather: {
        prop: 'gradientFeatherSettings', label: 'Gradient Feather',
        enable: { prop: 'applied' },
        fields: {
            type: pick('type', 'GradientType', ['LINEAR', 'RADIAL'], 'Linear or radial'),
            angle: deg('angle', 'Angle'), length: mm('length', 'Length of a linear feather, or radius of a radial one', 0, 10000),
            hiliteAngle: deg('hiliteAngle', 'Highlight angle of a radial feather'),
            hiliteLength: mm('hiliteLength', 'Highlight length of a radial feather', 0, 10000),
        },
    },
};

/** Extra options of gradient feather that are not plain fields. */
const GRADIENT_EXTRA = {
    gradientStart: {
        type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2,
        description: 'Start point (linear) or centre (radial) as [x, y] in mm from the top-left of the item\'s page, as dragged with the Gradient Feather tool',
    },
    stops: {
        type: 'array', minItems: 2, maxItems: 20,
        description: 'Opacity gradient stops, replacing the existing ones (at least two)',
        items: {
            type: 'object',
            properties: {
                location: { type: 'number', minimum: 0, maximum: 100, description: 'Position along the gradient (%)' },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Opacity at the stop (%)' },
                midpoint: { type: 'number', minimum: 13, maximum: 87, description: 'Midpoint towards the next stop (%)' },
            },
            required: ['location', 'opacity'],
        },
    },
};

const BLENDING_FIELDS = {
    opacity: pct('opacity', 'Opacity (%)'),
    blendMode: blend('blendMode', 'the target'),
    isolateBlending: flag('isolateBlending', 'Isolate Blending (object only)'),
    knockoutGroup: flag('knockoutGroup', 'Knockout Group (object only)'),
};

/** A JSON schema property for a field. */
function fieldSchema(f) {
    if (f.kind === 'num') return { type: 'number', minimum: f.min, maximum: f.max, description: f.description };
    if (f.kind === 'bool') return { type: 'boolean', description: f.description };
    if (f.kind === 'enum') return { type: 'string', enum: f.values, description: f.description };
    return { type: 'string', description: f.description };
}

/** The schema of one effect's option object. */
function effectSchema(key) {
    const e = EFFECTS[key];
    const properties = { enabled: { type: 'boolean', description: `Turn ${e.label} on or off (giving any option turns it on unless this is false)` } };
    for (const [k, f] of Object.entries(e.fields)) properties[k] = fieldSchema(f);
    if (key === 'gradientFeather') Object.assign(properties, GRADIENT_EXTRA);
    return { type: 'object', description: `${e.label} options (Effects dialog > ${e.label})`, properties };
}

/**
 * Validate one field value and return the JSX statement that writes it to
 * `obj`. Colours are resolved once before the item loop; `colors` collects
 * their declarations.
 */
function writeField(obj, f, value, name, colors) {
    if (f.kind === 'num') return `${obj}.${f.prop} = ${num(value, { min: f.min, max: f.max, name })};`;
    if (f.kind === 'bool') {
        if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
        return `${obj}.${f.prop} = ${bool(value)};`;
    }
    if (f.kind === 'enum') return `${obj}.${f.prop} = ${f.type}.${enumOf(value, f.values, { name })};`;
    const v = `__c${colors.length}`;
    colors.push(`var ${v} = __swatch(doc, ${colorSpec(value, name)});`);
    return `${obj}.${f.prop} = ${v};`;
}

/** Refuse option keys the schema does not define. */
function checkKeys(given, allowed, where) {
    for (const k of Object.keys(given)) {
        if (!allowed.includes(k)) throw new Error(`Unknown option '${where}.${k}'. Allowed: ${allowed.join(', ')}`);
    }
}

/** Statements that switch an effect on `s` on or off. */
function enableStatement(e, on) {
    const s = `s.${e.prop}.${e.enable.prop}`;
    if (e.enable.on) return `${s} = ${on ? e.enable.on : e.enable.off};`;
    return `${s} = ${bool(on)};`;
}

/**
 * Validate set_item_effects arguments and build the statements applied to each
 * target's settings object `s`. Returns { lines, colors, applied }.
 */
export function effectStatements(a, target) {
    const lines = [];
    const colors = [];
    const applied = [];
    if (a.transparency !== undefined) {
        if (typeof a.transparency !== 'object' || a.transparency === null) throw new Error("'transparency' must be an object");
        checkKeys(a.transparency, Object.keys(BLENDING_FIELDS), 'transparency');
        for (const [k, v] of Object.entries(a.transparency)) {
            if (v === undefined) continue;
            if ((k === 'isolateBlending' || k === 'knockoutGroup') && target !== 'object') {
                throw new Error(`'transparency.${k}' applies only to the object (on: "object")`);
            }
            lines.push(writeField('s.blendingSettings', BLENDING_FIELDS[k], v, `transparency.${k}`, colors));
        }
        applied.push('transparency');
    }
    for (const [key, e] of Object.entries(EFFECTS)) {
        const opts = a[key];
        if (opts === undefined) continue;
        if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) throw new Error(`'${key}' must be an object of options`);
        const allowed = ['enabled', ...Object.keys(e.fields), ...(key === 'gradientFeather' ? Object.keys(GRADIENT_EXTRA) : [])];
        checkKeys(opts, allowed, key);
        if (opts.enabled !== undefined && typeof opts.enabled !== 'boolean') throw new Error(`'${key}.enabled' must be true or false`);
        if (opts.distance !== undefined && (opts.xOffset !== undefined || opts.yOffset !== undefined)) {
            throw new Error(`'${key}': give distance (with angle) or xOffset/yOffset, not both`);
        }
        const options = Object.keys(opts).filter((k) => k !== 'enabled' && opts[k] !== undefined);
        if (opts.enabled === false && options.length) throw new Error(`'${key}': options given with enabled: false`);
        if (opts.enabled === undefined && !options.length) throw new Error(`'${key}': give enabled or at least one option`);
        lines.push(enableStatement(e, opts.enabled !== false));
        for (const k of Object.keys(e.fields)) {
            if (opts[k] !== undefined) lines.push(writeField(`s.${e.prop}`, e.fields[k], opts[k], `${key}.${k}`, colors));
        }
        if (key === 'gradientFeather') lines.push(...gradientExtras(opts));
        applied.push(key);
    }
    if (!applied.length) throw new Error(`Nothing to set: give transparency or an effect (${Object.keys(EFFECTS).join(', ')})`);
    return { lines, colors, applied };
}

/** Gradient feather start point and opacity stops. */
function gradientExtras(opts) {
    const out = [];
    if (opts.gradientStart !== undefined) {
        const p = opts.gradientStart;
        if (!Array.isArray(p) || p.length !== 2) throw new Error("'gradientFeather.gradientStart' must be [x, y]");
        const x = num(p[0], { name: 'gradientFeather.gradientStart[0]', min: -10000, max: 10000 });
        const y = num(p[1], { name: 'gradientFeather.gradientStart[1]', min: -10000, max: 10000 });
        out.push(`s.gradientFeatherSettings.gradientStart = pg ? __toPage(pg, ${x}, ${y}) : [${x}, ${y}];`);
    }
    if (opts.stops !== undefined) {
        const stops = opts.stops;
        if (!Array.isArray(stops) || stops.length < 2 || stops.length > 20) throw new Error("'gradientFeather.stops' needs 2 to 20 stops");
        out.push('var gs = s.gradientFeatherSettings.opacityGradientStops;');
        out.push(`while (gs.length > ${stops.length}) gs.lastItem().remove();`);
        out.push(`while (gs.length < ${stops.length}) gs.add();`);
        stops.forEach((st, i) => {
            const n = `gradientFeather.stops[${i}]`;
            if (typeof st !== 'object' || st === null) throw new Error(`'${n}' must be an object`);
            checkKeys(st, ['location', 'opacity', 'midpoint'], n);
            out.push(`gs.item(${i}).location = ${num(st.location, { min: 0, max: 100, name: `${n}.location` })};`);
            out.push(`gs.item(${i}).opacity = ${num(st.opacity, { min: 0, max: 100, name: `${n}.opacity` })};`);
            if (st.midpoint !== undefined) out.push(`gs.item(${i}).midpoint = ${num(st.midpoint, { min: 13, max: 87, name: `${n}.midpoint` })};`);
        });
    }
    return out;
}

/** The on/off test for an effect on settings object `s`. */
function enabledExpr(e) {
    return e.enable.test ? `s.${e.prop}.${e.enable.prop} == ${e.enable.test}` : `s.${e.prop}.applied`;
}

/** A JSX expression reading a field from `x`. */
function readExpr(f) {
    if (f.kind === 'enum') return `__enumName(x.${f.prop})`;
    if (f.kind === 'color') return `__colorName(x.${f.prop})`;
    return `x.${f.prop}`;
}

/**
 * JSX function __fx(s, all, pg): one target's blending and effects as a plain
 * object; gradient feather start points are given relative to page `pg`.
 */
function readerSource() {
    const parts = [
        'var __colorName = function (c) { try { return c.name; } catch (e) { return null; } };',
        'var __fromPage = function (pg, p) { if (!pg) return p; var pb = pg.bounds; return [p[0] - pb[1], p[1] - pb[0]]; };',
        'var __stops = function (gs) {',
        '  var out = [];',
        '  for (var i = 0; i < gs.length; i++) { var g = gs.item(i); out.push({ location: g.location, opacity: g.opacity, midpoint: g.midpoint }); }',
        '  return out;',
        '};',
        'var __fx = function (s, all, pg) {',
        '  var b = s.blendingSettings;',
        '  var fx = {}, x, on;',
    ];
    for (const [key, e] of Object.entries(EFFECTS)) {
        const fields = Object.entries(e.fields).map(([k, f]) => `${k}: ${readExpr(f)}`);
        if (key === 'gradientFeather') {
            fields.push('gradientStart: __fromPage(pg, x.gradientStart)');
            fields.push('stops: __stops(x.opacityGradientStops)');
        }
        parts.push(`  on = ${enabledExpr(e)};`);
        parts.push(`  if (on || all) { x = s.${e.prop}; fx.${key} = { enabled: on, ${fields.join(', ')} }; }`);
    }
    parts.push(
        '  return { transparency: { opacity: b.opacity, blendMode: __enumName(b.blendMode), isolateBlending: b.isolateBlending, knockoutGroup: b.knockoutGroup }, effects: fx };',
        '};',
    );
    return parts.join('\n');
}

/** The settings objects an effects mode touches, from `on` (a list of target names). */
function targetsList(on, name) {
    const list = on === undefined ? Object.keys(EFFECT_TARGETS) : on;
    if (!Array.isArray(list) || !list.length) throw new Error(`'${name}' must be a non-empty list of: ${Object.keys(EFFECT_TARGETS).join(', ')}`);
    return [...new Set(list.map((t) => enumOf(t, Object.keys(EFFECT_TARGETS), { name })))];
}

/** Flattener preset / spread flattening settings, shared by both tools. */
const FLATTENER_FIELDS = {
    rasterVectorBalance: { prop: 'rasterVectorBalance', kind: 'num', min: 0, max: 100, description: 'Raster/Vector Balance: 0 rasterizes everything, 100 keeps as much vector as possible' },
    lineArtAndTextResolution: { prop: 'lineArtAndTextResolution', kind: 'num', min: 1, max: 9600, description: 'Line Art and Text Resolution (ppi, 1 to 9600)' },
    gradientAndMeshResolution: { prop: 'gradientAndMeshResolution', kind: 'num', min: 1, max: 1200, description: 'Gradient and Mesh Resolution (ppi, 1 to 1200)' },
    convertAllTextToOutlines: flag('convertAllTextToOutlines', 'Convert All Text to Outlines'),
    convertAllStrokesToOutlines: flag('convertAllStrokesToOutlines', 'Convert All Strokes to Outlines'),
    clipComplexRegions: flag('clipComplexRegions', 'Clip Complex Regions'),
};

const FLATTENER_SCHEMA = {
    type: 'object',
    description: 'Flattener settings; only the ones you pass change',
    properties: Object.fromEntries(Object.entries(FLATTENER_FIELDS).map(([k, f]) => [k, fieldSchema(f)])),
};

/** Statements writing flattener settings to `obj`. */
function flattenerStatements(settings, obj) {
    if (settings === undefined) return [];
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new Error("'settings' must be an object");
    checkKeys(settings, Object.keys(FLATTENER_FIELDS), 'settings');
    return Object.entries(settings).filter(([, v]) => v !== undefined)
        .map(([k, v]) => writeField(obj, FLATTENER_FIELDS[k], v, `settings.${k}`, []));
}

/** JSX reading flattener settings from `f` as a literal. */
const FLATTENER_READ = '{ rasterVectorBalance: (typeof f.rasterVectorBalance === "number" ? f.rasterVectorBalance : __enumName(f.rasterVectorBalance)), lineArtAndTextResolution: f.lineArtAndTextResolution, gradientAndMeshResolution: f.gradientAndMeshResolution, convertAllTextToOutlines: f.convertAllTextToOutlines, convertAllStrokesToOutlines: f.convertAllStrokesToOutlines, clipComplexRegions: f.clipComplexRegions }';

/** Display performance levels, as indexes of app.displaySettings. */
const DISPLAY_LEVELS = { fast: 0, typical: 1, highQuality: 2 };
const TAG_TRANSPARENCY = ['OFF', 'LOW_QUALITY', 'MEDIUM_QUALITY', 'HIGH_QUALITY'];

const ON_SCHEMA = {
    type: 'string', enum: Object.keys(EFFECT_TARGETS), default: 'object',
    description: 'Effects panel target: the whole object, its stroke, its fill, or its content (the text of a text frame, the graphic in a frame)',
};
const ON_LIST_SCHEMA = {
    type: 'array', items: { type: 'string', enum: Object.keys(EFFECT_TARGETS) },
    description: 'Effects panel targets (default: object, stroke, fill and content)',
};

const EFFECT_FEATURES = {
    dropShadow: ['drop_shadow', 'effects_menu_drop_shadow', 'fx_drop_shadow_drop_shadow_blend_mode', 'fx_drop_shadow_drop_shadow_effect_color',
        'fx_drop_shadow_drop_shadow_opacity', 'fx_drop_shadow_drop_shadow_angle', 'fx_drop_shadow_drop_shadow_use_global_light',
        'fx_drop_shadow_drop_shadow_distance', 'fx_drop_shadow_drop_shadow_x_offset', 'fx_drop_shadow_drop_shadow_y_offset',
        'fx_drop_shadow_drop_shadow_size', 'fx_drop_shadow_drop_shadow_spread', 'fx_drop_shadow_drop_shadow_noise',
        'fx_drop_shadow_drop_shadow_knocked_out', 'fx_drop_shadow_drop_shadow_honor_other_effects'],
    innerShadow: ['inner_shadow', 'effects_menu_inner_shadow', 'fx_inner_shadow_inner_shadow_blend_mode', 'fx_inner_shadow_inner_shadow_effect_color',
        'fx_inner_shadow_inner_shadow_opacity', 'fx_inner_shadow_inner_shadow_angle', 'fx_inner_shadow_inner_shadow_use_global_light',
        'fx_inner_shadow_inner_shadow_distance', 'fx_inner_shadow_inner_shadow_x_offset', 'fx_inner_shadow_inner_shadow_y_offset',
        'fx_inner_shadow_inner_shadow_size', 'fx_inner_shadow_inner_shadow_choke_amount', 'fx_inner_shadow_inner_shadow_noise'],
    outerGlow: ['outer_glow', 'effects_menu_outer_glow', 'fx_outer_glow_outer_glow_blend_mode', 'fx_outer_glow_outer_glow_effect_color',
        'fx_outer_glow_outer_glow_opacity', 'fx_outer_glow_outer_glow_technique', 'fx_outer_glow_outer_glow_size',
        'fx_outer_glow_outer_glow_spread', 'fx_outer_glow_outer_glow_noise'],
    innerGlow: ['inner_glow', 'effects_menu_inner_glow', 'fx_inner_glow_inner_glow_blend_mode', 'fx_inner_glow_inner_glow_effect_color',
        'fx_inner_glow_inner_glow_opacity', 'fx_inner_glow_inner_glow_technique', 'fx_inner_glow_inner_glow_source',
        'fx_inner_glow_inner_glow_size', 'fx_inner_glow_inner_glow_spread', 'fx_inner_glow_inner_glow_noise'],
    bevelAndEmboss: ['bevel_emboss', 'effects_menu_bevel_and_emboss', 'fx_bevel_emboss_bevel_and_emboss_style', 'fx_bevel_emboss_bevel_and_emboss_technique',
        'fx_bevel_emboss_bevel_and_emboss_size', 'fx_bevel_emboss_bevel_and_emboss_direction', 'fx_bevel_emboss_bevel_and_emboss_depth',
        'fx_bevel_emboss_bevel_and_emboss_soften', 'fx_bevel_emboss_bevel_and_emboss_angle', 'fx_bevel_emboss_bevel_and_emboss_altitude',
        'fx_bevel_emboss_bevel_and_emboss_use_global_light', 'fx_bevel_emboss_bevel_and_emboss_highlight_color',
        'fx_bevel_emboss_bevel_and_emboss_highlight_blend_mode', 'fx_bevel_emboss_bevel_and_emboss_highlight_opacity',
        'fx_bevel_emboss_bevel_and_emboss_shadow_color', 'fx_bevel_emboss_bevel_and_emboss_shadow_blend_mode',
        'fx_bevel_emboss_bevel_and_emboss_shadow_opacity'],
    satin: ['satin', 'effects_menu_satin', 'fx_satin_satin_blend_mode', 'fx_satin_satin_effect_color', 'fx_satin_satin_opacity',
        'fx_satin_satin_angle', 'fx_satin_satin_distance', 'fx_satin_satin_size', 'fx_satin_satin_invert_effect'],
    basicFeather: ['basic_feather', 'effects_menu_basic_feather', 'fx_basic_feather_basic_feather_width',
        'fx_basic_feather_basic_feather_choke_amount', 'fx_basic_feather_basic_feather_corner_type', 'fx_basic_feather_basic_feather_noise'],
    directionalFeather: ['directional_feather', 'effects_menu_directional_feather', 'fx_directional_feather_directional_feather_top_width',
        'fx_directional_feather_directional_feather_bottom_width', 'fx_directional_feather_directional_feather_left_width',
        'fx_directional_feather_directional_feather_right_width', 'fx_directional_feather_directional_feather_choke_amount',
        'fx_directional_feather_directional_feather_follow_shape_mode', 'fx_directional_feather_directional_feather_angle',
        'fx_directional_feather_directional_feather_noise'],
    gradientFeather: ['gradient_feather', 'gradient_feather_tool', 'effects_menu_gradient_feather', 'fx_gradient_feather_gradient_feather_type',
        'fx_gradient_feather_gradient_feather_opacity_gradient_stops', 'fx_gradient_feather_gradient_feather_angle',
        'fx_gradient_feather_gradient_feather_length', 'fx_gradient_feather_gradient_feather_gradient_start'],
};

const fx = (ids) => ids.map((id) => `indesign.effects_transparency.${id}`);

export const tools = [
    {
        name: 'set_item_effects',
        description: 'Set opacity, blending mode, isolate/knockout and effects (drop shadow, inner shadow, outer and inner glow, bevel and emboss, satin, basic, directional and gradient feather) on items\' object, stroke, fill or content (Effects panel; Object > Effects). Only the options you pass change',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                on: ON_SCHEMA,
                transparency: {
                    type: 'object',
                    description: 'Opacity and blending (Effects dialog > Transparency)',
                    properties: Object.fromEntries(Object.entries(BLENDING_FIELDS).map(([k, f]) => [k, fieldSchema(f)])),
                },
                ...Object.fromEntries(Object.keys(EFFECTS).map((k) => [k, effectSchema(k)])),
            },
            required: ['target'],
        },
        features: fx([
            'effects_panel', 'effects_dialog', 'transparency_setting', 'effects_on_text_shapes',
            'effects_menu_transparency', 'effects_menu_object', 'effects_menu_stroke', 'effects_menu_fill', 'effects_menu_text',
            'fx_transparency_blending_mode', 'fx_transparency_isolate_blending', 'fx_transparency_knockout_group',
            ...Object.values(EFFECT_FEATURES).flat(),
        ]),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: {
            target: { ids: [10] },
            on: 'object',
            transparency: { opacity: 80, blendMode: 'MULTIPLY', isolateBlending: true, knockoutGroup: false },
            dropShadow: { effectColor: 'Black', opacity: 75, useGlobalLight: false, angle: 120, distance: 2, size: 1.5, spread: 10, noise: 0, knockedOut: true, honorOtherEffects: false, blendMode: 'MULTIPLY' },
            innerShadow: { effectColor: '#000000', xOffset: 1, yOffset: 1, size: 1, chokeAmount: 0, noise: 0, useGlobalLight: true, angle: 45, opacity: 50, blendMode: 'MULTIPLY' },
            outerGlow: { effectColor: 'Black', technique: 'SOFTER', size: 2, spread: 0, noise: 0, opacity: 75, blendMode: 'SCREEN' },
            innerGlow: { effectColor: 'Black', technique: 'PRECISE', source: 'EDGE_SOURCED', size: 2, spread: 0, noise: 0, opacity: 75, blendMode: 'SCREEN' },
            bevelAndEmboss: { style: 'INNER_BEVEL', technique: 'SMOOTH_CONTOUR', size: 2, direction: 'UP', depth: 100, soften: 0, angle: 120, altitude: 30, useGlobalLight: true, highlightColor: 'Paper', highlightBlendMode: 'SCREEN', highlightOpacity: 75, shadowColor: 'Black', shadowBlendMode: 'MULTIPLY', shadowOpacity: 75 },
            satin: { effectColor: 'Black', blendMode: 'MULTIPLY', opacity: 50, angle: 120, distance: 2, size: 2, invertEffect: false },
            basicFeather: { width: 3, chokeAmount: 0, cornerType: 'DIFFUSION', noise: 0 },
            directionalFeather: { topWidth: 2, bottomWidth: 0, leftWidth: 0, rightWidth: 0, chokeAmount: 0, followShapeMode: 'LEADING_EDGE', angle: 0, noise: 0 },
            gradientFeather: { type: 'LINEAR', angle: 90, length: 50, gradientStart: [10, 10], stops: [{ location: 0, opacity: 100 }, { location: 100, opacity: 0, midpoint: 50 }] },
        },
        handler: (a) => {
            const on = enumOf(a.on ?? 'object', Object.keys(EFFECT_TARGETS), { name: 'on' });
            const { lines, colors, applied } = effectStatements(a, on);
            return run('Set item effects', script(`
${colors.join('\n')}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], pg = __pageOf(it);
  var s = it.${EFFECT_TARGETS[on]};
  ${lines.join('\n  ')}
  out.push(__itemInfo(it));
}
__result__ = { on: "${on}", set: ${json(applied)}, items: out };`));
        },
    },
    {
        name: 'get_item_effects',
        description: 'Read items\' opacity, blending and effects on their object, stroke, fill and content (Effects panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                on: ON_LIST_SCHEMA,
                includeDisabled: { type: 'boolean', description: 'Also report the settings of effects that are off (default: only effects that are on)' },
            },
            required: ['target'],
        },
        features: fx(['effects_panel']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const on = targetsList(a.on, 'on');
            const reads = on.map((t) => `  try { r.${t} = __fx(it.${EFFECT_TARGETS[t]}, ${bool(a.includeDisabled)}, __pageOf(it)); } catch (e) { r.${t} = { error: e.message }; }`);
            return run('Get item effects', script(`
${readerSource()}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  var r = { item: __itemInfo(it) };
${reads.join('\n')}
  out.push(r);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'clear_item_effects',
        description: 'Remove items\' effects (Object > Effects > Clear Effects), or reset opacity, blending and effects on the object, stroke, fill and content (Object > Effects > Clear All Transparency)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                scope: {
                    type: 'string', enum: ['effects', 'all_transparency'], default: 'effects',
                    description: 'effects: turn off every effect on the chosen targets, keeping opacity and blending; all_transparency: also reset opacity to 100%, Normal blending, no isolate or knockout, on all four targets',
                },
                on: ON_LIST_SCHEMA,
            },
            required: ['target'],
        },
        features: fx(['effects_menu_clear_effects', 'effects_menu_clear_all_transparency']),
        hints: { readOnly: false, destructive: true, idempotent: true },
        handler: (a) => {
            const scope = enumOf(a.scope ?? 'effects', ['effects', 'all_transparency'], { name: 'scope' });
            if (scope === 'all_transparency' && a.on !== undefined) throw new Error("'on' applies to scope: effects; all_transparency clears every target");
            const on = targetsList(scope === 'effects' ? a.on : undefined, 'on');
            const reset = Object.values(EFFECTS).map((e) => enableStatement(e, false));
            if (scope === 'all_transparency') {
                reset.push('s.blendingSettings.opacity = 100;', 's.blendingSettings.blendMode = BlendMode.NORMAL;');
            }
            const objectOnly = scope === 'all_transparency'
                ? 'if (t === "object") { s.blendingSettings.isolateBlending = false; s.blendingSettings.knockoutGroup = false; }'
                : '';
            const props = json(Object.fromEntries(on.map((t) => [t, EFFECT_TARGETS[t]])));
            return run('Clear item effects', script(`
var targets = ${props};
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], cleared = [], skipped = [];
  for (var t in targets) {
    if (!targets.hasOwnProperty(t)) continue;
    try {
      var s = it[targets[t]];
      ${reset.join('\n      ')}
      ${objectOnly}
      cleared.push(t);
    } catch (e) { skipped.push(t + ": " + e.message); }
  }
  out.push({ item: __itemInfo(it), cleared: cleared, skipped: skipped });
}
__result__ = { scope: "${scope}", items: out };`));
        },
    },
    {
        name: 'set_transparency_preferences',
        description: 'Set the global light shared by shadows and bevels (Object > Effects > Global Light), the transparency blend space (Edit > Transparency Blend Space) and how transparency is drawn on screen at each display performance level (Preferences > Display Performance)',
        inputSchema: {
            type: 'object',
            properties: {
                scope: {
                    type: 'string', enum: ['document', 'application'], default: 'document',
                    description: 'Where global light and blend space are set: the active document, or the application defaults for new documents',
                },
                globalLight: {
                    type: 'object',
                    description: 'Global Light',
                    properties: {
                        angle: { type: 'number', minimum: -360, maximum: 360, description: 'Light angle (degrees)' },
                        altitude: { type: 'number', minimum: 0, maximum: 90, description: 'Light altitude (degrees)' },
                    },
                },
                blendSpace: { type: 'string', enum: ['RGB', 'CMYK'], description: 'Transparency Blend Space: Document RGB or Document CMYK' },
                transparencyDisplay: {
                    type: 'object',
                    description: 'Transparency quality on screen per display performance level (application-wide)',
                    properties: Object.fromEntries(Object.keys(DISPLAY_LEVELS).map((k) => [k, { type: 'string', enum: TAG_TRANSPARENCY, description: `Transparency at the ${k === 'highQuality' ? 'High Quality' : k[0].toUpperCase() + k.slice(1)} level` }])),
                },
            },
        },
        features: fx(['global_light', 'transparency_blend_space', 'transparency_display']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const scope = enumOf(a.scope ?? 'document', ['document', 'application'], { name: 'scope' });
            const lines = [];
            const changed = [];
            const prefs = scope === 'document' ? '__doc().transparencyPreferences' : 'app.transparencyPreferences';
            if (a.globalLight !== undefined) {
                const g = a.globalLight ?? {};
                checkKeys(g, ['angle', 'altitude'], 'globalLight');
                if (g.angle === undefined && g.altitude === undefined) throw new Error("'globalLight' needs angle or altitude");
                if (g.angle !== undefined) lines.push(`tp.globalLightAngle = ${num(g.angle, { min: -360, max: 360, name: 'globalLight.angle' })};`);
                if (g.altitude !== undefined) lines.push(`tp.globalLightAltitude = ${num(g.altitude, { min: 0, max: 90, name: 'globalLight.altitude' })};`);
                changed.push('globalLight');
            }
            if (a.blendSpace !== undefined) {
                lines.push(`tp.blendingSpace = BlendingSpace.${enumOf(a.blendSpace, ['RGB', 'CMYK'], { name: 'blendSpace' })};`);
                changed.push('blendSpace');
            }
            if (a.transparencyDisplay !== undefined) {
                const d = a.transparencyDisplay ?? {};
                checkKeys(d, Object.keys(DISPLAY_LEVELS), 'transparencyDisplay');
                const given = Object.entries(d).filter(([, v]) => v !== undefined);
                if (!given.length) throw new Error(`'transparencyDisplay' needs one of: ${Object.keys(DISPLAY_LEVELS).join(', ')}`);
                for (const [k, v] of given) {
                    lines.push(`app.displaySettings.item(${DISPLAY_LEVELS[k]}).transparency = TagTransparency.${enumOf(v, TAG_TRANSPARENCY, { name: `transparencyDisplay.${k}` })};`);
                }
                changed.push('transparencyDisplay');
            }
            if (!changed.length) throw new Error('Nothing to set: give globalLight, blendSpace or transparencyDisplay');
            const needsPrefs = changed.includes('globalLight') || changed.includes('blendSpace');
            return run('Set transparency preferences', script(`
${needsPrefs ? `var tp = ${prefs};` : ''}
${lines.join('\n')}
__result__ = { scope: "${scope}", changed: ${json(changed)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'get_transparency_settings',
        description: 'Read global light, transparency blend space, transparency display quality, transparency flattener presets and each spread\'s flattening (Object > Effects > Global Light; Edit > Transparency Blend Space; Edit > Transparency Flattener Presets; Pages panel > Spread Flattening)',
        inputSchema: { type: 'object', properties: {} },
        features: fx(['flattener_presets']),
        hints: { readOnly: true, idempotent: true },
        handler: () => run('Get transparency settings', script(`
var __tp = function (tp) { return { globalLightAngle: tp.globalLightAngle, globalLightAltitude: tp.globalLightAltitude, blendSpace: __enumName(tp.blendingSpace) }; };
var __fl = function (f) { return ${FLATTENER_READ}; };
var r = { application: __tp(app.transparencyPreferences), display: [], presets: [] };
for (var i = 0; i < app.displaySettings.length; i++) {
  var ds = app.displaySettings.item(i);
  r.display.push({ index: i, transparency: __enumName(ds.transparency), raster: __enumName(ds.raster), vector: __enumName(ds.vector) });
}
for (var j = 0; j < app.flattenerPresets.length; j++) {
  var p = app.flattenerPresets.item(j), pr = __fl(p);
  pr.name = p.name;
  r.presets.push(pr);
}
if (app.documents.length) {
  var doc = app.activeDocument;
  r.document = __tp(doc.transparencyPreferences);
  r.spreads = [];
  for (var k = 0; k < doc.spreads.length; k++) {
    var sp = doc.spreads[k], so = { index: k, flattening: __enumName(sp.flattenerOverride) };
    if (sp.flattenerOverride == SpreadFlattenerLevel.CUSTOM) so.custom = __fl(sp.flattenerPreferences);
    r.spreads.push(so);
  }
}
__result__ = r;`, { needsDocument: false })),
    },
    {
        name: 'manage_flattener_preset',
        description: 'Create, edit, duplicate or delete transparency flattener presets used when printing or exporting (Edit > Transparency Flattener Presets)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'update', 'duplicate', 'delete'], description: 'What to do with the preset' },
                name: { type: 'string', description: 'The preset name (the new name for create; the existing preset otherwise)' },
                newName: { type: 'string', description: 'update: rename the preset; duplicate: the copy\'s name (required)' },
                settings: FLATTENER_SCHEMA,
            },
            required: ['action', 'name'],
        },
        features: fx(['flattener_presets', 'flattener_name_flattener_preset', 'flattener_raster_vector_balance',
            'flattener_line_art_and_text_resolution', 'flattener_gradient_and_mesh_resolution', 'flattener_convert_all_text_to_outlines',
            'flattener_convert_all_strokes_to_outlines', 'flattener_clip_complex_regions', 'flattener_overview']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'update', name: 'Print', newName: 'Print 2', settings: { rasterVectorBalance: 75, lineArtAndTextResolution: 1200, gradientAndMeshResolution: 300, convertAllTextToOutlines: false, convertAllStrokesToOutlines: false, clipComplexRegions: true } },
        handler: (a) => {
            const action = enumOf(a.action, ['create', 'update', 'duplicate', 'delete'], { name: 'action' });
            const name = String(a.name ?? '').trim();
            if (!name) throw new Error("'name' is required");
            const newName = a.newName === undefined ? undefined : String(a.newName).trim();
            if (newName !== undefined && !newName) throw new Error("'newName' is empty");
            const builtIn = (n) => /^\[.*\]$/.test(n);
            if ((action === 'update' || action === 'delete') && builtIn(name)) throw new Error(`The built-in preset ${name} cannot be changed or deleted; duplicate it instead`);
            if ((action === 'create' && builtIn(name)) || (newName !== undefined && builtIn(newName))) throw new Error('Preset names in [brackets] are reserved for built-in presets');
            if ((action === 'create' || action === 'delete') && newName !== undefined) throw new Error(`'newName' applies to update and duplicate, not ${action}`);
            if (action === 'duplicate' && newName === undefined) throw new Error("duplicate needs 'newName'");
            if (action === 'delete' && a.settings !== undefined) throw new Error("'settings' does not apply to delete");
            const set = flattenerStatements(a.settings, 'p');
            if (action === 'update' && !set.length && newName === undefined) throw new Error('update needs settings or newName');
            const find = `var p = app.flattenerPresets.itemByName(${str(name)});\nif (!p.isValid) throw new Error("No flattener preset named " + ${str(name)});`;
            const clash = (n) => `if (app.flattenerPresets.itemByName(${str(n)}).isValid) throw new Error("A flattener preset named " + ${str(n)} + " already exists");`;
            let body;
            if (action === 'create') body = `${clash(name)}\nvar p = app.flattenerPresets.add({ name: ${str(name)} });`;
            else if (action === 'duplicate') body = `${find}\n${clash(newName)}\np = p.duplicate();\np.name = ${str(newName)};`;
            else if (action === 'update') body = `${find}\n${newName !== undefined && newName !== name ? `${clash(newName)}\np.name = ${str(newName)};` : ''}`;
            else body = `${find}\np.remove();\n__result__ = { action: "delete", name: ${str(name)} };`;
            const read = action === 'delete' ? '' : `var f = p;\nvar pr = ${FLATTENER_READ};\npr.name = p.name;\n__result__ = { action: "${action}", preset: pr };`;
            return run('Manage flattener preset', script(`
${body}
${set.join('\n')}
${read}`, { needsDocument: false }));
        },
    },
    {
        name: 'set_spread_flattening',
        description: 'Set how a spread is flattened: the document default, None (Ignore Transparency), or custom flattener settings (Pages panel menu > Spread Flattening)',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'integer', minimum: 0, description: 'The spread (0-based)' },
                mode: { type: 'string', enum: ['default', 'none', 'custom'], description: 'default: use the output\'s flattener preset; none: ignore transparency; custom: the settings given here' },
                settings: { ...FLATTENER_SCHEMA, description: 'Custom flattener settings (mode: custom); only the ones you pass change' },
            },
            required: ['spreadIndex', 'mode'],
        },
        features: fx(['spread_flattening']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { spreadIndex: 0, mode: 'custom', settings: { rasterVectorBalance: 75, lineArtAndTextResolution: 1200, gradientAndMeshResolution: 300, convertAllTextToOutlines: false, convertAllStrokesToOutlines: true, clipComplexRegions: false } },
        handler: (a) => {
            const i = index(a.spreadIndex, { name: 'spreadIndex' });
            const mode = enumOf(a.mode, ['default', 'none', 'custom'], { name: 'mode' });
            if (mode !== 'custom' && a.settings !== undefined) throw new Error("'settings' applies only to mode: custom");
            const set = flattenerStatements(a.settings, 'sp.flattenerPreferences');
            const level = { default: 'DEFAULT_VALUE', none: 'NONE', custom: 'CUSTOM' }[mode];
            return run('Set spread flattening', script(`
if (${i} >= doc.spreads.length) throw new Error("Spread index ${i} is out of range; the document has " + doc.spreads.length + " spreads");
var sp = doc.spreads[${i}];
sp.flattenerOverride = SpreadFlattenerLevel.${level};
${set.join('\n')}
var f = sp.flattenerPreferences;
__result__ = { spreadIndex: ${i}, flattening: __enumName(sp.flattenerOverride), custom: ${mode === 'custom' ? FLATTENER_READ : 'null'} };`));
        },
    },
];
