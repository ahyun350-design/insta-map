import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

let initialized = false;

/** iOS 키보드 accessory bar(이전/다음/완료·예측) 숨김 — 앱 시작 시 1회 */
export async function initKeyboardAccessoryBarHidden(): Promise<void> {
  if (initialized) return;
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== "ios") return;

  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    initialized = true;
  } catch (err) {
    console.warn("[keyboard] setAccessoryBarVisible failed", err);
  }
}
