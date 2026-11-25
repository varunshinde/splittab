import { promises as fs } from "fs";
import path from "path";
import { get, put, del } from "@vercel/blob";

// Storage abstraction: callers only see StorageProvider, so the backing
// store can change without touching them. Full-resolution originals are
// stored as-is in every provider.
//
// Provider selection (see getStorageProvider):
// - Production on Vercel: VercelBlobStorageProvider, active when
//   BLOB_READ_WRITE_TOKEN is set. Blobs are PRIVATE (F7): Receipt.filePath
//   holds the blob URL, but it is only ever read back server-side through
//   read() behind the authenticated /api/receipts/[id] route — the URL
//   alone grants nothing.
// - Local dev / Docker: LocalStorageProvider writing to public/uploads.
//   Receipt.filePath then holds a local filesystem path, likewise only
//   served through the authenticated route.
export interface StorageProvider {
  save(fileName: string, data: Buffer): Promise<{ filePath: string; fileSizeBytes: bigint }>;
  remove(filePath: string): Promise<void>;
  read(filePath: string): Promise<{ body: Buffer; contentType: string } | null>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath.split("?")[0]).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
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
  async read(filePath: string) {
    try {
      const body = await fs.readFile(filePath);
      return { body, contentType: contentTypeFor(filePath) };
    } catch {
      return null;
    }
  }
}

export class VercelBlobStorageProvider implements StorageProvider {
  constructor(private token?: string) {}
  async save(fileName: string, data: Buffer) {
    const pathname = `receipts/${Date.now()}-${safeFileName(fileName)}`;
    const blob = await put(pathname, data, {
      access: "private",
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
  async read(filePath: string) {
    if (!/^https?:\/\//.test(filePath)) return null;
    try {
      const res = await get(filePath, {
        access: "private",
        ...(this.token ? { token: this.token } : {}),
      });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of res.stream as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return { body: Buffer.concat(chunks), contentType: res.blob.contentType || contentTypeFor(filePath) };
    } catch {
      return null;
    }
  }
}

/** Pick the storage provider from the environment: Vercel Blob when its
 *  read/write token is configured, otherwise the local filesystem. */
export function getStorageProvider(
  env: Record<string, string | undefined> = process.env,
): StorageProvider {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? new VercelBlobStorageProvider(token) : new LocalStorageProvider();
}

export const storage: StorageProvider = getStorageProvider();
