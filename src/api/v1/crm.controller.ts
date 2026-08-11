import { Elysia, t } from "elysia";
import { doc, errors } from "@/api/lib/openapi";
import { tenancyPlugin } from "@/api/middlewares/tenancy";
import { ForbiddenError, TenantTargetRequiredError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenancy";
import {
  createChecklistItem,
  createCrmAgent,
  createCrmCustomer,
  createCrmDeployment,
  getCrmWorkspace,
  updateChecklistItem,
} from "@/modules/crm/service";

function ctxOrThrow(ctx: TenantContext | null) {
  if (!ctx) throw new ForbiddenError();
  if (ctx.tenantId === null) throw new TenantTargetRequiredError();
  return ctx;
}
const body = t.Record(t.String(), t.Unknown());

export const crmController = new Elysia({ prefix: "/v1/crm", tags: ["CRM"] })
  .use(tenancyPlugin)
  .get("/", ({ tenantContext }) => getCrmWorkspace(ctxOrThrow(tenantContext)), {
    requireRole: "TENANT_ADMIN",
    detail: doc(
      "CRM workspace",
      "Clientes, instalações, agentes, implantação e monitoramento.",
    ),
    response: errors(401, 403),
  })
  .post(
    "/customers",
    ({ tenantContext, body }) =>
      createCrmCustomer(ctxOrThrow(tenantContext), body),
    {
      requireRole: "TENANT_ADMIN",
      body,
      detail: doc(
        "Create CRM customer",
        "Cadastra um lead ou cliente da Binary Insights.",
      ),
      response: errors(400, 401, 403),
    },
  )
  .post(
    "/deployments",
    ({ tenantContext, body }) =>
      createCrmDeployment(ctxOrThrow(tenantContext), body),
    {
      requireRole: "TENANT_ADMIN",
      body,
      detail: doc(
        "Create CRM deployment",
        "Cadastra uma instalação dedicada do cliente.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .post(
    "/agents",
    ({ tenantContext, body }) =>
      createCrmAgent(ctxOrThrow(tenantContext), body),
    {
      requireRole: "TENANT_ADMIN",
      body,
      detail: doc(
        "Create remote agent",
        "Vincula um agente de uma instalação gerenciada.",
      ),
      response: errors(400, 401, 403),
    },
  )
  .post(
    "/checklist",
    ({ tenantContext, body }) =>
      createChecklistItem(ctxOrThrow(tenantContext), body),
    {
      requireRole: "TENANT_ADMIN",
      body,
      detail: doc(
        "Create checklist item",
        "Adiciona etapa ao onboarding oficial.",
      ),
      response: errors(400, 401, 403),
    },
  )
  .patch(
    "/checklist/:id",
    ({ tenantContext, params, body }) =>
      updateChecklistItem(ctxOrThrow(tenantContext), BigInt(params.id), body),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Update checklist item",
        "Atualiza execução, evidência, bloqueio ou aprovação.",
      ),
      response: errors(400, 401, 403, 404),
    },
  );
