const ONBOARDING_SEEN_KEY = "pindmap_onboarding_seen";
const ONBOARDING_SEEN_VALUE = "1";

async function readOnboardingFlag(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: ONBOARDING_SEEN_KEY });
    return value;
  } catch {
    try {
      return window.localStorage.getItem(ONBOARDING_SEEN_KEY);
    } catch {
      return null;
    }
  }
}

async function writeOnboardingFlag(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: ONBOARDING_SEEN_KEY, value: ONBOARDING_SEEN_VALUE });
    return;
  } catch {
    try {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, ONBOARDING_SEEN_VALUE);
    } catch {
      /* ignore */
    }
  }
}

export async function hasSeenOnboarding(): Promise<boolean> {
  const value = await readOnboardingFlag();
  return value === ONBOARDING_SEEN_VALUE;
}

export async function setOnboardingSeen(): Promise<void> {
  await writeOnboardingFlag();
}

/** Unauthenticated entry: onboarding first, then login. */
export async function resolveUnauthenticatedPath(): Promise<"/onboarding" | "/login"> {
  const seen = await hasSeenOnboarding();
  return seen ? "/login" : "/onboarding";
}
