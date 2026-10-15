/**
 * The rest of the Filter menu: entries for apply_filter's FILTERS table
 * (src/tools/adjust.js) and the Edit menu's Fade and Filter > Last Filter.
 *
 * Filters with an ArtLayer.apply... method use it. The others run their
 * Action Manager event on the layer (made active first) with
 * DialogModes.NO, with descriptor keys as Photoshop records them. Filters
 * whose descriptor keys are not published (the Filter Gallery filters, Shape
 * Blur, Mezzotint, Diffuse, Extrude) take no options: Photoshop applies them
 * with the settings last used in their dialog.
 *
 * Each option is [schema, default, convert]: convert(value, name) checks the
 * caller's value and returns the script literal; a required option has no
 * default and its convert throws when it is missing.
 */
import { num, str, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

const s = (id) => `app.stringIDToTypeID(${JSON.stringify(id)})`;
const c = (id) => `app.charIDToTypeID(${JSON.stringify(id)})`;

/** Statements that run an Action Manager event on layer `l`, with descriptor `d` filled by `lines`. */
const am = (event, lines = []) => ['var d = new ActionDescriptor();', ...lines, 'doc.activeLayer = l;', `app.executeAction(${event}, d, DialogModes.NO)`].join('\n  ');

const required = (value, name) => {
    if (value === undefined || value === null) throw new Error(`${name} is required`);
    return value;
};

/** A number option. */
const number = (min, max, fallback, description) => [{ type: 'number', minimum: min, maximum: max, description }, fallback, (value, name) => num(required(value, name), { min, max, name })];

/** A whole-number option (Action Manager integers). */
const int = (min, max, fallback, description) => [{ type: 'integer', minimum: min, maximum: max, description }, fallback, (value, name) => {
    const v = num(required(value, name), { min, max, name });
    if (!Number.isInteger(Number(v))) throw new Error(`${name} must be a whole number`);
    return v;
}];

/** A true/false option. */
const flag = (fallback, description) => [{ type: 'boolean', description }, fallback, (value) => bool(value)];

/** An option chosen by name; `map` gives the script literal for each name. */
export const choice = (map, fallback, description) => {
    const names = Object.keys(map);
    return [{ type: 'string', enum: names, description: `${description}: ${names.join(', ')}` }, fallback, (value, name) => map[enumOf(required(value, name), names, { name })]];
};

/** An optional point { x, y } in pixels, as a UnitPoint literal ('' when omitted). */
const point = (description) => [{ type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description }, undefined, (value, name) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'object') throw new Error(`${name} must be { x, y } in pixels`);
    const x = num(value.x, { min: -30000, max: 30000, name: `${name}.x` }), y = num(value.y, { min: -30000, max: 30000, name: `${name}.y` });
    return `[new UnitValue(${x}, "px"), new UnitValue(${y}, "px")]`;
}];

/** A random seed: the given whole number, or a new one each run. */
const seed = (description) => [{ type: 'integer', minimum: 0, maximum: 2147483647, description: `${description}. Default a new random value each run` }, undefined, (value, name) => {
    if (value === undefined || value === null) return 'Math.floor(Math.random() * 2147483647)';
    const v = num(value, { min: 0, max: 2147483647, name });
    if (!Number.isInteger(Number(v))) throw new Error(`${name} must be a whole number`);
    return v;
}];

/** A list of whole numbers of a fixed length. */
const ints = (length, min, max, fallback, description) => [{ type: 'array', items: { type: 'integer', minimum: min, maximum: max }, minItems: length, maxItems: length, description }, fallback, (value, name) => {
    if (!Array.isArray(required(value, name)) || value.length !== length) throw new Error(`${name} takes ${length} whole numbers`);
    return `[${value.map((x, i) => {
        const v = num(x, { min, max, name: `${name}[${i}]` });
        if (!Number.isInteger(Number(v))) throw new Error(`${name}[${i}] must be a whole number`);
        return v;
    }).join(', ')}]`;
}];

/** A file the caller names, checked against the allowed folders, as a File literal. */
const file = (description) => [{ type: 'string', description: `${description} (absolute path)` }, undefined, (value, name) => `new File(${jsxPath(paths.validate(required(value, name)))})`];

/** Shear's curve: [[x, y], ...] points on the Shear dialog's grid. */
const curve = [{ type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 2, description: 'Points [[x, y], ...] of the shear curve on the dialog\'s grid, top to bottom' }, undefined, (value, name) => {
    if (!Array.isArray(required(value, name)) || value.length < 2) throw new Error(`${name} needs at least two [x, y] points`);
    return `[${value.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error(`${name}[${i}] must be [x, y]`);
        return `[${num(p[0], { min: -255, max: 255, name: `${name}[${i}][0]` })}, ${num(p[1], { min: -255, max: 255, name: `${name}[${i}][1]` })}]`;
    }).join(', ')}]`;
}];

/** Field Blur pins: [{ x, y, blur }] in pixels, unrolled into blurbWidget descriptors. Default one pin at the centre. */
const pins = [{ type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, blur: { type: 'number', minimum: 0, maximum: 500 } } }, minItems: 1, maxItems: 20, description: 'Blur pins [{ x, y, blur }]: position in pixels and blur in pixels (0-500). Default one pin at the centre, blur 15' }, undefined, (value, name) => {
    const list = value ?? [{ blur: 15 }];
    if (!Array.isArray(list) || !list.length || list.length > 20) throw new Error(`${name} takes 1 to 20 pins`);
    return list.map((p, i) => {
        if (!p || typeof p !== 'object') throw new Error(`${name}[${i}] must be { x, y, blur }`);
        const x = value ? num(p.x, { min: -30000, max: 30000, name: `${name}[${i}].x` }) : 'w / 2';
        const y = value ? num(p.y, { min: -30000, max: 30000, name: `${name}[${i}].y` }) : 'h / 2';
        const blur = num(p.blur ?? 15, { min: 0, max: 500, name: `${name}[${i}].blur` });
        return [
            'var wd = new ActionDescriptor();',
            `wd.putInteger(${s('blurbWidgetType')}, 0);`,
            `wd.putDouble(${s('blurbWidgetLocationX')}, ${x});`,
            `wd.putDouble(${s('blurbWidgetLocationY')}, ${y});`,
            `wd.putBoolean(${s('blurbWidgetSelected')}, ${i === 0});`,
            `wd.putBoolean(${s('blurbWidgetEffectEnabled')}, true);`,
            `wd.putDouble(${s('blurbGeneralBlurAmount')}, ${blur});`,
            `wl.putObject(${s('blurbWidget')}, wd);`,
        ].join('\n  ');
    }).join('\n  ');
}];

/** Maximum and Minimum's Preserve setting; when given they run as Action Manager events, which take it. */
export const PRESERVE = [{ type: 'string', enum: ['squareness', 'roundness'], description: 'Preserve: squareness or roundness' }, undefined, (value, name) => (value === undefined || value === null ? '' : enumOf(value, ['squareness', 'roundness'], { name }))];
export const preserveShape = (event, v) => am(s(event), [
    `d.putUnitDouble(${c('Rds ')}, ${c('#Pxl')}, ${v('radius')});`,
    `d.putEnumerated(${s('preserveShape')}, ${s('preserveShape')}, ${v('preserve') === 'roundness' ? c('Rndn') : s('squareness')});`,
]);

const f = (...ids) => ids.map((id) => `photoshop.filters.${id}`);
const UNDEFINED_AREAS = { wrap_around: 'UndefinedAreas.WRAPAROUND', repeat_edge: 'UndefinedAreas.REPEATEDGEPIXELS' };
const NOISE = { uniform: 'NoiseDistribution.UNIFORM', gaussian: 'NoiseDistribution.GAUSSIAN' };

/** Filter Gallery filters: table key -> [event stringID, atlas feature]. They run with the gallery's last-used settings. */
const GALLERY = {
    colored_pencil: 'coloredPencil', cutout: 'cutout', dry_brush: 'dryBrush', film_grain: 'filmGrain', fresco: 'fresco',
    neon_glow: 'neonGlow', paint_daubs: 'paintDaubs', palette_knife: 'paletteKnife', plastic_wrap: 'plasticWrap',
    poster_edges: 'posterEdges', rough_pastels: 'roughPastels', smudge_stick: 'smudgeStick', sponge: ['sponge', 'sponge_filter'],
    underpainting: 'underpainting', watercolor: 'watercolor',
    accented_edges: 'accentedEdges', angled_strokes: 'angledStrokes', crosshatch: 'crosshatch', dark_strokes: 'darkStrokes',
    ink_outlines: 'inkOutlines', spatter: 'spatter', sprayed_strokes: 'sprayedStrokes', sumi_e: 'sumie',
    bas_relief: 'basRelief', chalk_and_charcoal: 'chalkCharcoal', charcoal: 'charcoal', chrome: 'chrome', conte_crayon: 'conteCrayon',
    graphic_pen: 'graphicPen', halftone_pattern: 'halftoneScreen', note_paper: 'notePaper', photocopy: 'photocopy', plaster: 'plaster',
    reticulation: 'reticulation', stamp: 'stamp', torn_edges: 'tornEdges', water_paper: 'waterPaper',
    craquelure: 'craquelure', grain: 'grain', mosaic_tiles: 'mosaicPlugin', patchwork: 'patchwork', stained_glass: 'stainedGlass',
    texturizer: 'texturizer', glowing_edges: 'glowingEdges',
};

/** apply_filter entries beyond the ArtLayer methods adjust.js started with. */
export const MORE_FILTERS = {
    // Blur
    box_blur: { features: f('box_blur', 'box_blur_option.radius'), options: { radius: number(1, 2000, 10, 'Pixels') }, call: (v) => am(s('boxblur'), [`d.putUnitDouble(${c('Rds ')}, ${c('#Pxl')}, ${v('radius')});`]) },
    surface_blur: {
        features: f('surface_blur', 'surface_blur_option.radius', 'surface_blur_option.threshold'),
        options: { radius: number(1, 100, 5, 'Pixels'), threshold: int(2, 255, 15, 'Levels') },
        call: (v) => am(s('surfaceBlur'), [`d.putUnitDouble(${c('Rds ')}, ${c('#Pxl')}, ${v('radius')});`, `d.putInteger(${c('Thsh')}, ${v('threshold')});`]),
    },
    shape_blur: { features: f('shape_blur'), options: {}, call: () => am(s('shapeBlur')) },
    lens_blur: {
        features: f('lens_blur', 'lens_blur_option.depth_map', 'lens_blur_option.source', 'lens_blur_option.blur_focal_distance', 'lens_blur_option.invert', 'lens_blur_option.shape', 'lens_blur_option.radius', 'lens_blur_option.blade_curvature', 'lens_blur_option.rotation', 'lens_blur_option.specular_highlights', 'lens_blur_option.brightness', 'lens_blur_option.threshold', 'lens_blur_option.amount', 'lens_blur_option.uniform', 'lens_blur_option.gaussian', 'lens_blur_option.monochromatic'),
        options: {
            source: choice({ none: 'DepthMapSource.NONE', transparency: 'DepthMapSource.TRANSPARENCYCHANNEL', layer_mask: 'DepthMapSource.LAYERMASK' }, 'none', 'Depth map source'),
            focalDistance: int(0, 255, 0, 'Depth that stays in focus, 0-255'),
            invert: flag(false, 'Invert the depth map'),
            shape: choice({ triangle: 'Geometry.TRIANGLE', square: 'Geometry.SQUARE', pentagon: 'Geometry.PENTAGON', hexagon: 'Geometry.HEXAGON', heptagon: 'Geometry.HEPTAGON', octagon: 'Geometry.OCTAGON' }, 'hexagon', 'Iris shape'),
            radius: int(0, 100, 15, 'Iris radius'),
            bladeCurvature: int(0, 100, 0, 'Iris blade curvature'),
            rotation: int(0, 360, 0, 'Iris rotation in degrees'),
            brightness: int(0, 100, 0, 'Specular highlight brightness'),
            threshold: int(0, 255, 255, 'Specular highlight threshold'),
            noiseAmount: int(0, 100, 0, 'Noise added back'),
            noiseDistribution: choice(NOISE, 'uniform', 'Noise distribution'),
            monochromatic: flag(false, 'Monochromatic noise'),
        },
        call: (v) => `l.applyLensBlur(${['source', 'focalDistance', 'invert', 'shape', 'radius', 'bladeCurvature', 'rotation', 'brightness', 'threshold', 'noiseAmount', 'noiseDistribution', 'monochromatic'].map(v).join(', ')})`,
    },
    radial_blur: {
        features: f('radial_blur', 'radial_blur_option.amount', 'radial_blur_option.spin', 'radial_blur_option.zoom', 'radial_blur_option.quality', 'radial_blur_option.blur_center'),
        options: {
            amount: int(1, 100, 10, 'Strength'),
            method: choice({ spin: 'RadialBlurMethod.SPIN', zoom: 'RadialBlurMethod.ZOOM' }, 'spin', 'Blur method'),
            quality: choice({ draft: 'RadialBlurQuality.DRAFT', good: 'RadialBlurQuality.GOOD', best: 'RadialBlurQuality.BEST' }, 'good', 'Quality'),
            center: point('Blur centre { x, y } in pixels. Default the centre'),
        },
        call: (v) => `l.applyRadialBlur(${v('amount')}, ${v('method')}, ${v('quality')}${v('center') ? `, ${v('center')}` : ''})`,
    },
    field_blur: {
        features: f('blur_gallery', 'field_blur', 'blur_gallery_option.blur', 'blur_gallery_option.amount', 'blur_gallery_option.size', 'blur_gallery_option.roughness'),
        options: {
            pins,
            highQuality: flag(true, 'High quality'),
            noiseAmount: number(0, 100, 0, 'Noise amount, percent'),
            noiseSize: number(0, 100, 25, 'Noise grain size, percent'),
            noiseRoughness: number(0, 100, 50, 'Noise roughness, percent'),
            randomSeed: seed('Noise pattern seed'),
        },
        call: (v) => am(s('blurbTransform'), [
            'var w = __px(doc.width), h = __px(doc.height);',
            'var target = new ActionReference();',
            `target.putEnumerated(${c('Lyr ')}, ${c('Ordn')}, ${c('Trgt')});`,
            `d.putReference(${c('null')}, target);`,
            `d.putBoolean(${s('blurbType')}, true);`,
            `d.putInteger(${c('VrsM')}, 1);`,
            `d.putInteger(${c('VrsN')}, 0);`,
            'var rr = new ActionDescriptor();',
            `rr.putInteger(${c('Top ')}, 0);`,
            `rr.putInteger(${c('Left')}, 0);`,
            `rr.putInteger(${c('Btom')}, Math.round(h));`,
            `rr.putInteger(${c('Rght')}, Math.round(w));`,
            `d.putObject(${s('referenceRect')}, ${c('Rctn')}, rr);`,
            `d.putInteger(${s('blurbOpenPanel')}, 0);`,
            `d.putBoolean(${s('blurbGeneralBlurEffectApplied')}, true);`,
            `d.putBoolean(${s('blurbSaveMaskChannel')}, false);`,
            `d.putBoolean(${s('blurbHighQuality')}, ${v('highQuality')});`,
            'var wl = new ActionList();',
            v('pins'),
            `d.putList(${s('blurbWidgetList')}, wl);`,
            'var nz = new ActionDescriptor();',
            `nz.putUnitDouble(${c('Amnt')}, ${c('#Prc')}, ${v('noiseAmount')});`,
            `nz.putUnitDouble(${c('Sz  ')}, ${c('#Prc')}, ${v('noiseSize')});`,
            `nz.putUnitDouble(${s('roughness')}, ${c('#Prc')}, ${v('noiseRoughness')});`,
            `nz.putInteger(${c('RndS')}, ${v('randomSeed')});`,
            `d.putObject(${c('Nose')}, ${s('blurbGrainParams')}, nz);`,
            ...['0', 'w', 'w', '0'].map((x, i) => `d.putDouble(${c(`PuX${i}`)}, ${x});`),
            ...['0', '0', 'h', 'h'].map((y, i) => `d.putDouble(${c(`PuY${i}`)}, ${y});`),
        ]),
    },
    // Noise and Sharpen
    reduce_noise: {
        features: f('reduce_noise', 'reduce_noise_option.strength', 'reduce_noise_option.preserve_details', 'reduce_noise_option.reduce_color_noise', 'reduce_noise_option.sharpen_details', 'reduce_noise_option.remove_jpeg_artifacts'),
        options: {
            strength: int(0, 10, 6, 'Luminance noise reduction'),
            preserveDetails: int(0, 100, 60, 'Percent'),
            reduceColorNoise: int(0, 100, 45, 'Percent'),
            sharpenDetails: int(0, 100, 25, 'Percent'),
            removeJpegArtifacts: flag(false, 'Remove JPEG artifacts'),
        },
        call: (v) => am(s('denoise'), [
            'var chl = new ActionList(), cd = new ActionDescriptor(), cr = new ActionReference();',
            `cr.putEnumerated(${s('channel')}, ${s('channel')}, ${s('composite')});`,
            `cd.putReference(${s('channel')}, cr);`,
            `cd.putInteger(${s('amount')}, ${v('strength')});`,
            `cd.putInteger(${s('edgeFidelity')}, ${v('preserveDetails')});`,
            `chl.putObject(${s('channelDenoiseParams')}, cd);`,
            `d.putList(${s('channelDenoise')}, chl);`,
            `d.putUnitDouble(${s('colorNoise')}, ${s('percentUnit')}, ${v('reduceColorNoise')});`,
            `d.putUnitDouble(${s('sharpen')}, ${s('percentUnit')}, ${v('sharpenDetails')});`,
            `d.putBoolean(${s('removeJPEGArtifact')}, ${v('removeJpegArtifacts')});`,
            `d.putString(${s('preset')}, "Default");`,
        ]),
    },
    smart_sharpen: {
        features: f('smart_sharpen', 'smart_sharpen_option.amount', 'smart_sharpen_option.radius', 'smart_sharpen_option.reduce_noise', 'smart_sharpen_option.remove', 'smart_sharpen_option.angle', 'smart_sharpen_option.fade_amount', 'smart_sharpen_option.tonal_width'),
        options: {
            amount: number(1, 500, 200, 'Percent'),
            radius: number(0.1, 64, 1, 'Pixels'),
            reduceNoise: number(0, 100, 10, 'Percent'),
            remove: choice({ gaussian_blur: 'GsnB', lens_blur: 'LnsB', motion_blur: 'MtnB' }, 'lens_blur', 'Blur to remove'),
            angle: int(-180, 180, 0, 'Motion blur angle (remove: motion_blur)'),
            shadowFade: number(0, 100, 0, 'Shadows fade amount, percent'),
            shadowTonalWidth: number(0, 100, 50, 'Shadows tonal width, percent'),
            shadowRadius: int(1, 100, 1, 'Shadows radius, pixels'),
            highlightFade: number(0, 100, 0, 'Highlights fade amount, percent'),
            highlightTonalWidth: number(0, 100, 50, 'Highlights tonal width, percent'),
            highlightRadius: int(1, 100, 1, 'Highlights radius, pixels'),
        },
        call: (v) => am(s('smartSharpen'), [
            `d.putEnumerated(${s('presetKind')}, ${s('presetKindType')}, ${s('presetKindCustom')});`,
            `d.putBoolean(${s('useLegacy')}, false);`,
            `d.putUnitDouble(${c('Amnt')}, ${c('#Prc')}, ${v('amount')});`,
            `d.putUnitDouble(${c('Rds ')}, ${c('#Pxl')}, ${v('radius')});`,
            `d.putUnitDouble(${s('noiseReduction')}, ${c('#Prc')}, ${v('reduceNoise')});`,
            `d.putEnumerated(${c('blur')}, ${s('blurType')}, ${c(v('remove'))});`,
            ...(v('remove') === 'MtnB' ? [`d.putInteger(${c('mtnA')}, ${v('angle')});`] : []),
            ...[['sh', 'shadow', 'sdwM'], ['hl', 'highlight', 'hglM']].flatMap(([o, k, id]) => [
                `var ${o} = new ActionDescriptor();`,
                `${o}.putUnitDouble(${c('Amnt')}, ${c('#Prc')}, ${v(`${k}Fade`)});`,
                `${o}.putUnitDouble(${c('Wdth')}, ${c('#Prc')}, ${v(`${k}TonalWidth`)});`,
                `${o}.putInteger(${c('Rds ')}, ${v(`${k}Radius`)});`,
                `d.putObject(${c(id)}, ${s('adaptCorrectTones')}, ${o});`,
            ]),
        ]),
    },
    // Distort
    displace: {
        features: f('displace', 'displace_option.horizontal_scale', 'displace_option.vertical_scale', 'displace_option.stretch_to_fit', 'displace_option.tile', 'displace_option.wrap_around', 'displace_option.repeat_edge_pixels'),
        options: {
            mapFile: file('Displacement map, a Photoshop (PSD) file'),
            horizontalScale: int(-999, 999, 10, 'Percent'),
            verticalScale: int(-999, 999, 10, 'Percent'),
            map: choice({ stretch_to_fit: 'DisplacementMapType.STRETCHTOFIT', tile: 'DisplacementMapType.TILE' }, 'stretch_to_fit', 'How the map is sized'),
            undefinedAreas: choice(UNDEFINED_AREAS, 'repeat_edge', 'Undefined areas'),
        },
        call: (v) => `var mapFile = ${v('mapFile')};
  if (!mapFile.exists) throw new Error("Displacement map not found: " + mapFile.fsName);
  l.applyDisplace(${v('horizontalScale')}, ${v('verticalScale')}, ${v('map')}, ${v('undefinedAreas')}, mapFile)`,
    },
    polar_coordinates: {
        features: f('polar_coordinates', 'polar_coordinates_option.rectangular_to_polar', 'polar_coordinates_option.polar_to_rectangular'),
        options: { conversion: choice({ rectangular_to_polar: 'PolarConversionType.RECTANGULARTOPOLAR', polar_to_rectangular: 'PolarConversionType.POLARTORECTANGULAR' }, 'rectangular_to_polar', 'Conversion') },
        call: (v) => `l.applyPolarCoordinates(${v('conversion')})`,
    },
    ripple: {
        features: f('ripple', 'ripple_option.amount', 'ripple_option.size'),
        options: { amount: int(-999, 999, 100, 'Percent'), size: choice({ small: 'RippleSize.SMALL', medium: 'RippleSize.MEDIUM', large: 'RippleSize.LARGE' }, 'medium', 'Ripple size') },
        call: (v) => `l.applyRipple(${v('amount')}, ${v('size')})`,
    },
    shear: {
        features: f('shear', 'shear_option.wrap_around', 'shear_option.repeat_edge_pixels'),
        options: { curve, undefinedAreas: choice(UNDEFINED_AREAS, 'wrap_around', 'Undefined areas') },
        call: (v) => `l.applyShear(${v('curve')}, ${v('undefinedAreas')})`,
    },
    spherize: {
        features: f('spherize', 'spherize_option.amount', 'spherize_option.mode'),
        options: { amount: int(-100, 100, 100, 'Percent'), mode: choice({ normal: 'SpherizeMode.NORMAL', horizontal: 'SpherizeMode.HORIZONTAL', vertical: 'SpherizeMode.VERTICAL' }, 'normal', 'Mode') },
        call: (v) => `l.applySpherize(${v('amount')}, ${v('mode')})`,
    },
    wave: {
        features: f('wave', 'wave_option.number_of_generators', 'wave_option.wavelength', 'wave_option.amplitude', 'wave_option.scale', 'wave_option.type', 'wave_option.randomize', 'wave_option.undefined_areas'),
        options: {
            generators: int(1, 999, 5, 'Number of generators'),
            wavelengthMin: int(1, 998, 10, 'Minimum wavelength'),
            wavelengthMax: int(2, 999, 120, 'Maximum wavelength'),
            amplitudeMin: int(1, 998, 5, 'Minimum amplitude'),
            amplitudeMax: int(2, 999, 35, 'Maximum amplitude'),
            scaleHorizontal: int(1, 100, 100, 'Horizontal scale, percent'),
            scaleVertical: int(1, 100, 100, 'Vertical scale, percent'),
            type: choice({ sine: 'WaveType.SINE', triangle: 'WaveType.TRIANGULAR', square: 'WaveType.SQUARE' }, 'sine', 'Wave type'),
            undefinedAreas: choice(UNDEFINED_AREAS, 'repeat_edge', 'Undefined areas'),
            randomSeed: seed('Random seed (Randomize)'),
        },
        call: (v) => {
            if (Number(v('wavelengthMin')) >= Number(v('wavelengthMax'))) throw new Error('options.wavelengthMin must be below options.wavelengthMax');
            if (Number(v('amplitudeMin')) >= Number(v('amplitudeMax'))) throw new Error('options.amplitudeMin must be below options.amplitudeMax');
            return `l.applyWave(${['generators', 'wavelengthMin', 'wavelengthMax', 'amplitudeMin', 'amplitudeMax', 'scaleHorizontal', 'scaleVertical', 'type', 'undefinedAreas', 'randomSeed'].map(v).join(', ')})`;
        },
    },
    zigzag: {
        features: f('zigzag', 'zigzag_option.amount', 'zigzag_option.ridges', 'zigzag_option.pond_ripples', 'zigzag_option.out_from_center', 'zigzag_option.around_center'),
        options: { amount: int(-100, 100, 10, 'Amount'), ridges: int(1, 20, 5, 'Ridges'), style: choice({ pond_ripples: 'ZigZagType.PONDRIPPLES', out_from_center: 'ZigZagType.OUTFROMCENTER', around_center: 'ZigZagType.AROUNDCENTER' }, 'pond_ripples', 'Style') },
        call: (v) => `l.applyZigZag(${v('amount')}, ${v('ridges')}, ${v('style')})`,
    },
    glass: {
        features: f('glass', 'glass_option.distortion', 'glass_option.smoothness', 'glass_option.texture', 'glass_option.scaling', 'glass_option.invert'),
        options: {
            distortion: int(0, 20, 5, 'Distortion'),
            smoothness: int(1, 15, 3, 'Smoothness'),
            texture: choice({ blocks: 'TextureType.BLOCKS', canvas: 'TextureType.CANVAS', frosted: 'TextureType.FROSTED', tiny_lens: 'TextureType.TINYLENS' }, 'frosted', 'Texture'),
            scaling: int(50, 200, 100, 'Texture scaling, percent'),
            invert: flag(false, 'Invert the texture'),
        },
        call: (v) => `l.applyGlassEffect(${v('distortion')}, ${v('smoothness')}, ${v('scaling')}, ${v('invert')}, ${v('texture')})`,
    },
    // Pixelate
    color_halftone: {
        features: f('color_halftone', 'color_halftone_option.screen_angles'),
        options: { maxRadius: int(4, 127, 8, 'Maximum dot radius, pixels'), screenAngles: ints(4, -360, 360, [108, 162, 90, 45], 'Screen angle in degrees for channels 1 to 4') },
        call: (v) => am(s('colorHalftone'), [`d.putInteger(${c('Rds ')}, ${v('maxRadius')});`, `var angles = ${v('screenAngles')};`, ...[1, 2, 3, 4].map((i) => `d.putInteger(${c(`Ang${i}`)}, angles[${i - 1}]);`)]),
    },
    crystallize: { features: f('crystallize'), options: { cellSize: int(3, 300, 10, 'Cell size') }, call: (v) => am(s('crystallize'), [`d.putInteger(${c('ClSz')}, ${v('cellSize')});`]) },
    facet: { features: f('facet'), options: {}, call: () => am(s('facet')) },
    fragment: { features: f('fragment'), options: {}, call: () => am(s('fragment')) },
    mezzotint: { features: f('mezzotint'), options: {}, call: () => am(s('mezzotint')) },
    mosaic: { features: f('mosaic'), options: { cellSize: number(2, 200, 8, 'Cell size, pixels') }, call: (v) => am(s('mosaic'), [`d.putUnitDouble(${c('ClSz')}, ${c('#Pxl')}, ${v('cellSize')});`]) },
    pointillize: { features: f('pointillize'), options: { cellSize: int(3, 300, 5, 'Cell size') }, call: (v) => am(s('pointillize'), [`d.putInteger(${c('ClSz')}, ${v('cellSize')});`]) },
    // Render
    fibers: {
        features: f('fibers', 'fibers_option.variance', 'fibers_option.strength', 'fibers_option.randomize'),
        options: { variance: int(1, 64, 16, 'Variance'), strength: int(1, 64, 4, 'Strength'), randomSeed: seed('Random seed (Randomize)') },
        call: (v) => am(c('Fbrs'), [`d.putInteger(${c('Vrnc')}, ${v('variance')});`, `d.putInteger(${c('Strg')}, ${v('strength')});`, `d.putInteger(${c('RndS')}, ${v('randomSeed')});`]),
    },
    lens_flare: {
        features: f('lens_flare', 'lens_flare_option.brightness', 'lens_flare_option.flare_center', 'lens_flare_option.lens_type'),
        options: {
            brightness: int(10, 300, 100, 'Percent'),
            center: point('Flare centre { x, y } in pixels. Default the centre'),
            lensType: choice({ zoom: 'LensType.ZOOMLENS', prime_35mm: 'LensType.PRIME35', prime_105mm: 'LensType.PRIME105', movie_prime: 'LensType.MOVIEPRIME' }, 'zoom', 'Lens type'),
        },
        call: (v) => `l.applyLensFlare(${v('brightness')}, ${v('center') || '[new UnitValue(__px(doc.width) / 2, "px"), new UnitValue(__px(doc.height) / 2, "px")]'}, ${v('lensType')})`,
    },
    // Stylize
    diffuse: { features: f('diffuse'), options: {}, call: () => am(s('diffuse')) },
    emboss: {
        features: f('emboss', 'emboss_option.angle', 'emboss_option.height', 'emboss_option.amount'),
        options: { angle: int(-360, 360, 135, 'Light angle in degrees'), height: int(1, 10, 3, 'Height, pixels'), amount: int(1, 500, 100, 'Percent') },
        call: (v) => am(s('emboss'), [`d.putInteger(${c('Angl')}, ${v('angle')});`, `d.putInteger(${c('Hght')}, ${v('height')});`, `d.putInteger(${c('Amnt')}, ${v('amount')});`]),
    },
    extrude: { features: f('extrude'), options: {}, call: () => am(s('extrude')) },
    find_edges: { features: f('find_edges'), options: {}, call: () => am(s('findEdges')) },
    oil_paint: {
        features: f('oil_paint', 'oil_paint_option.stylization', 'oil_paint_option.cleanliness', 'oil_paint_option.scale', 'oil_paint_option.bristle_detail', 'oil_paint_option.angle', 'oil_paint_option.shine'),
        options: {
            stylization: number(0.1, 10, 2.5, 'Stylization'),
            cleanliness: number(0, 10, 7.5, 'Cleanliness'),
            scale: number(0.1, 10, 1, 'Brush scale'),
            bristleDetail: number(0, 10, 0, 'Bristle detail'),
            lighting: flag(true, 'Lighting on'),
            angle: int(-180, 180, -60, 'Light angle in degrees'),
            shine: number(0, 10, 1, 'Shine'),
        },
        call: (v) => am(s('oilPaint'), [
            `d.putBoolean(${s('lightingOn')}, ${v('lighting')});`,
            `d.putDouble(${s('stylization')}, ${v('stylization')});`,
            `d.putDouble(${s('cleanliness')}, ${v('cleanliness')});`,
            `d.putDouble(${s('brushScale')}, ${v('scale')});`,
            `d.putDouble(${s('microBrush')}, ${v('bristleDetail')});`,
            `d.putInteger(${c('LghD')}, ${v('angle')});`,
            `d.putDouble(${s('specularity')}, ${v('shine')});`,
        ]),
    },
    solarize: { features: f('solarize'), options: {}, call: () => am(s('solarize')) },
    tiles: {
        features: f('tiles'),
        options: { number: int(1, 99, 10, 'Number of tiles'), maxOffset: int(1, 99, 10, 'Maximum offset, percent'), fill: choice({ background: 'FlBc', foreground: 'FlFr', inverse: 'FlIn', unaltered: 'FlSm' }, 'background', 'Fill empty area with') },
        call: (v) => am(s('tiles'), [`d.putInteger(${c('TlNm')}, ${v('number')});`, `d.putInteger(${c('TlOf')}, ${v('maxOffset')});`, `d.putEnumerated(${c('FlCl')}, ${c('FlCl')}, ${c(v('fill'))});`]),
    },
    trace_contour: {
        features: f('trace_contour', 'trace_contour_option.level', 'trace_contour_option.lower', 'trace_contour_option.upper'),
        options: { level: int(0, 255, 128, 'Level'), edge: choice({ lower: 'Lwr ', upper: 'Upr ' }, 'lower', 'Edge') },
        call: (v) => am(s('traceContour'), [`d.putInteger(${c('Lvl ')}, ${v('level')});`, `d.putEnumerated(${c('Edg ')}, ${c('CntE')}, ${c(v('edge'))});`]),
    },
    wind: {
        features: f('wind', 'wind_option.wind', 'wind_option.blast', 'wind_option.stagger'),
        options: { method: choice({ wind: 'Wnd ', blast: 'Blst', stagger: 'Stgr' }, 'wind', 'Method'), direction: choice({ left: 'Left', right: 'Rght' }, 'right', 'Direction') },
        call: (v) => am(s('wind'), [`d.putEnumerated(${c('WndM')}, ${c('WndM')}, ${c(v('method'))});`, `d.putEnumerated(${c('Drct')}, ${c('Drct')}, ${c(v('direction'))});`]),
    },
    // Video and Other
    de_interlace: {
        features: f('de_interlace', 'de_interlace_option.eliminate', 'de_interlace_option.duplication', 'de_interlace_option.interpolation'),
        options: { eliminate: choice({ odd: 'EliminateFields.ODDFIELDS', even: 'EliminateFields.EVENFIELDS' }, 'odd', 'Fields to eliminate'), create: choice({ duplication: 'CreateFields.DUPLICATION', interpolation: 'CreateFields.INTERPOLATION' }, 'interpolation', 'Create new fields by') },
        call: (v) => `l.applyDeInterlace(${v('eliminate')}, ${v('create')})`,
    },
    custom: {
        features: f('custom', 'custom_option.scale', 'custom_option.offset'),
        options: { matrix: ints(25, -999, 999, undefined, 'The 5x5 matrix, 25 values left to right, top to bottom'), scale: int(1, 9999, 1, 'Divide the sum by'), offset: int(-9999, 9999, 0, 'Add to the result') },
        call: (v) => `l.applyCustomFilter(${v('matrix')}, ${v('scale')}, ${v('offset')})`,
    },
    hsb_hsl: {
        features: f('hsb_hsl'),
        options: { input: choice({ rgb: 'RGBC', hsb: 'HSBl', hsl: 'HSLC' }, 'rgb', 'Input mode'), output: choice({ rgb: 'RGBC', hsb: 'HSBl', hsl: 'HSLC' }, 'hsb', 'Row order (output)') },
        call: (v) => am(c('HsbP'), [`d.putEnumerated(${c('Inpt')}, ${c('ClrS')}, ${c(v('input'))});`, `d.putEnumerated(${c('Otpt')}, ${c('ClrS')}, ${c(v('output'))});`]),
    },
    camera_raw: {
        features: f('camera_raw_filter'),
        options: {
            temperature: int(-100, 100, 0, 'Relative temperature'),
            tint: int(-100, 100, 0, 'Tint'),
            exposure: number(-5, 5, 0, 'Exposure, EV'),
            ...Object.fromEntries(['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance'].map((k) => [k, int(-100, 100, 0, k[0].toUpperCase() + k.slice(1))])),
        },
        call: (v) => am(s('Adobe Camera Raw Filter'), [
            `d.putString(${c('CrVe')}, "18.2.2");`,
            `d.putInteger(${c('PrVN')}, 6);`,
            `d.putInteger(${c('PrVe')}, 251920384);`,
            `d.putEnumerated(${c('WBal')}, ${c('WBal')}, ${c('Cst ')});`,
            `d.putInteger(${c('Temp')}, ${v('temperature')});`,
            `d.putInteger(${c('Tint')}, ${v('tint')});`,
            `d.putDouble(${c('Ex12')}, ${v('exposure')});`,
            ...[['contrast', 'Cr12'], ['highlights', 'Hi12'], ['shadows', 'Sh12'], ['whites', 'Wh12'], ['blacks', 'Bk12'], ['texture', 'CrTx'], ['clarity', 'Cl12'], ['dehaze', 'Dhze'], ['vibrance', 'Vibr']]
                .map(([k, id]) => `d.putInteger(${c(id)}, ${v(k)});`),
        ]),
    },
    ...Object.fromEntries(Object.entries(GALLERY).map(([key, ev]) => {
        const [event, feature] = Array.isArray(ev) ? ev : [ev, key];
        return [key, { features: f(feature), options: {}, call: () => am(s(event)) }];
    })),
};

/** Edit > Fade blend modes: name -> blendMode stringID. */
const FADE_MODES = {
    normal: 'normal', dissolve: 'dissolve', darken: 'darken', multiply: 'multiply', color_burn: 'colorBurn', linear_burn: 'linearBurn',
    darker_color: 'darkerColor', lighten: 'lighten', screen: 'screen', color_dodge: 'colorDodge', linear_dodge: 'linearDodge',
    lighter_color: 'lighterColor', overlay: 'overlay', soft_light: 'softLight', hard_light: 'hardLight', vivid_light: 'vividLight',
    linear_light: 'linearLight', pin_light: 'pinLight', hard_mix: 'hardMix', difference: 'difference', exclusion: 'exclusion',
    subtract: 'blendSubtraction', divide: 'blendDivide', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

export const tools = [
    {
        name: 'repeat_last_filter',
        description: 'Apply the last filter again, with the same settings, to layers (Filter > Last Filter). A filter must have been applied in this Photoshop session',
        inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA, description: 'Layers. Default the active layer' } } },
        features: ['photoshop.filters.last_filter'],
        hints: {},
        handler: (a) => run('Repeat last filter', script(`
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  doc.activeLayer = l;
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(${s('menuItemClass')}, ${s('menuItemType')}, ${s('lastFilter')});
  d.putReference(${c('null')}, r);
  app.executeAction(${s('select')}, d, DialogModes.NO);
}
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { layers: out };`)),
    },
    {
        name: 'fade_filter',
        description: 'Fade the filter, adjustment or paint stroke just applied: blend it with what was there before at an opacity and blend mode (Edit > Fade). Only works directly after that edit',
        inputSchema: {
            type: 'object',
            properties: {
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent of the edit to keep' },
                mode: { type: 'string', enum: Object.keys(FADE_MODES), description: 'Blend mode. Default normal' },
            },
            required: ['opacity'],
        },
        features: ['photoshop.filters.fade', 'photoshop.filters.fade_option.opacity', 'photoshop.filters.fade_option.mode'],
        hints: {},
        handler: (a) => run('Fade', script(`
var d = new ActionDescriptor();
d.putUnitDouble(${s('opacity')}, ${c('#Prc')}, ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })});
d.putEnumerated(${s('mode')}, ${s('blendMode')}, app.stringIDToTypeID(${str(FADE_MODES[enumOf(a.mode ?? 'normal', Object.keys(FADE_MODES), { name: 'mode' })])}));
app.executeAction(${s('fade')}, d, DialogModes.NO);
__result__ = { opacity: ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })}, mode: ${str(a.mode ?? 'normal')} };`)),
    },
];
