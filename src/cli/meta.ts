export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ToolMeta {
    command: string | null;
    aliases?: string[];
    kind: 'read' | 'write';
    risk: 'normal' | 'high';
    idParam?: string;
    reason?: string;
    capability?: string;
    owner?: string;
    method?: HttpMethod;
    /** Path template. `{field}` is filled from parsed args. */
    path?: string;
    resourceType?: string;
    /** Args copied into JSON:API attributes. Omitted = every arg except ids. */
    attrKeys?: string[];
    relationship?: { key: string; type: string; idParam: string };
    body?: 'jsonapi' | 'none' | 'builds' | 'raw';
}

const read = (command: string, extra: Partial<ToolMeta> = {}): ToolMeta => ({
    command,
    kind: 'read',
    risk: 'normal',
    ...extra,
});

const write = (command: string, extra: Partial<ToolMeta> = {}): ToolMeta => ({
    command,
    kind: 'write',
    risk: 'normal',
    body: 'jsonapi',
    ...extra,
});

const high = (command: string, extra: Partial<ToolMeta> = {}): ToolMeta =>
    write(command, { risk: 'high', ...extra });

/** Canonical command + write-plan for every MCP tool. Schemas stay in registerTool. */
export const TOOL_META: Record<string, ToolMeta> = {
    appstore_list_apps: read('app list'),
    appstore_get_app: read('app get', { idParam: 'appId' }),
    appstore_list_builds: read('build list'),
    appstore_get_build: read('build get', { idParam: 'buildId' }),
    appstore_get_latest_build: read('build latest'),
    appstore_list_builds_by_version: read('build query'),
    appstore_get_build_beta_detail: read('build get-beta-detail', { idParam: 'buildId' }),
    appstore_update_build_beta_detail: write('build update-beta-detail', {
        idParam: 'buildBetaDetailId',
        method: 'PATCH',
        path: '/buildBetaDetails/{buildBetaDetailId}',
        resourceType: 'buildBetaDetails',
        attrKeys: ['autoNotifyEnabled', 'internalBuildState', 'externalBuildState'],
    }),
    appstore_list_reviews: read('review list'),
    appstore_respond_to_review: high('review reply', {
        idParam: 'reviewId',
        method: 'POST',
        path: '/customerReviewResponses',
        resourceType: 'customerReviewResponses',
        attrKeys: ['responseBody'],
        relationship: { key: 'review', type: 'customerReviews', idParam: 'reviewId' },
    }),
    appstore_delete_review_response: high('review delete-response', {
        idParam: 'reviewId',
        method: 'DELETE',
        path: '/customerReviews/{reviewId}/response',
        body: 'none',
    }),
    appstore_list_versions: read('version list'),
    appstore_get_version: read('version get', { idParam: 'versionId' }),
    appstore_create_version: write('version create', {
        method: 'POST',
        path: '/appStoreVersions',
        resourceType: 'appStoreVersions',
        attrKeys: ['platform', 'versionString'],
        relationship: { key: 'app', type: 'apps', idParam: 'appId' },
    }),
    appstore_submit_for_review: high('version submit', {
        idParam: 'versionId',
        method: 'POST',
        path: '/appStoreReviewRequests',
        resourceType: 'appStoreReviewRequests',
        attrKeys: [],
        relationship: { key: 'appStoreVersion', type: 'appStoreVersions', idParam: 'versionId' },
    }),
    appstore_cancel_review: high('version cancel', {
        idParam: 'reviewRequestId',
        method: 'DELETE',
        path: '/appStoreReviewRequests/{reviewRequestId}',
        body: 'none',
    }),
    appstore_release_version: high('version release', {
        idParam: 'versionId',
        method: 'POST',
        path: '/appStoreVersionReleaseRequests',
        resourceType: 'appStoreVersionReleaseRequests',
        attrKeys: [],
        relationship: { key: 'appStoreVersion', type: 'appStoreVersions', idParam: 'versionId' },
    }),
    appstore_create_phased_release: high('phased-release create', {
        idParam: 'versionId',
        method: 'POST',
        path: '/appStoreVersionPhasedReleases',
        resourceType: 'appStoreVersionPhasedReleases',
        attrKeys: [],
        relationship: { key: 'appStoreVersion', type: 'appStoreVersions', idParam: 'versionId' },
    }),
    appstore_get_phased_release: read('phased-release get', { idParam: 'versionId' }),
    appstore_update_phased_release: high('phased-release update', {
        idParam: 'phasedReleaseId',
        method: 'PATCH',
        path: '/appStoreVersionPhasedReleases/{phasedReleaseId}',
        resourceType: 'appStoreVersionPhasedReleases',
        attrKeys: ['phasedReleaseState'],
    }),
    appstore_delete_phased_release: high('phased-release delete', {
        idParam: 'phasedReleaseId',
        method: 'DELETE',
        path: '/appStoreVersionPhasedReleases/{phasedReleaseId}',
        body: 'none',
    }),
    appstore_get_review_detail: read('review-detail get', { idParam: 'versionId' }),
    appstore_upsert_review_detail: write('review-detail upsert', {
        idParam: 'versionId',
        method: 'POST',
        path: '/appStoreReviewDetails',
        resourceType: 'appStoreReviewDetails',
        relationship: { key: 'appStoreVersion', type: 'appStoreVersions', idParam: 'versionId' },
    }),
    appstore_list_version_localizations: read('version-localization list'),
    appstore_update_version_localization: write('version update-localization', {
        idParam: 'localizationId',
        method: 'PATCH',
        path: '/appStoreVersionLocalizations/{localizationId}',
        resourceType: 'appStoreVersionLocalizations',
        aliases: ['version-localization update', 'update-version-localization'],
    }),
    appstore_create_version_localization: write('version-localization create', {
        method: 'POST',
        path: '/appStoreVersionLocalizations',
        resourceType: 'appStoreVersionLocalizations',
        relationship: { key: 'appStoreVersion', type: 'appStoreVersions', idParam: 'appStoreVersionId' },
    }),
    appstore_batch_update_version_localizations: write('version-localization batch-update', {
        method: 'PATCH',
        path: '/appStoreVersionLocalizations',
        body: 'raw',
    }),
    appstore_list_app_info_localizations: read('app-info-localization list'),
    appstore_update_app_info_localization: write('app-info-localization update', {
        idParam: 'appInfoLocalizationId',
        method: 'PATCH',
        path: '/appInfoLocalizations/{appInfoLocalizationId}',
        resourceType: 'appInfoLocalizations',
    }),
    appstore_batch_update_app_info_localizations: write('app-info-localization batch-update', {
        method: 'PATCH',
        path: '/appInfoLocalizations',
        body: 'raw',
    }),
    appstore_list_screenshot_sets: read('screenshot-set list'),
    appstore_upload_screenshots: write('screenshot upload', {
        method: 'POST',
        path: '/appScreenshotSets',
        resourceType: 'appScreenshotSets',
        attrKeys: ['screenshotDisplayType'],
        relationship: {
            key: 'appStoreVersionLocalization',
            type: 'appStoreVersionLocalizations',
            idParam: 'appStoreVersionLocalizationId',
        },
    }),
    appstore_delete_screenshot_set: high('screenshot-set delete', {
        idParam: 'screenshotSetId',
        method: 'DELETE',
        path: '/appScreenshotSets/{screenshotSetId}',
        body: 'none',
    }),
    appstore_list_cpps: read('cpp list'),
    appstore_create_cpp: write('cpp create', {
        method: 'POST',
        path: '/appCustomProductPages',
        body: 'raw',
    }),
    appstore_update_cpp_promo: write('cpp update-promo', {
        idParam: 'localeId',
        method: 'PATCH',
        path: '/appCustomProductPageLocalizations/{localeId}',
        resourceType: 'appCustomProductPageLocalizations',
        attrKeys: ['promotionalText'],
    }),
    appstore_delete_cpp: high('cpp delete', {
        idParam: 'cppId',
        method: 'DELETE',
        path: '/appCustomProductPages/{cppId}',
        body: 'none',
    }),
    appstore_list_events: read('event list'),
    appstore_create_event: write('event create', {
        method: 'POST',
        path: '/appEvents',
        resourceType: 'appEvents',
        relationship: { key: 'app', type: 'apps', idParam: 'appId' },
    }),
    appstore_get_event: read('event get', { idParam: 'eventId' }),
    appstore_update_event: write('event update', {
        idParam: 'eventId',
        method: 'PATCH',
        path: '/appEvents/{eventId}',
        resourceType: 'appEvents',
    }),
    appstore_delete_event: high('event delete', {
        idParam: 'eventId',
        method: 'DELETE',
        path: '/appEvents/{eventId}',
        body: 'none',
    }),
    appstore_list_event_localizations: read('event-localization list'),
    appstore_create_event_localization: write('event-localization create', {
        method: 'POST',
        path: '/appEventLocalizations',
        resourceType: 'appEventLocalizations',
        relationship: { key: 'appEvent', type: 'appEvents', idParam: 'eventId' },
    }),
    appstore_update_event_localization: write('event-localization update', {
        idParam: 'localizationId',
        method: 'PATCH',
        path: '/appEventLocalizations/{localizationId}',
        resourceType: 'appEventLocalizations',
    }),
    appstore_submit_event: high('event submit', {
        idParam: 'eventId',
        method: 'POST',
        path: '/appEventSubmissions',
        resourceType: 'appEventSubmissions',
        attrKeys: [],
        relationship: { key: 'appEvent', type: 'appEvents', idParam: 'eventId' },
    }),
    appstore_list_users: read('user list'),
    appstore_invite_user: high('user invite', {
        method: 'POST',
        path: '/userInvitations',
        resourceType: 'userInvitations',
        attrKeys: ['email', 'firstName', 'lastName', 'roles', 'allAppsVisible', 'provisioningAllowed'],
    }),
    appstore_remove_user: high('user remove', {
        idParam: 'userId',
        method: 'DELETE',
        path: '/users/{userId}',
        body: 'none',
    }),
    appstore_update_user_roles: high('user update-roles', {
        idParam: 'userId',
        method: 'PATCH',
        path: '/users/{userId}',
        resourceType: 'users',
        attrKeys: ['roles'],
    }),
    appstore_list_beta_groups: read('beta-group list'),
    appstore_add_build_to_beta_group: write('beta-group add-build', {
        method: 'POST',
        path: '/betaGroups/{betaGroupId}/relationships/builds',
        body: 'builds',
    }),
    appstore_remove_build_from_beta_group: write('beta-group remove-build', {
        method: 'DELETE',
        path: '/betaGroups/{betaGroupId}/relationships/builds',
        body: 'builds',
    }),
    appstore_list_beta_testers: read('beta-tester list'),
    appstore_add_beta_tester: write('beta-tester add', {
        method: 'POST',
        path: '/betaTesters',
        resourceType: 'betaTesters',
        attrKeys: ['email', 'firstName', 'lastName'],
    }),
    appstore_list_beta_localizations: read('beta-localization list'),
    appstore_upsert_beta_localization: write('beta-localization upsert', {
        method: 'POST',
        path: '/betaAppLocalizations',
        resourceType: 'betaAppLocalizations',
        relationship: { key: 'app', type: 'apps', idParam: 'appId' },
    }),
    appstore_list_in_app_purchases: read('in-app-purchase list'),
    appstore_get_in_app_purchase: read('in-app-purchase get', { idParam: 'inAppPurchaseId' }),
    appstore_list_subscription_groups: read('subscription-group list'),
    appstore_get_analytics_by_source: read('analytics by-source'),
    appstore_export_full_history: read('analytics export'),
    appstore_validate_credentials: read('auth check', { aliases: ['validate-credentials'] }),
    appstore_store_credentials: {
        command: null,
        kind: 'write',
        risk: 'high',
        reason: 'stateless',
        capability: 'store-credentials',
        owner: 'env APP_STORE_CONNECT_KEY_ID / APP_STORE_CONNECT_ISSUER_ID / APP_STORE_CONNECT_PRIVATE_KEY_PATH',
    },
};

export function mechanicalAlias(mcpName: string): string {
    return mcpName.replace(/^appstore_/, '').replace(/_/g, '-');
}
