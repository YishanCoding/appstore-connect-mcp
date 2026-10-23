import { AppStoreConnectClient } from '../programs/api-client/client.js';
import { AscHttpError } from '../programs/api-client/policy.js';
import { buildCppCreateBody, CppManager, detachCppPlacements } from '../programs/cpp/index.js';
import { CppPreflightError } from '../programs/cpp/cpp-manager.js';
import {
    assertReadableFiles,
    commitScreenshotBody,
    reserveScreenshotBody,
    screenshotSetBody,
    uploadScreenshot,
} from '../mcp/tools/versions/screenshots.js';
import { CliUsage } from './output.js';
import type { HttpMethod } from './meta.js';
import { commitImageBody, getReference, libraryIdForApp, orderBody, placementBody, reserveImageBody, screenshotLimit, targetOf, uploadImage, validateGroup } from '../programs/assets/library.js';

export interface Step {
    method: HttpMethod | 'PUT';
    path: string;
    body: unknown;
    params?: Record<string, unknown>;
    /** Present on upload steps whose URL and byte range come from the reserve response. */
    note?: string;
    offset?: string;
    length?: string;
}

export interface WritePreview {
    dry_run: true;
    method: HttpMethod | 'PUT' | null;
    path: string | null;
    body: unknown;
    steps: Step[];
}

export class PartialBatch extends Error {
    constructor(readonly payload: { total: number; succeeded: number; failed: number; results: unknown[] }) {
        super('批量更新有失败项，已成功的项见 stdout');
        this.name = 'PartialBatch';
    }
}

export class ExportFailed extends Error {
    constructor(readonly payload: unknown) {
        super('导出有失败项');
        this.name = 'ExportFailed';
    }
}

interface Ctx {
    execute: boolean;
    client: AppStoreConnectClient | null;
    steps: Step[];
}

function defined(fields: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) out[key] = value;
    }
    return out;
}

function enc(value: unknown): string {
    return encodeURIComponent(String(value ?? ''));
}

function patchBody(type: string, id: string, attributes: Record<string, unknown>) {
    return { data: { type, id, attributes: defined(attributes) } };
}

function createBody(
    type: string,
    attributes: Record<string, unknown> | undefined,
    relationship?: { key: string; type: string; id: unknown }
) {
    const data: Record<string, unknown> = { type };
    if (attributes && Object.keys(defined(attributes)).length) data.attributes = defined(attributes);
    if (relationship) {
        data.relationships = {
            [relationship.key]: { data: { type: relationship.type, id: relationship.id } },
        };
    }
    return { data };
}

async function read(ctx: Ctx, path: string, params?: Record<string, unknown>): Promise<any> {
    ctx.steps.push({ method: 'GET', path, body: null, params });
    if (!ctx.client) throw new CliUsage('这条命令要先读取资源才能确定请求');
    return ctx.client.get(path, params);
}

async function write(ctx: Ctx, method: Exclude<HttpMethod, 'GET'>, path: string, body: unknown): Promise<any> {
    ctx.steps.push({ method, path, body: body ?? null });
    if (!ctx.execute) return undefined;
    if (!ctx.client) throw new CliUsage('没有可用的客户端');
    if (method === 'POST') return ctx.client.post(path, body);
    if (method === 'PATCH') return ctx.client.patch(path, body);
    await ctx.client.delete(path, body ?? undefined);
    return undefined;
}

/** One conditional PUT per reserved file. The real URL, part count, and byte range come from uploadOperations. */
function plannedUploadStep(): Step {
    return {
        method: 'PUT',
        path: '{uploadOperations[i].url}',
        body: null,
        note: '由 reserve 响应决定；i 从 0 到 uploadOperations.length - 1',
        offset: '{uploadOperations[i].offset}',
        length: '{uploadOperations[i].length}',
    };
}

function isNotFound(error: unknown): boolean {
    return error instanceof AscHttpError && error.status === 404;
}

function previewFrom(steps: Step[]): WritePreview {
    const primary = steps.find((step) => step.method !== 'GET') ?? steps[0];
    return {
        dry_run: true,
        method: primary?.method ?? null,
        path: primary?.path ?? null,
        body: primary?.body ?? null,
        steps,
    };
}

const VERSION_LOC_FIELDS = ['description', 'keywords', 'promotionalText', 'whatsNew', 'marketingUrl', 'supportUrl'] as const;
const APP_INFO_FIELDS = ['name', 'subtitle', 'privacyChoicesUrl', 'privacyPolicyText', 'privacyPolicyUrl'] as const;
const EVENT_FIELDS = ['referenceName', 'badge', 'eventState', 'deepLink', 'purchaseRequirement', 'primaryLocale', 'territorySchedules'] as const;
const REVIEW_DETAIL_FIELDS = [
    'contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail',
    'demoAccountName', 'demoAccountPassword', 'demoAccountRequired', 'notes',
] as const;

function pick(args: Record<string, any>, keys: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
    return out;
}

/** Reads the operation may perform while planning. Writes are only sent when execute is true. */
export async function runWrite(client: AppStoreConnectClient | null, name: string, args: Record<string, any>, execute: boolean): Promise<unknown> {
    const ctx: Ctx = { execute, client, steps: [] };
    const result = await dispatch(ctx, name, args);
    if (!execute) return previewFrom(ctx.steps);
    return result;
}

async function dispatch(ctx: Ctx, name: string, args: Record<string, any>): Promise<unknown> {
    switch (name) {
        case 'appstore_update_build_beta_detail': {
            const body = patchBody('buildBetaDetails', args.buildBetaDetailId, pick(args, ['autoNotifyEnabled', 'internalBuildState', 'externalBuildState']));
            const response = await write(ctx, 'PATCH', `/buildBetaDetails/${enc(args.buildBetaDetailId)}`, body);
            return response?.data ?? response;
        }
        case 'appstore_respond_to_review':
            return respondToReview(ctx, args.reviewId, args.responseBody);
        case 'appstore_delete_review_response':
            return deleteReviewResponse(ctx, args.reviewId);
        case 'appstore_create_version': {
            const body = createBody('appStoreVersions', { platform: args.platform, versionString: args.versionString }, { key: 'app', type: 'apps', id: args.appId });
            const response = await write(ctx, 'POST', '/appStoreVersions', body);
            return response?.data ?? response;
        }
        case 'appstore_submit_for_review': {
            const body = createBody('appStoreReviewRequests', undefined, { key: 'appStoreVersion', type: 'appStoreVersions', id: args.versionId });
            const response = await write(ctx, 'POST', '/appStoreReviewRequests', body);
            return response?.data ?? response;
        }
        case 'appstore_cancel_review':
            await write(ctx, 'DELETE', `/appStoreReviewRequests/${enc(args.reviewRequestId)}`, null);
            return { success: true, deleted: args.reviewRequestId };
        case 'appstore_create_phased_release': {
            const body = createBody(
                'appStoreVersionPhasedReleases',
                { phasedReleaseState: 'ACTIVE' },
                { key: 'appStoreVersion', type: 'appStoreVersions', id: args.versionId }
            );
            const response = await write(ctx, 'POST', '/appStoreVersionPhasedReleases', body);
            return response?.data ?? response;
        }
        case 'appstore_update_phased_release': {
            const body = patchBody('appStoreVersionPhasedReleases', args.phasedReleaseId, { phasedReleaseState: args.phasedReleaseState });
            const response = await write(ctx, 'PATCH', `/appStoreVersionPhasedReleases/${enc(args.phasedReleaseId)}`, body);
            return response?.data ?? response;
        }
        case 'appstore_delete_phased_release':
            await write(ctx, 'DELETE', `/appStoreVersionPhasedReleases/${enc(args.phasedReleaseId)}`, null);
            return { success: true, deleted: args.phasedReleaseId };
        case 'appstore_release_version': {
            const body = createBody('appStoreVersionReleaseRequests', undefined, { key: 'appStoreVersion', type: 'appStoreVersions', id: args.versionId });
            const response = await write(ctx, 'POST', '/appStoreVersionReleaseRequests', body);
            return response?.data ?? response;
        }
        case 'appstore_upsert_review_detail':
            return upsertReviewDetail(ctx, args);
        case 'appstore_update_version_localization': {
            const body = patchBody('appStoreVersionLocalizations', args.localizationId, pick(args, VERSION_LOC_FIELDS));
            const response = await write(ctx, 'PATCH', `/appStoreVersionLocalizations/${enc(args.localizationId)}`, body);
            return response?.data ?? response;
        }
        case 'appstore_create_version_localization': {
            const body = createBody(
                'appStoreVersionLocalizations',
                { locale: args.locale, ...pick(args, ['description', 'keywords', 'promotionalText', 'whatsNew']) },
                { key: 'appStoreVersion', type: 'appStoreVersions', id: args.appStoreVersionId }
            );
            const response = await write(ctx, 'POST', '/appStoreVersionLocalizations', body);
            return response?.data ?? response;
        }
        case 'appstore_batch_update_version_localizations':
            return runBatch(ctx, args.updates, (update) => {
                const { localizationId, ...fields } = update;
                return write(ctx, 'PATCH', `/appStoreVersionLocalizations/${enc(localizationId)}`, patchBody('appStoreVersionLocalizations', localizationId, pick(fields, VERSION_LOC_FIELDS)));
            }, (update) => update.localizationId);
        case 'appstore_update_app_info_localization': {
            const body = patchBody('appInfoLocalizations', args.appInfoLocalizationId, pick(args, APP_INFO_FIELDS));
            const response = await write(ctx, 'PATCH', `/appInfoLocalizations/${enc(args.appInfoLocalizationId)}`, body);
            return response?.data ?? response;
        }
        case 'appstore_batch_update_app_info_localizations':
            return runBatch(ctx, args.updates, (update) => {
                const { appInfoLocalizationId, ...fields } = update;
                return write(ctx, 'PATCH', `/appInfoLocalizations/${enc(appInfoLocalizationId)}`, patchBody('appInfoLocalizations', appInfoLocalizationId, pick(fields, APP_INFO_FIELDS)));
            }, (update) => update.appInfoLocalizationId);
        case 'appstore_upload_screenshots':
            return args.legacy ? uploadScreenshots(ctx, args) : uploadLibraryScreenshots(ctx, args);
        case 'appstore_upload_asset_library_image':
            return uploadLibraryImage(ctx, args);
        case 'appstore_create_asset_placement':
            return createAssetPlacement(ctx, args);
        case 'appstore_order_asset_placements':
            return orderAssetPlacements(ctx, args);
        case 'appstore_delete_asset_placement':
            await write(ctx, 'DELETE', `/appAssetLibraryPlacements/${enc(args.placementId)}`, null);
            return { success: true, placementId: args.placementId };
        case 'appstore_delete_asset_library_image':
            return deleteLibraryImage(ctx, args.imageId);
        case 'appstore_delete_screenshot_set':
            return deleteScreenshotSet(ctx, args.screenshotSetId);
        case 'appstore_create_cpp':
            return createCpp(ctx, args);
        case 'appstore_update_cpp_promo': {
            const body = patchBody('appCustomProductPageLocalizations', args.localeId, { promotionalText: args.promotionalText });
            const response = await write(ctx, 'PATCH', `/appCustomProductPageLocalizations/${enc(args.localeId)}`, body);
            return response?.data ?? response;
        }
        case 'appstore_delete_cpp': {
            if (!ctx.execute) {
                ctx.steps.push({ method: 'GET', path: `/appCustomProductPages/${enc(args.cppId)}/appCustomProductPageVersions`, body: null });
                ctx.steps.push({ method: 'GET', path: '/appCustomProductPageVersions/{versionId}/appCustomProductPageLocalizations', body: null });
                ctx.steps.push({ method: 'GET', path: '/appCustomProductPageLocalizations/{localizationId}/placements', body: null });
                ctx.steps.push({ method: 'DELETE', path: '/appAssetLibraryPlacements/{placementId}', body: null, note: '先删 placement：CPP 删除后残留的 INACTIVE placement 无法再删，图片会卡在素材库' });
                await write(ctx, 'DELETE', `/appCustomProductPages/${enc(args.cppId)}`, null);
                return;
            }
            const detachedPlacementIds = await detachCppPlacements(ctx.client!, args.cppId);
            await write(ctx, 'DELETE', `/appCustomProductPages/${enc(args.cppId)}`, null);
            return { success: true, deleted: args.cppId, detachedPlacementIds };
        }
        case 'appstore_create_event': {
            const body = createBody('appEvents', pick(args, EVENT_FIELDS), { key: 'app', type: 'apps', id: args.appId });
            const response = await write(ctx, 'POST', '/appEvents', body);
            return response?.data ?? response;
        }
        case 'appstore_update_event': {
            const body = patchBody('appEvents', args.eventId, pick(args, EVENT_FIELDS));
            const response = await write(ctx, 'PATCH', `/appEvents/${enc(args.eventId)}`, body);
            return response?.data ?? response;
        }
        case 'appstore_delete_event':
            await write(ctx, 'DELETE', `/appEvents/${enc(args.eventId)}`, null);
            return { success: true, deleted: args.eventId };
        case 'appstore_create_event_localization': {
            const body = createBody(
                'appEventLocalizations',
                pick(args, ['locale', 'name', 'shortDescription', 'longDescription', 'promotionalText']),
                { key: 'appEvent', type: 'appEvents', id: args.eventId }
            );
            const response = await write(ctx, 'POST', '/appEventLocalizations', body);
            return response?.data ?? response;
        }
        case 'appstore_update_event_localization': {
            const body = patchBody('appEventLocalizations', args.localizationId, pick(args, ['name', 'shortDescription', 'longDescription', 'promotionalText']));
            const response = await write(ctx, 'PATCH', `/appEventLocalizations/${enc(args.localizationId)}`, body);
            return response?.data ?? response;
        }
        case 'appstore_submit_event': {
            const body = createBody('appEventSubmissions', undefined, { key: 'appEvent', type: 'appEvents', id: args.eventId });
            const response = await write(ctx, 'POST', '/appEventSubmissions', body);
            return response?.data ?? { id: response?.data?.id, eventId: args.eventId };
        }
        case 'appstore_invite_user': {
            const body = createBody('userInvitations', {
                email: args.email,
                firstName: args.firstName,
                lastName: args.lastName,
                roles: args.roles,
                allAppsVisible: args.allAppsVisible ?? false,
                provisioningAllowed: args.provisioningAllowed ?? false,
            });
            await write(ctx, 'POST', '/userInvitations', body);
            return { success: true };
        }
        case 'appstore_remove_user':
            await write(ctx, 'DELETE', `/users/${enc(args.userId)}`, null);
            return { success: true, deleted: args.userId };
        case 'appstore_update_user_roles': {
            const body = patchBody('users', args.userId, { roles: args.roles });
            await write(ctx, 'PATCH', `/users/${enc(args.userId)}`, body);
            return { success: true };
        }
        case 'appstore_add_build_to_beta_group': {
            const body = { data: [{ type: 'builds', id: args.buildId }] };
            await write(ctx, 'POST', `/betaGroups/${enc(args.betaGroupId)}/relationships/builds`, body);
            return { success: true };
        }
        case 'appstore_remove_build_from_beta_group': {
            const body = { data: [{ type: 'builds', id: args.buildId }] };
            await write(ctx, 'DELETE', `/betaGroups/${enc(args.betaGroupId)}/relationships/builds`, body);
            return { success: true };
        }
        case 'appstore_add_beta_tester': {
            const body = createBody('betaTesters', pick(args, ['email', 'firstName', 'lastName']));
            (body.data as { relationships?: unknown }).relationships = {
                betaGroups: { data: (args.betaGroupIds as string[]).map((groupId) => ({ type: 'betaGroups', id: groupId })) },
            };
            await write(ctx, 'POST', '/betaTesters', body);
            return { success: true };
        }
        case 'appstore_upsert_beta_localization':
            return upsertBetaLocalization(ctx, args);
        default:
            throw new CliUsage(`未实现的写命令: ${name}`);
    }
}

async function respondToReview(ctx: Ctx, reviewId: string, responseBody: string) {
    let existingId: string | undefined;
    try {
        const existing = await read(ctx, `/customerReviews/${enc(reviewId)}/response`);
        existingId = existing?.data?.id;
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
    if (existingId) {
        const body = patchBody('customerReviewResponses', existingId, { responseBody });
        await write(ctx, 'PATCH', `/customerReviewResponses/${enc(existingId)}`, body);
    } else {
        const body = createBody('customerReviewResponses', { responseBody }, { key: 'review', type: 'customerReviews', id: reviewId });
        await write(ctx, 'POST', '/customerReviewResponses', body);
    }
    return { success: true, reviewId };
}

async function deleteReviewResponse(ctx: Ctx, reviewId: string) {
    let existingId: string | undefined;
    try {
        const existing = await read(ctx, `/customerReviews/${enc(reviewId)}/response`);
        existingId = existing?.data?.id;
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
    if (existingId) await write(ctx, 'DELETE', `/customerReviewResponses/${enc(existingId)}`, null);
    return { success: true };
}

async function upsertReviewDetail(ctx: Ctx, args: Record<string, any>) {
    const attributes = pick(args, REVIEW_DETAIL_FIELDS);
    let existingId: string | undefined;
    try {
        const existing = await read(ctx, `/appStoreVersions/${enc(args.versionId)}/appStoreReviewDetail`);
        existingId = existing?.data?.id;
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
    if (existingId) {
        const body = patchBody('appStoreReviewDetails', existingId, attributes);
        const response = await write(ctx, 'PATCH', `/appStoreReviewDetails/${enc(existingId)}`, body);
        return response?.data ?? response;
    }
    const body = createBody('appStoreReviewDetails', attributes, { key: 'appStoreVersion', type: 'appStoreVersions', id: args.versionId });
    const response = await write(ctx, 'POST', '/appStoreReviewDetails', body);
    return response?.data ?? response;
}

async function deleteScreenshotSet(ctx: Ctx, screenshotSetId: string) {
    const setResp = await read(ctx, `/appScreenshotSets/${enc(screenshotSetId)}`, { include: 'appScreenshots' });
    const screenshotIds: string[] = (setResp?.data?.relationships?.appScreenshots?.data || []).map((shot: { id: string }) => shot.id);
    for (const shotId of screenshotIds) await write(ctx, 'DELETE', `/appScreenshots/${enc(shotId)}`, null);
    await write(ctx, 'DELETE', `/appScreenshotSets/${enc(screenshotSetId)}`, null);
    return { success: true, screenshotSetId, deletedScreenshots: screenshotIds.length };
}

async function uploadLibraryImage(ctx: Ctx, args: Record<string, any>) {
    if (!ctx.execute) {
        ctx.steps.push({ method: 'GET', path: `/apps/${enc(args.appId)}/assetLibrary`, body: null });
        ctx.steps.push({ method: 'POST', path: '/appAssetLibraryImages', body: reserveImageBody('{assetLibraryId}', args.file, args.category) });
        ctx.steps.push(plannedUploadStep());
        ctx.steps.push({ method: 'PATCH', path: '/appAssetLibraryImages/{reservedId}', body: commitImageBody('{reservedId}') });
        ctx.steps.push({ method: 'GET', path: '/appAssetLibraryImages/{reservedId}', body: null, note: '轮询直到 specId 和终态可用' });
        return;
    }
    const libraryId = await libraryIdForApp(ctx.client!, args.appId);
    return uploadImage(ctx.client!, libraryId, args.file, args.category);
}

async function appForTarget(client: AppStoreConnectClient, args: Record<string, any>): Promise<string> {
    const t = targetOf(args);
    if (t.key === 'appStoreVersionLocalization') {
        const loc = await client.get<any>(`/appStoreVersionLocalizations/${enc(t.id)}`, { include: 'appStoreVersion' });
        const versionId = loc.data?.relationships?.appStoreVersion?.data?.id;
        if (!versionId) throw new CliUsage('版本本地化没有 appStoreVersion 关系');
        const version = await client.get<any>(`/appStoreVersions/${enc(versionId)}`, { include: 'app' });
        const appId = version.data?.relationships?.app?.data?.id;
        if (!appId) throw new CliUsage('版本没有 app 关系');
        return appId;
    }
    const loc = await client.get<any>(`/appCustomProductPageLocalizations/${enc(t.id)}`, { include: 'appCustomProductPageVersion' });
    const versionId = loc.data?.relationships?.appCustomProductPageVersion?.data?.id;
    if (!versionId) throw new CliUsage('CPP 本地化没有版本关系');
    const version = await client.get<any>(`/appCustomProductPageVersions/${enc(versionId)}`, { include: 'appCustomProductPage' });
    const cppId = version.data?.relationships?.appCustomProductPage?.data?.id;
    const cpp = await client.get<any>(`/appCustomProductPages/${enc(cppId)}`, { include: 'app' });
    const appId = cpp.data?.relationships?.app?.data?.id;
    if (!appId) throw new CliUsage('CPP 没有 app 关系');
    return appId;
}

async function createAssetPlacement(ctx: Ctx, args: Record<string, any>) {
    const body = placementBody(args.imageId, args, args.placementType, args.placementGroup);
    if (!ctx.execute) {
        ctx.steps.push({ method: 'GET', path: '/appAssetLibraryRefData', body: null });
        ctx.steps.push({ method: 'GET', path: `/appAssetLibraryImages/${enc(args.imageId)}`, body: null });
        ctx.steps.push({ method: 'POST', path: '/appAssetLibraryPlacements', body });
        return;
    }
    const appId = await appForTarget(ctx.client!, args);
    const libraryId = await libraryIdForApp(ctx.client!, appId);
    const owned = await ctx.client!.get<any>(`/appAssetLibraries/${enc(libraryId)}/images`, { 'filter[id]': args.imageId, limit: 1 });
    if (!owned.data?.some((item: any) => item.id === args.imageId)) throw new CliUsage(`图片 ${args.imageId} 不属于目标 app ${appId}`);
    const image = await ctx.client!.get<any>(`/appAssetLibraryImages/${enc(args.imageId)}`);
    const reference = await getReference(ctx.client!);
    const specId = image.data?.attributes?.specId;
    if (!specId) throw new CliUsage(`图片 ${args.imageId} 尚未处理完成，没有 specId；请先查询状态`);
    try { validateGroup(reference, args.placementType, args.placementGroup, specId); }
    catch (error) { throw new CliUsage(error instanceof Error ? error.message : String(error)); }
    if (!(reference.placementTypes ?? []).find((t: any) => t.placementTypeId === args.placementType)?.acceptsAssetCategories?.includes(image.data?.attributes?.category)) {
        throw new CliUsage(`图片 category ${image.data?.attributes?.category} 不适用于 ${args.placementType}`);
    }
    const result = await write(ctx, 'POST', '/appAssetLibraryPlacements', body);
    return result?.data ?? result;
}

async function orderAssetPlacements(ctx: Ctx, args: Record<string, any>) {
    const body = orderBody(args.placementIds, args, args.placementGroup);
    if (!ctx.execute) {
        ctx.steps.push({ method: 'GET', path: '/appAssetLibraryRefData', body: null });
        ctx.steps.push({ method: 'POST', path: '/appAssetLibraryPlacementOrderingRequests', body });
        return;
    }
    const reference = await getReference(ctx.client!);
    if (!(reference.placementProfileGroups ?? []).some((g: any) => g.placementProfileGroupId === args.placementGroup)) {
        throw new CliUsage(`无效 placementGroup: ${args.placementGroup}；合法值: ${(reference.placementProfileGroups ?? []).map((g: any) => g.placementProfileGroupId).join(', ')}`);
    }
    const target = targetOf(args);
    for (const placementId of args.placementIds) {
        const item = await ctx.client!.get<any>(`/appAssetLibraryPlacements/${enc(placementId)}`, { include: target.key });
        if (item.data?.relationships?.[target.key]?.data?.id !== target.id || item.data?.attributes?.placementGroup !== args.placementGroup) {
            throw new CliUsage(`placement ${placementId} 不属于目标本地化和 group`);
        }
    }
    const result = await write(ctx, 'POST', '/appAssetLibraryPlacementOrderingRequests', body);
    return result?.data ?? result;
}

async function deleteLibraryImage(ctx: Ctx, imageId: string) {
    const path = `/appAssetLibraryImages/${enc(imageId)}/placements`;
    if (!ctx.execute) {
        ctx.steps.push({ method: 'GET', path, body: null, note: '必须为空才能删除图片' });
        ctx.steps.push({ method: 'DELETE', path: `/appAssetLibraryImages/${enc(imageId)}`, body: null });
        return;
    }
    const placements = await ctx.client!.getAllPages<any>(path, {}, { limit: 1 });
    if (placements.length) throw new CliUsage(`图片 ${imageId} 仍有 placement；先用 placement delete 删除，再删图片`);
    await write(ctx, 'DELETE', `/appAssetLibraryImages/${enc(imageId)}`, null);
    return { success: true, imageId };
}

async function uploadLibraryScreenshots(ctx: Ctx, args: Record<string, any>) {
    if (args.screenshotDisplayType) throw new CliUsage('旧 display type 只支持 --legacy；请使用 asset-library reference 选择 --placement-group');
    if (!args.placementGroup) throw new CliUsage('新截图流程需要 --placement-group；用 asset-library reference 查看合法值');
    const target = { appStoreVersionLocalizationId: args.appStoreVersionLocalizationId,
        appCustomProductPageLocalizationId: args.appCustomProductPageLocalizationId };
    const t = targetOf(target);
    const path = `/${t.type}/${enc(t.id)}/placements`;
    if (!ctx.execute) {
        ctx.steps.push({ method: 'GET', path: `/${t.type}/${enc(t.id)}`, body: null, params: { include: t.key === 'appStoreVersionLocalization' ? 'appStoreVersion' : 'appCustomProductPageVersion' } });
        if (t.key === 'appStoreVersionLocalization') ctx.steps.push({ method: 'GET', path: '/appStoreVersions/{appStoreVersionId}', body: null, params: { include: 'app' } });
        else {
            ctx.steps.push({ method: 'GET', path: '/appCustomProductPageVersions/{appCustomProductPageVersionId}', body: null, params: { include: 'appCustomProductPage' } });
            ctx.steps.push({ method: 'GET', path: '/appCustomProductPages/{appCustomProductPageId}', body: null, params: { include: 'app' } });
        }
        ctx.steps.push({ method: 'GET', path: '/apps/{appId}/assetLibrary', body: null });
        ctx.steps.push({ method: 'GET', path: '/appAssetLibraryRefData', body: null });
        ctx.steps.push({ method: 'GET', path, body: null, params: { 'filter[placementType]': 'APP_SCREENSHOT', 'filter[placementGroup]': args.placementGroup, sort: 'placementGroupPosition' } });
        if (args.replaceExisting) ctx.steps.push({ method: 'DELETE', path: '/appAssetLibraryPlacements/{existingId}', body: null, note: '每个现有 placement' });
        for (const file of args.imagePaths) {
            ctx.steps.push({ method: 'POST', path: '/appAssetLibraryImages', body: reserveImageBody('{assetLibraryId}', file) });
            ctx.steps.push(plannedUploadStep());
            ctx.steps.push({ method: 'PATCH', path: '/appAssetLibraryImages/{reservedId}', body: commitImageBody('{reservedId}') });
            ctx.steps.push({ method: 'GET', path: '/appAssetLibraryImages/{reservedId}', body: null, note: '轮询直到处理完成' });
            ctx.steps.push({ method: 'POST', path: '/appAssetLibraryPlacements', body: placementBody('{reservedId}', target, 'APP_SCREENSHOT', args.placementGroup) });
        }
        ctx.steps.push({ method: 'POST', path: '/appAssetLibraryPlacementOrderingRequests', body: orderBody(['{existingOrCreatedPlacementIds}'], target, args.placementGroup) });
        return;
    }
    const appId = await appForTarget(ctx.client!, target);
    if (args.appId && args.appId !== appId) throw new CliUsage(`--app-id ${args.appId} 与本地化所属 app ${appId} 不一致`);
    const libraryId = await libraryIdForApp(ctx.client!, appId);
    const reference = await getReference(ctx.client!);
    try { validateGroup(reference, 'APP_SCREENSHOT', args.placementGroup); }
    catch (error) { throw new CliUsage(error instanceof Error ? error.message : String(error)); }
    const existing = await ctx.client!.getAllPages<any>(path, { 'filter[placementType]': 'APP_SCREENSHOT', 'filter[placementGroup]': args.placementGroup, sort: 'placementGroupPosition' });
    const feature = t.key === 'appStoreVersionLocalization' ? 'APP_STORE_VERSIONS' : 'CUSTOM_PRODUCT_PAGES';
    let maxCount: number;
    try { maxCount = screenshotLimit(reference, feature, args.placementGroup); }
    catch (error) { throw new CliUsage(error instanceof Error ? error.message : String(error)); }
    const targetCount = (args.replaceExisting ? 0 : existing.length) + args.imagePaths.length;
    if (targetCount > maxCount) {
        throw new CliUsage(`该 group 最多 ${maxCount} 张截图；当前 ${existing.length} 张，本次 ${args.imagePaths.length} 张。可使用 --replace-existing true`);
    }
    const ids: string[] = args.replaceExisting ? [] : existing.map((item) => item.id);
    const uploaded: { id: string; state: string; specId: string }[] = [];
    for (const file of args.imagePaths) {
        const image = await uploadImage(ctx.client!, libraryId, file);
        try { validateGroup(reference, 'APP_SCREENSHOT', args.placementGroup, image.specId); }
        catch (error) { throw new CliUsage(error instanceof Error ? error.message : String(error)); }
        uploaded.push({ id: image.id, state: image.state, specId: image.specId });
    }
    if (args.replaceExisting) for (const item of existing) await ctx.client!.delete(`/appAssetLibraryPlacements/${enc(item.id)}`);
    const createdPlacementIds: string[] = [];
    for (const image of uploaded) {
        const created = await ctx.client!.post<any>('/appAssetLibraryPlacements', placementBody(image.id, target, 'APP_SCREENSHOT', args.placementGroup));
        ids.push(created.data.id);
        createdPlacementIds.push(created.data.id);
    }
    await ctx.client!.post('/appAssetLibraryPlacementOrderingRequests', orderBody(ids, target, args.placementGroup));
    return { success: true, appId, uploaded, createdPlacementIds, orderedPlacementIds: ids, placementGroup: args.placementGroup };
}

async function uploadScreenshots(ctx: Ctx, args: Record<string, any>) {
    if (!args.screenshotDisplayType) throw new CliUsage('--legacy 需要 --screenshot-display-type');
    const imagePaths = (args.imagePaths ?? []) as string[];
    try {
        assertReadableFiles(imagePaths);
    } catch (error) {
        throw new CliUsage(error instanceof Error ? error.message : String(error));
    }
    const replace = args.replaceExisting !== false;
    if (replace) {
        const existing = await read(
            ctx,
            `/appStoreVersionLocalizations/${enc(args.appStoreVersionLocalizationId)}/appScreenshotSets`,
            { 'filter[screenshotDisplayType]': args.screenshotDisplayType, include: 'appScreenshots' }
        );
        for (const set of existing?.data || []) {
            const ids: string[] = (set.relationships?.appScreenshots?.data || []).map((shot: { id: string }) => shot.id);
            for (const shotId of ids) await write(ctx, 'DELETE', `/appScreenshots/${enc(shotId)}`, null);
            await write(ctx, 'DELETE', `/appScreenshotSets/${enc(set.id)}`, null);
        }
    }
    const createBodyJson = screenshotSetBody(args.appStoreVersionLocalizationId, args.screenshotDisplayType);
    const created = await write(ctx, 'POST', '/appScreenshotSets', createBodyJson);
    const setId = (created?.data?.id as string | undefined) ?? '{createdSetId}';
    const screenshotIds: string[] = [];
    for (const imagePath of imagePaths) {
        if (ctx.execute && ctx.client) {
            const realId = await uploadScreenshot(ctx.client, setId, imagePath);
            ctx.steps.push({ method: 'POST', path: '/appScreenshots', body: reserveScreenshotBody(setId, imagePath) });
            ctx.steps.push(plannedUploadStep());
            ctx.steps.push({ method: 'PATCH', path: `/appScreenshots/${realId}`, body: commitScreenshotBody(realId, imagePath) });
            screenshotIds.push(realId);
        } else {
            ctx.steps.push({ method: 'POST', path: '/appScreenshots', body: reserveScreenshotBody(setId, imagePath) });
            ctx.steps.push(plannedUploadStep());
            ctx.steps.push({ method: 'PATCH', path: '/appScreenshots/{reservedId}', body: commitScreenshotBody('{reservedId}', imagePath) });
            screenshotIds.push('{reservedId}');
        }
    }
    return { success: true, setId, screenshotDisplayType: args.screenshotDisplayType, screenshotIds };
}

export function assertWriteInputs(name: string, args: Record<string, unknown>): void {
    if (name === 'appstore_upload_screenshots' || name === 'appstore_upload_asset_library_image') {
        const paths = name === 'appstore_upload_asset_library_image'
            ? [args.file].filter((item): item is string => typeof item === 'string')
            : Array.isArray(args.imagePaths) ? args.imagePaths.filter((item): item is string => typeof item === 'string') : [];
        try {
            assertReadableFiles(paths);
        } catch (error) {
            throw new CliUsage(error instanceof Error ? error.message : String(error));
        }
    }
    if (name === 'appstore_create_cpp') {
        const files = [args.cppImagePath, ...(Array.isArray(args.templateShotPaths) ? args.templateShotPaths : [])].filter(
            (file): file is string => typeof file === 'string'
        );
        try {
            assertReadableFiles(files);
        } catch (error) {
            throw new CliUsage(error instanceof Error ? error.message : String(error));
        }
    }
}

async function createCpp(ctx: Ctx, args: Record<string, any>) {
    const files = [args.cppImagePath, ...(Array.isArray(args.templateShotPaths) ? args.templateShotPaths : [])].filter(
        (file): file is string => typeof file === 'string'
    );
    try {
        assertReadableFiles(files);
    } catch (error) {
        throw new CliUsage(error instanceof Error ? error.message : String(error));
    }
    if (typeof args.promotionalText === 'string' && args.promotionalText.length > 170) {
        throw new CliUsage(`promotionalText exceeds 170 chars (${args.promotionalText.length})`);
    }
    const body = buildCppCreateBody(args.appId, args.name, args.promotionalText, args.locale ?? '{appPrimaryLocale}');
    if (!ctx.execute) {
        if (!args.legacy) {
            const group = args.placementGroup ?? 'IPHONE_FACE_ID_LARGE_PROFILE';
            const target = { appCustomProductPageLocalizationId: '{localeId}' };
            ctx.steps.push({ method: 'GET', path: '/appAssetLibraryRefData', body: null, note: '建 CPP 前校验 group 与截图数量上限' });
            ctx.steps.push({ method: 'GET', path: `/apps/${enc(args.appId)}/assetLibrary`, body: null });
            ctx.steps.push({ method: 'POST', path: '/appCustomProductPages', body });
            for (const file of files) {
                ctx.steps.push({ method: 'POST', path: '/appAssetLibraryImages', body: reserveImageBody('{assetLibraryId}', file) });
                ctx.steps.push(plannedUploadStep());
                ctx.steps.push({ method: 'PATCH', path: '/appAssetLibraryImages/{reservedId}', body: commitImageBody('{reservedId}') });
                ctx.steps.push({ method: 'GET', path: '/appAssetLibraryImages/{reservedId}', body: null, note: '轮询直到处理完成并校验 specId' });
                ctx.steps.push({ method: 'POST', path: '/appAssetLibraryPlacements', body: placementBody('{reservedId}', target, 'APP_SCREENSHOT', group) });
            }
            ctx.steps.push({ method: 'POST', path: '/appAssetLibraryPlacementOrderingRequests', body: orderBody(['{createdPlacementIds}'], target, group) });
            return;
        }
        ctx.steps.push({ method: 'POST', path: '/appCustomProductPages', body });
        const setBody = {
            data: {
                type: 'appScreenshotSets',
                attributes: { screenshotDisplayType: 'APP_IPHONE_65' },
                relationships: {
                    appCustomProductPageLocalization: {
                        data: { type: 'appCustomProductPageLocalizations', id: '{localeId}' },
                    },
                },
            },
        };
        ctx.steps.push({ method: 'POST', path: '/appScreenshotSets', body: setBody });
        for (const file of files) {
            ctx.steps.push({ method: 'POST', path: '/appScreenshots', body: reserveScreenshotBody('{screenshotSetId}', file) });
            ctx.steps.push(plannedUploadStep());
            ctx.steps.push({ method: 'PATCH', path: '/appScreenshots/{reservedId}', body: commitScreenshotBody('{reservedId}', file) });
        }
        return { dry_run: true };
    }
    if (!ctx.client) throw new CliUsage('没有可用的客户端');
    try {
        return await new CppManager(ctx.client, args.appId).createCpp(args.name, args.promotionalText, args.cppImagePath, args.templateShotPaths ?? [], args.placementGroup, args.legacy, args.locale);
    } catch (error) {
        if (error instanceof CppPreflightError) throw new CliUsage(error.message);
        throw error;
    }
}

async function upsertBetaLocalization(ctx: Ctx, args: Record<string, any>) {
    const attributes = pick(args, ['locale', 'description', 'feedbackEmail', 'marketingUrl', 'privacyPolicyUrl']);
    const listed = await read(ctx, `/apps/${enc(args.appId)}/betaAppLocalizations`);
    const existing = (listed?.data || []).find((item: { attributes?: { locale?: string }; id?: string }) => item.attributes?.locale === args.locale);
    if (existing?.id) {
        const body = patchBody('betaAppLocalizations', existing.id, attributes);
        const response = await write(ctx, 'PATCH', `/betaAppLocalizations/${enc(existing.id)}`, body);
        return response?.data ?? response;
    }
    const body = createBody('betaAppLocalizations', attributes, { key: 'app', type: 'apps', id: args.appId });
    const response = await write(ctx, 'POST', '/betaAppLocalizations', body);
    return response?.data ?? response;
}

async function runBatch(
    ctx: Ctx,
    updates: any[] | undefined,
    fn: (update: any) => Promise<unknown>,
    idOf: (update: any) => string
) {
    if (!Array.isArray(updates)) throw new CliUsage('updates 必须是数组');
    const results: { success: boolean; id: string; error?: string }[] = [];
    for (const update of updates) {
        try {
            await fn(update);
            results.push({ success: true, id: idOf(update) });
        } catch (error) {
            if (!ctx.execute) throw error;
            results.push({ success: false, id: idOf(update), error: error instanceof Error ? error.message : String(error) });
        }
    }
    const succeeded = results.filter((item) => item.success).length;
    const payload = { total: updates.length, succeeded, failed: updates.length - succeeded, results };
    if (ctx.execute && payload.failed > 0) throw new PartialBatch(payload);
    return payload;
}

export function writeNeedsRead(name: string, args: Record<string, unknown>): boolean {
    if (name === 'appstore_upload_screenshots') return args.legacy === true && args.replaceExisting !== false;
    return new Set([
        'appstore_respond_to_review',
        'appstore_delete_review_response',
        'appstore_upsert_review_detail',
        'appstore_delete_screenshot_set',
        'appstore_upsert_beta_localization',
    ]).has(name);
}
