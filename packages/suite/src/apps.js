/**
 * The applications the suite can load, and which ones to load.
 *
 * Choose with --apps indesign,photoshop or ADOBE_MCP_APPS=indesign,photoshop.
 * Default: every application.
 */
export const APPS = {
    indesign: () => import('adobe-mcp-indesign'),
    illustrator: () => import('adobe-mcp-illustrator'),
    photoshop: () => import('adobe-mcp-photoshop'),
    aftereffects: () => import('adobe-mcp-aftereffects'),
    premiere: () => import('adobe-mcp-premiere'),
};

/** The app ids to load, from argv (--apps a,b or --apps=a,b) or the environment. */
export function selectedApps(argv = process.argv.slice(2), env = process.env) {
    let raw = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--apps') raw = argv[i + 1] ?? '';
        else if (argv[i].startsWith('--apps=')) raw = argv[i].slice('--apps='.length);
    }
    raw ??= env.ADOBE_MCP_APPS ?? null;
    if (raw === null || raw.trim() === '' || raw.trim() === 'all') return Object.keys(APPS);
    const ids = [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
    const unknown = ids.filter((id) => !(id in APPS));
    if (unknown.length) throw new Error(`Unknown app(s): ${unknown.join(', ')}. Available: ${Object.keys(APPS).join(', ')}`);
    return ids;
}

/** Load the chosen app modules: { indesign: app, illustrator: app, photoshop: app }. */
export async function loadApps(ids) {
    const out = {};
    for (const id of ids) out[id] = (await APPS[id]()).app;
    return out;
}
