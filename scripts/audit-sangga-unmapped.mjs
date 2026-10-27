/**
 * Count sangga CSV rows whose 업종 is not mapped by build-korea-sangga rules.
 * Writes e2e/artifacts/icons-v2/unmapped-top20.json (no raw addresses).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const RAW = path.join(ROOT, "scripts/localdata/raw_sangga");
const OUT = path.join(ROOT, "e2e/artifacts/icons-v2/unmapped-top20.json");

const py = `
import csv, json, sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, "scripts")
# Inline mirror of EXCLUDE + map_category from build-korea-sangga.py
from importlib.util import spec_from_loader, module_from_spec
from importlib.machinery import SourceFileLoader
loader = SourceFileLoader("sangga_build", "scripts/build-korea-sangga.py")
spec = spec_from_loader(loader.name, loader)
mod = module_from_spec(spec)
loader.exec_module(mod)

raw = Path("scripts/localdata/raw_sangga")
unmapped = Counter()
mapped = 0
excluded = 0
total = 0
for p in sorted(raw.glob("*.csv")):
    with p.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            total += 1
            dae = (row.get("상권업종대분류명") or "").strip()
            jung = (row.get("상권업종중분류명") or "").strip()
            so = (row.get("상권업종소분류명") or "").strip()
            if dae in mod.EXCLUDE_DAE:
                excluded += 1
                continue
            m = mod.map_category(dae, jung, so)
            if m is None:
                key = f"{dae}|{jung}|{so}"
                unmapped[key] += 1
            else:
                mapped += 1
top = [{"key": k, "count": c} for k, c in unmapped.most_common(20)]
print(json.dumps({"total": total, "mapped": mapped, "excluded_dae": excluded, "unmapped": sum(unmapped.values()), "top20": top}, ensure_ascii=False))
`;

const r = spawnSync(
  path.join(ROOT, "scripts/localdata/.venv/bin/python"),
  ["-c", py],
  { encoding: "utf8", cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status || 1);
}
const payload = JSON.parse(r.stdout.trim().split("\n").pop());
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log("wrote", path.relative(ROOT, OUT));
console.log(JSON.stringify({ unmapped: payload.unmapped, top5: payload.top20.slice(0, 5) }, null, 2));
