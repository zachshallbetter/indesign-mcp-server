/**
 * Video and animation tools: generated Action Manager scripts and argument checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';
import { TIMELINE_COMMANDS, FRAME_COMMANDS } from '../src/tools/video.js';

const docs = path.join(home, 'Documents');

async function refused(name, args, pattern) {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall(name, args), pattern);
}

test('get_timeline reads the timeline class, frame count and video layers', async () => {
    const [s] = await scriptsFor([['get_timeline', {}]]);
    assert.match(s, /r\.putClass\(__s\("timeline"\)\);/);
    assert.match(s, /"frameRate", "time", "duration", "workInTime", "workOutTime"/);
    assert.match(s, /r\.putProperty\(__s\("property"\), __s\("frameCount"\)\);\n\s*r\.putClass\(__s\("animationClass"\)\);/);
    assert.match(s, /l\.kind === LayerKind\.VIDEO/);
});

test('create_timeline creates or converts with the cited events and menu items', async () => {
    const [video, frames, toFrames, toVideo] = await scriptsFor([
        ['create_timeline', { mode: 'video', frameRate: 24 }],
        ['create_timeline', { mode: 'frames' }],
        ['create_timeline', { mode: 'convert_to_frames' }],
        ['create_timeline', { mode: 'convert_to_video' }],
    ]);
    assert.match(video, /__event\("makeTimeline"\);/);
    assert.match(video, /rr\.putProperty\(__s\("property"\), __s\("documentTimelineSettings"\)\);[\s\S]*rd\.putDouble\(__s\("frameRate"\), 24\);\n__event\("set", rd\);/);
    assert.match(frames, /__event\("makeFrameAnimation"\);/);
    assert.match(toFrames, /__menu\("timelineConvertToFrames"\);/);
    assert.match(toVideo, /__menu\("convertAnimation"\);/);
    assert.match(video, /app\.runMenuItem\(app\.stringIDToTypeID\(id\)\)/);
    await refused('create_timeline', { mode: 'frames', frameRate: 12 }, /frameRate applies to a video timeline/);
    await refused('create_timeline', { mode: 'gif' }, /Allowed: video, frames/);
});

test('set_timeline shows the panel, sets the frame rate and moves the playhead', async () => {
    const [panel, time, next, opts] = await scriptsFor([
        ['set_timeline', { panel: 'show', frameRate: 29.97 }],
        ['set_timeline', { time: { seconds: 2, frames: 5 } }],
        ['set_timeline', { goTo: 'next_second' }],
        ['set_timeline', { goTo: 'work_area_end', animationOptions: 'always_hide' }],
    ]);
    assert.match(panel, /pr\.putName\(__s\("classPanel"\), "panelid\.static\.animation"\);[\s\S]*__event\("show", pd\);/);
    assert.match(panel, /rd\.putDouble\(__s\("frameRate"\), 29\.97\);/);
    assert.match(time, /__setTime\(__tc\(2, 5, __rate\(\)\)\);/);
    assert.match(time, /r\.putProperty\(__s\("property"\), __s\("time"\)\);[\s\S]*d\.putObject\(__s\("to"\), __s\("timecode"\), tc\);/);
    assert.match(next, /nd\.putBoolean\(__s\("toNextWholeSecond"\), true\); __event\("nextFrame", nd\);/);
    assert.match(opts, /__menu\("timelineGoToWorkAreaEnd"\);/);
    assert.match(opts, /__menu\("animationOptionsHide"\);/);
    await refused('set_timeline', {}, /Nothing to set/);
    await refused('set_timeline', { time: { seconds: 1 }, goTo: 'first_frame' }, /time or goTo/);
    await refused('set_timeline', { time: { seconds: -1 } }, /out of range/);
    await refused('set_timeline', { time: { seconds: 1.5 } }, /whole numbers/);
    await refused('set_timeline', { frameRate: 0 }, /out of range/);
});

test('run_timeline_command runs each command, selecting clips first when asked', async () => {
    const calls = Object.keys(TIMELINE_COMMANDS).map((command) => ['run_timeline_command', { command }]);
    const scripts = await scriptsFor([...calls, ['run_timeline_command', { command: 'split_at_playhead', target: { ids: [4, 5] } }]]);
    Object.values(TIMELINE_COMMANDS).forEach((entry, i) => {
        assert.ok(scripts[i].includes(entry.event ? `__event("${entry.event}");` : `__menu("${entry.menu}");`), entry.menu ?? entry.event);
    });
    const split = scripts.at(-1);
    assert.match(split, /__selectLayers\(__targets\(doc, \{"ids":\[4,5\]\}\)\);/);
    assert.match(split, /r\.putIdentifier\(__s\("layer"\), layers\[i\]\.id\);/);
    await refused('run_timeline_command', { command: 'render' }, /Allowed:/);
    await refused('run_timeline_command', { command: 'split_at_playhead', target: {} }, /Choose the layers/);
});

test('edit_frame_animation targets animation frames by ordinal and index', async () => {
    const commands = Object.keys(FRAME_COMMANDS).filter((c) => c !== 'select_frame');
    const scripts = await scriptsFor([
        ...commands.map((command) => ['edit_frame_animation', { command }]),
        ['edit_frame_animation', { command: 'select_frame', frame: 3 }],
        ['edit_frame_animation', { command: 'match_layer', matchStyle: false }],
    ]);
    const by = Object.fromEntries(commands.map((c, i) => [c, scripts[i]]));
    assert.match(by.new_frame, /__onTarget\("duplicate", "animationFrameClass"\);/);
    assert.match(by.new_frame, /r\.putEnumerated\(__s\(cls\), __s\("ordinal"\), __s\("targetEnum"\)\);/);
    assert.match(by.delete_frames, /__onTarget\("delete", "animationFrameClass"\);/);
    assert.match(by.delete_animation, /__onTarget\("delete", "animationClass"\);/);
    assert.match(by.copy_frames, /__onTarget\("copyEvent", "animationFrameClass"\);/);
    assert.match(by.paste_frames, /pr\.putClass\(__s\("animationFrameClass"\)\);[\s\S]*__event\("animationPasteFrames", pd\);/);
    assert.match(by.reverse_frames, /__onTarget\("reverse", "animationFrameClass"\);/);
    assert.match(by.tween, /__onTarget\("animationTween", "animationFrameClass"\);/);
    assert.match(by.select_all_frames, /__menu\("animationSelectAll"\);/);
    assert.match(by.make_frames_from_layers, /__event\("animationFramesFromLayers"\);/);
    assert.match(by.flatten_frames_into_layers, /__event\("animationFramesToLayers"\);/);
    assert.match(by.toggle_new_layer_each_frame, /__menu\("animationNewLayerPerFrame"\);/);
    assert.match(by.toggle_new_layers_visible, /__menu\("animationShowNewLayersInFrames"\);/);
    const [select, match] = scripts.slice(-2);
    assert.match(select, /fr\.putIndex\(__s\("animationFrameClass"\), 3\);[\s\S]*__event\("animationFrameActivate", fd\);/);
    assert.match(match, /md\.putBoolean\(__s\("animationMatchLayerPosition"\), true\);/);
    assert.match(match, /md\.putBoolean\(__s\("animationMatchLayerStyle"\), false\);/);
    await refused('edit_frame_animation', { command: 'select_frame' }, /needs frame/);
    await refused('edit_frame_animation', { command: 'select_frame', frame: 0 }, /starts at 1/);
    await refused('edit_frame_animation', { command: 'new_frame', frame: 2 }, /applies to select_frame/);
    await refused('edit_frame_animation', { command: 'tween', matchStyle: true }, /apply to match_layer/);
});

test('add_video_layer adds a blank video layer and names it', async () => {
    const [s] = await scriptsFor([['add_video_layer', { name: 'Paint "1"' }]]);
    assert.match(s, /__event\("addBlankVideoLayer"\);/);
    assert.match(s, /doc\.activeLayer\.name = "Paint \\"1\\"";/);
});

test('import_video_frames builds the importVideoToLayers descriptor', async () => {
    const file = path.join(docs, 'clip.mov');
    const [s] = await scriptsFor([['import_video_frames', { file, startTime: { seconds: 75, frames: 3 }, endTime: { seconds: 80 }, frameRate: 25, frameSkip: 2, makeAnimation: true }]]);
    assert.match(s, /d\.putPath\(__s\("using"\), f\);/);
    assert.match(s, /startTime\.putInteger\(__s\("minutes"\), 1\);\nstartTime\.putInteger\(__s\("seconds"\), 15\);\nstartTime\.putInteger\(__s\("frame"\), 3\);\nstartTime\.putDouble\(__s\("frameRate"\), 25\);/);
    assert.match(s, /d\.putObject\(__s\("endTime"\), __s\("timecode"\), endTime\);/);
    assert.match(s, /d\.putBoolean\(__s\("makeAnimation"\), true\);/);
    assert.match(s, /d\.putInteger\(__s\("frameSkip"\), 2\);/);
    assert.match(s, /__event\("importVideoToLayers", d\);/);
    assert.doesNotMatch(s, /var doc = __doc\(\);/);
    await refused('import_video_frames', { file: '/etc/passwd' }, /outside|allowed|not allowed/i);
    await refused('import_video_frames', { file, startTime: { seconds: 5 }, endTime: { seconds: 4 } }, /endTime must come after startTime/);
    await refused('import_video_frames', { file, frameSkip: 0 }, /frameSkip starts at 1/);
});

test('set_clip_timing moves in and out points and sets durations', async () => {
    const [moves, duration] = await scriptsFor([
        ['set_clip_timing', { target: { ids: [3] }, moveIn: { seconds: -1 }, moveOut: { frames: 12 } }],
        ['set_clip_timing', { target: { active: true }, duration: { seconds: 3 } }],
    ]);
    assert.match(moves, /od\.putObject\(__s\("timeOffset"\), __s\("timecode"\), __tc\(-1, 0, rate\)\); __event\("moveInTime", od\);/);
    assert.match(moves, /__tc\(0, 12, rate\)\); __event\("moveOutTime", od\);/);
    assert.match(duration, /rd\.putObject\(__s\("resetTime"\), __s\("timecode"\), new ActionDescriptor\(\)\); __event\("moveOutTime", rd\);/);
    assert.match(duration, /__tc\(3, -1, rate\)\); __event\("moveOutTime", od\);/);
    assert.match(duration, /var playhead = __tlGet\("time"\)[\s\S]*\} finally \{\n\s*__setTime\(playhead\);/);
    await refused('set_clip_timing', { target: { active: true } }, /Give moveIn, moveOut or duration/);
    await refused('set_clip_timing', { target: { active: true }, moveOut: { seconds: 1 }, duration: { seconds: 2 } }, /not both/);
    await refused('set_clip_timing', { target: { active: true }, duration: { seconds: 0 } }, /at least one frame/);
    await refused('set_clip_timing', { target: { active: true }, duration: { seconds: -2 } }, /out of range/);
});

test('add_video_transition joins two clips with the chosen transition', async () => {
    const [s] = await scriptsFor([['add_video_transition', { target: { ids: [5, 6] }, type: 'fade_black', duration: { seconds: 0, frames: 12 } }]]);
    assert.match(s, /if \(layers\.length !== 2\) throw new Error/);
    assert.match(s, /d\.putObject\(__s\("using"\), __s\("blackDissolveTransition"\), new ActionDescriptor\(\)\);/);
    assert.match(s, /d\.putObject\(__s\("duration"\), __s\("timecode"\), __tc\(0, 12, __rate\(\)\)\);/);
    assert.match(s, /d\.putEnumerated\(__s\("placement"\), __s\("transitionPlacement"\), __s\("join"\)\);/);
    assert.match(s, /__event\("addTimelineTransition", d\);/);
    await refused('add_video_transition', { target: { ids: [5, 6] }, type: 'wipe' }, /Allowed: fade/);
    await refused('add_video_transition', { target: { ids: [5, 6] }, duration: { frames: 0 } }, /at least one frame/);
});

test('render_video exports through videoExport into an allowed folder', async () => {
    const [h264, mov] = await scriptsFor([
        ['render_video', { outputFolder: docs, name: 'anim.mp4' }],
        ['render_video', { outputFolder: docs, name: 'anim.mov', format: 'quicktime', preset: 'High Quality.epr', frameRate: 12 }],
    ]);
    assert.match(h264, /v\.putPath\(__s\("directory"\), folder\);/);
    assert.match(h264, /v\.putString\(__s\("ameFormatName"\), "H\.264"\);/);
    assert.match(h264, /v\.putString\(__s\("amePresetName"\), "1_High Quality\.epr"\);/);
    assert.match(h264, /v\.putDouble\(__s\("frameRate"\), __rate\(\)\);/);
    assert.match(h264, /d\.putObject\(__s\("using"\), __s\("videoExport"\), v\);\n__event\("export", d\);/);
    assert.match(mov, /"QuickTime"/);
    assert.match(mov, /v\.putDouble\(__s\("frameRate"\), 12\);/);
    await refused('render_video', { outputFolder: docs, name: 'anim.mov' }, /must end in \.mp4/);
    await refused('render_video', { outputFolder: docs, name: 'sub/anim.mp4' }, /plain file name/);
    await refused('render_video', { outputFolder: docs, name: 'anim.mov', format: 'quicktime' }, /needs a preset/);
    await refused('render_video', { outputFolder: '/etc', name: 'anim.mp4' }, /outside|allowed|not allowed/i);
});
