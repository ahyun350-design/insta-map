/**
 * Client-side cost of representative-list-color reduction (DISTINCT ON place_id).
 * Not a network benchmark — proves O(memberships) aggregation stays cheap at scale.
 *
 *   node scripts/bench-list-colors.mjs
 */
function reduceColors(rows) {
  const data = Object.create(null);
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(data, row.place_id)) continue;
    data[row.place_id] = row.color;
  }
  return data;
}

function synth(memberships, places) {
  const rows = [];
  for (let i = 0; i < memberships; i++) {
    rows.push({
      place_id: `p${i % places}`,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
      color: i % 2 === 0 ? "sunOrange" : "beetroot",
    });
  }
  // newest first (same as query ORDER BY created_at DESC)
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows;
}

for (const [memberships, places] of [
  [500, 400],
  [2000, 1500],
  [8000, 3000],
]) {
  const rows = synth(memberships, places);
  const t0 = performance.now();
  const out = reduceColors(rows);
  const ms = performance.now() - t0;
  console.log(
    `memberships=${memberships} places=${places} → colored=${Object.keys(out).length} reduceMs=${ms.toFixed(2)}`,
  );
}
