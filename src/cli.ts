#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { BUILD_INFO } from "./build-info.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const stderrLogger = {
  debug: (...args: unknown[]) => {
    if (process.env.SHOPIFY_DEBUG) console.error("[shopify-mcp]", ...args);
  },
  warn: (...args: unknown[]) => console.error("[shopify-mcp]", ...args),
  error: (...args: unknown[]) => console.error("[shopify-mcp]", ...args),
};

const main = async (): Promise<void> => {
  stderrLogger.warn(
    `${BUILD_INFO.name}@${BUILD_INFO.version} (git ${BUILD_INFO.gitCommit} ${BUILD_INFO.gitCommitDate}, node ${process.version})`,
  );
  const config = loadConfig();
  const { server } = createServer({ config, logger: stderrLogger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  stderrLogger.warn(
    `shopify-mcp connected (store=${config.storeDomain}, api=${config.apiVersion})`,
  );

  const shutdown = (signal: string): void => {
    stderrLogger.warn(`received ${signal}, shutting down`);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((err: unknown) => {
  console.error("[shopify-mcp] fatal:", err);
  process.exit(1);
});
