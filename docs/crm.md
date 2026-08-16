# Binary Control no fazer.ai Agents

Para o procedimento operacional destinado à equipe, consulte o [Manual da Central Binary e Planos](MANUAL-CENTRAL-BINARY-PLANOS.md).

O CRM da Binary Insights é um módulo privado da instalação central do Agents. Ele
registra clientes e acompanha instalações dedicadas, uma VPS por cliente, sem
copiar conversas, prompts ou segredos dessas instalações.

## Escopo da fase 1

- clientes, contatos, planos versionados e contratos;
- pipeline comercial e estados de implantação, financeiro e suporte;
- instalações com Agents, Chatwoot, Baileys e Langfuse;
- agentes remotos com metadados sanitizados;
- checklist oficial, responsáveis, bloqueios, evidências e aprovações;
- heartbeat assinado, saúde, versões, recursos, backup e TLS;
- consumo agregado contra os limites do plano;
- alertas, incidentes, manutenções e auditoria;
- API REST e endpoint de telemetria.

Não fazem parte desta fase provisionamento automático de VPS, leitura de
conversas, edição remota completa de prompts, contabilidade ou atualização
simultânea de toda a frota.

## Fluxo operacional

1. Cadastre o lead em **CRM > Clientes** e mova-o pelo pipeline.
2. Em **Planos e contratos**, selecione uma versão imutável do plano.
3. Cadastre a instalação dedicada e salve o segredo do heartbeat no Vault. No
   deployment armazene apenas uma referência no formato `vault:<id>`.
4. Inicialize o checklist em **Implantação**, anexe as evidências e aprove os
   gates de infraestrutura, conteúdo, homologação e produção.
5. Configure o emissor na instalação do cliente.
6. Valide os quatro serviços, o primeiro heartbeat e os links profundos.
7. Ative a instalação somente depois da homologação.

## Ficha técnica obrigatória

Antes da implantação, preencha **CRM > Ficha técnica** nesta ordem: acesso à
VPS, método, domínios e autorização. A ficha pode ser salva como rascunho em
qualquer momento. O indicador de prontidão mostra os dados que ainda faltam.

O operador informa chaves e tokens diretamente na ficha. O backend os envia ao
Cofre criptografado e persiste somente a referência interna; o valor nunca
volta para a tela. Não é necessário abrir o Cofre nem manipular referências
`vault:<id>`. Para Coolify e Portainer são exigidos URL e token do
orquestrador; para Docker Compose são exigidos usuário e chave SSH. Token DNS é
opcional para automação; DNS manual não exige token. Registry e backup pertencem
às etapas de distribuição e operação e não bloqueiam a preparação inicial.

## Emissor na VPS do cliente

Configure somente na instalação remota:

```env
FLEET_CONTROL_URL=https://agents.binaryinsights.com.br
FLEET_DEPLOYMENT_KEY=<chave-publica-da-instalacao>
FLEET_HEARTBEAT_SECRET=<segredo-armazenado-no-vault-central>
FLEET_REPORT_INTERVAL_MS=60000
FLEET_CHATWOOT_HEALTH_URL=https://chatwoot.cliente.com
FLEET_BAILEYS_HEALTH_URL=https://baileys.cliente.com
FLEET_LANGFUSE_HEALTH_URL=https://langfuse.cliente.com
```

Sem as três primeiras variáveis o emissor permanece desligado. O payload contém
apenas nomes/IDs dos agentes, estados, versões, contagens e consumo agregado. O
segredo não entra no payload nem nos logs.

## Autenticação e segurança

O endpoint é `POST /api/v1/crm/fleet/heartbeat/:deploymentKey`. Cada chamada
usa HMAC sobre timestamp e corpo bruto, com janela antirreplay de cinco minutos.
`eventId` torna a gravação idempotente. O segredo é resolvido pelo Vault
cifrado, RLS é forçado nas tabelas CRM e toda ação administrativa gera
`AuditLog`.

Retenção padrão: 90 dias para snapshots de saúde e consumo. Conteúdo de
conversa, texto de prompt, documentos da base e valores de credenciais nunca
devem ser enviados.

## Alertas automáticos

- heartbeat ausente por mais de três minutos;
- Agents, Chatwoot, Baileys ou Langfuse offline;
- disco em nível crítico;
- backup falho ou atrasado;
- certificado inválido ou próximo do vencimento;
- consumo em 80%, 100% e 120% do limite mensal.

Instalações ainda em estado `PLANNED` não geram alerta de heartbeat.

## Homologação

Antes de implantar um cliente:

- execute `bun check`;
- aplique migrations sem reset ou perda;
- confirme login e isolamento do tenant;
- envie um heartbeat válido, repita o mesmo `eventId` e confirme
  `duplicate`;
- envie assinatura inválida e confirme HTTP 401;
- confirme os quatro serviços e as versões no CRM;
- reconheça e resolva um alerta;
- conclua checklist e gates;
- confirme que a auditoria não contém PII, mensagens ou segredos.

Em falha, restaure a imagem anterior e o compose salvo. Não faça rollback
destrutivo de banco: as migrations do CRM são aditivas.
