const MAP_FULLSCREEN_TIP_SEEN_KEY = "pindmap_map_fullscreen_tip_seen";
const MAP_FULLSCREEN_TIP_SEEN_VALUE = "1";

async function readMapFullscreenTipFlag(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: MAP_FULLSCREEN_TIP_SEEN_KEY });
    return value;
  } catch {
    try {
      return window.localStorage.getItem(MAP_FULLSCREEN_TIP_SEEN_KEY);
    } catch {
      return null;
    }
  }
}

async function writeMapFullscreenTipFlag(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: MAP_FULLSCREEN_TIP_SEEN_KEY, value: MAP_FULLSCREEN_TIP_SEEN_VALUE });
    return;
  } catch {
    try {
      window.localStorage.setItem(MAP_FULLSCREEN_TIP_SEEN_KEY, MAP_FULLSCREEN_TIP_SEEN_VALUE);
    } catch {
      /* ignore */
    }
  }
}

export async function hasSeenMapFullscreenTip(): Promise<boolean> {
  const value = await readMapFullscreenTipFlag();
  return value === MAP_FULLSCREEN_TIP_SEEN_VALUE;
}

export async function setMapFullscreenTipSeen(): Promise<void> {
  await writeMapFullscreenTipFlag();
}
