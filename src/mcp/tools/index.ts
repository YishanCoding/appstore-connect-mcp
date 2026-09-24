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
import { registerIapTools } from './iap/index.js';

export interface CollectedTool {
    name: string;
    description: string;
    inputSchema: unknown;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
}

let catalogCache: CollectedTool[] | null = null;

/**
 * Register every MCP tool. The same registerTool arguments are recorded so the CLI
 * reuses one definition (name, description, zod schema) instead of a second copy.
 * Handlers passed to the real server are unchanged.
 */
export function registerAllTools(server: McpServer): CollectedTool[] {
    const collected: CollectedTool[] = [];
    const original = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: { description?: string; inputSchema?: unknown }, handler: CollectedTool['handler']) => {
        collected.push({
            name,
            description: typeof config?.description === 'string' ? config.description : '',
            inputSchema: config?.inputSchema,
            handler,
        });
        return original(name, config as never, handler as never);
    }) as typeof server.registerTool;

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
    registerIapTools(server);
    return collected;
}

/** Catalog from the same registerAllTools path the MCP server uses. */
export function loadToolCatalog(): CollectedTool[] {
    if (catalogCache) return catalogCache;
    const stub = {
        registerTool() {
            return undefined;
        },
    } as unknown as McpServer;
    catalogCache = registerAllTools(stub);
    return catalogCache;
}
