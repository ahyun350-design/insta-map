#!/usr/bin/env python3
"""List korea-buildings* objects in pindmap-tiles-kr (sizes only; no secrets)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Reuse upload client helpers
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("AWS_REQUEST_CHECKSUM_CALCULATION", "when_required")
os.environ.setdefault("AWS_RESPONSE_CHECKSUM_VALIDATION", "when_required")

from ncp_upload_pmtiles import BUCKET, client, load_keys  # noqa: E402

ak, sk = load_keys()
s3 = client(ak, sk)
rows = []
token = None
while True:
    kw = {"Bucket": BUCKET, "Prefix": "korea-buildings"}
    if token:
        kw["ContinuationToken"] = token
    resp = s3.list_objects_v2(**kw)
    for o in resp.get("Contents") or []:
        rows.append(
            {
                "key": o["Key"],
                "bytes": int(o["Size"]),
                "mb": round(int(o["Size"]) / 1e6, 1),
                "last_modified": o["LastModified"].isoformat(),
            }
        )
    if not resp.get("IsTruncated"):
        break
    token = resp.get("NextContinuationToken")
rows.sort(key=lambda r: r["key"])
print(json.dumps({"bucket": BUCKET, "objects": rows}, ensure_ascii=False, indent=2))
