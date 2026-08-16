import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/../generated/prisma/client";
import basePrisma from "@/api/lib/prisma";
import { AppError, NotFoundError } from "@/lib/errors";
import { runScopedOn, type TenantContext } from "@/lib/tenancy";
import { createVaultEntry } from "@/modules/vault/service";
import { installationReadiness } from "./operations";
import { CRM_PLAN_DEFINITIONS } from "./plans";

export const CRM_PLANS = CRM_PLAN_DEFINITIONS.map((plan) => ({
  id: plan.planCode,
  name: plan.displayName,
  version: plan.version,
  channels: plan.limits.channels,
  definition: plan,
}));

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
    const currentTenantId = tenantId(ctx);
    for (const plan of CRM_PLAN_DEFINITIONS) {
      await db.crmPlanVersion.upsert({
        where: {
          tenantId_code_version: {
            tenantId: currentTenantId,
            code: plan.planCode,
            version: plan.version,
          },
        },
        create: {
          tenantId: currentTenantId,
          code: plan.planCode,
          version: plan.version,
          displayName: plan.displayName,
          definition: plan as unknown as Prisma.InputJsonValue,
        },
        update: {},
      });
    }
    const [
      customers,
      deployments,
      agents,
      checklist,
      alerts,
      planVersions,
      contacts,
      contracts,
      services,
      approvals,
      healthSnapshots,
      usageSnapshots,
      maintenance,
      audit,
      localAgents,
      installationProfiles,
      provisionRuns,
    ] = await Promise.all([
      db.crmCustomer.findMany({
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { deployments: true } } },
      }),
      db.crmDeployment.findMany({
        orderBy: { updatedAt: "desc" },
        include: {
          customer: { select: { id: true, name: true, plan: true } },
          contract: {
            select: {
              id: true,
              status: true,
              planVersion: { select: { displayName: true, version: true } },
            },
          },
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
      db.crmPlanVersion.findMany({
        orderBy: [{ code: "asc" }, { publishedAt: "desc" }],
      }),
      db.crmContact.findMany({
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      }),
      db.crmContract.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { name: true } },
          planVersion: {
            select: {
              code: true,
              version: true,
              displayName: true,
              definition: true,
            },
          },
        },
      }),
      db.crmRemoteService.findMany({
        orderBy: [{ deploymentId: "asc" }, { serviceType: "asc" }],
      }),
      db.crmApproval.findMany({ orderBy: { requestedAt: "desc" } }),
      db.crmHealthSnapshot.findMany({
        orderBy: { occurredAt: "desc" },
        take: 200,
      }),
      db.crmUsageSnapshot.findMany({
        orderBy: { periodStart: "desc" },
        take: 200,
      }),
      db.crmMaintenanceRecord.findMany({ orderBy: { createdAt: "desc" } }),
      db.auditLog.findMany({
        where: { action: { startsWith: "crm." } },
        orderBy: { id: "desc" },
        take: 200,
      }),
      db.agent.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          enabled: true,
          mode: true,
          updatedAt: true,
        },
      }),
      db.crmInstallationProfile.findMany({ orderBy: { updatedAt: "desc" } }),
      db.crmProvisionRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
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
      localAgents: localAgents.map((agent) =>
        json({
          ...agent,
          source: "LOCAL",
          status: agent.enabled ? "ACTIVE" : "INACTIVE",
          deepLink: `/agents/${agent.id}/general`,
        }),
      ),
      installationProfiles: installationProfiles.map((profile) =>
        json({
          ...profile,
          readiness: installationReadiness(
            profile as unknown as Record<string, unknown>,
          ),
        }),
      ),
      provisionRuns: provisionRuns.map(json),
      checklist: checklist.map(json),
      alerts: alerts.map(json),
      planVersions: planVersions.map(json),
      contacts: contacts.map(json),
      contracts: contracts.map(json),
      services: services.map(json),
      approvals: approvals.map(json),
      healthSnapshots: healthSnapshots.map(json),
      usageSnapshots: usageSnapshots.map(json),
      maintenance: maintenance.map(json),
      audit: audit.map(json),
    };
  });
}

function parsePlanDefinition(input: unknown): Prisma.InputJsonValue {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AppError("definition must be a JSON object", 400);
  const definition = input as Record<string, unknown>;
  if (!definition.limits || typeof definition.limits !== "object")
    throw new AppError("definition.limits is required", 400);
  if (!definition.features || typeof definition.features !== "object")
    throw new AppError("definition.features is required", 400);
  return definition as Prisma.InputJsonValue;
}

/** Creates a new immutable catalog version. Existing versions are never edited. */
export async function createCrmPlanVersion(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base: PrismaClient = basePrisma,
) {
  const code = String(input.code ?? "").trim().toUpperCase();
  const version = String(input.version ?? "").trim();
  const displayName = String(input.displayName ?? "").trim();
  if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(code))
    throw new AppError("invalid plan code", 400);
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new AppError("version must use semantic versioning", 400);
  if (!displayName) throw new AppError("displayName is required", 400);
  const definition = parsePlanDefinition(input.definition);
  const row = await runScopedOn(base, ctx, async (db) => {
    const existing = await db.crmPlanVersion.findUnique({
      where: { tenantId_code_version: { tenantId: tenantId(ctx), code, version } },
      select: { id: true },
    });
    if (existing) throw new AppError("plan version already exists", 409);
    return db.crmPlanVersion.create({
      data: {
        tenantId: tenantId(ctx),
        code,
        version,
        displayName,
        definition,
      },
    });
  });
  return json(row);
}

/** Archives a catalog version for new contracts without deleting historical data. */
export async function retireCrmPlanVersion(
  ctx: TenantContext,
  id: bigint,
  base: PrismaClient = basePrisma,
) {
  const row = await runScopedOn(base, ctx, async (db) => {
    const current = await db.crmPlanVersion.findFirst({
      where: { id },
      include: { _count: { select: { contracts: true } } },
    });
    if (!current) throw new NotFoundError("plan version not found");
    return db.crmPlanVersion.update({
      where: { id },
      data: { retiredAt: current.retiredAt ? null : new Date() },
    });
  });
  return json(row);
}

export async function createCrmCustomer(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base: PrismaClient = basePrisma,
) {
  const name = String(input.name ?? "").trim();
  const plan = String(input.plan ?? "").trim();
  if (!name || !plan) throw new AppError("name and plan are required", 400);
  if (!CRM_PLAN_DEFINITIONS.some((item) => item.planCode === plan))
    throw new AppError(`unknown plan ${plan}`, 400);
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
  const name = String(input.name ?? "").trim();
  if (!name) throw new AppError("name is required", 400);
  const requestedContractId = String(input.contractId ?? "").trim();
  const requestedCustomerId = String(input.customerId ?? "").trim();
  const manifest = input.manifest;
  if (manifest !== undefined) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
      throw new AppError("manifest must be an object", 400);
    const value = manifest as Record<string, unknown>;
    const infrastructure = value.infrastructure as Record<string, unknown> | undefined;
    const agent = value.agent as Record<string, unknown> | undefined;
    if (!value.customer || !value.plan || !infrastructure || !agent)
      throw new AppError("manifest must include customer, plan, infrastructure and agent", 400);
    const manifestPlan = String((value.plan as Record<string, unknown>).code ?? "");
    if (!CRM_PLAN_DEFINITIONS.some((item) => item.planCode === manifestPlan))
      throw new AppError(`unknown manifest plan ${manifestPlan}`, 400);
    if (!["DOCKER_COMPOSE", "COOLIFY"].includes(String(infrastructure.orchestrator ?? "").toUpperCase()))
      throw new AppError("manifest orchestrator must be DOCKER_COMPOSE or COOLIFY", 400);
    if (!agent.templateId || !agent.templateVersion)
      throw new AppError("manifest agent template is incomplete", 400);
  }
  const contractId = requestedContractId ? BigInt(requestedContractId) : null;
  const customerId = await runScopedOn(base, ctx, async (db) => {
    if (contractId !== null) {
      const contract = await db.crmContract.findUnique({
        where: { id: contractId },
        select: { customerId: true },
      });
      if (!contract) throw new NotFoundError("contract not found");
      return contract.customerId;
    }
    if (!requestedCustomerId) {
      throw new AppError(
        "customerId is required when no contract is attached",
        400,
      );
    }
    const customer = await db.crmCustomer.findUnique({
      where: { id: BigInt(requestedCustomerId) },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError("customer not found");
    return customer.id;
  });
  const generated = !input.heartbeatSecretRef;
  const deploymentKey = String(input.deploymentKey ?? randomUUID());
  const heartbeatSecret = generated ? randomBytes(32).toString("hex") : null;
  const heartbeatSecretRef = generated
    ? (
        await createVaultEntry(
          ctx,
          {
            name: `fleet-heartbeat-${deploymentKey}`,
            value: heartbeatSecret as string,
            kind: "generic",
          },
          undefined,
          undefined,
          base,
        )
      ).ref
    : String(input.heartbeatSecretRef);
  const row = await runScopedOn(base, ctx, async (db) => {
    return db.crmDeployment.create({
      data: {
        tenantId: tenantId(ctx),
        customerId,
        contractId,
        name,
        deploymentKey,
        instanceId: input.instanceId ? String(input.instanceId) : null,
        heartbeatSecretRef,
        environment: String(input.environment ?? "PRODUCTION"),
        status: String(input.status ?? "PLANNED"),
        orchestrator: input.orchestrator ? String(input.orchestrator) : null,
        vpsProvider: input.vpsProvider ? String(input.vpsProvider) : null,
        domain: input.domain ? String(input.domain) : null,
        agentsUrl: input.agentsUrl ? String(input.agentsUrl) : null,
        chatwootUrl: input.chatwootUrl ? String(input.chatwootUrl) : null,
        langfuseUrl: input.langfuseUrl ? String(input.langfuseUrl) : null,
        baileysUrl: input.baileysUrl ? String(input.baileysUrl) : null,
        metadata: ({
          ...((input.metadata ?? {}) as Record<string, unknown>),
          ...(manifest !== undefined ? { provisionManifest: manifest } : {}),
        }) as Prisma.InputJsonValue,
      },
    });
  });
  return {
    ...json(row),
    fleetConfig: heartbeatSecret
      ? {
          controlUrl: process.env.PUBLIC_URL ?? "",
          deploymentKey,
          heartbeatSecret,
        }
      : null,
  };
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
  const row = await runScopedOn(base, ctx, async (db) => {
    const deployment = await db.crmDeployment.findUnique({
      where: { id: deploymentId },
      include: { customer: { select: { plan: true } }, _count: { select: { remoteAgents: true } } },
    });
    if (!deployment) throw new NotFoundError("deployment not found");
    const planDefinition = CRM_PLAN_DEFINITIONS.find((item) => item.planCode === deployment.customer.plan);
    if (!planDefinition) throw new AppError(`unknown plan ${deployment.customer.plan}`, 400);
    if (deployment._count.remoteAgents >= planDefinition.limits.agents)
      throw new AppError(`plan ${planDefinition.planCode} allows ${planDefinition.limits.agents} agents`, 409);
    const channels = Array.isArray(input.channels) ? input.channels : [];
    if (channels.length > planDefinition.limits.channels)
      throw new AppError(`plan ${planDefinition.planCode} allows ${planDefinition.limits.channels} channels`, 409);
    return db.crmRemoteAgent.create({
      data: {
        tenantId: tenantId(ctx),
        deploymentId,
        name,
        plan: planDefinition.planCode,
        function: input.function ? String(input.function) : null,
        mode: String(input.mode ?? "TEST"),
        status: String(input.status ?? "INACTIVE"),
        template: input.template ? String(input.template) : null,
        channels: channels as Prisma.InputJsonValue,
        integrations: (input.integrations ?? []) as Prisma.InputJsonValue,
        knowledgeBases: (input.knowledgeBases ?? []) as Prisma.InputJsonValue,
      },
    });
  });
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
