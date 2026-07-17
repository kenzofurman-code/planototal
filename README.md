# Linha de Balanço Planejamento

Base inicial pronta para GitHub/Vercel em **React + TypeScript + Vite + Supabase/Postgres**.

## O que já vem no pacote

- Menu lateral recolhível estilo ChatGPT
- Seleção de projetos
- Dashboard
- Cronograma / importação / versões
- Linha de balanço visual com dados demo
- Dependências TI, II, TT e IT com LAG positivo ou negativo em dias úteis, editáveis nos drawers
- Compras em Kanban com cobertura por quantidade
- Médio prazo em matriz semanal
- Dependências editáveis por sublote/unidade no Médio Prazo
- Curto prazo com microserviços ponderados
- Físico-financeiro demo
- Schema inicial Supabase/Postgres
- Documentação de arquitetura

## Rodar localmente

```bash
npm install
cp .env.example .env
npm run dev
```

O app roda em modo demo mesmo sem Supabase configurado.

## Deploy Vercel

1. Suba este projeto no GitHub.
2. Na Vercel, clique em **New Project**.
3. Importe o repositório.
4. Configure as variáveis:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy.

## Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Rode `supabase/schema.sql`.
4. Preencha o `.env`.

## Próximos passos

1. Persistir projetos no Supabase.
2. Persistir cronograma e versões.
3. Implementar importação real com mapeamento de colunas.
4. Gravar alterações da linha de balanço em `change_log`.
5. Importar planilha de compras e calcular cobertura real.
