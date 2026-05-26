import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { BUILD_INFO } from "./build-info.js";
import { createClientCredentialsTokenProvider } from "./client/auth.js";
import { ShopifyGraphQLClient, type Logger } from "./client/graphql.js";
import type { Config } from "./config.js";
import { registerTools } from "./tools/index.js";

export const SERVER_NAME = BUILD_INFO.name;
export const SERVER_VERSION = BUILD_INFO.version;
export const USER_AGENT = `mcp-shopify-js/${BUILD_INFO.version}`;

export type CreateServerOptions = {
  config: Config;
  fetch?: typeof fetch;
  logger?: Logger;
};

export type CreatedServer = {
  server: McpServer;
  client: ShopifyGraphQLClient;
};

export const createServer = (opts: CreateServerOptions): CreatedServer => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const tokenProvider = createClientCredentialsTokenProvider({
    storeDomain: opts.config.storeDomain,
    clientId: opts.config.clientId,
    clientSecret: opts.config.clientSecret,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  const client = new ShopifyGraphQLClient({
    storeDomain: opts.config.storeDomain,
    tokenProvider,
    apiVersion: opts.config.apiVersion,
    maxRetries: opts.config.maxRetries,
    userAgent: USER_AGENT,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  registerTools(server, client, opts.config.apiVersion);
  return { server, client };
};
