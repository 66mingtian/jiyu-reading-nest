import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSourceObjectStorage } from "./file-source-object-storage.js";

describe("FileSourceObjectStorage", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("persists private source objects without public URLs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reading-nest-source-"));
    temporaryDirectories.push(directory);
    const storage = new FileSourceObjectStorage(directory);
    const key = "private/sources/source-1/source.txt";

    await expect(
      storage.putObject({
        key,
        bytes: new TextEncoder().encode("hello"),
        contentType: "text/plain"
      })
    ).resolves.toEqual({ key, sizeBytes: 5 });

    await expect(storage.headObject(key)).resolves.toEqual({
      exists: true,
      contentType: "text/plain;charset=utf-8",
      sizeBytes: 5
    });
    const restored = await storage.getObject(key);
    expect(new TextDecoder().decode(restored.bytes)).toBe("hello");
    expect(restored).not.toHaveProperty("publicUrl");
    expect(restored).not.toHaveProperty("signedUrl");

    await expect(storage.deleteObject(key)).resolves.toEqual({ deleted: true });
    await expect(storage.headObject(key)).resolves.toEqual({ exists: false });
    await expect(storage.getObject(key)).rejects.toThrow("Source object not found");
  });

  it("rejects absolute and traversal object keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reading-nest-source-"));
    temporaryDirectories.push(directory);
    const storage = new FileSourceObjectStorage(directory);

    for (const key of ["/outside.txt", "../outside.txt", "private/../../outside.txt", ""]) {
      await expect(
        storage.putObject({ key, bytes: new TextEncoder().encode("no") })
      ).rejects.toThrow();
    }
  });
});
