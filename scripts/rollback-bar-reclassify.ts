/**
 * Rollback bar reclassify from backup file.
 * Does NOT run unless invoked. Apply creates the backup.
 *
 *   npx tsx scripts/rollback-bar-reclassify.ts scripts/localdata/out/bar_reclass_backup_YYYYMMDD.json
 */
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BATCH = 40;

type PlaceBackup = {
  id: string;
  category: string;
  subcategory: string | null;
};

type FeedBackup = {
  id: string;
  categories: string[] | null;
  photo_place_tags: unknown;
};

type BackupFile = {
  places: PlaceBackup[];
  feed_posts?: FeedBackup[];
};

function loadEnv(): Record<string, string> {
  const raw = fs.readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1]!] = v;
  }
  return env;
}

async function main() {
  const backupArg = process.argv[2];
  if (!backupArg) {
    console.error(
      "Usage: npx tsx scripts/rollback-bar-reclassify.ts <backup.json>",
    );
    process.exit(1);
  }
  const backupPath = resolve(ROOT, backupArg);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8")) as BackupFile;
  const places = backup.places || [];
  const feeds = backup.feed_posts || [];

  const env = loadEnv();
  const sb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let placesDone = 0;
  for (let i = 0; i < places.length; i += BATCH) {
    const batch = places.slice(i, i + BATCH);
    for (const p of batch) {
      const { error } = await sb
        .from("places")
        .update({
          category: p.category,
          subcategory: p.subcategory,
        })
        .eq("id", p.id);
      if (error) {
        console.error("[ABORT places]", { id: p.id, error, placesDone });
        process.exit(1);
      }
      placesDone++;
    }
    console.log(`places restored ${placesDone}/${places.length}`);
  }

  let feedDone = 0;
  for (let i = 0; i < feeds.length; i += BATCH) {
    const batch = feeds.slice(i, i + BATCH);
    for (const f of batch) {
      const { error } = await sb
        .from("feed_posts")
        .update({
          categories: f.categories,
          photo_place_tags: f.photo_place_tags,
        })
        .eq("id", f.id);
      if (error) {
        console.error("[ABORT feed]", { id: f.id, error, feedDone });
        process.exit(1);
      }
      feedDone++;
    }
    console.log(`feed restored ${feedDone}/${feeds.length}`);
  }

  console.log(
    JSON.stringify(
      { ok: true, places_restored: placesDone, feed_restored: feedDone, backupPath },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
