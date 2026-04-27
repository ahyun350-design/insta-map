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
    // 1) 페이지 처음 로드시 현재 세션 확인
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

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
          return;
        }

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