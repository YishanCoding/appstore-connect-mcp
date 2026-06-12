#!/usr/bin/env python3
"""Fetch ASC engagement metrics (sessions, active devices, uninstalls, etc.).

Pulls daily engagement data with no source dimension — these metrics are
app-wide aggregates. Uses the App Store Connect internal timeseries API
via an opencli browser session.

Metrics fetched:
  sessions          — app sessions per day
  activeDevices     — unique devices that opened the app
  uninstalls        — app deletions (ASC calls this "Deletions" in UI)
  impressionsTotal  — App Store impressions
  pageViewCount     — App Store product page views
  conversionRate    — page views → installs
  totalDownloads    — new installs + redownloads

Note: the API enforces an 89-day maximum per request. This script
automatically splits longer ranges into chunks.

Prerequisites:
  - opencli >= 1.8.0  (npm install -g @jackwener/opencli)
  - An "asc" browser session logged into App Store Connect
      opencli browser asc bind   (with ASC open in that browser tab)

Usage:
  python3 fetch_engagement_daily.py --adam-id 6754280964
  python3 fetch_engagement_daily.py --adam-id 6754280964 --days 90
  python3 fetch_engagement_daily.py --adam-id 6754280964 --start 2026-03-01 --end 2026-06-10
  python3 fetch_engagement_daily.py --adam-id 6754280964 --out engagement.json
  python3 fetch_engagement_daily.py --adam-id 6754280964 --format csv --out engagement.csv
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
CHUNK_DAYS      = 89  # API single-request maximum

MEASURES = [
    "sessions",
    "activeDevices",
    "uninstalls",
    "impressionsTotal",
    "pageViewCount",
    "conversionRate",
    "totalDownloads",
]

FIELDNAMES = ["date"] + MEASURES


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
             f"{ASC_URL}/analytics/app/{adam_id}"],
            capture_output=True, text=True, timeout=30,
        )
        time.sleep(5)


def fetch_chunk(adam_id: str, start_date: str, end_date: str) -> list[dict]:
    payload = {
        "adamId":           [adam_id],
        "measures":         MEASURES,
        "frequency":        "DAY",
        "startTime":        f"{start_date}T00:00:00Z",
        "endTime":          f"{end_date}T00:00:00Z",
        "dimensionFilters": [],
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
        raise RuntimeError(f"No results: {str(resp)[:300]}")

    # API returns one result object per measure — merge by date
    by_date: dict = {}
    for result in resp["results"]:
        for point in result.get("data", []):
            date_str = point.get("date", "")[:10]
            if not date_str:
                continue
            row = by_date.setdefault(date_str, {"date": date_str})
            for m in MEASURES:
                if m in point:
                    row[m] = point[m] or 0
    # fill missing measures with 0
    for row in by_date.values():
        for m in MEASURES:
            row.setdefault(m, 0)
    return [by_date[d] for d in sorted(by_date)]


def date_chunks(start: str, end: str):
    s = datetime.strptime(start, "%Y-%m-%d")
    e = datetime.strptime(end, "%Y-%m-%d")
    while s <= e:
        chunk_e = min(s + timedelta(days=CHUNK_DAYS - 1), e)
        yield s.strftime("%Y-%m-%d"), chunk_e.strftime("%Y-%m-%d")
        s = chunk_e + timedelta(days=1)


def main() -> int:
    parser = argparse.ArgumentParser(description="ASC engagement metrics (sessions/activeDevices/uninstalls/…)")
    parser.add_argument("--adam-id", required=True, help="App Adam ID (numeric)")
    parser.add_argument("--start",   default=None,  help="Start date YYYY-MM-DD")
    parser.add_argument("--end",     default=None,  help="End date YYYY-MM-DD")
    parser.add_argument("--days",    type=int, default=90, help="Last N days (ignored if --start/--end set)")
    parser.add_argument("--out",     default=None,  help="Output file path (auto-named if omitted)")
    parser.add_argument("--format",  choices=["json", "csv"], default="json",
                        help="Output format (default: json)")
    args = parser.parse_args()

    if args.start and args.end:
        start_date, end_date = args.start, args.end
    else:
        end_dt   = datetime.today()
        start_dt = end_dt - timedelta(days=args.days - 1)
        start_date = start_dt.strftime("%Y-%m-%d")
        end_date   = end_dt.strftime("%Y-%m-%d")

    chunks = list(date_chunks(start_date, end_date))
    print(f"App: {args.adam_id}  Period: {start_date} ~ {end_date}  ({len(chunks)} chunk(s))")
    print("Checking ASC session...")
    ensure_asc_session(args.adam_id)
    print("  Session OK\n")

    all_rows: dict = {}
    for i, (chunk_s, chunk_e) in enumerate(chunks, 1):
        print(f"  [{i}/{len(chunks)}] {chunk_s} ~ {chunk_e}...", end=" ", flush=True)
        try:
            rows = fetch_chunk(args.adam_id, chunk_s, chunk_e)
            for row in rows:
                all_rows[row["date"]] = row
            print(f"{len(rows)} days")
        except Exception as e:
            print(f"ERROR: {e}")
        time.sleep(0.35)

    if not all_rows:
        print("No data returned. Check login state.", file=sys.stderr)
        return 1

    sorted_rows = [all_rows[d] for d in sorted(all_rows)]

    if args.format == "csv":
        out_path = Path(args.out or f"asc_engagement_{args.adam_id}_{start_date}_{end_date}.csv")
        with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
            writer.writeheader()
            writer.writerows(sorted_rows)
    else:
        out_path = Path(args.out or f"asc_engagement_{args.adam_id}_{start_date}_{end_date}.json")
        payload = {
            "as_of":   datetime.today().strftime("%Y-%m-%d"),
            "period":  f"{start_date} ~ {end_date}",
            "adam_id": args.adam_id,
            "note":    "sessions/activeDevices/uninstalls have no source dimension — app-wide totals",
            "daily":   sorted_rows,
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n✅ Saved: {out_path} ({len(sorted_rows)} days)")

    # Summary
    print("\nMetric summary (days with non-zero values):")
    for m in MEASURES:
        vals = [r[m] for r in sorted_rows if r.get(m, 0)]
        if vals:
            print(f"  {m:18s}: avg {sum(vals)/len(vals):.1f}, max {max(vals)}, non-zero {len(vals)}d")
        else:
            print(f"  {m:18s}: all zero (metric may be unsupported or no data)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
