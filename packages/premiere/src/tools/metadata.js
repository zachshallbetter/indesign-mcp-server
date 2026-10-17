/**
 * Metadata of project items: the Project panel's project metadata and the
 * XMP metadata stored with the media (as in the Metadata panel); and the
 * Project panel's Metadata Display: its column layout and the project
 * metadata schema.
 */
import { json, str, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ITEM_SCHEMA, itemSpec } from '../args.js';

const METADATA_TYPES = ['text', 'integer', 'real', 'boolean'];

export const tools = [
    {
        name: 'get_metadata',
        description: 'Read a project item\'s metadata: the project metadata (Project panel columns, as XML) and the XMP metadata (as an XMP packet)',
        inputSchema: {
            type: 'object',
            properties: {
                item: ITEM_SCHEMA,
                kind: { type: 'string', enum: ['project', 'xmp', 'both'], description: 'Default both', default: 'both' },
            },
            required: ['item'],
        },
        auditArgs: { item: { path: 'Footage/a.mov' } },
        hints: { readOnly: true },
        features: ['premiere.projects.project_metadata', 'premiere.projects.xmp_metadata', 'premiere.projects.metadata_panel'],
        handler: (a) => {
            const kind = a.kind ?? 'both';
            if (!['project', 'xmp', 'both'].includes(kind)) throw new Error("'kind' must be project, xmp or both");
            return run('Get metadata', script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const out = { item: entry.path };
${kind !== 'xmp' ? 'out.project = await ppro.Metadata.getProjectMetadata(entry.item);' : ''}
${kind !== 'project' ? 'out.xmp = await ppro.Metadata.getXMPMetadata(entry.item);' : ''}
return out;`));
        },
    },
    {
        name: 'set_metadata',
        description: 'Write a project item\'s XMP metadata (a whole XMP packet, usually get_metadata\'s with your changes) or project metadata (XML, with the names of the fields that changed). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                item: ITEM_SCHEMA,
                xmp: { type: 'string', description: 'The full XMP packet to store' },
                projectMetadata: { type: 'string', description: 'Project metadata XML' },
                fields: { type: 'array', items: { type: 'string' }, description: 'With projectMetadata: the field names that changed' },
            },
            required: ['item'],
        },
        auditArgs: { item: { path: 'Footage/a.mov' }, xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>', projectMetadata: '<?xml version="1.0"?><PremierePrData/>', fields: ['Column.Intrinsic.Name'] },
        hints: { idempotent: true },
        features: ['premiere.projects.xmp_metadata', 'premiere.projects.project_metadata', 'premiere.projects.metadata_panel'],
        handler: (a) => {
            if (a.xmp === undefined && a.projectMetadata === undefined) throw new Error('Nothing to write: give xmp or projectMetadata');
            if (a.projectMetadata !== undefined && (!Array.isArray(a.fields) || !a.fields.length)) throw new Error("projectMetadata needs 'fields': the names of the fields that changed");
            return run('Set metadata', script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
transact(project, "Set metadata", (add) => {
  ${a.xmp !== undefined ? `add(ppro.Metadata.createSetXMPMetadataAction(entry.item, ${str(a.xmp)}));` : ''}
  ${a.projectMetadata !== undefined ? `add(ppro.Metadata.createSetProjectMetadataAction(entry.item, ${str(a.projectMetadata)}, ${json(a.fields.map(String))}));` : ''}
});
return { item: entry.path, xmp: ${a.xmp !== undefined}, projectMetadata: ${a.projectMetadata !== undefined} };`));
        },
    },
    {
        name: 'get_metadata_display',
        description: 'Read the Project panel\'s column layout (Metadata Display: which metadata fields show as List view columns, in what order and width), as Premiere Pro\'s XML',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['premiere.projects.list_view_columns', 'premiere.projects.project_panel'],
        handler: () => run('Get metadata display', script(`
await __project();
return { panelMetadata: await ppro.Metadata.getProjectPanelMetadata() };`)),
    },
    {
        name: 'set_metadata_display',
        description: 'Change the Project panel\'s Metadata Display: add fields to the project metadata schema (they become available as columns), and/or set the column layout from XML (usually get_metadata_display\'s with your changes). Not undoable',
        inputSchema: {
            type: 'object',
            properties: {
                addFields: {
                    type: 'array',
                    maxItems: 100,
                    description: 'Fields to add to the project metadata schema',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Field id, letters, digits and underscores' },
                            label: { type: 'string', description: 'Label shown in the Project panel and the Metadata panel' },
                            type: { type: 'string', enum: METADATA_TYPES, description: 'Value type. Default text', default: 'text' },
                        },
                        required: ['name', 'label'],
                    },
                },
                panelMetadata: { type: 'string', description: 'The column layout XML to apply' },
            },
        },
        auditArgs: { addFields: [{ name: 'Shot_Number', label: 'Shot Number', type: 'integer' }], panelMetadata: '<?xml version="1.0"?><PremiereData/>' },
        features: ['premiere.projects.metadata_schema', 'premiere.projects.list_view_columns', 'premiere.projects.project_panel'],
        handler: (a) => {
            if (a.addFields !== undefined && !Array.isArray(a.addFields)) throw new Error("'addFields' must be a list");
            const fields = (a.addFields ?? []).map((f, i) => {
                if (!f || typeof f.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(f.name)) throw new Error(`'addFields[${i}].name' must be letters, digits and underscores, starting with a letter`);
                if (typeof f.label !== 'string' || !f.label.trim()) throw new Error(`'addFields[${i}].label' is empty`);
                const type = enumOf(f.type ?? 'text', METADATA_TYPES, { name: `addFields[${i}].type` });
                return `if (!(await ppro.Metadata.addPropertyToProjectMetadataSchema(${str(f.name)}, ${str(f.label)}, __C.MetadataType.${type.toUpperCase()}))) throw new Error(${str(`Premiere Pro did not add the field ${f.name}`)});
added.push(${str(f.name)});`;
            });
            if (a.panelMetadata !== undefined && (typeof a.panelMetadata !== 'string' || !a.panelMetadata.trim())) throw new Error("'panelMetadata' is empty");
            if (!fields.length && a.panelMetadata === undefined) throw new Error('Nothing to change: give addFields or panelMetadata');
            return run('Set metadata display', script(`
await __project();
const added = [];
${fields.join('\n')}
${a.panelMetadata !== undefined ? `if (!(await ppro.Metadata.setProjectPanelMetadata(${str(a.panelMetadata)}))) throw new Error("Premiere Pro did not apply the column layout");` : ''}
return { addedFields: added, panelMetadata: ${a.panelMetadata !== undefined} };`));
        },
    },
];
