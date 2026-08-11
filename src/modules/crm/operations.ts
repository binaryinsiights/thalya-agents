import type { Prisma, PrismaClient } from "@/../generated/prisma/client";
import basePrisma from "@/api/lib/prisma";
import { AppError, NotFoundError } from "@/lib/errors";
import { runScopedOn, type ScopedDb, type TenantContext } from "@/lib/tenancy";
import { recordAudit } from "@/modules/audit/service";
import { tryResolveVaultSecret } from "@/modules/vault/service";
import { CRM_ONBOARDING_TEMPLATE } from "./plans";

function tenant(ctx: TenantContext) {
  if (ctx.tenantId === null) throw new AppError("tenant required", 400);
  return ctx.tenantId;
}
function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}
function date(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const result = new Date(raw);
  if (Number.isNaN(result.getTime())) throw new AppError("invalid date", 400);
  return result;
}
function safe<T>(value: T): unknown {
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, safe(item)]),
    );
  return value;
}

const PROFILE_FIELDS = [
  "technicalOwner",
  "desiredDeliveryAt",
  "provider",
  "serverHost",
  "serverPort",
  "serverUser",
  "sshCredentialRef",
  "operatingSystem",
  "region",
  "cpuCores",
  "memoryMb",
  "diskGb",
  "orchestrator",
  "orchestratorUrl",
  "orchestratorCredentialRef",
  "dnsProvider",
  "dnsZone",
  "dnsCredentialRef",
  "agentsDomain",
  "chatwootDomain",
  "baileysDomain",
  "langfuseDomain",
  "acmeEmail",
  "backupProvider",
  "backupDestination",
  "backupCredentialRef",
  "registryCredentialRef",
  "authorized",
  "authorizedBy",
  "notes",
] as const;

export function installationReadiness(profile: Record<string, unknown> | null) {
  if (!profile) return { ready: false, percent: 0, missing: ["ficha técnica"] };
  const orchestrator = String(profile.orchestrator ?? "").toUpperCase();
  const required = [
    ["responsável técnico", profile.technicalOwner],
    ["data de entrega", profile.desiredDeliveryAt],
    ["provedor da VPS", profile.provider],
    ["host da VPS", profile.serverHost],
    ["sistema operacional", profile.operatingSystem],
    ["região", profile.region],
    ["CPU", profile.cpuCores],
    ["memória", profile.memoryMb],
    ["disco", profile.diskGb],
    ["orquestrador", profile.orchestrator],
    ["provedor DNS", profile.dnsProvider],
    ["zona DNS", profile.dnsZone],
    ["credencial DNS", profile.dnsCredentialRef],
    ["domínio Agents", profile.agentsDomain],
    ["domínio Chatwoot", profile.chatwootDomain],
    ["domínio Baileys", profile.baileysDomain],
    ["domínio Langfuse", profile.langfuseDomain],
    ["e-mail TLS", profile.acmeEmail],
    ["provedor de backup", profile.backupProvider],
    ["destino de backup", profile.backupDestination],
    ["credencial de backup", profile.backupCredentialRef],
    ["credencial do registry", profile.registryCredentialRef],
    ["autorização", profile.authorized],
    ...(orchestrator === "DOCKER_COMPOSE"
      ? [
          ["usuário SSH", profile.serverUser],
          ["credencial SSH", profile.sshCredentialRef],
        ]
      : [
          ["URL do orquestrador", profile.orchestratorUrl],
          ["credencial do orquestrador", profile.orchestratorCredentialRef],
        ]),
  ] as Array<[string, unknown]>;
  const missing = required
    .filter(([, value]) => !value)
    .map(([label]) => label);
  return {
    ready: missing.length === 0,
    percent: Math.round(
      ((required.length - missing.length) / required.length) * 100,
    ),
    missing,
  };
}

export function upsertInstallationProfile(
  ctx: TenantContext,
  deploymentId: bigint,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.installation_profile.updated",
    `deployment:${deploymentId}`,
    async (db) => {
      const deployment = await db.crmDeployment.findUnique({
        where: { id: deploymentId },
        select: { id: true },
      });
      if (!deployment) throw new NotFoundError("deployment not found");
      for (const key of [
        "sshCredentialRef",
        "orchestratorCredentialRef",
        "dnsCredentialRef",
        "backupCredentialRef",
        "registryCredentialRef",
      ] as const) {
        const ref = text(input[key]);
        if (ref && !(await tryResolveVaultSecret(db, ref))) {
          throw new AppError(
            `vault reference for ${key} is invalid or pending`,
            400,
          );
        }
      }
      const data: Record<string, unknown> = {};
      for (const key of PROFILE_FIELDS) {
        if (input[key] === undefined) continue;
        if (key === "desiredDeliveryAt") data[key] = date(input[key]);
        else if (["serverPort", "cpuCores", "memoryMb", "diskGb"].includes(key))
          data[key] = input[key] ? Number(input[key]) : null;
        else if (key === "authorized") {
          data.authorized =
            input.authorized === true ||
            input.authorized === "true" ||
            input.authorized === "on";
          data.authorizedAt = data.authorized ? new Date() : null;
        } else data[key] = text(input[key]);
      }
      const row = await db.crmInstallationProfile.upsert({
        where: { deploymentId },
        create: {
          ...data,
          tenantId: tenant(ctx),
          deploymentId,
        } as Prisma.CrmInstallationProfileUncheckedCreateInput,
        update: data,
      });
      return {
        ...row,
        readiness: installationReadiness(
          row as unknown as Record<string, unknown>,
        ),
      };
    },
    base,
  );
}
async function mutate<T>(
  ctx: TenantContext,
  action: string,
  target: string,
  fn: (db: ScopedDb) => Promise<T>,
  base: PrismaClient,
) {
  return runScopedOn(base, ctx, async (db) => {
    const result = await fn(db);
    await recordAudit(db, tenant(ctx), {
      actorId: ctx.userId,
      actorType: ctx.actorType,
      action,
      target,
      after: safe(result),
    });
    return safe(result);
  });
}

export function updateCustomer(
  ctx: TenantContext,
  id: bigint,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.customer.updated",
    `customer:${id}`,
    async (db) => {
      const changed = await db.crmCustomer.updateMany({
        where: { id },
        data: {
          ...(input.name !== undefined
            ? { name: String(input.name).trim() }
            : {}),
          ...(input.legalName !== undefined
            ? { legalName: text(input.legalName) }
            : {}),
          ...(input.document !== undefined
            ? { document: text(input.document) }
            : {}),
          ...(input.niche !== undefined ? { niche: text(input.niche) } : {}),
          ...(input.plan !== undefined ? { plan: String(input.plan) } : {}),
          ...(input.planVersion !== undefined
            ? { planVersion: String(input.planVersion) }
            : {}),
          ...(input.commercialStatus !== undefined
            ? { commercialStatus: String(input.commercialStatus) }
            : {}),
          ...(input.implementationStatus !== undefined
            ? { implementationStatus: String(input.implementationStatus) }
            : {}),
          ...(input.financialStatus !== undefined
            ? { financialStatus: String(input.financialStatus) }
            : {}),
          ...(input.supportStatus !== undefined
            ? { supportStatus: String(input.supportStatus) }
            : {}),
          ...(input.contractStart !== undefined
            ? { contractStart: date(input.contractStart) }
            : {}),
          ...(input.contractEnd !== undefined
            ? { contractEnd: date(input.contractEnd) }
            : {}),
          ...(input.notes !== undefined ? { notes: text(input.notes) } : {}),
        },
      });
      if (!changed.count) throw new NotFoundError("customer not found");
      return db.crmCustomer.findUniqueOrThrow({ where: { id } });
    },
    base,
  );
}
export function deleteCustomer(
  ctx: TenantContext,
  id: bigint,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.customer.deleted",
    `customer:${id}`,
    async (db) => {
      const changed = await db.crmCustomer.deleteMany({ where: { id } });
      if (!changed.count) throw new NotFoundError("customer not found");
      return { id };
    },
    base,
  );
}
export function createContact(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.contact.created",
    "contact",
    (db) =>
      db.crmContact.create({
        data: {
          tenantId: tenant(ctx),
          customerId: BigInt(String(input.customerId)),
          name: String(input.name),
          role: text(input.role),
          email: text(input.email),
          phone: text(input.phone),
          isPrimary: input.isPrimary === true || input.isPrimary === "true",
        },
      }),
    base,
  );
}
export function deleteContact(
  ctx: TenantContext,
  id: bigint,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.contact.deleted",
    `contact:${id}`,
    async (db) => {
      const changed = await db.crmContact.deleteMany({ where: { id } });
      if (!changed.count) throw new NotFoundError("contact not found");
      return { id };
    },
    base,
  );
}
export function createContract(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.contract.created",
    "contract",
    (db) =>
      db.crmContract.create({
        data: {
          tenantId: tenant(ctx),
          customerId: BigInt(String(input.customerId)),
          planVersionId: BigInt(String(input.planVersionId)),
          status: String(input.status ?? "ACTIVE"),
          startsAt: date(input.startsAt) ?? new Date(),
          endsAt: date(input.endsAt),
          monthlyAmount: text(input.monthlyAmount),
          billingDay: input.billingDay ? Number(input.billingDay) : null,
          limitsOverride: (input.limitsOverride ?? {}) as Prisma.InputJsonValue,
          additionalTerms: (input.additionalTerms ??
            {}) as Prisma.InputJsonValue,
        },
      }),
    base,
  );
}
export function updateContract(
  ctx: TenantContext,
  id: bigint,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.contract.updated",
    `contract:${id}`,
    (db) =>
      db.crmContract.update({
        where: { id },
        data: {
          ...(input.status !== undefined
            ? { status: String(input.status) }
            : {}),
          ...(input.endsAt !== undefined ? { endsAt: date(input.endsAt) } : {}),
          ...(input.monthlyAmount !== undefined
            ? { monthlyAmount: text(input.monthlyAmount) }
            : {}),
          ...(input.billingDay !== undefined
            ? { billingDay: input.billingDay ? Number(input.billingDay) : null }
            : {}),
        },
      }),
    base,
  );
}
export function updateDeployment(
  ctx: TenantContext,
  id: bigint,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.deployment.updated",
    `deployment:${id}`,
    (db) =>
      db.crmDeployment.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: String(input.name) } : {}),
          ...(input.instanceId !== undefined
            ? { instanceId: text(input.instanceId) }
            : {}),
          ...(input.deploymentKey !== undefined
            ? { deploymentKey: text(input.deploymentKey) }
            : {}),
          ...(input.heartbeatSecretRef !== undefined
            ? { heartbeatSecretRef: text(input.heartbeatSecretRef) }
            : {}),
          ...(input.status !== undefined
            ? { status: String(input.status) }
            : {}),
          ...(input.orchestrator !== undefined
            ? { orchestrator: text(input.orchestrator) }
            : {}),
          ...(input.region !== undefined ? { region: text(input.region) } : {}),
          ...(input.vpsProvider !== undefined
            ? { vpsProvider: text(input.vpsProvider) }
            : {}),
          ...(input.domain !== undefined ? { domain: text(input.domain) } : {}),
          ...(input.agentsUrl !== undefined
            ? { agentsUrl: text(input.agentsUrl) }
            : {}),
          ...(input.chatwootUrl !== undefined
            ? { chatwootUrl: text(input.chatwootUrl) }
            : {}),
          ...(input.langfuseUrl !== undefined
            ? { langfuseUrl: text(input.langfuseUrl) }
            : {}),
          ...(input.baileysUrl !== undefined
            ? { baileysUrl: text(input.baileysUrl) }
            : {}),
        },
      }),
    base,
  );
}
export function deleteDeployment(
  ctx: TenantContext,
  id: bigint,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.deployment.deleted",
    `deployment:${id}`,
    async (db) => {
      const changed = await db.crmDeployment.deleteMany({ where: { id } });
      if (!changed.count) throw new NotFoundError("deployment not found");
      return { id };
    },
    base,
  );
}
export function initializeOnboarding(
  ctx: TenantContext,
  deploymentId: bigint,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.onboarding.initialized",
    `deployment:${deploymentId}`,
    async (db) => {
      const count = await db.crmChecklistItem.count({
        where: { deploymentId },
      });
      if (count === 0)
        await db.crmChecklistItem.createMany({
          data: CRM_ONBOARDING_TEMPLATE.map(
            ([phase, key, title], position) => ({
              tenantId: tenant(ctx),
              deploymentId,
              phase,
              title,
              description: key,
              position,
            }),
          ),
        });
      for (const gate of [
        "INFRASTRUCTURE",
        "CONTENT",
        "HOMOLOGATION",
        "PRODUCTION",
      ]) {
        await db.crmApproval.upsert({
          where: {
            tenantId_deploymentId_gate: {
              tenantId: tenant(ctx),
              deploymentId,
              gate,
            },
          },
          create: {
            tenantId: tenant(ctx),
            deploymentId,
            gate,
            requestedBy: String(ctx.userId ?? ""),
          },
          update: {},
        });
      }
      return db.crmChecklistItem.findMany({
        where: { deploymentId },
        orderBy: { position: "asc" },
      });
    },
    base,
  );
}
export function decideApproval(
  ctx: TenantContext,
  id: bigint,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.approval.decided",
    `approval:${id}`,
    (db) =>
      db.crmApproval.update({
        where: { id },
        data: {
          status: String(input.status ?? "APPROVED"),
          decidedBy: String(ctx.userId ?? ""),
          decisionNote: text(input.decisionNote),
          evidenceUrl: text(input.evidenceUrl),
          decidedAt: new Date(),
        },
      }),
    base,
  );
}
export function createMaintenance(
  ctx: TenantContext,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.maintenance.created",
    "maintenance",
    (db) =>
      db.crmMaintenanceRecord.create({
        data: {
          tenantId: tenant(ctx),
          deploymentId: BigInt(String(input.deploymentId)),
          kind: String(input.kind),
          summary: String(input.summary),
          status: String(input.status ?? "PLANNED"),
          responsible: text(input.responsible),
          scheduledAt: date(input.scheduledAt),
        },
      }),
    base,
  );
}
export function updateMaintenance(
  ctx: TenantContext,
  id: bigint,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  return mutate(
    ctx,
    "crm.maintenance.updated",
    `maintenance:${id}`,
    (db) =>
      db.crmMaintenanceRecord.update({
        where: { id },
        data: {
          ...(input.status !== undefined
            ? { status: String(input.status) }
            : {}),
          ...(input.responsible !== undefined
            ? { responsible: text(input.responsible) }
            : {}),
          ...(input.outcome !== undefined
            ? { outcome: text(input.outcome) }
            : {}),
          ...(input.status === "IN_PROGRESS" ? { startedAt: new Date() } : {}),
          ...(input.status === "DONE" ? { completedAt: new Date() } : {}),
        },
      }),
    base,
  );
}
export function updateAlert(
  ctx: TenantContext,
  id: bigint,
  input: Record<string, unknown>,
  base = basePrisma,
) {
  const status = String(input.status ?? "ACKNOWLEDGED");
  return mutate(
    ctx,
    "crm.alert.updated",
    `alert:${id}`,
    (db) =>
      db.crmAlert.update({
        where: { id },
        data: {
          status,
          ...(status === "ACKNOWLEDGED" ? { acknowledgedAt: new Date() } : {}),
          ...(status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
        },
      }),
    base,
  );
}
