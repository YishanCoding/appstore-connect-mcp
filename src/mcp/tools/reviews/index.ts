import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { ReviewManager } from '../../../programs/reviews/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

function makeClient() {
    const creds = getStoredCredentials();
    if (!creds) return null;
    return new AppStoreConnectClient({ keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey });
}

function noCredentials() {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No credentials. Use appstore_store_credentials first.' }, null, 2) }],
        isError: true,
    };
}

export function registerReviewTools(server: McpServer) {
    server.registerTool(
        'appstore_list_reviews',
        {
            description: 'List customer reviews for an app, optionally filtered by rating or territory',
            inputSchema: z.object({
                appId: z.string(),
                limit: z.number().optional().default(100),
                sort: z.enum(['-createdDate', 'createdDate', '-rating', 'rating']).optional().default('-createdDate'),
                filterRating: z.number().min(1).max(5).optional().describe('Filter by star rating (1-5)'),
                filterTerritory: z.string().optional().describe('Filter by territory code, e.g. CHN, USA, JPN'),
            }),
        },
        async ({ appId, limit, sort, filterRating, filterTerritory }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const reviews = await new ReviewManager(client).listReviews(appId, { limit, sort, filterRating, filterTerritory });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ reviews, count: reviews.length }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_respond_to_review',
        {
            description: 'Post or update a developer response to a customer review',
            inputSchema: z.object({
                reviewId: z.string().describe('Review ID from appstore_list_reviews'),
                responseBody: z.string().describe('Developer response text (max 5900 chars)'),
            }),
        },
        async ({ reviewId, responseBody }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                await new ReviewManager(client).respondToReview(reviewId, responseBody);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, reviewId }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_delete_review_response',
        {
            description: 'Delete an existing developer response to a customer review',
            inputSchema: z.object({
                reviewId: z.string(),
            }),
        },
        async ({ reviewId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                await new ReviewManager(client).deleteReviewResponse(reviewId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );
}
