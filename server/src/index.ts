import { createApp } from "./app.js";
import { createHostedApp } from "./hosted-app.js";

const port = Number(process.env.PORT ?? 8787);
const railwayRuntime = Boolean(process.env.RAILWAY_SERVICE_ID);
const hostedRuntime = railwayRuntime || Boolean(process.env.MCP_PATH_TOKEN);
const dataRoot = railwayRuntime
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : process.env.READING_DATA_DIR;
const app = hostedRuntime
  ? createHostedApp({
      mcpPathToken: process.env.MCP_PATH_TOKEN,
      dataRoot: dataRoot ?? (railwayRuntime ? undefined : "data")
    })
  : createApp();

app.listen(port, "0.0.0.0", () => {
  if (railwayRuntime && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    console.error("RAILWAY_VOLUME_MOUNT_PATH is missing; attach a persistent Railway Volume.");
  }
  if (hostedRuntime && !process.env.MCP_PATH_TOKEN) {
    console.error("MCP_PATH_TOKEN is missing; private routes remain disabled.");
  }
  console.log(`明天和季遇的小书房 MCP server is listening on port ${port}`);
});
