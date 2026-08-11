CREATE TABLE "crm_customers" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "legal_name" TEXT, "document" TEXT, "niche" TEXT,
  "contact_name" TEXT, "contact_email" TEXT, "contact_phone" TEXT,
  "plan" TEXT NOT NULL, "plan_version" TEXT NOT NULL DEFAULT '1',
  "commercial_status" TEXT NOT NULL DEFAULT 'LEAD', "implementation_status" TEXT NOT NULL DEFAULT 'PENDING',
  "financial_status" TEXT NOT NULL DEFAULT 'PENDING', "support_status" TEXT NOT NULL DEFAULT 'NORMAL',
  "contract_start" TIMESTAMP(3), "contract_end" TIMESTAMP(3), "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "crm_deployments" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" BIGINT NOT NULL REFERENCES "crm_customers"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "instance_id" TEXT, "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
  "orchestrator" TEXT, "region" TEXT, "vps_provider" TEXT, "domain" TEXT,
  "agents_url" TEXT, "chatwoot_url" TEXT, "langfuse_url" TEXT, "baileys_url" TEXT,
  "agents_version" TEXT, "chatwoot_version" TEXT, "langfuse_version" TEXT, "baileys_version" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PLANNED', "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "last_heartbeat_at" TIMESTAMP(3), "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "crm_remote_agents" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "remote_agent_id" TEXT, "name" TEXT NOT NULL, "function" TEXT, "mode" TEXT NOT NULL DEFAULT 'TEST',
  "status" TEXT NOT NULL DEFAULT 'INACTIVE', "plan" TEXT NOT NULL, "template" TEXT,
  "channels" JSONB NOT NULL DEFAULT '[]', "knowledge_bases" JSONB NOT NULL DEFAULT '[]',
  "integrations" JSONB NOT NULL DEFAULT '[]', "usage" JSONB NOT NULL DEFAULT '{}', "deep_link" TEXT,
  "last_changed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "crm_checklist_items" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT NOT NULL REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "phase" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "responsible" TEXT, "evidence_url" TEXT, "blocker" TEXT, "approved_by" TEXT, "approved_at" TIMESTAMP(3),
  "position" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "crm_alerts" (
  "id" BIGSERIAL PRIMARY KEY, "tenant_id" BIGINT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "deployment_id" BIGINT REFERENCES "crm_deployments"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL, "severity" TEXT NOT NULL DEFAULT 'WARNING', "title" TEXT NOT NULL,
  "description" TEXT, "status" TEXT NOT NULL DEFAULT 'OPEN', "source" TEXT,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "acknowledged_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "crm_customers_tenant_id_idx" ON "crm_customers"("tenant_id");
CREATE INDEX "crm_customers_tenant_id_commercial_status_idx" ON "crm_customers"("tenant_id","commercial_status");
CREATE INDEX "crm_deployments_tenant_id_idx" ON "crm_deployments"("tenant_id");
CREATE INDEX "crm_deployments_tenant_id_customer_id_idx" ON "crm_deployments"("tenant_id","customer_id");
CREATE INDEX "crm_remote_agents_tenant_id_idx" ON "crm_remote_agents"("tenant_id");
CREATE INDEX "crm_remote_agents_tenant_id_deployment_id_idx" ON "crm_remote_agents"("tenant_id","deployment_id");
CREATE INDEX "crm_checklist_items_tenant_id_idx" ON "crm_checklist_items"("tenant_id");
CREATE INDEX "crm_checklist_items_tenant_id_deployment_id_position_idx" ON "crm_checklist_items"("tenant_id","deployment_id","position");
CREATE INDEX "crm_alerts_tenant_id_idx" ON "crm_alerts"("tenant_id");
CREATE INDEX "crm_alerts_tenant_id_status_idx" ON "crm_alerts"("tenant_id","status");
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['crm_customers','crm_deployments','crm_remote_agents','crm_checklist_items','crm_alerts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.is_super_admin'', true) = ''on'' OR tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::bigint) WITH CHECK (current_setting(''app.is_super_admin'', true) = ''on'' OR tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::bigint)', t);
  END LOOP;
END $$;
