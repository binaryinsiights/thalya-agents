import logger from "@/api/lib/logger";
import basePrisma from "@/api/lib/prisma";
import { asSuperAdminOn } from "@/lib/tenancy";
import { CRM_PLAN_DEFINITIONS } from "./plans";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function reconcileAlert(
  db: Parameters<Parameters<typeof asSuperAdminOn>[1]>[0],
  deployment: { id: bigint; tenantId: bigint },
  type: string,
  severity: string,
  title: string,
  active: boolean,
) {
  const current = await db.crmAlert.findFirst({
    where: {
      deploymentId: deployment.id,
      type,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  if (active && !current)
    await db.crmAlert.create({
      data: {
        tenantId: deployment.tenantId,
        deploymentId: deployment.id,
        type,
        severity,
        title,
        source: "CRM_MONITOR",
      },
    });
  if (!active && current)
    await db.crmAlert.update({
      where: { id: current.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await asSuperAdminOn(basePrisma, async (db) => {
      const deployments = await db.crmDeployment.findMany({
        where: { status: "ACTIVE" },
        include: {
          customer: { select: { plan: true } },
          usageSnapshots: { orderBy: { periodStart: "desc" }, take: 1 },
        },
      });
      const offlineBefore = Date.now() - 3 * 60_000;
      for (const deployment of deployments) {
        await reconcileAlert(
          db,
          deployment,
          "HEARTBEAT_MISSING",
          "CRITICAL",
          "Instalação sem heartbeat",
          !deployment.lastHeartbeatAt ||
            deployment.lastHeartbeatAt.getTime() < offlineBefore,
        );
        if (
          deployment.lastHeartbeatAt &&
          deployment.lastHeartbeatAt.getTime() < offlineBefore &&
          deployment.health !== "OFFLINE"
        ) {
          await db.crmDeployment.update({
            where: { id: deployment.id },
            data: { health: "OFFLINE" },
          });
        }
        const plan = CRM_PLAN_DEFINITIONS.find((item) =>
          deployment.customer.plan.includes(item.planCode),
        );
        const usage = deployment.usageSnapshots[0];
        if (plan && usage) {
          const ratio = usage.conversations / plan.limits.monthlyConversations;
          for (const threshold of [0.8, 1, 1.2]) {
            const percent = Math.round(threshold * 100);
            await reconcileAlert(
              db,
              deployment,
              `PLAN_CONSUMPTION_${percent}`,
              threshold >= 1 ? "CRITICAL" : "WARNING",
              `Consumo do plano atingiu ${percent}%`,
              ratio >= threshold,
            );
          }
        }
      }
      const retention = new Date(Date.now() - 90 * 86_400_000);
      await db.crmHealthSnapshot.deleteMany({
        where: { occurredAt: { lt: retention } },
      });
      await db.crmUsageSnapshot.deleteMany({
        where: { periodEnd: { lt: retention } },
      });
    });
  } catch (error) {
    logger.warn({ error }, "CRM monitor tick failed");
  } finally {
    running = false;
  }
}

export function startCrmMonitor() {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), 60_000);
}
export function stopCrmMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}
