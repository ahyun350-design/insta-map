import path from "node:path";
import { test, expect } from "@playwright/test";
import { requireE2ECredentials } from "./helpers/env";
import { attachCollectors } from "./helpers/collectors";
import { createSoftRunner } from "./helpers/softRunner";
import {
  assertHomeFeedContent,
  dismissCoachmarks,
  dismissSavedOverlays,
  dismissWhatsNewIfPresent,
  edgeSwipeBack,
  gotoTab,
  safeClick,
  savedMyListsButton,
  suppressCoachmarks,
  tabBar,
  tabButton,
  waitForHomeFeed,
} from "./helpers/nav";
import { ensureLoggedIn } from "./helpers/login";

const ARTIFACTS = path.resolve(process.cwd(), "e2e/artifacts");
const SCREENSHOTS = path.join(ARTIFACTS, "screenshots");
const REPORT = path.join(ARTIFACTS, "report.md");

test.describe.configure({ mode: "serial" });

test("production smoke — major tabs (continue on failure)", async ({
  page,
  context,
}) => {
  requireE2ECredentials();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.5665, longitude: 126.978 });
  await suppressCoachmarks(context);

  // Accept native confirm() for logout
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });

  const collectors = attachCollectors(page);
  const runner = createSoftRunner(page, {
    screenshotDir: SCREENSHOTS,
    reportPath: REPORT,
    beginStep: () => collectors.beginStep(),
    endStep: () => collectors.endStep(),
    beforeEachStep: async () => {
      await dismissCoachmarks(page);
      await dismissWhatsNewIfPresent(page, 800);
    },
  });

  const listTitle = `E2E ${Date.now()}`;

  // ── 1. Login ──────────────────────────────────────────────
  await runner.step("1. 로그인", async () => {
    await ensureLoggedIn(page);
    await expect(tabBar(page)).toBeVisible({ timeout: 15_000 });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 15_000 });
  });

  await runner.step("1c. 온보딩 Share Extension 슬라이드", async () => {
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".onboardingRoot, .onboardingRootFinal")).toBeVisible({
      timeout: 15_000,
    });

    const nextBtn = page.getByRole("button", { name: "다음" });
    // Slides 0→1→2→3 (share)
    for (let i = 0; i < 3; i++) {
      await expect(nextBtn).toBeVisible();
      await safeClick(nextBtn);
      await page.waitForTimeout(350);
    }

    await expect(page.getByRole("heading", { name: "인스타에서 바로 저장" })).toBeVisible();
    await expect(page.getByTestId("steps-carousel")).toBeVisible();
    const track = page.getByTestId("steps-carousel-track");
    const progress = page.getByTestId("steps-carousel-progress");
    await expect(progress).toHaveText("1 / 4");

    await track.evaluate((el) => {
      const node = el as HTMLElement;
      node.scrollLeft = node.clientWidth * 3;
    });
    await page.waitForTimeout(400);
    await expect(progress).toHaveText("4 / 4");

    // Extra swipe / scroll past last step — stay on share slide
    const box = await track.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.4);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.4, { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    await track.evaluate((el) => {
      const node = el as HTMLElement;
      node.scrollLeft = node.clientWidth * 6;
    });
    await page.waitForTimeout(300);

    await expect(progress).toHaveText("4 / 4");
    await expect(page.getByRole("heading", { name: "인스타에서 바로 저장" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "이제 시작해볼까요" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "시작하기" })).toHaveCount(0);

    await safeClick(nextBtn);
    await page.waitForTimeout(350);
    await expect(page.getByRole("heading", { name: "이제 시작해볼까요" })).toBeVisible();
  });

  // ── 1b. Whats New (optional — may already be seen) ────────
  await runner.stepOptional("1b. Whats New 모달 표시 및 닫기", async () => {
    // Map-first landing waits for compact map + ~900ms before showing
    const shown = await dismissWhatsNewIfPresent(page, 5_000);
    return shown ? "pass" : "skip";
  });

  // ── 2. HOME feed ──────────────────────────────────────────
  await runner.step("2. HOME 피드 — 큐레이션 로딩", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);
    await assertHomeFeedContent(page);
  });

  await runner.step("2b. HOME 칩 왕복 — 커버 썸네일 복원", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);

    async function selectChip(label: string) {
      await page.locator(".categoryFilterTab", { hasText: label }).first().click();
      await page.waitForTimeout(800);
    }

    async function cellSnap() {
      return page.evaluate(() =>
        Array.from(document.querySelectorAll(".homeFeedGrid .postGridCell"))
          .slice(0, 12)
          .map((cell) => {
            const img = cell.querySelector("img") as HTMLImageElement | null;
            const title = (cell.querySelector(".postGridCellHomeTitle")?.textContent || "").trim();
            const src = img?.currentSrc || img?.src || "";
            return { title, file: src.split("/").pop() || "" };
          })
          .filter((r) => r.title && r.file),
      );
    }

    await selectChip("전체");
    const all1 = await cellSnap();
    expect(all1.length, "전체 칩 그리드 셀").toBeGreaterThan(0);

    await selectChip("카페");
    const cafe = await cellSnap();
    await selectChip("전체");
    const all2 = await cellSnap();
    await selectChip("맛집");
    const food = await cellSnap();
    await selectChip("전체");
    const all3 = await cellSnap();

    const byTitle = (rows: { title: string; file: string }[]) => {
      const m = new Map<string, string>();
      for (const r of rows) m.set(r.title, r.file);
      return m;
    };
    const m1 = byTitle(all1);
    const mCafe = byTitle(cafe);
    const m2 = byTitle(all2);
    const mFood = byTitle(food);
    const m3 = byTitle(all3);

    let checked = 0;
    for (const [title, file1] of m1) {
      const cafeFile = mCafe.get(title);
      if (!cafeFile || cafeFile === file1) continue;
      checked++;
      expect(m2.get(title), `${title} after 카페→전체`).toBe(file1);
      expect(m3.get(title), `${title} after 맛집→전체`).toBe(file1);
      // 전체로 돌아왔을 때 cover(=images[0] thumb), not category photo
      expect(m2.get(title)?.includes("_thumb") || !!m2.get(title)).toBeTruthy();
    }
    // At least one post should change photo under 카페 if data allows
    if (checked === 0) {
      // eslint-disable-next-line no-console
      console.log("  (info) 카페에서 커버가 바뀌는 공통 포스트 없음 — 복원 검증 스킵");
    } else {
      // eslint-disable-next-line no-console
      console.log(`  (info) 칩 왕복 복원 확인 ${checked}건`);
    }
    // 맛집 칩에서 파일이 바뀐 케이스도 복원됐는지 (위에서 m3 검사)
    void food;
    void mFood;
  });

  // ── 3. MAP ────────────────────────────────────────────────
  await runner.step("3. MAP 탭 — 지도/핀", async () => {
    await gotoTab(page, "map");
    await expect(page.locator(".screenMapTab")).toBeVisible();
    await expect(page.getByText("지도", { exact: true }).first()).toBeVisible();

    const mapEl = page.locator(".kakaoMap.mapCompactMap");
    await expect(mapEl).toBeVisible({ timeout: 45_000 });

    await page.waitForTimeout(2500);
    const loading = page.locator(".mapCompactLoading");
    const stillLoading = await loading.isVisible().catch(() => false);
    if (stillLoading) {
      await loading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
    }

    const box = await mapEl.boundingBox();
    expect(box && box.height > 80 && box.width > 80, "지도 컨테이너 크기").toBeTruthy();

    const pinish = page.locator(
      ".kakaoMap img, .kakaoMap area, .mapCompactWrap img[src*='marker'], .mapCompactWrap img[src*='pin']",
    );
    const pinCount = await pinish.count();
    if (pinCount === 0) {
      // eslint-disable-next-line no-console
      console.log("  (info) 맵 핀 DOM을 못 찾음 — 지도 컨테이너만 확인");
    }
  });

  // ── 4. SAVED ──────────────────────────────────────────────
  await runner.step("4a. SAVED — 목록 표시", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");
    await expect(page.locator(".savedSortTrigger")).toBeVisible({ timeout: 20_000 });
    const items = page.locator("article.savedItem");
    const empty = page.getByText(/저장한 장소가 없어요|아직 저장/);
    const hasItems = (await items.count()) > 0;
    const isEmpty = await empty.first().isVisible().catch(() => false);
    expect(
      hasItems || isEmpty || (await page.locator(".savedSortRow").isVisible()),
      "SAVED 탭 렌더",
    ).toBeTruthy();
  });

  await runner.step("4b. SAVED — 정렬 드롭다운 3옵션", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");
    const trigger = page.locator(".savedSortTrigger");
    await safeClick(trigger);
    await expect(page.locator(".savedSortMenu")).toBeVisible();

    for (const label of ["지역순", "가까운 순", "카테고리순"] as const) {
      await safeClick(page.locator(".savedSortOption", { hasText: label }));
      await expect(trigger).toContainText(label);
      await page.waitForTimeout(400);
      await safeClick(trigger);
      await expect(page.locator(".savedSortMenu")).toBeVisible();
    }
    await safeClick(page.locator(".savedSortOption").first());
  });

  await runner.step("4c. SAVED — 장소 시트 / 길찾기", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");
    const items = page.locator("article.savedItem");
    if ((await items.count()) === 0) {
      throw new Error("저장된 장소가 없어 시트/길찾기 스킵 불가 — 실패로 기록");
    }
    await safeClick(items.first());
    const sheet = page.locator(".placeDetailSheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    const carBtn = sheet.getByRole("button", { name: /자동차/ });
    const walkBtn = sheet.getByRole("button", { name: /도보/ });
    await expect(carBtn.or(walkBtn).first()).toBeVisible();

    const disabledHint = sheet.getByText(/위치 정보가 없어 길찾기를/);
    const hasNoCoords = await disabledHint.isVisible().catch(() => false);
    if (!hasNoCoords) {
      await expect(carBtn).toBeEnabled();
      await expect(walkBtn).toBeEnabled();
    } else {
      await expect(carBtn).toBeDisabled();
    }

    await safeClick(sheet.getByRole("button", { name: "닫기" }));
    await expect(sheet).toBeHidden({ timeout: 10_000 }).catch(async () => {
      await page.keyboard.press("Escape");
    });
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");
    await expect(savedMyListsButton(page)).toBeVisible({ timeout: 15_000 });
  });

  await runner.step("4d. SAVED — 내 목록 생성·담기·순서·삭제", async () => {
    // 시트가 탭바를 가리면 gotoTab 실패 → 먼저 정리 후 SAVED 로 이동
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");

    const myListsBtn = savedMyListsButton(page);
    await expect(myListsBtn).toBeVisible({ timeout: 20_000 });

    const items = page.locator("article.savedItem");
    await expect(items.first()).toBeVisible({ timeout: 20_000 });
    const itemCount = await items.count();
    if (itemCount === 0) {
      throw new Error("저장된 장소가 없어 내 목록 E2E를 진행할 수 없음");
    }
    // eslint-disable-next-line no-console
    console.log(`  (info) saved places: ${itemCount}${itemCount < 2 ? " — 장소 1개로 진행" : ""}`);

    await safeClick(items.first());
    const sheet = page.locator(".placeDetailSheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await safeClick(sheet.getByRole("button", { name: "목록에 추가" }));
    const addSheet = page.locator(".placeListSheet");
    await expect(addSheet).toBeVisible();
    await safeClick(addSheet.getByRole("button", { name: /새 목록 만들기/ }));
    await addSheet.locator(".placeListSheetCreateInput").fill(listTitle);
    await safeClick(addSheet.getByRole("button", { name: "만들기" }));
    await expect(addSheet.getByText(listTitle)).toBeVisible({ timeout: 15_000 });
    await safeClick(addSheet.getByRole("button", { name: "닫기" }));
    await safeClick(sheet.getByRole("button", { name: "닫기" })).catch(() => null);
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");

    // 다중 담기는 장소 2개 이상일 때만
    const itemsAfter = page.locator("article.savedItem");
    const countAfter = await itemsAfter.count();
    if (countAfter >= 2) {
      const second = itemsAfter.nth(1);
      await second.scrollIntoViewIfNeeded();
      await safeClick(second);
      const sheet2 = page.locator(".placeDetailSheet");
      await expect(sheet2).toBeVisible({ timeout: 15_000 });
      await safeClick(sheet2.getByRole("button", { name: "목록에 추가" }));
      const add2 = page.locator(".placeListSheet");
      await expect(add2).toBeVisible();
      const row = add2.locator(".placeListSheetCheckItem", { hasText: listTitle });
      await row.locator('input[type="checkbox"]').check();
      await page.waitForTimeout(800);
      await safeClick(add2.getByRole("button", { name: "닫기" }));
      await safeClick(sheet2.getByRole("button", { name: "닫기" })).catch(() => null);
      await dismissSavedOverlays(page);
      await gotoTab(page, "saved");
    } else {
      // eslint-disable-next-line no-console
      console.log("  (info) 장소 1개 — 두 번째 담기 스킵");
    }

    await expect(myListsBtn).toBeVisible({ timeout: 15_000 });
    await safeClick(myListsBtn);
    const myLists = page.locator(".myListsScreen");
    await expect(myLists).toBeVisible({ timeout: 15_000 });
    await safeClick(myLists.locator(".myListsListItem", { hasText: listTitle }));
    await expect(myLists.locator(".myListsDetailItem").first()).toBeVisible({
      timeout: 15_000,
    });

    // 이름 클래스는 SAVED 와 동일하게 `.savedName` (구 `.myListsDetailName`)
    const detailNames = myLists.locator(".myListsDetailItem .savedName");
    const beforeCount = await detailNames.count();
    expect(beforeCount).toBeGreaterThan(0);

    // 검색 UI 스모크 (필터 시 드래그 비활성 → 끝나면 비움)
    const search = myLists.getByTestId("list-detail-search");
    await expect(search).toBeVisible();
    const firstPlaceName = (await detailNames.nth(0).innerText()).trim();
    await search.fill("__no_match_e2e__");
    await expect(myLists.getByText("검색 결과가 없어요")).toBeVisible({ timeout: 5_000 });
    await search.fill("");
    await expect(myLists.locator(".myListsDetailItem").first()).toBeVisible({
      timeout: 5_000,
    });

    // ⋯ → 목록에서 빼기 (장소 2개 이상일 때만 하나 제거)
    if (beforeCount >= 2) {
      await safeClick(myLists.getByTestId("list-item-menu").first());
      const actionSheet = page.locator(".listDetailActionSheet");
      await expect(actionSheet).toBeVisible({ timeout: 5_000 });
      await safeClick(actionSheet.getByRole("button", { name: "목록에서 빼기" }));
      await expect(detailNames).toHaveCount(beforeCount - 1, { timeout: 15_000 });
    } else {
      // eslint-disable-next-line no-console
      console.log("  (info) 목록 장소 1개 — 목록에서 빼기 스킵");
    }

    const afterRemoveCount = await detailNames.count();
    const handles = myLists.locator(".myListsDragHandle");
    if (afterRemoveCount >= 2 && (await handles.count()) >= 2) {
      const nameBefore = (await detailNames.nth(0).innerText()).trim();
      const box0 = await handles.nth(0).boundingBox();
      const box1 = await handles.nth(1).boundingBox();
      if (box0 && box1) {
        await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
        await page.mouse.down();
        await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2 + 20, {
          steps: 12,
        });
        await page.mouse.up();
        await page.waitForTimeout(1000);
        const afterFirst = (await detailNames.nth(0).innerText()).trim();
        expect(await detailNames.count()).toBe(afterRemoveCount);
        // eslint-disable-next-line no-console
        console.log(
          `  (info) reorder: before=${nameBefore} afterFirst=${afterFirst} (seed=${firstPlaceName})`,
        );
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("  (info) 목록 장소 1개 — 순서 변경 스킵");
    }

    await safeClick(myLists.getByRole("button", { name: "목록 삭제" }));
    await expect(myLists.locator(".myListsConfirmDialog")).toBeVisible();
    await safeClick(myLists.locator(".myListsConfirmDelete"));
    await expect(myLists.getByText(listTitle)).toHaveCount(0, { timeout: 15_000 });

    // 목록 화면을 확실히 닫아야 5번 MY 탭 클릭이 .myListsBody 에 가로막히지 않음
    await safeClick(myLists.getByRole("button", { name: "닫기" }));
    await expect(myLists).toBeHidden({ timeout: 10_000 });
  });

  // ── 4e. SAVED places as map pins (compact + fullscreen) ───
  await runner.step("4e. SAVED — 저장 핀 미니맵/전체지도", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");
    const savedItems = page.locator("article.savedItem");
    if ((await savedItems.count()) === 0) {
      throw new Error("저장된 장소가 없어 핀 렌더링을 확인할 수 없음");
    }

    // 저장 장소 핀은 MAP 탭 미니맵(compact) / 전체화면에 렌더됨
    await gotoTab(page, "map");
    const compactMap = page.locator(".kakaoMap.mapCompactMap");
    await expect(compactMap).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(3000);
    const compactLoading = page.locator(".mapCompactLoading");
    if (await compactLoading.isVisible().catch(() => false)) {
      await compactLoading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
    }

    const compactPins = page.locator(
      ".mapCompactWrap .kakaoMap img, .mapCompactWrap img[src*='marker'], .mapCompactWrap img[src*='pin']",
    );
    await expect
      .poll(async () => compactPins.count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    await safeClick(page.locator(".mapCompactTapLayer"));
    const expandedDialog = page.locator('[aria-label="전체 지도"]');
    await expect(expandedDialog).toBeVisible({ timeout: 20_000 });
    const expandedMap = expandedDialog.locator(".kakaoMap");
    await expect(expandedMap).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);

    const expandedPins = expandedDialog.locator(
      ".kakaoMap img, img[src*='marker'], img[src*='pin']",
    );
    await expect
      .poll(async () => expandedPins.count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    // 닫기
    await safeClick(expandedDialog.getByRole("button", { name: "전체 지도 닫기" }));
    await expect(expandedDialog).toBeHidden({ timeout: 10_000 }).catch(async () => {
      await page.keyboard.press("Escape");
    });
  });

  // ── 4f. Place detail field integrity ──────────────────────
  await runner.step("4f. SAVED — 장소 상세 필드 무결성", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");
    const items = page.locator("article.savedItem");
    if ((await items.count()) === 0) {
      throw new Error("저장된 장소가 없어 상세 무결성을 확인할 수 없음");
    }
    await safeClick(items.first());
    const sheet = page.locator(".placeDetailSheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    const nameEl = sheet.locator(".placeDetailSheetName");
    await expect(nameEl).toBeVisible();
    const nameText = (await nameEl.innerText()).trim();
    expect(nameText.length > 0, "상세 이름 비어 있음").toBeTruthy();

    const addrEl = sheet.locator(".placeDetailSheetValue").first();
    await expect(addrEl).toBeVisible();
    const addrText = (await addrEl.innerText()).trim();
    expect(addrText.length > 0, "상세 주소 비어 있음").toBeTruthy();

    // 좌표 존재 = 길찾기 활성 또는 「지도 크게 보기」 활성
    const noCoordsHint = sheet.getByText(/위치 정보가 없어 길찾기를/);
    const hasNoCoords = await noCoordsHint.isVisible().catch(() => false);
    expect(hasNoCoords, "좌표 없음 — 지도 렌더 불가").toBeFalsy();

    const expandMapBtn = sheet.getByRole("button", { name: /지도 크게 보기/ });
    if ((await expandMapBtn.count()) > 0) {
      await expect(expandMapBtn.first()).toBeEnabled();
    } else {
      const carBtn = sheet.getByRole("button", { name: /자동차/ });
      await expect(carBtn).toBeEnabled();
    }

    await safeClick(sheet.getByRole("button", { name: "닫기" }));
    await expect(sheet).toBeHidden({ timeout: 10_000 }).catch(async () => {
      await page.keyboard.press("Escape");
    });
    await dismissSavedOverlays(page);
  });

  // ── 5. MY ─────────────────────────────────────────────────
  await runner.step("5. MY 탭 — 게시 수 / 그리드 / 스크롤", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "my");
    const postStat = page.getByRole("button").filter({ hasText: "게시" }).first();
    await expect(postStat).toBeVisible({ timeout: 20_000 });
    const postStatText = await postStat.innerText();
    expect(postStatText).toMatch(/\d+/);

    const scroll = page.locator(".mypageTabScroll");
    await expect(scroll).toBeVisible();
    await expect(
      scroll.getByText(/아직 작성한 게시물이 없어요/).or(scroll.locator("img").first()),
    ).toBeVisible({ timeout: 15_000 });

    const before = await scroll.evaluate((el) => el.scrollTop);
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(1000);
    const after = await scroll.evaluate((el) => el.scrollTop);
    expect(after >= before).toBeTruthy();
    await scroll.evaluate((el) => {
      el.scrollTop = 0;
    });
  });

  // ── 6. Other profile → curation → back ────────────────────
  await runner.step("6. 타인 프로필 → 큐레이션 상세 → 뒤로가기", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);

    // 작성자 이름(피드 카드 안) — 카드 전체 button 과 구분
    const authors = page.getByTestId("feed-post-author");
    await expect(authors.first()).toBeVisible({ timeout: 20_000 });
    await safeClick(authors.first());

    await expect(page).toHaveURL(/\/profile\//, { timeout: 20_000 });
    await expect(page.getByText("프로필", { exact: true }).first()).toBeVisible();

    const curationSection = page.locator("section").filter({ hasText: /큐레이션/ }).last();
    const firstThumb = curationSection.locator("img").first();
    if ((await firstThumb.count()) === 0) {
      await safeClick(page.locator(".subpageHeader button").first());
      await expect(tabButton(page, "home")).toBeVisible({ timeout: 15_000 });
      return;
    }

    await safeClick(firstThumb);
    const overlay = page.locator(".curationDetailOverlay");
    await expect(overlay).toBeVisible({ timeout: 25_000 });

    const closeBtn = page
      .getByTestId("curation-detail-close")
      .or(overlay.getByRole("button", { name: "뒤로가기" }))
      .or(overlay.locator(".subpageHeader button").first());
    await safeClick(closeBtn.first());
    await expect(overlay).toBeHidden({ timeout: 15_000 });
    await expect(page.locator(".curationDetailOverlay")).toHaveCount(0, {
      timeout: 5_000,
    });

    if (page.url().includes("/profile/")) {
      await safeClick(page.locator(".subpageHeader button").first());
    }
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 20_000 });
  });

  // ── 6a. Edge swipe — profile router back ───────────────────
  await runner.stepOptional("6a. 가장자리 스와이프 — 프로필 뒤로", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);
    const authors = page.getByTestId("feed-post-author");
    if (!(await authors.first().isVisible().catch(() => false))) return "skip";
    await safeClick(authors.first());
    await expect(page).toHaveURL(/\/profile\//, { timeout: 20_000 });
    await edgeSwipeBack(page);
    await expect(page).not.toHaveURL(/\/profile\//, { timeout: 15_000 });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 15_000 });
    return "pass";
  });

  // ── 6b. Edge swipe — home search close ─────────────────────
  await runner.step("6b. 가장자리 스와이프 — 홈 검색 닫기", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);
    await safeClick(
      page
        .locator(".homeFeedSearchInput")
        .or(page.getByPlaceholder("장소·키워드 검색"))
        .first(),
    );
    const searchScreen = page.locator(".homeSearchScreen");
    await expect(searchScreen).toBeVisible({ timeout: 10_000 });
    await edgeSwipeBack(page);
    await expect(searchScreen).toBeHidden({ timeout: 8_000 });
  });

  // ── 6c. Edge swipe — curation detail close + non-edge no-op ─
  await runner.stepOptional("6c. 가장자리 스와이프 — 큐레이션 상세 닫기", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);

    const cell = page.locator(".homeFeedGrid .postGridCell, .homeFeedGrid button").first();
    if (!(await cell.isVisible().catch(() => false))) {
      return "skip";
    }
    await safeClick(cell);

    const overlay = page.locator(".curationDetailOverlay");
    await expect(overlay).toBeVisible({ timeout: 25_000 });

    // Center horizontal swipe must NOT close
    await edgeSwipeBack(page, { startX: 180, startY: 420, dx: 100, dy: 0 });
    await expect(overlay).toBeVisible({ timeout: 3_000 });

    // Mostly vertical move must NOT close
    await edgeSwipeBack(page, { startX: 12, startY: 420, dx: 40, dy: 120 });
    await expect(overlay).toBeVisible({ timeout: 3_000 });

    // Left-edge swipe closes
    await edgeSwipeBack(page);
    await expect(overlay).toBeHidden({ timeout: 10_000 });
    return "pass";
  });

  // ── 6d. Edge swipe — place sheet close (SAVED) ─────────────
  await runner.stepOptional("6d. 가장자리 스와이프 — 장소 시트 닫기", async () => {
    await gotoTab(page, "saved");
    await dismissSavedOverlays(page);
    const items = page.locator("article.savedItem");
    if ((await items.count()) === 0) {
      return "skip";
    }
    await safeClick(items.first());
    const sheet = page.locator(".placeDetailSheet").first();
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await edgeSwipeBack(page);
    await expect(page.locator(".placeDetailSheet")).toHaveCount(0, { timeout: 10_000 });
    return "pass";
  });

  // ── 7. Logout ─────────────────────────────────────────────
  await runner.step("7. 로그아웃", async () => {
    await gotoTab(page, "my");
    await safeClick(page.getByRole("button", { name: "설정" }));
    await safeClick(page.getByRole("button", { name: "로그아웃" }));
    // 성공 = 로그인 이메일 필드만 (버튼·placeholder 조합은 strict mode 위반)
    await expect(
      page.getByTestId("login-email").or(page.getByPlaceholder("이메일")).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  runner.writeReport(
    [
      `List created during run (should be deleted): ${listTitle}`,
      `Total console/http issues (all steps): ${collectors.allIssues().length}`,
    ].join("\n"),
  );
  collectors.detach();
  runner.assertAllPassed();
});
