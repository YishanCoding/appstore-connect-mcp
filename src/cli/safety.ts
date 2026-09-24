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

/** Reads the binding step may perform. getAll follows links.next (host-checked in the client). */
export interface BindReader {
    get(path: string, params?: Record<string, unknown>): Promise<unknown>;
    getAll(path: string, params?: Record<string, unknown>): Promise<unknown[]>;
}

/** CLI-only context the binding needs beyond the MCP args. */
export interface BindContext {
    /** --app (review commands compare --confirm to it). */
    app?: string;
    /** --version-id (phased-release update/delete). */
    versionId?: string;
    /** --confirm, only used to render confirm_reads in dry-run. */
    confirm?: string;
}

export interface BindRead {
    method: 'GET';
    path: string;
    params?: Record<string, unknown>;
    note?: string;
}

const USER_ID_TOOLS = new Set(['appstore_remove_user', 'appstore_update_user_roles']);
const REVIEW_TOOLS = new Set(['appstore_respond_to_review', 'appstore_delete_review_response']);
const VERSION_TOOLS: Record<string, string> = {
    appstore_submit_for_review: 'versionId',
    appstore_release_version: 'versionId',
    appstore_create_phased_release: 'versionId',
};
const PHASED_TOOLS = new Set(['appstore_update_phased_release', 'appstore_delete_phased_release']);
const EVENT_TOOLS = new Set(['appstore_delete_event', 'appstore_submit_event']);

/** Tools that take the CLI-only --version-id flag for binding. */
export const BIND_VERSION_ID_TOOLS = PHASED_TOOLS;

export const CANCEL_REVIEW_UNSUPPORTED =
    'version cancel 会发 DELETE /appStoreReviewRequests/{id}，但 Apple App Store Connect OpenAPI（4.5）里没有 appStoreReviewRequests 这个资源，线上 GET 返回 404，无法确认归属，已拒绝写入（MCP 原有问题，见 docs/cli-spec.md）';

function id(value: unknown): string {
    return encodeURIComponent(String(value ?? ''));
}

function relId(payload: unknown, key: string): string | undefined {
    const data = (payload as { data?: { relationships?: Record<string, { data?: { id?: unknown } | null }> } } | undefined)?.data;
    const found = data?.relationships?.[key]?.data?.id;
    return typeof found === 'string' && found ? found : undefined;
}

/**
 * The GETs `--yes` performs before any write to bind --confirm to the real target.
 * Ids that come from an earlier response are shown as {placeholders}.
 */
export function bindingReads(toolName: string, args: Record<string, unknown>, ctx: BindContext = {}): BindRead[] {
    if (toolName === 'appstore_invite_user' || toolName === 'appstore_cancel_review') return [];
    if (REVIEW_TOOLS.has(toolName)) {
        const app = ctx.confirm ? id(ctx.confirm) : '{--confirm}';
        return [{
            method: 'GET',
            path: `/apps/${app}/customerReviews`,
            params: { limit: 200 },
            note: '分页读完（跟随 links.next）。列表里必须有 reviewId。--confirm 与 --app 字面相等不算归属。',
        }];
    }
    if (USER_ID_TOOLS.has(toolName)) {
        return [{ method: 'GET', path: `/users/${id(args.userId)}`, note: '仅当 --confirm 不等于 userId 时发送' }];
    }
    const versionKey = VERSION_TOOLS[toolName];
    if (versionKey) return [{ method: 'GET', path: `/appStoreVersions/${id(args[versionKey])}`, params: { include: 'app' } }];
    if (PHASED_TOOLS.has(toolName)) {
        const version = ctx.versionId ? id(ctx.versionId) : '{--version-id}';
        return [{ method: 'GET', path: `/appStoreVersions/${version}`, params: { include: 'app,appStoreVersionPhasedRelease' } }];
    }
    if (toolName === 'appstore_upload_screenshots') {
        return [
            { method: 'GET', path: `/appStoreVersionLocalizations/${id(args.appStoreVersionLocalizationId)}`, params: { include: 'appStoreVersion' } },
            { method: 'GET', path: '/appStoreVersions/{appStoreVersionId}', params: { include: 'app' } },
        ];
    }
    if (toolName === 'appstore_delete_screenshot_set') {
        return [
            {
                method: 'GET',
                path: `/appScreenshotSets/${id(args.screenshotSetId)}`,
                params: { include: 'appStoreVersionLocalization,appCustomProductPageLocalization' },
            },
            { method: 'GET', path: '/appStoreVersionLocalizations/{localizationId}', params: { include: 'appStoreVersion' }, note: '版本截图集' },
            { method: 'GET', path: '/appStoreVersions/{appStoreVersionId}', params: { include: 'app' }, note: '版本截图集' },
            { method: 'GET', path: '/appCustomProductPageLocalizations/{localizationId}', params: { include: 'appCustomProductPageVersion' }, note: 'CPP 截图集' },
            { method: 'GET', path: '/appCustomProductPageVersions/{cppVersionId}', params: { include: 'appCustomProductPage' }, note: 'CPP 截图集' },
            { method: 'GET', path: '/appCustomProductPages/{cppId}', params: { include: 'app' }, note: 'CPP 截图集' },
        ];
    }
    if (toolName === 'appstore_delete_cpp') {
        return [{ method: 'GET', path: `/appCustomProductPages/${id(args.cppId)}`, params: { include: 'app' } }];
    }
    if (EVENT_TOOLS.has(toolName)) {
        const app = ctx.confirm ? id(ctx.confirm) : '{--confirm}';
        return [{
            method: 'GET',
            path: `/apps/${app}/appEvents`,
            params: { 'filter[id]': String(args.eventId ?? ''), limit: 200 },
            note: '跟随 links.next 读完，结果里必须有这个 eventId（Apple 会忽略 filter[id]）',
        }];
    }
    return [];
}

export type ConfirmGate =
    | { ok: true }
    | { ok: false; message: string };

const deny = (message: string): ConfirmGate => ({ ok: false, message });

function sameText(left: unknown, right: string): boolean {
    return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

/**
 * Binds --confirm to the real target before any write. Fail-closed: anything the chain
 * cannot prove is rejected. Only relationships Apple's OpenAPI lists for each GET are used.
 *
 * - review reply / delete-response: customerReviews has no app relationship (include=app → 400)
 *   and filter[id] is rejected. Page through GET /apps/{confirm}/customerReviews and require the review id.
 * - version submit / release / phased-release create: GET appStoreVersions/{v}?include=app.
 * - phased-release update / delete: no GET on appStoreVersionPhasedReleases. Needs --version-id;
 *   GET appStoreVersions/{v}?include=app,appStoreVersionPhasedRelease, both ids must match.
 * - screenshot upload: localization?include=appStoreVersion → version?include=app.
 * - screenshot-set delete: set?include=appStoreVersionLocalization,appCustomProductPageLocalization,
 *   then the version chain or the CPP chain (localization → version → page?include=app).
 * - cpp delete: appCustomProductPages/{id}?include=app.
 * - event delete / submit: appEvents has no app relationship. List /apps/{confirm}/appEvents and
 *   require the event id in the result (Apple ignores filter[id] here, so non-empty proves nothing).
 * - version cancel: the write path does not exist in Apple's spec; always rejected.
 * - users: --confirm equals userId, or the account email/username (case-insensitive).
 */
export async function bindConfirm(
    toolName: string,
    args: Record<string, unknown>,
    confirm: string,
    reader: BindReader,
    ctx: BindContext = {}
): Promise<ConfirmGate> {
    if (toolName === 'appstore_invite_user') {
        if (!sameText(args.email, confirm)) return deny('--confirm 必须等于要邀请的 email');
        return { ok: true };
    }

    if (USER_ID_TOOLS.has(toolName)) {
        if (confirm === args.userId) return { ok: true };
        const user = await reader.get(`/users/${id(args.userId)}`);
        const attributes = (user as { data?: { attributes?: { username?: string; email?: string } } })?.data?.attributes;
        if (sameText(attributes?.username, confirm) || sameText(attributes?.email, confirm)) return { ok: true };
        return deny('--confirm 必须等于目标 userId 或 email');
    }

    if (REVIEW_TOOLS.has(toolName)) {
        const reviewId = String(args.reviewId ?? '');
        if (!reviewId) return deny('review 回复类命令缺少 reviewId，已拒绝写入');
        let reviews: unknown[];
        try {
            reviews = await reader.getAll(`/apps/${id(confirm)}/customerReviews`, { limit: 200 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('不完整')) throw error;
            return deny(`无法读完 app ${confirm} 的评论列表（${message}），已拒绝写入`);
        }
        const owned = reviews.some((item) => (item as { id?: unknown } | null)?.id === reviewId);
        if (!owned) return deny(`评论 ${reviewId} 不在 app ${confirm} 的评论列表里，已拒绝写入`);
        return { ok: true };
    }

    if (toolName === 'appstore_cancel_review') return deny(CANCEL_REVIEW_UNSUPPORTED);

    const matchApp = (actual: string | undefined, via: string): ConfirmGate => {
        if (!actual) return deny(`无法从目标资源确认所属 app（${via}），已拒绝写入`);
        if (confirm !== actual) return deny(`--confirm 与目标资源所属 app 不一致（资源属于 ${actual}）`);
        return { ok: true };
    };
    const versionApp = async (versionId: string) =>
        relId(await reader.get(`/appStoreVersions/${id(versionId)}`, { include: 'app' }), 'app');
    const versionLocalizationApp = async (localizationId: string) => {
        const loc = await reader.get(`/appStoreVersionLocalizations/${id(localizationId)}`, { include: 'appStoreVersion' });
        const versionId = relId(loc, 'appStoreVersion');
        return versionId ? versionApp(versionId) : undefined;
    };
    const cppLocalizationApp = async (localizationId: string) => {
        const loc = await reader.get(`/appCustomProductPageLocalizations/${id(localizationId)}`, { include: 'appCustomProductPageVersion' });
        const cppVersionId = relId(loc, 'appCustomProductPageVersion');
        if (!cppVersionId) return undefined;
        const version = await reader.get(`/appCustomProductPageVersions/${id(cppVersionId)}`, { include: 'appCustomProductPage' });
        const cppId = relId(version, 'appCustomProductPage');
        if (!cppId) return undefined;
        return relId(await reader.get(`/appCustomProductPages/${id(cppId)}`, { include: 'app' }), 'app');
    };

    const versionKey = VERSION_TOOLS[toolName];
    if (versionKey) {
        return matchApp(await versionApp(String(args[versionKey] ?? '')), 'appStoreVersions?include=app');
    }

    if (PHASED_TOOLS.has(toolName)) {
        if (!ctx.versionId) {
            return deny('phased-release update/delete 需要 --version-id <appStoreVersionId>：Apple 没有 GET appStoreVersionPhasedReleases/{id}，只能从版本反查');
        }
        const version = await reader.get(`/appStoreVersions/${id(ctx.versionId)}`, { include: 'app,appStoreVersionPhasedRelease' });
        const gate = matchApp(relId(version, 'app'), 'appStoreVersions?include=app');
        if (!gate.ok) return gate;
        const phased = relId(version, 'appStoreVersionPhasedRelease');
        if (!phased || phased !== args.phasedReleaseId) {
            return deny(`phasedReleaseId 不属于 --version-id 指定的版本（该版本的 phased release: ${phased ?? '无'}），已拒绝写入`);
        }
        return { ok: true };
    }

    if (toolName === 'appstore_upload_screenshots') {
        return matchApp(
            await versionLocalizationApp(String(args.appStoreVersionLocalizationId ?? '')),
            'appStoreVersionLocalizations?include=appStoreVersion → appStoreVersions?include=app'
        );
    }

    if (toolName === 'appstore_delete_screenshot_set') {
        const set = await reader.get(`/appScreenshotSets/${id(args.screenshotSetId)}`, {
            include: 'appStoreVersionLocalization,appCustomProductPageLocalization',
        });
        const versionLoc = relId(set, 'appStoreVersionLocalization');
        const cppLoc = relId(set, 'appCustomProductPageLocalization');
        if (versionLoc) return matchApp(await versionLocalizationApp(versionLoc), '截图集 → 版本本地化 → 版本 → app');
        if (cppLoc) return matchApp(await cppLocalizationApp(cppLoc), '截图集 → CPP 本地化 → CPP 版本 → CPP → app');
        return deny('截图集既不属于版本本地化也不属于 CPP 本地化（例如产品页优化实验的截图集），无法确认所属 app，已拒绝写入');
    }

    if (toolName === 'appstore_delete_cpp') {
        return matchApp(relId(await reader.get(`/appCustomProductPages/${id(args.cppId)}`, { include: 'app' }), 'app'), 'appCustomProductPages?include=app');
    }

    if (EVENT_TOOLS.has(toolName)) {
        const eventId = String(args.eventId ?? '');
        let events: unknown[];
        try {
            events = await reader.getAll(`/apps/${id(confirm)}/appEvents`, { 'filter[id]': eventId });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('不完整')) throw error;
            return deny(`无法读完 app ${confirm} 的事件列表（${message}），已拒绝写入`);
        }
        const owned = events.some((item) => (item as { id?: unknown } | null)?.id === eventId);
        if (!owned) return deny(`事件 ${eventId} 不在 app ${confirm} 的事件列表里，已拒绝写入`);
        return { ok: true };
    }

    return deny('高风险命令缺少目标资源，已拒绝写入');
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
