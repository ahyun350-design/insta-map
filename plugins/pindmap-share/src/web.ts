import { WebPlugin } from "@capacitor/core";
import type { ConsumePendingShareResult, PindmapSharePlugin } from "./definitions";

export class PindmapShareWeb extends WebPlugin implements PindmapSharePlugin {
  async consumePendingShare(): Promise<ConsumePendingShareResult> {
    return { url: null, status: "empty" };
  }
}
