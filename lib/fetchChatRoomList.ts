import { supabase } from "./supabase";
import { normalizeAvatarUrl } from "./userAvatarCache";

export type ChatRoomListItem = {
  id: string;
  friendId: string;
  friendName: string;
  friendAvatarUrl?: string;
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
};

export type FetchChatRoomListOptions = {
  uid: string;
  onMissingFriend?: (roomId: string, friendId: string) => void;
  onFriendRow?: (row: {
    id: string;
    username: string | null;
    avatar_url: string | null;
  }) => void;
};

type RoomRow = {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
};

type LastMsgRow = {
  room_id: string;
  text: string | null;
  created_at: string;
};

/**
 * 채팅방 목록을 N+1 없이 배치 조회.
 * 쿼리: rooms 1 + users/lastMessages/unreads 3개 병렬 ≈ 4회.
 */
export async function fetchChatRoomList(
  options: FetchChatRoomListOptions,
): Promise<ChatRoomListItem[]> {
  const { uid, onMissingFriend, onFriendRow } = options;

  const { data: roomsData, error: roomsError } = await supabase
    .from("chat_rooms")
    .select("id, user1_id, user2_id, created_at")
    .or(`user1_id.eq.${uid},user2_id.eq.${uid}`);

  if (roomsError) throw roomsError;
  if (!roomsData?.length) return [];

  const rooms = roomsData as RoomRow[];
  const roomIds = rooms.map((r) => r.id);
  const friendIds = [
    ...new Set(
      rooms.map((r) => (r.user1_id === uid ? r.user2_id : r.user1_id)),
    ),
  ];

  const lastMsgLimit = Math.min(500, Math.max(50, roomIds.length * 5));

  const [usersRes, lastMsgsRes, unreadRes] = await Promise.all([
    supabase.from("users").select("id, username, avatar_url").in("id", friendIds),
    supabase
      .from("messages")
      .select("room_id, text, created_at")
      .in("room_id", roomIds)
      .order("created_at", { ascending: false })
      .limit(lastMsgLimit),
    supabase
      .from("messages")
      .select("room_id")
      .in("room_id", roomIds)
      .neq("sender_id", uid)
      .eq("read", false),
  ]);

  if (usersRes.error) throw usersRes.error;
  if (lastMsgsRes.error) throw lastMsgsRes.error;
  if (unreadRes.error) throw unreadRes.error;

  const userById = new Map<
    string,
    { id: string; username: string | null; avatar_url: string | null }
  >();
  for (const row of usersRes.data ?? []) {
    const u = row as {
      id: string;
      username: string | null;
      avatar_url: string | null;
    };
    userById.set(u.id, u);
    onFriendRow?.(u);
  }

  const lastByRoom = new Map<string, { text: string; created_at: string }>();
  for (const row of (lastMsgsRes.data ?? []) as LastMsgRow[]) {
    if (lastByRoom.has(row.room_id)) continue;
    lastByRoom.set(row.room_id, {
      text: typeof row.text === "string" ? row.text : "",
      created_at: row.created_at,
    });
  }

  const unreadByRoom = new Map<string, number>();
  for (const row of unreadRes.data ?? []) {
    const roomId = (row as { room_id: string }).room_id;
    unreadByRoom.set(roomId, (unreadByRoom.get(roomId) ?? 0) + 1);
  }

  const result: ChatRoomListItem[] = [];
  for (const r of rooms) {
    const friendId = r.user1_id === uid ? r.user2_id : r.user1_id;
    const friendData = userById.get(friendId);
    if (!friendData) {
      // users에 행이 없으면 유령 방으로 제외 (기존 maybeSingle 미존재와 동일)
      onMissingFriend?.(r.id, friendId);
      continue;
    }

    const last = lastByRoom.get(r.id);
    result.push({
      id: r.id,
      friendId,
      friendName: friendData.username || friendId,
      friendAvatarUrl: normalizeAvatarUrl(friendData.avatar_url),
      lastMessage: last?.text ?? "",
      lastTime: last?.created_at ?? r.created_at,
      unreadCount: unreadByRoom.get(r.id) ?? 0,
    });
  }

  return result;
}
