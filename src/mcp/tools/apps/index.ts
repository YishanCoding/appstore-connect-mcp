import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListApps } from './list-apps.js';
import { registerGetApp } from './get-app.js';

export function registerAppTools(server: McpServer) {
    registerListApps(server);
    registerGetApp(server);
}