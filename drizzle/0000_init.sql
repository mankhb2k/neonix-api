CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'Default key' NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "asset_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"variant_kind" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_variants_r2_key_unique" UNIQUE("r2_key"),
	CONSTRAINT "asset_variants_variant_kind_check" CHECK ("asset_variants"."variant_kind" in ('thumbnail', 'proxy', 'waveform', 'poster', 'audio')),
	CONSTRAINT "asset_variants_byte_size_check" CHECK ("asset_variants"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"storage_bucket" text DEFAULT 'neonix-user-assets' NOT NULL,
	"original_filename" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"preview_key" text,
	"preview_status" text DEFAULT 'unsupported' NOT NULL,
	"source_duration_ms" bigint,
	"source_width" integer,
	"source_height" integer,
	"has_audio" boolean,
	"preview_version" integer,
	"preview_error" text,
	"media_status" text DEFAULT 'not_required' NOT NULL,
	CONSTRAINT "assets_r2_key_unique" UNIQUE("r2_key"),
	CONSTRAINT "assets_byte_size_check" CHECK ("assets"."byte_size" >= 0),
	CONSTRAINT "assets_kind_check" CHECK ("assets"."kind" in ('image', 'video', 'audio', 'font', 'other')),
	CONSTRAINT "assets_status_check" CHECK ("assets"."status" in ('uploading', 'ready', 'failed', 'deleting', 'deleted')),
	CONSTRAINT "assets_preview_status_check" CHECK ("assets"."preview_status" in ('pending', 'ready', 'failed', 'unsupported')),
	CONSTRAINT "assets_media_status_check" CHECK ("assets"."media_status" in ('not_required', 'queued', 'processing', 'ready', 'partial', 'failed')),
	CONSTRAINT "assets_preview_metadata_check" CHECK (("assets"."source_duration_ms" is null or "assets"."source_duration_ms" >= 0)
      and ("assets"."source_width" is null or "assets"."source_width" > 0)
      and ("assets"."source_height" is null or "assets"."source_height" > 0)
      and ("assets"."preview_version" is null or "assets"."preview_version" >= 1)
      and (("assets"."preview_status" in ('pending', 'ready') and "assets"."preview_key" is not null) or "assets"."preview_status" in ('failed', 'unsupported')))
);
--> statement-breakpoint
CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_integrity" text NOT NULL,
	"pipeline_version" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"streams_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"derivatives_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"media_kind" text DEFAULT 'video' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"source_content_hash" text,
	CONSTRAINT "media_jobs_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "media_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "media_jobs_status_check" CHECK ("media_jobs"."status" in ('queued', 'processing', 'retryable', 'ready', 'partial', 'failed')),
	CONSTRAINT "media_jobs_pipeline_version_check" CHECK ("media_jobs"."pipeline_version" >= 1),
	CONSTRAINT "media_jobs_attempt_count_check" CHECK ("media_jobs"."attempt_count" >= 0),
	CONSTRAINT "media_jobs_media_kind_check" CHECK ("media_jobs"."media_kind" in ('audio', 'video'))
);
--> statement-breakpoint
CREATE TABLE "object_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_deletion_jobs_entity_type_check" CHECK ("object_deletion_jobs"."entity_type" in ('asset', 'asset_variant', 'project_export', 'upload')),
	CONSTRAINT "object_deletion_jobs_status_check" CHECK ("object_deletion_jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "object_deletion_jobs_attempt_count_check" CHECK ("object_deletion_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_assets" (
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"attached_by" text NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_assets_project_id_asset_id_pk" PRIMARY KEY("project_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"expected_byte_size" bigint,
	"expected_mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_preview_byte_size" bigint,
	"expected_preview_mime_type" text,
	"preview_key" text,
	CONSTRAINT "upload_sessions_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "upload_sessions_status_check" CHECK ("upload_sessions"."status" in ('pending', 'uploading', 'completed', 'expired', 'failed')),
	CONSTRAINT "upload_sessions_expected_byte_size_check" CHECK ("upload_sessions"."expected_byte_size" is null or "upload_sessions"."expected_byte_size" >= 0),
	CONSTRAINT "upload_sessions_expected_preview_byte_size_check" CHECK ("upload_sessions"."expected_preview_byte_size" is null or "upload_sessions"."expected_preview_byte_size" > 0),
	CONSTRAINT "upload_sessions_completed_check" CHECK (("upload_sessions"."status" <> 'completed') or "upload_sessions"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_font_families" (
	"project_id" uuid NOT NULL,
	"font_family_id" uuid NOT NULL,
	"alias" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_font_families_project_id_font_family_id_pk" PRIMARY KEY("project_id","font_family_id"),
	CONSTRAINT "project_font_families_alias_check" CHECK ("project_font_families"."alias" is null or length(btrim("project_font_families"."alias")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "user_font_faces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"font_family_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"face_key" text NOT NULL,
	"version" text DEFAULT 'default' NOT NULL,
	"weight" integer NOT NULL,
	"style" text DEFAULT 'normal' NOT NULL,
	"width_class" text DEFAULT 'normal' NOT NULL,
	"format" text NOT NULL,
	"subfamily_name" text,
	"postscript_name" text,
	"axes_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_font_faces_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "user_font_faces_weight_check" CHECK ("user_font_faces"."weight" between 1 and 1000),
	CONSTRAINT "user_font_faces_style_check" CHECK ("user_font_faces"."style" in ('normal', 'italic', 'oblique')),
	CONSTRAINT "user_font_faces_width_class_check" CHECK ("user_font_faces"."width_class" in (
      'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed',
      'normal',
      'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded'
    )),
	CONSTRAINT "user_font_faces_format_check" CHECK ("user_font_faces"."format" in ('woff2', 'woff', 'ttf'))
);
--> statement-breakpoint
CREATE TABLE "user_font_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"slug" text NOT NULL,
	"family_name" text NOT NULL,
	"license" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_font_families_slug_check" CHECK ("user_font_families"."slug" ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
	CONSTRAINT "user_font_families_family_name_check" CHECK (length(btrim("user_font_families"."family_name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "account_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"max_active_projects" integer DEFAULT 10 NOT NULL,
	"storage_quota_bytes" bigint DEFAULT 1073741824 NOT NULL,
	"max_upload_bytes" bigint DEFAULT 524288000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_plans_plan_check" CHECK ("account_plans"."plan" in ('free', 'pro')),
	CONSTRAINT "account_plans_max_active_projects_check" CHECK ("account_plans"."max_active_projects" between 1 and 50),
	CONSTRAINT "account_plans_storage_quota_bytes_check" CHECK ("account_plans"."storage_quota_bytes" between 0 and 10737418240),
	CONSTRAINT "account_plans_max_upload_bytes_check" CHECK ("account_plans"."max_upload_bytes" between 1 and 2147483648)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"avatar_path" text,
	"avatar_mime_type" text,
	"avatar_size_bytes" bigint,
	"avatar_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_avatar_size_bytes_check" CHECK ("profiles"."avatar_size_bytes" is null or "profiles"."avatar_size_bytes" between 1 and 5242880)
);
--> statement-breakpoint
CREATE TABLE "team_plans" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"seats_purchased" integer DEFAULT 2 NOT NULL,
	"max_active_projects" integer NOT NULL,
	"storage_quota_bytes" bigint NOT NULL,
	"max_upload_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_plans_seats_purchased_check" CHECK ("team_plans"."seats_purchased" >= 2)
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_members_role_check" CHECK ("workspace_members"."role" in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text DEFAULT 'team' NOT NULL,
	CONSTRAINT "workspaces_name_check" CHECK (char_length(btrim("workspaces"."name")) between 1 and 120),
	CONSTRAINT "workspaces_kind_check" CHECK ("workspaces"."kind" in ('personal', 'team'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid,
	"actor_user_id" text,
	"actor_client_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"kind" text NOT NULL,
	"external_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_ledger_amount_cents_check" CHECK ("wallet_ledger"."amount_cents" <> 0),
	CONSTRAINT "wallet_ledger_kind_check" CHECK ("wallet_ledger"."kind" in ('topup', 'export_charge', 'refund', 'adjustment'))
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" jsonb,
	"requested_user_info_claims" jsonb,
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" jsonb NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" jsonb,
	"client_credentials_scopes" jsonb DEFAULT '[]'::jsonb,
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" jsonb,
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" jsonb NOT NULL,
	"post_logout_redirect_uris" jsonb,
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" jsonb,
	"response_types" jsonb,
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" jsonb,
	"requested_user_info_claims" jsonb,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" jsonb,
	"requested_user_info_claims" jsonb,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" jsonb NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" jsonb,
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "project_html_documents" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"html" text NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_html_documents_html_check" CHECK (char_length("project_html_documents"."html") > 0),
	CONSTRAINT "project_html_documents_byte_size_check" CHECK ("project_html_documents"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_ref" text DEFAULT 'prj_' || encode(gen_random_bytes(10), 'hex') NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT 'Untitled project' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"deleted_by" text,
	"deletion_reason" text,
	"storage_quota_bytes" bigint DEFAULT 1073741824 NOT NULL,
	"create_idempotency_key" text,
	"create_idempotency_hash" text,
	CONSTRAINT "projects_public_ref_unique" UNIQUE("public_ref"),
	CONSTRAINT "projects_title_check" CHECK (char_length(btrim("projects"."title")) between 1 and 200),
	CONSTRAINT "projects_storage_quota_bytes_check" CHECK ("projects"."storage_quota_bytes" between 0 and 1073741824),
	CONSTRAINT "projects_lifecycle_check" CHECK (("projects"."deleted_at" is null and "projects"."purge_after" is null) or ("projects"."deleted_at" is not null and "projects"."purge_after" is not null and "projects"."purge_after" >= "projects"."deleted_at"))
);
--> statement-breakpoint
CREATE TABLE "html_render_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_ref" text DEFAULT 'hrj_' || encode(gen_random_bytes(10), 'hex') NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"output_key" text,
	"error_message" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "html_render_jobs_public_ref_unique" UNIQUE("public_ref"),
	CONSTRAINT "html_render_jobs_status_check" CHECK ("html_render_jobs"."status" in ('queued', 'rendering', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "system_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"variant_kind" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" bigint,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_font_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"family_name" text NOT NULL,
	"license" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_font_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"font_family_id" uuid NOT NULL,
	"version" text NOT NULL,
	"weight" integer NOT NULL,
	"style" text DEFAULT 'normal' NOT NULL,
	"format" text DEFAULT 'woff2' NOT NULL,
	"storage_bucket" text DEFAULT 'neonix-system-fonts' NOT NULL,
	"r2_key" text NOT NULL,
	"public_url" text,
	"content_hash" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subfamily_name" text,
	"postscript_name" text,
	"width_class" text DEFAULT 'normal' NOT NULL,
	"axes_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"face_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variants" ADD CONSTRAINT "asset_variants_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_attached_by_user_id_fk" FOREIGN KEY ("attached_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_font_families" ADD CONSTRAINT "project_font_families_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_font_families" ADD CONSTRAINT "project_font_families_font_family_id_user_font_families_id_fk" FOREIGN KEY ("font_family_id") REFERENCES "public"."user_font_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_font_families" ADD CONSTRAINT "project_font_families_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_font_faces" ADD CONSTRAINT "user_font_faces_font_family_id_user_font_families_id_fk" FOREIGN KEY ("font_family_id") REFERENCES "public"."user_font_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_font_faces" ADD CONSTRAINT "user_font_faces_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_font_families" ADD CONSTRAINT "user_font_families_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_font_families" ADD CONSTRAINT "user_font_families_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_plans" ADD CONSTRAINT "account_plans_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_plans" ADD CONSTRAINT "team_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_html_documents" ADD CONSTRAINT "project_html_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_html_documents" ADD CONSTRAINT "project_html_documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "html_render_jobs" ADD CONSTRAINT "html_render_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "html_render_jobs" ADD CONSTRAINT "html_render_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "html_render_jobs" ADD CONSTRAINT "html_render_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_font_files" ADD CONSTRAINT "system_font_files_font_family_id_system_font_families_id_fk" FOREIGN KEY ("font_family_id") REFERENCES "public"."system_font_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uidx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_created_at_idx" ON "api_keys" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "asset_variants_asset_kind_uidx" ON "asset_variants" USING btree ("asset_id","variant_kind");--> statement-breakpoint
CREATE INDEX "asset_variants_asset_idx" ON "asset_variants" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "assets_workspace_idx" ON "assets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "assets_workspace_status_idx" ON "assets" USING btree ("workspace_id","status","created_at" DESC NULLS LAST) WHERE "assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assets_preview_status_idx" ON "assets" USING btree ("workspace_id","preview_status") WHERE "assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assets_media_status_idx" ON "assets" USING btree ("workspace_id","media_status","created_at" DESC NULLS LAST) WHERE "assets"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_font_assets_filename_uidx" ON "assets" USING btree ("workspace_id",lower(btrim("original_filename"))) WHERE "assets"."kind" = 'font' and "assets"."original_filename" is not null and "assets"."deleted_at" is null and "assets"."status" in ('uploading', 'ready');--> statement-breakpoint
CREATE UNIQUE INDEX "user_font_assets_content_hash_uidx" ON "assets" USING btree ("workspace_id","content_hash") WHERE "assets"."kind" = 'font' and "assets"."content_hash" not like 'pending:%' and "assets"."deleted_at" is null and "assets"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "media_jobs_queue_idx" ON "media_jobs" USING btree ("status","created_at") WHERE "media_jobs"."status" in ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "media_jobs_workspace_idx" ON "media_jobs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "media_jobs_claim_idx" ON "media_jobs" USING btree ("status","lease_expires_at","created_at") WHERE "media_jobs"."status" in ('queued', 'retryable', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "object_deletion_jobs_bucket_key_uidx" ON "object_deletion_jobs" USING btree ("storage_bucket","object_key");--> statement-breakpoint
CREATE INDEX "object_deletion_jobs_ready_idx" ON "object_deletion_jobs" USING btree ("run_after","created_at") WHERE "object_deletion_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "project_assets_asset_idx" ON "project_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_expiry_idx" ON "upload_sessions" USING btree ("expires_at") WHERE "upload_sessions"."status" in ('pending', 'uploading');--> statement-breakpoint
CREATE INDEX "project_font_families_project_idx" ON "project_font_families" USING btree ("project_id") WHERE "project_font_families"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "user_font_faces_family_face_uidx" ON "user_font_faces" USING btree ("font_family_id","face_key");--> statement-breakpoint
CREATE INDEX "user_font_faces_lookup_idx" ON "user_font_faces" USING btree ("font_family_id","width_class","weight","style") WHERE "user_font_faces"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "user_font_families_workspace_slug_uidx" ON "user_font_families" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_font_families_workspace_name_uidx" ON "user_font_families" USING btree ("workspace_id",lower("family_name"));--> statement-breakpoint
CREATE INDEX "user_font_families_workspace_idx" ON "user_font_families" USING btree ("workspace_id","family_name") WHERE "user_font_families"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_one_owner_per_workspace" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_one_personal_per_owner" ON "workspaces" USING btree ("created_by") WHERE "workspaces"."kind" = 'personal';--> statement-breakpoint
CREATE INDEX "audit_events_workspace_idx" ON "audit_events" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_external_ref_idx" ON "wallet_ledger" USING btree ("external_ref") WHERE "wallet_ledger"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "wallet_ledger_user_id_created_at_idx" ON "wallet_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "projects_create_idempotency_uidx" ON "projects" USING btree ("workspace_id","create_idempotency_key") WHERE "projects"."create_idempotency_key" is not null and "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "html_render_jobs_workspace_idx" ON "html_render_jobs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "html_render_jobs_project_idx" ON "html_render_jobs" USING btree ("project_id","created_at" DESC NULLS LAST);