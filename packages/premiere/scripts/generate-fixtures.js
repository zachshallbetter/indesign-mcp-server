#!/usr/bin/env node
/**
 * Regenerate the test fixtures from the capability atlas.
 *
 *   node scripts/generate-fixtures.js --atlas <atlas checkout> --reference <uxp-premiere-pro checkout>
 *
 * tests/fixtures/feature-ids.json
 *   Every Premiere Pro feature id in the atlas (corpus/premiere/features/*.json).
 *   A tool may claim only these.
 *
 * tests/fixtures/premiere-uxp-api.json
 *   The UXP Premiere DOM (require("premierepro")): classes, their properties,
 *   static and instance methods with the version that introduced each, and
 *   the Constants enums. The class list comes from the atlas
 *   (corpus/premiere/surfaces/uxp.json). The atlas records name every class
 *   but list only some members (those without an ExtendScript namesake), so
 *   the member lists are read from the reference pages the atlas cites:
 *   AdobeDocs/uxp-premiere-pro, src/pages/ppro-reference, at the commit the
 *   atlas records (55a2a2d). The script stops if the two disagree: a class in
 *   one and not the other, a member the atlas names that the reference lacks,
 *   or a different count of properties or methods.
 *
 * To get the reference pages:
 *   git clone https://github.com/AdobeDocs/uxp-premiere-pro
 *   git -C uxp-premiere-pro checkout 55a2a2d3eb0c4a2453eb9d38e8d067f851fa6b6e
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REFERENCE_COMMIT = '55a2a2d3eb0c4a2453eb9d38e8d067f851fa6b6e';

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : null;
}

/** Parse one class page: { name, since, constructorSince, properties, static, instance }. */
export function parseClassPage(text) {
    const name = /^# (.+)$/m.exec(text)?.[1]?.trim();
    const since = /Since: \*\*([\d.]+)\*\*/.exec(text)?.[1] ?? null;
    const out = { name, since, constructorSince: null, properties: {}, static: {}, instance: {} };
    for (const section of text.split(/\n## /).slice(1)) {
        const title = section.split('\n')[0].trim();
        if (title === 'Constructor') {
            out.constructorSince = /Since: \*\*([\d.]+)\*\*/.exec(section)?.[1] ?? since;
        } else if (title === 'Properties') {
            for (const row of section.split('\n')) {
                const cells = row.split(/(?<!\\)\|/).map((c) => c.trim());
                if (cells.length < 6 || !/^[A-Za-z_]\w*$/.test(cells[1]) || cells[1] === 'Name') continue;
                out.properties[cells[1]] = cells[4] || since;
            }
        } else if (/^(Static|Instance) Methods$/.test(title)) {
            const target = title.startsWith('Static') ? out.static : out.instance;
            for (const method of section.split(/\n### /).slice(1)) {
                const m = method.split('\n')[0].trim();
                if (!/^[A-Za-z_]\w*$/.test(m)) continue;
                target[m] = /Since: \*\*([\d.]+)\*\*/.exec(method)?.[1] ?? since;
            }
        }
    }
    return out;
}

/** Parse the constants page: { EnumName: [VALUE, ...] }. */
export function parseConstants(text) {
    const out = {};
    for (const section of text.split(/\n### /).slice(1)) {
        const name = section.split('\n')[0].trim();
        if (!/^[A-Z]\w*$/.test(name)) continue;
        out[name] = [...section.matchAll(/^\| ([A-Z][A-Z0-9_]*) \|/gm)].map((m) => m[1]);
    }
    return out;
}

function fail(problems) {
    for (const p of problems) console.error(p);
    process.exit(1);
}

function main() {
    const atlas = arg('atlas');
    const reference = arg('reference');
    if (!atlas || !reference) {
        console.error('usage: node scripts/generate-fixtures.js --atlas <atlas checkout> --reference <uxp-premiere-pro checkout>');
        process.exit(1);
    }
    const corpus = path.join(atlas, 'corpus', 'premiere');
    const fixtures = new URL('../tests/fixtures/', import.meta.url);

    // Feature ids.
    const ids = [];
    for (const f of readdirSync(path.join(corpus, 'features')).filter((n) => n.endsWith('.json') && n !== 'taxonomy.json').sort()) {
        for (const r of JSON.parse(readFileSync(path.join(corpus, 'features', f), 'utf8'))) ids.push(r.id);
    }
    ids.sort();
    writeFileSync(new URL('feature-ids.json', fixtures), `${JSON.stringify({
        note: 'Premiere Pro feature ids from the capability atlas (corpus/premiere/features). A tool may claim only ids listed here.',
        ids,
    }, null, 0).replace(/^\{"note":(".*?"),"ids":\[/, '{\n"note": $1,\n"ids": [\n').replace(/","/g, '",\n"').replace(/"\]\}$/, '"\n]\n}')}\n`);

    // UXP classes.
    const surface = JSON.parse(readFileSync(path.join(corpus, 'surfaces', 'uxp.json'), 'utf8'));
    const atlasClasses = surface.filter((r) => r.kind === 'class');
    const pages = path.join(reference, 'src', 'pages', 'ppro-reference');
    const parsed = new Map();
    for (const f of readdirSync(path.join(pages, 'classes')).filter((n) => n.endsWith('.md') && n !== 'index.md')) {
        const c = parseClassPage(readFileSync(path.join(pages, 'classes', f), 'utf8'));
        parsed.set(c.name, c);
    }

    const problems = [];
    for (const name of parsed.keys()) if (!atlasClasses.some((r) => r.name === name)) problems.push(`reference class ${name} is not in the atlas`);
    const classes = {};
    for (const r of atlasClasses.sort((a, b) => a.name.localeCompare(b.name))) {
        const c = parsed.get(r.name);
        if (!c) { problems.push(`atlas class ${r.name} has no reference page`); continue; }
        if (c.since !== r.since) problems.push(`${r.name}: atlas since ${r.since}, reference ${c.since}`);
        const counts = /(\d+) propert(?:y|ies) and (\d+) methods? documented/.exec(r.summary);
        const methods = Object.keys(c.static).length + Object.keys(c.instance).length;
        if (counts && (Number(counts[1]) !== Object.keys(c.properties).length || Number(counts[2]) !== methods)) {
            problems.push(`${r.name}: atlas counts ${counts[1]} properties / ${counts[2]} methods, reference ${Object.keys(c.properties).length} / ${methods}`);
        }
        const named = /Methods with no same-named ExtendScript member: ([^.]+)\./.exec(r.notes ?? '');
        const atlasMembers = named ? [...new Set(named[1].split(',').map((s) => s.trim()))] : [];
        for (const m of atlasMembers) if (!(m in c.static) && !(m in c.instance)) problems.push(`${r.name}: atlas names ${m}, the reference does not`);
        classes[r.name] = {
            since: c.since,
            ...(c.constructorSince ? { constructorSince: c.constructorSince } : {}),
            properties: c.properties,
            static: c.static,
            instance: c.instance,
            atlasMembers,
        };
    }
    if (problems.length) fail(problems);

    const constants = parseConstants(readFileSync(path.join(pages, 'constants', 'index.md'), 'utf8'));
    writeFileSync(new URL('premiere-uxp-api.json', fixtures), `${JSON.stringify({
        note: 'The UXP Premiere DOM, require("premierepro"), for the static script audit. Names and minimum versions only. '
            + 'Classes: the capability atlas (corpus/premiere/surfaces/uxp.json). Members and constants: the reference pages the atlas cites, '
            + `AdobeDocs/uxp-premiere-pro src/pages/ppro-reference at ${REFERENCE_COMMIT.slice(0, 7)} (Apache-2.0); atlasMembers lists the members the atlas names itself.`,
        source: { atlas: 'corpus/premiere/surfaces/uxp.json', reference: `https://github.com/AdobeDocs/uxp-premiere-pro/tree/${REFERENCE_COMMIT}/src/pages/ppro-reference` },
        classes,
        constants,
    }, null, 1)}\n`);
    console.log(`${ids.length} feature ids, ${Object.keys(classes).length} classes, ${Object.keys(constants).length} enums`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
