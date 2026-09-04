import type { Page, ConsoleMessage, Response } from "@playwright/test";

export type CollectedIssue = {
  kind: "console" | "http";
  message: string;
  at: string;
};

export type StepIssues = {
  consoleErrors: string[];
  httpErrors: string[];
};

/** Attach listeners that accumulate console errors and 4xx/5xx responses. */
export function attachCollectors(page: Page) {
  const all: CollectedIssue[] = [];
  let stepBucket: CollectedIssue[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const entry: CollectedIssue = {
      kind: "console",
      message: msg.text(),
      at: new Date().toISOString(),
    };
    all.push(entry);
    stepBucket.push(entry);
  };

  const onResponse = (res: Response) => {
    const status = res.status();
    if (status < 400) return;
    // Ignore noisy favicon / analytics misses
    const url = res.url();
    if (url.includes("favicon") || url.includes("google-analytics")) return;
    const entry: CollectedIssue = {
      kind: "http",
      message: `${status} ${res.request().method()} ${url}`,
      at: new Date().toISOString(),
    };
    all.push(entry);
    stepBucket.push(entry);
  };

  page.on("console", onConsole);
  page.on("response", onResponse);

  return {
    beginStep() {
      stepBucket = [];
    },
    endStep(): StepIssues {
      const consoleErrors = stepBucket
        .filter((i) => i.kind === "console")
        .map((i) => i.message);
      const httpErrors = stepBucket
        .filter((i) => i.kind === "http")
        .map((i) => i.message);
      return { consoleErrors, httpErrors };
    },
    allIssues() {
      return [...all];
    },
    detach() {
      page.off("console", onConsole);
      page.off("response", onResponse);
    },
  };
}
