#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './mcp/tools/index.js';

const server = new McpServer({
    name: 'appstore-connect-mcp',
    version: '1.0.1',
});

registerAllTools(server);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('App Store Connect MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});