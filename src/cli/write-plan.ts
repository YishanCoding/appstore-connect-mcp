import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';
import type { ToolMeta } from './meta.js';

const ID_KEYS = new Set([
    'appId',
    'reviewId',
    'versionId',
    'localizationId',
    'appInfoLocalizationId',
    'appStoreVersionId',
    'appStoreVersionLocalizationId',
    'buildId',
    'buildBetaDetailId',
    'betaGroupId',
    'userId',
    'eventId',
    'cppId',
    'localeId',
    'screenshotSetId',
    'phasedReleaseId',
    'reviewRequestId',
    'inAppPurchaseId',
]);

export interface DryRunPlan {
    dry_run: true;
    method: string;
    path: string;
    body: unknown;
    files?: { name: string; bytes: number; mime: string; sha256: string }[];
}

export function planWrite(meta: ToolMeta, args: Record<string, unknown>, rawBody: unknown): DryRunPlan {
    const path = fillPath(meta.path ?? '/', args);
    const files = describeFiles(args);
    return {
        dry_run: true,
        method: meta.method ?? 'POST',
        path,
        body: buildBody(meta, args, rawBody),
        ...(files.length ? { files } : {}),
    };
}

export function includesJson(haystack: unknown, needle: unknown): boolean {
    if (sameJson(haystack, needle)) return true;
    if (!haystack || typeof haystack !== 'object') return false;
    return Object.values(haystack as Record<string, unknown>).some((value) => includesJson(value, needle));
}

function buildBody(meta: ToolMeta, args: Record<string, unknown>, rawBody: unknown): unknown {
    if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) && 'data' in (rawBody as object)) {
        return rawBody;
    }
    if (meta.body === 'raw') return rawBody ?? args;
    if (meta.body === 'none') return null;
    if (meta.body === 'builds') {
        return { data: [{ type: 'builds', id: args.buildId }] };
    }

    const attributes: Record<string, unknown> = {};
    if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
        Object.assign(attributes, rawBody);
    }
    const keys = meta.attrKeys ?? Object.keys(args).filter((key) => !ID_KEYS.has(key));
    for (const key of keys) {
        if (args[key] !== undefined) attributes[key] = args[key];
    }
    if (meta.resourceType === 'appStoreVersionPhasedReleases' && meta.method === 'POST' && attributes.phasedReleaseState === undefined) {
        attributes.phasedReleaseState = 'ACTIVE';
    }

    const data: Record<string, unknown> = { type: meta.resourceType ?? 'unknown' };
    if (meta.method === 'PATCH' && meta.idParam && args[meta.idParam] != null) data.id = args[meta.idParam];
    if (Object.keys(attributes).length) data.attributes = attributes;
    if (meta.relationship) {
        const id = args[meta.relationship.idParam];
        data.relationships = {
            [meta.relationship.key]: { data: { type: meta.relationship.type, id } },
        };
    }
    if (meta.resourceType === 'betaTesters' && Array.isArray(args.betaGroupIds)) {
        data.relationships = {
            betaGroups: {
                data: (args.betaGroupIds as string[]).map((id) => ({ type: 'betaGroups', id })),
            },
        };
    }
    return { data };
}

function fillPath(template: string, args: Record<string, unknown>): string {
    return template.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(String(args[key] ?? '')));
}

export function describeFiles(args: Record<string, unknown>) {
    const paths: string[] = [];
    for (const key of ['file', 'cppImagePath']) {
        if (typeof args[key] === 'string') paths.push(args[key] as string);
    }
    for (const key of ['imagePaths', 'templateShotPaths']) {
        if (Array.isArray(args[key])) paths.push(...(args[key] as unknown[]).filter((item): item is string => typeof item === 'string'));
    }
    return paths.map((file) => {
        const bytes = statSync(file).size;
        const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
        return { name: basename(file), bytes, mime: mimeFor(file), sha256 };
    });
}

function mimeFor(file: string): string {
    const ext = extname(file).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.json') return 'application/json';
    return 'application/octet-stream';
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
