/**
 * Video and animation: the Timeline panel in video timeline mode (clips,
 * playhead, work area, keyframes, transitions, video layers, Render Video) and
 * in frame animation mode (frames, tweening, frames to and from layers).
 *
 * The Photoshop DOM has no timeline object, so everything here goes through
 * the Action Manager: the timeline and animationClass classes, the
 * animationFrameClass frame references, the timeline events (makeTimeline,
 * moveInTime, moveOutTime, addTimelineTransition, ...) and the Timeline panel's
 * menu items. Times are { seconds, frames } at the timeline's frame rate.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

/** Action Manager helpers shared by the video tools' scripts. */
const AM = String.raw`
var __s = function (id) { return app.stringIDToTypeID(id); };
var __event = function (id, d) { return app.executeAction(app.stringIDToTypeID(id), d || new ActionDescriptor(), DialogModes.NO); };
var __menu = function (id) { app.runMenuItem(app.stringIDToTypeID(id)); };
var __onTarget = function (eventId, cls) {
  var r = new ActionReference(), d = new ActionDescriptor();
  r.putEnumerated(__s(cls), __s("ordinal"), __s("targetEnum"));
  d.putReference(__s("target"), r);
  return __event(eventId, d);
};
var __tlGet = function (prop) {
  var r = new ActionReference();
  r.putProperty(__s("property"), __s(prop));
  r.putClass(__s("timeline"));
  return app.executeActionGet(r);
};
var __rate = function () {
  try { return __tlGet("frameRate").getDouble(__s("frameRate")); } catch (e) { throw new Error("The document has no video timeline: create one first"); }
};
var __tc = function (seconds, frames, rate) {
  var d = new ActionDescriptor();
  d.putInteger(__s("seconds"), seconds);
  d.putInteger(__s("frame"), frames);
  d.putDouble(__s("frameRate"), rate);
  return d;
};
var __setTime = function (tc) {
  var r = new ActionReference(), d = new ActionDescriptor();
  r.putProperty(__s("property"), __s("time"));
  r.putClass(__s("timeline"));
  d.putReference(__s("target"), r);
  d.putObject(__s("to"), __s("timecode"), tc);
  __event("set", d);
};
var __selectLayers = function (layers) {
  var r = new ActionReference(), d = new ActionDescriptor();
  for (var i = 0; i < layers.length; i++) r.putIdentifier(__s("layer"), layers[i].id);
  d.putReference(__s("target"), r);
  d.putBoolean(__s("makeVisible"), false);
  __event("select", d);
};
var __descValue = function (d, k, depth) {
  var t = d.getType(k);
  if (t === DescValueType.INTEGERTYPE) return d.getInteger(k);
  if (t === DescValueType.DOUBLETYPE) return d.getDouble(k);
  if (t === DescValueType.UNITDOUBLE) return d.getUnitDoubleValue(k);
  if (t === DescValueType.BOOLEANTYPE) return d.getBoolean(k);
  if (t === DescValueType.STRINGTYPE) return d.getString(k);
  if (t === DescValueType.ENUMERATEDTYPE) return app.typeIDToStringID(d.getEnumerationValue(k));
  if (t === DescValueType.OBJECTTYPE && depth < 3) {
    var o = {}, od = d.getObjectValue(k);
    for (var i = 0; i < od.count; i++) {
      var key = od.getKey(i);
      o[app.typeIDToStringID(key) || app.typeIDToCharID(key)] = __descValue(od, key, depth + 1);
    }
    return o;
  }
  return null;
};
var __frameCount = function () {
  try {
    var r = new ActionReference();
    r.putProperty(__s("property"), __s("frameCount"));
    r.putClass(__s("animationClass"));
    return app.executeActionGet(r).getInteger(__s("frameCount"));
  } catch (e) { return null; }
};
`;

const TIME_SCHEMA = (description) => ({
    type: 'object',
    description,
    properties: {
        seconds: { type: 'integer', description: 'Whole seconds' },
        frames: { type: 'integer', description: 'Frames on top of the seconds, at the timeline\'s frame rate' },
    },
});

/** A checked { seconds, frames } time of whole numbers; offsets may be negative. */
function timecode(t, name, { offset = false } = {}) {
    if (!t || typeof t !== 'object') throw new Error(`'${name}' must be { seconds, frames }`);
    const seconds = Number(num(t.seconds ?? 0, { min: offset ? -86400 : 0, max: 86400, name: `${name}.seconds` }));
    const frames = Number(num(t.frames ?? 0, { min: offset ? -10000 : 0, max: 10000, name: `${name}.frames` }));
    if (!Number.isInteger(seconds) || !Number.isInteger(frames)) throw new Error(`'${name}': seconds and frames must be whole numbers`);
    return { seconds, frames };
}

/** A checked time as the seconds and frames arguments of __tc. */
const tcArgs = (t) => `${t.seconds}, ${t.frames}`;

const TIMELINE_STATE = `
var out = { videoTimeline: false, videoLayers: [] };
var props = ["frameRate", "time", "duration", "workInTime", "workOutTime"];
for (var p = 0; p < props.length; p++) {
  try {
    var g = __tlGet(props[p]);
    if (g.hasKey(__s(props[p]))) { out[props[p]] = __descValue(g, __s(props[p]), 0); if (p === 0) out.videoTimeline = true; }
  } catch (e) {}
}
out.frameCount = __frameCount();
__eachLayer(doc, function (l) { if (l.typename === "ArtLayer" && l.kind === LayerKind.VIDEO) out.videoLayers.push({ id: l.id, name: l.name }); });`;

const CREATE = {
    video: { event: 'makeTimeline', features: ['photoshop.video.create_video_timeline'] },
    frames: { event: 'makeFrameAnimation', features: [] },
    convert_to_frames: { menu: 'timelineConvertToFrames', features: ['photoshop.video.convert_to_frame_animation'] },
    convert_to_video: { menu: 'convertAnimation', features: ['photoshop.video.convert_to_video_timeline'] },
};

const GO_TO = {
    first_frame: '__menu("timelineGoToFirstFrame");',
    last_frame: '__menu("timelineGoToLastFrame");',
    next_frame: 'var nd = new ActionDescriptor(); nd.putBoolean(__s("toNextWholeSecond"), false); __event("nextFrame", nd);',
    previous_frame: 'var nd = new ActionDescriptor(); nd.putBoolean(__s("toNextWholeSecond"), false); __event("previousFrame", nd);',
    next_second: 'var nd = new ActionDescriptor(); nd.putBoolean(__s("toNextWholeSecond"), true); __event("nextFrame", nd);',
    previous_second: 'var nd = new ActionDescriptor(); nd.putBoolean(__s("toNextWholeSecond"), true); __event("previousFrame", nd);',
    work_area_start: '__menu("timelineGoToWorkAreaStart");',
    work_area_end: '__menu("timelineGoToWorkAreaEnd");',
};

const ANIMATION_OPTIONS = { automatic: 'animationOptionsAuto', always_show: 'animationOptionsShow', always_hide: 'animationOptionsHide' };

/** Video timeline commands: Timeline panel menu items and Layer > Video Layers. */
export const TIMELINE_COMMANDS = {
    move_start_to_playhead: { menu: 'timelineMoveLayerInPoint', features: ['photoshop.video.move_start_to_playhead'] },
    move_end_to_playhead: { menu: 'timelineMoveLayerEndPoint', features: ['photoshop.video.move_end_to_playhead'] },
    trim_start_at_playhead: { menu: 'timelineTrimLayerStart', features: ['photoshop.video.trim_start_at_playhead'] },
    trim_end_at_playhead: { menu: 'timelineTrimLayerEnd', features: ['photoshop.video.trim_end_at_playhead'] },
    split_at_playhead: { menu: 'timelineSplitLayer', features: ['photoshop.video.split_at_playhead'] },
    set_work_area_start: { menu: 'timelineSetStartOfWorkArea', features: ['photoshop.video.work_area_start'] },
    set_work_area_end: { menu: 'timelineSetEndOfWorkArea', features: ['photoshop.video.work_area_end'] },
    lift_work_area: { menu: 'timelineLiftWorkArea', features: ['photoshop.video.lift_work_area'] },
    extract_work_area: { menu: 'timelineExtractWorkArea', features: ['photoshop.video.extract_work_area'] },
    flatten_frames_into_clips: { menu: 'timelineFlattenFramesIntoLayers', features: ['photoshop.video.flatten_frames_into_clips'] },
    make_frames_from_clips: { menu: 'timelineMakeFramesFromLayers', features: ['photoshop.video.make_frames_from_clips'] },
    keyframes_linear: { menu: 'timelineKeyframeInterpolationLinear', features: ['photoshop.video.keyframe_interpolation_linear'] },
    keyframes_hold: { menu: 'timelineKeyframeInterpolationHold', features: ['photoshop.video.keyframe_interpolation_hold'] },
    select_all_keyframes: { menu: 'timelineSelectAllKeyframes', features: ['photoshop.video.select_all_keyframes'] },
    copy_keyframes: { menu: 'timelineCopyKeyframes', features: ['photoshop.video.copy_keyframes'] },
    paste_keyframes: { menu: 'timelinePasteKeyframes', features: ['photoshop.video.paste_keyframes'] },
    delete_keyframes: { menu: 'timelineDeleteKeyframes', features: ['photoshop.video.delete_keyframes'] },
    toggle_onion_skins: { menu: 'timelineEnableOnionSkins', features: ['photoshop.video.enable_onion_skins'] },
    toggle_shortcut_keys: { menu: 'timelineEnableShortcutKeys', features: ['photoshop.video.timeline_shortcut_keys'] },
    set_favorite_clips: { menu: 'timelineShowSetFavoriteLayers', features: ['photoshop.video.favorite_layers'] },
    show_favorite_clips: { menu: 'timelineShowFavoriteLayers', features: ['photoshop.video.favorite_layers'] },
    show_all_clips: { menu: 'timelineShowAllLayers', features: ['photoshop.video.favorite_layers'] },
    insert_blank_frame: { menu: 'insertBlankFrame', features: ['photoshop.video.insert_blank_frame'] },
    delete_frame: { event: 'deleteFrame', features: ['photoshop.video.delete_frame'] },
    duplicate_frame: { event: 'duplicateFrame', features: ['photoshop.video.duplicate_frame'] },
    reload_frame: { menu: 'reloadFrame', features: ['photoshop.video.reload_frame'] },
    restore_frame: { menu: 'restoreFrame', features: ['photoshop.video.restore_frame'] },
    restore_all_frames: { menu: 'restoreAllFrames', features: ['photoshop.video.restore_all_frames'] },
    toggle_altered_video: { menu: 'showAlteredVideo', features: ['photoshop.video.hide_altered_video'] },
};

/** Frame animation commands: the Timeline panel's menu in frame animation mode. */
export const FRAME_COMMANDS = {
    new_frame: { code: '__onTarget("duplicate", "animationFrameClass");', features: ['photoshop.video.new_frame'] },
    delete_frames: { code: '__onTarget("delete", "animationFrameClass");', features: ['photoshop.video.delete_frames'] },
    delete_animation: { code: '__onTarget("delete", "animationClass");', features: ['photoshop.video.delete_animation'] },
    copy_frames: { code: '__onTarget("copyEvent", "animationFrameClass");', features: ['photoshop.video.copy_frames'] },
    paste_frames: {
        code: 'var pr = new ActionReference(), pd = new ActionDescriptor(); pr.putClass(__s("animationFrameClass")); pd.putReference(__s("target"), pr); __event("animationPasteFrames", pd);',
        features: ['photoshop.video.paste_frames'],
    },
    reverse_frames: { code: '__onTarget("reverse", "animationFrameClass");', features: ['photoshop.video.reverse_frames'] },
    tween: { code: '__onTarget("animationTween", "animationFrameClass");', features: ['photoshop.video.tween'] },
    select_all_frames: { code: '__menu("animationSelectAll");', features: ['photoshop.video.select_all_frames'] },
    select_frame: { code: null, features: ['photoshop.video.activate_frame'] },
    make_frames_from_layers: { code: '__event("animationFramesFromLayers");', features: ['photoshop.video.make_frames_from_layers'] },
    flatten_frames_into_layers: { code: '__event("animationFramesToLayers");', features: ['photoshop.video.flatten_frames_into_layers'] },
    match_layer: { code: null, features: ['photoshop.video.match_layer_across_frames'] },
    toggle_new_layer_each_frame: { code: '__menu("animationNewLayerPerFrame");', features: ['photoshop.video.new_layer_each_frame'] },
    toggle_new_layers_visible: { code: '__menu("animationShowNewLayersInFrames");', features: ['photoshop.video.new_layers_visible_all_frames'] },
};

const TRANSITIONS = { fade: 'opacityDissolveTransition', cross_fade: 'crossDissolveTransition', fade_black: 'blackDissolveTransition', fade_white: 'whiteDissolveTransition' };
const RENDER_FORMATS = { h264: { name: 'H.264', ext: '.mp4', preset: '1_High Quality.epr' }, quicktime: { name: 'QuickTime', ext: '.mov', preset: null } };

const featuresOf = (table) => [...new Set(Object.values(table).flatMap((e) => e.features))];

export const tools = [
    {
        name: 'get_timeline',
        description: 'Describe the document\'s timeline (Timeline panel): frame rate, playhead time, duration and work area when Photoshop reports them, the frame count in frame animation mode, and the video layers',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['photoshop.video.video_layer'],
        handler: () => run('Get timeline', script(`${AM}${TIMELINE_STATE}
__result__ = out;`)),
    },
    {
        name: 'create_timeline',
        description: 'Create a video timeline or a frame animation for the document, or convert between the two (Timeline panel: Create Video Timeline, Create Frame Animation, Convert to Frame Animation, Convert to Video Timeline)',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: Object.keys(CREATE), description: 'video (new video timeline), frames (new frame animation), convert_to_frames or convert_to_video' },
                frameRate: { type: 'number', minimum: 1, maximum: 240, description: 'Frame rate for a new or converted video timeline, in frames per second' },
            },
            required: ['mode'],
        },
        features: featuresOf(CREATE),
        handler: (a) => {
            const mode = enumOf(a.mode, Object.keys(CREATE), { name: 'mode' });
            const entry = CREATE[mode];
            const video = mode === 'video' || mode === 'convert_to_video';
            if (a.frameRate !== undefined && !video) throw new Error('frameRate applies to a video timeline (mode video or convert_to_video)');
            return run('Create timeline', script(`${AM}
${entry.event ? `__event(${str(entry.event)});` : `__menu(${str(entry.menu)});`}
${a.frameRate !== undefined ? `${frameRateLines(a.frameRate)}` : ''}
${TIMELINE_STATE}
__result__ = out;`));
        },
    },
    {
        name: 'set_timeline',
        description: 'Set the timeline: show or hide the Timeline panel, set the frame rate (Set Timeline Frame Rate), move the playhead to a time or Go To a frame or the work area, and choose the Layers panel\'s Animation Options',
        inputSchema: {
            type: 'object',
            properties: {
                panel: { type: 'string', enum: ['show', 'hide'], description: 'Show or hide the Timeline panel (Window > Timeline)' },
                frameRate: { type: 'number', minimum: 1, maximum: 240, description: 'Timeline frame rate in frames per second' },
                time: TIME_SCHEMA('Move the playhead (current-time indicator) to this time'),
                goTo: { type: 'string', enum: Object.keys(GO_TO), description: 'Move the playhead instead: first or last frame, one frame or one second forward or back, or the work area start or end' },
                animationOptions: { type: 'string', enum: Object.keys(ANIMATION_OPTIONS), description: 'Layers panel Animation Options: automatic, always_show or always_hide the unified layer buttons' },
            },
        },
        auditArgs: { goTo: undefined },
        features: ['photoshop.video.timeline_panel', 'photoshop.video.timeline_frame_rate', 'photoshop.video.current_time_indicator', 'photoshop.video.animation_options'],
        handler: (a) => {
            if (a.time !== undefined && a.goTo !== undefined) throw new Error('Give time or goTo, not both');
            if ([a.panel, a.frameRate, a.time, a.goTo, a.animationOptions].every((v) => v === undefined)) {
                throw new Error('Nothing to set: give panel, frameRate, time, goTo or animationOptions');
            }
            const lines = [];
            if (a.panel !== undefined) {
                const verb = enumOf(a.panel, ['show', 'hide'], { name: 'panel' });
                lines.push(`var pr = new ActionReference(), pd = new ActionDescriptor();
pr.putName(__s("classPanel"), "panelid.static.animation");
pd.putReference(__s("target"), pr);
__event(${str(verb)}, pd);`);
            }
            if (a.frameRate !== undefined) lines.push(frameRateLines(a.frameRate));
            if (a.time !== undefined) lines.push(`__setTime(__tc(${tcArgs(timecode(a.time, 'time'))}, __rate()));`);
            if (a.goTo !== undefined) lines.push(GO_TO[enumOf(a.goTo, Object.keys(GO_TO), { name: 'goTo' })]);
            if (a.animationOptions !== undefined) lines.push(`__menu(${str(ANIMATION_OPTIONS[enumOf(a.animationOptions, Object.keys(ANIMATION_OPTIONS), { name: 'animationOptions' })])});`);
            return run('Set timeline', script(`${AM}
${lines.join('\n')}
${TIMELINE_STATE}
__result__ = out;`));
        },
    },
    {
        name: 'run_timeline_command',
        description: 'Run a video timeline command on the selected clips, keyframes or video layer at the playhead (Timeline panel menu: Move & Trim, Split at Playhead, Work Area, Keyframes, Convert Frames, Enable Onion Skins, Show; Layer > Video Layers: Insert, Delete, Duplicate, Reload or Restore Frame, Hide Altered Video). Toggles switch the setting each time',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(TIMELINE_COMMANDS), description: 'The command to run' },
                target: { ...TARGET_SCHEMA, description: 'Clips (layers) to select first. Default: the current selection' },
            },
            required: ['command'],
        },
        hints: { destructive: true },
        features: featuresOf(TIMELINE_COMMANDS),
        handler: (a) => {
            const entry = TIMELINE_COMMANDS[enumOf(a.command, Object.keys(TIMELINE_COMMANDS), { name: 'command' })];
            return run('Run timeline command', script(`${AM}
${a.target !== undefined ? `__selectLayers(__targets(doc, ${targetSpec(a.target)}));` : ''}
${entry.event ? `__event(${str(entry.event)});` : `__menu(${str(entry.menu)});`}
${TIMELINE_STATE}
__result__ = out;`));
        },
    },
    {
        name: 'edit_frame_animation',
        description: 'Edit a frame animation (Timeline panel in frame mode): new, delete, copy, paste, reverse or tween frames, select a frame, make frames from layers, flatten frames into layers, match a layer across frames, delete the animation, and the New Layers options. Tween and Paste Frames use the dialog\'s last settings',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(FRAME_COMMANDS), description: 'The command to run on the selected frames' },
                frame: { type: 'integer', minimum: 1, description: 'For select_frame: the frame number, 1 for the first' },
                matchPosition: { type: 'boolean', description: 'For match_layer: match the active layer\'s position. Default true' },
                matchVisibility: { type: 'boolean', description: 'For match_layer: match its visibility. Default true' },
                matchStyle: { type: 'boolean', description: 'For match_layer: match its layer style. Default true' },
            },
            required: ['command'],
        },
        hints: { destructive: true },
        auditArgs: { command: 'select_frame', frame: 2, matchPosition: undefined, matchVisibility: undefined, matchStyle: undefined },
        features: featuresOf(FRAME_COMMANDS),
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(FRAME_COMMANDS), { name: 'command' });
            let code = FRAME_COMMANDS[command].code;
            if (command === 'select_frame') {
                if (a.frame === undefined) throw new Error('select_frame needs frame (1 for the first)');
                const n = Number(index(a.frame, { name: 'frame', max: 100000 }));
                if (n < 1) throw new Error('frame starts at 1');
                code = `var fr = new ActionReference(), fd = new ActionDescriptor();
fr.putIndex(__s("animationFrameClass"), ${n});
fd.putReference(__s("target"), fr);
__event("animationFrameActivate", fd);`;
            } else if (a.frame !== undefined) {
                throw new Error('frame applies to select_frame');
            }
            if (command === 'match_layer') {
                code = `var md = new ActionDescriptor();
md.putBoolean(__s("animationMatchLayerPosition"), ${bool(a.matchPosition ?? true)});
md.putBoolean(__s("animationMatchLayerVisibility"), ${bool(a.matchVisibility ?? true)});
md.putBoolean(__s("animationMatchLayerStyle"), ${bool(a.matchStyle ?? true)});
__event("animationMatchLayer", md);`;
            } else if ([a.matchPosition, a.matchVisibility, a.matchStyle].some((v) => v !== undefined)) {
                throw new Error('matchPosition, matchVisibility and matchStyle apply to match_layer');
            }
            return run('Edit frame animation', script(`${AM}
${code}
__result__ = { command: ${str(command)}, frameCount: __frameCount() };`));
        },
    },
    {
        name: 'add_video_layer',
        description: 'Add a blank video layer above the active layer, for frame-by-frame painting (Layer > Video Layers > New Blank Video Layer)',
        inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Name for the new layer' } } },
        features: ['photoshop.video.blank_video_layer', 'photoshop.video.video_layer'],
        handler: (a) => run('Add video layer', script(`${AM}
__event("addBlankVideoLayer");
${a.name !== undefined ? `doc.activeLayer.name = ${str(a.name)};` : ''}
__result__ = __layerInfo(doc.activeLayer);`)),
    },
    {
        name: 'import_video_frames',
        description: 'Import a video file\'s frames as layers of a new document, optionally as a frame animation (File > Import > Video Frames to Layers)',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Absolute path of the video file' },
                startTime: TIME_SCHEMA('Import from this time. Default the start'),
                endTime: TIME_SCHEMA('Import up to this time. Default the end'),
                frameRate: { type: 'number', minimum: 1, maximum: 240, description: 'The video\'s frame rate, which the frames in startTime and endTime count in. Default 30' },
                frameSkip: { type: 'integer', minimum: 1, maximum: 1000, description: 'Keep every Nth frame (Limit To Every N Frames)' },
                makeAnimation: { type: 'boolean', description: 'Make a frame animation from the layers. Default false' },
            },
            required: ['file'],
        },
        auditArgs: { endTime: { seconds: 20, frames: 0 } },
        features: ['photoshop.video.video_frames_to_layers'],
        handler: (a) => {
            const file = paths.validate(a.file);
            const start = a.startTime !== undefined ? timecode(a.startTime, 'startTime') : null;
            const end = a.endTime !== undefined ? timecode(a.endTime, 'endTime') : null;
            const rate = num(a.frameRate ?? 30, { min: 1, max: 240, name: 'frameRate' });
            if (a.frameSkip !== undefined && Number(index(a.frameSkip, { name: 'frameSkip', max: 1000 })) < 1) throw new Error('frameSkip starts at 1');
            if (start && end && end.seconds * 100000 + end.frames <= start.seconds * 100000 + start.frames) throw new Error('endTime must come after startTime');
            const tc = (key, t) => `var ${key} = new ActionDescriptor();
${key}.putInteger(__s("minutes"), ${Math.floor(t.seconds / 60)});
${key}.putInteger(__s("seconds"), ${t.seconds % 60});
${key}.putInteger(__s("frame"), ${t.frames});
${key}.putDouble(__s("frameRate"), ${rate});
d.putObject(__s(${str(key)}), __s("timecode"), ${key});`;
            return run('Import video frames', script(`${AM}
var f = new File(${jsxPath(file)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var d = new ActionDescriptor();
d.putPath(__s("using"), f);
${start ? tc('startTime', start) : ''}
${end ? tc('endTime', end) : ''}
${a.makeAnimation ? 'd.putBoolean(__s("makeAnimation"), true);' : ''}
${a.frameSkip !== undefined ? `d.putInteger(__s("frameSkip"), ${index(a.frameSkip, { name: 'frameSkip', max: 1000 })});` : ''}
__event("importVideoToLayers", d);
__result__ = __docInfo(app.activeDocument);`, { needsDocument: false }));
        },
    },
    {
        name: 'set_clip_timing',
        description: 'Move the in or out point of clips (layer duration bars) in the video timeline, or set their duration',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                moveIn: TIME_SCHEMA('Move each clip\'s in point by this offset (negative is earlier)'),
                moveOut: TIME_SCHEMA('Move each clip\'s out point by this offset (negative is earlier)'),
                duration: TIME_SCHEMA('Set each clip\'s duration instead, measured from its in point'),
            },
            required: ['target'],
        },
        auditArgs: { moveOut: undefined },
        features: ['photoshop.video.layer_in_out_points', 'photoshop.video.clip_duration_speed'],
        handler: (a) => {
            if (a.moveIn === undefined && a.moveOut === undefined && a.duration === undefined) throw new Error('Give moveIn, moveOut or duration');
            if (a.moveOut !== undefined && a.duration !== undefined) throw new Error('Give moveOut or duration, not both');
            const moveIn = a.moveIn !== undefined ? timecode(a.moveIn, 'moveIn', { offset: true }) : null;
            const moveOut = a.moveOut !== undefined ? timecode(a.moveOut, 'moveOut', { offset: true }) : null;
            let duration = null;
            if (a.duration !== undefined) {
                duration = timecode(a.duration, 'duration');
                if (!duration.seconds && !duration.frames) throw new Error('duration must be at least one frame');
            }
            const offset = (event, t) => `var od = new ActionDescriptor(); od.putObject(__s("timeOffset"), __s("timecode"), __tc(${tcArgs(t)}, rate)); __event(${str(event)}, od);`;
            return run('Set clip timing', script(`${AM}
var rate = __rate(), layers = __targets(doc, ${targetSpec(a.target)}), done = [];
${duration ? 'var playhead = __tlGet("time").getObjectValue(__s("time")); __setTime(__tc(0, 0, rate));' : ''}
try {
  for (var i = 0; i < layers.length; i++) {
    __selectLayers([layers[i]]);
    ${moveIn ? offset('moveInTime', moveIn) : ''}
    ${moveOut ? offset('moveOutTime', moveOut) : ''}
    ${duration ? `var rd = new ActionDescriptor(); rd.putObject(__s("resetTime"), __s("timecode"), new ActionDescriptor()); __event("moveOutTime", rd);
    ${offset('moveOutTime', { seconds: duration.seconds, frames: duration.frames - 1 })}` : ''}
    done.push({ id: layers[i].id, name: layers[i].name });
  }
} finally {
  ${duration ? '__setTime(playhead);' : ''}
}
__result__ = { layers: done };`));
        },
    },
    {
        name: 'add_video_transition',
        description: 'Add a transition (Fade, Cross Fade, Fade With Black or Fade With White) where two adjacent clips meet in the video timeline (Timeline panel transitions)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The two adjacent clips (layers) to join' },
                type: { type: 'string', enum: Object.keys(TRANSITIONS), description: 'fade, cross_fade, fade_black or fade_white. Default cross_fade' },
                duration: TIME_SCHEMA('Transition length. Default 1 second'),
            },
            required: ['target'],
        },
        auditArgs: { target: { ids: [7, 8] } },
        features: ['photoshop.video.video_transitions'],
        handler: (a) => {
            const type = TRANSITIONS[enumOf(a.type ?? 'cross_fade', Object.keys(TRANSITIONS), { name: 'type' })];
            const duration = timecode(a.duration ?? { seconds: 1 }, 'duration');
            if (!duration.seconds && !duration.frames) throw new Error('duration must be at least one frame');
            return run('Add video transition', script(`${AM}
var layers = __targets(doc, ${targetSpec(a.target)});
if (layers.length !== 2) throw new Error("Choose exactly two adjacent clips");
__selectLayers(layers);
var d = new ActionDescriptor();
d.putObject(__s("using"), __s(${str(type)}), new ActionDescriptor());
d.putObject(__s("duration"), __s("timecode"), __tc(${tcArgs(duration)}, __rate()));
d.putEnumerated(__s("placement"), __s("transitionPlacement"), __s("join"));
__event("addTimelineTransition", d);
__result__ = { transition: ${str(a.type ?? 'cross_fade')}, layers: [layers[0].id, layers[1].id] };`));
        },
    },
    {
        name: 'render_video',
        description: 'Render the timeline to a video file through Adobe Media Encoder (File > Export > Render Video), at the document size',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder to render into' },
                name: { type: 'string', description: 'File name, ending in .mp4 for h264 or .mov for quicktime' },
                format: { type: 'string', enum: Object.keys(RENDER_FORMATS), description: 'h264 (MP4) or quicktime (MOV). Default h264' },
                preset: { type: 'string', description: 'Media Encoder preset file name, as listed in the Render Video dialog. Default "1_High Quality.epr" for h264; required for quicktime' },
                frameRate: { type: 'number', minimum: 1, maximum: 240, description: 'Output frame rate. Default the timeline\'s' },
            },
            required: ['outputFolder', 'name'],
        },
        hints: { idempotent: true },
        auditArgs: { name: 'audit.mp4' },
        features: ['photoshop.video.render_video'],
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            const format = RENDER_FORMATS[enumOf(a.format ?? 'h264', Object.keys(RENDER_FORMATS), { name: 'format' })];
            const name = String(a.name ?? '');
            if (!name || /[\\/:*?"<>|]/.test(name)) throw new Error('name must be a plain file name, without folders');
            if (path.extname(name).toLowerCase() !== format.ext) throw new Error(`name must end in ${format.ext} for this format`);
            const preset = a.preset ?? format.preset;
            if (!preset) throw new Error('quicktime needs a preset');
            return run('Render video', script(`${AM}
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
var v = new ActionDescriptor(), d = new ActionDescriptor();
v.putPath(__s("directory"), folder);
v.putString(__s("name"), ${str(name)});
v.putString(__s("ameFormatName"), ${str(format.name)});
v.putString(__s("amePresetName"), ${str(preset)});
v.putBoolean(__s("useDocumentSize"), true);
v.putDouble(__s("frameRate"), ${a.frameRate !== undefined ? num(a.frameRate, { min: 1, max: 240, name: 'frameRate' }) : '__rate()'});
v.putEnumerated(__s("pixelAspectRatio"), __s("pixelAspectRatio"), __s("document"));
v.putEnumerated(__s("fieldOrder"), __s("videoField"), __s("preset"));
v.putBoolean(__s("manage"), true);
v.putBoolean(__s("selectedFrames"), true);
v.putEnumerated(__s("renderAlpha"), __s("alphaRendering"), __s("none"));
v.putInteger(__s("quality"), 1);
v.putInteger(__s("Z3DPrefHighQualityErrorThreshold"), 5);
d.putObject(__s("using"), __s("videoExport"), v);
__event("export", d);
__result__ = { rendered: folder.fsName + "/" + ${str(name)} };`));
        },
    },
];

/** Statements that set the timeline frame rate (documentTimelineSettings). */
function frameRateLines(rate) {
    return `var rr = new ActionReference(), rd = new ActionDescriptor();
rr.putProperty(__s("property"), __s("documentTimelineSettings"));
rr.putClass(__s("timeline"));
rd.putReference(__s("target"), rr);
rd.putDouble(__s("frameRate"), ${num(rate, { min: 1, max: 240, name: 'frameRate' })});
__event("set", rd);`;
}
