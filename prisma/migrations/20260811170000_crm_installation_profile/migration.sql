CREATE TABLE "crm_installation_profiles" (
  "id" BIGSERIAL PRIMARY KEY,
  "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL UNIQUE REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "technical_owner" TEXT, "desired_delivery_at" TIMESTAMP(3),
  "provider" TEXT, "server_host" TEXT, "server_port" INTEGER NOT NULL DEFAULT 22,
  "server_user" TEXT, "ssh_credential_ref" TEXT, "operating_system" TEXT, "region" TEXT,
  "cpu_cores" INTEGER, "memory_mb" INTEGER, "disk_gb" INTEGER,
  "orchestrator" TEXT, "orchestrator_url" TEXT, "orchestrator_credential_ref" TEXT,
  "dns_provider" TEXT, "dns_zone" TEXT, "dns_credential_ref" TEXT,
  "agents_domain" TEXT, "chatwoot_domain" TEXT, "baileys_domain" TEXT, "langfuse_domain" TEXT,
  "acme_email" TEXT, "backup_provider" TEXT, "backup_destination" TEXT,
  "backup_credential_ref" TEXT, "registry_credential_ref" TEXT,
  "authorized" BOOLEAN NOT NULL DEFAULT false, "authorized_by" TEXT, "authorized_at" TIMESTAMP(3),
  "notes" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "crm_installation_profiles_tenant_id_idx" ON "crm_installation_profiles"("tenant_id");
ALTER TABLE "crm_installation_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_installation_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "crm_installation_profiles"
  USING (current_setting('app.is_super_admin', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint);
