import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { VersionManager } from '../../../programs/versions/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
import { registerScreenshotTools } from './screenshots.js';

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

function errorResponse(e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
}

const phasedReleaseStateSchema = z.enum(['INACTIVE', 'ACTIVE', 'PAUSED', 'COMPLETE']);

const reviewDetailInputSchema = z.object({
    versionId: z.string().describe('App Store version ID'),
    contactFirstName: z.string().optional(),
    contactLastName: z.string().optional(),
    contactPhone: z.string().optional(),
    contactEmail: z.string().optional(),
    demoAccountName: z.string().optional(),
    demoAccountPassword: z.string().optional(),
    demoAccountRequired: z.boolean().optional(),
    notes: z.string().optional(),
});

export function registerVersionTools(server: McpServer) {
    registerScreenshotTools(server);
    server.registerTool(
        'appstore_list_versions',
        {
            description: 'List App Store versions for an app (includes state like PREPARE_FOR_SUBMISSION, READY_FOR_SALE, etc.)',
            inputSchema: z.object({
                appId: z.string(),
                platform: z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']).optional().default('IOS'),
            }),
        },
        async ({ appId, platform }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const versions = await new VersionManager(client).listVersions(appId, platform);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ versions, count: versions.length }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_get_version',
        {
            description: 'Get details of a specific App Store version by ID',
            inputSchema: z.object({ versionId: z.string() }),
        },
        async ({ versionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const version = await new VersionManager(client).getVersion(versionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ version }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_create_version',
        {
            description: 'Create a new App Store version (starts in PREPARE_FOR_SUBMISSION state)',
            inputSchema: z.object({
                appId: z.string(),
                versionString: z.string().describe('Version number, e.g. "2.1.0"'),
                platform: z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']).optional().default('IOS'),
            }),
        },
        async ({ appId, versionString, platform }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const version = await new VersionManager(client).createVersion(appId, versionString, platform);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, version }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_submit_for_review',
        {
            description: 'Submit an App Store version for review.',
            inputSchema: z.object({
                versionId: z.string().describe('App Store version ID'),
            }),
        },
        async ({ versionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const reviewRequest = await new VersionManager(client).submitForReview(versionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, reviewRequest }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_cancel_review',
        {
            description: 'Cancel an App Store review request by review request ID.',
            inputSchema: z.object({
                reviewRequestId: z.string().describe('appStoreReviewRequests ID'),
            }),
        },
        async ({ reviewRequestId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                await new VersionManager(client).cancelReview(reviewRequestId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, deleted: reviewRequestId }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_create_phased_release',
        {
            description: 'Create an active phased release for an App Store version.',
            inputSchema: z.object({
                versionId: z.string().describe('App Store version ID'),
            }),
        },
        async ({ versionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const phasedRelease = await new VersionManager(client).createPhasedRelease(versionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, phasedRelease }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_get_phased_release',
        {
            description: 'Get the phased release for an App Store version.',
            inputSchema: z.object({
                versionId: z.string().describe('App Store version ID'),
            }),
        },
        async ({ versionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const phasedRelease = await new VersionManager(client).getPhasedRelease(versionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ phasedRelease }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_update_phased_release',
        {
            description: 'Update a phased release state.',
            inputSchema: z.object({
                phasedReleaseId: z.string().describe('appStoreVersionPhasedReleases ID'),
                phasedReleaseState: phasedReleaseStateSchema.describe('New phased release state'),
            }),
        },
        async ({ phasedReleaseId, phasedReleaseState }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const phasedRelease = await new VersionManager(client).updatePhasedRelease(phasedReleaseId, phasedReleaseState);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, phasedRelease }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_delete_phased_release',
        {
            description: 'Delete a phased release by ID.',
            inputSchema: z.object({
                phasedReleaseId: z.string().describe('appStoreVersionPhasedReleases ID'),
            }),
        },
        async ({ phasedReleaseId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                await new VersionManager(client).deletePhasedRelease(phasedReleaseId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, deleted: phasedReleaseId }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_release_version',
        {
            description: 'Manually release an approved App Store version.',
            inputSchema: z.object({
                versionId: z.string().describe('App Store version ID'),
            }),
        },
        async ({ versionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const releaseRequest = await new VersionManager(client).releaseVersion(versionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, releaseRequest }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_get_review_detail',
        {
            description: 'Get App Review detail for an App Store version.',
            inputSchema: z.object({
                versionId: z.string().describe('App Store version ID'),
            }),
        },
        async ({ versionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const reviewDetail = await new VersionManager(client).getReviewDetail(versionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ reviewDetail }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_upsert_review_detail',
        {
            description: 'Create or update App Review detail for an App Store version.',
            inputSchema: reviewDetailInputSchema,
        },
        async ({ versionId, contactFirstName, contactLastName, contactPhone, contactEmail, demoAccountName, demoAccountPassword, demoAccountRequired, notes }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const reviewDetail = await new VersionManager(client).upsertReviewDetail(versionId, {
                    contactFirstName,
                    contactLastName,
                    contactPhone,
                    contactEmail,
                    demoAccountName,
                    demoAccountPassword,
                    demoAccountRequired,
                    notes,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, reviewDetail }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );
}
