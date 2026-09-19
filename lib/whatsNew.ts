/**
 * Whats New — one-shot feature intros for existing users (Preferences + localStorage).
 * Pack ids (v1, v2, …) so we can ship later releases without resetting old ones.
 */

const WHATS_NEW_KEY_PREFIX = "pindmap_whats_new_";
const WHATS_NEW_SEEN_VALUE = "1";

/** Skip Whats New if auth account is newer than this (just finished signup/onboarding). */
export const WHATS_NEW_NEW_ACCOUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const WHATS_NEW_PACK_IDS = ["v1"] as const;
export type WhatsNewPackId = (typeof WHATS_NEW_PACK_IDS)[number];

export type WhatsNewStep = {
  n: number;
  text: string;
  /** Optional reassurance under the step title (e.g. one-time setup) */
  hint?: string;
  /** public path e.g. /whats-new/v1/share-step-2.jpg */
  imageSrc?: string;
  imageAlt?: string;
};

export type WhatsNewSlide = {
  id: string;
  title: string;
  body: string;
  /** Numbered how-to steps — shown one-at-a-time (horizontal swipe) when present */
  steps?: WhatsNewStep[];
  /** Single hero image when there are no steps */
  imageSrc?: string;
  imageAlt?: string;
};

export type WhatsNewPack = {
  id: WhatsNewPackId;
  slides: WhatsNewSlide[];
};

/** v1 — Share Extension + multi-select (no list colors; those wait for native 1.8 / v2) */
export const WHATS_NEW_PACK_V1: WhatsNewPack = {
  id: "v1",
  slides: [
    {
      id: "share_extension",
      title: "인스타에서 바로 저장하세요",
      body: "릴스 공유 버튼을 누르고 PindMap을 고르면 앱을 열지 않아도 저장돼요.",
      steps: [
        {
          n: 1,
          text: "릴스에서 공유 버튼을 누르고 「공유 대상...」을 선택해요",
          imageSrc: "/whats-new/v1/share-step-1.jpg",
          imageAlt: "인스타 공유 시트에서 공유 대상 선택",
        },
        {
          n: 2,
          text: "PindMap이 안 보이면 목록에서 찾아 + 를 눌러요",
          hint: "처음 한 번만 하면 돼요",
          imageSrc: "/whats-new/v1/share-step-2.jpg",
          imageAlt: "앱 편집 화면에서 PindMap 옆 + 버튼",
        },
        {
          n: 3,
          text: "즐겨찾기에 추가돼요",
          imageSrc: "/whats-new/v1/share-step-3.jpg",
          imageAlt: "즐겨찾기로 옮겨진 PindMap",
        },
        {
          n: 4,
          text: "이제 공유 화면에서 바로 PindMap을 고를 수 있어요",
          imageSrc: "/whats-new/v1/share-step-4.jpg",
          imageAlt: "공유 시트에 보이는 PindMap 아이콘",
        },
      ],
    },
    {
      id: "multi_select",
      title: "여러 장소를 한 번에",
      body: "저장 탭에서 장소를 길게 누르면 여러 개를 골라 목록에 담거나 삭제할 수 있어요. 전체 선택도 돼요.",
      imageSrc: "/whats-new/v1/multiselect.jpg",
      imageAlt: "저장 탭 다중 선택",
    },
  ],
};

export const WHATS_NEW_PACKS: Record<WhatsNewPackId, WhatsNewPack> = {
  v1: WHATS_NEW_PACK_V1,
};

function whatsNewKey(id: string): string {
  return `${WHATS_NEW_KEY_PREFIX}${id}`;
}

async function readWhatsNewFlag(id: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const key = whatsNewKey(id);
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key });
    return value;
  } catch {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

async function writeWhatsNewFlag(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  const key = whatsNewKey(id);
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value: WHATS_NEW_SEEN_VALUE });
    return;
  } catch {
    try {
      window.localStorage.setItem(key, WHATS_NEW_SEEN_VALUE);
    } catch {
      /* ignore */
    }
  }
}

export async function hasSeenWhatsNew(id: string): Promise<boolean> {
  const value = await readWhatsNewFlag(id);
  return value === WHATS_NEW_SEEN_VALUE;
}

export async function setWhatsNewSeen(id: string): Promise<void> {
  await writeWhatsNewFlag(id);
}

/**
 * Existing users only: auth account older than WHATS_NEW_NEW_ACCOUNT_MAX_AGE_MS.
 * Onboarding is device-local and set before login, so it cannot tell "just signed up"
 * from "onboarded months ago on this phone".
 */
export function isAccountOldEnoughForWhatsNew(
  createdAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (typeof createdAt !== "string" || !createdAt.trim()) return true;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= WHATS_NEW_NEW_ACCOUNT_MAX_AGE_MS;
}

/** Next unseen pack in order (v1, v2, …). */
export async function nextWhatsNewPackToShow(
  packIds: readonly WhatsNewPackId[] = WHATS_NEW_PACK_IDS,
): Promise<WhatsNewPack | null> {
  for (const id of packIds) {
    if (!(await hasSeenWhatsNew(id))) {
      return WHATS_NEW_PACKS[id] ?? null;
    }
  }
  return null;
}
