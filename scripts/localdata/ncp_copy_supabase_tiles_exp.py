#!/usr/bin/env python3
"""
Copy Supabase map-tiles archives → NCP pindmap-tiles-kr/exp/ for host latency experiment.
Never prints secrets or object payloads. boto3 checksum when_required.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

KEYS = Path(__file__).resolve().parent / ".ncp_keys"
ENDPOINT = "https://kr.object.ncloudstorage.com"
REGION = "kr-standard"
BUCKET = "pindmap-tiles-kr"
PREFIX = "exp"

os.environ.setdefault("AWS_REQUEST_CHECKSUM_CALCULATION", "when_required")
os.environ.setdefault("AWS_RESPONSE_CHECKSUM_VALIDATION", "when_required")

FILES = [
    "korea-latest.pmtiles",
    "korea-sangga.pmtiles",
    "korea-tour.pmtiles",
    "korea-places-extra.pmtiles",
]


def load_keys() -> tuple[str, str]:
    ak = sk = ""
    for line in KEYS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k == "NCP_ACCESS_KEY_ID":
            ak = v
        elif k == "NCP_SECRET_KEY":
            sk = v
    if not ak or not sk:
        raise SystemExit("missing NCP keys")
    return ak, sk


def load_supabase_base() -> str:
    # Prefer env; else .env.local (no secrets printed)
    base = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().rstrip("/")
    if base:
        return base
    env_path = Path(__file__).resolve().parents[2] / ".env.local"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            return v.rstrip("/")
    raise SystemExit("missing NEXT_PUBLIC_SUPABASE_URL")


def make_client(ak: str, sk: str):
    try:
        cfg = Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        )
    except TypeError:
        cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"})
    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        region_name=REGION,
        aws_access_key_id=ak,
        aws_secret_access_key=sk,
        config=cfg,
    )


def head_ok(url: str) -> int | None:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as resp:
        cl = resp.headers.get("Content-Length")
        return int(cl) if cl else None


def main() -> int:
    sb = load_supabase_base()
    ak, sk = load_keys()
    s3 = make_client(ak, sk)
    from boto3.s3.transfer import TransferConfig

    tcfg = TransferConfig(
        multipart_threshold=64 * 1024 * 1024,
        multipart_chunksize=64 * 1024 * 1024,
        max_concurrency=4,
    )
    report: list[dict] = []
    for name in FILES:
        src = f"{sb}/storage/v1/object/public/map-tiles/{name}"
        key = f"{PREFIX}/{name}"
        row: dict = {"file": name, "key": key}
        try:
            size = head_ok(src)
            row["src_bytes"] = size
            with tempfile.NamedTemporaryFile(suffix=".pmtiles", delete=True) as tmp:
                urllib.request.urlretrieve(src, tmp.name)
                got = Path(tmp.name).stat().st_size
                row["dl_bytes"] = got
                s3.upload_file(
                    tmp.name,
                    BUCKET,
                    key,
                    ExtraArgs={
                        "ContentType": "application/octet-stream",
                        "CacheControl": "public, max-age=31536000, immutable",
                        "ACL": "public-read",
                    },
                    Config=tcfg,
                )
            # Verify public HEAD
            pub = f"{ENDPOINT}/{BUCKET}/{key}"
            req = urllib.request.Request(pub, method="HEAD")
            with urllib.request.urlopen(req, timeout=60) as resp:
                row["pub_status"] = resp.status
                row["pub_bytes"] = int(resp.headers.get("Content-Length") or 0)
                row["cache_control"] = resp.headers.get("Cache-Control")
            row["ok"] = row.get("pub_status") == 200
        except ClientError as e:
            err = e.response.get("Error") or {}
            row["ok"] = False
            row["code"] = err.get("Code")
            row["http"] = (e.response.get("ResponseMetadata") or {}).get(
                "HTTPStatusCode"
            )
        except Exception as e:  # noqa: BLE001
            row["ok"] = False
            row["error"] = type(e).__name__
        report.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)

    summary = {
        "bucket": BUCKET,
        "prefix": PREFIX,
        "ok": all(r.get("ok") for r in report),
        "files": len(report),
        "total_pub_bytes": sum(int(r.get("pub_bytes") or 0) for r in report),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["ok"] else 5


if __name__ == "__main__":
    raise SystemExit(main())
