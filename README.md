# Triângulo das Bermudas — Eleições 2026

Painel estático e responsivo para acompanhar a totalização oficial das Eleições Gerais de 2026, com:

- Presidência no topo.
- Santa Catarina na coluna esquerda.
- Paraná na coluna direita.
- Governador, Senador, Deputado Federal e Deputado Estadual em cada estado.
- Busca por nome, partido ou número.
- Atualização automática a cada 1 segundo enquanto a aba está visível.
- Fundo usando `assets/crias-triangulo.webp`.
- Dados lidos diretamente dos arquivos JSON públicos do TSE.

## Rodar localmente

Por segurança dos navegadores, evite abrir `index.html` diretamente com `file://`. Sirva a pasta com um servidor HTTP simples.

Com Python:

```bash
python -m http.server 8080
```

Depois abra:

```text
http://localhost:8080
```

## Publicar grátis no GitHub Pages

1. Use um repositório público no GitHub, por exemplo `triangulo-eleicoes-2026`.
2. Envie todos os arquivos deste projeto para a raiz do repositório.
3. Abra **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione a branch `main` e a pasta `/ (root)`.
6. Salve. Em alguns instantes o GitHub exibirá o endereço do site.

Para este projeto, o endereço esperado é:

```text
https://matheus-da-fonseca.github.io/triangulo-eleicoes-2026/
```

## Integração com o TSE

O app começa consultando:

```text
https://resultados.tse.jus.br/oficial/comum/config/ele-c.json
```

Ele tenta descobrir automaticamente os códigos do 1º turno de 2026. Como contingência, existem os códigos oficiais atuais de fallback:

- eleição federal: `6257`
- eleição estadual: `6259`
- ciclo: `ele2026`

Cargos usados:

- `1`: Presidente
- `3`: Governador
- `5`: Senador
- `6`: Deputado Federal
- `7`: Deputado Estadual

Exemplos de arquivos lidos:

```text
/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json
/oficial/ele2026/6259/dados/sc/sc-c0003-e006259-u.json
/oficial/ele2026/6259/dados/pr/pr-c0005-e006259-u.json
```

O painel faz 9 leituras por ciclo de atualização, com polling de 1 segundo, e pausa as leituras quando a aba fica em segundo plano. Como há proteção contra sobreposição, um novo ciclo não começa enquanto o anterior ainda estiver em andamento.

## Observação sobre CORS

O projeto foi desenhado para consumir os arquivos públicos do TSE diretamente do navegador. Caso o TSE altere a política de CORS e passe a bloquear requisições originadas de outro domínio, o GitHub Pages sozinho não consegue funcionar como proxy porque ele é hospedagem estática. Nesse cenário, mantenha o front-end no Pages e acrescente um proxy serverless na frente dos arquivos do TSE.

## Aviso

Este é um painel independente, sem vínculo com o Tribunal Superior Eleitoral. A fonte oficial dos resultados é o TSE.
