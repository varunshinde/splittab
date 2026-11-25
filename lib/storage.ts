import { promises as fs } from "fs";
import path from "path";
import { put, del } from "@vercel/blob";

// Storage abstraction: callers only see StorageProvider, so the backing
// store can change without touching them. Full-resolution originals are
// stored as-is in every provider.
//
// Provider selection (see getStorageProvider):
// - Production on Vercel: VercelBlobStorageProvider, active when
//   BLOB_READ_WRITE_TOKEN is set. Receipt.filePath then holds the blob's
//   public https URL; receipt metadata (size, upload time, expense link)
//   still lives in Postgres.
// - Local dev / Docker: LocalStorageProvider writing to public/uploads,
//   exactly as before. Receipt.filePath then holds a local filesystem path.
export interface StorageProvider {
  save(fileName: string, data: Buffer): Promise<{ filePath: string; fileSizeBytes: bigint }>;
  remove(filePath: string): Promise<void>;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private baseDir = path.join(process.cwd(), "public", "uploads")) {}
  async save(fileName: string, data: Buffer) {
    await fs.mkdir(this.baseDir, { recursive: true });
    const filePath = path.join(this.baseDir, `${Date.now()}-${safeFileName(fileName)}`);
    await fs.writeFile(filePath, data);
    return { filePath, fileSizeBytes: BigInt(data.byteLength) };
  }
  async remove(filePath: string) {
    await fs.rm(filePath, { force: true });
  }
}

export class VercelBlobStorageProvider implements StorageProvider {
  constructor(private token?: string) {}
  async save(fileName: string, data: Buffer) {
    const pathname = `receipts/${Date.now()}-${safeFileName(fileName)}`;
    const blob = await put(pathname, data, {
      access: "public",
      addRandomSuffix: true,
      ...(this.token ? { token: this.token } : {}),
    });
    return { filePath: blob.url, fileSizeBytes: BigInt(data.byteLength) };
  }
  async remove(filePath: string) {
    // Only blob URLs can be deleted here; a local filesystem path (receipts
    // uploaded in dev before Blob was configured) is a safe no-op.
    if (!/^https?:\/\//.test(filePath)) return;
    try {
      await del(filePath, ...(this.token ? [{ token: this.token }] : []));
    } catch {
      // Deleting an already-gone blob should not fail the caller.
    }
  }
}

/** Pick the storage provider from the environment: Vercel Blob when its
 *  read/write token is configured, otherwise the local filesystem. */
export function getStorageProvider(
  env: { BLOB_READ_WRITE_TOKEN?: string } = process.env,
): StorageProvider {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? new VercelBlobStorageProvider(token) : new LocalStorageProvider();
}

export const storage: StorageProvider = getStorageProvider();
