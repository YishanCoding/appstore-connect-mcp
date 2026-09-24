export interface SafetyInput {
    kind: 'read' | 'write';
    risk: 'normal' | 'high';
    yes: boolean;
    confirm?: string;
    /** How --confirm is checked. Binding itself happens after a read, not here. */
    confirmKind?: 'app' | 'user';
}

export type SafetyDecision =
    | { action: 'run' }
    | { action: 'dry-run' }
    | { action: 'reject'; message: string };

/**
 * Writes default to dry-run. --yes executes.
 * High-risk requires --confirm to be present. The value is checked against the
 * real target (app id from the resource, or userId/email) before any write.
 */
export function decideSafety(input: SafetyInput): SafetyDecision {
    if (input.kind !== 'write') return { action: 'run' };
    if (!input.yes) return { action: 'dry-run' };
    if (input.risk === 'high' && !input.confirm) {
        const hint = input.confirmKind === 'user' ? '--confirm <userId 或 email>' : '--confirm <app-id>';
        return { action: 'reject', message: `高风险命令需要 ${hint}` };
    }
    return { action: 'run' };
}

export function effectiveRisk(toolName: string, risk: 'normal' | 'high', args: Record<string, unknown>): 'normal' | 'high' {
    if (toolName === 'appstore_upload_screenshots' && args.replaceExisting !== false) return 'high';
    return risk;
}

const APP_LOOKUP: Record<string, (args: Record<string, unknown>) => string> = {
    appstore_respond_to_review: (args) => `/customerReviews/${id(args.reviewId)}`,
    appstore_delete_review_response: (args) => `/customerReviews/${id(args.reviewId)}`,
    appstore_submit_for_review: (args) => `/appStoreVersions/${id(args.versionId)}`,
    appstore_cancel_review: (args) => `/appStoreReviewRequests/${id(args.reviewRequestId)}`,
    appstore_release_version: (args) => `/appStoreVersions/${id(args.versionId)}`,
    appstore_create_phased_release: (args) => `/appStoreVersions/${id(args.versionId)}`,
    appstore_update_phased_release: (args) => `/appStoreVersionPhasedReleases/${id(args.phasedReleaseId)}`,
    appstore_delete_phased_release: (args) => `/appStoreVersionPhasedReleases/${id(args.phasedReleaseId)}`,
    appstore_delete_screenshot_set: (args) => `/appScreenshotSets/${id(args.screenshotSetId)}`,
    appstore_delete_cpp: (args) => `/appCustomProductPages/${id(args.cppId)}`,
    appstore_delete_event: (args) => `/appEvents/${id(args.eventId)}`,
    appstore_submit_event: (args) => `/appEvents/${id(args.eventId)}`,
    appstore_upload_screenshots: (args) => `/appStoreVersionLocalizations/${id(args.appStoreVersionLocalizationId)}`,
};

const USER_ID_TOOLS = new Set(['appstore_remove_user', 'appstore_update_user_roles']);

function id(value: unknown): string {
    return encodeURIComponent(String(value ?? ''));
}

export function appLookupPath(toolName: string, args: Record<string, unknown>): string | undefined {
    return APP_LOOKUP[toolName]?.(args);
}

/** App id from a resource fetched with include=app, or from an included parent that has one. */
export function appIdFromResource(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const root = payload as { data?: unknown; included?: unknown };
    const direct = relationshipAppId(root.data);
    if (direct) return direct;
    const included = Array.isArray(root.included) ? root.included : [];
    for (const item of included) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { type?: string; id?: string };
        if (record.type === 'apps' && record.id) return record.id;
        const nested = relationshipAppId(item);
        if (nested) return nested;
    }
    return undefined;
}

function relationshipAppId(resource: unknown): string | undefined {
    if (!resource || typeof resource !== 'object') return undefined;
    const relationships = (resource as { relationships?: unknown }).relationships;
    if (!relationships || typeof relationships !== 'object') return undefined;
    const app = (relationships as { app?: { data?: { id?: unknown } } }).app;
    const found = app?.data?.id;
    return typeof found === 'string' && found ? found : undefined;
}

export type ConfirmGate =
    | { ok: true }
    | { ok: false; message: string };

/**
 * App-scoped high commands: GET the target with include=app and compare app.id.
 * User commands: --confirm must equal the user id or the account email/username.
 * Returns ok without a request when the typed id already matches.
 */
export async function bindConfirm(
    toolName: string,
    args: Record<string, unknown>,
    confirm: string,
    get: (path: string, params?: Record<string, unknown>) => Promise<unknown>
): Promise<ConfirmGate> {
    if (toolName === 'appstore_invite_user') {
        if (confirm !== args.email) {
            return { ok: false, message: '--confirm 必须等于要邀请的 email' };
        }
        return { ok: true };
    }

    if (USER_ID_TOOLS.has(toolName)) {
        if (confirm === args.userId) return { ok: true };
        const user = await get(`/users/${id(args.userId)}`);
        const attributes = (user as { data?: { attributes?: { username?: string; email?: string } } })?.data?.attributes;
        if (confirm === attributes?.username || confirm === attributes?.email) return { ok: true };
        return { ok: false, message: '--confirm 必须等于目标 userId 或 email' };
    }

    const path = appLookupPath(toolName, args);
    if (!path) return { ok: false, message: '高风险命令缺少目标资源，已拒绝写入' };
    const payload = await get(path, { include: 'app' });
    const actual = appIdFromResource(payload);
    if (!actual) {
        return { ok: false, message: `无法从目标资源确认所属 app（GET ${path}?include=app），已拒绝写入` };
    }
    if (confirm !== actual) {
        return { ok: false, message: `--confirm 与目标资源所属 app 不一致（资源属于 ${actual}）` };
    }
    return { ok: true };
}

const APP_KEYS = ['appId', 'app_id', 'adamId'];

export function extractAppId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    for (const key of APP_KEYS) {
        const found = record[key];
        if (typeof found === 'string' && found) return found;
    }
    const data = record.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const relationships = (data as Record<string, unknown>).relationships;
        const app = relationships && typeof relationships === 'object'
            ? (relationships as Record<string, unknown>).app
            : undefined;
        const id = app && typeof app === 'object'
            ? ((app as Record<string, unknown>).data as Record<string, unknown> | undefined)?.id
            : undefined;
        if (typeof id === 'string' && id) return id;
    }
    return undefined;
}
