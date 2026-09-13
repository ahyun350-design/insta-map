import { registerPlugin } from "@capacitor/core";
import type { PindmapSharePlugin } from "./definitions";

export type { ConsumePendingShareResult, PindmapSharePlugin } from "./definitions";

export const PindmapShare = registerPlugin<PindmapSharePlugin>("PindmapShare", {
  web: () => import("./web").then((m) => new m.PindmapShareWeb()),
});
