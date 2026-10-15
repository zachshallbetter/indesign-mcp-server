/**
 * 3D: camera, light, material and geometry options, the composition's 3D
 * renderer and Draft 3D, 3D views, the Layer > Camera commands, and the camera
 * navigation tools.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';

const TIME_SCHEMA = { type: 'number', minimum: 0, description: 'Seconds: set keyframes at this time. Omit to set the static value, or a keyframe at the current time when the property is already animated' };
const POI_SCHEMA = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Point of Interest [x, y, z] in pixels, for two-node cameras and lights' };

/** Numeric options: parameter -> [property on the options group, min, max, description]. */
const CAMERA_NUMBERS = {
    zoom: ['zoom', 1, 1e6, 'Zoom: pixels from the camera to the image plane (sets the angle of view and focal length)'],
    focusDistance: ['focusDistance', 1, 1e6, 'Focus Distance in pixels'],
    aperture: ['aperture', 0, 1e6, 'Aperture in pixels; larger blurs more'],
    blurLevel: ['blurLevel', 0, 1000, 'Blur Level, percent'],
    irisRotation: ['irisRotation', -1e6, 1e6, 'Iris Rotation, degrees'],
    irisRoundness: ['irisRoundness', 0, 100, 'Iris Roundness, percent'],
    irisAspectRatio: ['irisAspectRatio', 0.01, 100, 'Iris Aspect Ratio'],
    irisDiffractionFringe: ['irisDiffractionFringe', 0, 500, 'Iris Diffraction Fringe'],
    highlightGain: ['highlightGain', 0, 100, 'Highlight Gain'],
    highlightThreshold: ['highlightThreshold', 0, 100, 'Highlight Threshold, percent'],
    highlightSaturation: ['highlightSaturation', 0, 100, 'Highlight Saturation'],
};
const IRIS_SHAPES = ['fast_rectangle', 'triangle', 'square', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'nonagon', 'decagon'];

const LIGHT_TYPES = { parallel: 'PARALLEL', spot: 'SPOT', point: 'POINT', ambient: 'AMBIENT' };
const LIGHT_NUMBERS = {
    intensity: ['intensity', -1e5, 1e5, 'Intensity, percent; negative removes light'],
    coneAngle: ['coneAngle', 0, 180, 'Cone Angle in degrees (spot lights)'],
    coneFeather: ['coneFeather', 0, 100, 'Cone Feather, percent (spot lights)'],
    radius: ['radius', 0, 1e6, 'Radius in pixels, where light is at full intensity before falloff'],
    falloffDistance: ['falloffDistance', 0, 1e6, 'Falloff Distance in pixels'],
    shadowDarkness: ['shadowDarkness', 0, 100, 'Shadow Darkness, percent'],
    shadowDiffusion: ['shadowDiffusion', 0, 1e5, 'Shadow Diffusion in pixels'],
};
/** Light > Falloff: None, Smooth, Inverse Square Clamped. */
const FALLOFF = ['none', 'smooth', 'inverse_square_clamped'];

const MATERIAL_NUMBERS = {
    lightTransmission: ['lightTransmission', 0, 100, 'Light Transmission, percent'],
    ambient: ['ambient', 0, 100, 'Ambient, percent'],
    diffuse: ['diffuse', 0, 100, 'Diffuse, percent'],
    specularIntensity: ['specularIntensity', 0, 100, 'Specular Intensity, percent'],
    specularShininess: ['specularShininess', 0, 100, 'Specular Shininess, percent'],
    metal: ['metal', 0, 100, 'Metal, percent'],
    reflectionIntensity: ['reflectionIntensity', 0, 100, 'Reflection Intensity, percent'],
    reflectionSharpness: ['reflectionSharpness', 0, 100, 'Reflection Sharpness, percent'],
    reflectionRolloff: ['reflectionRolloff', 0, 100, 'Reflection Rolloff, percent'],
    transparency: ['transparency', 0, 100, 'Transparency, percent (separate from layer Opacity)'],
    transparencyRolloff: ['transparencyRolloff', 0, 100, 'Transparency Rolloff, percent'],
    indexOfRefraction: ['indexOfRefraction', 1, 3, 'Index of Refraction'],
};
/** Material switches that take Off, On or Only, and their values. */
const ON_OFF_ONLY = { off: 0, on: 1, only: 2 };
const MATERIAL_SWITCHES = {
    castsShadows: ['castsShadows', 'Casts Shadows: off, on, or only (the shadow without the layer)'],
    acceptsShadows: ['acceptsShadows', 'Accepts Shadows: off, on, or only (shadows alone, for a shadow catcher)'],
    appearsInReflections: ['appearsInReflections', 'Appears in Reflections: off, on, or only'],
};

const GEOMETRY_NUMBERS = {
    bevelDepth: ['bevelDepth', 0, 1e5, 'Bevel Depth in pixels (text and shape layers)'],
    holeBevelDepth: ['holeBevelDepth', 0, 100, 'Hole Bevel Depth, percent of Bevel Depth (text and shape layers)'],
    extrusionDepth: ['extrusionDepth', 0, 1e5, 'Extrusion Depth in pixels (text and shape layers)'],
    curvature: ['curvature', -100, 100, 'Curvature, percent (footage and precomposition layers)'],
    segments: ['segments', 1, 1000, 'Segments, the facets of a curved layer (footage and precomposition layers)'],
};
const BEVEL_STYLES = ['none', 'angular', 'concave', 'convex'];

/** Composition renderers by plain name, as CompItem.renderer strings. */
const RENDERERS = { classic_3d: 'ADBE Advanced 3d', advanced_3d: 'ADBE Calder', cinema_4d: 'ADBE Ernst' };

/** View > Switch 3D View, and the other View menu 3D commands. */
const VIEWS = {
    active_camera: 2710, front: 2711, left: 2712, top: 2713, back: 2714, right: 2715, bottom: 2716,
    custom_view_1: 2717, custom_view_2: 2718, custom_view_3: 2719, last: 2703,
};
const VIEW_ACTIONS = { reset: 2642, look_at_selected_layers: 2834, look_at_all_layers: 2835, create_camera: 2645 };

/** Layer > Camera and Layer > Light commands: id, the layer they act on, whether a target layer is needed. */
const CAMERA_COMMANDS = {
    link_focus_to_point_of_interest: { id: 3845, on: 'camera' },
    link_focus_to_layer: { id: 3847, on: 'camera', target: true },
    set_focus_to_layer: { id: 3846, on: 'camera', target: true },
    create_orbit_null: { id: 3844, on: 'camera' },
    create_stereo_3d_rig: { id: 3843, on: 'camera' },
    create_cameras_from_3d_model: { id: 10710, on: 'model' },
    create_lights_from_3d_model: { id: 10721, on: 'model' },
};

/** Tools > camera tools, as ToolType members. */
const CAMERA_TOOLS = {
    unified: 'Tool_CameraMaya',
    orbit: 'Tool_CameraOrbit',
    orbit_around_cursor: 'Tool_CameraOrbitCursor',
    orbit_around_scene: 'Tool_CameraOrbitScene',
    pan: 'Tool_CameraTrackXY',
    pan_under_cursor: 'Tool_CameraPanCursor',
    dolly: 'Tool_CameraTrackZ',
    dolly_to_cursor: 'Tool_CameraDollyToCursor',
    dolly_towards_cursor: 'Tool_CameraDollyTowardsCursor',
};

/** Set p to v: a keyframe at time t (or at the composition's current time when p is animated), else the static value. */
const SET_HELPER = `
var __set = function (p, v, t) {
  if (!p) throw new Error("This layer has no such option");
  if (t !== null) p.setValueAtTime(t, v);
  else if (p.numKeys > 0) p.setValueAtTime(c.time, v);
  else p.setValue(v);
};`;

/** Schema properties for a numeric option table. */
function numberSchema(spec) {
    return Object.fromEntries(Object.entries(spec).map(([k, [, min, max, description]]) => [k, { type: 'number', minimum: min, maximum: max, description }]));
}

/** `__set(group.prop, value, t);` statements for the numeric options given. */
function numberLines(a, spec, group) {
    return Object.entries(spec).filter(([k]) => a[k] !== undefined)
        .map(([k, [prop, min, max]]) => `__set(${group}.${prop}, ${num(a[k], { min, max, name: k })}, t);`);
}

/** The time argument as a JSX literal: seconds or null. */
function timeValue(a) {
    return a.time !== undefined ? num(a.time, { min: 0, name: 'time' }) : 'null';
}

/**
 * Add statements that set the Point of Interest of layer l to L: the check that
 * the layer has one goes first, so nothing changes on a one-node camera or light.
 */
function addPoi(a, L) {
    if (a.pointOfInterest === undefined) return;
    if (!Array.isArray(a.pointOfInterest) || a.pointOfInterest.length !== 3) throw new Error("'pointOfInterest' must be [x, y, z]");
    const v = json(a.pointOfInterest.map((x) => Number(num(x, { name: 'pointOfInterest' }))));
    L.unshift('if (l.autoOrient !== AutoOrientType.CAMERA_OR_POINT_OF_INTEREST) throw new Error(l.name + " has no Point of Interest: it is a one-node camera or light");');
    L.push(`__set(l.property("ADBE Transform Group").property("ADBE Point of Interest"), ${v}, t);`);
}

/** Run a body over the chosen layers with the option helpers, reporting each layer. */
function optionScript(label, a, check, lines, report) {
    return run(label, script(`${SET_HELPER}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), t = ${timeValue(a)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  ${check}
  var wasLocked = l.locked; l.locked = false;
  ${lines.join('\n  ')}
  l.locked = wasLocked;
  out.push(${report});
}
__result__ = { layers: out };`, { undo: label }));
}

/** Collect the ids of a composition's layers, and later report the layers that are new. */
const NEW_LAYERS = `
var __ids = function (comp) { var m = {}; for (var j = 1; j <= comp.numLayers; j++) m[comp.layer(j).id] = true; return m; };
var __added = function (comp, before) { var o = []; for (var j = 1; j <= comp.numLayers; j++) if (!before[comp.layer(j).id]) o.push(__layerInfo(comp.layer(j))); return o; };`;

export const tools = [
    {
        name: 'set_camera_options',
        description: 'Set camera layer options (Layer > Camera Settings, and Camera Options in the Timeline): zoom, F-Stop, depth of field, focus distance, aperture, blur level, iris shape, rotation, roundness, aspect ratio and diffraction fringe, highlight gain, threshold and saturation, and Point of Interest. Values are keyframed when the property is animated or a time is given',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'Which camera layers. Give indexes (1-based, from list_layers), names, or selected: true' },
                depthOfField: { type: 'boolean', description: 'Depth of Field on or off; the Advanced 3D renderer renders it in-engine' },
                ...numberSchema(CAMERA_NUMBERS),
                fStop: { type: 'number', minimum: 0.01, maximum: 1000, description: 'F-Stop (Camera Settings): sets Aperture to Zoom divided by the F-Stop. Not with aperture' },
                irisShape: { type: 'string', enum: IRIS_SHAPES, description: 'Iris Shape' },
                pointOfInterest: POI_SCHEMA,
                time: TIME_SCHEMA,
            },
            required: ['layers'],
        },
        auditArgs: { time: undefined, fStop: undefined },
        hints: { idempotent: true },
        features: [
            'aftereffects.three_d.camera_layer',
            'aftereffects.three_d.camera_settings',
            'aftereffects.three_d.camera_settings_option.f_stop',
            'aftereffects.three_d.camera_option.zoom',
            'aftereffects.three_d.camera_option.depth_of_field',
            'aftereffects.three_d.camera_option.focus_distance',
            'aftereffects.three_d.camera_option.aperture',
            'aftereffects.three_d.camera_option.blur_level',
            'aftereffects.three_d.camera_option.iris_shape',
            'aftereffects.three_d.camera_option.iris_rotation',
            'aftereffects.three_d.camera_option.iris_roundness',
            'aftereffects.three_d.camera_option.iris_aspect_ratio',
            'aftereffects.three_d.camera_option.iris_diffraction_fringe',
            'aftereffects.three_d.camera_option.highlight_gain',
            'aftereffects.three_d.camera_option.highlight_threshold',
            'aftereffects.three_d.camera_option.highlight_saturation',
            'aftereffects.three_d.depth_of_field_advanced_3d',
            'aftereffects.three_d.point_of_interest',
        ],
        handler: (a) => {
            if (a.fStop !== undefined && a.aperture !== undefined) throw new Error('Give fStop or aperture, not both');
            const L = [];
            if (a.depthOfField !== undefined) L.push(`__set(g.depthOfField, ${a.depthOfField ? 1 : 0}, t);`);
            L.push(...numberLines(a, CAMERA_NUMBERS, 'g'));
            if (a.fStop !== undefined) L.push(`__set(g.aperture, g.zoom.valueAtTime(t === null ? c.time : t, false) / ${num(a.fStop, { min: 0.01, max: 1000, name: 'fStop' })}, t);`);
            if (a.irisShape !== undefined) L.push(`__set(g.irisShape, ${IRIS_SHAPES.indexOf(enumOf(a.irisShape, IRIS_SHAPES, { name: 'irisShape' })) + 1}, t);`);
            addPoi(a, L);
            if (!L.length) throw new Error('Give at least one camera option to set');
            return optionScript('Camera options', a,
                'if (!(l instanceof CameraLayer)) throw new Error(l.name + " is not a camera layer");\n  var g = l.cameraOption;',
                L,
                '{ layer: l.index, name: l.name, zoom: g.zoom.value, depthOfField: g.depthOfField.value === 1, focusDistance: g.focusDistance.value, aperture: g.aperture.value, fStop: g.aperture.value > 0 ? g.zoom.value / g.aperture.value : null, blurLevel: g.blurLevel.value, irisShape: g.irisShape.value }');
        },
    },
    {
        name: 'set_light_options',
        description: 'Set light layer options (Layer > Light Settings, and Light Options in the Timeline): light type, intensity, colour, cone angle and feather, falloff type, radius and falloff distance, casts shadows, shadow darkness and diffusion, Point of Interest, and an environment light\'s source layer. Values are keyframed when the property is animated or a time is given',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'Which light layers. Give indexes (1-based, from list_layers), names, or selected: true' },
                lightType: { type: 'string', enum: Object.keys(LIGHT_TYPES), description: 'Light Type' },
                color: { ...COLOR_SCHEMA, description: 'Light colour: "#RRGGBB" or "rgb(r,g,b)" (0-255)' },
                ...numberSchema(LIGHT_NUMBERS),
                falloff: { type: 'string', enum: FALLOFF, description: 'Falloff type' },
                castsShadows: { type: 'boolean', description: 'Casts Shadows (spot, parallel and environment lights). Layers also need Material Options > Casts Shadows on' },
                pointOfInterest: POI_SCHEMA,
                lightSource: { type: 'integer', minimum: 1, description: 'Environment lights: index of the 2D layer in the same composition to light the scene with (Light Options > Source)' },
                time: TIME_SCHEMA,
            },
            required: ['layers'],
        },
        auditArgs: { time: undefined, color: '#FFE0B0' },
        hints: { idempotent: true },
        features: [
            'aftereffects.three_d.light_layer',
            'aftereffects.three_d.light_settings',
            'aftereffects.three_d.light_option.intensity',
            'aftereffects.three_d.light_option.color',
            'aftereffects.three_d.light_option.cone_angle',
            'aftereffects.three_d.light_option.cone_feather',
            'aftereffects.three_d.light_option.falloff',
            'aftereffects.three_d.light_option.radius',
            'aftereffects.three_d.light_option.falloff_distance',
            'aftereffects.three_d.light_option.casts_shadows',
            'aftereffects.three_d.light_option.shadow_darkness',
            'aftereffects.three_d.light_option.shadow_diffusion',
            'aftereffects.three_d.light_falloff_types',
            'aftereffects.three_d.lights_cast_shadows',
            'aftereffects.three_d.environment_light',
            'aftereffects.three_d.point_of_interest',
        ],
        handler: (a) => {
            const L = [];
            if (a.lightSource !== undefined) L.push(`var src = c.layer(${index(a.lightSource, { name: 'lightSource', max: 10000 })}); if (!(src instanceof AVLayer) || src === l) throw new Error("lightSource must be another footage, solid or composition layer"); l.lightSource = src;`);
            if (a.color !== undefined) L.push(`__set(g.color, ${colorValue(a.color)}, t);`);
            L.push(...numberLines(a, LIGHT_NUMBERS, 'g'));
            if (a.falloff !== undefined) L.push(`__set(g.falloff, ${FALLOFF.indexOf(enumOf(a.falloff, FALLOFF, { name: 'falloff' })) + 1}, t);`);
            if (a.castsShadows !== undefined) L.push(`__set(g.castsShadows, ${a.castsShadows ? 1 : 0}, t);`);
            addPoi(a, L);
            // The light type goes first: it decides which options and whether a Point of Interest exist.
            if (a.lightType !== undefined) L.unshift(`l.lightType = LightType.${LIGHT_TYPES[enumOf(a.lightType, Object.keys(LIGHT_TYPES), { name: 'lightType' })]};`);
            if (!L.length) throw new Error('Give at least one light option to set');
            return optionScript('Light options', a,
                'if (!(l instanceof LightLayer)) throw new Error(l.name + " is not a light layer");\n  var g = l.lightOption;',
                L,
                '{ layer: l.index, name: l.name, lightType: __enumName(l.lightType), lightSource: l.lightSource ? l.lightSource.index : null, intensity: g.intensity.value, color: g.color.value }');
        },
    },
    {
        name: 'set_material_options',
        description: 'Set a 3D layer\'s Material Options: casts shadows (off, on, only), light transmission, accepts shadows (off, on, only: a shadow catcher), accepts lights, ambient, diffuse, specular intensity and shininess, metal, appears in reflections, reflection intensity, sharpness and rolloff, transparency and its rolloff, and index of refraction. Also turns a layer into an environment layer (Layer > Environment Layer). Values are keyframed when the property is animated or a time is given',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'Which 3D layers. Give indexes (1-based, from list_layers), names, or selected: true' },
                castsShadows: { type: 'string', enum: Object.keys(ON_OFF_ONLY), description: MATERIAL_SWITCHES.castsShadows[1] },
                acceptsShadows: { type: 'string', enum: Object.keys(ON_OFF_ONLY), description: MATERIAL_SWITCHES.acceptsShadows[1] },
                appearsInReflections: { type: 'string', enum: Object.keys(ON_OFF_ONLY), description: MATERIAL_SWITCHES.appearsInReflections[1] },
                acceptsLights: { type: 'boolean', description: 'Accepts Lights: off leaves the layer unlit' },
                ...numberSchema(MATERIAL_NUMBERS),
                environmentLayer: { type: 'boolean', description: 'Layer > Environment Layer: use this footage or precomposition layer as the spherical environment for reflections (Cinema 4D renderer; Advanced 3D uses environment lights instead)' },
                time: TIME_SCHEMA,
            },
            required: ['layers'],
        },
        auditArgs: { time: undefined, indexOfRefraction: 1.5 },
        hints: { idempotent: true },
        features: [
            'aftereffects.three_d.material_options',
            'aftereffects.three_d.material_option.casts_shadows',
            'aftereffects.three_d.material_option.light_transmission',
            'aftereffects.three_d.material_option.accepts_shadows',
            'aftereffects.three_d.material_option.accepts_lights',
            'aftereffects.three_d.material_option.ambient',
            'aftereffects.three_d.material_option.diffuse',
            'aftereffects.three_d.material_option.specular_intensity',
            'aftereffects.three_d.material_option.specular_shininess',
            'aftereffects.three_d.material_option.metal',
            'aftereffects.three_d.material_option.appears_in_reflections',
            'aftereffects.three_d.material_option.reflection_intensity',
            'aftereffects.three_d.material_option.reflection_sharpness',
            'aftereffects.three_d.material_option.reflection_rolloff',
            'aftereffects.three_d.material_option.transparency',
            'aftereffects.three_d.material_option.transparency_rolloff',
            'aftereffects.three_d.material_option.index_of_refraction',
            'aftereffects.three_d.shadow_catcher',
            'aftereffects.three_d.environment_layer',
        ],
        handler: (a) => {
            const L = [];
            for (const [k, [prop]] of Object.entries(MATERIAL_SWITCHES)) {
                if (a[k] !== undefined) L.push(`__set(g.${prop}, ${ON_OFF_ONLY[enumOf(a[k], Object.keys(ON_OFF_ONLY), { name: k })]}, t);`);
            }
            if (a.acceptsLights !== undefined) L.push(`__set(g.acceptsLights, ${a.acceptsLights ? 1 : 0}, t);`);
            L.push(...numberLines(a, MATERIAL_NUMBERS, 'g'));
            const material = L.length > 0;
            if (a.environmentLayer !== undefined) L.unshift(`l.environmentLayer = ${bool(a.environmentLayer)};`);
            if (!L.length) throw new Error('Give at least one material option to set');
            return optionScript('Material options', a,
                `if (!(l instanceof AVLayer)) throw new Error(l.name + " is not a footage, solid, text, shape or composition layer");
  ${material ? 'if (!l.threeDLayer) throw new Error(l.name + " is not a 3D layer: turn on 3D with set_layer_properties threeD: true");' : ''}
  var g = l.materialOption;`,
                L,
                '{ layer: l.index, name: l.name, threeD: l.threeDLayer, environmentLayer: l.environmentLayer, castsShadows: l.threeDLayer ? g.castsShadows.value : null, acceptsShadows: l.threeDLayer ? g.acceptsShadows.value : null, acceptsLights: l.threeDLayer ? g.acceptsLights.value : null }');
        },
    },
    {
        name: 'set_geometry_options',
        description: 'Set a 3D layer\'s Geometry Options: extrude and bevel text and shape layers (bevel style, bevel depth, hole bevel depth, extrusion depth) or bend footage and precomposition layers (curvature, segments). Extrusion needs the Advanced 3D or Cinema 4D renderer (set_comp_3d_settings). Values are keyframed when the property is animated or a time is given',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'Which 3D layers. Give indexes (1-based, from list_layers), names, or selected: true' },
                bevelStyle: { type: 'string', enum: BEVEL_STYLES, description: 'Bevel Style (text and shape layers)' },
                ...numberSchema(GEOMETRY_NUMBERS),
                time: TIME_SCHEMA,
            },
            required: ['layers'],
        },
        auditArgs: { time: undefined },
        hints: { idempotent: true },
        features: [
            'aftereffects.three_d.geometry_options',
            'aftereffects.three_d.geometry_option.bevel_style',
            'aftereffects.three_d.geometry_option.bevel_depth',
            'aftereffects.three_d.geometry_option.hole_bevel_depth',
            'aftereffects.three_d.geometry_option.extrusion_depth',
            'aftereffects.three_d.geometry_option.curvature',
            'aftereffects.three_d.geometry_option.segments',
            'aftereffects.three_d.extruded_text_and_shapes',
        ],
        handler: (a) => {
            const L = [];
            if (a.bevelStyle !== undefined) L.push(`__set(g.bevelStyle, ${BEVEL_STYLES.indexOf(enumOf(a.bevelStyle, BEVEL_STYLES, { name: 'bevelStyle' })) + 1}, t);`);
            if (a.segments !== undefined && !Number.isInteger(Number(a.segments))) throw new Error("'segments' must be a whole number");
            L.push(...numberLines(a, GEOMETRY_NUMBERS, 'g'));
            if (!L.length) throw new Error('Give at least one geometry option to set');
            return optionScript('Geometry options', a,
                `if (!(l instanceof AVLayer)) throw new Error(l.name + " is not a text, shape, footage or composition layer");
  if (!l.threeDLayer) throw new Error(l.name + " is not a 3D layer: turn on 3D with set_layer_properties threeD: true");
  var g = l.geometryOption;
  if (!g) throw new Error(l.name + " has no Geometry Options");`,
                L,
                '{ layer: l.index, name: l.name }');
        },
    },
    {
        name: 'set_comp_3d_settings',
        description: 'Choose a composition\'s 3D renderer (Composition Settings > 3D Renderer: Classic 3D, Advanced 3D or Cinema 4D) and turn Draft 3D on or off (Composition panel). With no settings it reports the renderer, the installed renderers, Draft 3D and the active camera',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                renderer: { type: 'string', description: `${Object.keys(RENDERERS).join(', ')}, or a renderer id from this tool's renderers list` },
                draft3d: { type: 'boolean', description: 'Draft 3D: preview the scene in real time at draft quality' },
            },
        },
        auditArgs: { renderer: 'advanced_3d' },
        hints: { idempotent: true },
        features: [
            'aftereffects.three_d.composition_3d_renderer',
            'aftereffects.three_d.renderer_classic_3d',
            'aftereffects.three_d.renderer_advanced_3d',
            'aftereffects.three_d.renderer_cinema_4d',
            'aftereffects.three_d.draft_3d',
        ],
        handler: (a) => {
            let renderer = null;
            if (a.renderer !== undefined) {
                const r = String(a.renderer);
                renderer = RENDERERS[r] ?? r;
                if (!/^[\w .-]{1,80}$/.test(renderer)) throw new Error(`'renderer': use ${Object.keys(RENDERERS).join(', ')}, or an id from the renderers list`);
            }
            const L = [];
            if (renderer !== null) {
                L.push(`var want = ${str(renderer)}, ok = false;
for (var r = 0; r < c.renderers.length; r++) if (c.renderers[r] === want) ok = true;
if (!ok) throw new Error("Renderer " + want + " is not installed. Installed: " + c.renderers.join(", "));
c.renderer = want;`);
            }
            if (a.draft3d !== undefined) L.push(`c.draft3d = ${bool(a.draft3d)};`);
            return run('3D settings', script(`
var c = __comp(${compSpec(a.comp)});
${L.join('\n')}
var names = ${json(Object.fromEntries(Object.entries(RENDERERS).map(([k, v]) => [v, k])))};
__result__ = { comp: c.name, renderer: c.renderer, rendererName: names[c.renderer] || null, renderers: c.renderers, draft3d: c.draft3d, activeCamera: c.activeCamera ? c.activeCamera.index : null };`, L.length ? { undo: '3D settings' } : {}));
        },
    },
    {
        name: 'set_3d_view',
        description: 'Change the 3D view of a composition\'s Composition panel (View menu): switch to the active camera, front, left, top, back, right, bottom or a custom view (View > Switch 3D View) or the last view, reset the view, look at the selected or all layers, or create a camera from the current view. Opens the composition in the viewer first',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                view: { type: 'string', enum: Object.keys(VIEWS), description: 'The view to switch to (View > Switch 3D View; last = View > Switch to Last 3D View)' },
                action: { type: 'string', enum: Object.keys(VIEW_ACTIONS), description: 'Instead of a view: View > Reset 3D View, Look at Selected Layers, Look at All Layers, or Create Camera from 3D View' },
            },
        },
        auditArgs: { action: undefined },
        features: [
            'aftereffects.three_d.switch_3d_view',
            'aftereffects.three_d.view_active_camera',
            'aftereffects.three_d.view_front',
            'aftereffects.three_d.view_left',
            'aftereffects.three_d.view_top',
            'aftereffects.three_d.view_back',
            'aftereffects.three_d.view_right',
            'aftereffects.three_d.view_bottom',
            'aftereffects.three_d.view_custom_view_1',
            'aftereffects.three_d.view_custom_view_2',
            'aftereffects.three_d.view_custom_view_3',
            'aftereffects.three_d.switch_to_last_3d_view',
            'aftereffects.three_d.reset_3d_view',
            'aftereffects.three_d.look_at_selected_layers',
            'aftereffects.three_d.look_at_all_layers',
            'aftereffects.three_d.create_camera_from_3d_view',
        ],
        handler: (a) => {
            if ((a.view === undefined) === (a.action === undefined)) throw new Error('Give view or action');
            const id = a.view !== undefined
                ? VIEWS[enumOf(a.view, Object.keys(VIEWS), { name: 'view' })]
                : VIEW_ACTIONS[enumOf(a.action, Object.keys(VIEW_ACTIONS), { name: 'action' })];
            return run('3D view', script(`${NEW_LAYERS}
var c = __comp(${compSpec(a.comp)});
c.openInViewer();
var before = __ids(c);
app.executeCommand(${id});
__result__ = { comp: c.name, command: ${id}, added: __added(c, before) };`, { undo: '3D view' }));
        },
    },
    {
        name: 'run_camera_command',
        description: 'Run a Layer > Camera or Layer > Light command on a layer: link the focus distance to the Point of Interest or to another layer, set the focus distance to another layer once, create an orbit null, create a stereo 3D rig (whose Stereo 3D Controls set_property can change), or create cameras or lights from a 3D model layer. Selects the layers the command needs first',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                command: { type: 'string', enum: Object.keys(CAMERA_COMMANDS) },
                layer: { type: 'integer', minimum: 1, description: 'The camera layer index (focus, orbit null and stereo commands) or the 3D model layer index (create cameras or lights)' },
                target: { type: 'integer', minimum: 1, description: 'link_focus_to_layer and set_focus_to_layer: the layer to focus on' },
            },
            required: ['command', 'layer'],
        },
        auditArgs: { command: 'link_focus_to_layer', layer: 1, target: 2 },
        features: [
            'aftereffects.three_d.link_focus_distance_to_point_of_interest',
            'aftereffects.three_d.link_focus_distance_to_layer',
            'aftereffects.three_d.set_focus_distance_to_layer',
            'aftereffects.three_d.create_orbit_null',
            'aftereffects.three_d.create_stereo_3d_rig',
            'aftereffects.three_d.stereoscopic_3d',
            'aftereffects.three_d.create_cameras_from_3d_model',
            'aftereffects.three_d.create_lights_from_3d_model',
        ],
        handler: (a) => {
            const name = enumOf(a.command, Object.keys(CAMERA_COMMANDS), { name: 'command' });
            const cmd = CAMERA_COMMANDS[name];
            if (cmd.target && a.target === undefined) throw new Error(`${name} needs 'target', the layer to focus on`);
            if (!cmd.target && a.target !== undefined) throw new Error(`${name} takes no 'target'`);
            if (a.target !== undefined && Number(a.target) === Number(a.layer)) throw new Error("'target' must be a different layer from 'layer'");
            const check = cmd.on === 'camera'
                ? 'if (!(l instanceof CameraLayer)) throw new Error(l.name + " is not a camera layer");'
                : 'if (!(l instanceof ThreeDModelLayer)) throw new Error(l.name + " is not a 3D model layer");';
            return run('Camera command', script(`${NEW_LAYERS}
var c = __comp(${compSpec(a.comp)}), n = ${index(a.layer, { name: 'layer', max: 10000 })};
if (n < 1 || n > c.numLayers) throw new Error("Layer " + n + " does not exist; the composition has " + c.numLayers);
var l = c.layer(n);
${check}
${a.target !== undefined ? `var tn = ${index(a.target, { name: 'target', max: 10000 })};
if (tn < 1 || tn > c.numLayers) throw new Error("Layer " + tn + " does not exist; the composition has " + c.numLayers);
var target = c.layer(tn);` : 'var target = null;'}
c.openInViewer();
for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
l.selected = true;
if (target) target.selected = true;
var before = __ids(c);
app.executeCommand(${cmd.id});
var info = __layerInfo(l);
__result__ = { command: ${str(name)}, layer: info, added: __added(c, before), activeItem: proj.activeItem ? __itemInfo(proj.activeItem) : null };`, { undo: 'Camera command' }));
        },
    },
    {
        name: 'set_camera_tool',
        description: 'Choose a camera navigation tool in the Tools panel: the Unified Camera tool, Orbit (around the cursor, the scene or the camera\'s Point of Interest), Pan (Track XY) or Dolly (Track Z). Navigating with the tool in a viewer is done by hand',
        inputSchema: {
            type: 'object',
            properties: { tool: { type: 'string', enum: Object.keys(CAMERA_TOOLS), description: 'orbit, pan and dolly are the camera-centred variants' } },
            required: ['tool'],
        },
        hints: { idempotent: true },
        features: [
            'aftereffects.three_d.unified_camera_tool',
            'aftereffects.three_d.orbit_camera_tool',
            'aftereffects.three_d.pan_camera_tool',
            'aftereffects.three_d.dolly_camera_tool',
        ],
        handler: (a) => {
            const tool = CAMERA_TOOLS[enumOf(a.tool, Object.keys(CAMERA_TOOLS), { name: 'tool' })];
            return run('Camera tool', script(`
proj.toolType = ToolType.${tool};
__result__ = { tool: ${str(a.tool)}, toolType: __enumName(proj.toolType) };`));
        },
    },
];
