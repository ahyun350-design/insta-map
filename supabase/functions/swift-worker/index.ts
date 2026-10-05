import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const FIREBASE_CLIENT_EMAIL = Deno.env.get("FIREBASE_CLIENT_EMAIL")!;
const FIREBASE_PRIVATE_KEY = Deno.env.get("FIREBASE_PRIVATE_KEY")!.replace(/\\n/g, "\n");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUSH_SECRET = Deno.env.get("PUSH_SECRET") ?? "";

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const claimB64 = btoa(JSON.stringify(claim)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const toSign = `${headerB64}.${claimB64}`;

  const pemContents = FIREBASE_PRIVATE_KEY
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const jwt = `${toSign}.${sigB64}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  return data.access_token;
}

async function sendPush(token: string, title: string, body: string, data: Record<string, string>) {
  const accessToken = await getAccessToken();
  const message = {
    message: {
      token,
      notification: { title, body },
      data,
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            sound: "default",
            "mutable-content": 1,
          },
        },
      },
      android: {
        priority: "HIGH",
      },
    },
  };
  const resp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    }
  );
  const respJson = await resp.json();
  if (resp.status !== 200) {
    console.error("[FCM] error", resp.status, JSON.stringify(respJson));
  }
  return respJson;
}

Deno.serve(async (req) => {
  try {
    if (PUSH_SECRET && req.headers.get("x-push-secret") !== PUSH_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await req.json();
    const { type, record, table } = payload;

    if (type !== "INSERT") return new Response("skip", { status: 200 });

    let recipientId = "";
    let title = "";
    let body = "";
    let pushData: Record<string, string> = {};

    if (table === "messages") {
      const roomResp = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${record.room_id}&select=*`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      const rooms = await roomResp.json();
      if (!rooms || rooms.length === 0) return new Response("no room", { status: 200 });
      const room = rooms[0];
      recipientId = room.user1_id === record.sender_id ? room.user2_id : room.user1_id;

      const senderResp = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${record.sender_id}&select=username`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      const senders = await senderResp.json();
      const senderName = senders?.[0]?.username || "누군가";

      title = senderName;
      body = record.text || record.content || "메시지가 도착했어요";
      pushData = { type: "message", room_id: String(record.room_id) };
    } else if (table === "notifications") {
      recipientId = record.user_id;
      const actorName = record.actor_username || "누군가";

      if (record.type === "like") {
        title = "좋아요";
        body = `${actorName}님이 회원님의 게시글을 좋아해요`;
        pushData = { type: "like", post_id: String(record.target_id || ""), actor_username: actorName };
      } else if (record.type === "comment") {
        title = "댓글";
        body = `${actorName}님이 댓글을 남겼어요`;
        pushData = { type: "comment", post_id: String(record.target_id || ""), actor_username: actorName };
      } else if (record.type === "follow") {
        title = "새 팔로워";
        body = `${actorName}님이 팔로우하기 시작했어요`;
        pushData = { type: "follow", actor_username: actorName };
      } else if (record.type === "extract_complete") {
        const count = String(record.target_text || "").trim();
        title = "장소 추출 완료";
        body = count ? `${count}곳을 찾았어요. 지도에서 확인해 보세요` : "지도에서 확인해 보세요";
        pushData = { type: "extract_complete" };
      } else if (record.type === "extract_share_outcome") {
        const outcomeText = String(record.target_text || "").trim();
        if (!outcomeText) {
          return new Response("skip notification type", { status: 200 });
        }
        title = "장소 추출";
        body = outcomeText;
        pushData = { type: "extract_share_outcome" };
      } else {
        return new Response("skip notification type", { status: 200 });
      }
    } else {
      return new Response("unknown table", { status: 200 });
    }

    const userResp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${recipientId}&select=fcm_token`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const users = await userResp.json();
    const fcmToken = users?.[0]?.fcm_token;

    if (!fcmToken) return new Response("no token", { status: 200 });

    const result = await sendPush(fcmToken, title, body, pushData);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-push error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});