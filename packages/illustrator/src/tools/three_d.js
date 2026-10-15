/**
 * 3D effects applied with PageItem.applyEffect.
 *
 * The 3D and Materials panel has no object model. Its effect ("Adobe
 * Geometry3D") is written here with the parameters Illustrator 28 stores for
 * Effect > 3D and Materials > Extrude & Bevel, Revolve, Inflate and Rotate,
 * as read back and re-applied by illustrator-com-skill's effects sweep
 * (Moksa1123/illustrator-com-skill, presets/effects.json). Only parameters
 * whose meaning those defaults make plain are offered: object type, depth,
 * cap, revolve angle, inflate both sides, and wireframe rendering. Lighting,
 * materials, rotation and ray tracing stay at the command's defaults.
 *
 * The classic effect ("Adobe 3D Effect", Effect > 3D (Classic)) follows
 * LE_3DEffect in mark1bean/live-effect-functions-for-illustrator, which
 * ExpandPattern.jsx (swwwitch/illustrator-scripts) also uses. Its rotation is
 * stored twice, as angles and as a matrix; the matrix below reproduces the
 * one Illustrator writes for its default angles (-18, -26, 8).
 */
import { num, bool, enumOf, str } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

const TYPES = ['extrude', 'revolve', 'inflate', 'rotate'];
const CLASSIC_STYLE = { extrude: 0, revolve: 1, rotate: 2 };
const SURFACES = { wireframe: 0, no_shading: 1, diffuse: 2, plastic: 3 };

/** A distance in points as a script expression, scaled for large-canvas documents. */
const dist = (v, name) => `(${num(v, { min: 0, max: 2000, name })} / __sf(doc))`;
/** Data pairs [type, key, expression] as one script string expression. */
const dict = (parts) => parts.map(([t, k, e]) => `"${t} ${k} " + ${e}`).join(' + " " + ');

/** The Off-Axis Front rotation the Extrude, Revolve and Rotate commands store, in radians. */
const OFF_AXIS = ['-0.314159', '-0.45378561', '-0.1413717'];

/** "Adobe Geometry3D" data for an object type, with the caller's values. */
function geometry3d(type, o) {
    const op = { extrude: 0, revolve: 3, inflate: 2, rotate: 4 }[type];
    const rot = type === 'inflate' ? ['0.0', '0.0', '0.0'] : OFF_AXIS;
    const cap = o.cap === false ? '0' : '1';
    const head = [
        ['R', 'Geometry3DkSunlightRotationKey', '145.0'], ['R', 'Geometry3DkSunlightElevationKey', '45.0'],
        ['R', 'Geometry3DkSunlightCloudinessKey', '40.0'], ['B', 'Geometry3DkSunlightVisibilityKey', '1'],
        ['R', 'Geometry3DkSunlightIntensityKey', '70.0'], ['I', 'Geometry3DkOutputProfileKey', '0'],
        ['B', 'Geometry3DkUseDynamicShadowBoundsKey', '1'], ['B', 'Geometry3DkGlobalLightKey', '1'],
        ['I', 'Geometry3DkShadowProfileKey', '0'], ['R', 'Geometry3DkShadowGroundDistanceKey', '0.0'],
        ['I', 'Geometry3DkEngineProfileKey', '0'], ['I', 'Geometry3DkQualityProfileKey', '1'],
        ['R', 'Geometry3DkSunlightNameCounterKey', '1.0'], ['R', 'Geometry3DkGlobalLightIntensityKey', '50.0'],
        ['R', 'Geometry3DkShadowSpreadKey', '50.0'], ['B', 'Geometry3DkRenderAsWireframe', o.wireframe ? '1' : '0'],
        ['B', 'Geometry3DkReduceNoiseKey', '1'], ['I', 'Geometry3DkOperationTypeKey', String(op)],
    ];
    const extrude = [
        ['R', 'Geometry3DkExtrudeDepthKey', o.depth === undefined ? (type === 'extrude' ? '50.0' : '10.0') : dist(o.depth, 'depth')],
        ['B', 'Geometry3DkExtrudeCapKey', cap], ['R', 'Geometry3DkExtrudeTaperEndKey', '100.0'],
        ['R', 'Geometry3DkExtrudeTwistEndKey', '0.0'], ['R', 'Geometry3DkExtrudeTwistBeginKey', '0.0'],
        ['R', 'Geometry3DkExtrudeTaperBeginKey', '100.0'],
    ];
    const material = [
        ['R', 'MaterialDensity', '100.0'], ['R', 'MaterialMetallic', '0.0'], ['R', 'MaterialOffsetY', '0.0'],
        ['R', 'Geometry3DkRotationXKey', rot[0]], ['R', 'MaterialRotation', '0.0'], ['R', 'MaterialRoughness', '40.0'],
        ['R', 'Geometry3DkFOVKey', '0.0'], ['R', 'Geometry3DkRotationZKey', rot[2]], ['R', 'Geometry3DkRotationYKey', rot[1]],
        ['I', 'Geometry3DkContainKeys', { extrude: '1', revolve: '8', inflate: '5', rotate: '1' }[type]],
        ['I', 'MaterialResolutionKey', '10'], ['R', 'MaterialOffsetX', '0.0'],
    ];
    const revolve = [
        ['R', 'Geometry3DkRevolveOffsetKey', '0.0'],
        ['R', 'Geometry3DkRevolveAngleKey', num(o.revolveAngle ?? 360, { min: 0, max: 360, name: 'revolveAngle' })],
        ['B', 'Geometry3DkRevolveEdgeKey', '1'], ['R', 'Geometry3DkRevolveTwistBeginKey', '0.0'],
        ['B', 'Geometry3DkRevolveCapKey', cap], ['R', 'Geometry3DkRevolveTwistEndKey', '0.0'],
        ['R', 'Geometry3DkRevolveTaperBeginKey', '100.0'], ['R', 'Geometry3DkRevolveTaperEndKey', '100.0'],
    ];
    const inflate = [['B', 'Geometry3DkInflateBothSidesKey', o.bothSides ? '1' : '0'], ['R', 'Geometry3DkInflateStrengthKey', '100.0']];
    const parts = type === 'revolve' ? [...head, ...material, ...revolve]
        : [...head, ...extrude, ...material, ...(type === 'inflate' ? inflate : [])];
    return `'<LiveEffect name="Adobe Geometry3D"><Dict data="' + ${dict(parts.map(([t, k, v]) => [t, k, /^[-\d.]+$/.test(v) ? `"${v}"` : v]))} + ' "/></LiveEffect>'`;
}

/** 4x4 row-major product a * b. */
function multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[i * 4 + j] += b[i * 4 + k] * a[k * 4 + j];
    return out;
}

/** The classic effect's mat_00..mat_33 for rotations in degrees (LE_3DEffect's mat4RotationFromXYZ). */
export function classicMatrix(x, y, z) {
    const r = (d) => (-d * Math.PI) / 180;
    const [sx, cx, sy, cy, sz, cz] = [Math.sin(r(x)), Math.cos(r(x)), Math.sin(r(y)), Math.cos(r(y)), Math.sin(r(z)), Math.cos(r(z))];
    const rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
    const ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
    const rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = multiply(multiply(rx, ry), rz);
    // The adjugate of a rotation is its transpose.
    return [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map((i) => Math.round(m[i] * 1e9) / 1e9);
}

/** "Adobe 3D Effect" (classic) for extrude, revolve or rotate. */
function classic3d(type, o) {
    const angle = (v, d, name) => Number(num(v ?? d, { min: -180, max: 180, name }));
    const [x, y, z] = [angle(o.rotation?.x, -18, 'rotation.x'), angle(o.rotation?.y, -26, 'rotation.y'), angle(o.rotation?.z, 8, 'rotation.z')];
    const m = classicMatrix(x, y, z);
    const keys = ['00', '01', '02', '03', '10', '11', '12', '13', '20', '21', '22', '23', '30', '31', '32', '33'];
    const surface = o.surface === undefined ? (type === 'rotate' ? 2 : 3) : SURFACES[enumOf(o.surface, Object.keys(SURFACES), { name: 'surface' })];
    const cap = o.cap === false ? '0' : '1';
    const lit = (v) => `"${v}"`;
    const parts = [
        ...keys.map((k, i) => ['R', `mat_${k}`, lit(m[i])]),
        ['I', 'effectStyle', lit(CLASSIC_STYLE[type])],
        ['R', 'rotX', lit(x)], ['R', 'rotY', lit(y)], ['R', 'rotZ', lit(z)],
        ['R', 'cameraPerspective', lit(num(o.perspective ?? 0, { min: 0, max: 160, name: 'perspective' }))],
        ['R', 'extrudeDepth', o.depth === undefined ? lit(50) : dist(o.depth, 'depth')],
        ['R', 'surfaceAmbient', lit(70)], ['I', 'shadeMode', lit(2)], ['I', 'surfaceStyle', lit(surface)],
        ['R', 'surfaceMatte', lit(40)], ['R', 'surfaceGloss', lit(10)], ['R', 'blendSteps', lit(25)],
        ['B', 'preserveSpots', lit(0)], ['B', 'extrudeCap', lit(cap)],
        ['R', 'revolveAngle', lit(num(o.revolveAngle ?? 360, { min: 0, max: 360, name: 'revolveAngle' }))],
        ['R', 'revolveOffset', lit(0)], ['B', 'revolveCap', lit(cap)], ['I', 'revolveAxisMode', lit(0)],
        ['R', 'bevelHeight', lit(4)], ['B', 'bevelExtentIn', lit(1)], ['B', 'shadeMaps', lit(0)],
        ['B', 'showHiddenSurfaces', lit(0)], ['B', 'invisibleGeo', lit(0)], ['I', 'numArtMaps', lit(0)],
        ['I', '3Dversion', lit(2)], ['B', 'paramsDictionaryInitialized', lit(1)], ['I', 'numLights', lit(1)],
    ];
    return `'<LiveEffect name="Adobe 3D Effect"><Dict data="' + ${dict(parts)} + ' "><Entry name="shadeColor" valueType="F"><Fill color="5 0 0 0"/></Entry>`
        + '<Entry name="light0" valueType="D"><Dict data="R lightIntensity 1 R lightDirX -0.99 R lightDirY 0 R lightDirZ -1 R lightPosX 0 R lightPosY 0 R lightPosZ -1 "/></Entry></Dict></LiveEffect>\'';
}

/** Refuse options that do not belong to this type or version of the effect. */
function check(a) {
    const type = enumOf(a.type, TYPES, { name: 'type' });
    const classic = Boolean(a.classic);
    const bad = (cond, msg) => { if (cond) throw new Error(msg); };
    bad(classic && type === 'inflate', 'Inflate has no classic version: leave classic false');
    for (const k of ['rotation', 'perspective', 'surface']) bad(!classic && a[k] !== undefined, `${k} needs classic: true. The 3D and Materials effect keeps the command's default ${k === 'surface' ? 'materials and lighting' : 'rotation and perspective'}`);
    for (const k of ['bothSides', 'wireframe']) bad(classic && a[k] !== undefined, `${k} belongs to the 3D and Materials effect: leave classic false${k === 'wireframe' ? ', or use surface: "wireframe"' : ''}`);
    bad(a.depth !== undefined && !['extrude', 'inflate'].includes(type), 'depth applies to extrude and inflate');
    bad(a.cap !== undefined && !['extrude', 'revolve'].includes(type), 'cap applies to extrude and revolve');
    bad(a.revolveAngle !== undefined && type !== 'revolve', 'revolveAngle applies to revolve');
    bad(a.bothSides !== undefined && type !== 'inflate', 'bothSides applies to inflate');
    return { type, classic };
}

export const tools = [
    {
        name: 'apply_3d_effect',
        description: 'Make objects or text 3D with a live effect (Effect > 3D and Materials): extrude, revolve, inflate, or rotate (a flat plane turned in 3D). It stays editable in the 3D and Materials panel unless expand is true. The current effect takes depth, cap, revolveAngle, bothSides and wireframe; lighting, materials and rotation stay at the menu command\'s defaults (Off-Axis Front). With classic: true it applies Effect > 3D (Classic) instead, which also takes rotation angles, perspective and a surface style',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                type: { type: 'string', enum: TYPES },
                classic: { type: 'boolean', description: 'Use the classic effect (extrude, revolve, rotate). Default false', default: false },
                depth: { type: 'number', minimum: 0, maximum: 2000, description: 'Extrude or inflate depth in points. Default 50 (extrude), 10 (inflate)' },
                cap: { type: 'boolean', description: 'Extrude and revolve: cap on, solid (true, default) or off, hollow' },
                revolveAngle: { type: 'number', minimum: 0, maximum: 360, description: 'Revolve angle in degrees. Default 360' },
                bothSides: { type: 'boolean', description: 'Inflate both sides. Default false' },
                wireframe: { type: 'boolean', description: 'Render as wireframe. Default false' },
                rotation: {
                    type: 'object',
                    description: 'Classic only: rotation in degrees (-180 to 180). Default x -18, y -26, z 8 (Off-Axis Front)',
                    properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
                },
                perspective: { type: 'number', minimum: 0, maximum: 160, description: 'Classic only: perspective angle in degrees. Default 0' },
                surface: { type: 'string', enum: Object.keys(SURFACES), description: 'Classic only. Default plastic (diffuse for rotate)' },
                expand: { type: 'boolean', description: 'Expand the result to plain artwork (Object > Expand Appearance). Default false', default: false },
            },
            required: ['target', 'type'],
        },
        features: [
            'illustrator.three_d.extrude_bevel',
            'illustrator.three_d.revolve',
            'illustrator.three_d.inflate',
            'illustrator.three_d.rotate',
            'illustrator.three_d.extrude_classic',
            'illustrator.three_d.revolve_classic',
            'illustrator.three_d.rotate_classic',
            'illustrator.three_d.object_option.plane',
            'illustrator.three_d.object_option.extrude',
            'illustrator.three_d.object_option.revolve',
            'illustrator.three_d.object_option.inflate',
            'illustrator.three_d.object_option.depth',
            'illustrator.three_d.object_option.cap',
            'illustrator.three_d.wireframe',
            'illustrator.three_d.text_3d',
            'illustrator.appearance.expand_appearance',
        ],
        menuCommands: ['expandStyle'],
        auditArgs: { type: 'extrude', depth: 24, cap: false, wireframe: true, expand: true, revolveAngle: undefined, bothSides: undefined, rotation: undefined, perspective: undefined, surface: undefined },
        handler: (a) => {
            const { type, classic } = check(a);
            const xml = classic ? classic3d(type, a) : geometry3d(type, a);
            return run('Apply 3D effect', script(`
var items = __targets(doc, ${targetSpec(a.target)}), xml = ${xml}, out = [];
for (var i = 0; i < items.length; i++) {
  var target = items[i];
  target.applyEffect(xml);
  ${a.expand ? `doc.selection = null;
  target.selected = true;
  app.executeMenuCommand("expandStyle");
  var sel = doc.selection;
  if (!sel || !sel.length) throw new Error("Expanding produced no artwork");
  for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));` : 'out.push(__itemInfo(doc, target));'}
}
__result__ = { type: ${str(type)}, classic: ${bool(classic)}, expanded: ${bool(a.expand)}, items: out };`));
        },
    },
];
