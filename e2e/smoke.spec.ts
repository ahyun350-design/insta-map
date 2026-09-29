import path from "node:path";
import { test, expect } from "@playwright/test";
import { loadEnvLocal, requireE2ECredentials } from "./helpers/env";
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
import {
  fetchE2EUsername,
  fetchPublicListsViaRpc,
} from "./helpers/supabaseRpc";

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
  const publicListTitle = `E2E Public ${Date.now()}`;
  let publicWebListId = "";
  let publicWebListTitle = "";
  let publicWebPlaceName = "";

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

    const nextBtn = page.locator("button.onboardingPrimary", { hasText: "다음" });
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

    // Leave onboarding so later steps see the app shell
    await safeClick(page.getByRole("button", { name: "시작하기" }));
    await page.waitForTimeout(500);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(tabBar(page)).toBeVisible({ timeout: 20_000 });
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

  await runner.step("4c2. 장소 시트 → 사진 뷰어 → 큐레이션", async () => {
    // Home feed → detail → place overlay → sheet (guarantees related curation images)
    const closeCurationDetail = async () => {
      const v = page.getByTestId("place-sheet-photo-viewer");
      if (await v.isVisible().catch(() => false)) {
        await safeClick(page.getByTestId("place-sheet-photo-viewer-close"));
        await expect(v).toHaveCount(0, { timeout: 5_000 }).catch(() => null);
      }
      await dismissSavedOverlays(page);
      const d = page.locator(".curationDetailOverlay");
      if (await d.isVisible().catch(() => false)) {
        await safeClick(
          page
            .getByTestId("curation-detail-close")
            .or(d.getByRole("button", { name: "뒤로가기" }))
            .or(d.locator(".subpageHeader button").first()),
        );
        await expect(d).toHaveCount(0, { timeout: 10_000 }).catch(() => null);
      }
    };

    await closeCurationDetail();
    await gotoTab(page, "home");
    await waitForHomeFeed(page);

    const cells = page.locator(".homeFeedGrid .postGridCell");
    await expect(cells.first()).toBeVisible({ timeout: 20_000 });
    const cellCount = await cells.count();
    let openedDetail = false;
    for (let i = 0; i < Math.min(cellCount, 10); i++) {
      await closeCurationDetail();
      await gotoTab(page, "home");
      await waitForHomeFeed(page);
      await safeClick(cells.nth(i));
      const detailTry = page.locator(".curationDetailOverlay");
      await expect(detailTry).toBeVisible({ timeout: 25_000 });
      const placeOverlay = detailTry.locator(".feedPostMediaOverlayPlace").first();
      if (!(await placeOverlay.isVisible().catch(() => false))) {
        await closeCurationDetail();
        continue;
      }
      await safeClick(placeOverlay);
      openedDetail = true;
      break;
    }
    if (!openedDetail) {
      throw new Error("장소 오버레이가 있는 홈 피드를 찾지 못함");
    }

    const detail = page.locator(".curationDetailOverlay");
    const sheet = page.locator(".placeDetailSheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    const img = sheet.getByTestId("place-detail-curation-image").first();
    await expect(img).toBeVisible({ timeout: 15_000 });

    // Guard: photo must not live inside a curation <button> (iOS activates it → detail, no viewer)
    const photoInsideCurationButton = await img.evaluate(
      (el) => !!el.closest("button.placeDetailSheetCurationItem, button.placeDetailSheetCurationBodyBtn"),
    );
    expect(photoInsideCurationButton).toBe(false);

    // Real-device path: tap photo → viewer opens, sheet stays (onCurationClick would unmount sheet)
    await safeClick(img);
    const viewer = page.getByTestId("place-sheet-photo-viewer");
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    // Must not jump to curation-only: sheet remains under viewer
    await page.waitForTimeout(400);
    await expect(viewer).toBeVisible();
    await expect(sheet).toBeVisible();

    // Edge swipe closes viewer only — sheet remains
    await edgeSwipeBack(page);
    await expect(viewer).toHaveCount(0, { timeout: 8_000 });
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // Re-open → swipe (if multi) → 큐레이션 보기 at that photoIndex
    await safeClick(sheet.getByTestId("place-detail-curation-image").first());
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    await expect(sheet).toBeVisible();

    let slideIndex = 0;
    const pageLabel = viewer.locator(".placeSheetPhotoViewerPage");
    if (await pageLabel.isVisible().catch(() => false)) {
      const track = viewer.locator(".placeSheetPhotoViewerTrack");
      const box = await track.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5, {
          steps: 12,
        });
        await page.mouse.up();
        await page.waitForTimeout(400);
      }
      const labelText = await pageLabel.innerText().catch(() => "1/1");
      const m = labelText.match(/^(\d+)\//);
      if (m) slideIndex = Math.max(0, Number(m[1]) - 1);
    }
    const expectedPhotoIndex = Number(
      (await viewer
        .locator(`.placeSheetPhotoViewerSlide[data-slide-index="${slideIndex}"]`)
        .getAttribute("data-photo-index")) ?? "0",
    );

    await safeClick(page.getByTestId("place-sheet-photo-viewer-curation"));
    await expect(detail).toBeVisible({ timeout: 25_000 });
    await expect(viewer).toHaveCount(0, { timeout: 5_000 });

    const detailPage = detail.locator(".feedPostMediaOverlayPage");
    if (await detailPage.isVisible().catch(() => false)) {
      await expect(detailPage).toHaveText(
        new RegExp(`^${expectedPhotoIndex + 1}/`),
        { timeout: 8_000 },
      );
    }

    await safeClick(
      page
        .getByTestId("curation-detail-close")
        .or(detail.getByRole("button", { name: "뒤로가기" }))
        .or(detail.locator(".subpageHeader button").first()),
    );
    await expect(detail).toHaveCount(0, { timeout: 10_000 });
    await dismissSavedOverlays(page);
  });

  await runner.step("4c3. 추출 완료 리뷰 — 1곳 / 2곳+", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");
    const savedItems = page.getByTestId("saved-place-item");
    await expect(savedItems.first()).toBeVisible({ timeout: 15_000 });
    const savedCount = await savedItems.count();
    if (savedCount < 2) {
      throw new Error("추출 리뷰 E2E에 저장 장소 2개 이상 필요");
    }

    const placeA = {
      id: (await savedItems.nth(0).getAttribute("data-place-id"))!,
      name: ((await savedItems.nth(0).locator(".savedName").innerText()) || "A").trim(),
      address: "e2e-addr-a",
      category: "맛집",
      subcategory: null as string | null,
    };
    const placeB = {
      id: (await savedItems.nth(1).getAttribute("data-place-id"))!,
      name: ((await savedItems.nth(1).locator(".savedName").innerText()) || "B").trim(),
      address: "e2e-addr-b",
      category: "카페",
      subcategory: null as string | null,
    };

    // —— 1곳: 자동 닫힘 + 「목록에 담기」
    await page.evaluate(
      ({ key, payload }) => {
        localStorage.setItem(key, JSON.stringify(payload));
      },
      {
        key: "pindmap_extract_review_pending",
        payload: {
          jobId: `e2e-single-${Date.now()}`,
          places: [placeA],
          at: Date.now(),
          allowSingle: true,
        },
      },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 45_000 });
    const single = page.getByTestId("extract-review-single");
    await expect(single).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("extract-review-add-to-list")).toBeVisible();
    await expect(page.getByTestId("extract-loading-overlay")).toHaveCount(0, {
      timeout: 5_000,
    });

    // —— 2곳+: × 닫기 → 전부 유지
    await page.evaluate(
      ({ key, payload }) => {
        localStorage.setItem(key, JSON.stringify(payload));
      },
      {
        key: "pindmap_extract_review_pending",
        payload: {
          jobId: `e2e-multi-x-${Date.now()}`,
          places: [placeA, placeB],
          at: Date.now(),
        },
      },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 45_000 });
    const multi = page.getByTestId("extract-review-multi");
    await expect(multi).toBeVisible({ timeout: 20_000 });
    await safeClick(page.getByTestId("extract-overlay-close"));
    await expect(page.getByTestId("extract-loading-overlay")).toHaveCount(0, {
      timeout: 8_000,
    });
    await gotoTab(page, "saved");
    await expect(page.locator(`[data-place-id="${placeA.id}"]`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-place-id="${placeB.id}"]`)).toBeVisible({
      timeout: 10_000,
    });

    // —— 2곳+: 1개 체크 해제 → 완료 → 해당 장소 저장 탭에서 사라짐 (API mock)
    await page.evaluate(
      ({ key, payload }) => {
        localStorage.setItem(key, JSON.stringify(payload));
      },
      {
        key: "pindmap_extract_review_pending",
        payload: {
          jobId: `e2e-multi-del-${Date.now()}`,
          places: [placeA, placeB],
          at: Date.now(),
        },
      },
    );
    await page.route("**/api/places/bulk-delete", async (route) => {
      const body = route.request().postDataJSON() as { ids?: string[] };
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deleted: ids.length, deletedIds: ids }),
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("extract-review-multi")).toBeVisible({ timeout: 20_000 });
    // Let home bootstrap places fetch settle so it cannot overwrite the optimistic delete
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("extract-review-multi")).toBeVisible();
    const checkB = page.locator(
      `input[data-testid="extract-review-check"][data-place-id="${placeB.id}"]`,
    );
    await expect(checkB).toBeVisible();
    await checkB.uncheck();
    await expect(page.getByTestId("extract-review-hint")).toContainText("1곳");
    const deleteWait = page.waitForRequest(
      (req) =>
        req.url().includes("/api/places/bulk-delete") && req.method() === "POST",
      { timeout: 15_000 },
    );
    await safeClick(page.getByTestId("extract-review-confirm"));
    const delReq = await deleteWait;
    const delBody = delReq.postDataJSON() as { ids?: string[] };
    expect(delBody.ids ?? []).toContain(placeB.id);
    await expect(page.getByTestId("extract-loading-overlay")).toHaveCount(0, {
      timeout: 10_000,
    });
    await gotoTab(page, "saved");
    await expect(page.locator(`[data-place-id="${placeA.id}"]`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-place-id="${placeB.id}"]`)).toHaveCount(0, {
      timeout: 10_000,
    });
    await page.unroute("**/api/places/bulk-delete").catch(() => null);
    // Client-only removal (API mocked) — reload restores B from server
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 45_000 });
    await gotoTab(page, "saved");
    await dismissSavedOverlays(page);
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

  // ── 4d2. Public place lists (toggle + RPC + read-only detail) ──
  await runner.step("4d2. SAVED — 목록 공개/비공개 · 공개 상세", async () => {
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");

    const items = page.locator("article.savedItem");
    await expect(items.first()).toBeVisible({ timeout: 20_000 });
    await safeClick(items.first());
    const sheet = page.locator(".placeDetailSheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await safeClick(sheet.getByRole("button", { name: "목록에 추가" }));
    const addSheet = page.locator(".placeListSheet");
    await expect(addSheet).toBeVisible();
    await safeClick(addSheet.getByRole("button", { name: /새 목록 만들기/ }));
    await addSheet.locator(".placeListSheetCreateInput").fill(publicListTitle);
    await safeClick(addSheet.getByRole("button", { name: "만들기" }));
    await expect(addSheet.getByText(publicListTitle)).toBeVisible({ timeout: 15_000 });
    await safeClick(addSheet.getByRole("button", { name: "닫기" }));
    await safeClick(sheet.getByRole("button", { name: "닫기" })).catch(() => null);
    await dismissSavedOverlays(page);
    await gotoTab(page, "saved");

    await safeClick(savedMyListsButton(page));
    const myLists = page.locator(".myListsScreen");
    await expect(myLists).toBeVisible({ timeout: 15_000 });
    await safeClick(myLists.locator(".myListsListItem", { hasText: publicListTitle }));
    await expect(myLists.getByTestId("list-public-toggle")).toBeVisible({ timeout: 10_000 });
    const listId = await myLists.getByTestId("list-public-row").getAttribute("data-list-id");
    if (!listId) throw new Error("list-public-row missing data-list-id");

    const detailName = myLists.locator(".myListsDetailItem .savedName").first();
    await expect(detailName).toBeVisible({ timeout: 20_000 });
    const placeName = (await detailName.textContent())?.trim() ?? "";

    // Enable public — confirm dialog required
    await safeClick(myLists.getByTestId("list-public-toggle"));
    await expect(myLists.getByTestId("list-public-confirm")).toBeVisible({ timeout: 5_000 });
    await expect(myLists.getByText("누구나 이 목록을 볼 수 있어요")).toBeVisible();
    await safeClick(myLists.getByTestId("list-public-confirm-ok"));
    await expect(myLists.getByTestId("list-public-row")).toHaveAttribute(
      "data-is-public",
      "true",
      { timeout: 10_000 },
    );
    await expect(myLists.getByTestId("list-share-btn")).toBeVisible({ timeout: 5_000 });

    const { userId, username } = await fetchE2EUsername();
    // RPC = what any authenticated viewer sees for this owner
    const publicWhenOn = await fetchPublicListsViaRpc(userId);
    expect(publicWhenOn.some((l) => l.id === listId && l.title === publicListTitle)).toBeTruthy();

    // Own profile hides the section; deep-link opens read-only detail
    await safeClick(myLists.getByRole("button", { name: "←" }).first()).catch(() => null);
    await safeClick(myLists.getByRole("button", { name: "닫기" })).catch(() => null);
    await expect(myLists).toBeHidden({ timeout: 10_000 }).catch(() => null);

    await page.goto(
      `/profile/${encodeURIComponent(username)}?publicList=${encodeURIComponent(listId)}`,
      { waitUntil: "domcontentloaded" },
    );
    const publicScreen = page.getByTestId("public-place-list-screen");
    await expect(publicScreen).toBeVisible({ timeout: 20_000 });
    await expect(publicScreen.getByRole("button", { name: "목록 삭제" })).toHaveCount(0);
    await expect(publicScreen.getByRole("button", { name: "삭제" })).toHaveCount(0);
    await expect(publicScreen.locator(".myListsHeaderDanger")).toHaveCount(0);
    await expect(publicScreen.locator(".myListsDragHandle")).toHaveCount(0);
    await expect(publicScreen.getByTestId("list-item-menu")).toHaveCount(0);
    await expect(publicScreen.getByText("메모")).toHaveCount(0);
    await expect(publicScreen.getByTestId("public-place-list-share")).toBeVisible({
      timeout: 5_000,
    });

    await safeClick(publicScreen.getByTestId("public-place-list-back"));
    await expect(publicScreen).toHaveCount(0, { timeout: 10_000 });

    // Back to my lists — turn private (no confirm), then public again for web share e2e
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(tabBar(page)).toBeVisible({ timeout: 20_000 });
    await gotoTab(page, "saved");
    await safeClick(savedMyListsButton(page));
    await expect(myLists).toBeVisible({ timeout: 15_000 });
    await safeClick(myLists.locator(".myListsListItem", { hasText: publicListTitle }));
    await expect(myLists.getByTestId("list-public-row")).toHaveAttribute(
      "data-is-public",
      "true",
      { timeout: 10_000 },
    );
    await safeClick(myLists.getByTestId("list-public-toggle"));
    await expect(myLists.getByTestId("list-public-confirm")).toHaveCount(0);
    await expect(myLists.getByTestId("list-public-row")).toHaveAttribute(
      "data-is-public",
      "false",
      { timeout: 10_000 },
    );

    const publicWhenOff = await fetchPublicListsViaRpc(userId);
    expect(publicWhenOff.some((l) => l.id === listId)).toBeFalsy();

    // Re-enable public for 4d3 web page (keep list until cleanup there)
    await safeClick(myLists.getByTestId("list-public-toggle"));
    await expect(myLists.getByTestId("list-public-confirm")).toBeVisible({ timeout: 5_000 });
    await safeClick(myLists.getByTestId("list-public-confirm-ok"));
    await expect(myLists.getByTestId("list-public-row")).toHaveAttribute(
      "data-is-public",
      "true",
      { timeout: 10_000 },
    );

    publicWebListId = listId;
    publicWebListTitle = publicListTitle;
    publicWebPlaceName = placeName;

    await safeClick(myLists.getByRole("button", { name: "←" }).first()).catch(() => null);
    await safeClick(myLists.getByRole("button", { name: "닫기" })).catch(() => null);
    await expect(myLists).toBeHidden({ timeout: 10_000 }).catch(() => null);
  });

  // ── 4d3. Public list web share page (anon) ──
  await runner.step("4d3. 공개 목록 웹 페이지 — 비로그인/비공개/메모 없음", async () => {
    if (!publicWebListId) {
      throw new Error("4d2 에서 공개 목록 id 를 남기지 못함");
    }

    const browser = page.context().browser();
    if (!browser) throw new Error("browser missing");
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    try {
      await anonPage.goto(`/list/${encodeURIComponent(publicWebListId)}`, {
        waitUntil: "domcontentloaded",
      });
      const sharePage = anonPage.getByTestId("public-list-share-page");
      await expect(sharePage).toBeVisible({ timeout: 20_000 });
      await expect(anonPage.getByTestId("public-list-share-title")).toHaveText(
        publicWebListTitle,
        { timeout: 10_000 },
      );
      if (publicWebPlaceName) {
        await expect(
          anonPage.getByTestId("public-list-share-place-name").filter({
            hasText: publicWebPlaceName,
          }),
        ).toBeVisible({ timeout: 10_000 });
      } else {
        await expect(anonPage.getByTestId("public-list-share-items")).toBeVisible({
          timeout: 10_000,
        });
      }
      await expect(anonPage.getByText("메모")).toHaveCount(0);
      const bodyText = (await anonPage.locator("body").innerText()).toLowerCase();
      expect(bodyText.includes("memo")).toBeFalsy();

      // Missing / private-equivalent UUID → not found copy
      await anonPage.goto(`/list/00000000-0000-4000-8000-000000000099`, {
        waitUntil: "domcontentloaded",
      });
      await expect(anonPage.getByTestId("public-list-not-found")).toBeVisible({
        timeout: 15_000,
      });
      await expect(anonPage.getByText("찾을 수 없는 목록")).toBeVisible();
    } finally {
      await anon.close();
    }

    // Turn private → same id also not found for anon
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(tabBar(page)).toBeVisible({ timeout: 20_000 });
    await gotoTab(page, "saved");
    await safeClick(savedMyListsButton(page));
    const myLists = page.locator(".myListsScreen");
    await expect(myLists).toBeVisible({ timeout: 15_000 });
    await safeClick(myLists.locator(".myListsListItem", { hasText: publicWebListTitle }));
    await expect(myLists.getByTestId("list-public-row")).toHaveAttribute(
      "data-is-public",
      "true",
      { timeout: 10_000 },
    );
    await safeClick(myLists.getByTestId("list-public-toggle"));
    await expect(myLists.getByTestId("list-public-row")).toHaveAttribute(
      "data-is-public",
      "false",
      { timeout: 10_000 },
    );

    const anon2 = await browser.newContext();
    const anonPage2 = await anon2.newPage();
    try {
      await anonPage2.goto(`/list/${encodeURIComponent(publicWebListId)}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(anonPage2.getByTestId("public-list-not-found")).toBeVisible({
        timeout: 15_000,
      });
      await expect(anonPage2.getByText("찾을 수 없는 목록")).toBeVisible();
      await expect(anonPage2.getByText("메모")).toHaveCount(0);
    } finally {
      await anon2.close();
    }

    // Cleanup
    await safeClick(myLists.getByRole("button", { name: "목록 삭제" }));
    await expect(myLists.locator(".myListsConfirmDialog")).toBeVisible();
    await safeClick(myLists.locator(".myListsConfirmDelete"));
    await expect(myLists.getByText(publicWebListTitle)).toHaveCount(0, { timeout: 15_000 });
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

  // ── 6b2. Home search → detail above search → back keeps query ─
  await runner.step("6b2. 홈 검색 → 상세 위 → 검색 유지", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);

    // Keyword from a visible home cell title/place line
    const homeCell = page
      .locator(".homeFeedGrid .postGridCell")
      .filter({ has: page.locator(".postGridCellHomeTitle") })
      .first();
    await expect(homeCell).toBeVisible({ timeout: 20_000 });
    const keywordRaw = (
      (await homeCell.locator(".postGridCellHomeTitle").first().textContent()) ||
      ""
    ).trim();
    // Prefer a short token that will match search (avoid trailing spaces)
    const keyword =
      keywordRaw.split(/\s+/).find((t) => t.length >= 2)?.slice(0, 12) ||
      keywordRaw.replace(/\s+/g, "").slice(0, 8);
    if (keyword.length < 1) {
      throw new Error("home feed cell has no searchable text");
    }

    // Open via the readonly home bar input (not the overlay input)
    await safeClick(page.locator(".homeFeedToolbar .homeFeedSearchInput").first());
    const searchScreen = page.locator(".homeSearchScreen");
    await expect(searchScreen).toBeVisible({ timeout: 10_000 });

    // Must stay scoped to overlay — page-level placeholder also matches readonly bar
    const searchInput = searchScreen.locator("input.homeFeedSearchInput");
    await expect(searchInput).toBeEditable({ timeout: 5_000 });
    await searchInput.fill(keyword);
    await page.waitForTimeout(700);

    const resultCell = searchScreen.locator(".homeSearchFeedGrid .postGridCell").first();
    await expect(resultCell).toBeVisible({ timeout: 20_000 });
    await safeClick(resultCell);

    const overlay = page.locator(".curationDetailOverlay");
    await expect(overlay).toBeVisible({ timeout: 25_000 });
    // Detail must paint above search (search stays mounted)
    await expect(searchScreen).toBeAttached();

    const closeBtn = page
      .getByTestId("curation-detail-close")
      .or(overlay.getByRole("button", { name: "뒤로가기" }))
      .or(overlay.locator(".subpageHeader button").first());
    await safeClick(closeBtn.first());
    await expect(overlay).toHaveCount(0, { timeout: 10_000 });

    await expect(searchScreen).toBeVisible({ timeout: 8_000 });
    await expect(searchInput).toHaveValue(keyword);

    // Swipe closes search (detail already closed)
    await edgeSwipeBack(page);
    await expect(searchScreen).toBeHidden({ timeout: 8_000 });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 10_000 });
  });

  // ── 6b3. Search + detail: swipe closes detail first, then search ─
  await runner.stepOptional("6b3. 홈 검색+상세 스와이프 순서", async () => {
    // Ensure leftover search overlay is gone
    const leftover = page.locator(".homeSearchScreen");
    if (await leftover.isVisible().catch(() => false)) {
      await safeClick(leftover.getByRole("button", { name: "취소" }));
      await expect(leftover).toBeHidden({ timeout: 8_000 });
    }

    await gotoTab(page, "home");
    await waitForHomeFeed(page);
    const homeCell = page
      .locator(".homeFeedGrid .postGridCell")
      .filter({ has: page.locator(".postGridCellHomeTitle") })
      .first();
    if (!(await homeCell.isVisible().catch(() => false))) return "skip";
    const keywordRaw = (
      (await homeCell.locator(".postGridCellHomeTitle").first().textContent()) ||
      ""
    ).trim();
    const keyword =
      keywordRaw.split(/\s+/).find((t) => t.length >= 2)?.slice(0, 12) ||
      keywordRaw.replace(/\s+/g, "").slice(0, 8);
    if (keyword.length < 1) return "skip";

    await safeClick(page.locator(".homeFeedToolbar .homeFeedSearchInput").first());
    const searchScreen = page.locator(".homeSearchScreen");
    await expect(searchScreen).toBeVisible({ timeout: 10_000 });
    const searchInput = searchScreen.locator("input.homeFeedSearchInput");
    await expect(searchInput).toBeEditable({ timeout: 5_000 });
    await searchInput.fill(keyword);
    await page.waitForTimeout(700);
    const resultCell = searchScreen.locator(".homeSearchFeedGrid .postGridCell").first();
    if (!(await resultCell.isVisible().catch(() => false))) return "skip";
    await safeClick(resultCell);

    const overlay = page.locator(".curationDetailOverlay");
    await expect(overlay).toBeVisible({ timeout: 25_000 });

    await edgeSwipeBack(page);
    await expect(overlay).toHaveCount(0, { timeout: 10_000 });
    await expect(searchScreen).toBeVisible({ timeout: 5_000 });
    await expect(searchInput).toHaveValue(keyword);

    await edgeSwipeBack(page);
    await expect(searchScreen).toBeHidden({ timeout: 8_000 });
    return "pass";
  });

  // ── 6c. Edge swipe — curation detail close + non-edge no-op ─
  await runner.stepOptional("6c. 가장자리 스와이프 — 큐레이션 상세 닫기", async () => {
    const leftoverSearch = page.locator(".homeSearchScreen");
    if (await leftoverSearch.isVisible().catch(() => false)) {
      await safeClick(leftoverSearch.getByRole("button", { name: "취소" }));
      await expect(leftoverSearch).toBeHidden({ timeout: 8_000 });
    }

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

  // ── 7b. Signup validation UX (after logout) ───────────────
  await runner.step("7b. 회원가입 — 기존 이메일·형식·짧은 비번", async () => {
    loadEnvLocal();
    const { email: existingEmail } = requireE2ECredentials();

    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "회원가입" })).toBeVisible({
      timeout: 15_000,
    });

    const username = page.getByTestId("signup-username");
    const emailInput = page.getByTestId("signup-email");
    const passwordInput = page.getByTestId("signup-password");
    const submit = page.getByTestId("signup-submit");

    // Agree required consents
    await page.locator('label:has-text("만 14세") input[type="checkbox"]').check();
    await page.locator("#signup-agree-terms").check();
    await page.locator("#signup-agree-privacy").check();

    // Short password (client check runs before username API; noValidate form)
    await username.fill(`e2e${Date.now().toString(36).slice(-6)}`);
    await username.blur();
    await emailInput.fill("valid-format@example.com");
    await passwordInput.fill("123");
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await safeClick(submit);
    await expect(page.getByTestId("signup-error")).toContainText("비밀번호는 6자 이상", {
      timeout: 5_000,
    });
    await expect(page.getByRole("heading", { name: "이메일을 확인해주세요" })).toHaveCount(0);

    // Invalid email format
    await passwordInput.fill("123456");
    await emailInput.fill("not-an-email");
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await safeClick(submit);
    await expect(page.getByTestId("signup-error")).toContainText("이메일 주소를 다시 확인해 주세요", {
      timeout: 5_000,
    });
    await expect(page.getByRole("heading", { name: "이메일을 확인해주세요" })).toHaveCount(0);

    // Existing confirmed email (E2E account)
    await emailInput.fill(existingEmail);
    await passwordInput.fill("wrong-but-long-enough");
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await safeClick(submit);
    await expect(page.getByTestId("signup-error")).toContainText("이미 가입된 이메일", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("signup-existing-email-actions")).toBeVisible();
    await expect(page.getByTestId("signup-go-login")).toBeVisible();
    await expect(page.getByTestId("signup-go-forgot")).toBeVisible();
    await expect(page.getByRole("heading", { name: "이메일을 확인해주세요" })).toHaveCount(0);
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
