import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, EventManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const badgeSchema = z.enum([
    'CHALLENGE',
    'COMPETITION',
    'IN_APP_EVENT',
    'LIVE_EVENT',
    'MAJOR_UPDATE',
    'NEW_SEASON',
    'PREMIERE',
    'SPECIAL_EVENT',
]);

const territoryScheduleSchema = z.object({
    territories: z.array(z.string()).describe('App Store territory codes, e.g. ["US", "CN"]'),
    publishStart: z.string().optional().describe('ISO-8601 publish start date/time'),
    eventStart: z.string().optional().describe('ISO-8601 event start date/time'),
    eventEnd: z.string().optional().describe('ISO-8601 event end date/time'),
});

function makeClient() {
    const creds = getStoredCredentials();
    if (!creds) return null;
    return new AppStoreConnectClient({
        keyId: creds.keyId,
        issuerId: creds.issuerId,
        privateKey: creds.privateKey,
    });
}

function noCredentials() {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No credentials. Use appstore_store_credentials first.' }, null, 2) }],
        isError: true,
    };
}

function errorResponse(e: any) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }],
        isError: true,
    };
}

export function registerEventsTools(server: McpServer) {
    server.registerTool(
        'appstore_list_events',
        {
            description: 'List In-App Events for an app.',
            inputSchema: z.object({
                appId: z.string().describe('App ID (numeric)'),
            }),
        },
        async ({ appId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const events = await new EventManager(client).listEvents(appId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ events, count: events.length }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_create_event',
        {
            description: 'Create an In-App Event for an app.',
            inputSchema: z.object({
                appId: z.string().describe('App ID (numeric)'),
                referenceName: z.string().describe('Internal reference name'),
                badge: badgeSchema.describe('In-App Event badge'),
                eventState: z.string().optional().describe('Event state'),
                deepLink: z.string().optional().describe('Deep link URL'),
                purchaseRequirement: z.string().optional().describe('Purchase requirement'),
                primaryLocale: z.string().optional().describe('Primary locale, e.g. en-US'),
                territorySchedules: z.array(territoryScheduleSchema).optional(),
            }),
        },
        async ({ appId, referenceName, badge, eventState, deepLink, purchaseRequirement, primaryLocale, territorySchedules }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const event = await new EventManager(client).createEvent(appId, {
                    referenceName,
                    badge,
                    eventState,
                    deepLink,
                    purchaseRequirement,
                    primaryLocale,
                    territorySchedules,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, event }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_get_event',
        {
            description: 'Get an In-App Event by ID.',
            inputSchema: z.object({
                eventId: z.string().describe('In-App Event ID'),
            }),
        },
        async ({ eventId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const event = await new EventManager(client).getEvent(eventId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ event }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_update_event',
        {
            description: 'Update an In-App Event by ID.',
            inputSchema: z.object({
                eventId: z.string().describe('In-App Event ID'),
                referenceName: z.string().optional(),
                badge: badgeSchema.optional(),
                eventState: z.string().optional(),
                deepLink: z.string().optional(),
                purchaseRequirement: z.string().optional(),
                primaryLocale: z.string().optional(),
                territorySchedules: z.array(territoryScheduleSchema).optional(),
            }),
        },
        async ({ eventId, referenceName, badge, eventState, deepLink, purchaseRequirement, primaryLocale, territorySchedules }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const event = await new EventManager(client).updateEvent(eventId, {
                    referenceName,
                    badge,
                    eventState,
                    deepLink,
                    purchaseRequirement,
                    primaryLocale,
                    territorySchedules,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, event }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_delete_event',
        {
            description: 'Delete an In-App Event by ID.',
            inputSchema: z.object({
                eventId: z.string().describe('In-App Event ID'),
            }),
        },
        async ({ eventId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                await new EventManager(client).deleteEvent(eventId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, deleted: eventId }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_list_event_localizations',
        {
            description: 'List localizations for an In-App Event.',
            inputSchema: z.object({
                eventId: z.string().describe('In-App Event ID'),
            }),
        },
        async ({ eventId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const localizations = await new EventManager(client).listLocalizations(eventId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ localizations, count: localizations.length }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_create_event_localization',
        {
            description: 'Create a localization for an In-App Event.',
            inputSchema: z.object({
                eventId: z.string().describe('In-App Event ID'),
                locale: z.string().describe('Locale, e.g. en-US'),
                name: z.string().describe('Localized event name'),
                shortDescription: z.string().describe('Localized short description'),
                longDescription: z.string().optional(),
                promotionalText: z.string().optional(),
            }),
        },
        async ({ eventId, locale, name, shortDescription, longDescription, promotionalText }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const localization = await new EventManager(client).createLocalization(eventId, {
                    locale,
                    name,
                    shortDescription,
                    longDescription,
                    promotionalText,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_update_event_localization',
        {
            description: 'Update an In-App Event localization by ID.',
            inputSchema: z.object({
                localizationId: z.string().describe('appEventLocalizations ID'),
                name: z.string().optional(),
                shortDescription: z.string().optional(),
                longDescription: z.string().optional(),
                promotionalText: z.string().optional(),
            }),
        },
        async ({ localizationId, name, shortDescription, longDescription, promotionalText }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const localization = await new EventManager(client).updateLocalization(localizationId, {
                    name,
                    shortDescription,
                    longDescription,
                    promotionalText,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_submit_event',
        {
            description: 'Submit an In-App Event for App Review.',
            inputSchema: z.object({
                eventId: z.string().describe('In-App Event ID'),
            }),
        },
        async ({ eventId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const submission = await new EventManager(client).submitEvent(eventId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, submission }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );
}
