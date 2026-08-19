import { readFile } from "node:fs/promises";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_PREFERENCES, type ReadingDatabase } from "@ss/shared";
import { createApp } from "./app.js";
import { buildCurrentReadingContext, registerReadingTools } from "./mcp/register-tools.js";
import { toolResult } from "./mcp/tool-result.js";
import { sanitizeBookshelfBundle } from "./privacy/sanitize-bookshelf.js";
import type { ReadingRepository } from "./repositories/reading-repository.js";
import { ReadingService } from "./services/reading-service.js";
import { CloudSourceService } from "./services/cloud-source-service.js";
import { MemorySourceObjectStorage } from "./storage/memory-source-object-storage.js";
import { buildSourceManifestObjectKey, buildSourceObjectKey } from "./storage/source-object-keys.js";
import { handleSourceRoute } from "./source-routes.js";
import { createStandaloneReaderResponse } from "./standalone-reader.js";
import { getWorkerRoute } from "./worker-router.js";

const NOW = "2026-06-24T00:00:00.000Z";
const NOVEL_SECRET = "TASK8_NOVEL_SOURCE_SECRET";
const CURRENT_TEXT = "TASK8_CURRENT_TEXT";
const SELECTED_TEXT = "TASK8_SELECTED_TEXT";
const INCLUDED_TEXT = "TASK8_INCLUDED_TEXT";
const SKIPPED_TEXT = "TASK8_SKIPPED_RANGE_TEXT";
const CHAT_TRANSCRIPT = "TASK8_FULL_CHAT_TRANSCRIPT";
const PROMPT_TEXT = "TASK8_PROMPT_TEXT";
const DEEP_ANALYSIS = "TASK8_DEEP_ANALYSIS_BODY";
const IMAGE_BASE64 = "AQID";
const API_SECRET = "OPENAI_API_KEY";
const TEST_OBJECT_KEY = "private/sources/privacy-test/source.txt";
const TEST_MANIFEST_OBJECT_KEY = "private/sources/privacy-test/manifest.json";

const forbidden = [
  NOVEL_SECRET,
  CURRENT_TEXT,
  SELECTED_TEXT,
  INCLUDED_TEXT,
  SKIPPED_TEXT,
  CHAT_TRANSCRIPT,
  PROMPT_TEXT,
  DEEP_ANALYSIS,
  IMAGE_BASE64,
  "data:image",
  "bytesBase64",
  "sourceText",
  "download_url",
  "file_id",
  "publicUrl",
  "signedUrl",
  API_SECRET
];

describe("privacy boundary", () => {
  it("keeps novel upload and restore text out of D1-like state", async () => {
    const { cloudSource, repository, sessionId } = setup();

    await cloudSource.uploadNovelSource({
      sessionId,
      sourceKind: "pasted_text",
      title: "Secret Title",
      sourceText: `${NOVEL_SECRET}\n\nSecond paragraph`
    });
    assertNoForbidden(JSON.stringify(await repository.read()));

    await cloudSource.restoreNovelSource(sessionId);
    assertNoForbidden(JSON.stringify(await repository.read()));
  });

  it("keeps assistant-visible delete and status results metadata-only", async () => {
    const { cloudSource, sessionId } = setup();
    await cloudSource.uploadNovelSource({
      sessionId,
      sourceKind: "pasted_text",
      sourceText: `${NOVEL_SECRET}\n\nSecond paragraph`
    });

    const statusResult = toolResult(
      await cloudSource.getCloudSourceStatus(sessionId),
      "checked cloud source status"
    );
    const deleteResult = toolResult(
      await cloudSource.deleteCloudSource(sessionId),
      "deleted cloud source"
    );

    assertNoForbidden(JSON.stringify(statusResult));
    assertNoForbidden(JSON.stringify(deleteResult));
  });

  it("keeps R2 object keys private and free of title, hash, filename, text, and URLs", () => {
    const sourceId = "opaque-source-id";
    const keys = [
      buildSourceObjectKey(sourceId),
      buildSourceManifestObjectKey(sourceId)
    ];

    expect(keys.every((key) => key.startsWith("private/sources/"))).toBe(true);
    expect(JSON.stringify(keys)).not.toMatch(
      /Secret Title|[a-f0-9]{64}|chapter-one\.txt|TASK8_NOVEL_SOURCE_SECRET|publicUrl|signedUrl|https?:\/\//
    );
  });

  it("keeps health and wrong private paths free of tokens, object keys, source text, and R2 details", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /private-token|objectKey|sourceText|SOURCES_BUCKET|R2|TASK8_NOVEL_SOURCE_SECRET/
    );
    expect(getWorkerRoute(new URL("https://example.test/source/wrong/upload"), "private-token")).toBe(
      "not-found"
    );
    expect(getWorkerRoute(new URL("https://example.test/source/private-token"), "private-token")).toBe(
      "not-found"
    );
  });

  it("removes internal R2 keys from get_novel_bookshelf", async () => {
    const handlers = new Map<string, () => Promise<unknown>>();
    const server = {
      registerTool: (name: string, _config: unknown, handler: () => Promise<unknown>) => {
        handlers.set(name, handler);
      }
    };
    const service = {
      getBookshelfSnapshot: async () => ({
        sessionBundles: [privateSessionBundle()],
        readingRecords: []
      })
    };
    registerReadingTools(server as never, service as never);

    const result = await handlers.get("get_novel_bookshelf")?.();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("objectKey");
    expect(serialized).not.toContain("manifestObjectKey");
    expect(serialized).not.toContain(TEST_OBJECT_KEY);
    expect(serialized).not.toContain(TEST_MANIFEST_OBJECT_KEY);
  });

  it("removes internal R2 keys from the standalone reader HTML", async () => {
    const url = new URL("https://example.test/reader/private-token");
    expect(getWorkerRoute(url, "private-token")).toBe("reader");
    const bookshelfSessions = [sanitizeBookshelfBundle(privateSessionBundle())];
    const response = createStandaloneReaderResponse("<html><head></head><body></body></html>", {
      bookshelfSessions,
      recentSessions: bookshelfSessions
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain("objectKey");
    expect(html).not.toContain("manifestObjectKey");
    expect(html).not.toContain(TEST_OBJECT_KEY);
    expect(html).not.toContain(TEST_MANIFEST_OBJECT_KEY);
    expect(html).toContain('unavailable:true,reason:"no-host"');
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("documents the v0.3.34 cloud-first privacy model in README", async () => {
    const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");

    expect(readme).toContain("v0.3.34");
    expect(readme).toMatch(/R2[\s\S]*正文/);
    expect(readme).toMatch(/D1[\s\S]*metadata/);
    expect(readme).toMatch(/IndexedDB[\s\S]*加速缓存/);
    expect(readme).toContain("component-only");
    expect(readme).toContain("ChatGPT 模型不会自动读取整本小说");
    expect(readme).toContain("删除云端阅读记录");
    expect(readme).toContain("同时删除云端正文副本");
    expect(readme).toContain("同时删除本设备正文缓存");
    expect(readme).toContain("不生成 public URL 或 signed URL");
    expect(readme).toContain("remote smoke");
  });

  it("keeps token-bearing request URLs out of stored Cloudflare telemetry", async () => {
    const wranglerConfig = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");

    expect(wranglerConfig).toContain('"invocation_logs": false');
    expect(wranglerConfig).toMatch(/"traces"\s*:\s*\{\s*"enabled"\s*:\s*false/);
  });
});

function setup() {
  const repository = new MemoryReadingRepository();
  const storage = new MemorySourceObjectStorage();
  const readingService = new ReadingService(repository, {
    now: () => new Date(NOW),
    id: () => "comment-1"
  });
  const cloudSource = new CloudSourceService(repository, storage, {
    now: () => new Date(NOW),
    id: () => "source-1"
  });
  return { cloudSource, readingService, repository, sessionId: "session-1", storage };
}

function assertNoForbidden(serialized: string) {
  for (const token of forbidden) {
    expect(serialized).not.toContain(token);
  }
}

class MemoryReadingRepository implements ReadingRepository {
  private database: ReadingDatabase = {
    schemaVersion: 5,
    sessions: [
      {
        id: "session-1",
        title: "Task 8 privacy book",
        type: "novel",
        status: "active",
        userCurrentPosition: { kind: "paragraph", index: 1, label: "paragraph 1" },
        assistantSyncedPosition: null,
        liveReadingEnabled: false,
        sessionPreferences: structuredClone(DEFAULT_SESSION_PREFERENCES),
        sourceManifest: null,
        createdAt: NOW,
        updatedAt: NOW,
        lastReadAt: NOW
      }
    ],
    quotes: [],
    reactions: [],
    bookmarks: [],
    readingRecords: []
  };

  async read(): Promise<ReadingDatabase> {
    return structuredClone(this.database);
  }

  async mutate<T>(change: (database: ReadingDatabase) => T | Promise<T>): Promise<T> {
    return change(this.database);
  }
}

function privateSessionBundle() {
  return {
    session: {
      id: "privacy-session",
      title: "Privacy book",
      type: "novel" as const,
      status: "active" as const,
      userCurrentPosition: { kind: "paragraph" as const, index: 1, label: "paragraph 1" },
      assistantSyncedPosition: null,
      liveReadingEnabled: false,
      sessionPreferences: structuredClone(DEFAULT_SESSION_PREFERENCES),
      sourceManifest: {
        sourceId: "privacy-source",
        sourceKind: "pasted_text" as const,
        contentHash: "a".repeat(64),
        segmentationVersion: 4,
        paragraphCount: 2,
        cloudSync: {
          enabled: true,
          provider: "r2" as const,
          objectKey: TEST_OBJECT_KEY,
          manifestObjectKey: TEST_MANIFEST_OBJECT_KEY,
          sizeBytes: 128,
          mimeType: "text/plain;charset=utf-8"
        }
      },
      createdAt: NOW,
      updatedAt: NOW,
      lastReadAt: NOW
    },
    quotes: [],
    reactions: [],
    bookmarks: []
  };
}
