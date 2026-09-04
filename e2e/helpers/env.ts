import fs from "node:fs";
import path from "node:path";

/** Load key=value pairs from `.env.local` into `process.env` (does not override existing). */
export function loadEnvLocal(cwd = process.cwd()): void {
  const filePath = path.resolve(cwd, ".env.local");
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function requireE2ECredentials(): { email: string; password: string } {
  const email = process.env.E2E_EMAIL?.trim() ?? "";
  const password = process.env.E2E_PASSWORD?.trim() ?? "";
  if (!email || !password) {
    throw new Error(
      "E2E_EMAIL / E2E_PASSWORD 가 없습니다. .env.local 에 테스트 계정 값을 넣어주세요.",
    );
  }
  return { email, password };
}
