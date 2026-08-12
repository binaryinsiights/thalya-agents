import basePrisma from "@/api/lib/prisma";
import { AppError } from "@/lib/errors";
import { createCrmCustomer, getCrmWorkspace } from "@/modules/crm/service";
import type { VerifiedToken } from "./oauth/tokens";
import {
  err,
  gate,
  ok,
  readGate,
  recordMcpAudit,
  type WriteDeps,
  type WriteResult,
} from "./write";

function fail(error: unknown): WriteResult {
  if (error instanceof AppError) return err(error.message);
  throw error;
}

export async function crmWorkspaceGet(
  principal: VerifiedToken,
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const ctx = readGate(principal);
  if ("ok" in ctx) return ctx;
  try {
    return ok({
      workspace: await getCrmWorkspace(ctx, deps.base ?? basePrisma),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function crmCustomerCreate(
  principal: VerifiedToken,
  args: {
    name: string;
    plan: string;
    niche?: string;
    contact_name?: string;
    dry_run?: boolean;
  },
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const ctx = gate(principal);
  if ("ok" in ctx) return ctx;
  const preview = {
    name: args.name.trim(),
    plan: args.plan,
    niche: args.niche,
    contactName: args.contact_name,
  };
  if (args.dry_run !== false) {
    return ok({
      dryRun: true,
      action: "create",
      resource: "crm_customer",
      preview,
    });
  }
  try {
    const base = deps.base ?? basePrisma;
    const customer = await createCrmCustomer(ctx, preview, base);
    await recordMcpAudit(ctx, base, {
      actorId: principal.userId,
      actorType: "mcp",
      action: "mcp.crm_customer_create",
      target: `crm_customer:${customer.id}`,
      before: null,
      after: customer,
    });
    return ok({ dryRun: false, applied: true, customer });
  } catch (error) {
    return fail(error);
  }
}
