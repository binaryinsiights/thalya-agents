ALTER TABLE "crm_installation_profiles"
ADD COLUMN "ssh_passphrase_ref" TEXT,
ADD COLUMN "dns_mode" TEXT NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "crm_deployments"
ADD COLUMN "contract_id" BIGINT;

ALTER TABLE "crm_deployments"
ADD CONSTRAINT "crm_deployments_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "crm_contracts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "crm_deployments_tenant_id_contract_id_idx"
ON "crm_deployments"("tenant_id", "contract_id");
