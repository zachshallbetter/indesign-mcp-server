#!/usr/bin/env node
/**
 * After Effects MCP server, over stdio.
 */
import { createServer } from './server.js';

try {
    await createServer().run();
} catch (error) {
    // stderr only: stdout carries the protocol
    console.error('Failed to start server:', error);
    process.exit(1);
}
