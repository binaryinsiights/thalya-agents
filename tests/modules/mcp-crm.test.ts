import { describe, expect, test } from "bun:test";
import { crmCustomerCreate } from "@/modules/mcp/crm";
import type { VerifiedToken } from "@/modules/mcp/oauth/tokens";

function principal(over: Partial<VerifiedToken> = {}): VerifiedToken {
  return {
    userId: 1n,
    tenantId: 1n,
    role: "TENANT_ADMIN",
    scopes: ["mcp:read", "mcp:write"],
    clientId: "crm-test",
    jti: "crm-test",
    ...over,
  };
}

describe("CRM MCP tools", () => {
  test("rejects a write token without mcp:write", async () => {
    const result = await crmCustomerCreate(
      principal({ scopes: ["mcp:read"] }),
      { name: "Clínica Moreira", plan: "THALYA_ESSENCIAL" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("insufficient_scope");
  });

  test("customer create is dry-run by default and does not need a database", async () => {
    const result = await crmCustomerCreate(principal(), {
      name: "Clínica Moreira",
      plan: "THALYA_PROFISSIONAL",
      niche: "Odontologia",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.dryRun).toBe(true);
      expect(result.data.resource).toBe("crm_customer");
    }
  });

  test("requires an explicit tenant target", async () => {
    const result = await crmCustomerCreate(principal({ tenantId: null }), {
      name: "Clínica Moreira",
      plan: "THALYA_ENTERPRISE",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no tenant target");
  });
});
