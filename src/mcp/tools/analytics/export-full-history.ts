import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FullHistoryExporter, KEY_METRICS, KEY_DIMENSIONS } from '../../../programs/analytics/full-history-exporter.js';

const inputSchema = z.object({
    adamId: z
        .string()
        .describe('App Adam ID (numeric string), e.g. "6748596826"'),
    outputDir: z
        .string()
        .describe('Absolute path to the directory where CSV files will be written'),
    startDate: z
        .string()
        .describe('Start date in YYYY-MM-DD format (e.g. first day app had data)'),
    endDate: z
        .string()
        .describe('End date in YYYY-MM-DD format (usually yesterday)'),
    sessionName: z
        .string()
        .default('asc')
        .describe('opencli browser session name (default: "asc")'),
    metrics: z
        .array(z.string())
        .optional()
        .describe('Subset of metric keys to export; omit to export all key metrics'),
    dimensions: z
        .array(z.string())
        .optional()
        .describe('Subset of dimension keys to export; omit to export all supported dimensions'),
    outputFormat: z
        .enum(['text', 'json'])
        .default('text')
        .describe('"text" returns a markdown summary, "json" returns the full result object'),
});

export function registerExportFullHistory(server: McpServer) {
    server.registerTool(
        'appstore_export_full_history',
        {
            description:
                'Export ALL App Store Analytics data combinations (every metric × every supported groupBy dimension) ' +
                'to CSV files in a local directory. Each file contains daily time-series data for one ' +
                'metric broken down by one dimension (e.g. First-Time Downloads by Territory). ' +
                'Lifetime scope — fetches the entire available history for the app. ' +
                'Uses the internal ASC Analytics timeseries API via opencli browser eval + localStorage chunking ' +
                'to handle large payloads (e.g. Territory has 175 countries × ~280 days per metric). ' +
                'Requires an active ASC browser session (opencli must be installed and logged in). ' +
                `Supported metrics (${KEY_METRICS.length}): acquisition, downloads, sales, usage, subscriptions, in-app events. ` +
                `Supported dimensions (${KEY_DIMENSIONS.length}): Device, Territory, Source Type, App Version, Platform Version, ` +
                'Product Page, Page Type, Region, App Referrer, Web Referrer, Campaign, Subscription Group/Plan/Duration.',
            inputSchema,
        },
        async ({ adamId, outputDir, startDate, endDate, sessionName, metrics, dimensions, outputFormat }) => {
            try {
                const exporter = new FullHistoryExporter();
                const result = await exporter.export({
                    adamId,
                    outputDir,
                    startDate,
                    endDate,
                    sessionName,
                    metrics,
                    dimensions,
                });

                const text =
                    outputFormat === 'json'
                        ? JSON.stringify(result, null, 2)
                        : exporter.formatSummary(result);

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
                                    hint: 'Ensure opencli is installed (≥v1.7), the browser is open, and you are logged into App Store Connect.',
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
