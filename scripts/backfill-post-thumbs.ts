/**
 * Backfill `_thumb.jpg` for feed_posts images using sharp.
 *
 *   npx tsx scripts/backfill-post-thumbs.ts          # dry-run
 *   npx tsx scripts/backfill-post-thumbs.ts --apply  # write (resumable)
 *
 * Orphan storage files not referenced by feed_posts.images are skipped.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { thumbStoragePathFromOriginal } from "../lib/postImageThumb";

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]!] = v;
  }
  return env;
}

function extractPath(publicUrl: string): string | null {
  try {
    const u = new URL(publicUrl);
    const marker = "/post-images/";
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(u.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

async function listAllPaths(sb: SupabaseClient, prefix = ""): Promise<Set<string>> {
  const out = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from("post-images").list(prefix || undefined, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) return out;
    for (const item of data) {
      const p = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id == null && !item.metadata) {
        const nested = await listAllPaths(sb, p);
        for (const n of nested) out.add(n);
        continue;
      }
      out.add(p);
    }
    if (data.length < 100) return out;
    offset += 100;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const feedPaths = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("feed_posts").select("images").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      for (const u of (row as { images?: string[] }).images ?? []) {
        if (typeof u !== "string") continue;
        const p = extractPath(u);
        if (p && !/_thumb(\.[^./]+)?$/.test(p)) feedPaths.add(p);
      }
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log("Listing storage…");
  const storagePaths = await listAllPaths(sb);

  let already = 0;
  let missingOriginal = 0;
  const needWork: string[] = [];
  for (const p of [...feedPaths].sort()) {
    const thumbPath = thumbStoragePathFromOriginal(p);
    if (!thumbPath) continue;
    if (!storagePaths.has(p)) {
      missingOriginal++;
      continue;
    }
    if (storagePaths.has(thumbPath)) {
      already++;
      continue;
    }
    needWork.push(p);
  }

  const estThumbKb = 50;
  const estExtraMb = Math.round((needWork.length * estThumbKb) / 1024 * 10) / 10;
  const estMinAt2s = Math.round((needWork.length * 2) / 60 * 10) / 10;

  const summary = {
    mode: apply ? "apply" : "dryRun",
    feed_original_paths: feedPaths.size,
    already_have_thumb: already,
    missing_original: missingOriginal,
    to_create: needWork.length,
    est_extra_storage_mb: estExtraMb,
    est_minutes_at_2s_each: estMinAt2s,
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.mkdirSync(path.resolve(process.cwd(), "e2e/artifacts"), { recursive: true });
  fs.writeFileSync(
    path.resolve(process.cwd(), "e2e/artifacts/backfill-thumbs-dryrun.json"),
    JSON.stringify(summary, null, 2),
  );

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write thumbs (skips existing → resumable).");
    return;
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < needWork.length; i++) {
    const p = needWork[i]!;
    const thumbPath = thumbStoragePathFromOriginal(p)!;
    try {
      const { data: blob, error: dlErr } = await sb.storage.from("post-images").download(p);
      if (dlErr || !blob) throw dlErr || new Error("download empty");
      const input = Buffer.from(await blob.arrayBuffer());
      const out = await sharp(input)
        .rotate()
        .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();
      const { error: upErr } = await sb.storage.from("post-images").upload(thumbPath, out, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) {
        const msg = String((upErr as { message?: string }).message || "").toLowerCase();
        if (msg.includes("exist") || msg.includes("duplicate")) {
          ok++;
        } else {
          throw upErr;
        }
      } else {
        ok++;
      }
    } catch (e) {
      fail++;
      console.warn(`[${i + 1}/${needWork.length}] FAIL`, p, e);
    }
    if ((i + 1) % 25 === 0) {
      console.log(`progress ${i + 1}/${needWork.length} ok=${ok} fail=${fail}`);
    }
  }
  console.log(JSON.stringify({ done: true, ok, fail }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
