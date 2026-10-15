#!/usr/bin/env node
/**
 * adobe-mcp-suite over stdio. Choose applications with --apps indesign,illustrator
 * or ADOBE_MCP_APPS; default all.
 */
import { createSuiteServer } from './server.js';

try {
    const suite = await createSuiteServer();
    await suite.run();
} catch (error) {
    // stderr only: stdout carries the protocol
    console.error('Failed to start server:', error.message);
    process.exit(1);
}
