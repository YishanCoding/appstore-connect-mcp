/**
 * ASC Analytics Full-History Exporter
 *
 * Fetches every metric × dimension combination from the ASC internal timeseries API
 * and writes one CSV per combination to an output directory.
 *
 * Requires opencli ≥ v1.7 with an active ASC browser session (default: "asc").
 *
 * Discovery (2026-05-18):
 *  - Endpoint: POST /analytics/api/v1/data/timeseries
 *  - group payload:  { metric: string, dimension: string, limit: number, rank: "DESCENDING" }
 *  - localStorage chunking avoids eval stdout truncation for territory-sized payloads
 */

import { spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

const ASC_BASE = 'https://appstoreconnect.apple.com';
const TIMESERIES_API = `${ASC_BASE}/analytics/api/v1/data/timeseries`;
const SETTINGS_API = `${ASC_BASE}/analytics/api/v1/settings/all`;

/** Metrics visible in the ASC Analytics Metrics tab */
export const KEY_METRICS = [
    // Acquisition / App Store
    'impressionsTotal', 'impressionsTotalUnique',
    'pageViewCount', 'pageViewUnique', 'conversionRate',
    // Downloads
    'units', 'redownloads', 'totalDownloads',
    // Sales
    'proceeds', 'sales', 'iap', 'payingUsers',
    'refunds-proceeds', 'refunds-sales', 'refunds-purchases',
    // Usage
    'sessions', 'activeDevices', 'rollingActiveDevices',
    'crashes', 'updates', 'installs', 'uninstalls',
    // Subscriptions
    'subscription-state-plans-active', 'subscription-state-paid',
    'subscription-state-billingIssue', 'subscription-state-churned',
    'subscription-events-paidStarts', 'subscription-events-renewals',
    'subscription-events-involuntaryChurn', 'subscription-events-voluntaryChurn',
    // In-App Events
    'eventImpressions', 'eventPageViews', 'eventOpens',
] as const;

/** Dimension keys that support groupBy in the timeseries API */
export const KEY_DIMENSIONS: Array<{ key: string; label: string }> = [
    { key: 'platform',              label: 'Device' },
    { key: 'storefront',            label: 'Territory' },
    { key: 'source',                label: 'SourceType' },
    { key: 'appVersion',            label: 'AppVersion' },
    { key: 'platformVersion',       label: 'PlatformVersion' },
    { key: 'productPage',           label: 'ProductPage' },
    { key: 'pageType',              label: 'PageType' },
    { key: 'region',                label: 'Region' },
    { key: 'appReferrer',           label: 'AppReferrer' },
    { key: 'domainReferrer',        label: 'WebReferrer' },
    { key: 'campaignId',            label: 'Campaign' },
    { key: 'subscriptionGroupId',   label: 'SubscriptionGroup' },
    { key: 'subscriptionPlanId',    label: 'Subscription' },
    { key: 'subscriptionPeriodId',  label: 'SubscriptionDuration' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportOptions {
    adamId: string;
    outputDir: string;
    startDate: string;       // YYYY-MM-DD
    endDate: string;         // YYYY-MM-DD
    sessionName?: string;    // opencli browser session, default 'asc'
    metrics?: string[];      // subset of KEY_METRICS; default = all
    dimensions?: string[];   // subset of dimension keys; default = all
}

export interface ExportResult {
    saved: Array<{ metric: string; dimension: string; file: string; rows: number }>;
    skipped: Array<{ metric: string; dimension: string; reason: string }>;
    failed: Array<{ metric: string; dimension: string; error: string }>;
    outputDir: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spawnOpencli(session: string, args: string[]): string {
    const result = spawnSync('opencli', ['browser', session, ...args], {
        encoding: 'utf8',
        timeout: 120_000,
    });
    if (result.error) throw new Error(`opencli spawn error: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`opencli exited ${result.status}: ${result.stderr}`);
    return result.stdout;
}

function browserEval(session: string, js: string): string {
    const raw = spawnOpencli(session, ['eval', js]);
    // Strip opencli warning/node lines
    const clean = raw
        .split('\n')
        .filter((l) => !l.startsWith('⚠') && !l.startsWith('(node') && !l.startsWith('Use `node'))
        .join('\n')
        .trim();
    return clean;
}

function openAscTab(session: string, adamId: string): void {
    const url = `${ASC_BASE}/apps/${adamId}/analytics/metrics?dateSpec=CUSTOM&frequency=day`;
    spawnOpencli(session, ['open', url]);
    execSync('sleep 4'); // let the SPA bootstrap
}

/** Load metric→supported-dimension-keys map from ASC settings/all */
function loadSettingsFromBrowser(session: string): Map<string, Set<string>> {
    const js = `(async function() {
  var resp = await fetch("${SETTINGS_API}");
  var data = await resp.json();
  var dimMap = {};
  (data.dimensions || []).forEach(function(d) { dimMap[d.id] = d.key; });
  var result = {};
  (data.measures || []).forEach(function(m) {
    result[m.key] = (m.dimensions || []).map(function(id) { return dimMap[id]; }).filter(Boolean);
  });
  return JSON.stringify(result);
})()`;

    const raw = browserEval(session, js);
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const map = new Map<string, Set<string>>();
    for (const [metric, dims] of Object.entries(parsed)) {
        map.set(metric, new Set(dims));
    }
    return map;
}

/**
 * Fetch timeseries grouped by a dimension, storing result in localStorage
 * to avoid eval stdout truncation for large payloads (e.g. Territory × 175 countries).
 *
 * Returns "OK:<chunks>:<rowCount>:<groups>" or "ERROR:<message>" or "EMPTY"
 */
function fetchGroupedToLocalStorage(
    session: string,
    adamId: string,
    metric: string,
    dimKey: string,
    startTime: string,
    endTime: string
): string {
    const payload = {
        adamId: [adamId],
        measures: [metric],
        frequency: 'DAY',
        startTime,
        endTime,
        dimensionFilters: [],
        group: { metric, dimension: dimKey, limit: 200, rank: 'DESCENDING' },
    };

    const js = `(async function() {
  var API = ${JSON.stringify(TIMESERIES_API)};
  var headers = {"Content-Type": "application/json", "X-Requested-By": "appstoreconnect.apple.com"};
  var payload = ${JSON.stringify(payload)};
  var resp = await fetch(API, {method: "POST", credentials: "include", headers: headers, body: JSON.stringify(payload)});
  var data = await resp.json();
  if (!data.results) return "ERROR:" + (data.message || "unknown");
  var rows = [];
  for (var i = 0; i < data.results.length; i++) {
    var e = data.results[i];
    var dk = e.group ? e.group.key : "Total";
    var dt = e.group ? e.group.title : "Total";
    for (var j = 0; j < (e.data || []).length; j++) {
      var pt = e.data[j];
      var d = pt.date ? pt.date.slice(0,10) : null;
      if (!d) continue;
      var val = pt[${JSON.stringify(metric)}];
      rows.push([d, dk, dt, val !== undefined ? val : null]);
    }
  }
  if (rows.length === 0) return "EMPTY";
  var jsn = JSON.stringify({rows: rows, size: data.size});
  var CHUNK = 200000;
  var nc = Math.ceil(jsn.length / CHUNK);
  for (var c = 0; c < nc; c++) localStorage.setItem("tkey_" + c, jsn.slice(c * CHUNK, (c+1) * CHUNK));
  localStorage.setItem("tkey_meta", JSON.stringify({chunks: nc, rowCount: rows.length, groups: data.size}));
  return "OK:" + nc + ":" + rows.length + ":" + data.size;
})()`;

    return browserEval(session, js);
}

/** Read chunked data back from localStorage */
function readFromLocalStorage(session: string): { rows: (string | number | null)[][]; size: number } | null {
    const metaRaw = browserEval(session, "(function(){ return localStorage.getItem('tkey_meta'); })()");
    if (!metaRaw || metaRaw === 'null') return null;

    const meta = JSON.parse(metaRaw) as { chunks: number; rowCount: number; groups: number };
    let full = '';
    for (let c = 0; c < meta.chunks; c++) {
        const chunk = browserEval(session, `(function(){ return localStorage.getItem('tkey_${c}'); })()`);
        if (chunk && chunk !== 'null') full += chunk;
    }
    return full ? JSON.parse(full) : null;
}

/** Write CSV file for one metric × dimension combination */
function writeCsv(
    outputDir: string,
    metric: string,
    dimLabel: string,
    data: { rows: (string | number | null)[][] }
): { file: string; rows: number } {
    const safeMetric = metric.replace(/\//g, '-').replace(/\s/g, '_');
    const filename = `Tripo_${safeMetric}_${dimLabel}_日分.csv`;
    const filepath = path.join(outputDir, filename);

    // BOM for Excel compatibility
    const bom = '﻿';
    const header = `date,dimension_key,dimension_title,${metric}\n`;
    const rows = data.rows
        .map((r) => r.map((v) => (v === null ? '' : String(v))).join(','))
        .join('\n');

    fs.writeFileSync(filepath, bom + header + rows, 'utf8');
    return { file: filename, rows: data.rows.length };
}

// ─── Main Exporter ────────────────────────────────────────────────────────────

export class FullHistoryExporter {
    async export(opts: ExportOptions): Promise<ExportResult> {
        const {
            adamId,
            outputDir,
            startDate,
            endDate,
            sessionName = 'asc',
            metrics = [...KEY_METRICS],
            dimensions = KEY_DIMENSIONS.map((d) => d.key),
        } = opts;

        const startTime = `${startDate}T00:00:00Z`;
        const endTime = `${endDate}T00:00:00Z`;

        fs.mkdirSync(outputDir, { recursive: true });

        // Open ASC and load settings
        openAscTab(sessionName, adamId);
        const metricDimMap = loadSettingsFromBrowser(sessionName);

        const result: ExportResult = { saved: [], skipped: [], failed: [], outputDir };

        const dimLookup = new Map(KEY_DIMENSIONS.map((d) => [d.key, d.label]));

        for (const metric of metrics) {
            const supported = metricDimMap.get(metric) ?? new Set();

            for (const dimKey of dimensions) {
                const dimLabel = dimLookup.get(dimKey) ?? dimKey;

                // Skip if metric doesn't support this dimension (and we have info)
                if (supported.size > 0 && !supported.has(dimKey)) {
                    result.skipped.push({ metric, dimension: dimKey, reason: 'unsupported' });
                    continue;
                }

                // Skip if file already exists
                const safeMetric = metric.replace(/\//g, '-').replace(/\s/g, '_');
                const filepath = path.join(outputDir, `Tripo_${safeMetric}_${dimLabel}_日分.csv`);
                if (fs.existsSync(filepath)) {
                    result.skipped.push({ metric, dimension: dimKey, reason: 'exists' });
                    continue;
                }

                // Fetch
                let fetchResult: string;
                try {
                    fetchResult = fetchGroupedToLocalStorage(sessionName, adamId, metric, dimKey, startTime, endTime);
                } catch (e: any) {
                    result.failed.push({ metric, dimension: dimKey, error: e.message });
                    continue;
                }

                if (fetchResult === 'EMPTY') {
                    result.skipped.push({ metric, dimension: dimKey, reason: 'empty' });
                    continue;
                }

                if (!fetchResult.startsWith('OK:')) {
                    result.failed.push({ metric, dimension: dimKey, error: fetchResult });
                    continue;
                }

                // Read back and write CSV
                const data = readFromLocalStorage(sessionName);
                if (!data) {
                    result.failed.push({ metric, dimension: dimKey, error: 'localStorage read failed' });
                    continue;
                }

                const { file, rows } = writeCsv(outputDir, metric, dimLabel, data);
                result.saved.push({ metric, dimension: dimKey, file, rows });
            }
        }

        return result;
    }

    formatSummary(result: ExportResult): string {
        const lines: string[] = [
            '# ASC Full-History Export Summary',
            '',
            `**Output directory:** ${result.outputDir}`,
            `**Files saved:** ${result.saved.length}`,
            `**Skipped:** ${result.skipped.length}`,
            `**Failed:** ${result.failed.length}`,
            '',
        ];

        if (result.saved.length > 0) {
            lines.push('## Saved Files');
            for (const s of result.saved) {
                lines.push(`- \`${s.file}\` — ${s.rows.toLocaleString()} rows`);
            }
            lines.push('');
        }

        if (result.failed.length > 0) {
            lines.push('## Failures');
            for (const f of result.failed) {
                lines.push(`- ${f.metric} × ${f.dimension}: ${f.error}`);
            }
        }

        return lines.join('\n');
    }
}
