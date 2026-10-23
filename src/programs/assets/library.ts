import axios from 'axios';
import { readFileSync, statSync } from 'fs';
import { basename } from 'path';
import type { AppStoreConnectClient } from '../api-client/client.js';

export type Target = { appStoreVersionLocalizationId?: string; appCustomProductPageLocalizationId?: string;
    appEventLocalizationId?: string; appStoreVersionExperimentTreatmentLocalizationId?: string };

export function targetOf(target: Target) {
    const selected = [
        { key: 'appStoreVersionLocalization', type: 'appStoreVersionLocalizations', id: target.appStoreVersionLocalizationId },
        { key: 'appCustomProductPageLocalization', type: 'appCustomProductPageLocalizations', id: target.appCustomProductPageLocalizationId },
        { key: 'appEventLocalization', type: 'appEventLocalizations', id: target.appEventLocalizationId },
        { key: 'appStoreVersionExperimentTreatmentLocalization', type: 'appStoreVersionExperimentTreatmentLocalizations', id: target.appStoreVersionExperimentTreatmentLocalizationId },
    ].filter((item) => !!item.id);
    if (selected.length !== 1) throw new Error('必须且只能指定一个本地化 ID');
    return selected[0] as { key: string; type: string; id: string };
}

export const relationship = (type: string, id: string) => ({ data: { type, id } });

export function reserveImageBody(libraryId: string, file: string, category = 'APP_SCREENSHOTS_AND_PREVIEWS') {
    return { data: { type: 'appAssetLibraryImages', attributes: {
        fileName: basename(file), fileSize: statSync(file).size, category,
    }, relationships: { assetLibrary: relationship('appAssetLibraries', libraryId) } } };
}

export function commitImageBody(imageId: string) {
    return { data: { type: 'appAssetLibraryImages', id: imageId, attributes: { uploaded: true } } };
}

export function placementBody(imageId: string, target: Target, placementType: string, placementGroup: string) {
    const t = targetOf(target);
    return { data: { type: 'appAssetLibraryPlacements', attributes: { placementType, placementGroup },
        relationships: { image: relationship('appAssetLibraryImages', imageId), [t.key]: relationship(t.type, t.id) } } };
}

export function orderBody(ids: string[], target: Target, placementGroup: string) {
    const t = targetOf(target);
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('placementIds 必须是非空且不重复的列表');
    return { data: { type: 'appAssetLibraryPlacementOrderingRequests', attributes: { placementGroup },
        relationships: { orderedPlacements: { data: ids.map((id) => ({ type: 'appAssetLibraryPlacements', id })) },
            [t.key]: relationship(t.type, t.id) } } };
}

export async function getReference(client: AppStoreConnectClient): Promise<any> {
    const response = await client.get<any>('/appAssetLibraryRefData');
    const datum = response.data?.[0];
    if (!datum?.attributes) throw new Error('Apple 未返回 App Asset Library reference data');
    return datum.attributes;
}

export function validateGroup(reference: any, placementType: string, placementGroup: string, specId?: string | null) {
    const allGroups: string[] = (reference.placementProfileGroups ?? []).map((g: any) => g.placementProfileGroupId);
    const type = (reference.placementTypes ?? []).find((t: any) => t.placementTypeId === placementType);
    if (!type) throw new Error(`未知 placementType: ${placementType}；合法值: ${(reference.placementTypes ?? []).map((t: any) => t.placementTypeId).join(', ')}`);
    const mapping = (type.specMappings ?? []).find((m: any) => m.placementGroupId === placementGroup);
    if (!allGroups.includes(placementGroup) || !mapping) {
        const allowed = (type.specMappings ?? []).map((m: any) => m.placementGroupId);
        throw new Error(`无效 placementGroup: ${placementGroup}；${placementType} 合法值: ${allowed.join(', ')}`);
    }
    if (specId && !mapping.specs?.includes(specId)) {
        const allowed = (mapping.specs ?? []).map((id: string) => {
            const spec = (reference.imageSpecs ?? []).find((item: any) => item.specId === id);
            return spec ? `${id} ${JSON.stringify(spec.dimensions ?? spec)}` : id;
        });
        throw new Error(`图片 specId ${specId} 不适用于 ${placementType}/${placementGroup}；允许: ${allowed.join(', ')}`);
    }
}

export function screenshotLimit(reference: any, featureId: string, placementGroup: string): number {
    const feature = (reference.features ?? []).find((item: any) => item.featureId === featureId);
    const policy = feature?.placementPolicies?.find((item: any) => item.placementType === 'APP_SCREENSHOT');
    const maxCount = policy?.groupLimits?.find((item: any) => item.groupIds?.includes(placementGroup))?.maxCount;
    if (!Number.isInteger(maxCount) || maxCount < 1) {
        throw new Error(`reference data 未提供 ${featureId}/${placementGroup} 的 APP_SCREENSHOT 上限`);
    }
    return maxCount;
}

export async function uploadImage(client: AppStoreConnectClient, libraryId: string, file: string,
    category = 'APP_SCREENSHOTS_AND_PREVIEWS', sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    const reserved = await client.post<any>('/appAssetLibraryImages', reserveImageBody(libraryId, file, category));
    const imageId: string = reserved.data.id;
    const bytes = readFileSync(file);
    const ops: any[] = reserved.data.attributes?.uploadOperations ?? [];
    if (!ops.length) throw new Error(`图片 ${imageId} 未返回 uploadOperations`);
    for (const op of ops) {
        const offset = op.offset ?? 0;
        const length = op.length ?? bytes.length;
        await axios.request({ method: op.method ?? 'PUT', url: op.url, proxy: false,
            headers: Object.fromEntries((op.requestHeaders ?? []).map((h: any) => [h.name, h.value])),
            data: bytes.subarray(offset, offset + length) });
    }
    await client.patch(`/appAssetLibraryImages/${encodeURIComponent(imageId)}`, commitImageBody(imageId));
    for (let attempt = 0; attempt < 30; attempt++) {
        const current = await client.get<any>(`/appAssetLibraryImages/${encodeURIComponent(imageId)}`);
        const state = current.data?.attributes?.state;
        if (state === 'FAILED' || state === 'REJECTED') throw new Error(`图片 ${imageId} 处理失败: ${JSON.stringify(current.data?.attributes?.stateDetails ?? state)}`);
        if (current.data?.attributes?.specId && state !== 'UPLOAD_COMPLETE' && state !== 'AWAITING_UPLOAD') {
            return { id: imageId, state, specId: current.data.attributes.specId, imageAsset: current.data.attributes.imageAsset };
        }
        if (attempt < 29) await sleep(2000);
    }
    throw new Error(`图片 ${imageId} 处理超时；可用 asset-library images 查询状态`);
}

export async function libraryIdForApp(client: AppStoreConnectClient, appId: string): Promise<string> {
    const response = await client.get<any>(`/apps/${encodeURIComponent(appId)}/assetLibrary`);
    if (!response.data?.id) throw new Error(`app ${appId} 未返回 assetLibrary`);
    return response.data.id;
}
