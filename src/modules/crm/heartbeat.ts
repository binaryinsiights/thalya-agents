import { z } from "zod";
import type { Prisma, PrismaClient } from "@/../generated/prisma/client";
import basePrisma from "@/api/lib/prisma";
import { AppError, UnauthorizedError } from "@/lib/errors";
import { asSuperAdminOn, runScopedOn, type TenantContext } from "@/lib/tenancy";
import { recordAudit } from "@/modules/audit/service";
import { tryResolveVaultSecret } from "@/modules/vault/service";
import { verifyOutboundSignature } from "@/modules/webhooks/outbound/signing";

const serviceState = z.enum(["HEALTHY", "DEGRADED", "OFFLINE", "UNKNOWN"]);
const heartbeatSchema = z.object({
  eventId: z.string().min(8).max(200),
  instanceId: z.string().min(1).max(200),
  occurredAt: z.iso.datetime(),
  services: z.record(
    z.enum(["agents", "chatwoot", "baileys", "langfuse"]),
    z.object({
      status: serviceState,
      version: z.string().max(100).optional(),
      baseUrl: z.url().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  resources: z
    .object({
      cpuPercent: z.number().min(0).max(100).optional(),
      memoryPercent: z.number().min(0).max(100).optional(),
      diskPercent: z.number().min(0).max(100).optional(),
      uptimeSeconds: z.number().min(0).optional(),
    })
    .optional(),
  tls: z
    .object({
      valid: z.boolean(),
      expiresAt: z.iso.datetime().optional(),
      daysRemaining: z.number().optional(),
    })
    .optional(),
  backup: z
    .object({
      status: z.enum(["SUCCESS", "FAILED", "LATE", "UNKNOWN"]),
      completedAt: z.iso.datetime().optional(),
      sizeBytes: z.number().min(0).optional(),
      destination: z.string().max(100).optional(),
      restoreTestedAt: z.iso.datetime().optional(),
    })
    .optional(),
  agents: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(200),
        plan: z.string().max(50).optional(),
        function: z.string().max(200).optional(),
        mode: z.string().max(50),
        status: z.string().max(50),
        channels: z.array(z.string().max(100)).max(20),
        knowledgeStatus: z.string().max(50).optional(),
        knowledgeDocumentCount: z.number().int().min(0).optional(),
        integrations: z.array(z.string().max(100)).max(100),
        template: z.string().max(100).optional(),
        updatedAt: z.iso.datetime().optional(),
      }),
    )
    .max(100)
    .optional(),
  usage: z
    .object({
      eventId: z.string().min(8).max(200),
      periodStart: z.iso.datetime(),
      periodEnd: z.iso.datetime(),
      conversations: z.number().int().min(0).default(0),
      promptTokens: z.number().int().min(0).default(0),
      completionTokens: z.number().int().min(0).default(0),
      estimatedCost: z.number().min(0).default(0),
      audioMinutes: z.number().min(0).default(0),
      toolCalls: z.number().int().min(0).default(0),
      humanTransfers: z.number().int().min(0).default(0),
      errors: z.record(z.string(), z.number().int().min(0)).default({}),
    })
    .optional(),
});

function overallStatus(services: z.infer<typeof heartbeatSchema>["services"]) {
  const states = Object.values(services).map((service) => service.status);
  if (states.includes("OFFLINE")) return "OFFLINE";
  if (states.includes("DEGRADED")) return "DEGRADED";
  if (states.every((state) => state === "HEALTHY")) return "HEALTHY";
  return "UNKNOWN";
}

async function upsertAlert(
  db: Parameters<typeof recordAudit>[0],
  tenantId: bigint,
  deploymentId: bigint,
  type: string,
  severity: string,
  title: string,
  active: boolean,
) {
  const existing = await db.crmAlert.findFirst({
    where: { deploymentId, type, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });
  if (active && !existing) {
    await db.crmAlert.create({
      data: {
        tenantId,
        deploymentId,
        type,
        severity,
        title,
        source: "FLEET_HEARTBEAT",
      },
    });
  } else if (!active && existing) {
    await db.crmAlert.update({
      where: { id: existing.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }
}

export async function receiveCrmHeartbeat(params: {
  deploymentKey: string;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  base?: PrismaClient;
}) {
  const base = params.base ?? basePrisma;
  const resolved = await asSuperAdminOn(base, (db) =>
    db.crmDeployment.findFirst({
      where: { deploymentKey: params.deploymentKey },
      select: { id: true, tenantId: true, heartbeatSecretRef: true },
    }),
  );
  if (!resolved?.heartbeatSecretRef || !params.signature || !params.timestamp)
    throw new UnauthorizedError();
  const heartbeatSecretRef = resolved.heartbeatSecretRef;
  const timestamp = Number(params.timestamp);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(Date.now() / 1000 - timestamp) > 300
  )
    throw new UnauthorizedError();
  const ctx: TenantContext = {
    tenantId: resolved.tenantId,
    userId: null,
    role: "TENANT_ADMIN",
    actorType: "api_key",
  };
  const secret = await runScopedOn(base, ctx, (db) =>
    tryResolveVaultSecret<string>(db, heartbeatSecretRef),
  );
  if (
    !secret ||
    !verifyOutboundSignature(
      secret,
      timestamp,
      params.rawBody,
      params.signature,
    )
  )
    throw new UnauthorizedError();
  let parsed: z.infer<typeof heartbeatSchema>;
  try {
    parsed = heartbeatSchema.parse(JSON.parse(params.rawBody));
  } catch {
    throw new AppError("invalid heartbeat payload", 400);
  }

  return runScopedOn(base, ctx, async (db) => {
    if (
      await db.crmHealthSnapshot.findFirst({
        where: { eventId: parsed.eventId },
        select: { id: true },
      })
    )
      return { outcome: "duplicate" as const };
    if (parsed.instanceId && parsed.instanceId !== "") {
      await db.crmDeployment.update({
        where: { id: resolved.id },
        data: {
          instanceId: parsed.instanceId,
          health: overallStatus(parsed.services),
          lastHeartbeatAt: new Date(),
          status: "ACTIVE",
        },
      });
    }
    await db.crmHealthSnapshot.create({
      data: {
        tenantId: resolved.tenantId,
        deploymentId: resolved.id,
        eventId: parsed.eventId,
        occurredAt: new Date(parsed.occurredAt),
        overallStatus: overallStatus(parsed.services),
        services: parsed.services as unknown as Prisma.InputJsonValue,
        versions: Object.fromEntries(
          Object.entries(parsed.services).map(([key, value]) => [
            key,
            value.version ?? "unknown",
          ]),
        ),
        resources: (parsed.resources ?? {}) as Prisma.InputJsonValue,
        backup: (parsed.backup ?? {}) as Prisma.InputJsonValue,
        tls: (parsed.tls ?? {}) as Prisma.InputJsonValue,
      },
    });
    for (const [serviceType, service] of Object.entries(parsed.services)) {
      await db.crmRemoteService.upsert({
        where: {
          tenantId_deploymentId_serviceType: {
            tenantId: resolved.tenantId,
            deploymentId: resolved.id,
            serviceType,
          },
        },
        create: {
          tenantId: resolved.tenantId,
          deploymentId: resolved.id,
          serviceType,
          status: service.status,
          version: service.version,
          baseUrl: service.baseUrl,
          details: (service.details ?? {}) as Prisma.InputJsonValue,
          checkedAt: new Date(),
        },
        update: {
          status: service.status,
          version: service.version,
          baseUrl: service.baseUrl,
          details: (service.details ?? {}) as Prisma.InputJsonValue,
          checkedAt: new Date(),
        },
      });
      await upsertAlert(
        db,
        resolved.tenantId,
        resolved.id,
        `SERVICE_${serviceType.toUpperCase()}_OFFLINE`,
        serviceType === "baileys" ? "CRITICAL" : "WARNING",
        `${serviceType} indisponível`,
        service.status === "OFFLINE",
      );
    }
    for (const agent of parsed.agents ?? []) {
      const existing = await db.crmRemoteAgent.findFirst({
        where: { deploymentId: resolved.id, remoteAgentId: agent.id },
      });
      const data = {
        name: agent.name,
        plan: agent.plan ?? "MANAGED",
        function: agent.function,
        mode: agent.mode,
        status: agent.status,
        channels: agent.channels as Prisma.InputJsonValue,
        knowledgeBases: [
          {
            status: agent.knowledgeStatus,
            documents: agent.knowledgeDocumentCount,
          },
        ] as Prisma.InputJsonValue,
        integrations: agent.integrations as Prisma.InputJsonValue,
        template: agent.template,
        lastChangedAt: agent.updatedAt ? new Date(agent.updatedAt) : null,
      };
      if (existing)
        await db.crmRemoteAgent.update({ where: { id: existing.id }, data });
      else
        await db.crmRemoteAgent.create({
          data: {
            tenantId: resolved.tenantId,
            deploymentId: resolved.id,
            remoteAgentId: agent.id,
            ...data,
          },
        });
    }
    if (
      parsed.usage &&
      !(await db.crmUsageSnapshot.findFirst({
        where: { eventId: parsed.usage.eventId },
      }))
    ) {
      await db.crmUsageSnapshot.create({
        data: {
          tenantId: resolved.tenantId,
          deploymentId: resolved.id,
          eventId: parsed.usage.eventId,
          periodStart: new Date(parsed.usage.periodStart),
          periodEnd: new Date(parsed.usage.periodEnd),
          conversations: parsed.usage.conversations,
          promptTokens: BigInt(parsed.usage.promptTokens),
          completionTokens: BigInt(parsed.usage.completionTokens),
          estimatedCost: parsed.usage.estimatedCost,
          audioMinutes: parsed.usage.audioMinutes,
          toolCalls: parsed.usage.toolCalls,
          humanTransfers: parsed.usage.humanTransfers,
          errors: parsed.usage.errors,
        },
      });
    }
    const disk = parsed.resources?.diskPercent ?? 0;
    await upsertAlert(
      db,
      resolved.tenantId,
      resolved.id,
      "DISK_HIGH",
      disk >= 90 ? "CRITICAL" : "WARNING",
      "Uso de disco elevado",
      disk >= 80,
    );
    await upsertAlert(
      db,
      resolved.tenantId,
      resolved.id,
      "BACKUP_FAILED",
      "CRITICAL",
      "Backup falhou ou está atrasado",
      ["FAILED", "LATE"].includes(parsed.backup?.status ?? ""),
    );
    await upsertAlert(
      db,
      resolved.tenantId,
      resolved.id,
      "TLS_EXPIRING",
      "WARNING",
      "Certificado TLS próximo do vencimento",
      (parsed.tls?.daysRemaining ?? 999) <= 30,
    );
    await recordAudit(db, resolved.tenantId, {
      actorType: "system",
      action: "crm.heartbeat.received",
      target: `deployment:${resolved.id}`,
      after: {
        eventId: parsed.eventId,
        status: overallStatus(parsed.services),
      },
    });
    return { outcome: "accepted" as const };
  });
}
