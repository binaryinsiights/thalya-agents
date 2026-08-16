# Manual operacional: Central Binary e Planos

Este manual orienta a equipe da Binary Insights na utilização da instalação
central para cadastrar clientes, definir planos, preparar uma VPS, instalar a
stack e acompanhar a operação.

## 1. Conceito geral

A Central Binary é o painel administrativo da Binary Insights. Ela controla o
ciclo comercial e técnico de cada cliente:

1. lead e cliente;
2. plano e contrato;
3. instalação dedicada;
4. ficha técnica e credenciais;
5. teste de acesso;
6. instalação de Agents, Chatwoot, Baileys e Langfuse;
7. configuração inicial do agente;
8. monitoramento, alertas, manutenção e auditoria.

Cada cliente deve ter uma VPS dedicada. A Central não copia conversas, prompts,
documentos da base de conhecimento ou senhas da instalação do cliente.

## 2. Acesso e segurança

### Quem pode usar

As áreas Central Binary e Planos aparecem somente quando:

- a imagem foi construída com `BUN_PUBLIC_BINARY_CRM=true`;
- o usuário está autenticado;
- o usuário tem função administrativa.

A imagem do cliente é construída com `BUN_PUBLIC_BINARY_CRM=false`. Portanto, o
cliente não vê Central Binary nem Planos.

### Regras para a equipe

- Nunca envie senha, chave SSH ou token pelo WhatsApp ou por este manual.
- Insira credenciais somente na Ficha técnica ou no Cofre.
- O sistema grava uma referência do segredo, não o segredo na ficha.
- Não copie credenciais para planilhas.
- Use uma conta individual; não compartilhe o usuário administrador.
- Antes de apagar qualquer registro, confirme o cliente, o plano e a versão.
- Use Arquivar quando precisar preservar histórico.

## 3. Menu da Central Binary

### Visão geral

Mostra quatro indicadores:

- quantidade de clientes;
- instalações saudáveis;
- agentes ativos;
- alertas abertos.

Também mostra implantações pendentes e os principais alertas que exigem ação.
É a primeira tela para o operador começar o dia.

### Clientes

Use esta área para cadastrar leads e clientes.

Campos principais:

- nome da empresa ou pessoa;
- razão social e CPF/CNPJ, quando aplicável;
- nicho;
- responsável, telefone e e-mail;
- plano de interesse;
- observações;
- etapa comercial.

Etapas comerciais:

- **Lead:** contato ainda não qualificado;
- **Qualificado:** há necessidade e potencial confirmados;
- **Proposta:** proposta comercial em negociação;
- **Cliente ativo:** contrato ou aceite comercial confirmado.

Ao salvar um cliente, a Central encaminha o operador para Planos e contratos.

### Comercial

É o quadro do pipeline. Mova o cliente conforme a negociação avança. Não use
Cliente ativo antes de confirmar a decisão comercial.

### Planos e contratos

Esta área mostra as versões de planos disponíveis e os contratos criados.
Também permite editar contratos existentes.

Um contrato vincula:

- cliente;
- versão exata do plano;
- data de início e término;
- mensalidade;
- dia de cobrança;
- status.

O contrato deve ser criado antes da instalação sempre que a operação comercial já
estiver formalizada. A instalação pode ser criada sem contrato quando ainda
estiver em preparação, mas isso deve ser regularizado antes da produção.

### Implantações

Cadastre uma instalação por VPS dedicada. Informe:

- contrato, se já existir;
- cliente, quando não houver contrato;
- nome da instalação;
- ambiente: Produção ou Preparação.

Depois de salvar, use a navegação de implantação:

1. Cliente e instalação;
2. Acessos e hospedagem;
3. Instalação e serviços;
4. Configurar agente.

### Monitoramento

Use para verificar:

- status dos serviços Agents, Chatwoot, Baileys e Langfuse;
- versão reportada;
- último heartbeat;
- saúde da instalação;
- alertas e incidentes;
- consumo agregado, conversas, tokens e custo estimado.

Um alerta deve ser **Reconhecido** quando alguém assumiu a análise e
**Resolvido** somente após a causa ter sido tratada.

### Manutenções

Registre manutenção, incidente ou atualização. Informe instalação, tipo, resumo,
responsável e horário. Conclua o registro quando o trabalho terminar.

### Auditoria

Exibe o histórico de ações administrativas. Use esta área para verificar quem
alterou um cliente, contrato, instalação, alerta ou outro recurso.

## 4. Processo completo de implantação

### Etapa 1: receber os dados do cliente

O responsável comercial deve entregar:

- nome e dados do cliente;
- plano aprovado;
- domínio ou subdomínios;
- VPS contratada;
- IP ou hostname;
- acesso SSH ou acesso ao Coolify;
- número/canal de WhatsApp;
- documentos e regras do negócio;
- e-mails dos administradores;
- credenciais dos provedores que serão usados.

Não inicie a instalação sem confirmar que a VPS pertence ao cliente correto.

### Etapa 2: cadastrar o cliente

1. Abra **Central Binary > Clientes**.
2. Clique em **Novo cliente**.
3. Preencha os dados sem abreviações ambíguas.
4. Selecione o plano de interesse.
5. Salve como Lead, Qualificado, Proposta ou Cliente ativo.

### Etapa 3: confirmar o plano e criar o contrato

1. Abra **Planos e contratos**.
2. Confirme a versão do plano escolhida.
3. Clique em **Novo contrato**.
4. Selecione cliente e versão do plano.
5. Informe início, término, mensalidade e dia de cobrança.
6. Salve.

O contrato guarda a versão do plano. Se o plano for alterado depois, o contrato
antigo continua apontando para a versão que foi contratada.

### Etapa 4: cadastrar a instalação

1. Abra **Implantações**.
2. Clique em **Nova instalação**.
3. Selecione o contrato ou o cliente.
4. Informe um nome claro, por exemplo `Produção principal`.
5. Escolha Produção ou Preparação.
6. Salve.

### Etapa 5: preencher a Ficha técnica

Abra **Acessos e hospedagem** e preencha nesta ordem:

#### Identificação

- responsável técnico;
- data desejada de entrega.

#### Acesso à VPS

- IP ou hostname;
- porta SSH, normalmente 22;
- usuário SSH;
- chave privada SSH;
- senha da chave, se existir.

#### Orquestrador

Escolha uma das opções:

**Docker Compose via SSH**

Use quando a VPS é uma máquina Linux comum. São necessários host, usuário e
chave SSH.

**Coolify via API**

Use quando o cliente já tem Coolify. Informe URL, token, projeto, ambiente e
servidor Coolify. O token é enviado ao Cofre.

#### DNS, domínios e TLS

Informe:

- provedor DNS;
- zona DNS;
- domínio Agents;
- domínio Chatwoot;
- domínio Baileys;
- domínio Langfuse;
- e-mail do administrador Langfuse;
- senha inicial do Langfuse;
- e-mail usado para TLS.

DNS pode ser:

- **Manual:** a equipe cria os registros no painel DNS;
- **Automático:** a Central usa o token DNS para criar ou atualizar registros.

#### Autorização

Informe quem autorizou e marque a caixa de autorização. Sem autorização, o
botão de instalação permanece bloqueado.

### Etapa 6: acompanhar a prontidão

A barra de prontidão lista os campos que faltam. O operador deve corrigir todos
os itens antes de testar ou instalar.

Para Docker Compose, são obrigatórios host, usuário e credencial SSH. Para
Coolify, são obrigatórios URL, token, projeto, ambiente e servidor. DNS
automático também exige token DNS e host da VPS.

### Etapa 7: testar o acesso

1. Abra **Instalação e serviços**.
2. Confirme que a ficha está pronta.
3. Clique em **Testar acesso**.
4. Aguarde o resultado.

O teste valida o acesso ao método escolhido e a capacidade básica da VPS. Se
falhar, corrija a ficha e repita. Não avance com uma falha de acesso.

### Etapa 8: instalar a stack

1. Depois de um teste bem-sucedido, clique em **Instalar stack**.
2. Acompanhe a fase, progresso, resumo e logs.
3. Não clique novamente enquanto houver execução `QUEUED` ou `RUNNING`.
4. Aguarde `SUCCEEDED`.

A instalação cria os serviços Agents, Chatwoot, Baileys e Langfuse, configura
domínios e TLS e aplica a imagem do cliente correspondente ao plano.

Se o provisionamento terminar com `AWAITING_SETUP`, a infraestrutura está
instalada, mas ainda falta criar administradores e concluir a configuração dos
serviços.

### Etapa 9: configurar o agente

Após a instalação:

1. abra os links Agents, Chatwoot, Baileys e Langfuse;
2. crie os usuários administradores;
3. preencha as credenciais de IA no Cofre do cliente;
4. configure o canal WhatsApp e o Agent Bot;
5. confirme o agente importado pela imagem;
6. carregue os documentos da base de conhecimento;
7. reindexe os documentos;
8. teste no Playground;
9. teste uma conversa real;
10. confirme os traces no Langfuse.

O plano já chega aplicado ao agente durante o provisionamento. Credenciais,
inboxes, documentos e integrações são configurados depois porque pertencem ao
cliente específico.

## 5. Como trabalhar com Planos

A aba **Planos** é o catálogo comercial da Binary Insights. Ela não aparece na
imagem do cliente.

### Criar um plano

1. Abra **Planos**.
2. Clique em **Novo plano**.
3. Informe código, versão e nome exibido.
4. Defina os limites.
5. Marque os recursos disponíveis.
6. Clique em **Salvar versão**.

O código deve usar letras maiúsculas, números ou sublinhado. A versão deve usar
SemVer, por exemplo `1.0.0`.

### Limites atuais

- **Agentes:** quantidade máxima de agentes previstos;
- **Canais:** quantidade de canais ou inboxes contratados;
- **Conversas mensais:** referência para acompanhamento de consumo;
- **Documentos de conhecimento:** limite da base de conhecimento;
- **Minutos de áudio mensais:** referência para STT/TTS;
- **Horas técnicas mensais:** franquia operacional contratada.

### Recursos atuais

#### Agente e multimodalidade

- STT: transcrição de áudio;
- TTS: resposta em áudio;
- visão: leitura de imagens e documentos;
- debounce: espera uma sequência curta de mensagens antes de responder;
- digitação e respostas humanizadas: divisão e ritmo das respostas;
- handoff: encaminhamento para atendimento humano.

#### Conhecimento e ferramentas

- Agenda: ferramentas de calendário;
- Google Drive: busca e envio de arquivos.

#### Canais e operação

- Follow-ups: retomadas automáticas;
- Lembretes automáticos: lembretes vinculados a agendamentos;
- Asaas: cobrança e consulta de pagamentos.

### O que não deve ser colocado no plano

Não use o plano para cadastrar credenciais, IDs de inbox, templates HSM,
servidores MCP ou integrações personalizadas. Esses dados variam por cliente e
são preenchidos no cadastro do agente, no Chatwoot, no Cofre ou no painel da
integração.

### Editar um plano

As versões são imutáveis. Clique em **Editar** na versão desejada, altere os
campos e salve. O sistema cria a próxima versão automaticamente, por exemplo:

`1.0.0` → `1.0.1`

A versão anterior permanece disponível para contratos históricos. Clientes
novos podem usar a versão mais recente.

### Arquivar e reativar

**Arquivar** retira a versão de novos usos sem apagar o histórico. Use quando o
plano já foi comercializado ou usado em contrato.

**Reativar** torna a versão disponível novamente, se ela ainda fizer sentido
comercialmente.

### Excluir definitivamente

1. Confirme que o plano não será usado novamente.
2. Clique em **Excluir**.
3. Leia a confirmação.
4. Confirme a exclusão.

A exclusão remove a versão do banco de dados. Não é possível desfazer pela
interface. Se houver contrato vinculado, a Central bloqueia a operação para
proteger o histórico. Nesse caso, arquive o plano.

## 6. Regras de versão e implantação

- O plano escolhido no contrato é a versão efetivamente contratada.
- Alterar um plano não altera contratos existentes.
- Um novo provisionamento usa a versão do contrato.
- A imagem padrão dos novos clientes é definida pela Central.
- A imagem do cliente não contém a Central Binary nem a aba Planos.
- Alterar um plano depois de instalar um cliente não reconfigura a instalação
  automaticamente.
- Para aplicar uma nova versão a um cliente existente, faça uma revisão técnica
  e comercial e reprovisione ou ajuste o agente conforme o caso.

## 7. Monitoramento e rotina diária

### Início do dia

1. Abra Visão geral.
2. Verifique instalações pendentes.
3. Verifique alertas abertos.
4. Abra Monitoramento e confira o último heartbeat.
5. Confira serviços com estado `ERROR`, `CRITICAL`, `UNKNOWN` ou `OVERDUE`.

### Tratamento de alerta

1. Abra a instalação relacionada.
2. Reconheça o alerta para indicar que alguém assumiu.
3. Consulte links e logs.
4. Registre manutenção ou incidente, se necessário.
5. Resolva o alerta somente após validar a correção.

### Heartbeat

O emissor remoto envia saúde, versões, agentes, contagens e consumo agregado.
Ele não envia mensagens, prompts, documentos ou segredos. Sem heartbeat, a
instalação pode aparecer como desconhecida ou gerar alerta de ausência.

## 8. Solução de problemas

### O plano não aparece ao criar contrato

Confirme que a versão está ativa e não foi arquivada. Atualize a página. Se o
plano foi excluído, crie uma nova versão.

### O botão de instalar está bloqueado

Abra a Ficha técnica e corrija todos os itens mostrados em **Faltando**. Confira
também a autorização.

### Teste SSH falhou

Verifique host, porta, usuário, chave privada, senha da chave e firewall da VPS.
Não cole uma chave diferente sem substituir a senha correspondente.

### Coolify falhou

Verifique URL, token, projeto, ambiente e servidor. O token deve ter permissão
para criar e iniciar serviços.

### DNS/TLS falhou

Confirme zona, domínios e e-mail TLS. Se o DNS estiver manual, crie os registros
antes de repetir. Se estiver automático, valide o token e suas permissões.

### Provisionamento ficou FAILED

Leia os logs da execução, registre uma manutenção e corrija a causa. Não apague
o cliente para tentar novamente. Após corrigir a ficha ou a VPS, execute uma
nova instalação.

### O agente não usa um recurso do plano

Confirme, nesta ordem:

1. se o contrato aponta para a versão correta;
2. se a imagem do cliente é a atual;
3. se a credencial necessária foi preenchida;
4. se a integração foi configurada;
5. se o agente foi reiniciado após alteração de ferramenta;
6. se há trace ou erro no Langfuse.

## 9. Limites de responsabilidade da Central

A Central instala e acompanha a infraestrutura. Ela não substitui:

- compra da VPS;
- criação de documentos do cliente;
- aprovação de templates WhatsApp;
- criação de credenciais dos provedores;
- configuração comercial do Chatwoot;
- validação do conteúdo e do comportamento do agente;
- aprovação final do cliente.

## 10. Critério de entrega ao cliente

Uma implantação só deve ser considerada entregue quando:

- os quatro serviços estão acessíveis;
- os administradores foram criados;
- o WhatsApp está conectado;
- o agente responde no Playground;
- o agente responde por uma mensagem real;
- a base de conhecimento foi indexada;
- o handoff para humano foi validado;
- o Langfuse registra traces;
- não há alerta crítico aberto;
- o cliente recebeu os links e instruções de acesso.

Após a entrega, registre a conclusão em Manutenções ou no checklist operacional
adotado pela equipe e mantenha o histórico na Auditoria.
