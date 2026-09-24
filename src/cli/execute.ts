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
import { uploadScreenshot } from '../mcp/tools/versions/screenshots.js';

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
    const listOpts = { all: page.all, limit: page.limit };

    switch (name) {
        case 'appstore_list_apps':
            return apps.listAppResources({ limit: page.limit, all: page.all });
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
            return builds.listBuilds(args.appId, capFor(page, args.limit), { all: page.all });
        case 'appstore_get_build':
            return builds.getBuild(args.buildId);
        case 'appstore_get_latest_build':
            return builds.getLatestBuild(args.appId);
        case 'appstore_list_builds_by_version':
            return builds.getBuildsByVersion(args.appId, args.version, capFor(page, args.limit), { all: page.all });
        case 'appstore_get_build_beta_detail':
            return builds.getBuildBetaDetail(args.buildId);
        case 'appstore_update_build_beta_detail':
            return builds.updateBuildBetaDetail(args.buildBetaDetailId, {
                autoNotifyEnabled: args.autoNotifyEnabled,
                internalBuildState: args.internalBuildState,
                externalBuildState: args.externalBuildState,
            });
        case 'appstore_list_reviews':
            return reviews.listReviews(args.appId, {
                limit: page.limit ?? (page.all ? undefined : args.limit),
                sort: args.sort,
                filterRating: args.filterRating,
                filterTerritory: args.filterTerritory,
                all: page.all,
            });
        case 'appstore_respond_to_review':
            await reviews.respondToReview(args.reviewId, args.responseBody);
            return { success: true, reviewId: args.reviewId };
        case 'appstore_delete_review_response':
            await reviews.deleteReviewResponse(args.reviewId);
            return { success: true };
        case 'appstore_list_versions':
            return versions.listVersions(args.appId, args.platform ?? 'IOS', listOpts);
        case 'appstore_get_version':
            return versions.getVersion(args.versionId);
        case 'appstore_create_version':
            return versions.createVersion(args.appId, args.versionString, args.platform);
        case 'appstore_submit_for_review':
            return versions.submitForReview(args.versionId);
        case 'appstore_cancel_review':
            await versions.cancelReview(args.reviewRequestId);
            return { success: true, deleted: args.reviewRequestId };
        case 'appstore_create_phased_release':
            return versions.createPhasedRelease(args.versionId);
        case 'appstore_get_phased_release':
            return versions.getPhasedRelease(args.versionId);
        case 'appstore_update_phased_release':
            return versions.updatePhasedRelease(args.phasedReleaseId, args.phasedReleaseState);
        case 'appstore_delete_phased_release':
            await versions.deletePhasedRelease(args.phasedReleaseId);
            return { success: true, deleted: args.phasedReleaseId };
        case 'appstore_release_version':
            return versions.releaseVersion(args.versionId);
        case 'appstore_get_review_detail':
            return versions.getReviewDetail(args.versionId);
        case 'appstore_upsert_review_detail':
            return versions.upsertReviewDetail(args.versionId, {
                contactFirstName: args.contactFirstName,
                contactLastName: args.contactLastName,
                contactPhone: args.contactPhone,
                contactEmail: args.contactEmail,
                demoAccountName: args.demoAccountName,
                demoAccountPassword: args.demoAccountPassword,
                demoAccountRequired: args.demoAccountRequired,
                notes: args.notes,
            });
        case 'appstore_list_version_localizations':
            return metadata.listVersionLocalizations(args.appStoreVersionId, listOpts);
        case 'appstore_update_version_localization':
            return metadata.updateVersionLocalization(args.localizationId, pick(args, [
                'description', 'keywords', 'promotionalText', 'whatsNew', 'marketingUrl', 'supportUrl',
            ]));
        case 'appstore_create_version_localization':
            return metadata.createVersionLocalization(args.appStoreVersionId, args.locale, pick(args, [
                'description', 'keywords', 'promotionalText', 'whatsNew',
            ]));
        case 'appstore_batch_update_version_localizations':
            return runBatch(args.updates, async (update) => {
                const { localizationId, ...fields } = update;
                return metadata.updateVersionLocalization(localizationId, fields);
            });
        case 'appstore_list_app_info_localizations':
            return metadata.listAppInfoLocalizations(args.appId, listOpts);
        case 'appstore_update_app_info_localization':
            return metadata.updateAppInfoLocalization(args.appInfoLocalizationId, pick(args, [
                'name', 'subtitle', 'privacyChoicesUrl', 'privacyPolicyText', 'privacyPolicyUrl',
            ]));
        case 'appstore_batch_update_app_info_localizations':
            return runBatch(args.updates, async (update) => {
                const { appInfoLocalizationId, ...fields } = update;
                return metadata.updateAppInfoLocalization(appInfoLocalizationId, fields);
            });
        case 'appstore_list_screenshot_sets':
            return listScreenshotSets(client, args.appStoreVersionLocalizationId);
        case 'appstore_upload_screenshots':
            return uploadScreenshots(client, args);
        case 'appstore_delete_screenshot_set':
            return deleteScreenshotSet(client, args.screenshotSetId);
        case 'appstore_list_cpps':
            return new CppManager(client, args.appId).listCpps(listOpts);
        case 'appstore_create_cpp':
            return new CppManager(client, args.appId).createCpp(args.name, args.promotionalText, args.cppImagePath, args.templateShotPaths);
        case 'appstore_update_cpp_promo':
            return new CppManager(client, args.appId ?? '').updateCppPromo(args.localeId, args.promotionalText);
        case 'appstore_delete_cpp':
            await new CppManager(client, args.appId).deleteCpp(args.cppId);
            return { success: true, deleted: args.cppId };
        case 'appstore_list_events':
            return events.listEvents(args.appId, listOpts);
        case 'appstore_create_event':
            return events.createEvent(args.appId, pick(args, [
                'referenceName', 'badge', 'eventState', 'deepLink', 'purchaseRequirement', 'primaryLocale', 'territorySchedules',
            ]));
        case 'appstore_get_event':
            return events.getEvent(args.eventId);
        case 'appstore_update_event':
            return events.updateEvent(args.eventId, pick(args, [
                'referenceName', 'badge', 'eventState', 'deepLink', 'purchaseRequirement', 'primaryLocale', 'territorySchedules',
            ]));
        case 'appstore_delete_event':
            await events.deleteEvent(args.eventId);
            return { success: true, deleted: args.eventId };
        case 'appstore_list_event_localizations':
            return events.listLocalizations(args.eventId);
        case 'appstore_create_event_localization':
            return events.createLocalization(args.eventId, pick(args, [
                'locale', 'name', 'shortDescription', 'longDescription', 'promotionalText',
            ]));
        case 'appstore_update_event_localization':
            return events.updateLocalization(args.localizationId, pick(args, [
                'name', 'shortDescription', 'longDescription', 'promotionalText',
            ]));
        case 'appstore_submit_event':
            return events.submitEvent(args.eventId);
        case 'appstore_list_users':
            return users.listUsers(capFor(page, args.limit), { all: page.all });
        case 'appstore_invite_user':
            await users.inviteUser(args.email, args.firstName, args.lastName, args.roles, args.allAppsVisible, args.provisioningAllowed);
            return { success: true };
        case 'appstore_remove_user':
            await users.removeUser(args.userId);
            return { success: true, deleted: args.userId };
        case 'appstore_update_user_roles':
            await users.updateUserRoles(args.userId, args.roles);
            return { success: true };
        case 'appstore_list_beta_groups':
            return flight.listBetaGroups(args.appId, listOpts);
        case 'appstore_add_build_to_beta_group':
            await flight.addBuildToBetaGroup(args.buildId, args.betaGroupId);
            return { success: true };
        case 'appstore_remove_build_from_beta_group':
            await flight.removeBuildFromBetaGroup(args.buildId, args.betaGroupId);
            return { success: true };
        case 'appstore_list_beta_testers':
            return flight.listBetaTesters(args.betaGroupId, capFor(page, args.limit), { all: page.all });
        case 'appstore_add_beta_tester':
            await flight.addBetaTester(args.email, args.firstName, args.lastName, args.betaGroupIds);
            return { success: true };
        case 'appstore_list_beta_localizations':
            return flight.listBetaLocalizations(args.appId);
        case 'appstore_upsert_beta_localization':
            return flight.upsertBetaLocalization(args.appId, pick(args, [
                'locale', 'description', 'feedbackEmail', 'marketingUrl', 'privacyPolicyUrl',
            ]));
        case 'appstore_list_in_app_purchases':
            return iap.listInAppPurchases(args.appId, capFor(page, args.limit), { all: page.all });
        case 'appstore_get_in_app_purchase':
            return iap.getInAppPurchase(args.inAppPurchaseId);
        case 'appstore_list_subscription_groups':
            return iap.listSubscriptionGroups(args.appId, capFor(page, args.limit), { all: page.all });
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
            return args.outputFormat === 'text' ? exporter.formatSummary(result) : result;
        }
        default:
            throw new Error(`未实现的命令: ${name}`);
    }
}

/** --all ignores zod default limits. A cap applies only when the user passed --limit. */
function capFor(page: PageOpts, schemaLimit: number | undefined): number | undefined {
    if (page.all) return page.limit;
    return page.limit ?? schemaLimit;
}

function pick<T extends Record<string, any>>(args: T, keys: string[]): any {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
        if (args[key] !== undefined) out[key] = args[key];
    }
    return out;
}

async function runBatch(updates: any[] | undefined, fn: (update: any) => Promise<unknown>) {
    if (!Array.isArray(updates)) throw new Error('updates 必须是数组');
    const results = [];
    for (const update of updates) results.push(await fn(update));
    return { total: updates.length, succeeded: results.length, results };
}

async function listScreenshotSets(client: AppStoreConnectClient, localizationId: string) {
    const resp = await client.get<any>(`/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`, {
        include: 'appScreenshots',
    });
    return (resp.data || []).map((set: any) => ({
        id: set.id,
        screenshotDisplayType: set.attributes?.screenshotDisplayType,
        screenshotCount: set.relationships?.appScreenshots?.data?.length ?? 0,
        screenshots: (set.relationships?.appScreenshots?.data || []).map((shot: any) => shot.id),
    }));
}

async function deleteScreenshotSet(client: AppStoreConnectClient, screenshotSetId: string) {
    const setResp = await client.get<any>(`/appScreenshotSets/${screenshotSetId}`, { include: 'appScreenshots' });
    const screenshotIds: string[] = (setResp.data?.relationships?.appScreenshots?.data || []).map((shot: any) => shot.id);
    for (const id of screenshotIds) await client.delete(`/appScreenshots/${id}`);
    await client.delete(`/appScreenshotSets/${screenshotSetId}`);
    return { success: true, screenshotSetId, deletedScreenshots: screenshotIds.length };
}

async function uploadScreenshots(client: AppStoreConnectClient, args: Record<string, any>) {
    if (args.replaceExisting !== false) {
        const existing = await client.get<any>(
            `/appStoreVersionLocalizations/${args.appStoreVersionLocalizationId}/appScreenshotSets`,
            { 'filter[screenshotDisplayType]': args.screenshotDisplayType, include: 'appScreenshots' }
        );
        for (const set of existing.data || []) {
            const ids: string[] = (set.relationships?.appScreenshots?.data || []).map((shot: any) => shot.id);
            for (const id of ids) await client.delete(`/appScreenshots/${id}`);
            await client.delete(`/appScreenshotSets/${set.id}`);
        }
    }
    const created = await client.post<any>('/appScreenshotSets', {
        data: {
            type: 'appScreenshotSets',
            attributes: { screenshotDisplayType: args.screenshotDisplayType },
            relationships: {
                appStoreVersionLocalization: {
                    data: { type: 'appStoreVersionLocalizations', id: args.appStoreVersionLocalizationId },
                },
            },
        },
    });
    const setId = created.data.id as string;
    const screenshotIds: string[] = [];
    for (const imagePath of args.imagePaths as string[]) {
        screenshotIds.push(await uploadScreenshot(client, setId, imagePath));
    }
    return { success: true, setId, screenshotDisplayType: args.screenshotDisplayType, screenshotIds };
}
