import { readFile } from "node:fs/promises";
import path from "node:path";
import logger from "@/api/lib/logger";
import type { TenantContext } from "@/lib/tenancy";
import { importAgent } from "./transfer";

// Customer images opt into this seed through the CRM provisioner. The template is bundled in the
// image and imported only after /setup, inside the real tenant.
export async function seedThalyaAgent(
  ctx: TenantContext,
): Promise<{ seeded: boolean; warning?: string }> {
  if (process.env.THALYA_SEED_AGENT !== "true") return { seeded: false };
  const file = path.join(
    process.cwd(),
    "docs",
    "crm",
    "templates",
    "thalya-base-agent.json",
  );
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    await importAgent(ctx, raw);
    logger.info(
      { tenantId: ctx.tenantId?.toString() },
      "Thalya base agent seeded",
    );
    return { seeded: true };
  } catch (error) {
    const warning =
      error instanceof Error ? error.message : "unknown seed error";
    logger.warn(
      { tenantId: ctx.tenantId?.toString(), warning },
      "Thalya base agent seed skipped",
    );
    return { seeded: false, warning };
  }
}
