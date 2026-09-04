/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.0.60'],
  // App Router 클라이언트 라우터 캐시 — 뒤로가기 시 dynamic 세그먼트를 잠시 재사용
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
}
module.exports = nextConfig
