import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetAnalyticsBySource } from './get-analytics-by-source.js';
import { registerExportFullHistory } from './export-full-history.js';

export function registerAnalyticsTools(server: McpServer) {
    registerGetAnalyticsBySource(server);
    registerExportFullHistory(server);
}
