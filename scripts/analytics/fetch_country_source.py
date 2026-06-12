#!/usr/bin/env python3
"""Fetch ASC country × source daily metrics.

Pulls daily download / impression / CVR data cross-tabulated by country
and acquisition source (Search, Browse, AppRef, WebRef) using the App
Store Connect internal timeseries API via an opencli browser session.

Prerequisites:
  - opencli >= 1.8.0  (npm install -g @jackwener/opencli)
  - An "asc" browser session logged into App Store Connect
      opencli browser asc bind   (with ASC open in that browser tab)

Usage:
  python3 fetch_country_source.py --adam-id 6754280964
  python3 fetch_country_source.py --adam-id 6748596826 --days 90
  python3 fetch_country_source.py --adam-id 6748596826 --start 2026-04-01 --end 2026-05-31
  python3 fetch_country_source.py --adam-id 6748596826 --countries US CN JP --sources Search Other
  python3 fetch_country_source.py --adam-id 6748596826 --out my_country_source.csv
"""

import argparse
import collections
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

# Top 20 storefronts by typical install volume
STOREFRONTS = {
    "US": "143441",
    "CN": "143465",
    "JP": "143462",
    "IN": "143467",
    "MX": "143468",
    "TH": "143475",
    "BR": "143503",
    "VN": "143471",
    "TW": "143470",
    "DE": "143443",
    "FR": "143442",
    "GB": "143444",
    "CA": "143455",
    "PH": "143474",
    "ES": "143454",
    "IT": "143450",
    "HK": "143463",
    "TR": "143480",
    "AU": "143460",
    "SA": "143479",
}

FIELDNAMES = [
    "date", "country", "source", "source_key",
    "units", "redownloads", "totalDownloads",
    "impressionsTotal", "pageViewCount", "conversionRate",
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


def fetch_country_source(
    adam_id: str,
    country_code: str,
    storefront_id: str,
    source_key: str,
    start_date: str,
    end_date: str,
) -> list[dict]:
    payload = {
        "adamId":   [adam_id],
        "measures": MEASURES,
        "frequency": "DAY",
        "startTime": f"{start_date}T00:00:00Z",
        "endTime":   f"{end_date}T00:00:00Z",
        "dimensionFilters": [
            {"dimensionKey": "source",     "optionKeys": [source_key]},
            {"dimensionKey": "storefront", "optionKeys": [storefront_id]},
        ],
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
        raise RuntimeError(f"No results for {country_code}/{source_key}: {str(resp)[:300]}")

    rows = []
    for result in resp["results"]:
        for point in result.get("data", []):
            date_str = point.get("date", "")[:10]
            if not date_str:
                continue
            rows.append({
                "date":             date_str,
                "country":          country_code,
                "source":           SOURCES[source_key],
                "source_key":       source_key,
                "units":            point.get("units", 0) or 0,
                "redownloads":      point.get("redownloads", 0) or 0,
                "totalDownloads":   point.get("totalDownloads", 0) or 0,
                "impressionsTotal": point.get("impressionsTotal", 0) or 0,
                "pageViewCount":    point.get("pageViewCount", 0) or 0,
                "conversionRate":   point.get("conversionRate", 0) or 0,
            })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="ASC country × source daily metrics")
    parser.add_argument("--adam-id",   required=True, help="App Adam ID (numeric)")
    parser.add_argument("--start",     default=None,  help="Start date YYYY-MM-DD")
    parser.add_argument("--end",       default=None,  help="End date YYYY-MM-DD")
    parser.add_argument("--days",      type=int, default=90, help="Last N days (ignored if --start/--end set)")
    parser.add_argument("--countries", nargs="+", default=list(STOREFRONTS.keys()),
                        help=f"Country codes. Available: {list(STOREFRONTS.keys())}")
    parser.add_argument("--sources",   nargs="+", default=list(SOURCES.keys()),
                        help=f"Sources to fetch. Choices: {list(SOURCES.keys())}")
    parser.add_argument("--out",       default=None, help="Output CSV path")
    args = parser.parse_args()

    if args.start and args.end:
        start_date, end_date = args.start, args.end
    else:
        end_dt   = datetime.today()
        start_dt = end_dt - timedelta(days=args.days - 1)
        start_date = start_dt.strftime("%Y-%m-%d")
        end_date   = end_dt.strftime("%Y-%m-%d")

    countries = {k: STOREFRONTS[k] for k in args.countries if k in STOREFRONTS}
    sources   = [s for s in args.sources if s in SOURCES]

    if not countries:
        print(f"Invalid country codes. Available: {', '.join(STOREFRONTS)}", file=sys.stderr)
        return 1
    if not sources:
        print(f"Invalid sources. Available: {', '.join(SOURCES)}", file=sys.stderr)
        return 1

    print(f"App: {args.adam_id}  Period: {start_date} ~ {end_date}")
    print(f"Countries ({len(countries)}): {list(countries.keys())}")
    print(f"Sources ({len(sources)}): {sources}")
    print("Checking ASC session...")
    ensure_asc_session(args.adam_id)
    print("  Session OK\n")

    all_rows = []
    total = len(countries) * len(sources)
    done  = 0

    for cc, sf_id in countries.items():
        for src_key in sources:
            done += 1
            print(f"  [{done}/{total}] {cc} × {SOURCES[src_key]}...", end=" ", flush=True)
            try:
                rows = fetch_country_source(args.adam_id, cc, sf_id, src_key, start_date, end_date)
                all_rows.extend(rows)
                nz = sum(1 for r in rows if r["totalDownloads"] > 0)
                print(f"{len(rows)} days, non-zero {nz}")
            except Exception as e:
                print(f"ERROR: {e}")
            time.sleep(0.3)

    if not all_rows:
        print("No data returned. Check login state.", file=sys.stderr)
        return 1

    out_path = Path(args.out or f"asc_country_source_{args.adam_id}_{start_date}_{end_date}.csv")
    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(sorted(all_rows, key=lambda r: (r["date"], r["country"], r["source_key"])))

    print(f"\n✅ Saved: {out_path} ({len(all_rows)} rows)")

    # Quick summary: top 10 countries by Search downloads (last 30 days)
    recent_start = (datetime.strptime(end_date, "%Y-%m-%d") - timedelta(days=29)).strftime("%Y-%m-%d")
    recent_search = [r for r in all_rows if r["date"] >= recent_start and r["source_key"] == "Search"]
    cc_dl = collections.defaultdict(list)
    for r in recent_search:
        cc_dl[r["country"]].append(r["totalDownloads"])
    if cc_dl:
        print("\nTop 10 countries by Search downloads (last 30d avg/day):")
        ranked = sorted(cc_dl.items(), key=lambda x: sum(x[1]) / max(len(x[1]), 1), reverse=True)
        for cc, vals in ranked[:10]:
            print(f"  {cc:4s}: {sum(vals)/max(len(vals),1):.1f}/day")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
