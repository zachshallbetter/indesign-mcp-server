/**
 * File path policy for scripts that read or write files.
 *
 * Every path a tool hands to the application must resolve inside the user's
 * home folder or a directory listed in the server's allowed-dirs variable
 * (e.g. INDESIGN_ALLOWED_DIRS), and never inside a system directory.
 */
import path from 'node:path';
import os from 'node:os';
import { str } from './jsx.js';

/**
 * Directories file operations are confined to: home plus the directories in
 * `envVar`. Split on path.delimiter (';' on Windows) so drive letters stay intact.
 * @param {string} envVar e.g. 'ILLUSTRATOR_ALLOWED_DIRS'
 */
export function buildAllowedDirs(envVar) {
    const dirs = [os.homedir()];
    const fromEnv = envVar ? process.env[envVar] : undefined;
    if (fromEnv) {
        for (const d of fromEnv.split(path.delimiter)) {
            const trimmed = d.trim();
            if (trimmed) dirs.push(trimmed);
        }
    }
    return dirs.map((d) => path.resolve(d));
}

const WIN_FORBIDDEN = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
];
const POSIX_FORBIDDEN = ['/etc', '/System', '/usr', '/bin', '/sbin', '/Library'];

/**
 * Resolve `filePath` and check it against the allowed directories and the
 * platform's system directories. Case-insensitive on Windows. Returns the
 * resolved path; throws with a message naming the allowed directories.
 */
export function validateFilePath(filePath, allowedDirs) {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path.');
    }

    if (process.platform === 'win32' && /:[^\\/]/.test(filePath.slice(2))) {
        throw new Error(`Invalid path (alternate data stream suspected): ${filePath}`);
    }

    const resolved = path.resolve(filePath);
    const cmp = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;

    const inAllowed = allowedDirs.some((dir) => {
        const d = cmp(path.resolve(dir));
        const r = cmp(resolved);
        return r === d || r.startsWith(d + path.sep);
    });
    if (!inAllowed) {
        throw new Error(
            `Access denied: '${filePath}' is outside the allowed directories (${allowedDirs.join(', ')}).`
        );
    }

    const forbidden = process.platform === 'win32' ? WIN_FORBIDDEN : POSIX_FORBIDDEN;
    const hit = forbidden.some((f) => {
        const d = cmp(path.resolve(f));
        const r = cmp(resolved);
        return r === d || r.startsWith(d + path.sep);
    });
    if (hit) {
        throw new Error(`Access denied: system directory '${resolved}'.`);
    }

    return resolved;
}

/** Path for ExtendScript File(): forward slashes, safe as a literal. */
export function jsxPath(resolvedPath) {
    return str(String(resolvedPath).replace(/\\/g, '/'));
}

/**
 * A path policy bound to one server's environment variable.
 * @param {{ envVar: string }} opts
 */
export function createPathPolicy({ envVar }) {
    return {
        envVar,
        allowedDirs: () => buildAllowedDirs(envVar),
        validate: (filePath) => validateFilePath(filePath, buildAllowedDirs(envVar)),
        jsxPath,
    };
}
