# atividade-legislativa-Aju

Painel de acompanhamento das matérias legislativas da Câmara Municipal de Aracaju no biênio 2025–2026. Selecione vereadores e filtre os resultados por ano e tipo para comparar indicadores, conferir o estágio registrado e exportar o recorte em CSV.

A base incluída no repositório cobre 29 parlamentares e combina a consulta por vereador com o relatório anual oficial do SAPL. Cada linha remete à matéria na fonte oficial. O total geral conta a matéria uma vez, e o gráfico por vereador a conta para cada autor selecionado.

Os gráficos de decisão usam quatro categorias. **Deferida** e **Indeferida** exigem registro explícito sobre a proposição. **Sem decisão registrada** indica que a tramitação consultada não apresenta essa decisão. **Não verificado** indica consulta pendente, fonte indisponível ou registros inconclusivos. Use **Verificar no SAPL** para consultar a tramitação de uma matéria. O painel e o CSV exibem o resultado e a data disponível. As justificativas não são armazenadas ou exibidas.

## Executar localmente

Use Node.js 24 e npm. A coleta também exige `curl`.

```sh
npm ci
npm run build
npx vercel dev
```

A configuração da Vercel publica os arquivos de `dist/`. O botão **Atualizar pelo SAPL** cruza `GET /api/sapl?vereador=<id>&ano=<ano>` com `GET /api/sapl-relatorio?ano=<ano>`. O painel mantém e sinaliza dados anteriores quando a fonte fica indisponível ou deixa de retornar registros já coletados. As atualizações pelo botão valem para a sessão atual.
As consultas individuais de tramitação usam `GET /api/decisao?materia=<id>`.
O botão **Verificar decisões pendentes** consulta até 16 matérias do recorte por rodada e mantém o estado de verificação disponível quando a fonte falha.

## Atualizar a base do repositório

```sh
npm run collect
```

O coletor consulta o SAPL por vereador e ano, valida as páginas retornadas e cruza os identificadores com o relatório oficial. Dados de recortes consultados anteriormente são preservados em caso de falha. O build gera `dist/data.js` a partir da base compactada em `data/sapl-data.js.gz`. A lista de vereadores vem do portal da Câmara, complementada pelas atas.

Para completar somente as decisões da base existente, use `npm run collect -- <diretório-de-cache> --enrich-decisions`.

- [Página oficial dos vereadores](https://www.aracaju.se.leg.br/processo-legislativo/parlamentares-da-44a-legislatura-1o-bienio-2025-2026)
- [Relatórios de atividade parlamentar](https://www.aracaju.se.leg.br/processo-legislativo/relatorios-de-atividade-parlamenta)
