// biome-ignore-all lint/style/noJsxLiterals: CRM copy is intentionally Portuguese for the Binary Insights console.
import {
  Activity,
  Bot,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  FileText,
  HeartPulse,
  History,
  ListChecks,
  Plus,
  Search,
  Server,
  TriangleAlert,
  Users,
  Wrench,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  DataBoundary,
  EmptyState,
  Input,
  PageContainer,
  Select,
  Textarea,
} from "@/client/components";
import { api } from "@/client/lib/api";
import { cn } from "@/client/lib/utils";

type Workspace = NonNullable<
  Awaited<ReturnType<typeof api.api.v1.crm.get>>["data"]
>;
type Customer = Workspace["customers"][number];
type Deployment = Workspace["deployments"][number];
type RemoteAgent = Workspace["agents"][number];
type LocalAgent = Workspace["localAgents"][number];

const SECTIONS = [
  { id: "overview", label: "Visão geral", icon: Activity },
  { id: "customers", label: "Clientes", icon: Users },
  { id: "pipeline", label: "Pipeline", icon: CircleDollarSign },
  { id: "contracts", label: "Planos e contratos", icon: FileText },
  { id: "deployments", label: "Implantações", icon: Server },
  { id: "monitoring", label: "Monitoramento", icon: HeartPulse },
  { id: "maintenance", label: "Manutenções", icon: Wrench },
  { id: "audit", label: "Auditoria", icon: History },
] as const;

const badgeVariant = (status: string) => {
  if (["ACTIVE", "HEALTHY", "DONE", "CONNECTED"].includes(status))
    return "success" as const;
  if (["ERROR", "CRITICAL", "OVERDUE", "BLOCKED"].includes(status))
    return "error" as const;
  if (["PENDING", "WARNING", "PLANNED", "UNKNOWN"].includes(status))
    return "warning" as const;
  return "secondary" as const;
};

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Activity;
}) {
  return (
    <Card className="flex items-center justify-between p-5">
      <div>
        <p className="text-sm text-text-secondary">{label}</p>
        <p className="mt-1 font-bold text-3xl text-text-primary">{value}</p>
      </div>
      <span className="rounded-xl bg-bg-tertiary p-3 text-accent">
        <Icon className="h-5 w-5" />
      </span>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block font-medium text-sm text-text-secondary">
        {label}
      </span>
      {children}
    </div>
  );
}

export function CrmPage() {
  const { section = "overview" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await api.api.v1.crm.get();
    if (response.error) setError(true);
    else {
      setData(response.data);
      setError(false);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const customers = useMemo(
    () =>
      (data?.customers ?? []).filter((x) =>
        [x.name, x.contactName, x.niche, x.plan].some((v) =>
          v?.toLowerCase().includes(search.toLowerCase()),
        ),
      ),
    [data, search],
  );
  const deployments = useMemo(
    () =>
      (data?.deployments ?? []).filter((x) =>
        [x.name, x.customer.name, x.domain].some((v) =>
          v?.toLowerCase().includes(search.toLowerCase()),
        ),
      ),
    [data, search],
  );
  const agents = useMemo(
    () =>
      (data?.agents ?? []).filter((x) =>
        [x.name, x.function, x.deployment.customer.name].some((v) =>
          v?.toLowerCase().includes(search.toLowerCase()),
        ),
      ),
    [data, search],
  );

  const submitCustomer = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const response = await api.api.v1.crm.customers.post(values);
    if (!response.error) {
      setCreating(false);
      await load();
      navigate("/crm/contracts");
    }
  };
  const submitDeployment = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const response = await api.api.v1.crm.deployments.post(values);
    if (!response.error) {
      setCreating(false);
      await load();
      navigate("/crm/installation-profile");
    }
  };
  const submitAgent = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const response = await api.api.v1.crm.agents.post(values);
    if (!response.error) {
      setCreating(false);
      await load();
    }
  };

  const canCreate = [
    "customers",
    "deployments",
    "agents",
    "contracts",
    "maintenance",
  ].includes(section);
  return (
    <PageContainer className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl text-text-primary">
            CRM Binary Insights
          </h1>
          <p className="mt-1 text-text-secondary">
            Gestão comercial, implantação e operação da sua carteira de agentes.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="h-4 w-4" />
            {section === "customers"
              ? "Novo cliente"
              : section === "deployments"
                ? "Nova instalação"
                : section === "contracts"
                  ? "Novo contrato"
                  : section === "maintenance"
                    ? "Nova manutenção"
                    : "Novo agente"}
          </Button>
        )}
      </header>
      <nav
        className="flex gap-1 overflow-x-auto border-border border-b"
        aria-label="Áreas do CRM"
      >
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setCreating(false);
              navigate(`/crm/${id}`);
            }}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 font-medium text-sm",
              section === id
                ? "border-accent text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>
      {["deployments", "installation-profile", "onboarding", "agents"].includes(
        section,
      ) && <DeploymentFlowNav active={section} navigate={navigate} />}
      <DataBoundary loading={loading} error={error} onRetry={load}>
        {data && (
          <>
            {section === "overview" && <Overview data={data} />}
            {section === "customers" && (
              <Customers
                rows={customers}
                plans={data.plans}
                contacts={data.contacts}
                creating={creating}
                onSubmit={submitCustomer}
                search={search}
                setSearch={setSearch}
              />
            )}
            {section === "pipeline" && (
              <Pipeline rows={data.customers} reload={load} />
            )}
            {section === "contracts" && (
              <Contracts data={data} creating={creating} reload={load} />
            )}
            {section === "deployments" && (
              <Deployments
                rows={deployments}
                contracts={data.contracts}
                creating={creating}
                onSubmit={submitDeployment}
                search={search}
                setSearch={setSearch}
              />
            )}
            {section === "installation-profile" && (
              <InstallationProfiles data={data} reload={load} />
            )}
            {section === "agents" && (
              <Agents
                rows={agents}
                localRows={data.localAgents}
                deployments={data.deployments}
                plans={data.plans}
                creating={creating}
                onSubmit={submitAgent}
                search={search}
                setSearch={setSearch}
              />
            )}
            {section === "onboarding" && (
              <Onboarding data={data} reload={load} />
            )}
            {section === "monitoring" && <Monitoring data={data} />}
            {section === "maintenance" && (
              <Maintenance data={data} creating={creating} reload={load} />
            )}
            {section === "audit" && <AuditTrail data={data} />}
          </>
        )}
      </DataBoundary>
    </PageContainer>
  );
}

function DeploymentFlowNav({
  active,
  navigate,
}: {
  active: string;
  navigate(path: string): void;
}) {
  const steps = [
    ["deployments", "1. Cliente e instalação"],
    ["installation-profile", "2. Acessos e hospedagem"],
    ["onboarding", "3. Serviços e checklist"],
    ["agents", "4. Configurar agente"],
  ] as const;
  return (
    <Card className="p-3">
      <div className="flex gap-2 overflow-x-auto">
        {steps.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={active === id ? "primary" : "secondary"}
            onClick={() => navigate(`/crm/${id}`)}
          >
            {label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function Overview({ data }: { data: Workspace }) {
  const s = data.summary;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Clientes" value={s.customers} icon={Users} />
        <Metric
          label="Instalações saudáveis"
          value={s.healthyDeployments}
          icon={Server}
        />
        <Metric label="Agentes ativos" value={s.activeAgents} icon={Bot} />
        <Metric
          label="Alertas abertos"
          value={s.openAlerts}
          icon={TriangleAlert}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-text-primary">
            Implantações em andamento
          </h2>
          <div className="mt-4 space-y-3">
            {data.deployments.slice(0, 5).map((x) => (
              <Row
                key={x.id}
                title={x.customer.name}
                subtitle={x.name}
                status={x.status}
              />
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="font-semibold text-text-primary">
            Atenção operacional
          </h2>
          <div className="mt-4 space-y-3">
            {data.alerts
              .filter((x) => x.status === "OPEN")
              .slice(0, 5)
              .map((x) => (
                <Row
                  key={x.id}
                  title={x.title}
                  subtitle={
                    x.deployment?.customer.name ?? x.source ?? "Sistema"
                  }
                  status={x.severity}
                />
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SearchBox({
  value,
  setValue,
}: {
  value: string;
  setValue(v: string): void;
}) {
  return (
    <div className="relative max-w-lg">
      <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar…"
        className="pl-9"
      />
    </div>
  );
}
function Row({
  title,
  subtitle,
  status,
  href,
}: {
  title: string;
  subtitle?: string | null;
  status: string;
  href?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-tertiary p-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-text-primary">{title}</p>
        {subtitle && (
          <p className="truncate text-sm text-text-secondary">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={badgeVariant(status)}>{status}</Badge>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-text-secondary hover:text-accent"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function Customers({
  rows,
  plans,
  contacts,
  creating,
  onSubmit,
  search,
  setSearch,
}: {
  rows: Customer[];
  plans: Workspace["plans"];
  contacts: Workspace["contacts"];
  creating: boolean;
  onSubmit(e: FormEvent<HTMLFormElement>): void;
  search: string;
  setSearch(v: string): void;
}) {
  return (
    <div className="space-y-4">
      {creating && (
        <Card>
          <h2 className="mb-4 font-semibold text-text-primary">
            Cadastrar lead ou cliente
          </h2>
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
            <Field label="Nome da empresa ou cliente">
              <Input name="name" required />
            </Field>
            <Field label="Razão social (opcional)">
              <Input name="legalName" />
            </Field>
            <Field label="CPF ou CNPJ (opcional)">
              <Input name="document" />
            </Field>
            <Field label="Nicho">
              <Input name="niche" placeholder="Odontologia, veterinária…" />
            </Field>
            <Field label="Responsável">
              <Input name="contactName" />
            </Field>
            <Field label="Telefone">
              <Input name="contactPhone" />
            </Field>
            <Field label="E-mail do responsável">
              <Input name="contactEmail" type="email" />
            </Field>
            <Field label="Plano de interesse">
              <Select name="plan" required>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Observações">
              <Input name="notes" />
            </Field>
            <Field label="Etapa comercial">
              <Select name="commercialStatus">
                <option value="LEAD">Lead</option>
                <option value="QUALIFIED">Qualificado</option>
                <option value="PROPOSAL">Proposta</option>
                <option value="ACTIVE">Cliente ativo</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">Salvar cliente</Button>
            </div>
          </form>
        </Card>
      )}
      <SearchBox value={search} setValue={setSearch} />
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((x) => (
          <Card key={x.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-text-primary">{x.name}</h3>
                <p className="text-sm text-text-secondary">
                  {x.niche ?? "Nicho não informado"} ·{" "}
                  {x.contactName ?? "Sem responsável"}
                </p>
              </div>
              <Badge variant={badgeVariant(x.commercialStatus)}>
                {x.commercialStatus}
              </Badge>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-text-secondary">
                {x.plan.replaceAll("_", " ")}
              </span>
              <span className="text-text-muted">
                {x._count.deployments} instalação(ões)
              </span>
            </div>
            <div className="mt-3 border-border border-t pt-3">
              {contacts
                .filter((contact) => String(contact.customerId) === x.id)
                .map((contact) => (
                  <p key={contact.id} className="text-sm text-text-secondary">
                    {contact.name}
                    {contact.role ? ` · ${contact.role}` : ""}
                    {contact.phone ? ` · ${contact.phone}` : ""}
                  </p>
                ))}
            </div>
          </Card>
        ))}
      </div>
      {rows.length === 0 && (
        <EmptyState
          icon={Building2}
          title="Nenhum cliente encontrado"
          description="Cadastre o primeiro cliente da Binary Insights."
        />
      )}
    </div>
  );
}

function Pipeline({
  rows,
  reload,
}: {
  rows: Customer[];
  reload(): Promise<void>;
}) {
  const columns = ["LEAD", "QUALIFIED", "PROPOSAL", "ACTIVE"];
  const move = async (id: string, commercialStatus: string) => {
    await api.api.v1.crm.customers({ id }).patch({ commercialStatus });
    await reload();
  };
  return (
    <div className="grid gap-4 xl:grid-cols-4">
      {columns.map((status) => (
        <div key={status} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">{status}</h2>
            <Badge>
              {rows.filter((x) => x.commercialStatus === status).length}
            </Badge>
          </div>
          {rows
            .filter((x) => x.commercialStatus === status)
            .map((x) => (
              <Card key={x.id} className="p-4">
                <p className="font-medium text-text-primary">{x.name}</p>
                <p className="mt-1 text-sm text-text-secondary">
                  {x.plan.replaceAll("_", " ")}
                </p>
                <Select
                  className="mt-3"
                  value={x.commercialStatus}
                  onChange={(event) => void move(x.id, event.target.value)}
                >
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </Select>
              </Card>
            ))}
        </div>
      ))}
    </div>
  );
}

function Contracts({
  data,
  creating,
  reload,
}: {
  data: Workspace;
  creating: boolean;
  reload(): Promise<void>;
}) {
  const navigate = useNavigate();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values: Record<string, unknown> = Object.fromEntries(
      new FormData(event.currentTarget),
    );
    const response = await api.api.v1.crm.contracts.post(values);
    if (response.error) return;
    await reload();
    navigate("/crm/deployments");
  };
  return (
    <div className="space-y-5">
      {creating && (
        <Card>
          <h2 className="mb-4 font-semibold text-text-primary">
            Novo contrato
          </h2>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <Field label="Cliente">
              <Select name="customerId">
                {data.customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Plano e versão">
              <Select name="planVersionId">
                {data.planVersions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.version}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Início">
              <Input name="startsAt" type="date" required />
            </Field>
            <Field label="Término">
              <Input name="endsAt" type="date" />
            </Field>
            <Field label="Mensalidade">
              <Input name="monthlyAmount" type="number" step="0.01" />
            </Field>
            <Field label="Dia de cobrança">
              <Input name="billingDay" type="number" min="1" max="31" />
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">Salvar contrato</Button>
            </div>
          </form>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {data.planVersions.map((plan) => {
          const definition = plan.definition as {
            limits?: Record<string, number>;
            delivery?: { support?: string };
          };
          return (
            <Card key={plan.id} className="p-5">
              <h3 className="font-semibold text-text-primary">
                {plan.displayName}
              </h3>
              <p className="text-sm text-text-secondary">
                Versão imutável {plan.version}
              </p>
              <div className="mt-4 space-y-2 text-sm text-text-secondary">
                {Object.entries(definition.limits ?? {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span>{key}</span>
                    <strong className="text-text-primary">{value}</strong>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-text-muted">
                {definition.delivery?.support}
              </p>
            </Card>
          );
        })}
      </div>
      <Card>
        <h2 className="mb-4 font-semibold text-text-primary">
          Contratos ativos e históricos
        </h2>
        <div className="space-y-3">
          {data.contracts.map((item) => (
            <Row
              key={item.id}
              title={item.customer.name}
              subtitle={`${item.planVersion.displayName} · ${item.planVersion.version}`}
              status={item.status}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Deployments({
  rows,
  contracts,
  creating,
  onSubmit,
  search,
  setSearch,
}: {
  rows: Deployment[];
  contracts: Workspace["contracts"];
  creating: boolean;
  onSubmit(e: FormEvent<HTMLFormElement>): void;
  search: string;
  setSearch(v: string): void;
}) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      {creating && (
        <Card>
          <h2 className="mb-4 font-semibold text-text-primary">
            Cadastrar instalação dedicada
          </h2>
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
            <Field label="Contrato vendido">
              <Select name="contractId" required>
                {contracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>
                    {contract.customer.name} ·{" "}
                    {contract.planVersion.displayName}
                    {" · "}
                    {contract.planVersion.version}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nome da instalação">
              <Input name="name" required placeholder="Produção principal" />
            </Field>
            <Field label="Ambiente">
              <Select name="environment" defaultValue="PRODUCTION">
                <option value="PRODUCTION">Produção</option>
                <option value="STAGING">Preparação</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">Salvar instalação</Button>
            </div>
          </form>
        </Card>
      )}
      <SearchBox value={search} setValue={setSearch} />
      <div className="space-y-3">
        {rows.map((x) => (
          <Card key={x.id} className="p-4">
            <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_auto]">
              <div>
                <h3 className="font-semibold text-text-primary">
                  {x.customer.name} · {x.name}
                </h3>
                <p className="text-sm text-text-secondary">
                  {x.domain ?? x.orchestrator ?? "Infraestrutura pendente"}
                </p>
              </div>
              <Badge variant={badgeVariant(x.health)}>{x.health}</Badge>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigate(`/crm/installation-profile?deployment=${x.id}`)
                  }
                >
                  Acessos e hospedagem
                </Button>
                {[x.agentsUrl, x.chatwootUrl, x.langfuseUrl, x.baileysUrl]
                  .filter(Boolean)
                  .map((url) => (
                    <a
                      key={url}
                      href={url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-border p-2 text-text-secondary hover:text-accent"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function InstallationProfiles({
  data,
  reload,
}: {
  data: Workspace;
  reload(): Promise<void>;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedDeployment = searchParams.get("deployment");
  const [deploymentId, setDeploymentId] = useState(() =>
    requestedDeployment &&
    data.deployments.some((item) => item.id === requestedDeployment)
      ? requestedDeployment
      : (data.deployments[0]?.id ?? ""),
  );
  const profile = data.installationProfiles.find(
    (item) => String(item.deploymentId) === deploymentId,
  );
  const [method, setMethod] = useState(
    String(profile?.orchestrator ?? "DOCKER_COMPOSE"),
  );
  const [dnsMode, setDnsMode] = useState(String(profile?.dnsMode ?? "MANUAL"));
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  useEffect(() => {
    setMethod(String(profile?.orchestrator ?? "DOCKER_COMPOSE"));
    setDnsMode(String(profile?.dnsMode ?? "MANUAL"));
    setSaveState("idle");
  }, [profile?.orchestrator, profile?.dnsMode]);
  const deployment = data.deployments.find((item) => item.id === deploymentId);
  const value = (key: string) =>
    String(
      (profile as unknown as Record<string, unknown> | undefined)?.[key] ?? "",
    );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveState("saving");
    const values: Record<string, unknown> = Object.fromEntries(
      new FormData(event.currentTarget),
    );
    values.authorized = values.authorized === "on";
    const response = await api.api.v1.crm
      .deployments({ id: deploymentId })
      ["installation-profile"].put(values);
    if (response.error) {
      setSaveState("error");
      return;
    }
    await reload();
    setSaveState("saved");
    navigate("/crm/onboarding");
  };
  if (!deployment) {
    return (
      <EmptyState
        icon={FileText}
        title="Nenhuma instalação cadastrada"
        description="Cadastre a instalação antes de preencher a ficha técnica."
      />
    );
  }
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-5 rounded-lg bg-bg-tertiary p-4 text-sm text-text-secondary">
          <strong className="text-text-primary">Preencha nesta ordem:</strong>{" "}
          acesso à VPS, domínios e autorização. Salve quando quiser. Chaves e
          tokens informados aqui são enviados ao Cofre criptografado
          automaticamente e nunca voltam para a tela.
        </div>
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto]">
          <Field label="Instalação">
            <Select
              value={deploymentId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextProfile = data.installationProfiles.find(
                  (item) => String(item.deploymentId) === nextId,
                );
                setDeploymentId(nextId);
                setMethod(
                  String(nextProfile?.orchestrator ?? "DOCKER_COMPOSE"),
                );
                setDnsMode(String(nextProfile?.dnsMode ?? "MANUAL"));
              }}
            >
              {data.deployments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customer.name} · {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="min-w-64">
            <div className="flex justify-between text-sm text-text-secondary">
              <span>Prontidão para instalar</span>
              <strong>{profile?.readiness.percent ?? 0}%</strong>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full bg-accent"
                style={{ width: `${profile?.readiness.percent ?? 0}%` }}
              />
            </div>
          </div>
        </div>
        {profile && !profile.readiness.ready && (
          <p className="mt-3 text-sm text-warning">
            Faltando: {profile.readiness.missing.join(", ")}
          </p>
        )}
      </Card>
      <form key={deploymentId} onSubmit={submit} className="space-y-4">
        <ProfileSection title="Identificação">
          <Field label="Responsável técnico Binary Insights">
            <Input
              name="technicalOwner"
              defaultValue={value("technicalOwner")}
            />
          </Field>
          <Field label="Entrega desejada">
            <Input
              name="desiredDeliveryAt"
              type="date"
              defaultValue={value("desiredDeliveryAt").slice(0, 10)}
            />
          </Field>
        </ProfileSection>
        <ProfileSection title="Acesso à VPS">
          <Field label="IP ou hostname">
            <Input name="serverHost" defaultValue={value("serverHost")} />
          </Field>
          <Field label="Porta SSH">
            <Input
              name="serverPort"
              type="number"
              defaultValue={value("serverPort") || "22"}
            />
          </Field>
          <Field label="Usuário SSH">
            <Input name="serverUser" defaultValue={value("serverUser")} />
          </Field>
          <Field label="Chave privada SSH">
            <Textarea
              name="sshSecret"
              rows={6}
              autoComplete="off"
              placeholder={
                profile?.sshCredentialRef
                  ? "Chave já salva. Deixe vazio para manter."
                  : "Cole a chave privada SSH"
              }
            />
            {profile?.sshCredentialRef && (
              <p className="mt-1 text-success text-xs">
                Chave SSH armazenada com segurança.
              </p>
            )}
          </Field>
          <Field label="Senha da chave SSH (opcional)">
            <Input
              name="sshPassphraseSecret"
              type="password"
              autoComplete="new-password"
              placeholder={
                profile?.sshPassphraseRef
                  ? "Senha já salva. Deixe vazio para manter."
                  : "Preencha somente se a chave tiver senha"
              }
            />
          </Field>
        </ProfileSection>
        <ProfileSection title="Orquestrador">
          <Field label="Método">
            <Select
              name="orchestrator"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="DOCKER_COMPOSE">Docker Compose via SSH</option>
            </Select>
            <p className="mt-1 text-text-secondary text-xs">
              A Binary instala diretamente na VPS; nenhum painel adicional é
              necessário.
            </p>
          </Field>
          {method !== "DOCKER_COMPOSE" && (
            <>
              <Field label="URL do orquestrador">
                <Input
                  name="orchestratorUrl"
                  type="url"
                  defaultValue={value("orchestratorUrl")}
                />
              </Field>
              <Field label="Token do orquestrador">
                <Input
                  name="orchestratorSecret"
                  type="password"
                  placeholder={
                    profile?.orchestratorCredentialRef
                      ? "Token já salvo. Deixe vazio para manter."
                      : "Cole o token"
                  }
                />
              </Field>
            </>
          )}
        </ProfileSection>
        <ProfileSection title="DNS, domínios e TLS">
          <Field label="Configuração do DNS">
            <Select
              name="dnsMode"
              value={dnsMode}
              onChange={(event) => setDnsMode(event.target.value)}
            >
              <option value="MANUAL">Manual, pelo painel do domínio</option>
              <option value="AUTOMATIC">Automática, usando token</option>
            </Select>
          </Field>
          <Field label="Provedor DNS">
            <Input name="dnsProvider" defaultValue={value("dnsProvider")} />
          </Field>
          <Field label="Zona DNS">
            <Input
              name="dnsZone"
              defaultValue={value("dnsZone")}
              placeholder="cliente.com.br"
            />
          </Field>
          {dnsMode === "AUTOMATIC" && (
            <Field label="Token do provedor DNS">
              <Input
                name="dnsSecret"
                type="password"
                autoComplete="new-password"
                placeholder={
                  profile?.dnsCredentialRef
                    ? "Token já salvo. Deixe vazio para manter."
                    : "Cole o token com permissão para editar DNS"
                }
              />
            </Field>
          )}
          <Field label="Domínio Agents">
            <Input name="agentsDomain" defaultValue={value("agentsDomain")} />
          </Field>
          <Field label="Domínio Chatwoot">
            <Input
              name="chatwootDomain"
              defaultValue={value("chatwootDomain")}
            />
          </Field>
          <Field label="Domínio Baileys">
            <Input name="baileysDomain" defaultValue={value("baileysDomain")} />
          </Field>
          <Field label="Domínio Langfuse">
            <Input
              name="langfuseDomain"
              defaultValue={value("langfuseDomain")}
            />
          </Field>
          <Field label="E-mail administrador Langfuse">
            <Input
              name="langfuseAdminEmail"
              type="email"
              defaultValue={value("langfuseAdminEmail")}
            />
          </Field>
          <Field label="Senha inicial do Langfuse">
            <Input
              name="langfuseAdminPasswordSecret"
              type="password"
              autoComplete="new-password"
              placeholder={
                profile?.langfuseAdminPasswordRef
                  ? "Senha já salva. Deixe vazio para manter."
                  : "Defina a senha inicial do administrador"
              }
            />
          </Field>
          <Field label="E-mail para TLS">
            <Input
              name="acmeEmail"
              type="email"
              defaultValue={value("acmeEmail")}
            />
          </Field>
        </ProfileSection>
        <ProfileSection title="Autorização">
          <Field label="Autorizado por">
            <Input name="authorizedBy" defaultValue={value("authorizedBy")} />
          </Field>
          <Field label="Observações">
            <Input name="notes" defaultValue={value("notes")} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              name="authorized"
              type="checkbox"
              defaultChecked={profile?.authorized ?? false}
            />
            Autorizo o início da implantação nesta infraestrutura
          </label>
        </ProfileSection>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saveState === "saving"}>
            {saveState === "saving" ? "Salvando..." : "Salvar ficha"}
          </Button>
          {saveState === "saved" && (
            <span className="text-sm text-success">Ficha salva.</span>
          )}
          {saveState === "error" && (
            <span className="text-error text-sm">
              Não foi possível salvar. Confira os campos preenchidos.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-text-primary">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </Card>
  );
}

function Agents({
  rows,
  localRows,
  deployments,
  plans,
  creating,
  onSubmit,
  search,
  setSearch,
}: {
  rows: RemoteAgent[];
  localRows: LocalAgent[];
  deployments: Workspace["deployments"];
  plans: Workspace["plans"];
  creating: boolean;
  onSubmit(e: FormEvent<HTMLFormElement>): void;
  search: string;
  setSearch(v: string): void;
}) {
  return (
    <div className="space-y-4">
      {creating && (
        <Card>
          <h2 className="mb-4 font-semibold text-text-primary">
            Vincular agente gerenciado
          </h2>
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
            <Field label="Instalação">
              <Select name="deploymentId" required>
                {deployments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.customer.name} · {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nome do agente">
              <Input name="name" required />
            </Field>
            <Field label="Função">
              <Input name="function" placeholder="Secretária de atendimento" />
            </Field>
            <Field label="Plano">
              <Select name="plan" required>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Modo">
              <Select name="mode">
                <option value="TEST">Teste</option>
                <option value="PRODUCTION">Produção</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">Salvar agente</Button>
            </div>
          </form>
        </Card>
      )}
      <SearchBox value={search} setValue={setSearch} />
      <div className="grid gap-3 lg:grid-cols-2">
        {localRows
          .filter((x) => x.name.toLowerCase().includes(search.toLowerCase()))
          .map((x) => (
            <Card key={`local-${x.id}`} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-text-primary">{x.name}</h3>
                  <p className="text-sm text-text-secondary">
                    Binary Insights · agente desta instalação
                  </p>
                </div>
                <Badge variant={badgeVariant(x.status)}>{x.status}</Badge>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm text-text-secondary">
                <span>{x.mode}</span>
                <a href={x.deepLink} className="text-accent">
                  Abrir agente
                </a>
              </div>
            </Card>
          ))}
        {rows.map((x) => (
          <Card key={x.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-text-primary">{x.name}</h3>
                <p className="text-sm text-text-secondary">
                  {x.deployment.customer.name} ·{" "}
                  {x.function ?? "Função não informada"}
                </p>
              </div>
              <Badge variant={badgeVariant(x.status)}>{x.status}</Badge>
            </div>
            <div className="mt-4 flex justify-between text-sm text-text-secondary">
              <span>{x.plan.replaceAll("_", " ")}</span>
              <span>{x.mode}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Onboarding({
  data,
  reload,
}: {
  data: Workspace;
  reload(): Promise<void>;
}) {
  const navigate = useNavigate();
  const activeRun = data.provisionRuns.find((run) =>
    ["QUEUED", "RUNNING"].includes(run.status),
  );
  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => void reload(), 3000);
    return () => window.clearInterval(timer);
  }, [activeRun, reload]);
  const startConnectionTest = async (id: string) => {
    const response = await api.api.v1.crm
      .deployments({ id })
      ["connection-test"].post();
    if (!response.error) await reload();
  };
  const startInstallation = async (id: string) => {
    const response = await api.api.v1.crm.deployments({ id }).provision.post();
    if (!response.error) await reload();
  };
  const complete = async (id: string) => {
    await api.api.v1.crm.checklist({ id }).patch({ status: "DONE" });
    await reload();
  };
  const initialize = async (id: string) => {
    await api.api.v1.crm.deployments({ id }).onboarding.post();
    await reload();
  };
  const decide = async (id: string, status: "APPROVED" | "REJECTED") => {
    await api.api.v1.crm.approvals({ id }).patch({ status });
    await reload();
  };
  return (
    <div className="space-y-4">
      {data.deployments.map((deployment) => {
        const items = data.checklist.filter(
          (x) => String(x.deploymentId) === deployment.id,
        );
        const approvals = data.approvals.filter(
          (x) => String(x.deploymentId) === deployment.id,
        );
        const profile = data.installationProfiles.find(
          (item) => String(item.deploymentId) === deployment.id,
        );
        const run = data.provisionRuns.find(
          (item) => String(item.deploymentId) === deployment.id,
        );
        const running = run && ["QUEUED", "RUNNING"].includes(run.status);
        const sshReady = Boolean(
          profile?.serverHost &&
            profile?.serverUser &&
            profile?.sshCredentialRef,
        );
        return (
          <Card key={deployment.id}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-text-primary">
                  {deployment.customer.name}
                </h2>
                <p className="text-sm text-text-secondary">{deployment.name}</p>
              </div>
              <Badge>
                {items.filter((x) => x.status === "DONE").length}/{items.length}
              </Badge>
              {items.length === 0 && (
                <Button
                  size="sm"
                  onClick={() => void initialize(deployment.id)}
                >
                  Criar checklist oficial
                </Button>
              )}
            </div>
            <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <div>
                <p className="font-medium text-text-primary">
                  Provisionamento da VPS
                </p>
                <p className="text-sm text-text-secondary">
                  {run?.summary ??
                    (profile?.readiness.ready
                      ? "Dados completos. A VPS está pronta para conexão."
                      : `Dados pendentes: ${profile?.readiness.missing.join(", ") ?? "infraestrutura"}`)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!sshReady || Boolean(running)}
                onClick={() => void startConnectionTest(deployment.id)}
              >
                Testar acesso
              </Button>
              <Button
                size="sm"
                disabled={!profile?.readiness.ready || Boolean(running)}
                onClick={() => void startInstallation(deployment.id)}
              >
                Instalar stack
              </Button>
            </div>
            {run && (
              <div className="mb-5 rounded-lg bg-bg-tertiary p-4">
                <div className="flex items-center justify-between text-sm">
                  <strong className="text-text-primary">{run.phase}</strong>
                  <Badge variant={badgeVariant(run.status)}>{run.status}</Badge>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-secondary">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${run.progress}%` }}
                  />
                </div>
                {run.error && (
                  <p className="mt-3 text-error text-sm">{run.error}</p>
                )}
                <div className="mt-3 max-h-48 space-y-1 overflow-y-auto text-text-secondary text-xs">
                  {(run.logs as Array<{ at: string; message: string }>).map(
                    (entry) => (
                      <p key={`${entry.at}-${entry.message}`}>
                        {new Date(entry.at).toLocaleTimeString("pt-BR")} ·{" "}
                        {entry.message}
                      </p>
                    ),
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {items.map((x) => (
                <div
                  key={x.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="font-medium text-text-primary">{x.title}</p>
                    <p className="text-sm text-text-secondary">
                      {x.phase}
                      {x.responsible ? ` · ${x.responsible}` : ""}
                    </p>
                  </div>
                  {x.status === "DONE" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void complete(x.id)}
                    >
                      Concluir
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {approvals.length > 0 && (
              <div className="mt-5 border-border border-t pt-4">
                <h3 className="mb-3 font-medium text-text-primary">
                  Gates de aprovação
                </h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {approvals.map((approval) => (
                    <div
                      key={approval.id}
                      className="flex items-center justify-between rounded-lg bg-bg-tertiary p-3"
                    >
                      <div>
                        <p className="font-medium text-sm text-text-primary">
                          {approval.gate}
                        </p>
                        <Badge variant={badgeVariant(approval.status)}>
                          {approval.status}
                        </Badge>
                      </div>
                      {approval.status === "PENDING" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void decide(approval.id, "REJECTED")}
                          >
                            Rejeitar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void decide(approval.id, "APPROVED")}
                          >
                            Aprovar
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })}
      {data.deployments.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma implantação"
          description="Cadastre uma instalação para iniciar o onboarding."
        />
      )}
      {data.deployments.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => navigate("/crm/agents")}>
            Continuar para configurar o agente
          </Button>
        </div>
      )}
    </div>
  );
}

function Monitoring({ data }: { data: Workspace }) {
  const updateAlertStatus = async (
    id: string,
    status: "ACKNOWLEDGED" | "RESOLVED",
  ) => {
    await api.api.v1.crm.alerts({ id }).patch({ status });
    window.location.reload();
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.services.map((service) => (
          <Card key={service.id} className="p-4">
            <p className="text-sm text-text-muted uppercase">
              {service.serviceType}
            </p>
            <p className="mt-1 font-medium text-text-primary">
              {data.deployments.find(
                (item) => item.id === String(service.deploymentId),
              )?.customer.name ?? "Instalação"}
            </p>
            <div className="mt-3 flex items-center justify-between">
              <Badge variant={badgeVariant(service.status)}>
                {service.status}
              </Badge>
              <span className="text-sm text-text-secondary">
                {service.version ?? "versão desconhecida"}
              </span>
            </div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold text-text-primary">
            Saúde das instalações
          </h2>
          <div className="space-y-3">
            {data.deployments.map((x) => (
              <Row
                key={x.id}
                title={x.customer.name}
                subtitle={
                  x.lastHeartbeatAt
                    ? `Último sinal: ${new Date(x.lastHeartbeatAt).toLocaleString("pt-BR")}`
                    : "Sem heartbeat"
                }
                status={x.health}
                href={x.agentsUrl}
              />
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold text-text-primary">
            Alertas e incidentes
          </h2>
          <div className="space-y-3">
            {data.alerts.map((x) => (
              <div
                key={x.id}
                className="rounded-lg border border-border bg-bg-tertiary p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text-primary">{x.title}</p>
                    <p className="text-sm text-text-secondary">
                      {x.description ?? x.source}
                    </p>
                  </div>
                  <Badge variant={badgeVariant(x.severity)}>{x.severity}</Badge>
                </div>
                {x.status !== "RESOLVED" && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void updateAlertStatus(x.id, "ACKNOWLEDGED")
                      }
                    >
                      Reconhecer
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void updateAlertStatus(x.id, "RESOLVED")}
                    >
                      Resolver
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {data.alerts.length === 0 && (
            <p className="text-sm text-text-secondary">
              Nenhum alerta registrado.
            </p>
          )}
        </Card>
      </div>
      <Card>
        <h2 className="mb-4 font-semibold text-text-primary">
          Consumo agregado do período
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.usageSnapshots.slice(0, 12).map((usage) => {
            const deployment = data.deployments.find(
              (item) => item.id === String(usage.deploymentId),
            );
            return (
              <div
                key={usage.id}
                className="rounded-lg border border-border bg-bg-tertiary p-3"
              >
                <p className="font-medium text-text-primary">
                  {deployment?.customer.name ?? "Instalação"}
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  {usage.conversations} conversas ·{" "}
                  {Number(usage.promptTokens) + Number(usage.completionTokens)}{" "}
                  tokens
                </p>
                <p className="text-sm text-text-muted">
                  Custo estimado: {String(usage.estimatedCost)}
                </p>
              </div>
            );
          })}
        </div>
        {data.usageSnapshots.length === 0 && (
          <p className="text-sm text-text-secondary">
            O consumo aparecerá após o primeiro heartbeat.
          </p>
        )}
      </Card>
    </div>
  );
}

function Maintenance({
  data,
  creating,
  reload,
}: {
  data: Workspace;
  creating: boolean;
  reload(): Promise<void>;
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await api.api.v1.crm.maintenance.post(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    await reload();
  };
  const finish = async (id: string) => {
    await api.api.v1.crm.maintenance({ id }).patch({ status: "DONE" });
    await reload();
  };
  return (
    <div className="space-y-4">
      {creating && (
        <Card>
          <h2 className="mb-4 font-semibold text-text-primary">
            Registrar manutenção ou incidente
          </h2>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <Field label="Instalação">
              <Select name="deploymentId">
                {data.deployments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.customer.name} · {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo">
              <Select name="kind">
                <option value="MAINTENANCE">Manutenção</option>
                <option value="INCIDENT">Incidente</option>
                <option value="UPDATE">Atualização</option>
              </Select>
            </Field>
            <Field label="Resumo">
              <Input name="summary" required />
            </Field>
            <Field label="Responsável">
              <Input name="responsible" />
            </Field>
            <Field label="Agendamento">
              <Input name="scheduledAt" type="datetime-local" />
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">Salvar registro</Button>
            </div>
          </form>
        </Card>
      )}
      <div className="space-y-3">
        {data.maintenance.map((item) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-text-primary">
                  {item.summary}
                </h3>
                <p className="text-sm text-text-secondary">
                  {item.kind} · {item.responsible ?? "Sem responsável"}
                </p>
              </div>
              <Badge variant={badgeVariant(item.status)}>{item.status}</Badge>
            </div>
            {item.status !== "DONE" && (
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => void finish(item.id)}
              >
                Concluir
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function AuditTrail({ data }: { data: Workspace }) {
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-text-primary">
        Histórico imutável de ações
      </h2>
      <div className="space-y-3">
        {data.audit.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 border-border border-b pb-3"
          >
            <div>
              <p className="font-medium text-text-primary">{entry.action}</p>
              <p className="text-sm text-text-secondary">
                {entry.target ?? "CRM"} · ator {entry.actorId ?? "sistema"}
              </p>
            </div>
            <time className="text-sm text-text-muted">
              {new Date(entry.createdAt).toLocaleString("pt-BR")}
            </time>
          </div>
        ))}
      </div>
    </Card>
  );
}
