import { WebPlugin } from "@capacitor/core";
import type {
  ConsumePendingShareResult,
  LastExtensionStartedResult,
  PindmapSharePlugin,
} from "./definitions";

export class PindmapShareWeb extends WebPlugin implements PindmapSharePlugin {
  async consumePendingShare(): Promise<ConsumePendingShareResult> {
    return { url: null, status: "empty" };
  }

  async getLastExtensionStarted(): Promise<LastExtensionStartedResult> {
    return { url: null, at: null };
  }

  async clearLastExtensionStarted(): Promise<void> {
    /* no-op */
  }
}
