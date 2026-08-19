import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { READING_NEST_APP_VERSION } from "@ss/shared";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createReaderWidgetHtml } from "./mcp/reader-widget.js";
import { createMcpServerFromRepository } from "./mcp/server-factory.js";
import { sanitizeBookshelfBundle } from "./privacy/sanitize-bookshelf.js";
import { JsonReadingRepository } from "./repositories/json-reading-repository.js";
import { CloudSourceService } from "./services/cloud-source-service.js";
import { ReadingService } from "./services/reading-service.js";
import { handleSourceRoute } from "./source-routes.js";
import { createStandaloneReaderResponse } from "./standalone-reader.js";
import { FileSourceObjectStorage } from "./storage/file-source-object-storage.js";
import { getWorkerRoute } from "./worker-router.js";

type TransportMap = Record<string, StreamableHTTPServerTransport>;

export type HostedAppOptions = {
  mcpPathToken?: string;
  dataRoot?: string;
};

export function createHostedApp(options: HostedAppOptions) {
  const app = createMcpExpressApp({ host: "0.0.0.0", jsonLimit: "30mb" });
  const transports: TransportMap = {};
  const ready = Boolean(options.mcpPathToken && options.dataRoot);
  const repository = options.dataRoot
    ? new JsonReadingRepository(join(options.dataRoot, "sessions.json"))
    : undefined;
  const sourceService =
    repository && options.dataRoot
      ? new CloudSourceService(
          repository,
          new FileSourceObjectStorage(join(options.dataRoot, "source-objects")),
          undefined,
          "filesystem"
        )
      : undefined;

  app.get("/health", (_request, response) => {
    response.set("cache-control", "no-store");
    response.status(ready ? 200 : 503).json({
      ok: ready,
      app: "明天和季遇的小书房",
      version: READING_NEST_APP_VERSION
    });
  });

  app.use(async (request, response) => {
    const requestUrl = getPublicUrl(request);
    const route = getWorkerRoute(requestUrl, options.mcpPathToken);

    if (!ready || !repository || !sourceService || !options.mcpPathToken) {
      response.status(503).send("Service unavailable");
      return;
    }

    try {
      if (route === "not-found") {
        response.status(404).send("Not found");
        return;
      }
      if (route === "misconfigured") {
        response.status(503).send("Service unavailable");
        return;
      }
      if (route === "source") {
        const readingService = new ReadingService(repository);
        const fetchResponse = await handleSourceRoute(
          toFetchRequest(request, requestUrl),
          sourceService,
          readingService
        );
        await sendFetchResponse(response, fetchResponse);
        return;
      }
      if (route === "reader") {
        if (request.method !== "GET") {
          response.status(404).send("Not found");
          return;
        }
        const readingService = new ReadingService(repository);
        const snapshot = await readingService.getBookshelfSnapshot(false);
        const bookshelfSessions = snapshot.sessionBundles.map(sanitizeBookshelfBundle);
        const fetchResponse = createStandaloneReaderResponse(
          createReaderWidgetHtml(requestUrl.origin),
          {
            sourceEndpointBase: `${requestUrl.origin}/source/${options.mcpPathToken}`,
            bookshelfSessions,
            recentSessions: bookshelfSessions.slice(0, 10)
          }
        );
        await sendFetchResponse(response, fetchResponse);
        return;
      }
      if (route === "mcp") {
        await handleMcpRequest(
          request,
          response,
          transports,
          repository,
          sourceService,
          requestUrl.origin,
          options.mcpPathToken
        );
        return;
      }
      response.status(404).send("Not found");
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Hosted request failed",
          error: error instanceof Error ? error.message : String(error),
          route
        })
      );
      if (!response.headersSent) response.status(500).send("Internal server error");
    }
  });

  return app;
}

async function handleMcpRequest(
  request: ExpressRequest,
  response: ExpressResponse,
  transports: TransportMap,
  repository: JsonReadingRepository,
  sourceService: CloudSourceService,
  publicOrigin: string,
  token: string
) {
  if (request.method === "HEAD") {
    response.set("allow", "GET, POST, DELETE, OPTIONS, HEAD");
    response.set("cache-control", "no-store");
    response.status(200).end();
    return;
  }
  if (request.method === "OPTIONS") {
    response.set("allow", "GET, POST, DELETE, OPTIONS, HEAD");
    response.status(204).end();
    return;
  }
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    response.status(405).send("Method not allowed");
    return;
  }

  const sessionId = request.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport && !sessionId && request.method === "POST" && isInitializeRequest(request.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (createdSessionId) => {
        transports[createdSessionId] = transport!;
      }
    });
    transport.onclose = () => {
      if (transport?.sessionId) delete transports[transport.sessionId];
    };
    const server = createMcpServerFromRepository(
      repository,
      createReaderWidgetHtml(publicOrigin),
      sourceService,
      {
        sourceEndpointBase: `${publicOrigin}/source/${token}`,
        workerOrigin: publicOrigin,
        lightweightSchemas: true
      }
    );
    await server.connect(transport);
  }

  if (!transport) {
    response.status(400).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Invalid or missing MCP session ID" }
    });
    return;
  }

  const accept = request.headers.accept ?? "";
  if (!(accept.includes("application/json") && accept.includes("text/event-stream"))) {
    request.headers.accept = "application/json, text/event-stream";
  }
  await transport.handleRequest(request, response, request.body);
}

function getPublicUrl(request: ExpressRequest): URL {
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const protocol = forwardedProto?.split(",")[0]?.trim() || request.protocol;
  const host = forwardedHost?.split(",")[0]?.trim() || request.headers.host || "localhost";
  return new URL(request.originalUrl, `${protocol}://${host}`);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toFetchRequest(request: ExpressRequest, url: URL): Request {
  const headers = new Headers();
  for (const name of ["accept", "content-type"] as const) {
    const value = request.headers[name];
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined;
  return new Request(url, {
    method: request.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(request.body) } : {})
  });
}

async function sendFetchResponse(response: ExpressResponse, fetchResponse: Response) {
  response.status(fetchResponse.status);
  fetchResponse.headers.forEach((value, name) => response.setHeader(name, value));
  const bytes = Buffer.from(await fetchResponse.arrayBuffer());
  response.send(bytes);
}
