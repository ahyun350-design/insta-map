"use client";

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export type AppUser = {
  id: string;
  username: string;
  email?: string;
};

// 현재 로그인된 사용자 정보를 가져오는 훅
export function useUser() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ensureUserExists = async (userId: string, email?: string, preferredUsername?: string) => {
      console.log("users 테이블 체크 시작", { userId });
      const { data: existing } = await supabase
        .from("users")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (existing) {
        console.log("users 이미 존재:", preferredUsername || email?.split("@")[0] || "user");
        return;
      }

      const fallbackUsername =
        preferredUsername?.trim() ||
        email?.split("@")[0] ||
        "user";

      const { error } = await supabase.from("users").upsert({
        id: userId,
        username: fallbackUsername,
      }, { onConflict: "id" });
      if (error) {
        console.error("users 자동 INSERT 실패:", error);
      } else {
        console.log("users INSERT 성공:", fallbackUsername);
      }
    };

    // 1) 페이지 처음 로드시 현재 세션 확인
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      await ensureUserExists(
        session.user.id,
        session.user.email,
        session.user.user_metadata?.username || session.user.user_metadata?.name
      );

      // users 테이블에서 username 가져오기
      const { data } = await supabase
        .from("users")
        .select("username")
        .eq("id", session.user.id)
        .single();

      const username =
        data?.username ||
        session.user.user_metadata?.username ||
        session.user.user_metadata?.name ||
        session.user.email?.split("@")[0] ||
        "user";

      setUser({
        id: session.user.id,
        username,
        email: session.user.email,
      });
      setLoading(false);
    };

    loadUser();

    // 2) 로그인/로그아웃 변화 감지 (실시간)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!session?.user) {
          setUser(null);
          setLoading(false);
          return;
        }

        await ensureUserExists(
          session.user.id,
          session.user.email,
          session.user.user_metadata?.username || session.user.user_metadata?.name
        );

        const { data } = await supabase
          .from("users")
          .select("username")
          .eq("id", session.user.id)
          .single();

        const username =
          data?.username ||
          session.user.user_metadata?.username ||
          session.user.user_metadata?.name ||
          session.user.email?.split("@")[0] ||
          "user";

        setUser({
          id: session.user.id,
          username,
          email: session.user.email,
        });
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

// 로그아웃 함수
export async function logout() {
  await supabase.auth.signOut();
  window.location.href = "/login";
}