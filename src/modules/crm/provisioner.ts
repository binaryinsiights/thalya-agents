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

type LogEntry = { at: string; level: "info" | "error"; message: string };

const secret = (bytes = 32) => randomBytes(bytes).toString("hex");
const envValue = (value: unknown, label: string) => {
  const result = String(value ?? "").trim();
  if (!result || /[\r\n\0]/.test(result))
    throw new AppError(`${label} is invalid`, 400);
  return result;
};

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
    if (profile.orchestrator !== "DOCKER_COMPOSE")
      throw new AppError(
        "select Docker Compose via SSH before starting this deployment",
        400,
      );
    if (!profile.serverHost || !profile.serverUser || !profile.sshCredentialRef)
      throw new AppError("SSH access is incomplete", 400);
    const privateKey = await resolveVaultSecret<string>(
      db,
      profile.sshCredentialRef,
    );
    const passphrase = profile.sshPassphraseRef
      ? await resolveVaultSecret<string>(db, profile.sshPassphraseRef)
      : undefined;
    const langfusePassword = profile.langfuseAdminPasswordRef
      ? await resolveVaultSecret<string>(db, profile.langfuseAdminPasswordRef)
      : null;
    const heartbeatSecret = deployment.heartbeatSecretRef
      ? await resolveVaultSecret<string>(db, deployment.heartbeatSecretRef)
      : null;
    const dnsSecret = profile.dnsCredentialRef
      ? await resolveVaultSecret<string>(db, profile.dnsCredentialRef)
      : null;
    return {
      deployment,
      profile,
      privateKey,
      passphrase,
      langfusePassword,
      heartbeatSecret,
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
    privateKey: target.privateKey,
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

async function createSourceArchive(output: string) {
  const root = process.cwd();
  const proc = Bun.spawn(
    [
      "tar",
      "-czf",
      output,
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=dist",
      "--exclude=logs",
      "--exclude=.env",
      "-C",
      root,
      ".",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(
      `source bundle failed: ${await new Response(proc.stderr).text()}`,
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

  const work = `/tmp/binary-provision-${runId}`;
  const archive = `${work}.tgz`;
  const localFiles: string[] = [archive];
  const remoteRoot = ".binary-insights";
  const agentsDb = secret(24);
  const agentsApp = secret(24);
  let agentsEnv = `${[
    `AGENTS_IMAGE=binary-insights/thalya-agents:client-${runId}`,
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
    "BINARY_CRM_ENABLED=false",
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
  await createSourceArchive(archive);
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
    await exec(
      client,
      `set -eu; mkdir -p ${remoteRoot}/source ${remoteRoot}/agents ${remoteRoot}/chatwoot ${remoteRoot}/langfuse`,
    );
    const port80Busy = await exec(
      client,
      "ss -lntH 2>/dev/null | awk '$4 ~ /:80$/ {found=1} END {exit(found ? 0 : 1)}'",
    )
      .then(() => true)
      .catch(() => false);
    if (port80Busy) {
      agentsEnv += "CADDY_HTTP_PORT=8080\nCADDY_HTTPS_PORT=8443\n";
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
    await upload(client, archive, `${remoteRoot}/source.tgz`);
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
    await patchRun(ctx, runId, { phase: "BUILDING", progress: 50 }, base);
    await log(
      ctx,
      runId,
      { level: "info", message: "Construindo a imagem Binary na VPS." },
      base,
    );
    await exec(
      client,
      `set -eu; rm -rf ${remoteRoot}/source/*; tar -xzf ${remoteRoot}/source.tgz -C ${remoteRoot}/source; docker build -t binary-insights/thalya-agents:client-${runId} ${remoteRoot}/source`,
    );
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
