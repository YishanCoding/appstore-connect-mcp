import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from './auth/index.js';
import { registerAppTools } from './apps/index.js';
import { registerBuildTools } from './builds/index.js';
import { registerTestFlightTools } from './testflight/index.js';
import { registerUserTools } from './users/index.js';

export function registerAllTools(server: McpServer) {
    registerAuthTools(server);
    registerAppTools(server);
    registerBuildTools(server);
    registerTestFlightTools(server);
    registerUserTools(server);
}