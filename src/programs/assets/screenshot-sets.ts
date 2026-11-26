import type { AppStoreConnectClient } from '../api-client/client.js';

/** Apple caps the per-set screenshot submission at 10. */
export const SCREENSHOT_SET_LIMIT = 10;

/**
 * include=appScreenshots only returns the first 10 related ids; the real total is in
 * relationships.appScreenshots.meta.paging.total. When it is larger, read the set's
 * screenshots directly so count, ids and file names are complete (JuJuBit 1.5.0 en-US
 * 6.5" showed 10 here while Apple held 14 and blocked submission with SCREENSHOT_TOO_MANY).
 */
export async function mapScreenshotSets(client: AppStoreConnectClient, sets: any[]) {
    const out = [];
    for (const set of sets) {
        const rel = set.relationships?.appScreenshots;
        const included: string[] = (rel?.data || []).map((shot: any) => shot.id);
        const total: number = rel?.meta?.paging?.total ?? included.length;
        let screenshots = included;
        let fileNames: string[] | undefined;
        if (total > included.length) {
            const shots = await client.getAllPages<any>(`/appScreenshotSets/${encodeURIComponent(set.id)}/appScreenshots`, {});
            screenshots = shots.map((shot) => shot.id);
            fileNames = shots.map((shot) => shot.attributes?.fileName);
        }
        const count = Math.max(total, screenshots.length);
        const duplicates = fileNames ? [...new Set(fileNames.filter((name, i) => name && fileNames!.indexOf(name) !== i))] : [];
        out.push({
            id: set.id,
            screenshotDisplayType: set.attributes?.screenshotDisplayType,
            screenshotCount: count,
            screenshots,
            ...(fileNames ? { fileNames } : {}),
            ...(count > SCREENSHOT_SET_LIMIT
                ? { warning: `${count} 张，超过 Apple 上限 ${SCREENSHOT_SET_LIMIT}，提审会被 SCREENSHOT_TOO_MANY 拦截${duplicates.length ? '；重复文件名: ' + duplicates.join(', ') : ''}` }
                : {}),
        });
    }
    return out;
}

