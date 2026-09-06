import type {
  BlobStoreAdapter,
  DatabaseAdapter,
  StorageAdapter,
} from "./storage-contract";

/** Native Worker bindings are mentioned only at this platform boundary. */
export type CloudflareStorageBindings = {
  DB: DatabaseAdapter;
  RESOURCES?: BlobStoreAdapter;
};

/**
 * Adapts native Cloudflare bindings to the storage surface consumed by the
 * application. No route or service should construct this shape directly.
 */
const unavailableBlobStore = (): BlobStoreAdapter => {
  const unavailable = (): never => {
    throw new Error(
      "Object storage is unavailable: no RESOURCES (R2) binding is configured for this deployment.",
    );
  };
  return {
    get: async () => {
      unavailable();
      return null;
    },
    put: async () => {
      unavailable();
    },
    createMultipartUpload: async () => {
      unavailable();
      throw new Error("unreachable");
    },
    resumeMultipartUpload: () => {
      unavailable();
      throw new Error("unreachable");
    },
    delete: async () => {
      unavailable();
    },
  };
};

export const createCloudflareStorageAdapter = (
  bindings: CloudflareStorageBindings,
): StorageAdapter => {
  const resources = bindings.RESOURCES ?? unavailableBlobStore();
  return {
    db: bindings.DB,
    resources,
    diagnostics: {
      database: "d1",
      resources: bindings.RESOURCES ? "r2" : "unavailable",
      migrationTable: "d1_migrations",
    },
  };
};
