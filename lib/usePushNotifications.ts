"use client";

import { PushNotifications } from "@capacitor/push-notifications";
import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";
import { supabase } from "./supabase";

export function usePushNotifications(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    if (!Capacitor.isNativePlatform()) return;

    let registrationListener: any = null;
    let errorListener: any = null;
    let receivedListener: any = null;
    let actionListener: any = null;

    const init = async () => {
      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === "prompt") {
          permStatus = await PushNotifications.requestPermissions();
        }
        if (permStatus.receive !== "granted") {
          console.log("[push] 권한 거부됨");
          return;
        }

        await PushNotifications.register();

        registrationListener = await PushNotifications.addListener(
          "registration",
          async (token) => {
            console.log("[push] device token 받음");
            try {
              await supabase.from("users").update({ fcm_token: token.value }).eq("id", userId);
            } catch (e) {
              console.error("[push] token 저장 실패", e);
            }
          },
        );

        errorListener = await PushNotifications.addListener("registrationError", (err) => {
          console.error("[push] 등록 에러", err);
        });

        receivedListener = await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          console.log("[push] 도착", notification);
        });

        actionListener = await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          console.log("[push] 클릭", action.notification.data);
          const data = action.notification.data as { type?: string; room_id?: string; post_id?: string; actor_username?: string };
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
      registrationListener?.remove?.();
      errorListener?.remove?.();
      receivedListener?.remove?.();
      actionListener?.remove?.();
    };
  }, [userId]);
}
