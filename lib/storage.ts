import { promises as fs } from "fs";
import path from "path";

// Storage abstraction: swap LocalStorageProvider for an S3 provider later
// without touching callers. Full-resolution originals are stored as-is.
export interface StorageProvider {
  save(fileName: string, data: Buffer): Promise<{ filePath: string; fileSizeBytes: bigint }>;
  remove(filePath: string): Promise<void>;
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private baseDir = path.join(process.cwd(), "public", "uploads")) {}
  async save(fileName: string, data: Buffer) {
    await fs.mkdir(this.baseDir, { recursive: true });
    const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(this.baseDir, `${Date.now()}-${safe}`);
    await fs.writeFile(filePath, data);
    return { filePath, fileSizeBytes: BigInt(data.byteLength) };
  }
  async remove(filePath: string) {
    await fs.rm(filePath, { force: true });
  }
}

export const storage: StorageProvider = new LocalStorageProvider();
