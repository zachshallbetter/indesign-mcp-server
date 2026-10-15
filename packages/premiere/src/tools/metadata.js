/**
 * Metadata of project items: the Project panel's project metadata and the
 * XMP metadata stored with the media (as in the Metadata panel).
 */
import { json, str } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ITEM_SCHEMA, itemSpec } from '../args.js';

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
];
