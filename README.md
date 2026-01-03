# BotDiscord (Suzi)

## Comandos
- `/ping` - Latencia rapida.
- `/jogo nome:<texto> plataforma:<opcional>` - Ajuda estruturada para um jogo.
- `/pergunta tipo:<JOGO|FILME|TUTORIAL> pergunta:<texto>` - Perguntas sobre jogos, filmes e tutoriais (tipo opcional).
- `/review add|remove|view|my|top|favorite` - Avaliacoes de jogos e filmes com ranking e favoritos.
- `/register nome_jogador:<texto> nivel:<opcional>` - Registra o perfil do jogador.
- `/perfil user:<opcional>` - Mostra o perfil do player com paginas.
- `/roll expressao:<NdM>` - Rolagem de dados (ex: `2d20`).
- `/nivel nivel:<1..99> user:<opcional>` - Atualiza o nivel do usuario.
- `/title acao:<add|remove>` - Gerencia titulos desbloqueados.
- `/steam acao:<link|view|refresh|unlink>` - Vincula e consulta perfil Steam.
- `/admin logs explain` - Explica erros (admin).
- `/admin config audit` - Checklist de configuracao (admin).
- `/admin knowledge build` - Gera knowledge interno (admin).
- `/sobre` - Lore da Suzi.
- `/conquistas` - Lista conquistas do player.
- `/ajuda` - Mostra a lista de comandos.
- `/language set idioma:<en|pt>` - Altera o idioma do servidor inteiro.

## Idioma (i18n)
- Idioma padrao: ingles.
- Para mudar o idioma do servidor: /language set idioma:<en|pt>.
- A mudanca vale para todos os comandos, embeds e botoes do servidor.

## Variaveis de Ambiente
- `DISCORD_TOKEN` (obrigatorio)
- `DISCORD_APP_ID` (obrigatorio)
- `GEMINI_API_KEY` (opcional, habilita Gemini para /pergunta e /jogo)
- `GEMINI_MODEL` (opcional, padrao: `gemini-2.5-flash`)
- `GROQ_API_KEY` (opcional, habilita Groq para /pergunta e /jogo)
- `GROQ_MODEL_FAST` (opcional, padrao: `llama-3.1-8b-instant`)
- `GROQ_MODEL_SMART` (opcional, padrao: `llama-3.1-70b-versatile`)
- `POE_API_KEY` (opcional, habilita Poe para comandos admin)
- `POE_MODEL` (opcional, override do modelo Poe)
- `POE_ENABLED` (opcional, default: `true` se POE_API_KEY existir)
- `LLM_PRIMARY` (opcional, `gemini` ou `groq`, padrao: `gemini`)
- `LLM_TIMEOUT_MS` (opcional, padrao: `12000`)
- `LLM_COOLDOWN_MS` (opcional, padrao: `600000`)
- `LLM_CACHE_TTL_MS` (opcional, padrao: `180000`)
- `LLM_MAX_OUTPUT_TOKENS_SHORT` (opcional, padrao: `300`)
- `LLM_MAX_OUTPUT_TOKENS_LONG` (opcional, padrao: `800`)
- `ALLOW_ADMIN_EDIT` (opcional, `true` libera /nivel em outros users)
- `STEAM_API_KEY` (obrigatorio para recursos Steam)
- `LLM_API_KEY` (opcional, stub de LLM legacy)
- `DEFAULT_PROFILE_BANNER_URL` (opcional, banner padrao no /perfil)
- `PROFILE_BANNER_URL` (opcional, legado para banner no /perfil)
- `SUZI_DB_DIR` (opcional, padrao: /app/data no Linux; ./data no Windows)
- `DB_PATH` (opcional, padrao: `SUZI_DB_DIR/suzi.db`)
- `DATABASE_URL` (opcional, legado; se definido e DB_PATH vazio, sera usado)
- `MIGRATE_FROM_JSON` (opcional, `true` forÃ§a migracao dos JSON para SQLite)

Notas:
- `.env.example` e apenas referencia. O bot nao carrega esse arquivo.
- Em producao, as chaves vem exclusivamente das variaveis do host (Render/Discloud).

## Banco de Dados (SQLite)
- O bot usa SQLite local por padrao (`SUZI_DB_DIR/suzi.db`).
- Para alterar o caminho, defina `DB_PATH` (ou `DATABASE_URL` legado).
- Em Railway, configure um Volume persistente em `/app/data` e use `SUZI_DB_DIR=/app/data` (ou `DB_PATH=/app/data/suzi.db`).
- Para migrar dados legados em JSON, use `MIGRATE_FROM_JSON=true` na primeira inicializacao.
- A migracao cria as tabelas automaticamente e registra o total de itens migrados nos logs.

## Multi-LLM (Gemini + Groq)
- O bot usa Gemini e Groq com selecao automatica por intent (rapido vs resposta profunda).
- Se um provider falhar (429/5xx/timeout), entra em cooldown e o outro assume.
- Ha cache por 3 minutos para reduzir chamadas repetidas.

Configurar no `.env`:
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (padrao: `gemini-2.5-flash`)
- `GROQ_API_KEY`
- `GROQ_MODEL_FAST` / `GROQ_MODEL_SMART`
- `POE_API_KEY`
- `POE_MODEL` (opcional)
- `POE_ENABLED` (opcional)
- `LLM_PRIMARY` (padrao: `gemini`)

Checklist para trocar a key no Render:
1) Atualize `GEMINI_API_KEY` no Render
2) Clear build cache e faca deploy novamente
3) (Opcional) Use `DEBUG_GEMINI=true` para confirmar o log com o last4

Obs: rolagem de dados e sempre local com `crypto.randomInt`.

## Steam
- Configure `STEAM_API_KEY` no ambiente.
- Use `/steam acao:<link|view|refresh|unlink>`.
- Observacao: jogo atual so aparece se o perfil e detalhes estiverem publicos na Steam.

## Avaliacoes de Jogos e Filmes
- As avaliacoes ficam em `data/reviews.json` (por servidor/guild e tipo).
- Estrelas e categoria sao opcionais no `/review add` (padrao: 3 estrelas, categoria jogavel).
- Opiniao e opcional (max 400).
- Favoritos aparecem no `/perfil` com badge ÐYZŠ/ÐYZE.
- Use `tipo:jogo` (padrao) ou `tipo:filme`.
- Ranking do `/review top`: soma de estrelas (total), desempate por media, votos e nome.

### Comandos /review
- `/review add nome:<texto> tipo:<jogo|filme> categoria:<amei|jogavel|ruim> estrelas:<1..5> opiniao:<texto>`
- `/review remove nome:<texto> tipo:<jogo|filme>`
- `/review view nome:<texto> tipo:<jogo|filme>`
- `/review my tipo:<jogo|filme|all> categoria:<amei|jogavel|ruim|all>`
- `/review top tipo:<jogo|filme|all> categoria:<amei|jogavel|ruim|all> limite:<5..20>` (padrao: all, limite 10)
- `/review favorite nome:<texto> tipo:<jogo|filme>`

### Exemplos
- `/review add nome:"Baldur's Gate 3" estrelas:5 categoria:amei opiniao:"absurdo de bom"`
- `/review add nome:"Your Name" tipo:filme estrelas:5 categoria:amei opiniao:"romance fechado, perfeito"`
- `/review view nome:"Baldur's Gate 3"`
- `/review top`
- `/review top tipo:filme`
- `/review my tipo:jogo categoria:amei`


