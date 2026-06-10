export type InAppNotificationType = "message" | "like" | "comment" | "follow";

export type InAppNotificationItem = {
  id: string;
  type: InAppNotificationType;
  actorName: string;
  actorUsername: string;
  actorId: string;
  actorAvatarUrl?: string;
  text: string;
  targetId: string | null;
  notificationId?: string;
};

const PREVIEW_MAX = 30;

function preview(text: string, max = PREVIEW_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
}

export function formatMessageInAppText(actorName: string, messageText: string): string {
  if (/\[course:[^\]]+\]/.test(messageText)) {
    return `${actorName}님이 코스를 보냈습니다`;
  }
  return `${actorName}: ${preview(messageText)}`;
}

export function formatInAppNotificationFromRow(input: {
  type: InAppNotificationType;
  actor_username: string;
  target_text: string | null;
}): string {
  const name = input.actor_username;
  switch (input.type) {
    case "message":
      return input.target_text
        ? `${name}: ${preview(input.target_text)}`
        : `${name}님이 메시지를 보냈어요`;
    case "like":
      return `${name}님이 회원님의 게시물을 좋아합니다`;
    case "comment":
      return input.target_text
        ? `${name}님이 댓글: ${preview(input.target_text)}`
        : `${name}님이 댓글을 남겼어요`;
    case "follow":
      return `${name}님이 회원님을 팔로우하기 시작했습니다`;
    default:
      return `${name}님의 활동이 있어요`;
  }
}

export function inAppNotificationDedupeKey(item: Pick<InAppNotificationItem, "type" | "actorId" | "targetId">): string {
  return `${item.type}:${item.actorId}:${item.targetId ?? ""}`;
}
