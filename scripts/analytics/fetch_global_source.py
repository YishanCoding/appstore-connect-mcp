#!/usr/bin/env python3
"""Fetch ASC global source daily metrics.

Pulls daily download / impression / CVR data split by acquisition source
(Search, Browse, AppRef, WebRef) using the App Store Connect internal
timeseries API via an opencli browser session.

Note: do NOT substitute this with aggregated country-source rows — ASC
global source totals can differ from the sum of storefront-filtered pulls.

Prerequisites:
  - opencli >= 1.8.0  (npm install -g @jackwener/opencli)
  - An "asc" browser session logged into App Store Connect
      opencli browser asc bind   (with ASC open in that browser tab)

Usage:
  python3 fetch_global_source.py --adam-id 6754280964
  python3 fetch_global_source.py --adam-id 6748596826 --days 90
  python3 fetch_global_source.py --adam-id 6748596826 --start 2026-03-01 --end 2026-06-10
  python3 fetch_global_source.py --adam-id 6748596826 --sources Search Other --out my_data.csv
"""

import argparse
import csv
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

BROWSER_SESSION = "asc"
ASC_URL         = "https://appstoreconnect.apple.com"
TIMESERIES_API  = f"{ASC_URL}/analytics/api/v1/data/timeseries"

MEASURES = [
    "units",
    "redownloads",
    "totalDownloads",
    "impressionsTotal",
    "pageViewCount",
    "conversionRate",
]

SOURCES = {
    "Search": "App Store Search",
    "Other":  "App Store Browse",
    "AppRef": "App Referrer",
    "WebRef": "Web Referrer",
}

FIELDNAMES = [
    "date", "source", "sourceName",
    "impressionsTotal", "pageViewCount",
    "units", "redownloads", "conversionRate", "totalDownloads",
]


def opencli_eval(js: str, timeout: int = 60) -> str:
    result = subprocess.run(
        ["opencli", "browser", BROWSER_SESSION, "eval", js],
        capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[:500])
    lines = [l for l in result.stdout.splitlines()
             if not any(x in l for x in ["⚠", "UNDICI", "Warning:", "(node:"])]
    return "\n".join(lines).strip()


def ensure_asc_session(adam_id: str) -> None:
    result = subprocess.run(
        ["opencli", "browser", BROWSER_SESSION, "get", "url"],
        capture_output=True, text=True, timeout=15,
    )
    if "appstoreconnect.apple.com" not in result.stdout:
        subprocess.run(
            ["opencli", "browser", BROWSER_SESSION, "open",
             f"{ASC_URL}/analytics/app/{adam_id}/sources"],
            capture_output=True, text=True, timeout=30,
        )
        time.sleep(5)


def fetch_source(adam_id: str, source_key: str, start_date: str, end_date: str) -> list[dict]:
    payload = {
        "adamId": [adam_id],
        "measures": MEASURES,
        "frequency": "DAY",
        "startTime": f"{start_date}T00:00:00Z",
        "endTime":   f"{end_date}T00:00:00Z",
        "dimensionFilters": [{"dimensionKey": "source", "optionKeys": [source_key]}],
    }
    js = f"""(async function(){{
  const r = await fetch({json.dumps(TIMESERIES_API)}, {{
    method: 'POST',
    credentials: 'include',
    headers: {{'Content-Type':'application/json','X-Requested-By':'appstoreconnect.apple.com'}},
    body: JSON.stringify({json.dumps(payload)})
  }});
  return JSON.stringify(await r.json());
}})()"""

    raw = opencli_eval(js)
    resp = json.loads(raw)
    if isinstance(resp, str):
        resp = json.loads(resp)
    if "results" not in resp:
        raise RuntimeError(f"No results for {source_key}: {str(resp)[:500]}")

    by_date: dict = {}
    for result in resp["results"]:
        for point in result.get("data", []):
            date = point.get("date", "")[:10]
            if not date:
                continue
            row = by_date.setdefault(date, {
                "date": date, "source": source_key,
                "sourceName": SOURCES[source_key],
                "impressionsTotal": 0, "pageViewCount": 0,
                "units": 0, "redownloads": 0, "conversionRate": 0, "totalDownloads": 0,
            })
            for key in ["impressionsTotal", "pageViewCount", "units", "redownloads", "totalDownloads"]:
                row[key] += point.get(key, 0) or 0
            row["conversionRate"] = max(row["conversionRate"], point.get("conversionRate", 0) or 0)
    return [by_date[d] for d in sorted(by_date)]


def main() -> int:
    parser = argparse.ArgumentParser(description="ASC global source daily metrics")
    parser.add_argument("--adam-id",  required=True, help="App Adam ID (numeric)")
    parser.add_argument("--start",    default=None,  help="Start date YYYY-MM-DD")
    parser.add_argument("--end",      default=None,  help="End date YYYY-MM-DD")
    parser.add_argument("--days",     type=int, default=30, help="Last N days (ignored if --start/--end set)")
    parser.add_argument("--sources",  nargs="+", default=list(SOURCES.keys()),
                        help=f"Sources to fetch. Choices: {list(SOURCES.keys())}")
    parser.add_argument("--out",      default=None,  help="Output CSV path")
    args = parser.parse_args()

    if args.start and args.end:
        start_date, end_date = args.start, args.end
    else:
        end_dt   = datetime.today()
        start_dt = end_dt - timedelta(days=args.days - 1)
        start_date = start_dt.strftime("%Y-%m-%d")
        end_date   = end_dt.strftime("%Y-%m-%d")

    sources = [s for s in args.sources if s in SOURCES]
    if not sources:
        print(f"Invalid sources. Available: {', '.join(SOURCES)}", file=sys.stderr)
        return 1

    print(f"App: {args.adam_id}  Period: {start_date} ~ {end_date}")
    print(f"Sources: {sources}")
    print("Checking ASC session...")
    ensure_asc_session(args.adam_id)
    print("  Session OK")

    all_rows = []
    for source_key in sources:
        print(f"  Fetching {source_key}...", end=" ", flush=True)
        try:
            rows = fetch_source(args.adam_id, source_key, start_date, end_date)
            all_rows.extend(rows)
            nz = sum(1 for r in rows if r["totalDownloads"])
            print(f"{len(rows)} days, non-zero {nz}")
        except Exception as e:
            print(f"ERROR: {e}")
        time.sleep(0.3)

    if not all_rows:
        print("No data returned. Check login state.", file=sys.stderr)
        return 1

    out_path = Path(args.out or f"asc_global_source_{args.adam_id}_{start_date}_{end_date}.csv")
    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(sorted(all_rows, key=lambda r: (r["date"], r["source"])))

    print(f"\n✅ Saved: {out_path} ({len(all_rows)} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
