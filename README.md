# atividade-legislativa-Aju

Painel de acompanhamento das matérias legislativas da Câmara Municipal de Aracaju no biênio 2025–2026. Selecione vereadores e filtre os resultados por ano e tipo para comparar indicadores, conferir o estágio registrado e exportar o recorte em CSV.

A base incluída no repositório tem 6.066 matérias distintas de 29 parlamentares, coletadas no SAPL em 23 de novembro de 2026. Cada linha remete à matéria na fonte oficial. O total geral conta a matéria uma vez, e o gráfico por vereador a conta para cada autor selecionado.

Os gráficos de decisão usam quatro categorias. **Deferida** e **Indeferida** exigem registro explícito sobre a proposição. **Sem decisão registrada** indica que a tramitação consultada não apresenta essa decisão. **Não verificado** indica consulta pendente, fonte indisponível ou registros inconclusivos. Use **Verificar no SAPL** para consultar a tramitação de uma matéria. O painel e o CSV exibem o resultado e a data disponível. As justificativas não são armazenadas ou exibidas.

## Executar localmente

Use Node.js 24 e npm. A coleta também exige `curl`.

```sh
npm ci
npm run build
npx vercel dev
```

A configuração da Vercel publica os arquivos de `dist/` e a função `GET /api/sapl?vereador=<id>&ano=<ano>`. O botão **Atualizar pelo SAPL** consulta essa função para os vereadores e anos selecionados. Se o SAPL estiver inacessível, o painel exibe os últimos dados disponíveis. A atualização pelo botão vale para a sessão atual.
As consultas individuais de tramitação usam `GET /api/decisao?materia=<id>`.

## Atualizar a base do repositório

```sh
npm run collect
```

O coletor consulta o SAPL por vereador e ano, valida as contagens retornadas e atualiza a base compactada em `data/sapl-data.js.gz`. O build gera `dist/data.js` a partir dela. Revise o resumo da coleta antes de publicar a nova base. A lista de vereadores vem do portal da Câmara, complementada pelas atas.

Para completar somente as decisões da base existente, use `npm run collect -- <diretório-de-cache> --enrich-decisions`.

- [Página oficial dos vereadores](https://www.aracaju.se.leg.br/processo-legislativo/parlamentares-da-44a-legislatura-1o-bienio-2025-2026)
- [Relatórios de atividade parlamentar](https://www.aracaju.se.leg.br/processo-legislativo/relatorios-de-atividade-parlamenta)
