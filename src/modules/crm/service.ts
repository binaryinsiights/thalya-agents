import type { Prisma, PrismaClient } from "@/../generated/prisma/client";
import basePrisma from "@/api/lib/prisma";
import { AppError, NotFoundError } from "@/lib/errors";
import { runScopedOn, type TenantContext } from "@/lib/tenancy";

export const CRM_PLANS = [
  { id: "THALYA_ESSENCIAL", name: "Thalya Essencial", channels: 1 },
  { id: "THALYA_PROFISSIONAL", name: "Thalya Profissional", channels: 2 },
  { id: "THALYA_INTELIGENTE", name: "Thalya Inteligente", channels: 4 },
] as const;

function tenantId(ctx: TenantContext): bigint {
  if (ctx.tenantId === null) throw new AppError("tenant required", 400);
  return ctx.tenantId;
}
type JsonSafe<T> = T extends bigint
  ? string
  : T extends Date
    ? Date
    : T extends Array<infer U>
      ? JsonSafe<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : T;

function json<T>(value: T): JsonSafe<T> {
  if (typeof value === "bigint") return String(value) as JsonSafe<T>;
  if (value instanceof Date) return value as JsonSafe<T>;
  if (Array.isArray(value)) return value.map(json) as JsonSafe<T>;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, json(item)]),
    ) as JsonSafe<T>;
  }
  return value as JsonSafe<T>;
}

export async function getCrmWorkspace(
  ctx: TenantContext,
  base: PrismaClient = basePrisma,
) {
  return runScopedOn(base, ctx, async (db) => {
    const [customers, deployments, agents, checklist, alerts] =
      await Promise.all([
        db.crmCustomer.findMany({
          orderBy: { updatedAt: "desc" },
          include: { _count: { select: { deployments: true } } },
        }),
        db.crmDeployment.findMany({
          orderBy: { updatedAt: "desc" },
          include: {
            customer: { select: { id: true, name: true, plan: true } },
            _count: {
              select: {
                remoteAgents: true,
                checklistItems: true,
                alerts: true,
              },
            },
          },
        }),
        db.crmRemoteAgent.findMany({
          orderBy: { updatedAt: "desc" },
          include: {
            deployment: {
              select: {
                id: true,
                name: true,
                customer: { select: { name: true } },
              },
            },
          },
        }),
        db.crmChecklistItem.findMany({
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: {
            deployment: {
              select: { name: true, customer: { select: { name: true } } },
            },
          },
        }),
        db.crmAlert.findMany({
          orderBy: { openedAt: "desc" },
          include: {
            deployment: {
              select: { name: true, customer: { select: { name: true } } },
            },
          },
        }),
      ]);
    return {
      plans: CRM_PLANS,
      summary: {
        customers: customers.length,
        activeCustomers: customers.filter(
          (x) => x.commercialStatus === "ACTIVE",
        ).length,
        deployments: deployments.length,
        healthyDeployments: deployments.filter((x) => x.health === "HEALTHY")
          .length,
        activeAgents: agents.filter((x) => x.status === "ACTIVE").length,
        openAlerts: alerts.filter((x) => x.status === "OPEN").length,
        pendingChecklist: checklist.filter((x) => x.status !== "DONE").length,
      },
      customers: customers.map(json),
      deployments: deployments.map(json),
      agents: agents.map(json),
      checklist: checklist.map(json),
      alerts: alerts.map(json),
    };
  });
}

export async function createCrmCustomer(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base: PrismaClient = basePrisma,
) {
  const name = String(input.name ?? "").trim();
  const plan = String(input.plan ?? "").trim();
  if (!name || !plan) throw new AppError("name and plan are required", 400);
  const row = await runScopedOn(base, ctx, (db) =>
    db.crmCustomer.create({
      data: {
        tenantId: tenantId(ctx),
        name,
        plan,
        legalName: input.legalName ? String(input.legalName) : null,
        document: input.document ? String(input.document) : null,
        niche: input.niche ? String(input.niche) : null,
        contactName: input.contactName ? String(input.contactName) : null,
        contactEmail: input.contactEmail ? String(input.contactEmail) : null,
        contactPhone: input.contactPhone ? String(input.contactPhone) : null,
        commercialStatus: String(input.commercialStatus ?? "LEAD"),
        notes: input.notes ? String(input.notes) : null,
      },
    }),
  );
  return json(row);
}

export async function createCrmDeployment(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base: PrismaClient = basePrisma,
) {
  const customerId = BigInt(String(input.customerId ?? "0"));
  const name = String(input.name ?? "").trim();
  if (!name || customerId <= 0n)
    throw new AppError("customerId and name are required", 400);
  const row = await runScopedOn(base, ctx, async (db) => {
    if (
      !(await db.crmCustomer.findUnique({
        where: { id: customerId },
        select: { id: true },
      }))
    )
      throw new NotFoundError("customer not found");
    return db.crmDeployment.create({
      data: {
        tenantId: tenantId(ctx),
        customerId,
        name,
        status: String(input.status ?? "PLANNED"),
        orchestrator: input.orchestrator ? String(input.orchestrator) : null,
        vpsProvider: input.vpsProvider ? String(input.vpsProvider) : null,
        domain: input.domain ? String(input.domain) : null,
        agentsUrl: input.agentsUrl ? String(input.agentsUrl) : null,
        chatwootUrl: input.chatwootUrl ? String(input.chatwootUrl) : null,
        langfuseUrl: input.langfuseUrl ? String(input.langfuseUrl) : null,
        baileysUrl: input.baileysUrl ? String(input.baileysUrl) : null,
      },
    });
  });
  return json(row);
}

export async function createCrmAgent(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base: PrismaClient = basePrisma,
) {
  const deploymentId = BigInt(String(input.deploymentId ?? "0"));
  const name = String(input.name ?? "").trim();
  const plan = String(input.plan ?? "").trim();
  if (!name || !plan || deploymentId <= 0n)
    throw new AppError("deploymentId, name and plan are required", 400);
  const row = await runScopedOn(base, ctx, (db) =>
    db.crmRemoteAgent.create({
      data: {
        tenantId: tenantId(ctx),
        deploymentId,
        name,
        plan,
        function: input.function ? String(input.function) : null,
        mode: String(input.mode ?? "TEST"),
        status: String(input.status ?? "INACTIVE"),
        template: input.template ? String(input.template) : null,
        channels: (input.channels ?? []) as Prisma.InputJsonValue,
        integrations: (input.integrations ?? []) as Prisma.InputJsonValue,
        knowledgeBases: (input.knowledgeBases ?? []) as Prisma.InputJsonValue,
      },
    }),
  );
  return json(row);
}

export async function createChecklistItem(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base: PrismaClient = basePrisma,
) {
  const row = await runScopedOn(base, ctx, (db) =>
    db.crmChecklistItem.create({
      data: {
        tenantId: tenantId(ctx),
        deploymentId: BigInt(String(input.deploymentId)),
        phase: String(input.phase ?? "PREPARATION"),
        title: String(input.title),
        description: input.description ? String(input.description) : null,
        responsible: input.responsible ? String(input.responsible) : null,
        position: Number(input.position ?? 0),
      },
    }),
  );
  return json(row);
}

export async function updateChecklistItem(
  ctx: TenantContext,
  id: bigint,
  input: Record<string, unknown>,
  base: PrismaClient = basePrisma,
) {
  const row = await runScopedOn(base, ctx, (db) =>
    db.crmChecklistItem.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: String(input.status) } : {}),
        ...(input.responsible !== undefined
          ? { responsible: String(input.responsible) }
          : {}),
        ...(input.blocker !== undefined
          ? { blocker: String(input.blocker) || null }
          : {}),
        ...(input.evidenceUrl !== undefined
          ? { evidenceUrl: String(input.evidenceUrl) || null }
          : {}),
        ...(input.approvedBy !== undefined
          ? { approvedBy: String(input.approvedBy), approvedAt: new Date() }
          : {}),
      },
    }),
  );
  return json(row);
}
