/**
 * Automation: run script files (now, after a delay, or from the File > Scripts
 * menu) as one undo step with dialogs suppressed, cancel scheduled scripts,
 * and build Motion Graphics templates from scripts.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, PROPERTY_SCHEMA, compSpec, layerSpec, propertyPath } from '../args.js';
import { paths } from './project.js';

const SCRIPT_EXT = /\.(jsx|jsxbin|js)$/i;

export const tools = [
    {
        name: 'run_aftereffects_script_file',
        description: 'Run an ExtendScript file in After Effects (File > Scripts > Run Script File) as one undo step with dialogs suppressed, or schedule it to run after a delay (optionally repeating) and cancel a scheduled run, or run a script listed in the File > Scripts menu by its file name. Scripts run unrestricted',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Absolute path to a .jsx, .jsxbin or .js file' },
                undoName: { type: 'string', description: 'Name of the undo step (Edit > Undo). Default "Run script"' },
                delaySeconds: { type: 'number', minimum: 0.01, maximum: 86400, description: 'With file: run it this long from now instead of now, and return the task id' },
                repeat: { type: 'boolean', description: 'With delaySeconds: run again every delaySeconds until cancelled. Default false', default: false },
                cancelTask: { type: 'integer', minimum: 0, description: 'Cancel a scheduled run by the task id it returned' },
                scriptsMenuItem: { type: 'string', description: 'Run the script shown in File > Scripts with this name, e.g. "Demo Palette.jsx"' },
            },
        },
        auditArgs: { file: `${process.env.HOME ?? '/tmp'}/Documents/tool.jsx`, delaySeconds: undefined, repeat: undefined, cancelTask: undefined, scriptsMenuItem: undefined },
        hints: { destructive: true },
        features: [
            'aftereffects.automation.run_script_file',
            'aftereffects.automation.scripts_menu',
            'aftereffects.automation.run_loaded_script',
            'aftereffects.automation.undo_groups',
            'aftereffects.automation.suppress_dialogs',
            'aftereffects.automation.scheduled_tasks',
        ],
        handler: (a) => {
            const given = ['file', 'cancelTask', 'scriptsMenuItem'].filter((k) => a[k] !== undefined);
            if (given.length !== 1) throw new Error('Give exactly one of file, cancelTask or scriptsMenuItem');
            if (a.file === undefined && (a.delaySeconds !== undefined || a.repeat)) throw new Error('delaySeconds and repeat apply only with file');
            if (a.repeat && a.delaySeconds === undefined) throw new Error('repeat needs delaySeconds');
            if (a.cancelTask !== undefined) {
                return run('Cancel scheduled script', script(`app.cancelTask(${index(a.cancelTask, { name: 'cancelTask', max: 1e9 })}); __result__ = { cancelled: ${index(a.cancelTask, { name: 'cancelTask', max: 1e9 })} };`));
            }
            if (a.scriptsMenuItem !== undefined) {
                const name = String(a.scriptsMenuItem);
                if (!/\.(jsx|jsxbin)$/i.test(name)) throw new Error("'scriptsMenuItem' is a script file name as shown in File > Scripts, ending in .jsx or .jsxbin");
                return run('Run script', script(`
var id = app.findMenuCommandId(${str(name)});
if (!id) throw new Error("No script named " + ${str(name)} + " in File > Scripts");
app.executeCommand(id);
__result__ = { ran: ${str(name)} };`, { undo: String(a.undoName ?? 'Run script') }));
            }
            const file = paths.validate(a.file);
            if (!SCRIPT_EXT.test(path.extname(file))) throw new Error('file must end in .jsx, .jsxbin or .js');
            if (a.delaySeconds !== undefined) {
                const ms = Math.round(Number(num(a.delaySeconds, { min: 0.01, max: 86400, name: 'delaySeconds' })) * 1000);
                const task = `$.evalFile(new File(${jsxPath(file)}));`;
                return run('Schedule script', script(`
var f = new File(${jsxPath(file)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var task = app.scheduleTask(${str(task)}, ${ms}, ${bool(a.repeat)});
__result__ = { scheduled: f.fsName, taskId: task, delayMs: ${ms}, repeat: ${bool(a.repeat)} };`));
            }
            return run('Run script', script(`
var f = new File(${jsxPath(file)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var r = $.evalFile(f);
__result__ = { ran: f.fsName, result: r === undefined ? null : String(r) };`, { undo: String(a.undoName ?? 'Run script') }));
        },
    },
    {
        name: 'manage_motion_graphics_template',
        description: 'Build a Motion Graphics template from a composition (Essential Graphics panel): add layer properties as controls, name the template, open the composition in the Essential Graphics panel, or export it as a .mogrt file. Returns the template\'s controls',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                action: { type: 'string', enum: ['add_property', 'set_name', 'open', 'export', 'describe'], description: 'What to do' },
                layers: { ...LAYERS_SCHEMA, description: 'add_property: the layers whose property to add' },
                property: { ...PROPERTY_SCHEMA, description: `add_property: ${PROPERTY_SCHEMA.description}` },
                name: { type: 'string', description: 'add_property: the control\'s name (default the property name); set_name: the template name' },
                folder: { type: 'string', description: 'export: absolute folder for the .mogrt (default the Essential Graphics templates folder)' },
                overwrite: { type: 'boolean', description: 'export: replace an existing file. Default false', default: false },
            },
            required: ['action'],
        },
        auditArgs: { action: 'add_property', layers: { indexes: [1] }, property: 'opacity', name: 'Fade', folder: undefined },
        features: ['aftereffects.automation.mogrt_scripting'],
        handler: (a) => {
            const action = enumOf(a.action, ['add_property', 'set_name', 'open', 'export', 'describe'], { name: 'action' });
            let body = '';
            if (action === 'add_property') {
                if (a.property === undefined) throw new Error('add_property needs property');
                body = `var ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property)};
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path);
  if (!p.canAddToMotionGraphicsTemplate(c)) throw new Error(p.name + " on layer " + ls[i].index + " cannot be added to the template");
  ${a.name !== undefined ? `p.addToMotionGraphicsTemplateAs(c, ${str(a.name)});` : 'p.addToMotionGraphicsTemplate(c);'}
}`;
            } else if (action === 'set_name') {
                if (!a.name) throw new Error('set_name needs name');
                body = `c.motionGraphicsTemplateName = ${str(a.name)};`;
            } else if (action === 'open') {
                body = 'c.openInEssentialGraphics();';
            } else if (action === 'export') {
                const folder = a.folder !== undefined ? jsxPath(paths.validate(a.folder)) : null;
                body = `var ok = c.exportAsMotionGraphicsTemplate(${bool(a.overwrite)}${folder ? `, ${folder}` : ''});
if (!ok) throw new Error("Export failed: name the template and add at least one control, or pass overwrite: true if the file exists");`;
            }
            return run('Motion Graphics template', script(`
var c = __comp(${compSpec(a.comp)});
${body}
var names = [];
for (var n = 1; n <= c.motionGraphicsTemplateControllerCount; n++) { try { names.push(c.getMotionGraphicsTemplateControllerName(n)); } catch (e) {} }
__result__ = { comp: c.name, templateName: c.motionGraphicsTemplateName, controls: c.motionGraphicsTemplateControllerCount, controlNames: names };`, action === 'describe' || action === 'open' || action === 'export' ? {} : { undo: 'Motion Graphics template' }));
        },
    },
];
