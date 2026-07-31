const COACH_KEY_PREFIX = "pindmap_coach_";
const COACH_SEEN_VALUE = "1";

export const COACH_ORDER = [
  "reels_save",
  "curation_new",
  "map_search",
  "course_create",
  "course_share",
  "message_friend",
] as const;

export type CoachId = (typeof COACH_ORDER)[number];

export type CoachmarkDef = {
  id: CoachId;
  title: string;
  body: string;
  placement: "top" | "bottom";
};

export const COACHMARK_DEFS: CoachmarkDef[] = [
  {
    id: "reels_save",
    title: "릴스 링크를 붙여넣어 보세요",
    body: "인스타에서 저장한 릴스 링크를 넣으면 장소가 자동으로 정리돼요.",
    placement: "bottom",
  },
  {
    id: "curation_new",
    title: "다녀온 곳을 소개해 보세요",
    body: "좋았던 장소를 사진과 함께 올리면 사람들에게 공유돼요.",
    placement: "bottom",
  },
  {
    id: "map_search",
    title: "지도에서 직접 찾아서 저장하세요",
    body: "릴스에 없는 곳도 지도에서 검색해 바로 핀으로 저장할 수 있어요.",
    placement: "top",
  },
  {
    id: "course_create",
    title: "저장한 곳들로 코스를 만들어 보세요",
    body: "가고 싶은 순서대로 묶으면 하루 일정이 완성돼요.",
    placement: "bottom",
  },
  {
    id: "course_share",
    title: "만든 코스를 친구에게 보내보세요",
    body: "링크 하나면 친구도 바로 코스를 볼 수 있어요.",
    placement: "top",
  },
  {
    id: "message_friend",
    title: "친구를 찾아 추가해 보세요",
    body: "이름으로 검색해 팔로우하면 메시지를 주고받을 수 있어요.",
    placement: "bottom",
  },
];

function coachKey(id: string): string {
  return `${COACH_KEY_PREFIX}${id}`;
}

async function readCoachFlag(id: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const key = coachKey(id);
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

async function writeCoachFlag(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  const key = coachKey(id);
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value: COACH_SEEN_VALUE });
    return;
  } catch {
    try {
      window.localStorage.setItem(key, COACH_SEEN_VALUE);
    } catch {
      /* ignore */
    }
  }
}

export async function hasSeenCoach(id: string): Promise<boolean> {
  const value = await readCoachFlag(id);
  return value === COACH_SEEN_VALUE;
}

export async function setCoachSeen(id: string): Promise<void> {
  await writeCoachFlag(id);
}

export async function resetAllCoachmarks(): Promise<void> {
  if (typeof window === "undefined") return;
  const knownKeys = COACH_ORDER.map((id) => coachKey(id));
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { keys } = await Preferences.keys();
    const toRemove = new Set([
      ...knownKeys,
      ...keys.filter((key) => key.startsWith(COACH_KEY_PREFIX)),
    ]);
    await Promise.all([...toRemove].map((key) => Preferences.remove({ key })));
    return;
  } catch {
    try {
      knownKeys.forEach((key) => window.localStorage.removeItem(key));
      for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(COACH_KEY_PREFIX)) window.localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }
}

/** 디버그: "reels_save:O, curation_new:X, ..." (본 것 O, 안 본 것 X) */
export async function getCoachDebugState(): Promise<string> {
  const parts: string[] = [];
  for (const id of COACH_ORDER) {
    parts.push(`${id}:${(await hasSeenCoach(id)) ? "O" : "X"}`);
  }
  return parts.join(", ");
}

/**
 * candidates 배열 순서대로 아직 안 본 첫 id를 반환.
 * 없으면 null.
 */
export async function nextCoachToShow(candidates: string[]): Promise<string | null> {
  for (const id of candidates) {
    if (!(await hasSeenCoach(id))) return id;
  }
  return null;
}
