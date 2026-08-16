export const CRM_PLAN_DEFINITIONS = [
  {
    schemaVersion: 1,
    planCode: "ESSENCIAL",
    version: "1.0.0",
    displayName: "Thalya Essencial",
    limits: {
      agents: 1,
      channels: 1,
      monthlyConversations: 500,
      knowledgeDocuments: 30,
      monthlyAudioMinutes: 0,
      monthlyTechnicalHours: 0,
      customIntegrations: 0,
    },
    features: {
      text: true,
      stt: false,
      tts: false,
      calendar: false,
      drive: false,
      followUp: false,
      asaas: false,
      customIntegrations: false,
      loadTest: false,
    },
    delivery: {
      support: "Horário comercial",
      adjustmentRounds: 2,
      commitmentMonths: 3,
      reporting: "simple",
    },
    acceptance: [
      "Atendimento textual validado",
      "Base de conhecimento com grounding validada",
      "Transferência humana validada",
      "Um canal validado",
      "Traces presentes no Langfuse",
    ],
  },
  {
    schemaVersion: 1,
    planCode: "PROFISSIONAL",
    version: "1.0.0",
    displayName: "Thalya Profissional",
    limits: {
      agents: 2,
      channels: 2,
      monthlyConversations: 1500,
      knowledgeDocuments: 100,
      monthlyAudioMinutes: 300,
      monthlyTechnicalHours: 3,
      customIntegrations: 0,
    },
    features: {
      text: true,
      stt: true,
      tts: true,
      calendar: true,
      drive: true,
      followUp: true,
      asaas: false,
      customIntegrations: false,
      loadTest: false,
    },
    delivery: {
      support: "Prioritário",
      adjustmentRounds: 3,
      commitmentMonths: 6,
      reporting: "operational",
    },
    acceptance: [
      "Todos os critérios do Essencial validados",
      "Transcrição e resposta em áudio validadas",
      "Agenda e regras de disponibilidade validadas",
      "Google Drive validado",
      "Follow-ups validados em modo de teste",
      "Até dois canais validados conforme contrato",
    ],
  },
  {
    schemaVersion: 1,
    planCode: "ENTERPRISE",
    version: "1.0.0",
    displayName: "Enterprise",
    limits: {
      agents: 4,
      channels: 4,
      monthlyConversations: 4000,
      knowledgeDocuments: 150,
      monthlyAudioMinutes: 300,
      monthlyTechnicalHours: 6,
      customIntegrations: 2,
    },
    features: {
      text: true,
      stt: true,
      tts: true,
      calendar: true,
      drive: true,
      followUp: true,
      asaas: true,
      customIntegrations: true,
      loadTest: true,
    },
    delivery: {
      support: "Prioritário com SLA contratual",
      adjustmentRounds: 3,
      commitmentMonths: 12,
      reporting: "advanced",
    },
    acceptance: [
      "Todos os critérios do Profissional validados",
      "Agentes especializados e roteamento validados",
      "Cobrança e consulta de pagamento validadas em ambiente seguro",
      "Integrações contratadas validadas",
      "Teste de carga aprovado",
      "Alertas, backup e restauração validados",
    ],
  },
] as const;

/**
 * Converts a persisted catalog version into the runtime shape consumed by the
 * provisioner. The built-in plan is only a fallback for legacy customers;
 * edited versions always override limits, features and delivery settings.
 */
export function runtimePlanDefinition(
  code: string,
  persisted?: { version: string; displayName: string; definition: unknown } | null,
) {
  const base = CRM_PLAN_DEFINITIONS.find((item) => item.planCode === code);
  const raw = persisted?.definition;
  if (!persisted || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (!base) return null;
    return base;
  }
  const definition = raw as Record<string, unknown>;
  const limits = definition.limits && typeof definition.limits === "object" ? definition.limits : {};
  const features = definition.features && typeof definition.features === "object" ? definition.features : {};
  const delivery = definition.delivery && typeof definition.delivery === "object" ? definition.delivery : {};
  return {
    ...(base ?? CRM_PLAN_DEFINITIONS[0]),
    planCode: code,
    version: persisted.version,
    displayName: persisted.displayName,
    limits: { ...(base?.limits ?? CRM_PLAN_DEFINITIONS[0].limits), ...(limits as object) },
    features: { ...(base?.features ?? CRM_PLAN_DEFINITIONS[0].features), ...(features as object) },
    delivery: { ...(base?.delivery ?? CRM_PLAN_DEFINITIONS[0].delivery), ...(delivery as object) },
    ...(Array.isArray(definition.acceptance) ? { acceptance: definition.acceptance } : {}),
  };
}

export const CRM_ONBOARDING_TEMPLATE = [
  ["GATE_0", "contract_approved", "Contrato aprovado"],
  ["GATE_0", "plan_registered", "Plano e versão registrados"],
  ["GATE_0", "niche_template", "Nicho e template definidos"],
  ["ACCESS", "vps_chosen", "VPS escolhida"],
  ["ACCESS", "domain_chosen", "Domínio escolhido"],
  ["ACCESS", "ssh_validated", "Acesso SSH validado"],
  ["INFRA", "orchestrator_healthy", "Orquestrador saudável"],
  ["INFRA", "chatwoot_deployed", "Chatwoot implantado"],
  ["INFRA", "baileys_deployed", "Baileys implantado com sessão isolada"],
  ["INFRA", "agents_deployed", "fazer.ai agents implantado"],
  ["INFRA", "langfuse_deployed", "Langfuse implantado com MinIO"],
  ["INFRA", "tls_valid", "TLS válido em todos os serviços"],
  ["CHATWOOT", "admin_created", "Administrador do Chatwoot criado"],
  ["CHATWOOT", "inbox_bound", "Inbox criado e vinculado"],
  ["AGENT", "setup_complete", "Setup do Agents concluído"],
  ["AGENT", "plan_loaded", "Perfil do plano carregado"],
  ["AGENT", "knowledge_ready", "Base de conhecimento em READY"],
  ["AGENT", "tools_limited", "Ferramentas limitadas ao plano"],
  ["AGENT", "langfuse_tracing", "Langfuse recebendo traces"],
  ["PRODUCTION", "homologation_approved", "Homologação aprovada"],
  ["PRODUCTION", "backups_configured", "Backups configurados"],
  ["PRODUCTION", "monitoring_active", "Monitoramento ativo"],
  ["PRODUCTION", "production_authorized", "Produção autorizada explicitamente"],
] as const;
