import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListBetaGroups } from './list-beta-groups.js';
import { registerAddBuildToBetaGroup } from './add-build-to-beta-group.js';
import { registerAddBetaTester } from './add-beta-tester.js';

export function registerTestFlightTools(server: McpServer) {
    registerListBetaGroups(server);
    registerAddBuildToBetaGroup(server);
    registerAddBetaTester(server);
}