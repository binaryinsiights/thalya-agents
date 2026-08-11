CREATE TABLE "crm_provision_runs" (
  "id" BIGSERIAL PRIMARY KEY,
  "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "phase" TEXT NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT,
  "error" TEXT,
  "logs" JSONB NOT NULL DEFAULT '[]',
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "crm_installation_profiles"
ADD COLUMN "langfuse_admin_email" TEXT,
ADD COLUMN "langfuse_admin_password_ref" TEXT;

CREATE INDEX "crm_provision_runs_tenant_id_idx"
ON "crm_provision_runs"("tenant_id");
CREATE INDEX "crm_provision_runs_tenant_id_deployment_id_created_at_idx"
ON "crm_provision_runs"("tenant_id", "deployment_id", "created_at");

ALTER TABLE "crm_provision_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_provision_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "crm_provision_runs"
  USING (current_setting('app.is_super_admin', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint);
