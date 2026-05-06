export type Frequency = 'DAY' | 'WEEK' | 'MONTH';

export type SourceKey = 'Search' | 'Other' | 'AppRef' | 'WebRef' | 'Volume Purchase' | 'Unknown';

export const SOURCE_LABELS: Record<string, string> = {
    Search: 'App Store Search',
    Other: 'App Store Browse',
    AppRef: 'App Referrer',
    WebRef: 'Web Referrer',
    'Volume Purchase': 'Institutional Purchase',
    Unknown: 'Unavailable',
};

export const ALL_SOURCES: SourceKey[] = ['Search', 'Other', 'AppRef', 'WebRef'];

export const MEASURES = [
    'impressionsTotal',
    'pageViewCount',
    'units',
    'redownloads',
    'conversionRate',
] as const;

export type Measure = (typeof MEASURES)[number];

export interface DayRow {
    date: string;
    source: string;
    impressions: number;
    pageViews: number;
    units: number;
    redownloads: number;
    totalDownloads: number;
    cr: number;
}

export interface SourceSummary {
    source: string;
    impressions: number;
    pageViews: number;
    units: number;
    redownloads: number;
    totalDownloads: number;
    cr: number;
}

export interface AnalyticsBySourceResult {
    adamId: string;
    startDate: string;
    endDate: string;
    frequency: Frequency;
    dailyRows: DayRow[];
    summaryBySource: SourceSummary[];
    grandTotal: SourceSummary;
}
