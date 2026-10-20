import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createCraftHarness, resolveExecutionRoute } from '../src/craft-harness.js';

describe('ArtCraft Adapter Harness', () => {
    it('resolves route based on environment variables', async () => {
        const origEnv = { ...process.env };
        try {
            process.env.TEST_TARGET = 'craft';
            let route = await resolveExecutionRoute({ appPrefix: 'TEST' });
            assert.equal(route, 'craft');

            process.env.TEST_TARGET = 'adobe';
            route = await resolveExecutionRoute({ appPrefix: 'TEST' });
            assert.equal(route, 'adobe');

            delete process.env.TEST_TARGET;
            process.env.ADOBE_TARGET = 'craft';
            route = await resolveExecutionRoute({ appPrefix: 'TEST' });
            assert.equal(route, 'craft');
        } finally {
            process.env = origEnv;
        }
    });

    it('falls back to craft when adobe is not running and craft is available', async () => {
        const origEnv = { ...process.env };
        try {
            delete process.env.TEST_TARGET;
            delete process.env.ADOBE_TARGET;

            const route = await resolveExecutionRoute({
                appPrefix: 'TEST',
                checkAdobeRunning: async () => false,
                checkCraftAvailable: async () => true,
            });
            assert.equal(route, 'craft');
        } finally {
            process.env = origEnv;
        }
    });

    it('creates routed handlers that delegate appropriately', async () => {
        const harness = createCraftHarness({
            appName: 'DummyAdobe',
            craftName: 'DummyCraft',
            appPrefix: 'DUMMYCRAFT',
            defaultPort: 9991,
            handlers: {
                test_tool: async (args) => ({ content: [{ type: 'text', text: `Craft handled ${args.value}` }] }),
            },
        });

        const adobeHandlers = {
            test_tool: async (args) => ({ content: [{ type: 'text', text: `Adobe handled ${args.value}` }] }),
            adobe_only: async (args) => ({ content: [{ type: 'text', text: `Adobe only ${args.value}` }] }),
        };

        const origEnv = { ...process.env };
        try {
            // Force craft route
            process.env.DUMMYCRAFT_TARGET = 'craft';
            const routed = harness.createRoutedHandlers(adobeHandlers);

            const resCraft = await routed.test_tool({ value: 'hello' });
            assert.equal(resCraft.content[0].text, 'Craft handled hello');

            // Force adobe route
            process.env.DUMMYCRAFT_TARGET = 'adobe';
            const resAdobe = await routed.test_tool({ value: 'hello' });
            assert.equal(resAdobe.content[0].text, 'Adobe handled hello');

            const resOnly = await routed.adobe_only({ value: '123' });
            assert.equal(resOnly.content[0].text, 'Adobe only 123');
        } finally {
            process.env = origEnv;
        }
    });
});
