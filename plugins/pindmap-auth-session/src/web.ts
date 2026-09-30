import { WebPlugin } from "@capacitor/core";
import type {
  MirrorSessionOptions,
  PindmapAuthSessionPlugin,
} from "./definitions";

/** Web / pre-native: no Keychain — always no-op. */
export class PindmapAuthSessionWeb
  extends WebPlugin
  implements PindmapAuthSessionPlugin
{
  async mirrorSession(_options: MirrorSessionOptions): Promise<void> {
    /* no-op */
  }

  async clearSession(): Promise<void> {
    /* no-op */
  }
}
