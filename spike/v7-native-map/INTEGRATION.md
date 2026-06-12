# V-7-0 Xcode 통합 가이드 (스파이크 브랜치 전용)

메인 `ios/` 변경은 **spike 브랜치에서만** 수행. 완료 후 main과 diff 검토.

## 사전 조건

- Xcode 15+
- `KAKAO_NATIVE_APP_KEY` (네이티브 앱 키, JS 키 아님)
- `git checkout -b spike/v7-native-map`

## Step 1: 플러그인을 Capacitor에 정식 등록 (⚠️ 필수)

`ios/App/CapApp-SPM/Package.swift`는 **`npx cap sync ios`마다 CLI가 전체 재생성**합니다.  
수동으로 두 줄 추가하면 다음 sync 때 **사라집니다**.

**올바른 방법:** 루트 `package.json`에 local plugin 의존성 추가 → `npm install` → `cap sync`.

`package.json` (spike 브랜치만):

```json
"@pindmap/native-map": "file:./spike/v7-native-map/plugin"
```

```bash
npm install
npx cap sync ios
```

성공 로그 예:

```
Found 5 Capacitor plugins for ios:
  ...
  @pindmap/native-map@0.0.1-spike
All plugins have a Package.swift file and will be included in Package.swift
```

플러그인 요건 (`spike/v7-native-map/plugin/`):

- `package.json` → `"capacitor": { "ios": { "src": "ios" } }`
- 루트 `Package.swift` (SPM product `PindmapNativeMap`)
- Swift `CAPBridgedPlugin` (`PindmapNativeMapPlugin.swift`)

**수동으로 `CapApp-SPM/Package.swift` 편집하지 마세요.**

## Step 2: KakaoMapsSDK SPM (Kakao 테스트 시)

Xcode → File → Add Package Dependencies:

```
https://github.com/kakao-mapsSDK/KakaoMapsSDK-SPM.git
```

Version: 2.12.0 이상

`CapApp-SPM/Package.swift` dependencies에 추가 (spike 브랜치만).

## Step 3: Native 앱 키

1. `ios/App/App/KakaoMapKeys.plist` 생성 (**.gitignore**):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>KAKAO_NATIVE_APP_KEY</key>
  <string>YOUR_NATIVE_APP_KEY</string>
</dict>
</plist>
```

2. **Xcode App 타깃에 반드시 포함** (파일만 두면 401 + Metal 타임아웃 발생):

   - Xcode 좌측 `App` 그룹에 `KakaoMapKeys.plist`가 보여야 함
   - File Inspector → Target Membership → **App** 체크
   - Build Phases → Copy Bundle Resources에 `KakaoMapKeys.plist` 있어야 함
   - 실행 로그: `[PindmapNativeMap] Kakao InitSDK OK` (없으면 번들 미포함)

3. `InitSDK`는 `PindmapNativeMapPlugin.load()`에서 호출 (App 타깃은 KakaoMapsSDK import 불필요).

## Step 4: 스파이크 페이지 로드

**옵션 A — 로컬 번들 (권장):**

```bash
cp spike/v7-native-map/spike-page/index.html public/spike-map.html
# capacitor.config spike 브랜치만:
# server: { url: undefined }  또는 cleartext localhost
npx cap sync ios
```

**옵션 B — Safari Web Inspector:**

기존 Railway 앱에서 DevTools 콘솔로 `PindmapNativeMap.createMap` 호출 (플러그인 등록 후).

## Step 5: 빌드 & 실행

```bash
npx cap sync ios
open ios/App/App.xcworkspace   # 또는 xcodeproj
```

Run on **실기기 또는 시뮬레이터**.

## Step 6: 체감 비교 체크리스트

- [ ] MapKit: 드래그·핀치 부드러움 (1–5점)
- [ ] Kakao Native: 동일
- [ ] 현재 JS API 지도 탭: 동일
- [ ] 카카오맵 앱: 기준
- [ ] WebView UI 버튼이 지도 위에 보이는가 (z-order)
- [ ] safe-area 하단 탭바와 겹침 없는가

## Step 7: 스파이크 종료

- main 머지 **하지 않음**
- 결과를 `spike/v7-native-map/README.md` 체감 표에 기록
- V-7-1 GO/NO-GO 결정
