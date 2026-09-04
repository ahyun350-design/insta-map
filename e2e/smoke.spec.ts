import path from "node:path";
import { test, expect } from "@playwright/test";
import { requireE2ECredentials } from "./helpers/env";
import { attachCollectors } from "./helpers/collectors";
import { createSoftRunner } from "./helpers/softRunner";
import {
  assertHomeFeedContent,
  dismissCoachmarks,
  gotoTab,
  loginEmailInput,
  loginPasswordInput,
  loginSubmitButton,
  reachLoginForm,
  safeClick,
  suppressCoachmarks,
  tabBar,
  tabButton,
  waitForHomeFeed,
} from "./helpers/nav";

const ARTIFACTS = path.resolve(process.cwd(), "e2e/artifacts");
const SCREENSHOTS = path.join(ARTIFACTS, "screenshots");
const REPORT = path.join(ARTIFACTS, "report.md");

test.describe.configure({ mode: "serial" });

test("production smoke — major tabs (continue on failure)", async ({
  page,
  context,
}) => {
  const { email, password } = requireE2ECredentials();
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
    },
  });

  const listTitle = `E2E ${Date.now()}`;

  // ── 1. Login ──────────────────────────────────────────────
  await runner.step("1. 로그인", async () => {
    await reachLoginForm(page);

    if (!(await tabButton(page, "home").isVisible().catch(() => false))) {
      await loginEmailInput(page).fill(email);
      await loginPasswordInput(page).fill(password);
      await safeClick(loginSubmitButton(page));
    }

    // Login success = bottom tab bar visible (don't require .homeFeedGrid yet)
    await expect(tabBar(page)).toBeVisible({ timeout: 45_000 });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 15_000 });
    await dismissCoachmarks(page);
  });

  // ── 2. HOME feed ──────────────────────────────────────────
  await runner.step("2. HOME 피드 — 큐레이션 로딩", async () => {
    await gotoTab(page, "home");
    await waitForHomeFeed(page);
    await assertHomeFeedContent(page);
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
    await gotoTab(page, "saved");
    await expect(page.locator(".savedSortTrigger")).toBeVisible({ timeout: 20_000 });
    const items = page.locator(".savedItem");
    const empty = page.getByText(/저장한 장소가 없어요|아직 저장/);
    const hasItems = (await items.count()) > 0;
    const isEmpty = await empty.first().isVisible().catch(() => false);
    expect(
      hasItems || isEmpty || (await page.locator(".savedSortRow").isVisible()),
      "SAVED 탭 렌더",
    ).toBeTruthy();
  });

  await runner.step("4b. SAVED — 정렬 드롭다운 3옵션", async () => {
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
    await gotoTab(page, "saved");
    const items = page.locator(".savedItem");
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
  });

  await runner.step("4d. SAVED — 내 목록 생성·담기·순서·삭제", async () => {
    await gotoTab(page, "saved");
    const items = page.locator(".savedItem");
    const itemCount = await items.count();
    if (itemCount === 0) {
      throw new Error("저장된 장소가 없어 내 목록 E2E를 진행할 수 없음");
    }

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

    if (itemCount >= 2) {
      await safeClick(items.nth(1));
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
    }

    await safeClick(page.locator(".savedMyListsPill"));
    const myLists = page.locator(".myListsScreen");
    await expect(myLists).toBeVisible({ timeout: 15_000 });
    await safeClick(myLists.locator(".myListsListItem", { hasText: listTitle }));
    await expect(myLists.locator(".myListsDetailItem").first()).toBeVisible({
      timeout: 15_000,
    });

    const detailNames = myLists.locator(".myListsDetailName");
    const beforeCount = await detailNames.count();
    expect(beforeCount).toBeGreaterThan(0);

    const handles = myLists.locator(".myListsDragHandle");
    if ((await handles.count()) >= 2) {
      const firstName = (await detailNames.nth(0).innerText()).trim();
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
        expect(await detailNames.count()).toBe(beforeCount);
        // eslint-disable-next-line no-console
        console.log(`  (info) reorder: before=${firstName} afterFirst=${afterFirst}`);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("  (info) 장소 1개 — 순서 변경 스킵, 목록 표시만 확인");
    }

    await safeClick(myLists.getByRole("button", { name: "목록 삭제" }));
    await expect(myLists.locator(".myListsConfirmDialog")).toBeVisible();
    await safeClick(myLists.locator(".myListsConfirmDelete"));
    await expect(myLists.getByText(listTitle)).toHaveCount(0, { timeout: 15_000 });

    await safeClick(myLists.getByRole("button", { name: "닫기" }));
  });

  // ── 5. MY ─────────────────────────────────────────────────
  await runner.step("5. MY 탭 — 게시 수 / 그리드 / 스크롤", async () => {
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

    const usernameBtns = page.locator(".homeFeedGrid button").filter({
      hasNotText: /좋아요|저장/,
    });
    const count = await usernameBtns.count();
    if (count === 0) {
      throw new Error("HOME 피드에서 프로필 진입용 username 버튼을 찾지 못함");
    }

    let clicked = false;
    for (let i = 0; i < Math.min(count, 12); i++) {
      const btn = usernameBtns.nth(i);
      const text = (await btn.innerText()).trim();
      if (!text || text.length > 40) continue;
      await safeClick(btn);
      clicked = true;
      break;
    }
    expect(clicked).toBeTruthy();

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
    await expect(page.locator(".curationDetailOverlay")).toBeVisible({ timeout: 25_000 });
    await safeClick(page.locator(".curationDetailOverlay .subpageHeader button").first());
    await expect(page.locator(".curationDetailOverlay")).toHaveCount(0, {
      timeout: 15_000,
    });

    if (page.url().includes("/profile/")) {
      await safeClick(page.locator(".subpageHeader button").first());
    }
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 20_000 });
  });

  // ── 7. Logout ─────────────────────────────────────────────
  await runner.step("7. 로그아웃", async () => {
    await gotoTab(page, "my");
    await safeClick(page.getByRole("button", { name: "설정" }));
    await safeClick(page.getByRole("button", { name: "로그아웃" }));
    // confirm dialog auto-accepted — may land on /login or /onboarding
    await expect(
      loginEmailInput(page)
        .or(page.locator(".onboardingRoot, .onboardingRootFinal"))
        .or(page.getByRole("button", { name: "로그인", exact: true })),
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
