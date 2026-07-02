# Arquitetura funcional

O sistema segue a lógica:

```text
Longo prazo → Médio prazo → Curto prazo → Medição → Retroalimentação
```

## Camadas

- **Longo prazo**: cronograma-mãe, linha de balanço, versões.
- **Médio prazo**: abertura de lotes em sublotes, ponderações e semanas.
- **Curto prazo**: microserviços medíveis e critérios de pagamento.
- **Compras**: necessidade prevista x solicitado/pedido/contratado/entregue.
- **Físico-financeiro**: avanço físico x valor previsto/realizado.

## Regras críticas

1. Importação original é imutável.
2. Toda alteração manual gera histórico.
3. Atividade com medição não é apagada automaticamente.
4. Pesos dos filhos precisam fechar 100%.
5. Compra só é concluída quando a cobertura de quantidade é suficiente.
