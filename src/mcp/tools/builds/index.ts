import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListBuilds } from './list-builds.js';
import { registerGetBuild } from './get-build.js';
import { registerGetLatestBuild } from './get-latest-build.js';

export function registerBuildTools(server: McpServer) {
    registerListBuilds(server);
    registerGetBuild(server);
    registerGetLatestBuild(server);
}