# BotDiscord (Suzi)

## Comandos
- `/ping` - Latencia rapida.
- `/jogo nome:<texto> plataforma:<opcional>` - Ajuda estruturada para um jogo.
- `/pergunta pergunta:<texto>` - Perguntas sobre jogos com memoria curta.
- `/review acao:<add|remove|view|my|top|favorite>` - Avaliacoes de jogos com ranking e favoritos.
- `/register nome_jogador:<texto> nivel:<opcional>` - Registra o perfil do jogador.
- `/perfil user:<opcional>` - Mostra o perfil do player com paginas.
- `/roll expressao:<NdM>` - Rolagem de dados (ex: `2d20`).
- `/nivel nivel:<1..99> user:<opcional>` - Atualiza o nivel do usuario.
- `/title acao:<add|remove>` - Gerencia titulos desbloqueados.
- `/steam acao:<link|view|refresh|unlink>` - Vincula e consulta perfil Steam.
- `/sobre` - Lore da Suzi.
- `/conquistas` - Lista conquistas do player.
- `/ajuda` - Mostra a lista de comandos.

## Variaveis de Ambiente
- `DISCORD_TOKEN` (obrigatorio)
- `DISCORD_APP_ID` (obrigatorio)
- `GEMINI_API_KEY` (obrigatorio para /pergunta e /jogo)
- `GEMINI_MODEL` (opcional, padrao: `gemini-2.5-flash`)
- `ALLOW_ADMIN_EDIT` (opcional, `true` libera /nivel em outros users)
- `STEAM_API_KEY` (obrigatorio para recursos Steam)
- `LLM_API_KEY` (opcional, stub de LLM legacy)
- `DEFAULT_PROFILE_BANNER_URL` (opcional, banner padrao no /perfil)
- `PROFILE_BANNER_URL` (opcional, legado para banner no /perfil)

Notas:
- `.env.example` e apenas referencia. O bot nao carrega esse arquivo.
- Em producao, as chaves vem exclusivamente das variaveis do host (Render/Discloud).

## Gemini
Configure no `.env`:
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (padrao: `gemini-2.5-flash`)

Checklist para trocar a key no Render:
1) Atualize `GEMINI_API_KEY` no Render
2) Clear build cache e faca deploy novamente
3) (Opcional) Use `DEBUG_GEMINI=true` para confirmar o log com o last4

Obs: rolagem de dados e sempre local com `crypto.randomInt`.

## Steam
- Configure `STEAM_API_KEY` no ambiente.
- Use `/steam acao:<link|view|refresh|unlink>`.
- Observacao: jogo atual so aparece se o perfil e detalhes estiverem publicos na Steam.

## Avaliacoes de Jogos
- As avaliacoes ficam em `data/reviews.json` (por servidor/guild).
- Nota de 1 a 5 estrelas, categoria AMEI/JOGAVEL/RUIM e opiniao curta (max 400).
- Tags opcionais (max 5). Favoritos aparecem no `/perfil`.
- Ranking do `/review acao:top`: soma de estrelas (total), desempate por numero de avaliacoes, media e nome.

### Comandos /review
- `/review acao:add nome:<texto> estrelas:<1..5> categoria:<AMEI|JOGAVEL|RUIM> opiniao:<texto> plataforma:<opcional> tags:<CSV> favorito:<opcional>`
- `/review acao:remove nome:<texto>`
- `/review acao:view nome:<texto>`
- `/review acao:my categoria:<opcional> ordenar:<stars|recent>`
- `/review acao:top categoria:<opcional> min_avaliacoes:<opcional> limite:<opcional>` (padrao: ranking geral, min 1, limite 10)
- `/review acao:favorite nome:<texto>`

### Exemplos
- `/review acao:add nome:"Baldur's Gate 3" estrelas:5 categoria:AMEI opiniao:"Insano." tags:"historia, combate" favorito:true`
- `/review acao:view nome:"Baldur's Gate 3"`
- `/review acao:top categoria:AMEI limite:10`
- `/review acao:favorite nome:"Baldur's Gate 3"`

## Perfil com paginas
- O `/perfil` abre um painel com botoes: Perfil, Conquistas, Historico, Reviews e Fechar.
- O `/perfil` tenta gerar um card em imagem (PNG) via `@napi-rs/canvas`; se falhar, usa o embed normal.
- Pagina Perfil mostra progresso (nivel + XP) e favoritos.
- Pagina Conquistas lista conquistas desbloqueadas.
- Pagina Historico lista as ultimas 5 rolagens.
- Pagina Reviews mostra top 5 reviews e total do usuario.
- Banner padrao via `DEFAULT_PROFILE_BANNER_URL` (ou `PROFILE_BANNER_URL` legado).
- Banner custom por usuario:
  - `/perfil banner set url:<texto>`
  - `/perfil banner clear`

## Troubleshooting (Catalogo de Erros)
O catalogo completo fica em `src/errors/catalog.ts`.

### Tabela resumo
| Categoria | Code | Sintoma curto |
| --- | --- | --- |
| Variaveis de Ambiente | SUZI-ENV-001 | DISCORD_TOKEN ausente |
| Variaveis de Ambiente | SUZI-ENV-002 | DISCORD_APP_ID ausente |
| Variaveis de Ambiente | SUZI-ENV-003 | GEMINI_API_KEY ausente/invalid |
| Variaveis de Ambiente | SUZI-ENV-004 | GEMINI_MODEL ausente/invalid |
| Discord/Interactions | SUZI-DISCORD-001 | Unknown interaction (10062) |
| Permissoes e Acesso | SUZI-DISCORD-002 | Missing permissions (50013) |
| Permissoes e Acesso | SUZI-DISCORD-003 | Missing access (50001) |
| Comandos/Slash | SUZI-DISCORD-004 | Comando nao registrado |
| Gemini | SUZI-GEMINI-001 | 403 Forbidden |
| Gemini | SUZI-GEMINI-002 | 404 Not Found |
| Gemini | SUZI-GEMINI-003 | 429 Rate limit |
| Gemini | SUZI-GEMINI-004 | Timeout |
| Deploy | SUZI-DEPLOY-001 | Port scan timeout (Render) |
| Deploy | SUZI-DEPLOY-002 | dist/index.js nao encontrado |
| Storage (JSON) | SUZI-STORE-001 | JSON corrompido |
| Storage (JSON) | SUZI-STORE-002 | Falha ao escrever JSON |
| Dados (/roll) | SUZI-ROLL-001 | Expressao NdM invalida |
| Comandos/Slash | SUZI-CMD-001 | Parametro invalido |
| Comandos/Slash | SUZI-CMD-002 | Falha inesperada no comando |

### Variaveis de Ambiente
**SUZI-ENV-001**
- Sintoma: bot nao inicia ou nao conecta.
- Causa: DISCORD_TOKEN ausente.
- Como resolver: definir `DISCORD_TOKEN` no host.

**SUZI-ENV-002**
- Sintoma: comandos nao registram.
- Causa: DISCORD_APP_ID ausente.
- Como resolver: definir `DISCORD_APP_ID` no host.

**SUZI-ENV-003**
- Sintoma: /pergunta e /jogo falham ao consultar Gemini.
- Causa: GEMINI_API_KEY ausente/invalid.
- Como resolver: definir `GEMINI_API_KEY` valida.

**SUZI-ENV-004**
- Sintoma: erros 404 no Gemini.
- Causa: GEMINI_MODEL invalido.
- Como resolver: ajustar `GEMINI_MODEL` para um modelo valido.

### Discord/Interactions
**SUZI-DISCORD-001**
- Sintoma: "Unknown interaction 10062" ou respostas nao enviadas.
- Causa: interacao expirou antes do bot responder.
- Como resolver: usar `deferReply` imediato em comandos com I/O.
- Exemplo de log: `{ "code": "SUZI-DISCORD-001", "message": "Erro detectado", "context": { "stage": "reply" } }`

### Permissoes e Acesso
**SUZI-DISCORD-002**
- Sintoma: erro 50013 ao responder.
- Causa: bot sem permissao no canal/servidor.
- Como resolver: conceder permissao de enviar mensagem ou usar slash.

**SUZI-DISCORD-003**
- Sintoma: erro 50001 (missing access).
- Causa: bot nao tem acesso ao canal/thread.
- Como resolver: ajustar visibilidade ou permissao de acesso.

### Comandos/Slash
**SUZI-DISCORD-004**
- Sintoma: comando nao encontrado ou slash nao aparece.
- Causa: comandos nao registrados no deploy.
- Como resolver: reiniciar bot e registrar comandos.

**SUZI-CMD-001**
- Sintoma: parametro invalido ou option faltando.
- Causa: uso incorreto do comando.
- Como resolver: revisar parametros e tentar de novo.

**SUZI-CMD-002**
- Sintoma: erro generico ao executar comando.
- Causa: excecao nao tratada no handler.
- Como resolver: revisar logs com o contexto do comando.

### Deploy (Render/Discloud)
**SUZI-DEPLOY-001**
- Sintoma: "Port scan timeout" no Render.
- Causa: Web Service esperando porta HTTP sem expor.
- Como resolver: usar Background Worker ou configurar healthcheck/porta.

**SUZI-DEPLOY-002**
- Sintoma: "dist/index.js nao encontrado".
- Causa: build nao foi executado.
- Como resolver: rodar `npm run build` e revisar scripts.

### Gemini
**SUZI-GEMINI-001**
- Sintoma: 403 Forbidden.
- Causa: chave vazada/bloqueada ou sem permissao.
- Como resolver: gerar nova chave e revisar permissoes.
- Exemplo de log: `{ "code": "SUZI-GEMINI-001", "message": "Gemini retornou 403" }`

**SUZI-GEMINI-002**
- Sintoma: 404 Not Found.
- Causa: modelo/endpoint invalido.
- Como resolver: revisar `GEMINI_MODEL`.

**SUZI-GEMINI-003**
- Sintoma: 429 Rate limit.
- Causa: quota excedida.
- Como resolver: aguardar alguns segundos e reduzir chamadas.

**SUZI-GEMINI-004**
- Sintoma: timeout ao chamar Gemini.
- Causa: latencia alta ou indisponibilidade.
- Como resolver: tentar novamente.

### Storage (JSON)
**SUZI-STORE-001**
- Sintoma: dados resetados ou arquivo corrompido.
- Causa: JSON invalido/truncado.
- Como resolver: usar backup `.corrupt` gerado automaticamente.

**SUZI-STORE-002**
- Sintoma: dados nao persistem.
- Causa: permissao de escrita negada.
- Como resolver: garantir acesso de escrita em `data/`.

### Dados (/roll)
**SUZI-ROLL-001**
- Sintoma: erro em rolagens.
- Causa: formato invalido (1d2 a 100d100).
- Como resolver: usar exemplos como `1d2`, `2d20`, `100d100`.

## Deploy na Discloud (VS Code)
1) Instale a extensao "Discloud" no VS Code
2) Informe seu token da Discloud na extensao
3) Selecione o projeto e clique em Deploy/Upload
4) Configure as variaveis no painel:
   - `DISCORD_TOKEN`
   - `DISCORD_APP_ID`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL`

Notas:
- `.env.example` e apenas referencia (se existir). Em producao use somente as variaveis do host.
- O deploy usa `BUILD=npm ci && npm run build` e inicia com `npm start`.
