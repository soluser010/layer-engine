export const layerAuthFoundationMigration = Object.freeze({
    version: 5,
    name: 'auth-foundation',
    rollbackNote: 'Export identities, credentials, sessions, OAuth grants, and pending mail before removing Auth tables.',
    upSql: `
        ALTER TABLE layer_engine.sessions
            ADD COLUMN IF NOT EXISTS managed boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS session_id text NULL,
            ADD COLUMN IF NOT EXISTS family_id text NULL,
            ADD COLUMN IF NOT EXISTS assurance jsonb NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS custom_data jsonb NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS custom_data_revision bigint NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS idle_expires_at timestamptz NULL,
            ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz NULL,
            ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NULL,
            ADD COLUMN IF NOT EXISTS revoked_at timestamptz NULL,
            ADD COLUMN IF NOT EXISTS revoke_reason text NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS layer_auth_sessions_identifier_idx
            ON layer_engine.sessions (session_id)
            WHERE session_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS layer_auth_sessions_user_status_idx
            ON layer_engine.sessions (user_id, status, absolute_expires_at);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_users (
            user_id text PRIMARY KEY,
            status text NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'anonymization-pending', 'anonymized')),
            disabled_reason text NULL,
            anonymized_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_identifiers (
            identifier_id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            identifier_type text NOT NULL CHECK (identifier_type IN ('email', 'username')),
            value_normalized text NOT NULL,
            value_display text NOT NULL,
            verified_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (identifier_type, value_normalized)
        );

        CREATE INDEX IF NOT EXISTS layer_auth_identifiers_user_idx
            ON layer_engine.auth_identifiers (user_id, identifier_type);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_password_credentials (
            user_id text PRIMARY KEY REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            password_hash text NOT NULL,
            algorithm text NOT NULL CHECK (algorithm = 'argon2id'),
            parameters jsonb NOT NULL,
            changed_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_passkeys (
            credential_id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            public_key bytea NOT NULL,
            counter bigint NOT NULL DEFAULT 0,
            transports jsonb NOT NULL DEFAULT '[]'::jsonb,
            backup_eligible boolean NOT NULL DEFAULT false,
            backup_state boolean NOT NULL DEFAULT false,
            display_name text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_used_at timestamptz NULL
        );

        CREATE INDEX IF NOT EXISTS layer_auth_passkeys_user_idx
            ON layer_engine.auth_passkeys (user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_totp_credentials (
            user_id text PRIMARY KEY REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            encrypted_secret bytea NOT NULL,
            key_id text NOT NULL,
            algorithm text NOT NULL DEFAULT 'SHA1',
            digits integer NOT NULL DEFAULT 6,
            period integer NOT NULL DEFAULT 30,
            last_counter bigint NULL,
            confirmed_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_recovery_codes (
            code_id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            code_hash text NOT NULL,
            consumed_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_auth_recovery_codes_user_idx
            ON layer_engine.auth_recovery_codes (user_id, consumed_at);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_challenges (
            challenge_id text PRIMARY KEY,
            challenge_type text NOT NULL,
            subject_hash text NOT NULL,
            user_id text NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            secret_hash text NULL,
            payload jsonb NOT NULL DEFAULT '{}'::jsonb,
            attempts_remaining integer NOT NULL,
            expires_at timestamptz NOT NULL,
            consumed_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_auth_challenges_subject_idx
            ON layer_engine.auth_challenges (challenge_type, subject_hash, expires_at);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_external_identities (
            external_identity_id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            provider_id text NOT NULL,
            subject text NOT NULL,
            claims jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (provider_id, subject)
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_roles (
            role_id text PRIMARY KEY,
            role_name text NOT NULL UNIQUE,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_role_permissions (
            role_id text NOT NULL REFERENCES layer_engine.auth_roles (role_id) ON DELETE CASCADE,
            permission text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (role_id, permission)
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_user_roles (
            user_id text NOT NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            role_id text NOT NULL REFERENCES layer_engine.auth_roles (role_id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, role_id)
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_invitations (
            invitation_id text PRIMARY KEY,
            token_hash text NOT NULL UNIQUE,
            email_normalized text NULL,
            roles jsonb NOT NULL DEFAULT '[]'::jsonb,
            expires_at timestamptz NOT NULL,
            consumed_at timestamptz NULL,
            created_by text NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_oauth_clients (
            client_id text PRIMARY KEY,
            client_secret_hash text NULL,
            client_type text NOT NULL CHECK (client_type IN ('public', 'confidential')),
            display_name text NOT NULL,
            redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
            grant_types jsonb NOT NULL DEFAULT '[]'::jsonb,
            scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
            dpop_required boolean NOT NULL DEFAULT false,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_oauth_consents (
            consent_id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            client_id text NOT NULL REFERENCES layer_engine.auth_oauth_clients (client_id) ON DELETE CASCADE,
            scopes jsonb NOT NULL,
            revoked_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (user_id, client_id)
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_oauth_codes (
            code_hash text PRIMARY KEY,
            client_id text NOT NULL REFERENCES layer_engine.auth_oauth_clients (client_id) ON DELETE CASCADE,
            user_id text NOT NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            redirect_uri text NOT NULL,
            scopes jsonb NOT NULL,
            code_challenge text NOT NULL,
            dpop_jkt text NULL,
            expires_at timestamptz NOT NULL,
            consumed_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.auth_oauth_access_tokens (
            token_hash text PRIMARY KEY,
            token_id text NOT NULL UNIQUE,
            client_id text NOT NULL REFERENCES layer_engine.auth_oauth_clients (client_id) ON DELETE CASCADE,
            user_id text NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            family_id text NULL,
            scopes jsonb NOT NULL,
            audience jsonb NOT NULL DEFAULT '[]'::jsonb,
            dpop_jkt text NULL,
            status text NOT NULL CHECK (status IN ('active', 'revoked')),
            expires_at timestamptz NOT NULL,
            revoked_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_auth_access_tokens_subject_idx
            ON layer_engine.auth_oauth_access_tokens (user_id, client_id, status, expires_at);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_oauth_refresh_tokens (
            token_hash text PRIMARY KEY,
            token_id text NOT NULL UNIQUE,
            family_id text NOT NULL,
            parent_token_id text NULL,
            client_id text NOT NULL REFERENCES layer_engine.auth_oauth_clients (client_id) ON DELETE CASCADE,
            user_id text NULL REFERENCES layer_engine.auth_users (user_id) ON DELETE CASCADE,
            scopes jsonb NOT NULL,
            dpop_jkt text NULL,
            status text NOT NULL CHECK (status IN ('active', 'rotated', 'revoked', 'reused')),
            expires_at timestamptz NOT NULL,
            consumed_at timestamptz NULL,
            revoked_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_auth_refresh_tokens_family_idx
            ON layer_engine.auth_oauth_refresh_tokens (family_id, status, expires_at);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_oidc_records (
            model_name text NOT NULL,
            record_id_hash text NOT NULL,
            payload_encrypted bytea NOT NULL,
            grant_id_hash text NULL,
            uid_hash text NULL,
            user_code_hash text NULL,
            expires_at timestamptz NULL,
            consumed_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (model_name, record_id_hash)
        );

        CREATE INDEX IF NOT EXISTS layer_auth_oidc_records_grant_idx
            ON layer_engine.auth_oidc_records (grant_id_hash);

        CREATE INDEX IF NOT EXISTS layer_auth_oidc_records_uid_idx
            ON layer_engine.auth_oidc_records (model_name, uid_hash);

        CREATE INDEX IF NOT EXISTS layer_auth_oidc_records_user_code_idx
            ON layer_engine.auth_oidc_records (model_name, user_code_hash);

        CREATE TABLE IF NOT EXISTS layer_engine.auth_mail_outbox (
            mail_id text PRIMARY KEY,
            template_name text NOT NULL,
            recipient_hash text NOT NULL,
            recipient_encrypted bytea NOT NULL,
            locale text NOT NULL,
            payload_encrypted bytea NOT NULL,
            status text NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
            attempts integer NOT NULL DEFAULT 0,
            next_attempt_at timestamptz NOT NULL DEFAULT now(),
            lease_owner text NULL,
            lease_until timestamptz NULL,
            last_error_code text NULL,
            sent_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_auth_mail_delivery_idx
            ON layer_engine.auth_mail_outbox (status, next_attempt_at, lease_until);
    `
});
