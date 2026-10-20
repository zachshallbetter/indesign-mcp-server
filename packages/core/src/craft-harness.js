/**
 * Unified ArtCraft Adapter Harness for Adobe MCP servers.
 *
 * Provides a standardized architecture for transparently adapting Adobe MCP
 * tools to corresponding Storytold / ArtCraft desktop applications
 * (PhotoCraft, VectorCraft, DesignCraft, EffectCraft, FilmCraft, etc.)
 * over loopback JSON-lines control channels.
 */
import { createControlClient } from './control-client.js';
import { formatResponse, formatErrorResponse } from './result.js';

/**
 * Determine the execution route between Adobe and ArtCraft.
 *
 * Priority:
 * 1. Explicit <PREFIX>_TARGET or ADOBE_TARGET ('adobe' | 'craft' | 'artcraft' | 'auto')
 * 2. Explicit <PREFIX>_BACKEND or ADOBE_BACKEND ('extendscript' | 'uxp' | 'craft' | 'artcraft' | 'auto')
 * 3. 'auto': probe Adobe and Craft availability; if Adobe is not available and Craft is reachable, route to Craft.
 *
 * @param {object} options
 * @param {string} options.appPrefix e.g. 'PHOTOCRAFT', 'VECTORCRAFT', 'DESIGNCRAFT'
 * @param {() => Promise<boolean>} [options.checkAdobeRunning]
 * @param {() => Promise<boolean>} [options.checkCraftAvailable]
 * @returns {Promise<'adobe' | 'craft'>}
 */
export async function resolveExecutionRoute({
    appPrefix,
    checkAdobeRunning,
    checkCraftAvailable,
} = {}) {
    const env = process.env;
    const prefix = appPrefix ? appPrefix.toUpperCase() : '';

    const targetVal = (env[`${prefix}_TARGET`] || env.ADOBE_TARGET || env.TARGET || '').toLowerCase().trim();
    if (targetVal === 'craft' || targetVal === 'artcraft' || targetVal === 'storytold') {
        return 'craft';
    }
    if (targetVal === 'adobe') {
        return 'adobe';
    }

    const backendVal = (env[`${prefix}_BACKEND`] || env.ADOBE_BACKEND || env.BACKEND || '').toLowerCase().trim();
    if (backendVal === 'craft' || backendVal === 'artcraft' || backendVal === 'storytold') {
        return 'craft';
    }
    if (backendVal && backendVal !== 'auto') {
        return 'adobe';
    }

    // Auto resolution: if craft is reachable and adobe is either not running or craft is explicitly prioritized
    if (env.ARTCRAFT_ENABLED === '1' || env.ARTCRAFT_ENABLED === 'true') {
        if (checkCraftAvailable && await checkCraftAvailable()) {
            return 'craft';
        }
    }

    if (checkAdobeRunning && checkCraftAvailable) {
        const adobeRunning = await checkAdobeRunning().catch(() => false);
        if (!adobeRunning) {
            const craftAvailable = await checkCraftAvailable().catch(() => false);
            if (craftAvailable) {
                return 'craft';
            }
        }
    }

    return 'adobe';
}

/**
 * Create an ArtCraft application harness.
 *
 * @param {object} config
 * @param {string} config.appName e.g. 'Photoshop', 'Illustrator', 'InDesign'
 * @param {string} config.craftName e.g. 'PhotoCraft', 'VectorCraft', 'DesignCraft'
 * @param {string} config.appPrefix e.g. 'PHOTOCRAFT', 'VECTORCRAFT', 'DESIGNCRAFT'
 * @param {number} config.defaultPort Default TCP loopback control port (e.g. 7878, 7979, 9877)
 * @param {Record<string, Function>} config.handlers Tool handlers mapping Adobe tools to Craft commands
 * @param {(client: ControlClient, probe: boolean) => Promise<object>} [config.inspectStatus] Custom status inspector
 * @returns {object} The harness with client, handlers, and routing factory
 */
export function createCraftHarness({
    appName,
    craftName,
    appPrefix,
    defaultPort,
    handlers = {},
    inspectStatus,
}) {
    const client = createControlClient({
        appPrefix,
        defaultPort,
    });

    /**
     * Resolve the route for an execution.
     * @param {() => Promise<boolean>} [checkAdobeRunning]
     */
    async function resolveRoute(checkAdobeRunning) {
        return resolveExecutionRoute({
            appPrefix,
            checkAdobeRunning,
            checkCraftAvailable: () => client.isAvailable(),
        });
    }

    /**
     * Standard status handler.
     */
    async function getStatus(args = {}, checkAdobeRunning) {
        const craftAvailable = await client.isAvailable();
        const route = await resolveRoute(checkAdobeRunning);

        let details = null;
        if (craftAvailable && args.probe !== false && inspectStatus) {
            try {
                details = await inspectStatus(client, args.probe !== false);
            } catch (err) {
                details = { error: err.message };
            }
        }

        return formatResponse({
            connected: craftAvailable,
            app: craftName,
            adobeEquivalent: appName,
            activeRoute: route,
            port: client.port,
            ...(details ? { [craftName.toLowerCase()]: details } : {}),
        }, `${craftName} Status`);
    }

    /**
     * Create routed tool handlers that automatically delegate between Adobe and Craft.
     *
     * @param {Record<string, Function>} adobeHandlers
     * @param {object} [options]
     * @param {() => Promise<boolean>} [options.checkAdobeRunning]
     * @returns {Record<string, Function>}
     */
    function createRoutedHandlers(adobeHandlers = {}, { checkAdobeRunning } = {}) {
        const routed = { ...adobeHandlers };

        for (const [name, craftHandler] of Object.entries(handlers)) {
            const adobeHandler = adobeHandlers[name];

            routed[name] = async (args) => {
                const route = await resolveRoute(checkAdobeRunning);

                if (route === 'craft') {
                    return craftHandler(args);
                }

                if (adobeHandler) {
                    try {
                        return await adobeHandler(args);
                    } catch (err) {
                        // Fall back to Craft if Adobe execution failed due to connection/process absence
                        const isMissing = /not running|not found|unreachable|connect|ECONNREFUSED/i.test(err.message || '');
                        if (isMissing && await client.isAvailable()) {
                            return craftHandler(args);
                        }
                        throw err;
                    }
                }

                return craftHandler(args);
            };
        }

        return routed;
    }

    return {
        appName,
        craftName,
        appPrefix,
        client,
        handlers,
        getStatus,
        resolveRoute,
        createRoutedHandlers,
    };
}
