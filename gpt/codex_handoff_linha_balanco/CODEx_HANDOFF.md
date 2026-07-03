
# Handoff para Codex - Linha de Balanço / Planejamento Integrado de Obras

## Objetivo do projeto
Construir um sistema web/PWA para planejamento integrado de obras, partindo do cronograma de longo prazo, abrindo em médio prazo, medindo microserviços no curto prazo e retroalimentando compras e físico-financeiro.

Fluxo principal:

```text
Longo prazo -> Medio prazo -> Curto prazo -> Medicao -> Retroalimentacao -> Compras / Financeiro / Dashboard
```

## Decisão técnica atual
- Front-end: React + TypeScript + Vite.
- Banco principal recomendado: Supabase/Postgres.
- Storage: Supabase Storage.
- Offline para tablet: IndexedDB/localStorage + fila de sincronizacao futura.
- Curto prazo atual do usuario pode ser integrado depois.

## Modulos planejados
1. Projetos - selecao de obras com cards, reaproveitando conceito do app de curto prazo.
2. Dashboard - resumo executivo da obra.
3. Cronograma / Importacao / Versoes - importacao XLSX/CSV/XML, tabela editavel, V00/V01/V02, baseline.
4. Linha de Balanco - visualizador/editor principal.
5. Compras - Kanban com cobertura por quantidade e etapa do processo.
6. Medio prazo - abertura de lotes/sublotes e matriz semanal.
7. Curto prazo - microservicos ponderados e medicao.
8. Fisico-financeiro - vinculo com EAP/orcamento e curva prevista/realizada.
9. Configuracoes - familias, linhas, calendario, feriados, tolerancias.

## Linha de balanço - comportamento esperado
O visualizador precisa ser fiel ao prototipo v6 HTML e evoluir em React.

Requisitos validados:
- Barras por lote/lote-mae/pacote/familia.
- Arrastar horizontalmente para alterar inicio/fim mantendo duracao.
- Alca direita para redimensionar duracao.
- Toque longo em tablet para iniciar vinculo FS.
- Arraste vertical para criar predecessor/sucessor.
- Linhas de dependencias visiveis.
- Marcos verticais no corpo do cronograma com texto vertical.
- Zoom hierarquico menos poluido.
- Zoom proximo: semanas S1, S2, S3 referenciadas ao inicio do projeto e data de inicio da semana.
- Zoom medio: meses em cima e semanas mais espacadas.
- Zoom aberto: mes + indice M1, M2, M3.
- Linhas por lote-mae: ex. TORRE-PAVIMENTOS = 3 linhas, FACHADA = 3 linhas.
- Linha fixa por pacote/familia: ex. ALVENARIA linha 1, INSTALACOES linha 2, REVESTIMENTO linha 3.
- Pacote nao deve pular de linha ao arrastar datas.
- Progress bar dentro da barra de atividade.

## Banco de dados principal
Tabelas centrais:
- projects
- schedule_versions
- schedule_imports
- schedule_tasks
- line_balance_settings
- milestones
- schedule_dependencies
- change_log
- procurement_cards
- procurement_requirements
- procurement_external_lines
- medium_plan_tasks
- microservice_items
- budget_items
- financial_forecast

Regra: importacao original e imutavel. Toda mudanca manual precisa gerar change_log.

## Cronograma e versionamento
Importacao original vira V00. A versao ativa pode ser V01, V02 etc. O usuario precisa poder:
- importar cronograma;
- criar copia;
- definir linha de base;
- replanejar mais de uma vez;
- restaurar versao;
- comparar baseline x atual.

Ao arrastar uma barra na linha de balanco:
1. Atualizar schedule_tasks da versao ativa.
2. Criar change_log.
3. Recalcular dependencias se aplicavel.
4. Recalcular compras previstas.
5. Recalcular fisico-financeiro.
6. Alertar se tarefa ja foi aberta no medio/curto prazo.

## Compras
A planilha enviada pelo usuario e `REQUISICOES POR NIVEL.xlsx` e tem abas:
- Solicitacoes
- Approvo ocorrencias
- Approvo documentos
- Follow solicitacao
- Controle
- Follow PEdidos

Regra critica: compra nao e concluida apenas porque existe pedido. Precisa verificar cobertura por quantidade.

Exemplo:
- Necessario: 1000 sacos de cimento.
- Pedido: 50 sacos.
- Cobertura: 5%.
- Status real: Parcial / pendente, nao concluido.

O Kanban deve ter dois conceitos:
- currentStage: A solicitar, Solicitado, Em cotacao, Pedido emitido, Contrato emitido, Entregue.
- realStatus: Pendente, Parcial, Completo, Atrasado, Bloqueado, Divergente.

## Medio prazo
O medio prazo abre o lote-mae em sublotes.
Exemplo:

```text
FACHADA
  Fachada A
    Balancim 1 - 30%
    Balancim 2 - 40%
    Balancim 3 - 30%
```

A visualizacao esperada e uma matriz semanal:

```text
Lote / Semana        S1   S2   S3   S4   S5
Fachada A/Balancim1  BAL  EMB  IMP  TEX
Fachada A/Balancim2       BAL  EMB  IMP  TEX
```

Regra: soma dos pesos dos filhos deve fechar 100%.

## Curto prazo
O curto prazo mede microservicos dentro do pacote, de acordo com criterio de pagamento.
Exemplo ALVENARIA:
- Marcacao = 20%.
- Elevacao = 80%.

Se Marcacao = 100% e Elevacao = 50%:
- Progresso consolidado = 100% * 20% + 50% * 80% = 60%.

Esse progresso volta para medio prazo, longo prazo, fisico-financeiro e dashboard.

## Fisico-financeiro
Valor realizado = progresso fisico ponderado x valor vinculado do pacote.
Precisa integrar futuramente com o repo do usuario: `fisicofinanceiro`.

## Arquivos fonte no pacote
- `source/linha-balanco-planejamento-v02-completo.zip`: base React atual.
- `source/linha-balanco-planejamento-github-vercel.zip`: primeira base gerada.
- `source/Cronograma Longo prazo Nizza V00 (Término Cliente).pdf`: cronograma base PDF.
- `source/REQUISIÇÕES POR NÍVEL.xlsx`: planilha de compras/requisicoes.
- `csv_requisicoes_por_nivel/*.csv`: amostras CSV por aba para leitura rapida pelo Codex.
- `screenshots/*.png`: imagens de referencia de UI.

## Prioridade de implementacao para Codex
1. Garantir que `npm install`, `npm run build` e Vercel funcionem sem erro.
2. Portar fielmente o visualizador v6 para React, mantendo todas as interacoes.
3. Criar camada de persistencia Supabase para projetos, tarefas, dependencias e configuracoes.
4. Implementar change_log em toda alteracao manual.
5. Implementar importador de cronograma com mapeamento de colunas.
6. Implementar importador de compras usando as abas da planilha.
7. Evoluir medio prazo com abertura real de lotes e pesos.
8. Evoluir curto prazo com templates de microservicos.
9. Integrar fisico-financeiro.

## Testes minimos
- Importar cronograma XLSX com lote_mae, lote, pacote, inicio, fim.
- Arrastar atividade e verificar se nao muda de linha.
- Redimensionar duracao pela alca direita.
- Criar dependencia FS por toque longo.
- Alterar linha da familia ALVENARIA e verificar todos os pacotes alvenaria.
- Alterar linhas de TORRE-PAVIMENTOS e verificar todos os pavimentos.
- Importar compras e verificar cobertura parcial.
- Medio prazo: pesos devem somar 100%.
- Curto prazo: microservicos 20/80 devem consolidar corretamente.

