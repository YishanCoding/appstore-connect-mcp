import { execSync, spawnSync } from 'child_process';
import {
    Frequency,
    SourceKey,
    ALL_SOURCES,
    SOURCE_LABELS,
    MEASURES,
    DayRow,
    SourceSummary,
    AnalyticsBySourceResult,
} from './types.js';

const ASC_BASE = 'https://appstoreconnect.apple.com';
const ANALYTICS_API = `${ASC_BASE}/analytics/api/v1/data/timeseries`;

function spawnOpencli(args: string[]): string {
    const result = spawnSync('opencli', args, { encoding: 'utf8', timeout: 30000 });
    if (result.error) throw new Error(`opencli spawn error: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`opencli exited ${result.status}: ${result.stderr}`);
    return result.stdout;
}

function openAscTab(adamId: string): string {
    const url = `${ASC_BASE}/apps/${adamId}/analytics/acquisition/sources`;
    const raw = spawnOpencli(['browser', 'open', url]);
    // strip trailing update notice lines
    const jsonLine = raw.split('\n').find((l) => l.trim().startsWith('{'));
    if (!jsonLine) throw new Error(`Unexpected opencli browser open output: ${raw}`);
    return (JSON.parse(jsonLine) as { page: string }).page;
}

function fetchTimeseriesForSource(
    tabId: string,
    adamId: string,
    source: SourceKey | null,
    startDate: string,
    endDate: string,
    frequency: Frequency
): Record<string, Record<string, number>> {
    const payload = {
        adamId: [adamId],
        measures: [...MEASURES],
        frequency,
        startTime: `${startDate}T00:00:00Z`,
        endTime: `${endDate}T00:00:00Z`,
        dimensionFilters: source ? [{ dimensionKey: 'source', optionKeys: [source] }] : [],
    };

    // spawnSync passes the JS as a single arg — no shell quoting needed
    const js = `(async()=>{const r=await fetch(${JSON.stringify(ANALYTICS_API)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Requested-By':'appstoreconnect.apple.com'},body:JSON.stringify(${JSON.stringify(payload)})});return JSON.stringify(await r.json())})()`;

    const raw = spawnOpencli(['browser', 'eval', '--tab', tabId, js]);
    // opencli eval returns JSON-encoded result; unwrap one level if needed
    let parsed: string;
    try {
        parsed = JSON.parse(raw.trim());
    } catch {
        parsed = raw.trim();
    }
    const apiResponse = JSON.parse(parsed);

    // Build: { measure -> { date -> value } }
    const result: Record<string, Record<string, number>> = {};
    for (const entry of apiResponse.results ?? []) {
        for (const point of entry.data ?? []) {
            const date = point.date?.slice(0, 10) ?? '';
            for (const measure of MEASURES) {
                if (measure in point) {
                    if (!result[measure]) result[measure] = {};
                    result[measure][date] = point[measure] ?? 0;
                }
            }
        }
    }
    return result;
}

export class AnalyticsManager {
    async getBySourceType(
        adamId: string,
        startDate: string,
        endDate: string,
        frequency: Frequency = 'DAY'
    ): Promise<AnalyticsBySourceResult> {
        // Open a browser tab to ASC (uses existing logged-in session)
        const tabId = openAscTab(adamId);

        // Wait briefly for the page to initialise
        execSync('sleep 4');

        // Fetch each source + total in sequence
        const sourceData: Record<string, Record<string, Record<string, number>>> = {};
        for (const src of ALL_SOURCES as SourceKey[]) {
            sourceData[src] = fetchTimeseriesForSource(tabId, adamId, src, startDate, endDate, frequency);
        }
        sourceData['Total'] = fetchTimeseriesForSource(tabId, adamId, null, startDate, endDate, frequency);

        // Collect all dates
        const allDates = [
            ...new Set(
                Object.values(sourceData).flatMap((sm) =>
                    Object.values(sm).flatMap((dm) => Object.keys(dm))
                )
            ),
        ].sort();

        // Build daily rows (exclude days where all metrics are 0)
        const dailyRows: DayRow[] = [];
        for (const date of allDates) {
            for (const src of [...ALL_SOURCES, 'Total'] as (SourceKey | 'Total')[]) {
                const sm = sourceData[src] ?? {};
                const imp = sm['impressionsTotal']?.[date] ?? 0;
                const pv = sm['pageViewCount']?.[date] ?? 0;
                const units = sm['units']?.[date] ?? 0;
                const redl = sm['redownloads']?.[date] ?? 0;
                const cr = sm['conversionRate']?.[date] ?? 0;
                if (imp === 0 && pv === 0 && units === 0 && redl === 0) continue;
                dailyRows.push({
                    date,
                    source: src === 'Total' ? '合计' : SOURCE_LABELS[src] ?? src,
                    impressions: imp,
                    pageViews: pv,
                    units,
                    redownloads: redl,
                    totalDownloads: units + redl,
                    cr,
                });
            }
        }

        // Build per-source summary
        const summaryBySource: SourceSummary[] = ALL_SOURCES.map((src) => {
            const sm = sourceData[src] ?? {};
            const imp = Object.values(sm['impressionsTotal'] ?? {}).reduce((a, b) => a + b, 0);
            const pv = Object.values(sm['pageViewCount'] ?? {}).reduce((a, b) => a + b, 0);
            const units = Object.values(sm['units'] ?? {}).reduce((a, b) => a + b, 0);
            const redl = Object.values(sm['redownloads'] ?? {}).reduce((a, b) => a + b, 0);
            const crVals = Object.values(sm['conversionRate'] ?? {});
            const cr = crVals.length ? crVals.reduce((a, b) => a + b, 0) / crVals.length : 0;
            return {
                source: SOURCE_LABELS[src] ?? src,
                impressions: imp,
                pageViews: pv,
                units,
                redownloads: redl,
                totalDownloads: units + redl,
                cr: Math.round(cr * 100) / 100,
            };
        });

        const tot = sourceData['Total'] ?? {};
        const grandTotal: SourceSummary = {
            source: '合计',
            impressions: Object.values(tot['impressionsTotal'] ?? {}).reduce((a, b) => a + b, 0),
            pageViews: Object.values(tot['pageViewCount'] ?? {}).reduce((a, b) => a + b, 0),
            units: Object.values(tot['units'] ?? {}).reduce((a, b) => a + b, 0),
            redownloads: Object.values(tot['redownloads'] ?? {}).reduce((a, b) => a + b, 0),
            totalDownloads:
                Object.values(tot['units'] ?? {}).reduce((a, b) => a + b, 0) +
                Object.values(tot['redownloads'] ?? {}).reduce((a, b) => a + b, 0),
            cr: (() => {
                const vals = Object.values(tot['conversionRate'] ?? {});
                return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0;
            })(),
        };

        return { adamId, startDate, endDate, frequency, dailyRows, summaryBySource, grandTotal };
    }

    formatAsText(result: AnalyticsBySourceResult): string {
        const lines: string[] = [];
        lines.push(`# App Store Analytics by Source Type`);
        lines.push(`**App ID:** ${result.adamId}  |  **Period:** ${result.startDate} ~ ${result.endDate}  |  **Frequency:** ${result.frequency}`);
        lines.push('');

        // Summary table
        lines.push('## 来源汇总');
        lines.push('| 来源类型 | 曝光 | 产品页浏览 | 首次下载 | 重新下载 | 总下载 | 平均CR% |');
        lines.push('|---|---|---|---|---|---|---|');
        for (const s of result.summaryBySource) {
            if (s.impressions === 0 && s.totalDownloads === 0) continue;
            lines.push(`| ${s.source} | ${s.impressions.toLocaleString()} | ${s.pageViews.toLocaleString()} | ${s.units.toLocaleString()} | ${s.redownloads.toLocaleString()} | ${s.totalDownloads.toLocaleString()} | ${s.cr}% |`);
        }
        const g = result.grandTotal;
        lines.push(`| **${g.source}** | **${g.impressions.toLocaleString()}** | **${g.pageViews.toLocaleString()}** | **${g.units.toLocaleString()}** | **${g.redownloads.toLocaleString()}** | **${g.totalDownloads.toLocaleString()}** | **${g.cr}%** |`);
        lines.push('');

        // Daily table
        lines.push('## 分日明细');
        lines.push('| 日期 | 来源类型 | 曝光 | 产品页浏览 | 首次下载 | 重新下载 | 总下载 | CR% |');
        lines.push('|---|---|---|---|---|---|---|---|');
        for (const row of result.dailyRows) {
            const isTotal = row.source === '合计';
            const fmt = (n: number) => n.toLocaleString();
            if (isTotal) {
                lines.push(`| **${row.date}** | **${row.source}** | **${fmt(row.impressions)}** | **${fmt(row.pageViews)}** | **${fmt(row.units)}** | **${fmt(row.redownloads)}** | **${fmt(row.totalDownloads)}** | **${row.cr}%** |`);
            } else {
                lines.push(`| ${row.date} | ${row.source} | ${fmt(row.impressions)} | ${fmt(row.pageViews)} | ${fmt(row.units)} | ${fmt(row.redownloads)} | ${fmt(row.totalDownloads)} | ${row.cr}% |`);
            }
        }

        return lines.join('\n');
    }
}
