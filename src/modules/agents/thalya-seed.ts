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
  // The customer image carries the approved Binary template in the image. The
  // template is intentionally imported only after the first administrator runs
  // /setup, so no customer secret is needed during infrastructure provisioning.
  // Until dedicated exports are bundled, the Maria/Thalya aliases use the same
  // reviewed operational base and can still override the display name.
  const templateId = (process.env.BINARY_AGENT_TEMPLATE_ID ?? "thalya")
    .trim()
    .toLowerCase();
  const templateFiles: Record<string, string> = {
    thalya: "thalya-base-agent.json",
    "thalya-base": "thalya-base-agent.json",
    maria: "thalya-base-agent.json",
    "maria-clinica": "thalya-base-agent.json",
  };

  const enabled = (name: string, fallback = false) =>
    (process.env[name] ?? String(fallback)).toLowerCase() === "true";
  let planFeatures: Record<string, unknown> = {};
  try {
    const encoded = process.env.BINARY_PLAN_DEFINITION_B64;
    if (encoded) {
      const definition = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown>;
      planFeatures = (definition.features as Record<string, unknown> | undefined) ?? {};
    }
  } catch {
    logger.warn("Invalid BINARY_PLAN_DEFINITION_B64; using feature environment flags");
  }
  const planEnabled = (name: string, fallback = false) =>
    typeof planFeatures[name] === "boolean" ? Boolean(planFeatures[name]) : fallback;
  const applyPlan = (payload: Record<string, unknown>) => {
    const agent = payload.agent as Record<string, unknown>;
    const settings = (agent.settings ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(agent.tools) ? agent.tools : [];
    const allowRag = enabled("BINARY_FEATURE_RAG");
    const allowCalendar = enabled("BINARY_FEATURE_CALENDAR");
    const allowDrive = enabled("BINARY_FEATURE_DRIVE");
    const allowAsaas = enabled("BINARY_FEATURE_ASAAS");
    const allowFollowUp = enabled("BINARY_FEATURE_FOLLOWUPS");
    const allowHttpTools = planEnabled("httpTools", true);
    const allowMcp = planEnabled("mcp", true);
    const allowReminders = planEnabled("reminders") && allowCalendar;
    const allowHandoff = planEnabled("humanHandoff", true);
    agent.tools = tools.filter((grant) => {
      if (!grant || typeof grant !== "object") return false;
      const item = grant as Record<string, unknown>;
      if (item.source === "RAG") return allowRag;
      if (item.source === "HTTP") return allowHttpTools;
      if (item.source === "MCP") return allowMcp;
      if (item.source === "NATIVE" && Array.isArray(item.enabledTools)) {
        item.enabledTools = item.enabledTools.filter((tool) =>
          !["kanban_move_card", "update_kanban_task"].includes(String(tool)),
        ).filter((tool) => allowHandoff || String(tool) !== "handoff_to_human");
      }
      if (item.source !== "INTEGRATION") return true;
      const catalogType = String(item.catalogType ?? "");
      if (catalogType === "GOOGLE_CALENDAR") return allowCalendar;
      if (catalogType === "GOOGLE_DRIVE") return allowDrive;
      if (catalogType === "ASAAS") return allowAsaas;
      return true;
    });
    if (settings.followUp && typeof settings.followUp === "object") {
      (settings.followUp as Record<string, unknown>).enabled = allowFollowUp;
    }
    if (settings.appointmentReminders && typeof settings.appointmentReminders === "object") {
      (settings.appointmentReminders as Record<string, unknown>).enabled = allowReminders;
    } else if (allowReminders) {
      settings.appointmentReminders = { enabled: true };
    }
    if (settings.vision && typeof settings.vision === "object")
      (settings.vision as Record<string, unknown>).enabled = planEnabled("vision", true);
    if (settings.debounce && typeof settings.debounce === "object")
      (settings.debounce as Record<string, unknown>).enabled = planEnabled("debounce", true);
    if (settings.split && typeof settings.split === "object")
      (settings.split as Record<string, unknown>).enabled = planEnabled("typing", true);
    if (settings.handoff && typeof settings.handoff === "object")
      (settings.handoff as Record<string, unknown>).mode = planEnabled("humanHandoff", true) ? "route" : "disabled";
    if (!enabled("BINARY_FEATURE_STT")) {
      if (settings.stt && typeof settings.stt === "object")
        (settings.stt as Record<string, unknown>).enabled = false;
    }
    if (!enabled("BINARY_FEATURE_TTS")) {
      if (settings.tts && typeof settings.tts === "object")
        (settings.tts as Record<string, unknown>).mode = "never";
    }
    agent.settings = settings;
  };
  const templateFile = templateFiles[templateId];
  if (!templateFile)
    return {
      seeded: false,
      warning: `agent template not bundled: ${templateId}`,
    };
  const file = path.join(
    process.cwd(),
    "docs",
    "crm",
    "templates",
    templateFile,
  );
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<
      string,
      unknown
    >;
    const agent = raw.agent as Record<string, unknown> | undefined;
    if (!agent) throw new Error("agent template has no agent payload");
    const requestedName = process.env.BINARY_AGENT_NAME?.trim();
    if (requestedName) agent.name = requestedName;
    applyPlan(raw);
    await importAgent(ctx, raw);
    logger.info(
      { tenantId: ctx.tenantId?.toString(), templateId, name: agent.name },
      "Binary agent template seeded",
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
