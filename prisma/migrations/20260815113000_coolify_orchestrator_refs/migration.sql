ALTER TABLE "crm_installation_profiles"
  ADD COLUMN "coolify_project_uuid" TEXT,
  ADD COLUMN "coolify_environment_uuid" TEXT,
  ADD COLUMN "coolify_server_uuid" TEXT,
  ADD COLUMN "coolify_destination_uuid" TEXT;
