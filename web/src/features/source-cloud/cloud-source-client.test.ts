import { describe, expect, it, vi } from "vitest";
import { CloudSourceClient } from "./cloud-source-client.js";

describe("CloudSourceClient", () => {
  it("uploads novel source to the component endpoint instead of sending full text through the bridge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceManifest: {
          sourceId: "source-direct",
          sourceKind: "pasted_text",
          contentHash: "d".repeat(64),
          segmentationVersion: 3,
          paragraphCount: 1,
          cloudSync: {
            enabled: true,
            provider: "r2",
            objectKey: "private/sources/source-direct/source.txt"
          }
        }
      })
    );
    const toolCaller = vi.fn();
    const client = new CloudSourceClient("/source/secret", fetchMock, toolCaller);

    const result = await client.uploadNovelSource({
      sessionId: "session-1",
      title: "Direct book",
      sourceText: "private novel text"
    });

    expect(toolCaller).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/source/secret/upload",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      sessionId: "session-1",
      sourceKind: "pasted_text",
      title: "Direct book",
      sourceText: "private novel text"
    });
    expect(result.sourceManifest?.cloudSync.enabled).toBe(true);
  });

  it("uploads 3.5 MiB and 4.9 MiB Chinese novels directly without the bridge", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({
        sourceManifest: {
          sourceId: "source-large",
          sourceKind: "pasted_text",
          contentHash: "e".repeat(64),
          segmentationVersion: 3,
          paragraphCount: 12,
          cloudSync: { enabled: true, provider: "r2", objectKey: "private/sources/source-large/source.txt" }
        }
      }))
    );
    const toolCaller = vi.fn();
    const client = new CloudSourceClient("https://worker.example.test/source/secret", fetchMock, toolCaller);

    for (const byteSize of [
      Math.floor(2.5 * 1024 * 1024),
      Math.floor(3.5 * 1024 * 1024),
      Math.floor(4.9 * 1024 * 1024)
    ]) {
      fetchMock.mockClear();
      toolCaller.mockClear();
      const sourceText = makeChineseText(byteSize);

      const result = await client.uploadNovelSource({
        sessionId: "session-large",
        title: "大文件",
        sourceText
      });

      expect(toolCaller).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://worker.example.test/source/secret/upload",
        expect.objectContaining({ method: "POST" })
      );
      expect(result.sourceManifest?.cloudSync.enabled).toBe(true);
    }
  });

  it("uses the bridge only as a small-text fallback when no private source endpoint exists", async () => {
    const fetchMock = vi.fn();
    const sourceManifest = {
      sourceId: "source-bridge",
      sourceKind: "pasted_text" as const,
      contentHash: "c".repeat(64),
      segmentationVersion: 1,
      paragraphCount: 1,
      cloudSync: {
        enabled: true,
        provider: "r2" as const,
        objectKey: "private/sources/source-bridge/source.txt"
      }
    };
    const toolCaller = vi.fn().mockResolvedValue({
      structuredContent: {
        uploaded: true,
        sessionId: "session-1",
        sourceId: "source-bridge",
        contentHash: "c".repeat(64),
        paragraphCount: 1,
        cloudSync: { enabled: true, provider: "r2" }
      },
      _meta: { sourceManifest }
    });
    const client = new CloudSourceClient("/source", fetchMock, toolCaller);

    const result = await client.uploadNovelSource({
      sessionId: "session-1",
      title: "Bridge book",
      sourceText: "private novel text"
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toolCaller).toHaveBeenCalledWith("upload_cloud_source", {
      sessionId: "session-1",
      sourceKind: "pasted_text",
      title: "Bridge book",
      sourceText: "private novel text"
    });
    expect(result.sourceManifest).toBe(sourceManifest);
    expect(JSON.stringify(toolCaller.mock.results)).not.toContain("private novel text");
  });

  it("refuses to send large novels through the bridge when no source endpoint exists", async () => {
    const fetchMock = vi.fn();
    const toolCaller = vi.fn();
    const client = new CloudSourceClient("/source", fetchMock, toolCaller);

    const result = await client.uploadNovelSource({
      sessionId: "session-large",
      sourceText: makeChineseText(Math.floor(3.5 * 1024 * 1024))
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toolCaller).not.toHaveBeenCalled();
    expect(result.sourceManifest).toBeUndefined();
    expect(result.diagnostics.bridgeUploadStatus).toBe("failure");
    expect(result.diagnostics.bridgeUploadError).toContain("too large for bridge upload");
  });

  it("uploads novel source to the component-only endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceManifest: {
          sourceId: "source-1",
          sourceKind: "pasted_text",
          contentHash: "a".repeat(64),
          segmentationVersion: 1,
          paragraphCount: 2,
          cloudSync: { enabled: true, provider: "r2", objectKey: "private/sources/source-1/source.txt" }
        }
      })
    );
    const client = new CloudSourceClient("/source/secret", fetchMock);

    const result = await client.uploadNovelSource({
      sessionId: "session-1",
      title: "测试书",
      sourceText: "第一段\n\n第二段"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/source/secret/upload",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      sessionId: "session-1",
      title: "测试书",
      sourceText: "第一段\n\n第二段"
    });
    expect(result.sourceManifest?.sourceId).toBe("source-1");
    expect(result).not.toHaveProperty("sourceText");
  });

  it("restores novel source from the component-only endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceText: "第一段\n\n第二段",
        sourceManifest: {
          sourceId: "source-1",
          sourceKind: "pasted_text",
          contentHash: "a".repeat(64),
          segmentationVersion: 1,
          paragraphCount: 2,
          cloudSync: { enabled: true, provider: "r2", objectKey: "private/sources/source-1/source.txt" }
        }
      })
    );
    const client = new CloudSourceClient("/source/secret", fetchMock);

    const result = await client.restoreNovelSource({ sessionId: "session-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/source/secret/restore",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.sourceText).toBe("第一段\n\n第二段");
    expect(result).not.toHaveProperty("publicUrl");
    expect(result).not.toHaveProperty("signedUrl");
  });

  it("loads fresh bookshelf metadata without cache or credentials", async () => {
    const payload = {
      bookshelfSessions: [
        {
          session: { id: "session-1", title: "找回的书" },
          quotes: [],
          reactions: [],
          bookmarks: [],
          cacheState: "unknown"
        }
      ],
      recentSessions: [],
      readingRecords: []
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    const client = new CloudSourceClient(
      "https://worker.example.test/source/secret",
      fetchMock
    );

    await expect(client.loadBookshelf()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example.test/source/secret/bootstrap",
      {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store"
      }
    );
  });

  it("does not attempt bookshelf recovery without a private endpoint", async () => {
    const fetchMock = vi.fn();
    const client = new CloudSourceClient("/source", fetchMock);

    await expect(client.loadBookshelf()).rejects.toThrow("Private bookshelf endpoint");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws clear errors for HTTP failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "云端正文不可用" }, 400));
    const client = new CloudSourceClient("/source/secret", fetchMock);

    await expect(client.restoreNovelSource({ sessionId: "session-1" })).rejects.toThrow(
      "云端正文不可用"
    );
  });

  it("returns a diagnostic failure when the browser blocks the source request before a response", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = new CloudSourceClient("https://worker.example.test/source/secret", fetchMock);

    const result = await client.uploadNovelSource({
      sessionId: "session-1",
      sourceText: "第一段"
    });

    expect(result.sourceManifest).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      bridgeToolAvailable: false,
      bridgeUploadStarted: false,
      bridgeUploadStatus: "not_started",
      directUploadStarted: true,
      directUploadStatus: "failure"
    });
    expect(result.diagnostics.directUploadError).toContain("云端正文请求未到达服务器");
  });

  it("includes safe app and upload diagnostics when fetch is blocked", async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new TypeError("Failed to fetch /source/secret/upload with private/sources/source-1/source.txt")
    );
    const client = new CloudSourceClient("https://worker.example.test/source/secret", fetchMock);

    const result = await client.uploadNovelSource({
      sessionId: "session-1",
      sourceText: "private novel text"
    });
    const message = result.diagnostics.directUploadError ?? "";

    expect(message).toContain("resourceVersion=app-v1-jiyu-private");
    expect(message).toContain("appVersion=0.3.34-jiyu.1");
    expect(message).toContain("sourceEndpointBase=present");
    expect(message).toContain("uploadOrigin=https://worker.example.test");
    expect(message).toContain("uploadPath=/source/<token>/upload");
    expect(message).toContain("fetchError=TypeError");
    expect(message).toContain("likelyBrowserBlock=yes");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("private novel text");
    expect(message).not.toContain("private/sources/source-1");
  });

  it("does not fall back to direct fetch after bridge upload succeeds without private metadata", async () => {
    const fetchMock = vi.fn();
    const toolCaller = vi.fn().mockResolvedValue({
      structuredContent: {
        uploaded: true,
        sessionId: "session-1",
        sourceId: "source-bridge",
        contentHash: "c".repeat(64),
        paragraphCount: 1,
        cloudSync: { enabled: true, provider: "r2" }
      }
    });
    const client = new CloudSourceClient("/source", fetchMock, toolCaller);

    const result = await client.uploadNovelSource({
      sessionId: "session-1",
      sourceText: "private novel text"
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sourceManifest).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      bridgeToolAvailable: true,
      bridgeUploadStarted: true,
      bridgeUploadStatus: "success",
      returnedCloudSyncEnabled: false,
      directUploadStarted: false,
      directUploadStatus: "not_started"
    });
  });

  it("reports bridge upload as not_started when the toolCaller returns unavailable, without reading global window state", async () => {
    // No window.openai is set on purpose — diagnostics must come from the
    // toolCaller result alone, not from re-reading the global host environment.
    const fetchMock = vi.fn();
    const toolCaller = vi.fn().mockResolvedValue({
      unavailable: true,
      reason: "no-host"
    });
    const client = new CloudSourceClient("/source", fetchMock, toolCaller);

    const result = await client.uploadNovelSource({
      sessionId: "session-1",
      sourceText: "private novel text"
    });

    expect(toolCaller).toHaveBeenCalledWith("upload_cloud_source", expect.objectContaining({
      sessionId: "session-1",
      sourceText: "private novel text"
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sourceManifest).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      bridgeToolAvailable: false,
      bridgeUploadStarted: false,
      bridgeUploadStatus: "not_started",
      directUploadStarted: false,
      directUploadStatus: "not_started"
    });
    // Must never be reported as a success.
    expect(result.diagnostics.bridgeUploadStatus).not.toBe("success");
    expect(result.diagnostics.bridgeUploadStarted).not.toBe(true);
  });

});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeChineseText(targetBytes: number): string {
  const unit = "春";
  return unit.repeat(Math.ceil(targetBytes / new Blob([unit]).size));
}
