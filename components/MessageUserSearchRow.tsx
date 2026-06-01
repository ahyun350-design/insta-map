"use client";

import { ProfileAvatar } from "@/components/ProfileAvatar";
import { getUserSearchSubtitle, type UserSearchHit } from "@/lib/userSearch";

type Props = {
  hit: UserSearchHit;
  followLoading: boolean;
  onOpenProfile: (username: string) => void;
  onToggleFollow: (hit: UserSearchHit, e: React.MouseEvent) => void;
};

export function MessageUserSearchRow({ hit, followLoading, onOpenProfile, onToggleFollow }: Props) {
  const subtitle = getUserSearchSubtitle(hit);

  return (
    <div className="messageUserSearchRow">
      <button
        type="button"
        className="messageUserSearchRowMain"
        onClick={() => onOpenProfile(hit.username)}
        aria-label={`${hit.username} 프로필 보기`}
      >
        <ProfileAvatar avatarUrl={hit.avatar_url} username={hit.username} size={46} fontSize={16} />
        <span className="messageUserSearchRowText">
          <span className="messageUserSearchRowUsername">{hit.username}</span>
          {subtitle && <span className="messageUserSearchRowSubtitle">{subtitle}</span>}
        </span>
      </button>
      <button
        type="button"
        className={
          hit.isFollowing ? "messageUserSearchFollowBtn messageUserSearchFollowBtnFollowing" : "messageUserSearchFollowBtn"
        }
        disabled={followLoading}
        onClick={(e) => onToggleFollow(hit, e)}
        aria-pressed={hit.isFollowing}
      >
        {hit.isFollowing ? "팔로잉" : "팔로우"}
      </button>
    </div>
  );
}
