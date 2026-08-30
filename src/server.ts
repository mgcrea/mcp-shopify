import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { BUILD_INFO } from "#/build-info";
import { createClientCredentialsTokenProvider } from "#/client/auth";
import { ShopifyGraphQLClient, type Logger } from "#/client/graphql";
import type { Config } from "#/config";
import { registerTools } from "#/tools/index";

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
  // Placeholders when unconfigured: the client is built either way so
  // `createServer` stays total, but no API-calling tool is registered, so it is
  // never actually asked for a token.
  const tokenProvider = createClientCredentialsTokenProvider({
    storeDomain: opts.config.storeDomain ?? "",
    clientId: opts.config.clientId ?? "",
    clientSecret: opts.config.clientSecret ?? "",
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  const client = new ShopifyGraphQLClient({
    storeDomain: opts.config.storeDomain ?? "",
    tokenProvider,
    apiVersion: opts.config.apiVersion,
    maxRetries: opts.config.maxRetries,
    userAgent: USER_AGENT,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  registerTools(server, client, opts.config);
  return { server, client };
};
