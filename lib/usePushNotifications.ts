"use client";

import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";
import { supabase } from "./supabase";

async function saveFcmToken(userId: string, token: string) {
  try {
    const { error } = await supabase.from("users").update({ fcm_token: token }).eq("id", userId);
    if (error) console.error("[push] token 저장 실패", error);
  } catch (e) {
    console.error("[push] token 저장 실패", e);
  }
}

export function usePushNotifications(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    if (!Capacitor.isNativePlatform()) return;

    let tokenReceivedListener: { remove: () => void } | undefined;
    let notificationReceivedListener: { remove: () => void } | undefined;
    let notificationActionListener: { remove: () => void } | undefined;

    const init = async () => {
      try {
        const perm = await FirebaseMessaging.requestPermissions();
        if (perm.receive !== "granted") {
          console.log("[push] 권한 거부됨");
          return;
        }

        const { token } = await FirebaseMessaging.getToken();
        if (token) {
          console.log("[push] FCM token 받음");
          await saveFcmToken(userId, token);
        }

        tokenReceivedListener = await FirebaseMessaging.addListener("tokenReceived", async (event) => {
          console.log("[push] FCM token 갱신", event.token);
          if (event.token) await saveFcmToken(userId, event.token);
        });

        notificationReceivedListener = await FirebaseMessaging.addListener("notificationReceived", (event) => {
          console.log("[push] 도착", event.notification);
        });

        notificationActionListener = await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
          console.log("[push] 클릭", event.notification?.data);
          const data = event.notification?.data as
            | { type?: string; room_id?: string; post_id?: string; actor_username?: string }
            | undefined;
          if (data?.type === "message" && data?.room_id) {
            window.location.href = `/?openChatRoom=${encodeURIComponent(data.room_id)}`;
          } else if ((data?.type === "like" || data?.type === "comment") && data?.post_id) {
            window.location.href = `/?openPost=${encodeURIComponent(data.post_id)}`;
          } else if (data?.type === "follow" && data?.actor_username) {
            window.location.href = `/profile/${encodeURIComponent(data.actor_username)}`;
          }
        });
      } catch (e) {
        console.error("[push] 초기화 실패", e);
      }
    };

    void init();

    return () => {
      tokenReceivedListener?.remove();
      notificationReceivedListener?.remove();
      notificationActionListener?.remove();
    };
  }, [userId]);
}
