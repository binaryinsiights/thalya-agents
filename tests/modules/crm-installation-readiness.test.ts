import { describe, expect, test } from "bun:test";
import { installationReadiness } from "@/modules/crm/operations";

const complete = {
  technicalOwner: "Binary Insights",
  desiredDeliveryAt: new Date(),
  provider: "Hostinger",
  serverHost: "203.0.113.10",
  operatingSystem: "Ubuntu 24.04",
  region: "br",
  cpuCores: 4,
  memoryMb: 8192,
  diskGb: 80,
  orchestrator: "COOLIFY",
  orchestratorUrl: "https://coolify.example.com",
  orchestratorCredentialRef: "vault:1",
  dnsProvider: "Cloudflare",
  dnsZone: "example.com",
  dnsCredentialRef: "vault:2",
  agentsDomain: "agents.example.com",
  chatwootDomain: "chat.example.com",
  baileysDomain: "wa.example.com",
  langfuseDomain: "logs.example.com",
  acmeEmail: "admin@example.com",
  backupProvider: "R2",
  backupDestination: "bucket",
  backupCredentialRef: "vault:3",
  registryCredentialRef: "vault:4",
  authorized: true,
};

describe("CRM installation readiness", () => {
  test("an absent profile is never ready", () => {
    expect(installationReadiness(null)).toEqual({
      ready: false,
      percent: 0,
      missing: ["ficha técnica"],
    });
  });

  test("a complete Coolify profile is ready", () => {
    expect(installationReadiness(complete).ready).toBe(true);
    expect(installationReadiness(complete).percent).toBe(100);
  });

  test("Docker Compose requires SSH access instead of orchestrator access", () => {
    const result = installationReadiness({
      ...complete,
      orchestrator: "DOCKER_COMPOSE",
      orchestratorUrl: null,
      orchestratorCredentialRef: null,
    });
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("usuário SSH");
    expect(result.missing).toContain("credencial SSH");
  });

  test("registry, backup and automatic DNS credentials do not block preparation", () => {
    const result = installationReadiness({
      ...complete,
      registryCredentialRef: null,
      backupProvider: null,
      backupDestination: null,
      backupCredentialRef: null,
      dnsCredentialRef: null,
    });
    expect(result.ready).toBe(true);
    expect(result.percent).toBe(100);
  });
});
