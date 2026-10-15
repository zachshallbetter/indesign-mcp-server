/**
 * Collaboration: Team Projects stored in Creative Cloud, through the Project
 * object's team project methods. They need a Creative Cloud sign-in with Team
 * Projects available.
 */
import path from 'node:path';
import { str, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { paths } from './project.js';

const ACTIONS = ['status', 'list', 'create', 'open', 'share', 'get_latest', 'resolve', 'convert', 'close'];
const RESOLVE = { accept_theirs: 'ACCEPT_THEIRS', accept_theirs_and_copy: 'ACCEPT_THEIRS_AND_COPY', accept_yours: 'ACCEPT_YOURS' };

export const tools = [
    {
        name: 'manage_team_project',
        description: 'Work with Team Projects (File > Team Project): check sign-in and status, list team projects, create or open one, share your changes with a comment, get the latest changes, resolve conflicts, convert the open team project to a local .aep, or close it. Needs a Creative Cloud sign-in with Team Projects available',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ACTIONS, description: 'What to do; status reports sign-in and which commands are available' },
                name: { type: 'string', description: 'create, open: the team project name' },
                description: { type: 'string', description: 'create: a description' },
                comment: { type: 'string', description: 'share: a comment for collaborators' },
                resolution: { type: 'string', enum: Object.keys(RESOLVE), description: 'resolve: keep the shared version, keep it and a copy of yours, or keep yours' },
                file: { type: 'string', description: 'convert: absolute path of the .aep or .aet to write' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'convert', file: `${process.env.HOME ?? '/tmp'}/Documents/team.aep` },
        hints: { destructive: true, openWorld: true },
        features: [
            'aftereffects.collaboration.team_projects',
            'aftereffects.collaboration.team_project_status',
            'aftereffects.collaboration.new_team_project',
            'aftereffects.collaboration.open_team_project',
            'aftereffects.collaboration.share_my_changes',
            'aftereffects.collaboration.get_latest_changes',
            'aftereffects.collaboration.resolve_conflicts',
            'aftereffects.collaboration.convert_team_project_to_project',
        ],
        handler: (a) => {
            const action = enumOf(a.action, ACTIONS, { name: 'action' });
            const needName = () => {
                if (!a.name) throw new Error(`${action} needs name`);
                return str(a.name);
            };
            let body = '';
            if (action === 'list') body = 'out.teamProjects = proj.listTeamProjects();';
            else if (action === 'create') body = `ok = proj.newTeamProject(${needName()}, ${str(a.description ?? '')});`;
            else if (action === 'open') body = `ok = proj.openTeamProject(${needName()});`;
            else if (action === 'share') body = 'if (!proj.isShareCommandEnabled()) throw new Error("Nothing to share, or no team project is open"); ' + `ok = proj.shareTeamProject(${str(a.comment ?? '')});`;
            else if (action === 'get_latest') body = 'if (!proj.isSyncCommandEnabled()) throw new Error("No changes to get, or no team project is open"); ok = proj.syncTeamProject();';
            else if (action === 'resolve') {
                if (a.resolution === undefined) throw new Error('resolve needs resolution');
                body = 'if (!proj.isResolveCommandEnabled()) throw new Error("There are no conflicts to resolve"); ' + `ok = proj.resolveConflict(ResolveType.${RESOLVE[enumOf(a.resolution, Object.keys(RESOLVE), { name: 'resolution' })]});`;
            } else if (action === 'convert') {
                if (!a.file) throw new Error('convert needs file');
                const file = paths.validate(a.file);
                if (!['.aep', '.aet'].includes(path.extname(file).toLowerCase())) throw new Error('file must end in .aep or .aet');
                body = `if (!proj.isAnyTeamProjectOpen()) throw new Error("No team project is open"); ok = proj.convertTeamProjectToProject(new File(${jsxPath(file)}));`;
            } else if (action === 'close') body = 'if (!proj.isAnyTeamProjectOpen()) throw new Error("No team project is open"); ok = proj.closeTeamProject();';
            const signIn = action === 'status' ? '' : 'if (!proj.isLoggedInToTeamProject()) throw new Error("Not signed in to Team Projects: sign in to Creative Cloud in After Effects");';
            return run('Team project', script(`
var out = { action: ${str(action)} }, ok = null;
${signIn}
${body}
if (ok === false) throw new Error("After Effects could not ${action.replace('_', ' ')} the team project");
out.ok = ok;
out.enabled = proj.isTeamProjectEnabled(); out.signedIn = proj.isLoggedInToTeamProject(); out.open = proj.isAnyTeamProjectOpen();
${a.name ? `out.namedOpen = proj.isTeamProjectOpen(${str(a.name)});` : ''}
out.canShare = proj.isShareCommandEnabled(); out.canGetLatest = proj.isSyncCommandEnabled(); out.canResolve = proj.isResolveCommandEnabled();
__result__ = out;`));
        },
    },
];
