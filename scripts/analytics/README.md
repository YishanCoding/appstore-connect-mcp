# ASC Analytics Scripts

Python scripts for fetching App Store Connect analytics data via the internal timeseries API (browser-session authenticated).

## Prerequisites

```bash
npm install -g @jackwener/opencli   # opencli >= 1.8.0

# Bind an ASC browser session (do this once, or when the session expires)
opencli browser asc bind            # with App Store Connect open in that tab
```

## Scripts

### `fetch_global_source.py` — Global installs by acquisition source

Fetches daily download / impression / CVR split by source (Search, Browse, AppRef, WebRef) for the whole app, with no storefront filter.

> Use this for top-level funnel analysis. Global totals can differ from summing country-level rows — always use this script for aggregated source metrics.

```bash
# Last 30 days (default)
python3 fetch_global_source.py --adam-id 6754280964

# Custom range
python3 fetch_global_source.py --adam-id 6748596826 --start 2026-03-01 --end 2026-06-10

# Specific sources only
python3 fetch_global_source.py --adam-id 6748596826 --sources Search Other --days 90

# Custom output path
python3 fetch_global_source.py --adam-id 6748596826 --out my_source_data.csv
```

Output: CSV with columns `date, source, sourceName, impressionsTotal, pageViewCount, units, redownloads, conversionRate, totalDownloads`

---

### `fetch_country_source.py` — Installs by country × source

Fetches daily data cross-tabulated by storefront (country) and acquisition source. Covers the top 20 storefronts by default.

> Useful for geo attribution and localisation prioritisation. Expect higher API call counts: 20 countries × 4 sources = 80 requests.

```bash
# All top-20 countries, last 90 days
python3 fetch_country_source.py --adam-id 6754280964 --days 90

# Specific countries
python3 fetch_country_source.py --adam-id 6748596826 --countries US CN JP IN --days 60

# Custom range + output
python3 fetch_country_source.py --adam-id 6748596826 --start 2026-04-01 --end 2026-05-31 --out country_source.csv
```

Output: CSV with columns `date, country, source, source_key, units, redownloads, totalDownloads, impressionsTotal, pageViewCount, conversionRate`

Available country codes: `US CN JP IN MX TH BR VN TW DE FR GB CA PH ES IT HK TR AU SA`

---

### `fetch_engagement_daily.py` — App-wide engagement metrics

Fetches daily engagement metrics with no source or country dimension (app-wide totals). Handles the 89-day API chunk limit automatically.

Metrics: `sessions`, `activeDevices`, `uninstalls` (shown as "Deletions" in ASC UI), `impressionsTotal`, `pageViewCount`, `conversionRate`, `totalDownloads`

```bash
# Last 90 days, JSON output (default)
python3 fetch_engagement_daily.py --adam-id 6754280964 --days 90

# Custom range
python3 fetch_engagement_daily.py --adam-id 6754280964 --start 2026-03-01 --end 2026-06-10

# CSV output
python3 fetch_engagement_daily.py --adam-id 6754280964 --format csv --out engagement.csv
```

Output: JSON (default) — `{as_of, period, adam_id, note, daily: [{date, sessions, activeDevices, …}]}`  
Or CSV with columns `date, sessions, activeDevices, uninstalls, impressionsTotal, pageViewCount, conversionRate, totalDownloads`

---

## How it works

All three scripts use `opencli browser asc eval` to execute `fetch()` calls inside an authenticated browser tab, bypassing the need for an App Store Connect API key. The internal endpoint is:

```
POST https://appstoreconnect.apple.com/analytics/api/v1/data/timeseries
```

The API returns one `result` object per measure — the scripts merge these by date before writing output.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `opencli eval failed` | Session expired or not on ASC | Re-run `opencli browser asc bind` |
| All metrics zero | Wrong `--adam-id` | Verify ID in ASC → My Apps URL |
| Timeout errors | Slow network or API overload | Retry; the 89-day chunk limit helps |
| `No results in response` | API key not in session cookies | Log out and back into ASC, then rebind |
