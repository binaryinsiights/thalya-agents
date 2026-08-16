import { Archive, Package, Pencil, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, PageContainer } from "@/client/components";
import { api } from "@/client/lib/api";

type Workspace = NonNullable<Awaited<ReturnType<typeof api.api.v1.crm.get>>["data"]>;
type PlanVersion = Workspace["planVersions"][number];

const LIMIT_FIELDS = [
  ["agents", "Agentes"],
  ["channels", "Canais"],
  ["monthlyConversations", "Conversas mensais"],
  ["knowledgeDocuments", "Documentos de conhecimento"],
  ["monthlyAudioMinutes", "Minutos de áudio mensais"],
  ["monthlyTechnicalHours", "Horas técnicas mensais"],
  ["customIntegrations", "Integrações personalizadas"],
] as const;

const FEATURE_FIELDS = [
  ["text", "Atendimento por texto"],
  ["stt", "Transcrição de áudio (STT)"],
  ["tts", "Resposta em áudio (TTS)"],
  ["calendar", "Agenda"],
  ["drive", "Google Drive"],
  ["followUp", "Follow-ups"],
  ["asaas", "Asaas / cobrança"],
  ["customIntegrations", "Integrações personalizadas"],
  ["loadTest", "Teste de carga"],
  ["vision", "Visão para imagens e documentos"],
  ["memory", "Memória durável por conversa"],
  ["debounce", "Debounce de mensagens"],
  ["typing", "Digitando e respostas humanizadas"],
  ["playground", "Playground"],
  ["humanHandoff", "Handoff para humano"],
  ["httpTools", "Ferramentas HTTP"],
  ["nativeTools", "Ferramentas nativas"],
  ["toolpacks", "Toolpacks"],
  ["mcp", "Servidores MCP"],
  ["omnichannel", "Omnichannel"],
  ["inboxRouting", "Roteamento por inbox"],
  ["hsmTemplates", "Templates HSM"],
  ["reminders", "Lembretes automáticos"],
  ["specializedAgents", "Agentes especializados"],
  ["alerts", "Alertas Discord/webhook"],
  ["outboundWebhooks", "Webhooks de saída"],
] as const;

const MANDATORY_PLATFORM = [
  "Langfuse e traces",
  "Logs de execução",
  "Auditoria administrativa",
  "Monitoramento e health checks",
  "Backups e restauração",
] as const;

const FEATURE_GROUPS = [
  ["Agente e multimodalidade", ["text", "stt", "tts", "vision", "memory", "debounce", "typing", "playground", "humanHandoff"]],
  ["Conhecimento e ferramentas", ["calendar", "drive", "httpTools", "nativeTools", "toolpacks", "mcp", "customIntegrations"]],
  ["Canais e operação", ["omnichannel", "inboxRouting", "hsmTemplates", "followUp", "reminders", "specializedAgents", "asaas"]],
  ["Plataforma e automações", ["alerts", "outboundWebhooks", "loadTest"]],
] as const;


type PlanForm = {
  code: string;
  version: string;
  displayName: string;
  limits: Record<string, number>;
  features: Record<string, boolean>;
};

const emptyForm = (): PlanForm => ({
  code: "",
  version: "1.0.0",
  displayName: "",
  limits: Object.fromEntries(LIMIT_FIELDS.map(([key]) => [key, 0])),
  features: Object.fromEntries(FEATURE_FIELDS.map(([key]) => [key, false])),
});

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function nextVersion(version: string) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "1.0.0";
}

function formFromRow(row: PlanVersion): PlanForm {
  const definition = (row.definition ?? {}) as Record<string, any>;
  const base = emptyForm();
  return {
    code: row.code,
    version: nextVersion(row.version),
    displayName: row.displayName,
    limits: { ...base.limits, ...(definition.limits ?? {}) },
    features: { ...base.features, ...(definition.features ?? {}) },
  };
}

/** Global plan catalog. Versions are immutable; editing creates the next version. */
export function PlansPage() {
  const [rows, setRows] = useState<PlanVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await api.api.v1.crm.get();
    if (response.data) setRows(response.data.planVersions);
    else setError("Não foi possível carregar os planos.");
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    const response = await api.api.v1.crm.plans.versions.post({
      code: form.code,
      version: form.version,
      displayName: form.displayName,
      definition: {
        schemaVersion: 1,
        limits: form.limits,
        features: form.features,
      },
    });
    if (response.error) {
      setError("Não foi possível salvar a versão do plano. Verifique código e versão.");
      return;
    }
    setForm(null);
    await load();
  };

  const toggleArchived = async (row: PlanVersion) => {
    const response = await api.api.v1.crm.plans.versions({ id: String(row.id) }).retire.patch({});
    if (response.error) setError("Não foi possível atualizar o plano.");
    else await load();
  };

  return (
    <PageContainer className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-bold text-2xl text-text-primary"><Package className="h-6 w-6" aria-hidden="true" />Planos</h1>
          <p className="mt-1 text-sm text-text-secondary">Catálogo comercial e versões usadas em novos clientes.</p>
        </div>
        <Button onClick={() => setForm(emptyForm())}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Novo plano</Button>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {form && (
        <Card>
          <form className="space-y-6" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-1 text-sm text-text-secondary">Código<Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="PROFISSIONAL" required /></label>
              <label className="space-y-1 text-sm text-text-secondary">Versão<Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.0.0" required /></label>
              <label className="space-y-1 text-sm text-text-secondary">Nome exibido<Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Profissional" required /></label>
            </div>

            <fieldset>
              <legend className="mb-3 font-semibold text-text-primary">Limites do plano</legend>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {LIMIT_FIELDS.map(([key, label]) => (
                  <label key={key} className="space-y-1 text-sm text-text-secondary">{label}<Input type="number" min="0" value={form.limits[key] ?? 0} onChange={(e) => setForm({ ...form, limits: { ...form.limits, [key]: Number(e.target.value) } })} /></label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-3 font-semibold text-text-primary">Recursos disponíveis</legend>
              <div className="mb-5 rounded-lg border border-border bg-bg-tertiary p-4">
                <h3 className="mb-2 text-sm font-semibold text-text-primary">Sempre incluídos</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {MANDATORY_PLATFORM.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm text-text-secondary">
                      <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {FEATURE_GROUPS.map(([group, keys]) => (
                  <div key={group}>
                    <h3 className="mb-2 text-sm text-text-secondary">{group}</h3>
                    <div className="space-y-2">
                      {keys.map((key) => {
                        const item = FEATURE_FIELDS.find(([field]) => field === key);
                        if (!item) return null;
                        return (
                          <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                            <input type="checkbox" checked={form.features[key] ?? false} onChange={(e) => setForm({ ...form, features: { ...form.features, [key]: e.target.checked } })} className="h-4 w-4 accent-accent" />
                            {item[1]}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-2"><Button type="submit">Salvar versão</Button><Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button></div>
          </form>
        </Card>
      )}

      <Card>
        {loading ? <p className="text-sm text-text-secondary">Carregando planos…</p> : rows.length === 0 ? <p className="text-sm text-text-secondary">Nenhum plano cadastrado.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-border border-b text-left"><th className="px-2 py-3 font-medium text-text-secondary">Plano</th><th className="px-2 py-3 font-medium text-text-secondary">Versão</th><th className="px-2 py-3 font-medium text-text-secondary">Publicado</th><th className="px-2 py-3 font-medium text-text-secondary">Estado</th><th className="px-2 py-3 font-medium text-text-secondary">Ação</th></tr></thead><tbody>
            {rows.map((row) => <tr key={String(row.id)} className="border-border/50 border-b"><td className="px-2 py-3 text-text-primary">{row.displayName} <span className="text-text-muted">({row.code})</span></td><td className="px-2 py-3 font-mono text-text-secondary">{row.version}</td><td className="px-2 py-3 text-text-secondary">{formatDate(row.publishedAt)}</td><td className="px-2 py-3"><Badge variant={row.retiredAt ? "secondary" : "success"}>{row.retiredAt ? "Arquivado" : "Ativo"}</Badge></td><td className="flex gap-2 px-2 py-3"><Button variant="secondary" size="sm" onClick={() => setForm(formFromRow(row))}><Pencil className="mr-1 h-3.5 w-3.5" />Editar</Button><Button variant="secondary" size="sm" onClick={() => void toggleArchived(row)}>{row.retiredAt ? <RotateCcw className="mr-1 h-3.5 w-3.5" /> : <Archive className="mr-1 h-3.5 w-3.5" />}{row.retiredAt ? "Reativar" : "Arquivar"}</Button></td></tr>)}
          </tbody></table></div>
        )}
      </Card>
    </PageContainer>
  );
}
