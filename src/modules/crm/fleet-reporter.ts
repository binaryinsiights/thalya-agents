import { randomUUID } from "node:crypto";
import logger from "@/api/lib/logger";
import basePrisma from "@/api/lib/prisma";
import { instanceIdentity } from "@/lib/instance";
import { asSuperAdminOn } from "@/lib/tenancy";
import { signOutbound } from "@/modules/webhooks/outbound/signing";

const controlUrl = (process.env.FLEET_CONTROL_URL ?? "").replace(/\/+$/, "");
const deploymentKey = process.env.FLEET_DEPLOYMENT_KEY ?? "";
const secret = process.env.FLEET_HEARTBEAT_SECRET ?? "";
const intervalMs = Math.max(
  Number(process.env.FLEET_REPORT_INTERVAL_MS ?? 60_000),
  30_000,
);
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function serviceStatus(url: string | undefined) {
  if (!url) return { status: "UNKNOWN" as const };
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    return {
      status: response.ok ? ("HEALTHY" as const) : ("DEGRADED" as const),
      baseUrl: new URL(url).origin,
    };
  } catch {
    return { status: "OFFLINE" as const, baseUrl: new URL(url).origin };
  }
}

async function buildPayload() {
  const periodEnd = new Date();
  const periodStart = new Date(
    periodEnd.getFullYear(),
    periodEnd.getMonth(),
    1,
  );
  const state = await asSuperAdminOn(basePrisma, async (db) => {
    const [agents, documents, integrations, usage, conversations] =
      await Promise.all([
        db.agent.findMany({
          select: {
            id: true,
            name: true,
            mode: true,
            enabled: true,
            updatedAt: true,
          },
        }),
        db.knowledgeDocument.groupBy({ by: ["status"], _count: true }),
        db.integrationInstance.count(),
        db.llmUsage.aggregate({
          where: { createdAt: { gte: periodStart } },
          _sum: { promptTokens: true, completionTokens: true, costUsd: true },
        }),
        db.conversation.count({ where: { createdAt: { gte: periodStart } } }),
      ]);
    return { agents, documents, integrations, usage, conversations };
  });
  const [chatwoot, baileys, langfuse] = await Promise.all([
    serviceStatus(process.env.FLEET_CHATWOOT_HEALTH_URL),
    serviceStatus(process.env.FLEET_BAILEYS_HEALTH_URL),
    serviceStatus(process.env.FLEET_LANGFUSE_HEALTH_URL),
  ]);
  return {
    eventId: randomUUID(),
    instanceId: instanceIdentity.instanceId,
    occurredAt: new Date().toISOString(),
    services: {
      agents: {
        status: "HEALTHY",
        version: instanceIdentity.version,
        baseUrl: process.env.PUBLIC_URL,
      },
      chatwoot,
      baileys,
      langfuse,
    },
    agents: state.agents.map((agent) => ({
      id: String(agent.id),
      name: agent.name,
      mode: agent.mode,
      status: agent.enabled ? "ACTIVE" : "INACTIVE",
      channels: [],
      integrations: Array.from(
        { length: state.integrations },
        (_, index) => `integration-${index + 1}`,
      ),
      knowledgeStatus: state.documents.some((item) => item.status === "FAILED")
        ? "ERROR"
        : "READY",
      knowledgeDocumentCount: state.documents.reduce(
        (total, item) => total + item._count,
        0,
      ),
      updatedAt: agent.updatedAt.toISOString(),
    })),
    usage: {
      eventId: `${instanceIdentity.instanceId}:${periodStart.toISOString()}`,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      conversations: state.conversations,
      promptTokens: Number(state.usage._sum.promptTokens ?? 0),
      completionTokens: Number(state.usage._sum.completionTokens ?? 0),
      estimatedCost: Number(state.usage._sum.costUsd ?? 0),
      audioMinutes: 0,
      toolCalls: 0,
      humanTransfers: 0,
      errors: {},
    },
  };
}

async function report() {
  if (running || !controlUrl || !deploymentKey || !secret) return;
  running = true;
  try {
    const body = JSON.stringify(await buildPayload());
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await fetch(
      `${controlUrl}/api/v1/crm/fleet/heartbeat/${encodeURIComponent(deploymentKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-secretaria-timestamp": String(timestamp),
          "x-secretaria-signature": signOutbound(secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      logger.warn({ status: response.status }, "Fleet heartbeat rejected");
  } catch (error) {
    logger.warn({ error }, "Fleet heartbeat failed");
  } finally {
    running = false;
  }
}

export function startFleetReporter() {
  if (!controlUrl || !deploymentKey || !secret || timer) return;
  void report();
  timer = setInterval(() => void report(), intervalMs);
  logger.info("Fleet reporter enabled");
}
export function stopFleetReporter() {
  if (timer) clearInterval(timer);
  timer = null;
}
