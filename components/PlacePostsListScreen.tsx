"use client";

import { PostGrid } from "@/components/PostGrid";
import { PostGridCell } from "@/components/PostGridCell";
import type { FeedPost } from "@/lib/feedPost";
import { getRepresentativePlaceForPost } from "@/lib/photoPlaceTag";

export type PlacePostsListData = {
  placeName: string;
  address: string;
  posts: FeedPost[];
};

type Props = {
  data: PlacePostsListData;
  onClose: () => void;
  onPostClick: (postId: string) => void;
};

export function PlacePostsListScreen({ data, onClose, onPostClick }: Props) {
  const { placeName, address, posts } = data;
  const title = placeName.trim() || "장소";
  const addr = address.trim();

  return (
    <div className="curationDetailOverlay" role="dialog" aria-label={`${title} 게시물`}>
      <main className="mobileRoot">
        <section className="phoneFrame">
          <header
            className="subpageHeader"
            style={{
              minHeight: 56,
              display: "flex",
              alignItems: "flex-start",
              padding: "12px 16px 12px 12px",
              borderBottom: "0.5px solid #efefef",
              background: "#fff",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="뒤로가기"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: "6px 4px",
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M13 4L7 10L13 16"
                  stroke="#1a2a7a"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#1a1a2e",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {title}
              </p>
              {addr ? (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "#888",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {addr}
                </p>
              ) : null}
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9a9fad" }}>
                게시물 {posts.length}개
              </p>
            </div>
          </header>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              background: "#fff",
              padding: "10px 12px 24px",
            }}
          >
            <PostGrid columns={2} className="homeFeedGrid" empty={posts.length === 0}>
              {posts.map((post) => {
                const repPlace = getRepresentativePlaceForPost(post);
                return (
                  <PostGridCell
                    key={post.id}
                    variant="home"
                    imageUrl={post.images[0]}
                    titleLine={(post.title || post.comment || repPlace.placeName || "").trim()}
                    placeName={repPlace.placeName}
                    address={repPlace.address}
                    likeCount={post.likes_count}
                    imageCount={post.images.length}
                    showUsername
                    showMultiIcon
                    username={post.user}
                    postId={post.id}
                    onSelect={onPostClick}
                  />
                );
              })}
            </PostGrid>
          </div>
        </section>
      </main>
    </div>
  );
}
