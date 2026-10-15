/**
 * InCopy and interoperability: assignments (create, edit, add content, update,
 * package, delete), InCopy content (export stories for InCopy, check in all,
 * save content, workflow status), Creative Cloud Libraries assets and
 * automatic adding, and PDF comments imported from Acrobat. Checking content
 * out and in, updating and embedding it are run_document_link_action; the
 * clipboard preferences are set_indesign_preferences.
 */
import { str } from 'adobe-mcp-core';
import { script } from './script.js';
import { run } from './run.js';
import { has, int, idList, flag, text, textList, pick, filePath, uiColor, uiColorSchema, UI_COLOR_JSX } from './checks.js';

/** Script helpers: an assignment by name, story or frame for an id, and summaries. */
const INCOPY_JSX = UI_COLOR_JSX + String.raw`
var __assignment = function (doc, name) {
  var a = doc.assignments.itemByName(name);
  if (a.isValid) return a;
  var names = [];
  for (var i = 0; i < doc.assignments.length; i++) names.push(doc.assignments[i].name);
  throw new Error("No assignment named " + name + ". Assignments: " + names.join(", "));
};
var __managed = function (doc, id) {
  var it = __item(doc, id);
  return it instanceof TextFrame ? it.parentStory : it;
};
var __contentInfo = function (c) {
  var info = { type: c.constructor.name, id: c.id, lockState: __enumName(c.lockState) };
  try { var l = c.itemLink; if (l && l.isValid) { info.file = l.filePath; info.linkStatus = __enumName(l.status); } } catch (e) {}
  try { if (c instanceof Story && c.textContainers.length) info.frameId = c.textContainers[0].id; } catch (e) {}
  return info;
};
var __assignmentInfo = function (a) {
  var info = { name: a.name, file: null, userName: a.userName, status: __enumName(a.assignmentFileStatus), packaged: a.packaged, content: [] };
  try { info.file = a.filePath instanceof File ? a.filePath.fsName : a.filePath; } catch (e) {}
  try { info.frameColor = __uiColor(a.frameColor); } catch (e) {}
  try { info.exportOptions = __enumName(a.exportOptions); info.includeLinksWhenPackage = a.includeLinksWhenPackage; } catch (e) {}
  try { info.packageUpToDate = a.packageUpToDate; } catch (e) {}
  for (var i = 0; i < a.assignedStories.length; i++) {
    var s = a.assignedStories[i], e = { name: s.name, file: s.filePath };
    try { e.type = s.storyReference.constructor.name; e.id = s.storyReference.id; } catch (x) {}
    info.content.push(e);
  }
  return info;
};
var __exportStory = function (story, folder) {
  if (story.lockState !== LockStateValues.UNMANAGED_STORY) return false;
  var base = "Story " + story.id;
  try { if (story.textContainers.length && story.textContainers[0].name) base = story.textContainers[0].name; } catch (e) {}
  base = base.replace(/[\\\/:*?"<>|]/g, "_");
  if (!folder.exists) folder.create();
  story.exportFile(ExportFormat.INCOPY_MARKUP, File(folder.fullName + "/" + base + ".icml"));
  return true;
};
`;

const incopyScript = (body, opts) => script(INCOPY_JSX + body, opts);

const CONTENT = { assigned_spreads: 'AssignmentExportOptions.ASSIGNED_SPREADS', empty_frames: 'AssignmentExportOptions.EMPTY_FRAMES', everything: 'AssignmentExportOptions.EVERYTHING' };
const ASSIGNMENT_ACTIONS = ['list', 'create', 'edit', 'add_content', 'delete', 'update', 'package', 'cancel_package', 'reveal'];

/** Assignment option statements on `as`. */
function optionLines(a) {
    const lines = [];
    if (has(a.userName)) lines.push(`as.userName = ${text(a.userName, 'userName', 200)};`);
    if (has(a.frameColor)) lines.push(`as.frameColor = ${uiColor(a.frameColor, 'frameColor')};`);
    if (has(a.content)) lines.push(`as.exportOptions = ${pick(a.content, CONTENT, 'content')};`);
    if (has(a.includeLinksWhenPackage)) lines.push(`as.includeLinksWhenPackage = ${flag(a.includeLinksWhenPackage, 'includeLinksWhenPackage')};`);
    return lines;
}

/** Statements that add the stories of frames to assignment `as`, exporting unmanaged ones first. */
function addContentLines(frameIds) {
    return [
        `var ids = ${idList(frameIds, 'frameIds')}, added = 0;`,
        'var contentFolder = Folder(File(as.filePath).parent.fullName + "/content");',
        'for (var i = 0; i < ids.length; i++) {',
        '  var it = __item(doc, ids[i]);',
        '  if (!(it instanceof TextFrame)) throw new Error("Item " + ids[i] + " is not a text frame; add graphics to an assignment in the Assignments panel");',
        '  var story = it.parentStory, found = null;',
        '  __exportStory(story, contentFolder);',
        '  for (var j = 0; j < doc.assignments.length && !found; j++) {',
        '    var list = doc.assignments[j].assignedStories;',
        '    for (var k = 0; k < list.length; k++) { try { if (list[k].storyReference.id === story.id) { found = list[k]; break; } } catch (e) {} }',
        '  }',
        '  if (!found) throw new Error("Story " + story.id + " could not be found among the InCopy content after export");',
        '  if (found.parent.name !== as.name) found.move(LocationOptions.AT_END, as);',
        '  added++;',
        '}',
        'as.update("");',
    ];
}

export const tools = [
    {
        name: 'manage_assignments',
        description: 'InCopy assignments (Assignments panel): list them with their content and status; create an assignment file with a user name, colour and what it includes; edit its options; add text frames\' stories to it (exporting them for InCopy first); delete it; write changes to selected, all or out-of-date assignment files (optionally saving the layout first so geometry changes reach InCopy users); package it for InCopy or cancel a package; or reveal its file in Finder or Explorer',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ASSIGNMENT_ACTIONS, description: 'What to do' },
                name: { type: 'string', description: 'The assignment name (for create, the new name)' },
                newName: { type: 'string', description: 'For edit: rename the assignment' },
                path: { type: 'string', description: 'For create: the assignment file (.icma); for package: the package file (.icap)' },
                userName: { type: 'string', description: 'For create and edit: the InCopy user it is assigned to' },
                frameColor: uiColorSchema('For create and edit: the frame colour that marks its content'),
                content: { type: 'string', enum: Object.keys(CONTENT), description: 'For create and edit: what the assignment file includes: placeholder frames only, the assigned spreads, or every spread' },
                includeLinksWhenPackage: { type: 'boolean', description: 'For create and edit: include linked image files in packages' },
                frameIds: { type: 'array', items: { type: 'integer' }, description: 'For create and add_content: text frames whose stories to add' },
                which: { type: 'string', enum: ['named', 'all', 'out_of_date'], description: 'For update: the named assignments (names), all, or the out-of-date ones', default: 'named' },
                names: { type: 'array', items: { type: 'string' }, description: 'For update with which named: the assignments' },
                saveDocument: { type: 'boolean', description: 'For update: save the document first, so layout changes reach InCopy users', default: false },
                submit: { type: 'boolean', description: 'For package: check in (submit) the assigned content before packaging', default: true },
            },
            required: ['action'],
        },
        features: [
            'indesign.interoperability.assignments_panel',
            'indesign.interoperability.assignment',
            'indesign.interoperability.assignments_menu_new_assignment',
            'indesign.interoperability.assignments_menu_add_to_assignment',
            'indesign.interoperability.assignments_menu_assignment_options',
            'indesign.interoperability.assignments_menu_delete_assignment',
            'indesign.interoperability.assignments_menu_update_selected_assignments',
            'indesign.interoperability.assignments_menu_update_all_assignments',
            'indesign.interoperability.assignments_menu_update_out_of_date_assignments',
            'indesign.interoperability.assignments_menu_package_for_incopy',
            'indesign.interoperability.assignments_menu_cancel_package',
            'indesign.interoperability.assignments_menu_reveal_in_finder',
            'indesign.interoperability.incopy_add_to_assignment',
            'indesign.interoperability.incopy_managed_layout_changes',
        ],
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'create', name: 'Feature', path: `${process.env.HOME ?? '/tmp'}/Documents/feature.icma`, userName: 'Sam', frameColor: 'gold', content: 'assigned_spreads', includeLinksWhenPackage: true, frameIds: [1, 2] },
        handler: (a) => {
            const action = pick(a.action, Object.fromEntries(ASSIGNMENT_ACTIONS.map((x) => [x, x])), 'action');
            const lines = [];
            if (action === 'list') {
                lines.push('var out = [];', 'for (var i = 0; i < doc.assignments.length; i++) out.push(__assignmentInfo(doc.assignments[i]));', '__result__ = { assignments: out };');
                return run('List assignments', incopyScript(lines.join('\n')));
            }
            if (action === 'update') {
                const which = pick(a.which ?? 'named', { named: 'named', all: 'all', out_of_date: 'out_of_date' }, 'which');
                if (has(a.saveDocument) && flag(a.saveDocument, 'saveDocument') === 'true') {
                    lines.push('if (!doc.saved) throw new Error("Save the document once (save_document) before updating assignments with saveDocument");', 'doc.save();');
                }
                if (which === 'named') lines.push(`var list = [], want = ${textList(a.names, 'names', { max: 500 })};`, 'for (var w = 0; w < want.length; w++) list.push(__assignment(doc, want[w]));');
                else lines.push('var list = doc.assignments.everyItem().getElements();');
                lines.push(
                    'var done = [];',
                    'for (var i = 0; i < list.length; i++) {',
                    which === 'out_of_date' ? '  if (list[i].assignmentFileStatus !== AssignmentStatus.ASSIGNMENT_OUT_OF_DATE) continue;' : '',
                    '  try { if (!list[i].filePath) continue; } catch (e) { continue; }',
                    '  list[i].update("");',
                    '  done.push(list[i].name);',
                    '}',
                    '__result__ = { updated: done };',
                );
                return run('Update assignments', incopyScript(lines.join('\n')));
            }
            const name = text(a.name, 'name', 200);
            if (action === 'create') {
                const path = filePath(a.path, 'path', ['.icma']);
                lines.push(
                    `if (doc.assignments.itemByName(${name}).isValid) throw new Error("An assignment named " + ${name} + " exists");`,
                    `var as = doc.assignments.add(File(${path}), "", false, { name: ${name} });`,
                    ...optionLines(a),
                    ...(has(a.frameIds) ? addContentLines(a.frameIds) : ['as.update("");']),
                    '__result__ = __assignmentInfo(as);',
                );
                return run('New assignment', incopyScript(lines.join('\n')));
            }
            lines.push(`var as = __assignment(doc, ${name});`);
            if (action === 'edit') {
                const opts = optionLines(a);
                if (has(a.newName)) opts.unshift(`as.name = ${text(a.newName, 'newName', 200)};`);
                if (!opts.length) throw new Error('Give an option to change: newName, userName, frameColor, content or includeLinksWhenPackage');
                lines.push(...opts, 'as.update("");', '__result__ = __assignmentInfo(as);');
            }
            if (action === 'add_content') lines.push(...addContentLines(a.frameIds), '__result__ = __assignmentInfo(as);');
            if (action === 'delete') lines.push('as.remove();', `__result__ = { deleted: ${name} };`);
            if (action === 'package') {
                const path = filePath(a.path, 'path', ['.icap']);
                const submit = has(a.submit) ? flag(a.submit, 'submit') : 'true';
                lines.push(`var pkg = as.createPackage(File(${path}), ${submit});`, '__result__ = { package: pkg ? pkg.fsName : null, assignment: __assignmentInfo(as) };');
            }
            if (action === 'cancel_package') lines.push('as.cancelPackage();', '__result__ = __assignmentInfo(as);');
            if (action === 'reveal') lines.push('var f = File(as.filePath);', 'if (!f.exists) throw new Error("The assignment file is missing: " + f.fsName);', 'f.parent.execute();', '__result__ = { revealed: f.fsName };');
            return run('Assignment', incopyScript(lines.join('\n')));
        },
    },
    {
        name: 'manage_incopy_content',
        description: 'InCopy content in the layout: export stories for InCopy (chosen frames, a layer\'s frames, or all stories), check in all checked-out content, save checked-out content without checking it in, or report each story\'s workflow status (available, checked out, out of date, missing) as the workflow icons show it (Edit > InCopy > Export, Check In All, Save Content). Check out, check in, cancel a check-out, update, embed and go to content are run_document_link_action',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['export', 'check_in_all', 'save_content', 'status'], description: 'What to do' },
                frameIds: { type: 'array', items: { type: 'integer' }, description: 'Text frames, each standing for its story: for export the stories to export (default: all stories), for save_content the content to save, for status the content to report (default: all managed stories)' },
                layer: { type: 'string', description: 'For export: export the stories of this layer\'s text frames' },
                folder: { type: 'string', description: 'For export: the folder for the InCopy (.icml) files' },
                comment: { type: 'string', description: 'For check_in_all: the version comment' },
            },
            required: ['action'],
        },
        features: [
            'indesign.interoperability.export_incopy',
            'indesign.interoperability.assignments_menu_check_in_all',
            'indesign.interoperability.incopy_save_content',
            'indesign.interoperability.incopy_workflow_icons',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'export', frameIds: [1, 2], layer: null, comment: null, folder: `${process.env.HOME ?? '/tmp'}/Documents/incopy` },
        handler: (a) => {
            const action = pick(a.action, { export: 'export', check_in_all: 'check_in_all', save_content: 'save_content', status: 'status' }, 'action');
            const ids = has(a.frameIds) ? idList(a.frameIds, 'frameIds') : null;
            if (has(a.comment) && action !== 'check_in_all') throw new Error("'comment' applies to check_in_all");
            if ((has(a.layer) || has(a.folder)) && action !== 'export') throw new Error("'layer' and 'folder' apply to export");
            const lines = [];
            if (action === 'export') {
                const folder = filePath(a.folder, 'folder');
                if (ids && has(a.layer)) throw new Error('Give frameIds or layer, not both');
                lines.push(`var folder = Folder(${folder}), stories = [], i;`);
                if (ids) {
                    lines.push(`var ids = ${ids};`, 'for (i = 0; i < ids.length; i++) { var it = __item(doc, ids[i]); if (!(it instanceof TextFrame)) throw new Error("Item " + ids[i] + " is not a text frame"); stories.push(it.parentStory); }');
                } else if (has(a.layer)) {
                    const layer = text(a.layer, 'layer', 200);
                    lines.push(`var layer = doc.layers.itemByName(${layer});`, `if (!layer.isValid) throw new Error("No layer named " + ${layer});`, 'var tf = layer.textFrames.everyItem().getElements();', 'for (i = 0; i < tf.length; i++) stories.push(tf[i].parentStory);');
                } else {
                    lines.push('stories = doc.stories.everyItem().getElements();');
                }
                lines.push('var exported = [], skipped = 0;', 'for (i = 0; i < stories.length; i++) { if (__exportStory(stories[i], folder)) exported.push(__contentInfo(stories[i])); else skipped++; }', '__result__ = { folder: folder.fsName, exported: exported, alreadyManaged: skipped };');
            } else if (action === 'check_in_all') {
                if (ids) throw new Error('check_in_all checks in every checked-out story; leave out frameIds');
                const comment = has(a.comment) ? text(a.comment, 'comment', 1000) : '""';
                lines.push('var out = [], st = doc.stories;', `for (var i = 0; i < st.length; i++) if (st[i].lockState === LockStateValues.CHECKED_OUT_STORY) { st[i].checkIn(${comment}); out.push(__contentInfo(st[i])); }`, '__result__ = { checkedIn: out };');
            } else if (action === 'save_content') {
                if (!ids) throw new Error("'frameIds' is required for save_content");
                lines.push(
                    `var ids = ${ids}, out = [];`,
                    'for (var i = 0; i < ids.length; i++) {',
                    '  var c = __managed(doc, ids[i]);',
                    '  app.select(c instanceof Story ? c.textContainers[0] : c);',
                    '  var ma = app.menuActions.itemByID(102154);',
                    '  if (!ma.isValid || !ma.enabled) throw new Error("Save Content is not available for item " + ids[i] + ": it needs content you have checked out");',
                    '  ma.invoke();',
                    '  out.push(__contentInfo(c));',
                    '}',
                    '__result__ = { saved: out };',
                );
            } else {
                lines.push(
                    'var list = [];',
                    ids ? `var ids = ${ids}; for (var i = 0; i < ids.length; i++) list.push(__managed(doc, ids[i]));` : 'var st = doc.stories; for (var i = 0; i < st.length; i++) if (st[i].lockState !== LockStateValues.UNMANAGED_STORY) list.push(st[i]);',
                    'var out = [];',
                    'for (var j = 0; j < list.length; j++) out.push(__contentInfo(list[j]));',
                    '__result__ = { items: out };',
                );
            }
            return run('InCopy content', incopyScript(lines.join('\n')));
        },
    },
    {
        name: 'manage_cc_library_assets',
        description: 'Creative Cloud Libraries: place a library asset in the document (linked to the library when its data says so, so library edits update the layout), export the selection as the files a library asset needs, with a thumbnail size, or choose whether new swatches, paragraph styles and character styles are added to the current library automatically (CC Libraries panel: Place Linked; Add Content; Add to CC Libraries in the New Swatch and New Style dialogs)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['place', 'export_selection', 'auto_add'], description: 'What to do; auto_add sets and returns the automatic adding options' },
                assetData: { type: 'string', description: 'For place: the asset description JSON from Creative Cloud Libraries (as the CC Libraries panel passes to InDesign)' },
                path: { type: 'string', description: 'For export_selection: the file to export the selection to' },
                thumbnailWidth: { type: 'integer', minimum: 16, maximum: 4096, description: 'For export_selection: maximum thumbnail width in pixels' },
                thumbnailHeight: { type: 'integer', minimum: 16, maximum: 4096, description: 'For export_selection: maximum thumbnail height in pixels' },
                swatches: { type: 'boolean', description: 'For auto_add: add new swatches to the current CC Library' },
                paragraphStyles: { type: 'boolean', description: 'For auto_add: add new paragraph styles to the current CC Library' },
                characterStyles: { type: 'boolean', description: 'For auto_add: add new character styles to the current CC Library' },
            },
            required: ['action'],
        },
        features: [
            'indesign.interoperability.cc_library_graphics',
            'indesign.interoperability.context_cc_place_linked',
            'indesign.interoperability.cc_libraries_panel',
            'indesign.interoperability.cc_auto_add',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
        auditArgs: { action: 'export_selection', path: `${process.env.HOME ?? '/tmp'}/Documents/asset.idms`, thumbnailWidth: 512, thumbnailHeight: 512 },
        handler: (a) => {
            const action = pick(a.action, { place: 'place', export_selection: 'export_selection', auto_add: 'auto_add' }, 'action');
            if (action === 'auto_add') {
                const map = { swatches: 'autoAddSwatchToCCLibraries', paragraphStyles: 'autoAddParaStyleToCCLibraries', characterStyles: 'autoAddCharStyleToCCLibraries' };
                const lines = ['var gp = app.generalPreferences;'];
                for (const [k, p] of Object.entries(map)) if (has(a[k])) lines.push(`gp.${p} = ${flag(a[k], k)};`);
                lines.push(`__result__ = { ${Object.entries(map).map(([k, p]) => `${k}: gp.${p}`).join(', ')} };`);
                return run('CC Libraries auto add', script(lines.join('\n'), { needsDocument: false }));
            }
            if (action === 'place') {
                if (typeof a.assetData !== 'string' || a.assetData.length > 200000) throw new Error("'assetData' is required: the asset's JSON as a string");
                try {
                    const parsed = JSON.parse(a.assetData);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
                } catch {
                    throw new Error("'assetData' must be a JSON object");
                }
                return run('Place library asset', script(`var before = doc.allPageItems.length;
doc.placeCloudAsset(${str(a.assetData)});
__result__ = { placed: true, newItems: doc.allPageItems.length - before, selection: app.selection.length ? __itemInfo(app.selection[0]) : null };`));
            }
            const path = filePath(a.path, 'path');
            const size = has(a.thumbnailWidth) || has(a.thumbnailHeight)
                ? `app.setCloudLibraryOptions(${int(a.thumbnailWidth ?? 512, 'thumbnailWidth', { min: 16, max: 4096 })}, ${int(a.thumbnailHeight ?? 512, 'thumbnailHeight', { min: 16, max: 4096 })});`
                : '';
            return run('Export selection for library', script(`if (!app.selection.length) throw new Error("Select the items to export");
${size}
var f = File(${path});
var ok = app.exportSelectionForCloudLibrary(f);
__result__ = { exported: ok, file: f.fsName };`));
        },
    },
    {
        name: 'manage_pdf_comments',
        description: 'Import comments from a reviewed PDF into the document (File > PDF Comments > Import PDF Comments), list them with type, text, reviewer, date, status and replies, mark them open or resolved, or delete them (PDF Comments panel)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['import', 'list', 'set_status', 'delete'], description: 'What to do' },
                path: { type: 'string', description: 'For import: the PDF file with comments' },
                ids: { type: 'array', items: { type: 'integer' }, description: 'For set_status and delete: comment ids (from list)' },
                status: { type: 'string', enum: ['open', 'resolved'], description: 'For set_status: the new status' },
                maxComments: { type: 'integer', minimum: 1, maximum: 5000, description: 'For list: the most comments to return', default: 500 },
            },
            required: ['action'],
        },
        features: ['indesign.interoperability.import_pdf_comments'],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'set_status', ids: [1, 2], status: 'resolved' },
        handler: (a) => {
            const action = pick(a.action, { import: 'import', list: 'list', set_status: 'set_status', delete: 'delete' }, 'action');
            const max = int(a.maxComments ?? 500, 'maxComments', { min: 1, max: 5000 });
            const lines = [];
            if (action === 'import') {
                lines.push(`var f = File(${filePath(a.path, 'path', ['.pdf'])});`, 'if (!f.exists) throw new Error("No file " + f.fsName);', 'var before = doc.pdfComments.length;', 'doc.importPdfComments(f, {});', 'var imported = doc.pdfComments.length - before;');
            }
            if (action === 'set_status' || action === 'delete') {
                const status = action === 'set_status' ? pick(a.status, { open: 'CommentStatusEnum.OPEN_STATUS', resolved: 'CommentStatusEnum.RESOLVED_STATUS' }, 'status') : null;
                lines.push(
                    `var ids = ${idList(a.ids, 'ids')};`,
                    'for (var i = 0; i < ids.length; i++) {',
                    '  var c = doc.pdfComments.itemByID(ids[i]);',
                    '  if (!c.isValid) throw new Error("No PDF comment with id " + ids[i]);',
                    status ? `  c.changeStatus(${status}, {});` : '  c.remove();',
                    '}',
                );
            }
            lines.push(
                'var out = [], all = doc.pdfComments;',
                `for (var j = 0; j < all.length && out.length < ${max}; j++) {`,
                '  var p = all[j], e = { id: p.id, type: __enumName(p.commentType), text: p.commentContent, reviewer: p.commentReviewer, status: __enumName(p.commentStatus), applied: p.commentIsApplied, orphan: p.commentIsOrphan, file: p.commentFilePath, replies: [] };',
                '  try { e.date = String(p.commentDate); } catch (x) {}',
                '  for (var r = 0; r < p.replies.length; r++) e.replies.push({ text: p.replies[r].replyContent, reviewer: p.replies[r].replyReviewer });',
                '  out.push(e);',
                '}',
                `__result__ = { total: all.length, comments: out${action === 'import' ? ', imported: imported' : ''} };`,
            );
            return run('PDF comments', script(lines.join('\n')));
        },
    },
];

