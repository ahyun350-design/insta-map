#!/usr/bin/env python3
"""NCP Object Storage probe for pindmap-tiles-kr. Never prints secrets or payloads."""

from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import boto3
import botocore
from botocore.client import Config
from botocore.exceptions import ClientError

KEYS = Path(__file__).resolve().parent / ".ncp_keys"
ENDPOINT = "https://kr.object.ncloudstorage.com"
REGION = "kr-standard"
BUCKET = "pindmap-tiles-kr"
TEST_KEY = "_pindmap_probe/cors-range-test.txt"
PUBLIC_URL = f"{ENDPOINT}/{BUCKET}/{TEST_KEY}"

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
        raise SystemExit("missing NCP keys in .ncp_keys")
    return ak, sk


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


def http(method: str, url: str, headers: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            while resp.read(65536):
                pass
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()} if e.headers else {}


def put_bucket_cors_md5(ak: str, sk: str, xml: bytes) -> int:
    """NCP requires Content-MD5; botocore omits it → sign manually with payload hash."""
    method = "PUT"
    url = f"{ENDPOINT}/{BUCKET}?cors="
    host = "kr.object.ncloudstorage.com"
    canonical_uri = f"/{BUCKET}"
    canonical_querystring = "cors="
    t = datetime.datetime.utcnow()
    amz_date = t.strftime("%Y%m%dT%H%M%SZ")
    datestamp = t.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(xml).hexdigest()
    content_md5 = base64.b64encode(hashlib.md5(xml).digest()).decode("ascii")
    headers = {
        "host": host,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "content-type": "application/xml",
        "content-md5": content_md5,
        "content-length": str(len(xml)),
    }
    signed_keys = sorted(headers.keys())
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in signed_keys)
    signed_headers = ";".join(signed_keys)
    canonical_request = "\n".join(
        [
            method,
            canonical_uri,
            canonical_querystring,
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    algorithm = "AWS4-HMAC-SHA256"
    scope = f"{datestamp}/{REGION}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            algorithm,
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )

    def _sign(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    k_date = _sign(("AWS4" + sk).encode("utf-8"), datestamp)
    k_region = hmac.new(k_date, REGION.encode(), hashlib.sha256).digest()
    k_service = hmac.new(k_region, b"s3", hashlib.sha256).digest()
    k_signing = hmac.new(k_service, b"aws4_request", hashlib.sha256).digest()
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    auth = (
        f"{algorithm} Credential={ak}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    req_headers = {k: headers[k] for k in signed_keys if k != "host"}
    req_headers["Authorization"] = auth
    req = urllib.request.Request(url, data=xml, method="PUT", headers=req_headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


CORS_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>https://pindmap.com</AllowedOrigin>
    <AllowedOrigin>https://insta-map-production.up.railway.app</AllowedOrigin>
    <AllowedOrigin>capacitor://localhost</AllowedOrigin>
    <AllowedOrigin>ionic://localhost</AllowedOrigin>
    <AllowedOrigin>http://localhost:3000</AllowedOrigin>
    <AllowedOrigin>http://127.0.0.1:3000</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>Content-Length</ExposeHeader>
    <ExposeHeader>Content-Range</ExposeHeader>
    <ExposeHeader>Accept-Ranges</ExposeHeader>
    <ExposeHeader>Content-Type</ExposeHeader>
    <ExposeHeader>Cache-Control</ExposeHeader>
    <MaxAgeSeconds>86400</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>"""


def main() -> int:
    ak, sk = load_keys()
    report: dict = {
        "endpoint": ENDPOINT,
        "region": REGION,
        "bucket": BUCKET,
        "boto3": boto3.__version__,
        "botocore": botocore.__version__,
    }
    s3 = make_client(ak, sk)

    s3.list_objects_v2(Bucket=BUCKET, MaxKeys=5)
    report["list_ok"] = True

    body = b"pindmap-ncp-probe-ok\n"
    s3.put_object(
        Bucket=BUCKET,
        Key=TEST_KEY,
        Body=body,
        ContentType="text/plain",
        CacheControl="public, max-age=60",
    )
    report["put_object_no_acl"] = {"ok": True}
    s3.put_object_acl(Bucket=BUCKET, Key=TEST_KEY, ACL="public-read")
    report["put_object_acl"] = {"ok": True}

    status = put_bucket_cors_md5(ak, sk, CORS_XML)
    report["put_bucket_cors"] = {"ok": True, "status": status}
    got = s3.get_bucket_cors(Bucket=BUCKET)
    report["cors_origins"] = sorted(
        {
            o
            for rule in got.get("CORSRules", [])
            for o in rule.get("AllowedOrigins", [])
        }
    )

    code, hdrs = http("GET", PUBLIC_URL)
    report["get_status"] = code
    report["get_cache_control"] = hdrs.get("cache-control")
    code_r, hdrs_r = http("GET", PUBLIC_URL, {"Range": "bytes=0-7"})
    report["range_status"] = code_r
    report["range_content_range"] = hdrs_r.get("content-range")
    for origin in ("https://pindmap.com", "capacitor://localhost"):
        c, h = http("GET", PUBLIC_URL, {"Origin": origin})
        report[f"cors_get_{origin}"] = {
            "status": c,
            "acao": h.get("access-control-allow-origin"),
        }

    s3.delete_object(Bucket=BUCKET, Key=TEST_KEY)
    report["delete_ok"] = True

    ok = (
        report["get_status"] == 200
        and report["range_status"] == 206
        and report["cors_get_https://pindmap.com"].get("acao")
        and report["cors_get_capacitor://localhost"].get("acao")
    )
    report["probe_pass"] = bool(ok)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if ok else 5


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ClientError as e:
        err = e.response.get("Error") or {}
        meta = e.response.get("ResponseMetadata") or {}
        print(
            json.dumps(
                {
                    "probe_pass": False,
                    "code": err.get("Code"),
                    "http_status": meta.get("HTTPStatusCode"),
                    "request_header_names": sorted(
                        (meta.get("HTTPHeaders") or {}).keys()
                    ),
                    "message_prefix": (err.get("Message") or "")[:80],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        raise SystemExit(5)
