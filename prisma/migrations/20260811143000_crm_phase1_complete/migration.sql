ALTER TABLE "crm_deployments" ADD COLUMN "deployment_key" TEXT;
ALTER TABLE "crm_deployments" ADD COLUMN "heartbeat_secret_ref" TEXT;
CREATE UNIQUE INDEX "crm_deployments_tenant_id_instance_id_key" ON "crm_deployments"("tenant_id","instance_id");
CREATE UNIQUE INDEX "crm_deployments_tenant_id_deployment_key_key" ON "crm_deployments"("tenant_id","deployment_key");

CREATE TABLE "crm_contacts" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" BIGINT NOT NULL REFERENCES "crm_customers"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "role" TEXT, "email" TEXT, "phone" TEXT, "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "crm_plan_versions" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code" TEXT NOT NULL, "version" TEXT NOT NULL, "display_name" TEXT NOT NULL, "definition" JSONB NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "retired_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "crm_plan_versions_tenant_id_code_version_key" ON "crm_plan_versions"("tenant_id","code","version");
CREATE TABLE "crm_contracts" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" BIGINT NOT NULL REFERENCES "crm_customers"("id") ON DELETE CASCADE,
  "plan_version_id" BIGINT NOT NULL REFERENCES "crm_plan_versions"("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "starts_at" TIMESTAMP(3) NOT NULL, "ends_at" TIMESTAMP(3),
  "monthly_amount" DECIMAL(12,2), "billing_day" INTEGER, "limits_override" JSONB NOT NULL DEFAULT '{}',
  "additional_terms" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "crm_remote_services" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "service_type" TEXT NOT NULL, "base_url" TEXT, "version" TEXT, "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "details" JSONB NOT NULL DEFAULT '{}', "checked_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "crm_remote_services_tenant_id_deployment_id_service_type_key" ON "crm_remote_services"("tenant_id","deployment_id","service_type");
CREATE TABLE "crm_approvals" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "gate" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "requested_by" TEXT, "decided_by" TEXT,
  "decision_note" TEXT, "evidence_url" TEXT, "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "crm_approvals_tenant_id_deployment_id_gate_key" ON "crm_approvals"("tenant_id","deployment_id","gate");
CREATE TABLE "crm_health_snapshots" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "event_id" TEXT NOT NULL, "occurred_at" TIMESTAMP(3) NOT NULL, "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "overall_status" TEXT NOT NULL, "services" JSONB NOT NULL, "versions" JSONB NOT NULL DEFAULT '{}',
  "resources" JSONB NOT NULL DEFAULT '{}', "backup" JSONB NOT NULL DEFAULT '{}', "tls" JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX "crm_health_snapshots_tenant_id_event_id_key" ON "crm_health_snapshots"("tenant_id","event_id");
CREATE INDEX "crm_health_snapshots_tenant_id_deployment_id_occurred_at_idx" ON "crm_health_snapshots"("tenant_id","deployment_id","occurred_at" DESC);
CREATE TABLE "crm_usage_snapshots" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "event_id" TEXT NOT NULL, "period_start" TIMESTAMP(3) NOT NULL, "period_end" TIMESTAMP(3) NOT NULL,
  "conversations" INTEGER NOT NULL DEFAULT 0, "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
  "completion_tokens" BIGINT NOT NULL DEFAULT 0, "estimated_cost" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "audio_minutes" DECIMAL(12,2) NOT NULL DEFAULT 0, "tool_calls" INTEGER NOT NULL DEFAULT 0,
  "human_transfers" INTEGER NOT NULL DEFAULT 0, "errors" JSONB NOT NULL DEFAULT '{}',
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "crm_usage_snapshots_tenant_id_event_id_key" ON "crm_usage_snapshots"("tenant_id","event_id");
CREATE INDEX "crm_usage_snapshots_tenant_id_deployment_id_period_start_idx" ON "crm_usage_snapshots"("tenant_id","deployment_id","period_start");
CREATE TABLE "crm_maintenance_records" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL, "summary" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PLANNED', "responsible" TEXT,
  "scheduled_at" TIMESTAMP(3), "started_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3), "outcome" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "crm_contacts_tenant_id_customer_id_idx" ON "crm_contacts"("tenant_id","customer_id");
CREATE INDEX "crm_plan_versions_tenant_id_idx" ON "crm_plan_versions"("tenant_id");
CREATE INDEX "crm_contracts_tenant_id_customer_id_idx" ON "crm_contracts"("tenant_id","customer_id");
CREATE INDEX "crm_remote_services_tenant_id_idx" ON "crm_remote_services"("tenant_id");
CREATE INDEX "crm_approvals_tenant_id_idx" ON "crm_approvals"("tenant_id");
CREATE INDEX "crm_maintenance_records_tenant_id_deployment_id_idx" ON "crm_maintenance_records"("tenant_id","deployment_id");

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['crm_contacts','crm_plan_versions','crm_contracts','crm_remote_services','crm_approvals','crm_health_snapshots','crm_usage_snapshots','crm_maintenance_records']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.is_super_admin'', true) = ''on'' OR tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::bigint) WITH CHECK (current_setting(''app.is_super_admin'', true) = ''on'' OR tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::bigint)', t);
  END LOOP;
END $$;
ALTER TABLE "crm_customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_deployments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_remote_agents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_checklist_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_alerts" FORCE ROW LEVEL SECURITY;
