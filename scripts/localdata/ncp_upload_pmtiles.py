#!/usr/bin/env python3
"""Multipart upload PMTiles to pindmap-tiles-kr. No secrets / no data dumps."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

KEYS = Path(__file__).resolve().parent / ".ncp_keys"
ENDPOINT = "https://kr.object.ncloudstorage.com"
REGION = "kr-standard"
BUCKET = "pindmap-tiles-kr"

os.environ.setdefault("AWS_REQUEST_CHECKSUM_CALCULATION", "when_required")
os.environ.setdefault("AWS_RESPONSE_CHECKSUM_VALIDATION", "when_required")


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
        raise SystemExit("missing keys")
    return ak, sk


def client(ak: str, sk: str):
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


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: ncp_upload_pmtiles.py <local.pmtiles> <object-key>")
        return 2
    path = Path(sys.argv[1])
    key = sys.argv[2]
    if not path.is_file():
        print(json.dumps({"ok": False, "error": "missing_file"}))
        return 2
    size = path.stat().st_size
    ak, sk = load_keys()
    s3 = client(ak, sk)
    # multipart via boto3 transfer
    from boto3.s3.transfer import TransferConfig

    cfg = TransferConfig(
        multipart_threshold=64 * 1024 * 1024,
        multipart_chunksize=64 * 1024 * 1024,
        max_concurrency=4,
    )
    extra = {
        "ContentType": "application/octet-stream",
        "CacheControl": "public, max-age=31536000, immutable",
        "ACL": "public-read",
    }
    try:
        s3.upload_file(
            str(path),
            BUCKET,
            key,
            ExtraArgs=extra,
            Config=cfg,
        )
    except ClientError as e:
        err = e.response.get("Error") or {}
        print(
            json.dumps(
                {
                    "ok": False,
                    "code": err.get("Code"),
                    "http": (e.response.get("ResponseMetadata") or {}).get(
                        "HTTPStatusCode"
                    ),
                }
            )
        )
        return 3

    head = s3.head_object(Bucket=BUCKET, Key=key)
    remote = int(head.get("ContentLength") or 0)
    url = f"{ENDPOINT}/{BUCKET}/{key}"
    print(
        json.dumps(
            {
                "ok": True,
                "key": key,
                "local_bytes": size,
                "remote_bytes": remote,
                "size_match": size == remote,
                "url": url,
                "cache_control": head.get("CacheControl"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if size == remote else 4


if __name__ == "__main__":
    raise SystemExit(main())
