import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { StepIssues } from "./collectors";

export type StepResult = {
  name: string;
  ok: boolean;
  error?: string;
  screenshot?: string;
  consoleErrors: string[];
  httpErrors: string[];
};

export type SoftRunner = {
  step: (name: string, fn: () => Promise<void>) => Promise<void>;
  results: () => StepResult[];
  writeReport: (extra?: string) => string;
  assertAllPassed: () => void;
};

function slug(name: string): string {
  return name
    .replace(/[^\w가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function createSoftRunner(
  page: Page,
  opts: {
    screenshotDir: string;
    reportPath: string;
    beginStep: () => void;
    endStep: () => StepIssues;
    /** Runs before each step body (e.g. dismiss coachmarks). Errors are ignored. */
    beforeEachStep?: () => Promise<void>;
  },
): SoftRunner {
  const results: StepResult[] = [];
  fs.mkdirSync(opts.screenshotDir, { recursive: true });
  fs.mkdirSync(path.dirname(opts.reportPath), { recursive: true });

  return {
    async step(name, fn) {
      const index = results.length + 1;
      const fileName = `${String(index).padStart(2, "0")}-${slug(name)}.png`;
      const shotPath = path.join(opts.screenshotDir, fileName);
      opts.beginStep();

      if (opts.beforeEachStep) {
        try {
          await opts.beforeEachStep();
        } catch {
          /* non-fatal */
        }
      }

      try {
        await fn();
        await page.screenshot({ path: shotPath, fullPage: false });
        const issues = opts.endStep();
        results.push({
          name,
          ok: true,
          screenshot: shotPath,
          ...issues,
        });
        // eslint-disable-next-line no-console
        console.log(`  ✓ ${name}`);
      } catch (err) {
        let screenshot: string | undefined;
        try {
          await page.screenshot({ path: shotPath, fullPage: false });
          screenshot = shotPath;
        } catch {
          /* ignore screenshot failure */
        }
        const issues = opts.endStep();
        const error = err instanceof Error ? err.message : String(err);
        results.push({
          name,
          ok: false,
          error,
          screenshot,
          ...issues,
        });
        // eslint-disable-next-line no-console
        console.log(`  ✗ ${name}: ${error}`);
      }
    },

    results: () => results,

    writeReport(extra = "") {
      const passed = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;
      const lines: string[] = [
        `# PindMap E2E Report`,
        ``,
        `Generated: ${new Date().toISOString()}`,
        `Base URL: https://pindmap.com`,
        ``,
        `## Summary`,
        `- Passed: ${passed}`,
        `- Failed: ${failed}`,
        `- Total: ${results.length}`,
        ``,
        `## Steps`,
      ];

      for (const r of results) {
        lines.push(`### ${r.ok ? "PASS" : "FAIL"} — ${r.name}`);
        if (r.error) lines.push(`- Error: ${r.error}`);
        if (r.screenshot) lines.push(`- Screenshot: \`${r.screenshot}\``);
        if (r.consoleErrors.length) {
          lines.push(`- Console errors:`);
          for (const c of r.consoleErrors) lines.push(`  - ${c}`);
        } else {
          lines.push(`- Console errors: (none)`);
        }
        if (r.httpErrors.length) {
          lines.push(`- HTTP 4xx/5xx:`);
          for (const h of r.httpErrors) lines.push(`  - ${h}`);
        } else {
          lines.push(`- HTTP 4xx/5xx: (none)`);
        }
        lines.push(``);
      }

      if (extra) {
        lines.push(`## Notes`, extra, ``);
      }

      const body = lines.join("\n");
      fs.writeFileSync(opts.reportPath, body, "utf8");

      // eslint-disable-next-line no-console
      console.log("\n========== E2E SUMMARY ==========");
      for (const r of results) {
        // eslint-disable-next-line no-console
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.error ? ` — ${r.error}` : ""}`);
      }
      // eslint-disable-next-line no-console
      console.log(`---------------------------------`);
      // eslint-disable-next-line no-console
      console.log(`${passed} passed, ${failed} failed (of ${results.length})`);
      // eslint-disable-next-line no-console
      console.log(`Report: ${opts.reportPath}`);
      // eslint-disable-next-line no-console
      console.log("=================================\n");

      return opts.reportPath;
    },

    assertAllPassed() {
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        throw new Error(
          `${failed.length} step(s) failed: ${failed.map((f) => f.name).join(", ")}`,
        );
      }
    },
  };
}
