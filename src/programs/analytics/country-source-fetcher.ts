/**
 * country-source-fetcher.ts
 *
 * Fetches ASC Analytics cross-dimensional data: country (storefront) × source type.
 * Uses the internal /analytics/api/v1/data/timeseries endpoint with two simultaneous
 * dimensionFilters, which the official public API does not support.
 *
 * Requires an active "asc" opencli browser session logged into App Store Connect.
 */

import { spawnSync } from 'child_process';
import { SourceKey, ALL_SOURCES, SOURCE_LABELS, MEASURES } from './types.js';

const ASC_BASE      = 'https://appstoreconnect.apple.com';
const TIMESERIES_API = `${ASC_BASE}/analytics/api/v1/data/timeseries`;
const BROWSER_SESSION = process.env.OPENCLI_BROWSER_SESSION ?? 'asc';

// Top-20 storefronts by Tripo install volume (storefront IDs from ASC settings/all)
export const STOREFRONTS: Record<string, string> = {
    US: '143441',
    CN: '143465',
    JP: '143462',
    IN: '143467',
    MX: '143468',
    TH: '143475',
    BR: '143503',
    VN: '143471',
    TW: '143470',
    DE: '143443',
    FR: '143442',
    GB: '143444',
    CA: '143455',
    PH: '143474',
    ES: '143454',
    IT: '143450',
    HK: '143463',
    TR: '143480',
    AU: '143460',
    SA: '143479',
};

export interface CountrySourceRow {
    date:             string;
    country:          string;   // ISO-2 code, e.g. "US"
    source:           string;   // human label, e.g. "App Store Search"
    sourceKey:        SourceKey;
    units:            number;
    redownloads:      number;
    totalDownloads:   number;
    impressionsTotal: number;
    pageViewCount:    number;
    conversionRate:   number;
}

export interface CountrySourceResult {
    adamId:     string;
    startDate:  string;
    endDate:    string;
    rows:       CountrySourceRow[];
    /** Per-country, per-source 30-day summary (if range ≥ 30 days) */
    summary:    CountrySummary[];
}

export interface CountrySummary {
    country:           string;
    source:            string;
    avgDailyDownloads: number;
    avgDailyImpr:      number;
    avgCR:             number;
}

// ── opencli helpers ──────────────────────────────────────────────────────────

function spawnOpencli(args: string[]): string {
    const r = spawnSync('opencli', args, { encoding: 'utf8', timeout: 30000 });
    if (r.error) throw new Error(`opencli error: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`opencli exited ${r.status}: ${r.stderr}`);
    return r.stdout;
}

function openAscTab(adamId: string): string {
    const url = `${ASC_BASE}/apps/${adamId}/analytics/acquisition/sources`;
    const raw = spawnOpencli(['browser', BROWSER_SESSION, 'open', url]);
    const jsonLine = raw.split('\n').find((l) => l.trim().startsWith('{'));
    if (!jsonLine) throw new Error(`Unexpected opencli output: ${raw.slice(0, 200)}`);
    return (JSON.parse(jsonLine) as { page: string }).page;
}

function evalInBrowser(js: string, tabId: string): string {
    const raw = spawnOpencli(['browser', BROWSER_SESSION, 'eval', '--tab', tabId, js]);
    // Strip opencli warning lines
    const clean = raw
        .split('\n')
        .filter((l) => !l.includes('⚠') && !l.includes('UNDICI') && !l.includes('(node:'))
        .join('\n')
        .trim();
    return clean;
}

// ── Core fetch ───────────────────────────────────────────────────────────────

function fetchCountrySource(
    tabId:       string,
    adamId:      string,
    countryCode: string,
    storefrontId: string,
    sourceKey:   SourceKey,
    startDate:   string,
    endDate:     string,
): CountrySourceRow[] {
    const measures = [...MEASURES, 'totalDownloads'] as string[];
    const payload = {
        adamId:   [adamId],
        measures,
        frequency: 'DAY',
        startTime: `${startDate}T00:00:00Z`,
        endTime:   `${endDate}T00:00:00Z`,
        dimensionFilters: [
            { dimensionKey: 'source',     optionKeys: [sourceKey] },
            { dimensionKey: 'storefront', optionKeys: [storefrontId] },
        ],
    };

    const js = `(async function(){
  const r = await fetch(${JSON.stringify(TIMESERIES_API)}, {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type':'application/json','X-Requested-By':'appstoreconnect.apple.com'},
    body: JSON.stringify(${JSON.stringify(payload)})
  });
  return JSON.stringify(await r.json());
})()`;

    const raw     = evalInBrowser(js, tabId);
    const parsed  = JSON.parse(raw);
    const resp    = (typeof parsed === 'string' ? JSON.parse(parsed) : parsed) as {
        results?: Array<{ data?: Record<string, unknown>[] }>;
        message?: string;
    };

    if (!resp.results) {
        throw new Error(`No results for ${countryCode}/${sourceKey}: ${JSON.stringify(resp).slice(0, 200)}`);
    }

    const rows: CountrySourceRow[] = [];
    for (const result of resp.results) {
        for (const point of result.data ?? []) {
            const p = point as Record<string, unknown>;
            rows.push({
                date:             String(p['date'] ?? '').slice(0, 10),
                country:          countryCode,
                source:           SOURCE_LABELS[sourceKey] ?? sourceKey,
                sourceKey,
                units:            Number(p['units'] ?? 0),
                redownloads:      Number(p['redownloads'] ?? 0),
                totalDownloads:   Number(p['totalDownloads'] ?? 0),
                impressionsTotal: Number(p['impressionsTotal'] ?? 0),
                pageViewCount:    Number(p['pageViewCount'] ?? 0),
                conversionRate:   Number(p['conversionRate'] ?? 0),
            });
        }
    }
    return rows;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface FetchCountrySourceOptions {
    adamId:      string;
    startDate:   string;
    endDate:     string;
    /** Subset of STOREFRONTS keys. Defaults to all 20. */
    countries?:  string[];
    /** Subset of SourceKey. Defaults to ALL_SOURCES. */
    sources?:    SourceKey[];
    /** Delay ms between requests to avoid rate-limiting. Default 300. */
    delayMs?:    number;
    onProgress?: (msg: string) => void;
}

export async function fetchCountrySourceData(
    opts: FetchCountrySourceOptions,
): Promise<CountrySourceResult> {
    const {
        adamId,
        startDate,
        endDate,
        countries = Object.keys(STOREFRONTS),
        sources   = ALL_SOURCES,
        delayMs   = 300,
        onProgress = (m: string) => process.stderr.write(m + '\n'),
    } = opts;

    onProgress(`Opening ASC tab for app ${adamId}...`);
    const tabId = openAscTab(adamId);

    // Give the page time to load and authenticate
    await new Promise((r) => setTimeout(r, 5000));

    const allRows: CountrySourceRow[] = [];
    const total = countries.length * sources.length;
    let done = 0;

    for (const cc of countries) {
        const sfId = STOREFRONTS[cc];
        if (!sfId) {
            onProgress(`⚠ Unknown country code: ${cc}, skipping`);
            continue;
        }
        for (const srcKey of sources) {
            done++;
            onProgress(`  [${done}/${total}] ${cc} × ${SOURCE_LABELS[srcKey]}...`);
            try {
                const rows = fetchCountrySource(tabId, adamId, cc, sfId, srcKey, startDate, endDate);
                allRows.push(...rows);
            } catch (e) {
                onProgress(`  ❌ Error: ${(e as Error).message}`);
            }
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        }
    }

    // Build summary (avg over last 30 days of the range)
    const endDt    = new Date(endDate);
    const cutoff   = new Date(endDt);
    cutoff.setDate(cutoff.getDate() - 29);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const summaryMap = new Map<string, { downloads: number[]; impr: number[]; cr: number[] }>();

    for (const row of allRows) {
        if (row.date < cutoffStr) continue;
        const key = `${row.country}||${row.sourceKey}`;
        if (!summaryMap.has(key)) summaryMap.set(key, { downloads: [], impr: [], cr: [] });
        const bucket = summaryMap.get(key)!;
        bucket.downloads.push(row.totalDownloads);
        bucket.impr.push(row.impressionsTotal);
        bucket.cr.push(row.conversionRate);
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const summary: CountrySummary[] = Array.from(summaryMap.entries()).map(([key, b]) => {
        const [country, sourceKey] = key.split('||');
        return {
            country:           country ?? '',
            source:            sourceKey ? SOURCE_LABELS[sourceKey as SourceKey] ?? sourceKey : '',
            avgDailyDownloads: avg(b.downloads),
            avgDailyImpr:      avg(b.impr),
            avgCR:             avg(b.cr),
        };
    }).sort((a, b) => b.avgDailyDownloads - a.avgDailyDownloads);

    return { adamId, startDate, endDate, rows: allRows, summary };
}
