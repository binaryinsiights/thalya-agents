import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Client, type ConnectConfig } from "ssh2";
import type { Prisma, PrismaClient } from "@/../generated/prisma/client";
import basePrisma from "@/api/lib/prisma";
import { AppError, NotFoundError } from "@/lib/errors";
import { runScopedOn, type TenantContext } from "@/lib/tenancy";
import { resolveVaultSecret } from "@/modules/vault/service";
import { initializeOnboarding } from "./operations";
import { runtimePlanDefinition } from "./plans";

type LogEntry = { at: string; level: "info" | "error"; message: string };

const secret = (bytes = 32) => randomBytes(bytes).toString("hex");
const envValue = (value: unknown, label: string) => {
  const result = String(value ?? "").trim();
  if (!result || /[\r\n\0]/.test(result))
    throw new AppError(`${label} is invalid`, 400);
  return result;
};

function resolveAgentsImage(metadata: unknown) {
  const values = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const image = String(
      values.agentsImage ??
      process.env.BINARY_CLIENT_IMAGE ??
      "ghcr.io/binaryinsiights/thalya-agents:client-2026.08.16.4",
  ).trim();
  if (!image || /:(latest|main|dev)$/i.test(image))
    throw new AppError("an immutable agents image is required", 400);
  return image;
}

function resolveAgentSeed(metadata: unknown) {
  const values = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const manifest = values.provisionManifest;
  const agent = manifest && typeof manifest === "object"
    ? (manifest as Record<string, unknown>).agent
    : null;
  const fields = agent && typeof agent === "object" ? (agent as Record<string, unknown>) : {};
  const templateId = String(fields.templateId ?? "thalya").trim().toLowerCase();
  const name = String(fields.name ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(templateId))
    throw new AppError("agent templateId is invalid", 400);
  if (name && /[\r\n\0]/.test(name))
    throw new AppError("agent name is invalid", 400);
  return { templateId, name };
}

async function loadTarget(
  ctx: TenantContext,
  deploymentId: bigint,
  base: PrismaClient,
) {
  return runScopedOn(base, ctx, async (db) => {
    const deployment = await db.crmDeployment.findUnique({
      where: { id: deploymentId },
      include: {
        installationProfile: true,
        customer: true,
        contract: { include: { planVersion: true } },
      },
    });
    if (!deployment) throw new NotFoundError("deployment not found");
    const profile = deployment.installationProfile;
    if (!profile)
      throw new AppError("complete the infrastructure form first", 400);
    if (!profile.authorized)
      throw new AppError("deployment is not authorized", 400);
    const orchestrator = String(profile.orchestrator ?? "").toUpperCase();
    if (!["DOCKER_COMPOSE", "COOLIFY"].includes(orchestrator))
      throw new AppError("unsupported orchestrator", 400);
    const privateKey =
      orchestrator === "DOCKER_COMPOSE"
        ? await (async () => {
            if (!profile.serverHost || !profile.serverUser || !profile.sshCredentialRef)
              throw new AppError("SSH access is incomplete", 400);
            return resolveVaultSecret<string>(db, profile.sshCredentialRef);
          })()
        : null;
    const orchestratorToken =
      orchestrator === "COOLIFY"
        ? await (async () => {
            if (
              !profile.orchestratorUrl ||
              !profile.orchestratorCredentialRef ||
              !profile.coolifyProjectUuid ||
              !profile.coolifyEnvironmentUuid ||
              !profile.coolifyServerUuid
            )
              throw new AppError("Coolify configuration is incomplete", 400);
            return resolveVaultSecret<string>(
              db,
              profile.orchestratorCredentialRef,
            );
          })()
        : null;
    const passphrase = profile.sshPassphraseRef
      ? await resolveVaultSecret<string>(db, profile.sshPassphraseRef)
      : undefined;
    const langfusePassword = profile.langfuseAdminPasswordRef
      ? await resolveVaultSecret<string>(db, profile.langfuseAdminPasswordRef)
      : null;
    const heartbeatSecret = deployment.heartbeatSecretRef
      ? await resolveVaultSecret<string>(db, deployment.heartbeatSecretRef)
      : null;
    const registrySecret = profile.registryCredentialRef
      ? await resolveVaultSecret<string>(db, profile.registryCredentialRef)
      : null;
    const dnsSecret = profile.dnsCredentialRef
      ? await resolveVaultSecret<string>(db, profile.dnsCredentialRef)
      : null;
    return {
      deployment,
      profile,
      privateKey,
      orchestratorToken,
      passphrase,
      langfusePassword,
      heartbeatSecret,
      registrySecret,
      dnsSecret,
    };
  });
}

function connect(config: ConnectConfig) {
  return new Promise<Client>((resolve, reject) => {
    const client = new Client();
    client.once("ready", () => resolve(client));
    client.once("error", reject);
    client.connect({
      ...config,
      readyTimeout: 15_000,
      keepaliveInterval: 10_000,
    });
  });
}

function exec(client: Client, command: string) {
  return new Promise<string>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let output = "";
      let stderr = "";
      stream.on("data", (chunk: Buffer) => (output += chunk.toString()));
      stream.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      stream.once("close", (code: number | null) => {
        if (code === 0) resolve(output.trim());
        else
          reject(new Error(stderr.trim() || `remote command failed (${code})`));
      });
    });
  });
}

function upload(client: Client, local: string, remote: string) {
  return new Promise<void>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) return reject(error);
      sftp.fastPut(local, remote, (putError) =>
        putError ? reject(putError) : resolve(),
      );
    });
  });
}

async function patchRun(
  ctx: TenantContext,
  runId: bigint,
  patch: Prisma.CrmProvisionRunUpdateInput,
  base: PrismaClient,
) {
  await runScopedOn(base, ctx, (db) =>
    db.crmProvisionRun.update({ where: { id: runId }, data: patch }),
  );
}

async function log(
  ctx: TenantContext,
  runId: bigint,
  entry: Omit<LogEntry, "at">,
  base: PrismaClient,
) {
  await runScopedOn(base, ctx, async (db) => {
    const current = await db.crmProvisionRun.findUnique({
      where: { id: runId },
      select: { logs: true },
    });
    const logs = Array.isArray(current?.logs)
      ? (current.logs as LogEntry[])
      : [];
    logs.push({ ...entry, at: new Date().toISOString() });
    await db.crmProvisionRun.update({
      where: { id: runId },
      data: { logs: logs.slice(-200) as Prisma.InputJsonValue },
    });
  });
}

function sshConfig(
  target: Awaited<ReturnType<typeof loadTarget>>,
): ConnectConfig {
  return {
    host: target.profile.serverHost as string,
    port: target.profile.serverPort,
    username: target.profile.serverUser as string,
    privateKey: target.privateKey as string,
    ...(target.passphrase ? { passphrase: target.passphrase } : {}),
  };
}

export async function startProvisionRun(
  ctx: TenantContext,
  deploymentId: bigint,
  kind: "CONNECTION_TEST" | "INSTALL",
  base: PrismaClient = basePrisma,
) {
  const target = await loadTarget(ctx, deploymentId, base);
  await runScopedOn(base, ctx, (db) =>
    db.crmProvisionRun.updateMany({
      where: {
        deploymentId,
        status: { in: ["QUEUED", "RUNNING"] },
        updatedAt: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      data: {
        status: "FAILED",
        phase: "INTERRUPTED",
        error: "Execução interrompida antes da conclusão.",
        finishedAt: new Date(),
      },
    }),
  );
  const active = await runScopedOn(base, ctx, (db) =>
    db.crmProvisionRun.findFirst({
      where: { deploymentId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    }),
  );
  if (active) throw new AppError("a provision run is already active", 409);
  const run = await runScopedOn(base, ctx, (db) =>
    db.crmProvisionRun.create({
      data: { tenantId: ctx.tenantId as bigint, deploymentId, kind },
    }),
  );
  void executeRun(ctx, run.id, target, kind, base);
  return run;
}

async function executeRun(
  ctx: TenantContext,
  runId: bigint,
  target: Awaited<ReturnType<typeof loadTarget>>,
  kind: "CONNECTION_TEST" | "INSTALL",
  base: PrismaClient,
) {
  let client: Client | null = null;
  try {
    if (String(target.profile.orchestrator ?? "").toUpperCase() === "COOLIFY") {
      await executeCoolifyRun(ctx, runId, target, base);
      return;
    }
    await patchRun(
      ctx,
      runId,
      {
        status: "RUNNING",
        phase: "CONNECTING",
        progress: 5,
        startedAt: new Date(),
      },
      base,
    );
    await log(
      ctx,
      runId,
      { level: "info", message: "Conectando à VPS por SSH." },
      base,
    );
    client = await connect(sshConfig(target));
    await patchRun(ctx, runId, { phase: "INVENTORY", progress: 15 }, base);
    const inventory = await exec(
      client,
      "set -eu; uname -srm; docker version --format '{{.Server.Version}}'; docker compose version --short; df -Pk . | tail -1; free -m | awk 'NR==2 {print $2}'; nproc",
    );
    await log(
      ctx,
      runId,
      {
        level: "info",
        message: `Acesso confirmado. Inventário: ${inventory.replace(/\s+/g, " ").slice(0, 500)}`,
      },
      base,
    );
    if (kind === "CONNECTION_TEST") {
      await patchRun(
        ctx,
        runId,
        {
          status: "SUCCEEDED",
          phase: "READY",
          progress: 100,
          summary: "VPS conectada e Docker disponível.",
          finishedAt: new Date(),
        },
        base,
      );
      return;
    }
    await configureDns(ctx, runId, target, base);
    await installStack(ctx, runId, target, client, base);
    await patchRun(
      ctx,
      runId,
      {
        status: "SUCCEEDED",
        phase: "AWAITING_SETUP",
        progress: 100,
        summary:
          "Stack instalada. Crie os administradores no Agents e Chatwoot.",
        finishedAt: new Date(),
      },
      base,
    );
    await runScopedOn(base, ctx, (db) =>
      db.crmDeployment.update({
        where: { id: target.deployment.id },
        data: {
          status: "AWAITING_SETUP",
          orchestrator: target.profile.orchestrator,
          domain: target.profile.agentsDomain,
          agentsUrl: `https://${target.profile.agentsDomain}`,
          chatwootUrl: `https://${target.profile.chatwootDomain}`,
          langfuseUrl: `https://${target.profile.langfuseDomain}`,
          baileysUrl: `https://${target.profile.baileysDomain}`,
        },
      }),
    );
    await initializeOnboarding(ctx, target.deployment.id, base);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha desconhecida";
    await log(
      ctx,
      runId,
      { level: "error", message: message.slice(0, 1000) },
      base,
    ).catch(() => {});
    await patchRun(
      ctx,
      runId,
      {
        status: "FAILED",
        phase: "FAILED",
        error: message.slice(0, 2000),
        finishedAt: new Date(),
      },
      base,
    ).catch(() => {});
  } finally {
    client?.end();
  }
}

type CoolifyTarget = Awaited<ReturnType<typeof loadTarget>>;

async function coolifyRequest(
  target: CoolifyTarget,
  path: string,
  init: RequestInit = {},
) {
  if (!target.profile.orchestratorUrl || !target.orchestratorToken)
    throw new AppError("Coolify credentials are incomplete", 400);
  const response = await fetch(
    `${target.profile.orchestratorUrl.replace(/\/+$/, "")}/api/v1${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${target.orchestratorToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok)
    throw new AppError(
      `Coolify API ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
      502,
    );
  return body as Record<string, unknown>;
}

async function createCoolifyService(
  target: CoolifyTarget,
  name: string,
  compose: string,
  env: Record<string, string>,
) {
  const created = await coolifyRequest(target, "/services", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: "Provisionado pela Central Binary",
      project_uuid: target.profile.coolifyProjectUuid,
      environment_uuid: target.profile.coolifyEnvironmentUuid,
      server_uuid: target.profile.coolifyServerUuid,
      destination_uuid: target.profile.coolifyDestinationUuid || undefined,
      docker_compose_raw: Buffer.from(compose, "utf8").toString("base64"),
      instant_deploy: false,
      force_domain_override: false,
    }),
  });
  const uuid = String(created.uuid ?? "");
  if (!uuid) throw new AppError(`Coolify did not return a service UUID for ${name}`, 502);
  for (const [key, value] of Object.entries(env)) {
    await coolifyRequest(target, `/services/${uuid}/envs`, {
      method: "POST",
      body: JSON.stringify({ key, value, is_preview: false, is_literal: true, is_multiline: value.includes("\n") }),
    });
  }
  await coolifyRequest(target, `/services/${uuid}/start`);
  return uuid;
}

async function executeCoolifyRun(
  ctx: TenantContext,
  runId: bigint,
  target: CoolifyTarget,
  base: PrismaClient,
) {
  await configureDns(ctx, runId, target, base);
  await patchRun(ctx, runId, { status: "RUNNING", phase: "COOLIFY", progress: 10, startedAt: new Date() }, base);
  await log(ctx, runId, { level: "info", message: "Conectando à API do Coolify." }, base);
  const profile = target.profile;
  const planCode =
    target.deployment.contract?.planVersion.code ?? target.deployment.customer.plan;
  const plan = runtimePlanDefinition(planCode, target.deployment.contract?.planVersion);
  if (!plan) throw new AppError(`unknown plan ${planCode}`, 400);
  const agentSeed = resolveAgentSeed(target.deployment.metadata);
  const publicUrl = (domain: unknown) => `https://${envValue(domain, "domain")}`;
  const secrets = {
    agentsDb: secret(24),
    agentsApp: secret(24),
    chatwootDb: secret(24),
    chatwootSecret: secret(64),
    redis: secret(24),
    langfuseDb: secret(24),
    langfuseSalt: secret(),
    langfuseEncryption: secret(),
    langfuseNextAuth: secret(),
    clickhouse: secret(24),
    minioUser: `minio-${secret(8)}`,
    minioPassword: secret(24),
    baileys: secret(24),
  };
  const domains = {
    agents: envValue(profile.agentsDomain, "agentsDomain"),
    chatwoot: envValue(profile.chatwootDomain, "chatwootDomain"),
    langfuse: envValue(profile.langfuseDomain, "langfuseDomain"),
    baileys: envValue(profile.baileysDomain, "baileysDomain"),
  };
  const commonAgents = {
    AGENTS_IMAGE: resolveAgentsImage(target.deployment.metadata),
    PUBLIC_URL: publicUrl(domains.agents),
    CORS_ORIGIN: publicUrl(domains.agents),
    FLEET_CONTROL_URL: process.env.PUBLIC_URL ?? "",
    FLEET_DEPLOYMENT_KEY: target.deployment.deploymentKey ?? "",
    FLEET_HEARTBEAT_SECRET: target.heartbeatSecret ?? "",
    FLEET_CHATWOOT_HEALTH_URL: publicUrl(domains.chatwoot),
    FLEET_BAILEYS_HEALTH_URL: `https://${domains.baileys}/status`,
    FLEET_LANGFUSE_HEALTH_URL: `https://${domains.langfuse}/api/public/health`,
    BINARY_CRM_ENABLED: "false",
    THALYA_SEED_AGENT: "true",
    BINARY_AGENT_TEMPLATE_ID: agentSeed.templateId,
    BINARY_AGENT_NAME: agentSeed.name,
    BINARY_PLAN: plan.planCode,
    BINARY_PLAN_VERSION: plan.version,
    BINARY_PLAN_DEFINITION_B64: Buffer.from(JSON.stringify(plan), "utf8").toString("base64"),
    BINARY_FEATURE_RAG: String(plan.limits.knowledgeDocuments > 0),
    BINARY_FEATURE_CALENDAR: String(plan.features.calendar),
    BINARY_FEATURE_DRIVE: String(plan.features.drive),
    BINARY_FEATURE_STT: String(plan.features.stt),
    BINARY_FEATURE_TTS: String(plan.features.tts),
    BINARY_FEATURE_AUDIO: String(plan.features.stt || plan.features.tts),
    BINARY_FEATURE_FOLLOWUPS: String(plan.features.followUp),
    BINARY_FEATURE_ASAAS: String(plan.features.asaas),
    BINARY_LIMIT_AGENTS: String(plan.limits.agents),
    BINARY_LIMIT_CHANNELS: String(plan.limits.channels),
    BINARY_LIMIT_DOCUMENTS: String(plan.limits.knowledgeDocuments),
    BINARY_LIMIT_MONTHLY_CONVERSATIONS: String(plan.limits.monthlyConversations),
  };
  await patchRun(ctx, runId, { phase: "AGENTS", progress: 35 }, base);
  const agentsUuid = await createCoolifyService(
    target,
    `${target.deployment.name}-agents`,
    await Bun.file(path.join(process.cwd(), "docker-compose.coolify.yml")).text(),
    {
      ...commonAgents,
      SERVICE_URL_AGENTS: publicUrl(domains.agents),
      SERVICE_USER_DBUSER: "postgres",
      SERVICE_PASSWORD_64_DBPASSWORD: secrets.agentsDb,
      SERVICE_USER_APPDBUSER: "secv4_app",
      SERVICE_PASSWORD_64_APPDBPASSWORD: secrets.agentsApp,
      SERVICE_PASSWORD_64_JWTSECRET: secret(),
      SERVICE_PASSWORD_64_ENCRYPTIONKEY: secret(),
      POSTGRES_DB: "secretaria_v4_db",
    },
  );
  await patchRun(ctx, runId, { phase: "CHATWOOT", progress: 55 }, base);
  const chatwootUuid = await createCoolifyService(
    target,
    `${target.deployment.name}-chatwoot`,
    await Bun.file(path.join(process.cwd(), ".claude/skills/agents-onboarding/templates/chatwoot/docker-compose.coolify.yml")).text(),
    {
      SERVICE_URL_CHATWOOT: publicUrl(domains.chatwoot),
      SERVICE_FQDN_BAILEYS_3025: domains.baileys,
      SERVICE_URL_BAILEYS_3025: publicUrl(domains.baileys),
      SERVICE_USER_POSTGRES: "chatwoot",
      SERVICE_PASSWORD_POSTGRES: secrets.chatwootDb,
      SERVICE_PASSWORD_64_SECRETKEYBASE: secrets.chatwootSecret,
      SERVICE_PASSWORD_REDIS: secrets.redis,
      SERVICE_PASSWORD_64_DEFAULTAPIKEY: secrets.baileys,
      POSTGRES_DB: "chatwoot_production",
      CHATWOOT_IMAGE: "ghcr.io/fazer-ai/chatwoot:latest",
      BAILEYS_PROVIDER_DEFAULT_CLIENT_NAME: "Binary Atendimento",
    },
  );
  await patchRun(ctx, runId, { phase: "LANGFUSE", progress: 75 }, base);
  const langfuseUuid = await createCoolifyService(
    target,
    `${target.deployment.name}-langfuse`,
    await Bun.file(path.join(process.cwd(), ".claude/skills/agents-onboarding/templates/langfuse/docker-compose.coolify.yml")).text(),
    {
      SERVICE_URL_LANGFUSE: publicUrl(domains.langfuse),
      SERVICE_URL_LANGFUSE_3000: publicUrl(domains.langfuse),
      SERVICE_FQDN_LANGFUSE_3000: domains.langfuse,
      SERVICE_USER_POSTGRES: "langfuse",
      SERVICE_PASSWORD_POSTGRES: secrets.langfuseDb,
      SERVICE_PASSWORD_SALT: secrets.langfuseSalt,
      SERVICE_PASSWORD_64_LANGFUSE: secrets.langfuseEncryption,
      SERVICE_BASE64_NEXTAUTHSECRET: secrets.langfuseNextAuth,
      SERVICE_USER_CLICKHOUSE: "clickhouse",
      SERVICE_PASSWORD_CLICKHOUSE: secrets.clickhouse,
      SERVICE_PASSWORD_REDIS: secrets.redis,
      SERVICE_USER_MINIO: secrets.minioUser,
      SERVICE_PASSWORD_MINIO: secrets.minioPassword,
      POSTGRES_DB: "langfuse",
      LANGFUSE_INIT_ORG_ID: `binary-${target.deployment.instanceId ?? runId}`,
      LANGFUSE_INIT_ORG_NAME: target.deployment.customer.name,
      LANGFUSE_INIT_PROJECT_ID: "agents",
      LANGFUSE_INIT_PROJECT_NAME: "Binary Agents",
      LANGFUSE_INIT_USER_EMAIL: envValue(profile.langfuseAdminEmail, "langfuseAdminEmail"),
      LANGFUSE_INIT_USER_NAME: "Administrador",
      LANGFUSE_INIT_USER_PASSWORD: target.langfusePassword ?? "",
      LANGFUSE_INIT_PROJECT_PUBLIC_KEY: `pk-lf-${secret(16)}`,
      LANGFUSE_INIT_PROJECT_SECRET_KEY: `sk-lf-${secret(24)}`,
      AUTH_DISABLE_SIGNUP: "true",
    },
  );
  await runScopedOn(base, ctx, (db) => db.crmDeployment.update({ where: { id: target.deployment.id }, data: { status: "AWAITING_SETUP", agentsUrl: publicUrl(domains.agents), chatwootUrl: publicUrl(domains.chatwoot), langfuseUrl: publicUrl(domains.langfuse), baileysUrl: publicUrl(domains.baileys), metadata: { ...(target.deployment.metadata as Record<string, unknown>), coolifyServices: { agents: agentsUuid, chatwoot: chatwootUuid, langfuse: langfuseUuid } } as Prisma.InputJsonValue } }));
  await initializeOnboarding(ctx, target.deployment.id, base);
  await patchRun(ctx, runId, { status: "SUCCEEDED", phase: "AWAITING_SETUP", progress: 100, summary: "Serviços criados no Coolify. Aguardando configuração funcional.", finishedAt: new Date() }, base);
}

async function configureDns(
  ctx: TenantContext,
  runId: bigint,
  target: Awaited<ReturnType<typeof loadTarget>>,
  base: PrismaClient,
) {
  const profile = target.profile;
  if (String(profile.dnsMode ?? "MANUAL").toUpperCase() !== "AUTOMATIC") {
    await log(
      ctx,
      runId,
      {
        level: "info",
        message:
          "DNS em modo manual: os quatro registros devem apontar para a VPS antes da emissão TLS.",
      },
      base,
    );
    return;
  }
  if (String(profile.dnsProvider ?? "").toLowerCase() !== "cloudflare") {
    throw new AppError(
      "DNS automático atualmente exige o provedor Cloudflare; use o modo manual para outro provedor",
      400,
    );
  }
  if (!target.dnsSecret || !profile.dnsZone || !profile.serverHost) {
    throw new AppError("Cloudflare token, zone and VPS host are required", 400);
  }
  await patchRun(ctx, runId, { phase: "DNS", progress: 22 }, base);
  const address = await lookup(profile.serverHost);
  const recordType = address.family === 6 ? "AAAA" : "A";
  const headers = {
    Authorization: `Bearer ${target.dnsSecret}`,
    "Content-Type": "application/json",
  };
  const zonesResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(profile.dnsZone)}`,
    { headers },
  );
  const zones = (await zonesResponse.json()) as {
    success?: boolean;
    result?: Array<{ id: string }>;
  };
  const zoneId = zones.result?.[0]?.id;
  if (!zonesResponse.ok || !zones.success || !zoneId) {
    throw new AppError(
      "Cloudflare zone was not found or token is invalid",
      400,
    );
  }
  const domains = [
    profile.agentsDomain,
    profile.chatwootDomain,
    profile.baileysDomain,
    profile.langfuseDomain,
  ].map((domain) => envValue(domain, "domain"));
  for (const domain of domains) {
    const listResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=${recordType}&name=${encodeURIComponent(domain)}`,
      { headers },
    );
    const list = (await listResponse.json()) as {
      success?: boolean;
      result?: Array<{ id: string }>;
    };
    if (!listResponse.ok || !list.success)
      throw new AppError(`Cloudflare could not read ${domain}`, 400);
    const payload = JSON.stringify({
      type: recordType,
      name: domain,
      content: address.address,
      ttl: 1,
      proxied: false,
    });
    const existing = list.result?.[0];
    const response = await fetch(
      existing
        ? `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existing.id}`
        : `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      { method: existing ? "PUT" : "POST", headers, body: payload },
    );
    if (!response.ok)
      throw new AppError(`Cloudflare could not configure ${domain}`, 400);
  }
  await log(
    ctx,
    runId,
    {
      level: "info",
      message: `DNS configurado na Cloudflare para ${address.address}.`,
    },
    base,
  );
}

async function installStack(
  ctx: TenantContext,
  runId: bigint,
  target: Awaited<ReturnType<typeof loadTarget>>,
  client: Client,
  base: PrismaClient,
) {
  const p = target.profile;
  const planCode =
    target.deployment.contract?.planVersion.code ?? target.deployment.customer.plan;
  const plan = runtimePlanDefinition(planCode, target.deployment.contract?.planVersion);
  if (!plan) throw new AppError(`unknown plan ${planCode}`, 400);
  const agentSeed = resolveAgentSeed(target.deployment.metadata);
  const required = {
    agentsDomain: p.agentsDomain,
    chatwootDomain: p.chatwootDomain,
    langfuseDomain: p.langfuseDomain,
    acmeEmail: p.acmeEmail,
    langfuseAdminEmail: p.langfuseAdminEmail,
  };
  for (const [label, value] of Object.entries(required)) envValue(value, label);
  if (
    !target.langfusePassword ||
    !target.heartbeatSecret ||
    !target.deployment.deploymentKey
  )
    throw new AppError("installation credentials are incomplete", 400);

  const metadata = (target.deployment.metadata ?? {}) as Record<string, unknown>;
  const agentsImage = resolveAgentsImage(target.deployment.metadata);
  const registry = String(metadata.registry ?? "").trim();
  const registryUsername = String(metadata.registryUsername ?? "").trim();
  if (target.registrySecret && (!registry || !registryUsername))
    throw new AppError("registry and registryUsername are required with a registry credential", 400);
  const localFiles: string[] = [];
  const remoteRoot = ".binary-insights";
  const agentsDb = secret(24);
  const agentsApp = secret(24);
  let agentsEnv = `${[
    `AGENTS_IMAGE=${agentsImage}`,
    `PUBLIC_URL=https://${p.agentsDomain}`,
    `CORS_ORIGIN=https://${p.agentsDomain}`,
    `CADDY_DOMAIN=${p.agentsDomain}`,
    `CHATWOOT_DOMAIN=${p.chatwootDomain}`,
    `LANGFUSE_DOMAIN=${p.langfuseDomain}`,
    `BAILEYS_DOMAIN=${p.baileysDomain}`,
    `ACME_EMAIL=${p.acmeEmail}`,
    "DATABASE_NAME=secretaria_v4_db",
    "POSTGRES_USER=postgres",
    `POSTGRES_PASSWORD=${agentsDb}`,
    `JWT_SECRET=${secret()}`,
    `ENCRYPTION_KEY=${secret()}`,
    `MIGRATION_DATABASE_URL=postgres://postgres:${agentsDb}@postgres:5432/secretaria_v4_db`,
    `DATABASE_URL=postgres://secv4_app:${agentsApp}@postgres:5432/secretaria_v4_db`,
    `LANGGRAPH_DATABASE_URL=postgres://secv4_app:${agentsApp}@postgres:5432/secretaria_v4_db`,
    `FLEET_CONTROL_URL=${process.env.PUBLIC_URL}`,
    `FLEET_DEPLOYMENT_KEY=${target.deployment.deploymentKey}`,
    `FLEET_HEARTBEAT_SECRET=${target.heartbeatSecret}`,
    `FLEET_CHATWOOT_HEALTH_URL=https://${p.chatwootDomain}`,
    `FLEET_BAILEYS_HEALTH_URL=http://host.docker.internal:3025/status`,
    `FLEET_LANGFUSE_HEALTH_URL=https://${p.langfuseDomain}/api/public/health`,
    `BINARY_PLAN=${plan.planCode}`,
    `BINARY_PLAN_VERSION=${plan.version}`,
    `BINARY_PLAN_DEFINITION_B64=${Buffer.from(JSON.stringify(plan), "utf8").toString("base64")}`,
    `BINARY_FEATURE_RAG=${plan.limits.knowledgeDocuments > 0}`,
    `BINARY_FEATURE_CALENDAR=${plan.features.calendar}`,
    `BINARY_FEATURE_DRIVE=${plan.features.drive}`,
    `BINARY_FEATURE_STT=${plan.features.stt}`,
    `BINARY_FEATURE_TTS=${plan.features.tts}`,
    `BINARY_FEATURE_AUDIO=${plan.features.stt || plan.features.tts}`,
    `BINARY_FEATURE_FOLLOWUPS=${plan.features.followUp}`,
    `BINARY_FEATURE_ASAAS=${plan.features.asaas}`,
    `BINARY_LIMIT_AGENTS=${plan.limits.agents}`,
    `BINARY_LIMIT_CHANNELS=${plan.limits.channels}`,
    `BINARY_LIMIT_DOCUMENTS=${plan.limits.knowledgeDocuments}`,
    `BINARY_LIMIT_MONTHLY_CONVERSATIONS=${plan.limits.monthlyConversations}`,
    "BINARY_CRM_ENABLED=false",
    "THALYA_SEED_AGENT=true",
    `BINARY_AGENT_TEMPLATE_ID=${agentSeed.templateId}`,
    ...(agentSeed.name ? [`BINARY_AGENT_NAME=${agentSeed.name}`] : []),
  ].join("\n")}\n`;
  const chatwootEnv = `${[
    `CHATWOOT_URL=https://${p.chatwootDomain}`,
    "CHATWOOT_LOCALE=pt_BR",
    "POSTGRES_USER=chatwoot",
    `POSTGRES_PASSWORD=${secret(24)}`,
    "POSTGRES_DB=chatwoot_production",
    `SECRET_KEY_BASE=${secret(64)}`,
    `REDIS_PASSWORD=${secret(24)}`,
    `BAILEYS_DEFAULT_API_KEY=${secret(24)}`,
    "CHATWOOT_PORT=127.0.0.1:3001",
  ].join("\n")}\n`;
  const langfuseEnv = `${[
    `LANGFUSE_PUBLIC_URL=https://${p.langfuseDomain}`,
    "POSTGRES_USER=langfuse",
    `POSTGRES_PASSWORD=${secret(24)}`,
    "POSTGRES_DB=langfuse",
    `LANGFUSE_SALT=${secret()}`,
    `LANGFUSE_ENCRYPTION_KEY=${secret()}`,
    `LANGFUSE_NEXTAUTH_SECRET=${secret()}`,
    "CLICKHOUSE_USER=clickhouse",
    `CLICKHOUSE_PASSWORD=${secret(24)}`,
    `REDIS_PASSWORD=${secret(24)}`,
    `MINIO_ROOT_USER=minio-${secret(8)}`,
    `MINIO_ROOT_PASSWORD=${secret(24)}`,
    "AUTH_DISABLE_SIGNUP=true",
    "LANGFUSE_PORT=127.0.0.1:3002",
    "LANGFUSE_INIT_ORG_ID=binary-client",
    `LANGFUSE_INIT_ORG_NAME=${envValue(target.deployment.customer.name, "customer")}`,
    "LANGFUSE_INIT_PROJECT_ID=agents",
    "LANGFUSE_INIT_PROJECT_NAME=fazer.ai agents",
    `LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-${secret(16)}`,
    `LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-${secret(24)}`,
    `LANGFUSE_INIT_USER_EMAIL=${p.langfuseAdminEmail}`,
    "LANGFUSE_INIT_USER_NAME=Administrador",
    `LANGFUSE_INIT_USER_PASSWORD=${target.langfusePassword}`,
  ].join("\n")}\n`;

  await patchRun(ctx, runId, { phase: "PACKAGING", progress: 25 }, base);
  const assets = path.join(process.cwd(), "deploy", "binary-client");
  const tempFiles = [
    ["agents.env", agentsEnv],
    ["chatwoot.env", chatwootEnv],
    ["langfuse.env", langfuseEnv],
  ] as const;
  for (const [name, content] of tempFiles) {
    const file = `/tmp/${runId}-${name}`;
    await Bun.write(file, content);
    localFiles.push(file);
  }
  try {
    await exec(client, `set -eu; mkdir -p ${remoteRoot}/agents ${remoteRoot}/chatwoot ${remoteRoot}/langfuse`);
    const port80Busy = await exec(
      client,
      "ss -lntH 2>/dev/null | awk '$4 ~ /:80$/ {found=1} END {exit(found ? 0 : 1)}'",
    )
      .then(() => true)
      .catch(() => false);
    if (port80Busy) {
      agentsEnv +=
        "CADDY_HTTP_PORT=8080\nCADDY_HTTPS_PORT=8443\nCADDY_HTTP_ONLY=true\n";
      await log(
        ctx,
        runId,
        {
          level: "info",
          message: "Porta 80 ocupada; usando Caddy nas portas 8080/8443.",
        },
        base,
      );
    }
    await Bun.write(localFiles[1] as string, agentsEnv);
    await patchRun(ctx, runId, { phase: "UPLOADING", progress: 35 }, base);
    await upload(
      client,
      path.join(assets, "agents.yml"),
      `${remoteRoot}/agents/docker-compose.yml`,
    );
    await upload(
      client,
      path.join(assets, "chatwoot", "docker-compose.yml"),
      `${remoteRoot}/chatwoot/docker-compose.yml`,
    );
    await upload(
      client,
      path.join(assets, "langfuse", "docker-compose.yml"),
      `${remoteRoot}/langfuse/docker-compose.yml`,
    );
    await upload(client, localFiles[1] as string, `${remoteRoot}/agents/.env`);
    await upload(
      client,
      localFiles[2] as string,
      `${remoteRoot}/chatwoot/.env`,
    );
    await upload(
      client,
      localFiles[3] as string,
      `${remoteRoot}/langfuse/.env`,
    );
    await patchRun(ctx, runId, { phase: "PULLING", progress: 50 }, base);
    await log(ctx, runId, { level: "info", message: `Baixando imagem imutável ${agentsImage}.` }, base);
    if (target.registrySecret) {
      const encoded = Buffer.from(target.registrySecret, "utf8").toString("base64");
      await exec(client, `set -eu; printf '%s' '${encoded}' | base64 -d | docker login '${registry}' --username '${registryUsername}' --password-stdin`);
    }
    await exec(client, `set -eu; cd ${remoteRoot}/agents; docker compose pull agents`);
    for (const [phase, progress, dir, project] of [
      ["CHATWOOT", 65, "chatwoot", "binary_chatwoot"],
      ["LANGFUSE", 78, "langfuse", "binary_langfuse"],
      ["AGENTS", 90, "agents", "binary_agents"],
    ] as const) {
      await patchRun(ctx, runId, { phase, progress }, base);
      await log(
        ctx,
        runId,
        { level: "info", message: `Subindo ${phase.toLowerCase()}.` },
        base,
      );
      await exec(
        client,
        `set -eu; cd ${remoteRoot}/${dir}; docker compose -p ${project} up -d`,
      );
    }
    await patchRun(ctx, runId, { phase: "HEALTH", progress: 97 }, base);
    await exec(
      client,
      "set -eu; docker ps --format '{{.Names}} {{.Status}}' | grep -E 'binary_(agents|chatwoot|langfuse)' | head -40",
    );
  } finally {
    await Promise.all(localFiles.map((file) => unlink(file).catch(() => {})));
  }
}
