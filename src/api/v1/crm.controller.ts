import { Elysia, t } from "elysia";
import { doc, errors } from "@/api/lib/openapi";
import { tenancyPlugin } from "@/api/middlewares/tenancy";
import config from "@/config";
import {
  ForbiddenError,
  NotFoundError,
  TenantTargetRequiredError,
} from "@/lib/errors";
import type { TenantContext } from "@/lib/tenancy";
import {
  createContact,
  createContract,
  createMaintenance,
  decideApproval,
  deleteContact,
  deleteCustomer,
  deleteDeployment,
  initializeOnboarding,
  rotateFleetCredential,
  updateAlert,
  updateContract,
  updateCustomer,
  updateDeployment,
  updateMaintenance,
  upsertInstallationProfile,
} from "@/modules/crm/operations";
import { startProvisionRun } from "@/modules/crm/provisioner";
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
  .onBeforeHandle(() => {
    if (!config.crmEnabled) throw new NotFoundError("CRM is not enabled");
  })
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
  )
  .patch(
    "/customers/:id",
    ({ tenantContext, params, body }) =>
      updateCustomer(ctxOrThrow(tenantContext), BigInt(params.id), body),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Update CRM customer",
        "Atualiza dados, plano e estados do cliente.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .delete(
    "/customers/:id",
    ({ tenantContext, params }) =>
      deleteCustomer(ctxOrThrow(tenantContext), BigInt(params.id)),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      detail: doc(
        "Delete CRM customer",
        "Exclui o cliente e seus registros dependentes.",
      ),
      response: errors(401, 403, 404),
    },
  )
  .post(
    "/contacts",
    ({ tenantContext, body }) => createContact(ctxOrThrow(tenantContext), body),
    {
      requireRole: "TENANT_ADMIN",
      body,
      detail: doc(
        "Create CRM contact",
        "Adiciona contato ou responsável ao cliente.",
      ),
      response: errors(400, 401, 403),
    },
  )
  .delete(
    "/contacts/:id",
    ({ tenantContext, params }) =>
      deleteContact(ctxOrThrow(tenantContext), BigInt(params.id)),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      detail: doc("Delete CRM contact", "Remove um contato do cliente."),
      response: errors(401, 403, 404),
    },
  )
  .post(
    "/contracts",
    ({ tenantContext, body }) =>
      createContract(ctxOrThrow(tenantContext), body),
    {
      requireRole: "TENANT_ADMIN",
      body,
      detail: doc(
        "Create CRM contract",
        "Vincula cliente a uma versão imutável de plano.",
      ),
      response: errors(400, 401, 403),
    },
  )
  .patch(
    "/contracts/:id",
    ({ tenantContext, params, body }) =>
      updateContract(ctxOrThrow(tenantContext), BigInt(params.id), body),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Update CRM contract",
        "Atualiza estado e cobrança do contrato.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .patch(
    "/deployments/:id",
    ({ tenantContext, params, body }) =>
      updateDeployment(ctxOrThrow(tenantContext), BigInt(params.id), body),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Update CRM deployment",
        "Atualiza infraestrutura e credencial de heartbeat por referência Vault.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .put(
    "/deployments/:id/installation-profile",
    ({ tenantContext, params, body }) =>
      upsertInstallationProfile(
        ctxOrThrow(tenantContext),
        BigInt(params.id),
        body,
      ),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Save installation profile",
        "Salva a ficha completa de pré-implantação e calcula a prontidão.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .post(
    "/deployments/:id/connection-test",
    ({ tenantContext, params }) =>
      startProvisionRun(
        ctxOrThrow(tenantContext),
        BigInt(params.id),
        "CONNECTION_TEST",
      ),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      detail: doc(
        "Test deployment connection",
        "Valida SSH, Docker e capacidade básica da VPS cadastrada.",
      ),
      response: errors(400, 401, 403, 404, 409),
    },
  )
  .post(
    "/deployments/:id/provision",
    ({ tenantContext, params }) =>
      startProvisionRun(
        ctxOrThrow(tenantContext),
        BigInt(params.id),
        "INSTALL",
      ),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      detail: doc(
        "Provision client stack",
        "Instala a stack Binary Insights na VPS cadastrada e acompanha o progresso.",
      ),
      response: errors(400, 401, 403, 404, 409),
    },
  )
  .post(
    "/deployments/:id/fleet-config/rotate",
    ({ tenantContext, params }) =>
      rotateFleetCredential(ctxOrThrow(tenantContext), BigInt(params.id)),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      detail: doc(
        "Rotate fleet credential",
        "Rotaciona o segredo do heartbeat e devolve o novo bloco uma única vez.",
      ),
      response: errors(401, 403, 404),
    },
  )
  .delete(
    "/deployments/:id",
    ({ tenantContext, params }) =>
      deleteDeployment(ctxOrThrow(tenantContext), BigInt(params.id)),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      detail: doc(
        "Delete CRM deployment",
        "Exclui a instalação e seus dados operacionais.",
      ),
      response: errors(401, 403, 404),
    },
  )
  .post(
    "/deployments/:id/onboarding",
    ({ tenantContext, params }) =>
      initializeOnboarding(ctxOrThrow(tenantContext), BigInt(params.id)),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      detail: doc(
        "Initialize CRM onboarding",
        "Cria o checklist oficial e os gates de aprovação.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .patch(
    "/approvals/:id",
    ({ tenantContext, params, body }) =>
      decideApproval(ctxOrThrow(tenantContext), BigInt(params.id), body),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Decide CRM approval",
        "Aprova ou rejeita um gate de implantação.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .post(
    "/maintenance",
    ({ tenantContext, body }) =>
      createMaintenance(ctxOrThrow(tenantContext), body),
    {
      requireRole: "TENANT_ADMIN",
      body,
      detail: doc(
        "Create maintenance",
        "Registra manutenção ou incidente operacional.",
      ),
      response: errors(400, 401, 403),
    },
  )
  .patch(
    "/maintenance/:id",
    ({ tenantContext, params, body }) =>
      updateMaintenance(ctxOrThrow(tenantContext), BigInt(params.id), body),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Update maintenance",
        "Atualiza execução e resultado da manutenção.",
      ),
      response: errors(400, 401, 403, 404),
    },
  )
  .patch(
    "/alerts/:id",
    ({ tenantContext, params, body }) =>
      updateAlert(ctxOrThrow(tenantContext), BigInt(params.id), body),
    {
      requireRole: "TENANT_ADMIN",
      params: t.Object({ id: t.String() }),
      body,
      detail: doc(
        "Update CRM alert",
        "Reconhece ou resolve um alerta operacional.",
      ),
      response: errors(400, 401, 403, 404),
    },
  );
