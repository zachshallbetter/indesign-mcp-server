/**
 * Core script execution functionality
 * Cross-platform: Windows (COM) + macOS (AppleScript)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_WINDOWS = process.platform === 'win32';

// InDesign COM ProgID — пробуем по версии, падаем на generic
const INDESIGN_PROGIDS = [
    'InDesign.Application.2025',
    'InDesign.Application.2024',
    'InDesign.Application',
];

// ScriptLanguage.javascript = 1246973031
const JS_LANG_ID = 1246973031;

export class ScriptExecutor {

    // ─── macOS ────────────────────────────────────────────────────────────────

    static async executeAppleScript(script) {
        if (IS_WINDOWS) throw new Error('AppleScript unavailable on Windows');
        try {
            const result = execSync(`osascript -e '${script}'`, { encoding: 'utf8' });
            return result.trim();
        } catch (error) {
            throw new Error(`AppleScript execution failed: ${error.message}`);
        }
    }

    // ─── Windows ─────────────────────────────────────────────────────────────

    /**
     * Запускает ExtendScript через COM-объект InDesign (Windows).
     * Пишет скрипт во временный .jsx, вызывает DoScript через PowerShell.
     */
    static async executeWindowsCOM(script) {
        const tempScriptPath = path.join(os.tmpdir(), `indesign_${Date.now()}.jsx`);
        fs.writeFileSync(tempScriptPath, script, 'utf8');

        // Экранируем путь для PowerShell
        const escapedPath = tempScriptPath.replace(/\\/g, '\\\\');

        // Перебираем ProgID пока не найдём запущенный InDesign
        const psScript = `
$progIds = @(${INDESIGN_PROGIDS.map(id => `'${id}'`).join(',')})
$app = $null
foreach ($id in $progIds) {
    try {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject($id)
        break
    } catch {}
}
if ($null -eq $app) {
    Write-Error 'Adobe InDesign is not running. Please open InDesign first.'
    exit 1
}
try {
    $result = $app.DoScript('${escapedPath}', ${JS_LANG_ID})
    if ($null -ne $result) { Write-Output $result }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;

        try {
            const result = execSync(
                `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
                { encoding: 'utf8', timeout: 30000 }
            );
            return result.trim();
        } catch (error) {
            throw new Error(`COM execution failed: ${error.stderr || error.message}`);
        } finally {
            try { fs.unlinkSync(tempScriptPath); } catch (_) {}
        }
    }

    // ─── Универсальный метод ─────────────────────────────────────────────────

    static async executeInDesignScript(script) {
        try {
            if (IS_WINDOWS) {
                return await this.executeWindowsCOM(script);
            }

            // macOS: пишем jsx во временный файл, запускаем через AppleScript
            const tempScriptPath = path.join(__dirname, '../../temp_script.jsx');
            fs.writeFileSync(tempScriptPath, script);

            const appleScript = `
        tell application "Adobe InDesign 2025"
          activate
          do script POSIX file "${tempScriptPath}" language javascript
        end tell
      `;

            const result = await this.executeAppleScript(appleScript);

            try { fs.unlinkSync(tempScriptPath); } catch (_) {}

            return result;
        } catch (error) {
            throw new Error(`Error executing tool: ${error.message}`);
        }
    }
}
