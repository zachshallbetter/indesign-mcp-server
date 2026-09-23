/**
 * Core script execution for Adobe InDesign.
 * Cross-platform: macOS (AppleScript) and Windows (COM via PowerShell).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const IS_WINDOWS = process.platform === 'win32';

// Windows COM ProgIDs — newest first, then generic
const INDESIGN_PROGIDS = [
    'InDesign.Application.2026',
    'InDesign.Application.2025',
    'InDesign.Application.2024',
    'InDesign.Application.2023',
    'InDesign.Application',
];

// ScriptLanguage.javascript = 1246973031
const JS_LANG_ID = 1246973031;

export class ScriptExecutor {
    static _appName = null;

    /**
     * Resolve the installed / running InDesign application name (macOS).
     * Priority:
     *   1. INDESIGN_APP_NAME env override
     *   2. An InDesign process that is already running
     *   3. Newest "Adobe InDesign <year>.app" on disk
     *   4. Fallback default
     * Result is cached for the process lifetime.
     */
    static resolveAppName() {
        if (this._appName) return this._appName;

        if (process.env.INDESIGN_APP_NAME) {
            this._appName = process.env.INDESIGN_APP_NAME;
            return this._appName;
        }

        if (IS_WINDOWS) {
            this._appName = 'Adobe InDesign';
            return this._appName;
        }

        // Prefer an already-running instance
        try {
            const running = execSync(
                `osascript -e 'tell application "System Events" to get name of (processes whose name starts with "Adobe InDesign")'`,
                { encoding: 'utf8', timeout: 10000 }
            ).trim();
            if (running) {
                this._appName = running.split(',')[0].trim();
                return this._appName;
            }
        } catch {
            // System Events unavailable or nothing running
        }

        // Newest installed InDesign app bundle
        const candidates = [];
        const bases = ['/Applications', path.join(os.homedir(), 'Applications')];
        for (const base of bases) {
            let entries;
            try {
                entries = fs.readdirSync(base);
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (!/^Adobe InDesign/.test(entry)) continue;
                if (/\.app$/.test(entry)) {
                    candidates.push(entry.replace(/\.app$/, ''));
                    continue;
                }
                // Adobe often nests the .app inside a versioned folder
                try {
                    for (const inner of fs.readdirSync(path.join(base, entry))) {
                        if (/^Adobe InDesign.*\.app$/.test(inner)) {
                            candidates.push(inner.replace(/\.app$/, ''));
                        }
                    }
                } catch {
                    // not a directory / unreadable
                }
            }
        }

        if (candidates.length) {
            const ver = (n) => parseInt((n.match(/\d+/) || ['0'])[0], 10) || 0;
            candidates.sort((a, b) => ver(b) - ver(a));
            this._appName = candidates[0];
            return this._appName;
        }

        this._appName = 'Adobe InDesign 2025';
        return this._appName;
    }

    /**
     * Execute an AppleScript command (macOS only).
     * @param {string} script
     * @returns {Promise<string>}
     */
    static async executeAppleScript(script) {
        if (IS_WINDOWS) {
            throw new Error('AppleScript is unavailable on Windows');
        }
        try {
            const escaped = script.replace(/'/g, "'\"'\"'");
            const result = execSync(`osascript -e '${escaped}'`, {
                encoding: 'utf8',
                timeout: 120000,
            });
            return result.trim();
        } catch (error) {
            throw new Error(`AppleScript execution failed: ${error.message}`);
        }
    }

    /**
     * Run ExtendScript through InDesign COM on Windows via PowerShell.
     * New-Object attaches to a running instance or launches InDesign.
     * @param {string} script
     * @returns {Promise<string>}
     */
    static async executeWindowsCOM(script) {
        const tempScriptPath = path.join(os.tmpdir(), `indesign_${Date.now()}.jsx`);
        fs.writeFileSync(tempScriptPath, script, 'utf8');

        const escapedPath = tempScriptPath.replace(/'/g, "''");
        const progIdList = INDESIGN_PROGIDS.map((id) => `'${id}'`).join(',');

        const psScript = [
            `$progIds = @(${progIdList})`,
            '$app = $null',
            'foreach ($id in $progIds) {',
            '  try { $app = New-Object -ComObject $id; break } catch {}',
            '}',
            'if ($null -eq $app) { Write-Error "Adobe InDesign not found. Check installation."; exit 1 }',
            'try {',
            `  $result = $app.DoScript('${escapedPath}', ${JS_LANG_ID})`,
            '  if ($null -ne $result) { Write-Output $result }',
            '} catch {',
            '  Write-Error $_.Exception.Message',
            '  exit 1',
            '}',
        ].join('; ');

        try {
            const result = execSync(
                `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ${JSON.stringify(psScript)}`,
                { encoding: 'utf8', timeout: 120000 }
            );
            return result.trim();
        } catch (error) {
            const detail = error.stderr || error.message;
            throw new Error(`COM execution failed: ${detail}`);
        } finally {
            try {
                fs.unlinkSync(tempScriptPath);
            } catch {
                // ignore cleanup errors
            }
        }
    }

    /**
     * Execute an ExtendScript against InDesign on the current platform.
     * @param {string} script
     * @returns {Promise<string>}
     */
    static async executeInDesignScript(script) {
        try {
            if (IS_WINDOWS) {
                return await this.executeWindowsCOM(script);
            }

            const tempScriptPath = path.join(os.tmpdir(), `indesign_${Date.now()}.jsx`);
            fs.writeFileSync(tempScriptPath, script, 'utf8');

            try {
                const appName = this.resolveAppName();
                const posixPath = tempScriptPath.replace(/\\/g, '/');
                const appleScript = `
        tell application "${appName}"
          activate
          do script POSIX file "${posixPath}" language javascript
        end tell
      `;
                return await this.executeAppleScript(appleScript);
            } finally {
                try {
                    fs.unlinkSync(tempScriptPath);
                } catch {
                    // ignore cleanup errors
                }
            }
        } catch (error) {
            throw new Error(`Error executing tool: ${error.message}`);
        }
    }
}
