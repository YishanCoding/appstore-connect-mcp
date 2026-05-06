import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetAnalyticsBySource } from './get-analytics-by-source.js';

export function registerAnalyticsTools(server: McpServer) {
    registerGetAnalyticsBySource(server);
}
