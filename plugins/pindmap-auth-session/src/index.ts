import { registerPlugin } from "@capacitor/core";
import type { PindmapAuthSessionPlugin } from "./definitions";

export type {
  MirrorSessionOptions,
  PindmapAuthSessionPlugin,
} from "./definitions";

export const PindmapAuthSession = registerPlugin<PindmapAuthSessionPlugin>(
  "PindmapAuthSession",
  {
    web: () => import("./web").then((m) => new m.PindmapAuthSessionWeb()),
  },
);
