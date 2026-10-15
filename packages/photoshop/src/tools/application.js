/**
 * The application: information, preferences, purge, application commands,
 * menu items, persistent script options and quitting.
 *
 * Preferences are Application.preferences in the object model; the interface
 * colour theme, which has no object-model member, is set on the interfacePrefs
 * class through the Action Manager. Ruler units, type units and the dialog
 * mode are saved by the prelude and restored after every script, so this module
 * changes the prelude's saved values (__prevRuler, __prevType, __prevDialogs)
 * to make a new setting stick.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { paths } from './documents.js';

const P = 'photoshop.application.';
const SAVE_BEHAVIOR = { always: 'SaveBehavior.ALWAYSSAVE', never: 'SaveBehavior.NEVERSAVE', ask: 'SaveBehavior.ASKWHENSAVING' };
const QUERY = { always: 'QueryStateType.ALWAYS', never: 'QueryStateType.NEVER', ask: 'QueryStateType.ASK' };

/** Interface colour themes: the kuiBrightnessLevel values of interfacePrefs. */
const THEMES = { darkest: 'kPanelBrightnessDarkGray', dark: 'kPanelBrightnessMediumGray', light: 'kPanelBrightnessLightGray', lightest: 'kPanelBrightnessOriginal' };

/**
 * Each preference: the Preferences property it sets, its kind, the
 * Preferences pane it belongs to, and the atlas features it performs.
 * kind: bool, enum (map of choices to object-model values), number, folder,
 * or one of the special settings the prelude restores (ruler, type, dialogs)
 * or the Action Manager theme.
 */
export const PREFERENCES = {
    // General
    colorPicker: { prop: 'colorPicker', kind: 'enum', map: { adobe: 'ColorPicker.ADOBE', apple: 'ColorPicker.APPLE', windows: 'ColorPicker.WINDOWS', plugin: 'ColorPicker.PLUGIN' }, pane: 'general', features: ['pref_color_picker'], description: 'Color Picker' },
    interpolation: { prop: 'interpolation', kind: 'enum', map: { automatic: 'ResampleMethod.AUTOMATIC', preserve_details: 'ResampleMethod.PRESERVEDETAILS', bicubic_automatic: 'ResampleMethod.BICUBICAUTOMATIC', bicubic_smoother: 'ResampleMethod.BICUBICSMOOTHER', bicubic_sharper: 'ResampleMethod.BICUBICSHARPER', bicubic: 'ResampleMethod.BICUBIC', bilinear: 'ResampleMethod.BILINEAR', nearest_neighbor: 'ResampleMethod.NEARESTNEIGHBOR' }, pane: 'general', features: ['pref_image_interpolation'], description: 'Image Interpolation used when resampling' },
    exportClipboard: { prop: 'exportClipboard', kind: 'bool', pane: 'general', features: ['pref_export_clipboard'], description: 'Export Clipboard to other applications' },
    beepWhenDone: { prop: 'beepWhenDone', kind: 'bool', pane: 'general', features: ['pref_beep_when_done'], description: 'Beep When Done' },
    dynamicColorSliders: { prop: 'dynamicColorSliders', kind: 'bool', pane: 'general', features: ['pref_dynamic_color_sliders'], description: 'Dynamic Color Sliders' },
    savePaletteLocations: { prop: 'savePaletteLocations', kind: 'bool', pane: 'general', features: ['pref_save_palette_locations'], description: 'Remember panel locations' },
    useShiftKeyForToolSwitch: { prop: 'useShiftKeyForToolSwitch', kind: 'bool', pane: 'general', features: ['pref_use_shift_key_for_tool_switch', 'ui.cycle_grouped_tools'], description: 'Use Shift Key for Tool Switch (whether a tool shortcut needs Shift to cycle through grouped tools)' },
    zoomResizesWindows: { prop: 'keyboardZoomResizesWindows', kind: 'bool', pane: 'general', features: ['pref_zoom_resizes_windows'], description: 'Zoom Resizes Windows' },
    autoUpdateOpenDocuments: { prop: 'autoUpdateOpenDocuments', kind: 'bool', pane: 'general', features: ['pref_auto_update_open_documents'], description: 'Auto-update open documents changed on disk' },
    // Interface
    colorTheme: { kind: 'theme', map: THEMES, pane: 'interface', features: [], description: 'Interface colour theme, darkest to lightest' },
    uiFontSize: { prop: 'textFontSize', kind: 'enum', map: { small: 'FontSize.SMALL', medium: 'FontSize.MEDIUM', large: 'FontSize.LARGE' }, pane: 'interface', features: ['pref_ui_font_size'], description: 'UI Font Size (takes effect after a restart)' },
    showToolTips: { prop: 'showToolTips', kind: 'bool', pane: 'interface', features: ['pref_show_tool_tips'], description: 'Show Tool Tips' },
    showChannelsInColor: { prop: 'colorChannelsInColor', kind: 'bool', pane: 'interface', features: ['pref_show_channels_in_color'], description: 'Show Channels in Color' },
    // File Handling
    imagePreviews: { prop: 'imagePreviews', kind: 'enum', map: SAVE_BEHAVIOR, pane: 'file_handling', features: ['pref_image_previews'], description: 'Image Previews: always save, never save or ask when saving' },
    appendExtension: { prop: 'appendExtension', kind: 'enum', map: SAVE_BEHAVIOR, pane: 'file_handling', features: ['pref_append_file_extension'], description: 'Append File Extension: always, never or ask' },
    lowerCaseExtension: { prop: 'useLowerCaseExtension', kind: 'bool', pane: 'file_handling', features: ['pref_append_file_extension'], description: 'Use lower case file extensions' },
    maximizeCompatibility: { prop: 'maximizeCompatibility', kind: 'enum', map: QUERY, pane: 'file_handling', features: ['pref_maximize_psd_compatibility'], description: 'Maximize PSD and PSB File Compatibility: always, never or ask' },
    askBeforeSavingLayeredTIFF: { prop: 'askBeforeSavingLayeredTIFF', kind: 'bool', pane: 'file_handling', features: ['pref_ask_before_saving_layered_tiff'], description: 'Ask before saving layered TIFF files' },
    recentFileListLength: { prop: 'recentFileListLength', kind: 'number', min: 0, max: 100, integer: true, pane: 'file_handling', features: ['pref_recent_file_list_length'], description: 'Recent File List Contains, 0-100 files' },
    // Performance
    maxRAMuse: { prop: 'maxRAMuse', kind: 'number', min: 1, max: 100, pane: 'performance', features: ['pref_memory_usage'], description: 'Memory Usage: percentage of available RAM Photoshop may use' },
    cacheLevels: { prop: 'imageCacheLevels', kind: 'number', min: 1, max: 8, integer: true, pane: 'performance', features: ['pref_cache_levels'], description: 'Cache Levels, 1-8' },
    cacheForHistograms: { prop: 'imageCacheForHistograms', kind: 'bool', pane: 'performance', features: ['pref_cache_levels'], description: 'Use the image cache for histograms' },
    historyStates: { prop: 'numberOfHistoryStates', kind: 'number', min: 1, max: 1000, integer: true, pane: 'performance', features: ['history_states_pref'], description: 'History States kept per document' },
    // Cursors
    paintingCursors: { prop: 'paintingCursors', kind: 'enum', map: { standard: 'PaintingCursors.STANDARD', precise: 'PaintingCursors.PRECISE', brush_size: 'PaintingCursors.BRUSHSIZE' }, pane: 'cursors', features: [], description: 'Painting Cursors' },
    otherCursors: { prop: 'otherCursors', kind: 'enum', map: { standard: 'OtherPaintingCursors.STANDARDOTHER', precise: 'OtherPaintingCursors.PRECISEOTHER' }, pane: 'cursors', features: ['pref_other_cursors'], description: 'Other Cursors' },
    // Transparency & Gamut
    transparencyGridSize: { prop: 'gridSize', kind: 'enum', map: { none: 'GridSize.NONE', small: 'GridSize.SMALL', medium: 'GridSize.MEDIUM', large: 'GridSize.LARGE' }, pane: 'transparency_gamut', features: ['pref_transparency_grid_size'], description: 'Transparency checkerboard Grid Size' },
    gamutWarningOpacity: { prop: 'gamutWarningOpacity', kind: 'number', min: 0, max: 100, pane: 'transparency_gamut', features: [], description: 'Gamut Warning opacity, percent' },
    // Units & Rulers
    rulerUnits: { kind: 'ruler', map: { pixels: 'Units.PIXELS', inches: 'Units.INCHES', cm: 'Units.CM', mm: 'Units.MM', points: 'Units.POINTS', picas: 'Units.PICAS', percent: 'Units.PERCENT' }, pane: 'units_rulers', features: ['pref_ruler_units', 'ui.ruler_units_menu'], description: 'Rulers units (this server still measures in pixels)' },
    typeUnits: { kind: 'type', map: { pixels: 'TypeUnits.PIXELS', points: 'TypeUnits.POINTS', mm: 'TypeUnits.MM' }, pane: 'units_rulers', features: ['pref_type_units'], description: 'Type units (this server still measures in pixels)' },
    columnWidth: { prop: 'columnWidth', kind: 'number', min: 0, max: 10000, pane: 'units_rulers', features: ['pref_column_size'], description: 'Column Size width, in points' },
    columnGutter: { prop: 'columnGutter', kind: 'number', min: 0, max: 10000, pane: 'units_rulers', features: ['pref_column_size'], description: 'Column Size gutter, in points' },
    pointSize: { prop: 'pointSize', kind: 'enum', map: { postscript: 'PointType.POSTSCRIPT', traditional: 'PointType.TRADITIONAL' }, pane: 'units_rulers', features: ['pref_point_pica_size'], description: 'Point/Pica Size: PostScript (72 points/inch) or traditional (72.27 points/inch)' },
    // Guides, Grid & Slices
    guideStyle: { prop: 'guideStyle', kind: 'enum', map: { solid: 'GuideLineStyle.SOLID', dashed: 'GuideLineStyle.DASHED' }, pane: 'guides_grid_slices', features: ['ui.guide_colors_style'], description: 'Guide line style' },
    gridStyle: { prop: 'gridStyle', kind: 'enum', map: { solid: 'GridLineStyle.SOLID', dashed: 'GridLineStyle.DASHED', dotted: 'GridLineStyle.DOTTED' }, pane: 'guides_grid_slices', features: ['ui.guide_colors_style', 'ui.grid_settings'], description: 'Grid line style' },
    gridSubdivisions: { prop: 'gridSubDivisions', kind: 'number', min: 1, max: 100, integer: true, pane: 'guides_grid_slices', features: ['ui.grid_settings'], description: 'Grid Subdivisions' },
    showSliceNumbers: { prop: 'showSliceNumber', kind: 'bool', pane: 'guides_grid_slices', features: ['ui.show_slice_numbers'], description: 'Show Slice Numbers' },
    // Plug-ins
    useAdditionalPluginFolder: { prop: 'useAdditionalPluginFolder', kind: 'bool', pane: 'plugins', features: ['pref_additional_plugins_folder'], description: 'Use the Additional Plug-ins Folder (takes effect after a restart)' },
    additionalPluginFolder: { prop: 'additionalPluginFolder', kind: 'folder', pane: 'plugins', features: ['pref_additional_plugins_folder'], description: 'Absolute path of the Additional Plug-ins Folder; also turns it on' },
    // Type
    smartQuotes: { prop: 'smartQuotes', kind: 'bool', pane: 'type', features: ['pref_smart_quotes'], description: 'Use Smart Quotes' },
    fontNamesInEnglish: { prop: 'showEnglishFontNames', kind: 'bool', pane: 'type', features: ['pref_font_names_in_english'], description: 'Show Font Names in English' },
    fontPreviewSize: { prop: 'fontPreviewSize', kind: 'enum', map: { none: 'FontPreviewType.NONE', small: 'FontPreviewType.SMALL', medium: 'FontPreviewType.MEDIUM', large: 'FontPreviewType.LARGE', extra_large: 'FontPreviewType.EXTRALARGE', huge: 'FontPreviewType.HUGE' }, pane: 'type', features: ['pref_font_preview_size'], description: 'Font Preview Size in font menus (none turns previews off)' },
    showAsianTextOptions: { prop: 'showAsianTextOptions', kind: 'bool', pane: 'type', features: ['pref_asian_text_options'], description: 'Show Asian text options' },
    // Legacy settings that remain in the object model
    useDiffusionDither: { prop: 'useDiffusionDither', kind: 'bool', pane: 'legacy', features: ['pref_use_diffusion_dither'], description: 'Diffusion dither (legacy)' },
    pixelDoubling: { prop: 'pixelDoubling', kind: 'bool', pane: 'legacy', features: ['pref_use_pixel_doubling'], description: 'Pixel doubling (legacy)' },
    useVideoAlpha: { prop: 'useVideoAlpha', kind: 'bool', pane: 'legacy', features: ['pref_use_video_alpha'], description: 'Video alpha (legacy)' },
    // Scripting
    scriptDialogs: { kind: 'dialogs', map: { all: 'DialogModes.ALL', error: 'DialogModes.ERROR', no: 'DialogModes.NO' }, pane: 'scripting', features: ['dialog_mode'], description: 'Application.displayDialogs: whether other scripts and actions show dialogs (all, errors only or none). This server always runs its own scripts with dialogs off' },
};

/** The Preferences panes the settings above belong to, as atlas features. */
const PANES = {
    general: 'preferences_general', interface: 'preferences_interface', file_handling: 'preferences_file_handling', performance: 'preferences_performance',
    cursors: 'preferences_cursors', transparency_gamut: 'preferences_transparency_gamut', units_rulers: 'preferences_units_rulers',
    guides_grid_slices: 'preferences_guides_grid_slices', plugins: 'preferences_plugins', type: 'preferences_type',
};

const feature = (f) => (f.startsWith('ui.') ? `photoshop.${f}` : P + f);

/** Statements that read every preference into `prefs`. */
function readPreferences() {
    const lines = ['var p = app.preferences, prefs = {};'];
    for (const [key, spec] of Object.entries(PREFERENCES)) {
        let expr;
        if (spec.kind === 'bool' || spec.kind === 'number') expr = `p.${spec.prop}`;
        else if (spec.kind === 'folder') expr = `p.${spec.prop} ? p.${spec.prop}.fsName : null`;
        else if (spec.kind === 'theme') {
            expr = `${json(Object.fromEntries(Object.entries(spec.map).map(([k, v]) => [v, k])))}[__themeNow()]`;
        } else {
            const source = { ruler: '__prevRuler', type: '__prevType', dialogs: '__prevDialogs' }[spec.kind] ?? `p.${spec.prop}`;
            const back = Object.fromEntries(Object.entries(spec.map).map(([k, v]) => [v.split('.')[1], k]));
            expr = `${json(back)}[__enumName(${source})]`;
        }
        lines.push(`try { prefs.${key} = ${expr}; } catch (e) { prefs.${key} = null; }`);
    }
    return lines.join('\n');
}

/** The interface theme, read from the interfacePrefs class (Action Manager). */
const THEME_HELPERS = `
var __appRef = function (prop) {
  var r = new ActionReference();
  r.putProperty(app.stringIDToTypeID("property"), app.stringIDToTypeID(prop));
  r.putEnumerated(app.stringIDToTypeID("application"), app.stringIDToTypeID("ordinal"), app.stringIDToTypeID("targetEnum"));
  return r;
};
var __themeNow = function () {
  var d = app.executeActionGet(__appRef("interfacePrefs")).getObjectValue(app.stringIDToTypeID("interfacePrefs"));
  return app.typeIDToStringID(d.getEnumerationValue(app.stringIDToTypeID("kuiBrightnessLevel")));
};`;

/** Statements that apply the given preferences. */
function writePreferences(a) {
    const lines = [];
    for (const [key, value] of Object.entries(a)) {
        const spec = PREFERENCES[key];
        if (!spec) throw new Error(`No preference named ${key}. Preferences: ${Object.keys(PREFERENCES).join(', ')}`);
        if (value === undefined || value === null) continue;
        if (spec.kind === 'bool') {
            if (typeof value !== 'boolean') throw new Error(`'${key}' is true or false`);
            lines.push(`p.${spec.prop} = ${bool(value)};`);
        } else if (spec.kind === 'number') {
            const v = spec.integer ? index(value, { name: key, max: spec.max }) : num(value, { min: spec.min, max: spec.max, name: key });
            if (Number(v) < spec.min) throw new Error(`Value for '${key}' out of range [${spec.min}, ${spec.max}]: ${v}`);
            lines.push(`p.${spec.prop} = ${v};`);
        } else if (spec.kind === 'folder') {
            const dir = paths.validate(value);
            lines.push(`var __folder = new Folder(${jsxPath(dir)});`, 'if (!__folder.exists) throw new Error("Folder not found: " + __folder.fsName);',
                `p.useAdditionalPluginFolder = true;`, `p.${spec.prop} = __folder;`);
        } else {
            const target = spec.map[enumOf(value, Object.keys(spec.map), { name: key })];
            if (spec.kind === 'theme') {
                lines.push(`var __t = new ActionDescriptor(), __set = new ActionDescriptor();
__t.putEnumerated(app.stringIDToTypeID("kuiBrightnessLevel"), app.stringIDToTypeID("uiBrightnessLevelEnumType"), app.stringIDToTypeID(${str(target)}));
__set.putReference(app.stringIDToTypeID("null"), __appRef("interfacePrefs"));
__set.putObject(app.stringIDToTypeID("to"), app.stringIDToTypeID("interfacePrefs"), __t);
app.executeAction(app.stringIDToTypeID("set"), __set, DialogModes.NO);`);
            } else if (spec.kind === 'ruler') lines.push(`__prevRuler = ${target};`);
            else if (spec.kind === 'type') lines.push(`__prevType = ${target};`);
            else if (spec.kind === 'dialogs') lines.push(`__prevDialogs = ${target};`);
            else lines.push(`p.${spec.prop} = ${target};`);
        }
    }
    return lines.join('\n');
}

const prefSchema = Object.fromEntries(Object.entries(PREFERENCES).map(([key, spec]) => {
    const pane = spec.pane.replace(/_/g, ' ');
    const description = `${spec.description} (Preferences > ${pane[0].toUpperCase()}${pane.slice(1)})`;
    if (spec.kind === 'bool') return [key, { type: 'boolean', description }];
    if (spec.kind === 'number') return [key, { type: spec.integer ? 'integer' : 'number', minimum: spec.min, maximum: spec.max, description }];
    if (spec.kind === 'folder') return [key, { type: 'string', description }];
    return [key, { type: 'string', enum: Object.keys(spec.map), description }];
}));

const PURGE = { all: 'ALLCACHES', undo: 'UNDOCACHES', clipboard: 'CLIPBOARDCACHE', histories: 'HISTORYCACHES' };

/**
 * Application commands: a script statement each, the platforms they work on,
 * and the features they perform.
 */
const COMMANDS = {
    beep: { run: 'app.beep();', features: ['beep'] },
    bring_to_front: { run: 'app.bringToFront();', features: ['bring_to_front'] },
    refresh: { run: 'app.refresh();', features: ['refresh_display'] },
    hide_photoshop: { run: 'app.runMenuItem(7001);', mac: true, features: ['hide_photoshop'] },
    hide_others: { run: 'app.runMenuItem(7002);', mac: true, features: ['hide_others'] },
    show_all: { run: 'app.runMenuItem(7003);', mac: true, features: ['show_all_apps'] },
    open_help: { run: 'app.runMenuItem(app.stringIDToTypeID("help"));', features: ['photoshop_help'] },
    manage_account: { run: 'app.executeAction(app.stringIDToTypeID("syncManageAcct"), new ActionDescriptor(), DialogModes.NO);', features: ['manage_account'] },
};

const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export const tools = [
    {
        name: 'get_photoshop_info',
        description: 'Describe the running Photoshop (About Photoshop, System Info): version, build, locale, free memory, the preferences folder, the file types it opens, the script dialog mode, and optionally the full System Info report or whether named features are enabled',
        inputSchema: {
            type: 'object',
            properties: {
                systemInfo: { type: 'boolean', description: 'Include the Help > System Info report (long). Default false', default: false },
                features: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Feature names to check with Application.featureEnabled, e.g. "photoshop/extended"' },
            },
        },
        hints: { readOnly: true },
        features: ['about_photoshop', 'system_info', 'free_memory', 'feature_enabled', 'file_types', 'preferences_folder'].map((f) => P + f),
        handler: (a) => {
            const names = (a.features ?? []).map((f) => {
                if (typeof f !== 'string' || !f.trim()) throw new Error("'features' holds feature names");
                return str(f);
            });
            if (names.length > 20) throw new Error("'features' takes at most 20 names");
            return run('Photoshop info', script(`
var info = { name: app.name, version: app.version, build: app.build, scriptingVersion: app.scriptingVersion, locale: app.locale, documents: app.documents.length, scriptDialogs: __enumName(__prevDialogs) };
try { info.freeMemoryBytes = app.freeMemory; } catch (e) { info.freeMemoryBytes = null; }
try { info.preferencesFolder = app.preferencesFolder.fsName; } catch (e) { info.preferencesFolder = null; }
var __list = function (v) { var out = []; for (var i = 0; i < v.length; i++) out.push(String(v[i])); return out; };
try { info.windowsFileTypes = __list(app.windowsFileTypes); } catch (e) {}
try { info.macintoshFileTypes = __list(app.macintoshFileTypes); } catch (e) {}
${a.systemInfo ? 'info.systemInfo = app.systemInformation;' : ''}
${names.length ? `var checks = {}, names = [${names.join(', ')}];
for (var k = 0; k < names.length; k++) { try { checks[names[k]] = app.featureEnabled(names[k]); } catch (e) { checks[names[k]] = null; } }
info.featureEnabled = checks;` : ''}
__result__ = info;`, { needsDocument: false }));
        },
    },
    {
        name: 'get_photoshop_preferences',
        description: 'Read Photoshop\'s preferences (Photoshop > Settings, or Edit > Preferences on Windows) that scripts can reach: general, interface, file handling, performance, cursors, transparency, units and rulers, guides and grid, plug-ins, type, and the script dialog mode',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: [`${P}preferences`],
        handler: () => run('Preferences', script(`${THEME_HELPERS}
${readPreferences()}
__result__ = prefs;`, { needsDocument: false })),
    },
    {
        name: 'set_photoshop_preferences',
        description: 'Change Photoshop\'s preferences (Photoshop > Settings, or Edit > Preferences on Windows). Give only the settings to change; the result lists every preference afterwards. Some take effect after a restart',
        inputSchema: { type: 'object', properties: prefSchema },
        hints: { idempotent: true },
        features: [...new Set([`${P}preferences`, ...Object.values(PANES).map((p) => P + p), ...Object.values(PREFERENCES).flatMap((s) => s.features.map(feature))])],
        auditArgs: { cacheLevels: 4 },
        handler: (a) => {
            const given = Object.fromEntries(Object.entries(a ?? {}).filter(([, v]) => v !== undefined));
            if (!Object.keys(given).length) throw new Error(`Give at least one preference: ${Object.keys(PREFERENCES).join(', ')}`);
            return run('Set preferences', script(`${THEME_HELPERS}
var p = app.preferences;
${writePreferences(given)}
${readPreferences()}
__result__ = prefs;`, { needsDocument: false }));
        },
    },
    {
        name: 'purge_photoshop_caches',
        description: 'Free memory with Edit > Purge: the undo buffer, the clipboard, the histories of open documents, or all of them. It cannot be undone',
        inputSchema: { type: 'object', properties: { target: { type: 'string', enum: Object.keys(PURGE), description: 'What to purge. Default all', default: 'all' } } },
        hints: { destructive: true, idempotent: true },
        features: ['purge', 'purge_all', 'purge_clipboard', 'purge_undo'].map((f) => P + f),
        handler: (a) => {
            const t = enumOf(a.target ?? 'all', Object.keys(PURGE), { name: 'target' });
            return run('Purge', script(`
var before = app.freeMemory;
app.purge(PurgeTarget.${PURGE[t]});
__result__ = { purged: ${str(t)}, freeMemoryBefore: before, freeMemoryAfter: app.freeMemory };`, { needsDocument: false }));
        },
    },
    {
        name: 'run_photoshop_command',
        description: 'Run an application command: beep, bring Photoshop to the front, redraw the screen, hide Photoshop or the other applications or show them all again (Photoshop menu, macOS only), open Help > Photoshop Help, or open the Creative Cloud account page in the browser',
        inputSchema: { type: 'object', properties: { command: { type: 'string', enum: Object.keys(COMMANDS), description: 'The command' } }, required: ['command'] },
        hints: { openWorld: true },
        features: Object.values(COMMANDS).flatMap((c) => c.features.map((f) => P + f)),
        handler: (a) => {
            const c = enumOf(a.command, Object.keys(COMMANDS), { name: 'command' });
            if (COMMANDS[c].mac && process.platform !== 'darwin') throw new Error(`${c} is a macOS menu command`);
            return run('Application command', script(`
${COMMANDS[c].run}
__result__ = { command: ${str(c)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'run_photoshop_menu_item',
        description: 'Run any Photoshop menu command by its string id (e.g. "toggleRulers") or four-character id (e.g. "TglR"), as Application.runMenuItem does. A command that opens a dialog shows it and waits; prefer the specific tools',
        inputSchema: {
            type: 'object',
            properties: {
                stringID: { type: 'string', description: 'Menu command string id, e.g. "screenModeFullScreen"' },
                charID: { type: 'string', description: 'Four-character menu command id, e.g. "ZmIn"' },
            },
        },
        hints: { destructive: true },
        auditArgs: { stringID: 'toggleRulers', charID: undefined },
        features: [`${P}run_menu_item`],
        handler: (a) => {
            if ((a.stringID === undefined) === (a.charID === undefined)) throw new Error('Give stringID or charID');
            let id;
            if (a.stringID !== undefined) {
                if (!/^[A-Za-z0-9][A-Za-z0-9_]{0,99}$/.test(String(a.stringID))) throw new Error("'stringID' is letters, digits and underscores");
                id = `app.stringIDToTypeID(${str(a.stringID)})`;
            } else {
                if (!/^[\x20-\x7e]{4}$/.test(String(a.charID))) throw new Error("'charID' is exactly four characters");
                id = `app.charIDToTypeID(${str(a.charID)})`;
            }
            return run('Run menu item', script(`
app.runMenuItem(${id});
__result__ = { ran: ${str(a.stringID ?? a.charID)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_script_options',
        description: 'Store, read or erase named values that persist in Photoshop between sessions (Application.putCustomOptions, getCustomOptions and eraseCustomOptions), for keeping settings across calls',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'set', 'erase'], description: 'get the values, set (replace) them, or erase them' },
                key: { type: 'string', description: 'A unique key, e.g. "com.example.myScript"' },
                values: { type: 'object', description: 'set: { name: string, number or boolean }. Names are letters, digits and underscores', additionalProperties: { type: ['string', 'number', 'boolean'] } },
                persistent: { type: 'boolean', description: 'set: keep after Photoshop quits. Default true', default: true },
            },
            required: ['action', 'key'],
        },
        auditArgs: { action: 'set', values: { mode: 'fast', count: 3, on: true } },
        features: [`${P}custom_options`],
        handler: (a) => {
            const action = enumOf(a.action, ['get', 'set', 'erase'], { name: 'action' });
            if (typeof a.key !== 'string' || !a.key.trim()) throw new Error("'key' is required");
            const key = str(a.key);
            if (action === 'erase') {
                return run('Erase options', script(`
app.eraseCustomOptions(${key});
__result__ = { erased: ${key} };`, { needsDocument: false }));
            }
            if (action === 'get') {
                return run('Get options', script(`
var d = null, out = null;
try { d = app.getCustomOptions(${key}); } catch (e) { d = null; }
if (d) {
  out = {};
  for (var i = 0; i < d.count; i++) {
    var k = d.getKey(i), t = d.getType(k), n = app.typeIDToStringID(k);
    if (t === DescValueType.STRINGTYPE) out[n] = d.getString(k);
    else if (t === DescValueType.DOUBLETYPE) out[n] = d.getDouble(k);
    else if (t === DescValueType.INTEGERTYPE) out[n] = d.getInteger(k);
    else if (t === DescValueType.BOOLEANTYPE) out[n] = d.getBoolean(k);
  }
}
__result__ = { key: ${key}, values: out };`, { needsDocument: false }));
            }
            const values = a.values;
            if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw new Error("set needs 'values', an object of names to strings, numbers or booleans");
            const puts = Object.entries(values).map(([name, v]) => {
                if (!OPTION_NAME.test(name)) throw new Error(`'values.${name}': names are letters, digits and underscores, starting with a letter`);
                const id = `app.stringIDToTypeID(${str(name)})`;
                if (typeof v === 'boolean') return `d.putBoolean(${id}, ${bool(v)});`;
                if (typeof v === 'number') return `d.putDouble(${id}, ${num(v, { name: `values.${name}` })});`;
                if (typeof v === 'string') return `d.putString(${id}, ${str(v)});`;
                throw new Error(`'values.${name}' must be a string, number or boolean`);
            });
            return run('Set options', script(`
var d = new ActionDescriptor();
${puts.join('\n')}
app.putCustomOptions(${key}, d, ${bool(a.persistent ?? true)});
__result__ = { key: ${key}, stored: ${puts.length} };`, { needsDocument: false }));
        },
    },
    {
        name: 'quit_photoshop',
        description: 'Quit Photoshop (File > Exit, or Photoshop > Quit Photoshop on macOS). Refuses while documents have unsaved changes unless discardUnsaved is true, which closes them without saving first',
        inputSchema: { type: 'object', properties: { discardUnsaved: { type: 'boolean', description: 'Close documents with unsaved changes without saving them. Default false', default: false } } },
        hints: { destructive: true },
        auditArgs: { discardUnsaved: false },
        features: [`${P}quit`],
        handler: (a) => run('Quit', `${script(`
var unsaved = [];
for (var i = 0; i < app.documents.length; i++) if (!app.documents[i].saved) unsaved.push(app.documents[i].name);
if (unsaved.length && !${bool(a.discardUnsaved)}) throw new Error("Unsaved changes in " + unsaved.join(", ") + ": save them, or pass discardUnsaved: true");
while (app.documents.length) app.documents[0].close(SaveOptions.DONOTSAVECHANGES);
__result__ = { quitting: true, discarded: unsaved };`, { needsDocument: false })}
app.executeAction(app.stringIDToTypeID("quit"), new ActionDescriptor(), DialogModes.NO);`),
    },
];
