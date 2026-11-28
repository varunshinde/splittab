import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";

// Mock @vercel/blob — no real network calls to Vercel in tests.
vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }));
import { put, del } from "@vercel/blob";
import {
  getStorageProvider,
  LocalStorageProvider,
  VercelBlobStorageProvider,
} from "../lib/storage";

const mockPut = vi.mocked(put);
const mockDel = vi.mocked(del);

beforeEach(() => {
  vi.clearAllMocks();
  mockPut.mockResolvedValue({
    url: "https://store.public.blob.vercel-storage.com/receipts/123-receipt.png",
    downloadUrl: "https://store.public.blob.vercel-storage.com/receipts/123-receipt.png?download=1",
    pathname: "receipts/123-receipt.png",
    contentType: "image/png",
    contentDisposition: "inline",
    etag: "abc",
  });
  mockDel.mockResolvedValue(undefined);
});

describe("storage provider selection", () => {
  it("falls back to local storage when no blob token is set", () => {
    expect(getStorageProvider({})).toBeInstanceOf(LocalStorageProvider);
    expect(getStorageProvider({ BLOB_READ_WRITE_TOKEN: "" })).toBeInstanceOf(LocalStorageProvider);
    expect(getStorageProvider({ BLOB_READ_WRITE_TOKEN: "   " })).toBeInstanceOf(LocalStorageProvider);
  });
  it("uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set", () => {
    expect(getStorageProvider({ BLOB_READ_WRITE_TOKEN: "dummy-token" })).toBeInstanceOf(VercelBlobStorageProvider);
  });
});

describe("VercelBlobStorageProvider (mocked)", () => {
  it("save() uploads PRIVATELY and returns the blob URL + byte size", async () => {
    const provider = new VercelBlobStorageProvider("dummy-token");
    const data = Buffer.from("fake-png-bytes");
    const saved = await provider.save("my receipt.png", data);
    expect(saved.filePath).toBe("https://store.public.blob.vercel-storage.com/receipts/123-receipt.png");
    expect(saved.fileSizeBytes).toBe(BigInt(data.byteLength));
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = mockPut.mock.calls[0];
    expect(pathname).toMatch(/^receipts\/\d+-my_receipt\.png$/);
    expect(body).toBe(data);
    expect(options).toMatchObject({ access: "private", token: "dummy-token" });
  });
  it("remove() deletes blob URLs and is a no-op for local paths", async () => {
    const provider = new VercelBlobStorageProvider("dummy-token");
    await provider.remove("/home/user/project/public/uploads/123-receipt.png");
    expect(mockDel).not.toHaveBeenCalled();
    await provider.remove("https://store.public.blob.vercel-storage.com/receipts/123-receipt.png");
    expect(mockDel).toHaveBeenCalledTimes(1);
    expect(mockDel.mock.calls[0][0]).toBe("https://store.public.blob.vercel-storage.com/receipts/123-receipt.png");
  });
});

describe("local storage placement + removal (N10)", () => {
  it("default base directory is NOT under public/", () => {
    const def = new LocalStorageProvider();
    const dir = (def as unknown as { baseDir: string }).baseDir;
    expect(dir).not.toContain(`${path.sep}public${path.sep}`);
    expect(path.basename(dir)).toBe("uploads");
  });

  it("save -> read -> remove round-trips, and remove deletes the file", async () => {
    const os = await import("os");
    const fsp = await import("fs/promises");
    const tmp = path.join(os.tmpdir(), `splittab-storage-${Date.now()}`);
    const provider = new LocalStorageProvider(tmp);
    try {
      const saved = await provider.save("receipt.png", Buffer.from("fake-png-bytes"));
      expect(saved.fileSizeBytes).toBe(BigInt(14));
      const readBack = await provider.read(saved.filePath);
      expect(readBack?.body.toString()).toBe("fake-png-bytes");
      expect(readBack?.contentType).toBe("image/png");
      await provider.remove(saved.filePath);
      expect(await provider.read(saved.filePath)).toBeNull();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
