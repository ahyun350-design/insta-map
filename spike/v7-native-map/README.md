# V-7-0: 지도 네이티브화 스파이크

> **메인 코드 영향 없음** — `app/page.tsx`, `capacitor.config.ts`, `ios/App/` 프로덕션 설정 미변경.  
> 본 디렉터리 + `spike/v7-native-map` 브랜치에서만 작업 후, 검증 완료 시 V-7-1에 이식.

---

## 1. Kakao Developers 설정 사전 점검

| 항목 | 현재 상태 | 조치 (본인) |
|------|-----------|-------------|
| JS 키 | `.env.example` → `NEXT_PUBLIC_KAKAO_MAP_KEY` (프로덕션 WebView JS API용) | 기존 유지 |
| REST 키 | `KAKAO_REST_API_KEY` (서버 검색·extract) | 기존 유지 |
| **Native 앱 키** | **레포에 없음** (JS 키 ≠ Native 키) | [Kakao Developers](https://developers.kakao.com) → 앱 → 플랫폼 키 → **네이티브 앱 키** 발급 |
| Bundle ID | `com.pindmap.app` (`ios/App/App.xcodeproj`, `GoogleService-Info.plist` 일치) | Developers에 iOS 플랫폼 등록·Bundle ID 매칭 확인 |
| KakaoMaps SDK 인증 | `SDKInitializer.InitSDK(appKey:)` — [공식 문서](https://apis.map.kakao.com/ios_v2/docs/getting-started/basics/02_auth/) | Native 앱 키를 `ios/App/App/KakaoMapKeys.plist`(gitignore) 또는 Xcode Build Settings `KAKAO_NATIVE_APP_KEY`에 저장 |

**주의:** JavaScript 키로 Native SDK 인증 시 **401 오류** (공식 문서 error code 401).

---

## 2. KakaoMap iOS SDK 통합 방식

### 배포 채널

| 방식 | 가능 | 비고 |
|------|------|------|
| **SPM** | ✅ 권장 | `https://github.com/kakao-mapsSDK/KakaoMapsSDK-SPM.git` — 현재 CapApp-SPM(iOS 15+)과 정합 |
| CocoaPods | ✅ | Podfile 신규 — Capacitor 8은 이미 SPM 중심(`CapApp-SPM/Package.swift`) |

### 요구사항

- iOS **13+** (프로젝트는 **iOS 15** — 충족)
- 최신 SDK **2.12.x** (Metal 렌더링, GL 모드 제거됨)
- xcframework: arm64 디바이스 + 시뮬레이터(arm64/x64)

### CapApp-SPM 연동 (V-7-1 시)

`ios/App/CapApp-SPM/Package.swift`에 추가 예시:

```swift
.package(url: "https://github.com/kakao-mapsSDK/KakaoMapsSDK-SPM.git", from: "2.12.0"),
// targets dependencies:
.product(name: "KakaoMapsSDK", package: "KakaoMapsSDK-SPM"),
```

**스파이크 단계에서는 Package.swift 미수정** — Xcode에서 spike 브랜치만 수동 추가 후 빌드 검증.

---

## 3. Capacitor 커스텀 플러그인 scaffold

위치: `spike/v7-native-map/plugin/`

| 파일 | 역할 |
|------|------|
| `src/definitions.ts` | JS API 타입 (`createMap`, `destroyMap`, `setCamera`) |
| `src/index.ts` | `registerPlugin('PindmapNativeMap')` |
| `ios/Sources/PindmapNativeMapPlugin/PindmapNativeMapPlugin.swift` | MapKit 프로토타입 + Kakao 연동 스텁 |
| `ios/Sources/PindmapNativeMapPlugin/PindmapNativeMapPlugin.m` | `CAP_PLUGIN` 매크로 |

플러그인명: **`PindmapNativeMap`** (패키지 `@pindmap/native-map` 예정)

---

## 4. WebView ↔ Native UIView overlay 패턴

`@capacitor-community/google-maps`와 동일 계열:

```
CAPBridgeViewController
├── WKWebView (z-index 위, 지도 슬롯 div는 background: transparent)
└── Native Map UIView (insertSubview below webView, frame = JS getBoundingClientRect)
```

### JS → Native `createMap` 흐름

1. Web: `#spike-map` div 레이아웃 (고정 높이, `position: relative`)
2. `PindmapNativeMap.createMap({ elementId, lat, lng, zoom, provider })`
3. Native: `bridge.webView?.convert(rect, from: webView)` 로 frame 계산
4. `KMViewContainer`(Kakao) 또는 `MKMapView`(MapKit)를 `bridge.view`에 삽입
5. `layoutSubviews` / `ResizeObserver`로 WebView 스크롤·회전 시 frame 동기화

### z-order

- 지도: WebView **아래**
- 검색창·시트·탭바: WebView **위** (기존 React UI 그대로)

---

## 5. Pan/Zoom 체감 비교 (실기 테스트 체크리스트)

> 에이전트 환경에서는 Xcode 실기 실행 불가 — **본인 TestFlight/시뮬레이터에서 아래 수행**.

| 비교 대상 | 위치 | 서울 시청 (37.5665, 126.978) | 줌 |
|-----------|------|------------------------------|-----|
| A | 현재 핀맵 (JS API, 지도 탭 컴팩트) | 동일 | level 9 ≈ zoom 9 |
| B | 스파이크 MapKit (`provider: 'mapkit'`) | 동일 | 15 |
| C | 스파이크 Kakao Native (`provider: 'kakao'`) | 동일 | SDK level 매핑 |
| D | 카카오맵 앱 | 기준 100% | — |

**평가 항목:** 드래그 지연, 핀치 끊김, 관성, 첫 프레임까지 시간.

**예상 (문헌·아키텍처 기반):**

- B·C: 현재 A 대비 **체감 70–90%** (카카오앱 대비 85–95%)
- A의 병목: WKWebView + JS 마커 geocode 체인 (스파이크 빈 지도만 비교 시 차이 극대화)

---

## 6. MapKit 프로토타입

`PindmapNativeMapPlugin.swift` 내 `MapKitMapHost` — **Native 앱 키 없이 즉시 빌드 가능**.

- `MKMapView` + 서울 시청 region
- provider 기본값 `mapkit`으로 스파이크 검증
- 한국 POI: Apple 데이터 — 카카오 place_id·`place_url` 불일치 (참고용만)

---

## 7. 통합 난이도 평가

| 항목 | 평가 | 메모 |
|------|------|------|
| Capacitor bridge | 🟢 낮음 | 표준 `CAPPlugin` + `call.resolve` |
| WebView↔Native frame 동기화 | 🟡 중간 | 스크롤·키보드·safe-area 시 재계산 필요 |
| z-order (UI 위에 WebView) | 🟢 낮음 | 검증된 Google Maps 패턴 |
| Kakao SDK SPM 추가 | 🟢 낮음 | CapApp-SPM에 1 dependency |
| **Native 앱 키 발급** | 🔴 **블로커** | 없으면 Kakao 빈 지도 불가 |
| `server.url` Railway 원격 | 🟡 중간 | 스파이크 HTML은 로컬 `public/spike/` 또는 spike 브랜치 번들 |
| 회전·다중 Map 인스턴스 | 🟡 중간 | 현재 JS는 compact+expanded 2인스턴스 — Native는 1개 생명주기 권장 |

---

## 8. 검증 결과 (코드·문서 기준)

| 질문 | 결과 |
|------|------|
| KakaoMap 통합 **가능**? | **예** — SPM + `SDKInitializer` + `KMViewContainer` 공식 경로 확인 |
| KakaoMap 스파이크 **빌드 성공**? | **미실행** — Native 앱 키 + Xcode spike 브랜치 필요 |
| MapKit 프로토타입 **가능**? | **예** — 스캐폴드 Swift 포함, 키 불필요 |
| pan/zoom **실측**? | **본인 테스트 대기** |
| V-7-1 진입 권장? | **조건부 예** — 아래 참고 |

### V-7-1 진입 권장: **조건부 예 (YES after 1-hour Xcode spike)**

**이유:**

1. KakaoMapsSDK SPM·Capacitor SPM 환경 **호환 확인됨**
2. overlay 패턴 **업계 표준** (Google Maps Capacitor plugin)
3. MapKit으로 **bridge·frame 동기화** 먼저 검증 가능 (키 없이)
4. 리스크는 **구현 난이도**보다 **Native 키·Xcode 빌드·심사 주기**

**NO로 바꿀 조건:**

- Native 앱 키 발급/Bundle ID 등록 실패
- MapKit 스파이크에서 frame 동기화가 1일 내 해결 불가
- Kakao SDK 인증 401 지속

### 발견된 기술적 장애물

1. **JS 키 ≠ Native 키** — 별도 발급 필수
2. **`SDKInitializer.InitSDK`는 AppDelegate 엔진 시작 전** — V-7-1에서 AppDelegate 최소 1줄 (스파이크는 플러그인 load 시)
3. **Railway `server.url`** — 프로덕션 WebView는 원격; Native map은 로컬 UIView라 **플러그인 JS는 앱 번들**에 포함 필요
4. **현재 `page.tsx` 지도 로직 ~2000줄** — V-7-1은 `lib/nativeMap.ts` 분리 필수
5. **WKWebView 마커 click 우회 코드 대량** — Native 전환 시 제거 가능하나 마이그레이션 비용
6. **KakaoMapsSDK 2.11+ GL 제거** — Metal only (시뮬레이터 arm64 Mac OK)

### 본인 사전 처리

- [ ] Kakao Developers **네이티브 앱 키** 발급
- [ ] iOS 플랫폼 `com.pindmap.app` 등록
- [ ] `git checkout -b spike/v7-native-map`
- [ ] `INTEGRATION.md` 따라 Xcode 1시간 스파이크 빌드
- [ ] MapKit `provider: mapkit` pan/zoom 체감 기록
- [ ] Native 키 입력 후 Kakao `provider: kakao` 재테스트

### 권장 다음 단계

1. **오늘:** Native 앱 키 발급 + `spike/v7-native-map` 브랜치에서 `INTEGRATION.md` 실행
2. **MapKit 먼저** (1–2h): bridge·overlay 검증
3. **Kakao SDK 추가** (2–3h): 빈 지도 + pan/zoom
4. **통과 시 V-7-1:** `lib/nativeMap.ts` + 확장 지도만 Native 교체
5. **실패 시:** WebView 최적화(좌표 DB·클러스터) 병행 또는 MapKit 장기 검토

---

## 스파이크 코드 위치

```
spike/v7-native-map/
├── README.md                 ← 본 문서
├── INTEGRATION.md            ← Xcode 단계별 가이드
├── env.example               ← KAKAO_NATIVE_APP_KEY 템플릿
├── plugin/                   ← Capacitor 플러그인 스캐폴드
└── spike-page/index.html     ← 비교용 테스트 페이지 (로컬 서빙)
```

**권장 브랜치:** `spike/v7-native-map` (main 머지 전)
