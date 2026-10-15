/**
 * Runs scripts from the MCP server inside Premiere Pro.
 *
 * A script is UXP JavaScript: the body of an async function. It runs with
 *   ppro      require("premierepro")
 *   transact  transact(project, undoName, build)
 * in scope, and its return value is sent back, made JSON-safe.
 *
 * transact is how scripts edit. From Premiere Pro 26.3, Actions must be
 * created inside project.lockedAccess and run with project.executeTransaction;
 * transact does both: inside the lock it calls build(add), where add(action)
 * collects each Action, then runs them all in one transaction named undoName,
 * which is one step in Edit > Undo. It returns how many actions ran and throws
 * if build throws or Premiere Pro refuses the transaction.
 *
 * Scripts run one at a time, in arrival order: a script that is still running
 * when the server gives up on it keeps the next one waiting, so two scripts
 * never edit the project at once.
 *
 * Plain CommonJS with no UXP imports, so tests can load it in a Node vm.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** A value the WebSocket can carry: JSON types only, cycles and functions dropped. */
function serializeResult(value) {
    if (value === undefined) return null;
    const seen = new WeakSet();
    try {
        return JSON.parse(JSON.stringify(value, (key, v) => {
            if (typeof v === 'bigint') return String(v);
            if (typeof v === 'function' || typeof v === 'symbol') return undefined;
            if (v && typeof v === 'object') {
                if (seen.has(v)) return undefined;
                seen.add(v);
            }
            return v;
        }));
    } catch (e) {
        return String(value);
    }
}

function createRuntime({ ppro, log = () => {} }) {
    function transact(project, undoName, build) {
        if (!project || typeof project.lockedAccess !== 'function' || typeof project.executeTransaction !== 'function') {
            throw new Error('transact needs a Project (from ppro.Project.getActiveProject())');
        }
        if (typeof build !== 'function') throw new Error('transact needs a build(add) function');
        const name = String(undoName || 'Edit');
        let count = 0;
        let applied = true;
        let failure = null;
        project.lockedAccess(() => {
            try {
                const actions = [];
                build((action) => {
                    if (!action) throw new Error(`Premiere Pro could not prepare part of "${name}"`);
                    actions.push(action);
                });
                count = actions.length;
                if (!count) return;
                applied = project.executeTransaction((compound) => {
                    for (const action of actions) compound.addAction(action);
                }, name);
            } catch (e) {
                failure = e;
            }
        });
        if (failure) throw failure;
        if (count && applied === false) throw new Error(`Premiere Pro did not apply "${name}"`);
        return count;
    }

    async function execute(code) {
        if (typeof code !== 'string' || !code.trim()) throw new Error('No script to run');
        const fn = new AsyncFunction('ppro', 'transact', code);
        return fn(ppro, transact);
    }

    let chain = Promise.resolve();

    /** Bridge protocol: { type: 'ping' | 'execute', id, code } in; pong, result or error out. */
    function handleMessage(msg, send) {
        if (!msg || typeof msg !== 'object') return chain;
        if (msg.type === 'ping') {
            send(JSON.stringify({ type: 'pong', id: msg.id }));
            return chain;
        }
        if (msg.type !== 'execute') return chain;
        chain = chain.then(async () => {
            const started = Date.now();
            try {
                const result = await execute(msg.code);
                send(JSON.stringify({ type: 'result', id: msg.id, result: serializeResult(result) }));
            } catch (e) {
                send(JSON.stringify({ type: 'error', id: msg.id, error: (e && e.message) || String(e) }));
            }
            log(`script ${msg.id} took ${Date.now() - started} ms`);
        });
        return chain;
    }

    return { execute, transact, handleMessage };
}

module.exports = { createRuntime, serializeResult };
