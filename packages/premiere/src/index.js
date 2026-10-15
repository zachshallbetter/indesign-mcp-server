#!/usr/bin/env node
/**
 * Premiere Pro MCP server, over stdio. It also listens on 127.0.0.1
 * (PREMIERE_WS_PORT, default 3011) for the plugin inside Premiere Pro.
 */
import { createServer } from './server.js';

try {
    await createServer().run();
} catch (error) {
    // stderr only: stdout carries the protocol
    console.error('Failed to start server:', error);
    process.exit(1);
}
