import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { session, user } from "./auth";

// Better Auth's `jwt` + `@better-auth/mcp` (built on `@better-auth/oauth-provider`)
// plugin schema, hand-authored against the exact field definitions read from
// the installed packages' own src/schema.ts (see auth.ts's `plugins` array) -
// the same reasoning as auth.ts's other hand-authored tables (`pnpm run
// auth:schema` / the CLI generator isn't wired up in this monorepo yet).
// This is what turns this server into a standalone OAuth 2.1 authorization
// server for MCP clients (Claude, ChatGPT/Codex/Glama connectors, etc).

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

export const oauthClient = pgTable("oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: jsonb("scopes").$type<string[]>(),
  clientCredentialsScopes: jsonb("client_credentials_scopes").$type<string[]>().default([]),
  userId: text("user_id").references(() => user.id),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: jsonb("contacts").$type<string[]>(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  postLogoutRedirectUris: jsonb("post_logout_redirect_uris").$type<string[]>(),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: jsonb("grant_types").$type<string[]>(),
  responseTypes: jsonb("response_types").$type<string[]>(),
  requirePKCE: boolean("require_pkce"),
  dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
});

export const oauthResource = pgTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: jsonb("allowed_scopes").$type<string[]>(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResource = pgTable("oauth_client_resource", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  resourceId: text("resource_id")
    .notNull()
    .references(() => oauthResource.identifier, { onDelete: "cascade" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at"),
});

export const oauthRefreshToken = pgTable("oauth_refresh_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId),
  sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: jsonb("resources").$type<string[]>(),
  requestedUserInfoClaims: jsonb("requested_user_info_claims").$type<string[]>(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at"),
  revoked: timestamp("revoked"),
  rotatedAt: timestamp("rotated_at"),
  rotationReplayResponse: text("rotation_replay_response"),
  rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
  authTime: timestamp("auth_time"),
  confirmation: jsonb("confirmation"),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
});

export const oauthAccessToken = pgTable("oauth_access_token", {
  id: text("id").primaryKey(),
  token: text("token").unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId),
  sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => user.id),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: jsonb("resources").$type<string[]>(),
  requestedUserInfoClaims: jsonb("requested_user_info_claims").$type<string[]>(),
  refreshId: text("refresh_id").references(() => oauthRefreshToken.id),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at"),
  revoked: timestamp("revoked"),
  confirmation: jsonb("confirmation"),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
});

export const oauthConsent = pgTable("oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId),
  userId: text("user_id").references(() => user.id),
  referenceId: text("reference_id"),
  resources: jsonb("resources").$type<string[]>(),
  requestedUserInfoClaims: jsonb("requested_user_info_claims").$type<string[]>(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// Single-use record for `private_key_jwt` client assertion `jti` replay
// prevention - see the upstream schema.ts comment: the row id is a digest of
// the assertion identifier, so a replay collides on the primary key.
export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
});
