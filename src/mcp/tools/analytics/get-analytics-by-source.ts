import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AnalyticsManager } from '../../../programs/analytics/index.js';

const inputSchema = z.object({
    adamId: z
        .string()
        .describe('App Adam ID (numeric string), e.g. "6754280964"'),
    startDate: z
        .string()
        .describe('Start date in YYYY-MM-DD format'),
    endDate: z
        .string()
        .describe('End date in YYYY-MM-DD format'),
    frequency: z
        .enum(['DAY', 'WEEK', 'MONTH'])
        .default('DAY')
        .describe('Data granularity: DAY (default), WEEK, or MONTH'),
    outputFormat: z
        .enum(['text', 'json'])
        .default('text')
        .describe('Output format: "text" returns a markdown table, "json" returns raw data'),
});

export function registerGetAnalyticsBySource(server: McpServer) {
    server.registerTool(
        'appstore_get_analytics_by_source',
        {
            description:
                'Get App Store analytics data broken down by source type (App Store Search, App Store Browse, App Referrer, Web Referrer). ' +
                'Returns impressions, product page views, first-time downloads, redownloads, total downloads, and conversion rate per source. ' +
                'Requires an active App Store Connect session in the browser (opencli must be installed and ASC must be accessible). ' +
                'Uses the internal ASC Analytics API — not the official public API.',
            inputSchema,
        },
        async ({ adamId, startDate, endDate, frequency, outputFormat }) => {
            try {
                const manager = new AnalyticsManager();
                const result = await manager.getBySourceType(adamId, startDate, endDate, frequency);

                const text =
                    outputFormat === 'json'
                        ? JSON.stringify(result, null, 2)
                        : manager.formatAsText(result);

                return {
                    content: [{ type: 'text' as const, text }],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify(
                                {
                                    error: error.message,
                                    hint: 'Make sure opencli is installed, the browser is open, and you are logged into App Store Connect.',
                                },
                                null,
                                2
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}
