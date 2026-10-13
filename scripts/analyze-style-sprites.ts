import { buildPindmapStyle } from "../lib/pindmapMapStyle";

async function main() {
  const style = await buildPindmapStyle("paper");
  const icons = new Map<string, string[]>();
  for (const layer of style.layers) {
    if (layer.layout?.visibility === "none") continue;
    const img = layer.layout?.["icon-image"];
    if (!img) continue;
    const key =
      typeof img === "string" ? img : JSON.stringify(img).slice(0, 160);
    if (!icons.has(key)) icons.set(key, []);
    icons.get(key)!.push(layer.id);
  }
  console.log("sprite:", style.sprite);
  console.log("glyphs:", style.glyphs);
  console.log("count:", icons.size);
  for (const [k, layers] of [...icons.entries()].sort()) {
    console.log(k, "=>", layers.join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
