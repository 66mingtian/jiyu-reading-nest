import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  SourceObjectNotFoundError,
  sourceBytesToArrayBuffer,
  type SourceObjectStorage
} from "./source-object-storage.js";

export class FileSourceObjectStorage implements SourceObjectStorage {
  private readonly absoluteRoot: string;

  constructor(rootDirectory: string) {
    this.absoluteRoot = resolve(rootDirectory);
  }

  async putObject(input: {
    key: string;
    bytes: Uint8Array | ArrayBuffer | Blob;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; sizeBytes: number }> {
    const objectPath = this.objectPath(input.key);
    const temporaryPath = `${objectPath}.${randomUUID()}.tmp`;
    const bytes = new Uint8Array(await sourceBytesToArrayBuffer(input.bytes));
    await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporaryPath, bytes, { mode: 0o600 });
      await rename(temporaryPath, objectPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return { key: input.key, sizeBytes: bytes.byteLength };
  }

  async getObject(key: string): Promise<{
    bytes: ArrayBuffer;
    contentType?: string;
    sizeBytes?: number;
  }> {
    const objectPath = this.objectPath(key);
    try {
      const bytes = await readFile(objectPath);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return {
        bytes: copy.buffer,
        contentType: inferContentType(key),
        sizeBytes: bytes.byteLength
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SourceObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async headObject(key: string): Promise<{
    exists: boolean;
    contentType?: string;
    sizeBytes?: number;
  }> {
    try {
      const details = await stat(this.objectPath(key));
      if (!details.isFile()) return { exists: false };
      return {
        exists: true,
        contentType: inferContentType(key),
        sizeBytes: details.size
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
      throw error;
    }
  }

  async deleteObject(key: string): Promise<{ deleted: boolean }> {
    try {
      await unlink(this.objectPath(key));
      return { deleted: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { deleted: false };
      throw error;
    }
  }

  private objectPath(key: string): string {
    if (!key || key.includes("\0") || isAbsolute(key)) {
      throw new Error("Source object key must be a non-empty relative path");
    }
    const candidate = resolve(this.absoluteRoot, key);
    const relativePath = relative(this.absoluteRoot, candidate);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Source object key escapes the private storage root");
    }
    return candidate;
  }
}

function inferContentType(key: string): string {
  return key.endsWith(".json") ? "application/json" : "text/plain;charset=utf-8";
}
