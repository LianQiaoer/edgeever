// Idempotent no-R2 transform for this deployment fork.
// sync-edgeever-upstream.yml runs this after every upstream snapshot so the
// Cloudflare deploy never requires an R2 bucket (this account has none).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const NL = String.fromCharCode(10);
const repo = process.cwd();

function patch(relPath, label, isApplied, transform) {
  const file = resolve(repo, relPath);
  const source = readFileSync(file, "utf8");
  if (isApplied(source)) {
    console.log("[no-r2] skip " + label);
    return;
  }
  const next = transform(source);
  if (next === source) {
    throw new Error("[no-r2] anchor missing for " + label);
  }
  writeFileSync(file, next);
  console.log("[no-r2] applied " + label);
}

// 1) scripts/run-wrangler.mjs: strip the [[r2_buckets]] block before deploy.
patch(
  "scripts/run-wrangler.mjs",
  "run-wrangler r2 strip",
  (s) => s.includes('const r2Section = config.indexOf("[[r2_buckets]]")'),
  (s) => {
    const anchor = "const configPath = changed ? generatedConfigPath : baseConfigPath;";
    if (!s.includes(anchor)) throw new Error("[no-r2] run-wrangler configPath anchor missing");
    let out = s.replace(anchor, "const configPath = generatedConfigPath;");

    const anchor2 = [
      "writeFileSync(generatedConfigPath, config);",
      "}",
      "",
      "const captureDeploymentTargets = isDeployCommand && shouldCaptureDeploymentTargets();",
    ].join(NL);
    const strip = [
      "writeFileSync(generatedConfigPath, config);",
      "}",
      "",
      "// Self-hosted deployments without an R2 bucket must not publish an R2 binding.",
      "// Strip the [[r2_buckets]] block before Wrangler reads the generated config so",
      "// deploy never references a bucket that does not exist in the account",
      "// (Cloudflare error 10042). D1-backed notes keep working; R2-backed attachments",
      "// fall back to the storage adapter's unavailable store.",
      'const r2Section = config.indexOf("[[r2_buckets]]");',
      "if (r2Section !== -1) {",
      '  const nextSection = config.indexOf(String.fromCharCode(10) + "[", r2Section + "[[r2_buckets]]".length);',
      "  config = nextSection === -1",
      "    ? config.slice(0, r2Section).trimEnd()",
      "    : config.slice(0, r2Section) + config.slice(nextSection + 1);",
      "}",
      "writeFileSync(generatedConfigPath, config);",
      "",
      "const captureDeploymentTargets = isDeployCommand && shouldCaptureDeploymentTargets();",
    ].join(NL);
    if (!out.includes(anchor2)) throw new Error("[no-r2] run-wrangler write anchor missing");
    return out.replace(anchor2, strip);
  },
);

// 2) apps/api/src/storage-contract.ts: allow "unavailable" resources diagnostic.
patch(
  "apps/api/src/storage-contract.ts",
  "storage-contract unavailable union",
  (s) => s.includes('| "unavailable"'),
  (s) =>
    s.replace(
      '    resources: "r2" | "filesystem" | "s3";',
      '    resources: "r2" | "filesystem" | "s3" | "unavailable";',
    ),
);

// 3) apps/api/src/cloudflare-storage-adapter.ts: graceful fallback when RESOURCES is absent.
patch(
  "apps/api/src/cloudflare-storage-adapter.ts",
  "adapter unavailable fallback",
  (s) => s.includes("unavailableBlobStore"),
  (s) => {
    const anchor = [
      "export const createCloudflareStorageAdapter = (",
      "  bindings: CloudflareStorageBindings,",
      "): StorageAdapter => ({",
      "  db: bindings.DB,",
      "  resources: bindings.RESOURCES,",
      "  diagnostics: {",
      '    database: "d1",',
      '    resources: "r2",',
      '    migrationTable: "d1_migrations",',
      "  },",
      "});",
    ].join(NL);
    const replacement = [
      "const unavailableBlobStore = (): BlobStoreAdapter => {",
      "  const unavailable = (): never => {",
      '    throw new Error(',
      '      "Object storage is unavailable: no RESOURCES (R2) binding is configured for this deployment.",',
      "    );",
      "  };",
      "  return {",
      "    get: async () => {",
      "      unavailable();",
      "      return null;",
      "    },",
      "    put: async () => {",
      "      unavailable();",
      "    },",
      "    createMultipartUpload: async () => {",
      "      unavailable();",
      '      throw new Error("unreachable");',
      "    },",
      "    resumeMultipartUpload: () => {",
      "      unavailable();",
      '      throw new Error("unreachable");',
      "    },",
      "    delete: async () => {",
      "      unavailable();",
      "    },",
      "  };",
      "};",
      "",
      "export const createCloudflareStorageAdapter = (",
      "  bindings: CloudflareStorageBindings,",
      "): StorageAdapter => {",
      "  const resources = bindings.RESOURCES ?? unavailableBlobStore();",
      "  return {",
      "    db: bindings.DB,",
      "    resources,",
      "    diagnostics: {",
      '      database: "d1",',
      '      resources: bindings.RESOURCES ? "r2" : "unavailable",',
      '      migrationTable: "d1_migrations",',
      "    },",
      "  };",
      "};",
    ].join(NL);
    if (!s.includes(anchor)) throw new Error("[no-r2] adapter anchor missing");
    let next = s.replace(anchor, replacement);
    next = next.replace("  RESOURCES: BlobStoreAdapter;", "  RESOURCES?: BlobStoreAdapter;");
    return next;
  },
);

console.log("[no-r2] transform complete");
