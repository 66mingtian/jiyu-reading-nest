import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createHostedApp } from "./hosted-app.js";

describe("hosted app", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("fails its health check until private storage and token are configured", async () => {
    const response = await request(createHostedApp({})).get("/health");
    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
  });

  it("serves token-protected MCP and persistent source routes", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "reading-nest-hosted-"));
    temporaryDirectories.push(dataRoot);
    const app = createHostedApp({ mcpPathToken: "private-token", dataRoot });

    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    const wrongToken = await request(app).get("/reader/wrong-token");
    expect(wrongToken.status).toBe(404);

    const upload = await request(app)
      .post("/source/private-token/upload")
      .send({
        title: "Railway 测试书",
        sourceText: "第一段。\n\n第二段。",
        sourceKind: "pasted_text"
      });
    expect(upload.status).toBe(200);
    expect(upload.body.sourceManifest.cloudSync).toMatchObject({
      enabled: true,
      provider: "filesystem"
    });
    const sessionId = upload.body.session.id as string;

    const restore = await request(app)
      .post("/source/private-token/restore")
      .send({ sessionId });
    expect(restore.status).toBe(200);
    expect(restore.body.sourceText).toBe("第一段。\n\n第二段。");

    const bootstrap = await request(app).get("/source/private-token/bootstrap");
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.bookshelfSessions).toHaveLength(1);

    const initialize = await request(app)
      .post("/mcp/private-token/ios-v4")
      .set("accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" }
        }
      });
    expect(initialize.status).toBe(200);
    expect(initialize.headers["mcp-session-id"]).toBeTruthy();
  });
});
