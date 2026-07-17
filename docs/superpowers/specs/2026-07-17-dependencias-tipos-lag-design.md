# Dependências com tipos de vínculo e LAG

## Objetivo

Permitir a gestão completa das dependências nos drawers da Linha de Balanço e do Médio Prazo, incluindo inclusão, exclusão, tipo de vínculo e LAG em dias úteis.

## Escopo

- Linha de Balanço: dependências da atividade selecionada.
- Médio Prazo: dependências de cada sublote/unidade individual.
- Edição pelas perspectivas de predecessoras e sucessoras.
- Reagendamento e propagação imediatos após qualquer alteração válida.

## Modelo de dados

Cada dependência será armazenada como uma relação canônica:

```ts
type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

type ScheduleDependency = {
  from: string;
  to: string;
  type: DependencyType;
  lagDays: number;
};
```

Uma única relação alimenta as listas de predecessoras e sucessoras. Alterá-la em qualquer lista atualiza a mesma entidade. Dependências antigas, importadas ou ainda representadas apenas por IDs serão normalizadas para `FS` com `lagDays: 0`.

## Tipos de vínculo

- Término–Início (`FS`/`TI`): o início da sucessora é vinculado ao primeiro dia útil após o término da predecessora, deslocado pelo LAG.
- Início–Início (`SS`/`II`): o início da sucessora é vinculado ao início da predecessora, deslocado pelo LAG.
- Término–Término (`FF`/`TT`): o término da sucessora é vinculado ao término da predecessora, deslocado pelo LAG.
- Início–Término (`SF`/`IT`): o término da sucessora é vinculado ao início da predecessora, deslocado pelo LAG.

O arraste cria sempre uma dependência `FS` com LAG `0`.

## Calendário e reagendamento

- Datas de atividades e LAG são calculados exclusivamente em dias úteis do calendário da obra.
- Fins de semana, feriados e dias não trabalhados configurados são ignorados nos deslocamentos.
- LAG positivo posterga; LAG negativo antecipa; zero aplica apenas a regra do tipo.
- Ao vincular pelo início (`FS` e `SS`), a duração útil da sucessora é preservada e seu término é recalculado.
- Ao vincular pelo término (`FF` e `SF`), a duração útil da sucessora é preservada e seu início é recalculado.
- Alterações de tipo ou LAG recalculam imediatamente a atividade dependente e propagam o resultado por toda a cadeia de sucessoras.
- Quando houver múltiplas restrições, prevalece a combinação que impõe a data mais tardia à sucessora.

## Interface

Cada drawer apresenta seções separadas de **Predecessoras** e **Sucessoras**. Cada linha contém:

- nome da atividade ou unidade relacionada;
- seletor compacto de tipo (`TI`, `II`, `TT`, `IT`);
- contador numérico de LAG com botões de menos e mais;
- indicação de dias úteis;
- botão para excluir.

Um controle **Adicionar** permite pesquisar e selecionar outra atividade ou unidade. Novas relações adicionadas pelo drawer também começam em `TI` e LAG `0`. Valores positivos são apresentados com `+` e negativos com `−`.

Na Linha de Balanço, o editor aparece para a atividade selecionada. No Médio Prazo, ele aparece dentro do cartão de cada sublote/unidade no drawer da atividade.

## Validação

- Bloquear auto-vínculos.
- Bloquear relações duplicadas entre os mesmos elementos.
- Bloquear relações que formem ciclos, independentemente do tipo ou LAG.
- Em uma edição inválida, preservar a relação e as datas anteriores e mostrar uma mensagem no drawer.
- Ao excluir uma relação, recalcular a cadeia usando as dependências restantes.

## Persistência e compatibilidade

- A tabela `schedule_dependencies` já possui colunas para tipo e LAG; o repositório passará a ler e gravar ambas.
- Estados salvos do Médio Prazo serão normalizados ao carregar, convertendo listas legadas de IDs em relações `FS` com LAG `0`.
- Dados publicados para outras etapas continuam expondo predecessoras por ID quando o consumidor ainda usa o formato legado.

## Verificação

- Testes unitários dos quatro tipos com LAG negativo, zero e positivo.
- Testes com fins de semana, feriados e dias não trabalhados.
- Testes de múltiplas restrições e propagação em cadeia.
- Testes de migração das dependências legadas.
- Testes de criação por arraste como `FS + 0`.
- Testes de inclusão, edição e exclusão pelas duas perspectivas do drawer.
- Testes de bloqueio de auto-vínculo, duplicidade e ciclos.
- Typecheck, suíte completa e build de produção.
