import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from './auth/index.js';
import { registerAppTools } from './apps/index.js';
import { registerBuildTools } from './builds/index.js';
import { registerTestFlightTools } from './testflight/index.js';
import { registerUserTools } from './users/index.js';
import { registerMetadataTools } from './metadata/index.js';
import { registerVersionTools } from './versions/index.js';
import { registerReviewTools } from './reviews/index.js';
import { registerAnalyticsTools } from './analytics/index.js';
import { registerCppTools } from './cpp/index.js';
import { registerEventsTools } from './events/index.js';

export function registerAllTools(server: McpServer) {
    registerAuthTools(server);
    registerAppTools(server);
    registerBuildTools(server);
    registerTestFlightTools(server);
    registerUserTools(server);
    registerMetadataTools(server);
    registerVersionTools(server);
    registerReviewTools(server);
    registerAnalyticsTools(server);
    registerCppTools(server);
    registerEventsTools(server);
}
