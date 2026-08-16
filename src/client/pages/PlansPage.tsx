import { Archive, Package, Plus, RotateCcw } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, PageContainer, Textarea } from "@/client/components";
import { api } from "@/client/lib/api";

type Workspace = NonNullable<Awaited<ReturnType<typeof api.api.v1.crm.get>>["data"]>;
type PlanVersion = Workspace["planVersions"][number];

const DEFAULT_DEFINITION = JSON.stringify(
  {
    limits: { agents: 1, channels: 1, monthlyConversations: 500 },
    features: { text: true },
  },
  null,
  2,
);

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
    new Date(value),
  );
}

/** Global plan catalog. Plan versions are immutable; archive preserves history. */
export function PlansPage() {
  const [rows, setRows] = useState<PlanVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await api.api.v1.crm.get();
    if (response.data) setRows(response.data.planVersions);
    else setError("Não foi possível carregar os planos.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let definition: unknown;
    try {
      definition = JSON.parse(String(form.get("definition") ?? "{}"));
    } catch {
      setError("A definição precisa ser um JSON válido.");
      return;
    }
    const response = await api.api.v1.crm.plans.versions.post({
      code: String(form.get("code") ?? ""),
      version: String(form.get("version") ?? ""),
      displayName: String(form.get("displayName") ?? ""),
      definition,
    });
    if (response.error) {
      setError("Não foi possível criar a versão do plano.");
      return;
    }
    setCreating(false);
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
          <h1 className="flex items-center gap-2 font-bold text-2xl text-text-primary">
            <Package className="h-6 w-6" aria-hidden="true" />
            Planos
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Catálogo comercial e versões usadas em novos clientes.
          </p>
        </div>
        <Button onClick={() => setCreating((value) => !value)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Novo plano
        </Button>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {creating && (
        <Card>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
            <label className="space-y-1 text-sm text-text-secondary">
              Código
              <Input name="code" placeholder="PROFISSIONAL" required />
            </label>
            <label className="space-y-1 text-sm text-text-secondary">
              Versão
              <Input name="version" placeholder="1.0.0" required />
            </label>
            <label className="space-y-1 text-sm text-text-secondary md:col-span-2">
              Nome exibido
              <Input name="displayName" placeholder="Profissional" required />
            </label>
            <label className="space-y-1 text-sm text-text-secondary md:col-span-2">
              Definição (JSON)
              <Textarea
                name="definition"
                defaultValue={DEFAULT_DEFINITION}
                className="min-h-48 font-mono text-xs"
                required
              />
            </label>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit">Salvar versão</Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {loading ? (
          <p className="text-sm text-text-secondary">Carregando planos…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-secondary">Nenhum plano cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="px-2 py-3 font-medium text-text-secondary">Plano</th>
                  <th className="px-2 py-3 font-medium text-text-secondary">Versão</th>
                  <th className="px-2 py-3 font-medium text-text-secondary">Publicado</th>
                  <th className="px-2 py-3 font-medium text-text-secondary">Estado</th>
                  <th className="px-2 py-3 font-medium text-text-secondary">Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className="border-border/50 border-b">
                    <td className="px-2 py-3 text-text-primary">{row.displayName} <span className="text-text-muted">({row.code})</span></td>
                    <td className="px-2 py-3 font-mono text-text-secondary">{row.version}</td>
                    <td className="px-2 py-3 text-text-secondary">{formatDate(row.publishedAt)}</td>
                    <td className="px-2 py-3">
                      <Badge variant={row.retiredAt ? "secondary" : "success"}>
                        {row.retiredAt ? "Arquivado" : "Ativo"}
                      </Badge>
                    </td>
                    <td className="px-2 py-3">
                      <Button variant="secondary" size="sm" onClick={() => void toggleArchived(row)}>
                        {row.retiredAt ? <RotateCcw className="mr-1 h-3.5 w-3.5" /> : <Archive className="mr-1 h-3.5 w-3.5" />}
                        {row.retiredAt ? "Reativar" : "Arquivar"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
