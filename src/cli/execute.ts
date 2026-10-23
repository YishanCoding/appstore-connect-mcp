import { AppStoreConnectClient } from '../programs/api-client/client.js';
import { AscHttpError } from '../programs/api-client/policy.js';
import { AnalyticsManager, FullHistoryExporter } from '../programs/analytics/index.js';
import { AppManager } from '../programs/apps/index.js';
import { BuildManager } from '../programs/builds/index.js';
import { CppManager } from '../programs/cpp/index.js';
import { EventManager } from '../programs/events/index.js';
import { IapManager } from '../programs/iap/index.js';
import { MetadataManager } from '../programs/metadata/index.js';
import { ReviewManager } from '../programs/reviews/index.js';
import { TestFlightManager } from '../programs/testflight/index.js';
import { UserManager } from '../programs/users/index.js';
import { VersionManager } from '../programs/versions/index.js';
import { ReviewSubmissionManager } from '../programs/review-submissions/review-submission-manager.js';
import { ExportFailed, runWrite } from './write-call.js';
import { TOOL_META } from './meta.js';
import { getReference, libraryIdForApp, targetOf } from '../programs/assets/library.js';

export interface PageOpts {
    all: boolean;
    limit?: number;
}

export async function executeTool(
    name: string,
    args: Record<string, any>,
    client: AppStoreConnectClient,
    page: PageOpts
): Promise<unknown> {
    const apps = new AppManager(client);
    const builds = new BuildManager(client);
    const reviews = new ReviewManager(client);
    const versions = new VersionManager(client);
    const metadata = new MetadataManager(client);
    const users = new UserManager(client);
    const events = new EventManager(client);
    const flight = new TestFlightManager(client);
    const iap = new IapManager(client);
    const paging = effectivePage(page);
    const listOpts = { all: paging.all, limit: paging.limit };

    if (TOOL_META[name]?.kind === 'write') {
        return runWrite(client, name, args, true);
    }

    switch (name) {
        case 'appstore_list_apps':
            return apps.listAppResources({ limit: paging.limit, all: paging.all });
        case 'appstore_get_app': {
            if (args.appId) return apps.getApp(args.appId);
            const found = await apps.getAppByBundleId(args.bundleId);
            if (!found) throw new AscHttpError(404, 'NOT_FOUND', 'No app matches that bundle id');
            return found;
        }
        case 'appstore_validate_credentials': {
            const listed = await apps.listApps(1);
            return { success: true, message: 'Credentials are valid', appsFound: listed.length };
        }
        case 'appstore_list_builds':
            return builds.listBuilds(args.appId, capFor(paging, args.limit), { all: paging.all });
        case 'appstore_get_build':
            return builds.getBuild(args.buildId);
        case 'appstore_get_latest_build':
            return builds.getLatestBuild(args.appId);
        case 'appstore_list_builds_by_version':
            return builds.getBuildsByVersion(args.appId, args.version, capFor(paging, args.limit), { all: paging.all });
        case 'appstore_get_build_beta_detail':
            return builds.getBuildBetaDetail(args.buildId);
        case 'appstore_list_reviews':
            return reviews.listReviews(args.appId, {
                limit: paging.limit ?? (paging.all ? undefined : args.limit),
                sort: args.sort,
                filterRating: args.filterRating,
                filterTerritory: args.filterTerritory,
                all: paging.all,
            });
        case 'appstore_list_versions':
            return versions.listVersions(args.appId, args.platform ?? 'IOS', listOpts);
        case 'appstore_list_review_submissions':
            return new ReviewSubmissionManager(client).list(args.appId);
        case 'appstore_get_version':
            return versions.getVersion(args.versionId);
        case 'appstore_get_phased_release':
            return versions.getPhasedRelease(args.versionId);
        case 'appstore_get_review_detail':
            return versions.getReviewDetail(args.versionId);
        case 'appstore_list_version_localizations':
            return metadata.listVersionLocalizations(args.appStoreVersionId, listOpts);
        case 'appstore_list_app_info_localizations':
            return metadata.listAppInfoLocalizations(args.appId, listOpts);
        case 'appstore_list_screenshot_sets':
            return listScreenshotSets(client, args.appStoreVersionLocalizationId, paging);
        case 'appstore_get_asset_library':
            return (await client.get<any>(`/apps/${encodeURIComponent(args.appId)}/assetLibrary`)).data;
        case 'appstore_list_asset_library_images': {
            const libraryId = await libraryIdForApp(client, args.appId);
            const images = await client.getAllPages<any>(`/appAssetLibraries/${encodeURIComponent(libraryId)}/images`, {}, { limit: paging.limit });
            return images.map((image) => ({ id: image.id, state: image.attributes?.state, specId: image.attributes?.specId,
                width: image.attributes?.imageAsset?.width, height: image.attributes?.imageAsset?.height,
                fileName: image.attributes?.fileName, category: image.attributes?.category }));
        }
        case 'appstore_get_asset_library_reference':
            await libraryIdForApp(client, args.appId);
            return getReference(client);
        case 'appstore_list_asset_placements': {
            const target = targetOf(args);
            const path = `/${target.type}/${encodeURIComponent(target.id)}/placements`;
            const placements = await client.getAllPages<any>(path, { sort: 'placementGroupPosition', include: 'image,video' }, { limit: paging.limit });
            return placements.map((placement) => ({ id: placement.id, ...placement.attributes,
                imageId: placement.relationships?.image?.data?.id, videoId: placement.relationships?.video?.data?.id }));
        }
        case 'appstore_list_creative_assets': {
            const target = targetOf(args);
            const path = `/${target.type}/${encodeURIComponent(target.id)}/placements`;
            const placements = await client.getAllPages<any>(path, { 'filter[placementGroup]': 'DEFAULT_PROFILE', include: 'image' });
            const result = [];
            for (const placement of placements) {
                if (!['PRODUCT_PAGE_HEADER_ASSET', 'APP_STORE_SEARCH_RESULTS_ASSET', 'EVENT_CARD_ASSET', 'EVENT_DETAILS_PAGE_ASSET']
                    .includes(placement.attributes?.placementType)) continue;
                const imageId = placement.relationships?.image?.data?.id;
                if (!imageId) continue;
                const image = await client.get<any>(`/appAssetLibraryImages/${encodeURIComponent(imageId)}`);
                if (image.data?.attributes?.category !== 'CREATIVE_ASSETS') continue;
                result.push({ placementId: placement.id, type: placement.attributes?.placementType,
                    state: placement.attributes?.state, imageId, specId: image.data.attributes?.specId,
                    width: image.data.attributes?.imageAsset?.width, height: image.data.attributes?.imageAsset?.height });
            }
            return result;
        }
        case 'appstore_list_cpps':
            return new CppManager(client, args.appId).listCpps(listOpts);
        case 'appstore_list_events':
            return events.listEvents(args.appId, listOpts);
        case 'appstore_get_event':
            return events.getEvent(args.eventId);
        case 'appstore_list_event_localizations':
            return events.listLocalizations(args.eventId, { all: paging.all, limit: paging.limit });
        case 'appstore_list_users':
            return users.listUsers(capFor(paging, args.limit), { all: paging.all });
        case 'appstore_list_beta_groups':
            return flight.listBetaGroups(args.appId, listOpts);
        case 'appstore_list_beta_testers':
            return flight.listBetaTesters(args.betaGroupId, capFor(paging, args.limit), { all: paging.all });
        case 'appstore_list_beta_localizations':
            return flight.listBetaLocalizations(args.appId, { all: paging.all, limit: paging.limit });
        case 'appstore_list_in_app_purchases':
            return iap.listInAppPurchases(args.appId, capFor(paging, args.limit), { all: paging.all });
        case 'appstore_get_in_app_purchase':
            return iap.getInAppPurchase(args.inAppPurchaseId);
        case 'appstore_list_subscription_groups':
            return iap.listSubscriptionGroups(args.appId, capFor(paging, args.limit), { all: paging.all });
        case 'appstore_get_analytics_by_source': {
            const manager = new AnalyticsManager();
            const result = await manager.getBySourceType(args.adamId, args.startDate, args.endDate, args.frequency);
            return args.outputFormat === 'text' ? manager.formatAsText(result) : result;
        }
        case 'appstore_export_full_history': {
            const exporter = new FullHistoryExporter();
            const result = await exporter.export({
                adamId: args.adamId,
                outputDir: args.outputDir,
                startDate: args.startDate,
                endDate: args.endDate,
                sessionName: args.sessionName,
                metrics: args.metrics,
                dimensions: args.dimensions,
            });
            if (Array.isArray(result.failed) && result.failed.length > 0) throw new ExportFailed(result);
            return args.outputFormat === 'text' ? exporter.formatSummary(result) : result;
        }
        default:
            throw new Error(`未实现的命令: ${name}`);
    }
}

/** A limit above the API page size follows links.next instead of silently stopping at 200. */
function effectivePage(page: PageOpts): PageOpts {
    if (!page.all && page.limit != null && page.limit > 200) return { all: true, limit: page.limit };
    return page;
}

/** --all ignores zod default limits. A cap applies only when the user passed --limit. */
function capFor(page: PageOpts, schemaLimit: number | undefined): number | undefined {
    if (page.all) return page.limit;
    return page.limit ?? schemaLimit;
}

function mapScreenshotSets(sets: any[]) {
    return sets.map((set) => ({
        id: set.id,
        screenshotDisplayType: set.attributes?.screenshotDisplayType,
        screenshotCount: set.relationships?.appScreenshots?.data?.length ?? 0,
        screenshots: (set.relationships?.appScreenshots?.data || []).map((shot: any) => shot.id),
    }));
}

async function listScreenshotSets(client: AppStoreConnectClient, localizationId: string, page: PageOpts) {
    const path = `/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`;
    const params = { include: 'appScreenshots' };
    if (page.all) {
        const items = await client.getAllPages<any>(path, params, { limit: page.limit });
        return mapScreenshotSets(items);
    }
    const resp = await client.get<any>(path, params);
    const data = page.limit ? (resp.data || []).slice(0, page.limit) : (resp.data || []);
    return mapScreenshotSets(data);
}
