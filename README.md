# Insta Map

Instagram 게시물 URL을 입력하면, 서버에서 캡션을 스크랩하고 Claude API로 장소 정보를 추출해 Kakao Maps에 핀으로 표시하는 웹앱입니다.

## Features

- Instagram post URL 입력
- 서버에서 Instagram 캡션 자동 스크랩
- Claude API로 장소명/한국어 주소/카테고리 추출
- Kakao Maps 핀 표시
- localStorage 저장 및 삭제
- 카테고리별 색상 구분
- Vercel 배포 가능 (Next.js)

## Run locally

1. 의존성 설치

```bash
npm install
```

2. 환경변수 설정

```bash
cp .env.example .env.local
```

`.env.local`에 아래 값을 채워주세요.

- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_KAKAO_MAP_KEY`

3. 실행

```bash
npm run dev
```

## Deploy to Vercel

Vercel 프로젝트 환경변수에 아래를 추가하세요.

- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_KAKAO_MAP_KEY`

그 후 기본 Next.js 방식으로 배포하면 됩니다.
