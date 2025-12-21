# BotDiscord

## Comandos
- `/ping` - Latencia rapida.
- `/jogo nome:<texto> plataforma:<opcional>` - Ajuda estruturada para um jogo.
- `/pergunta pergunta:<texto>` - Perguntas sobre jogos com memoria curta.
- `/register nome_jogador:<texto> nome_personagem:<texto> classe:<texto> nivel:<1..99>` - Registra o player.
- `/perfil` - Mostra o perfil do player.
- `/roll expressao:<NdM>` - Rolagem de dados (ex: `2d20`).
- `/ajuda` - Mostra a lista de comandos.

## Gemini
Configure no `.env`:
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (padrao: `gemini-2.5-flash`)

Nota:
- `.env.example` e apenas referencia. O bot nao carrega esse arquivo.
- Em producao, as chaves vem exclusivamente das variaveis de ambiente do host (Render).

Checklist para trocar a key no Render:
1) Atualize `GEMINI_API_KEY` no Render
2) Clear build cache e faca deploy novamente
3) (Opcional) Use `DEBUG_GEMINI=true` para confirmar o log com o last4

Obs: rolagem de dados e sempre local com `crypto.randomInt`.

## Troubleshooting (Gemini)
- 403/404: chave ou modelo invalido/sem permissao. Verifique `GEMINI_API_KEY` e `GEMINI_MODEL`.
- 429: limite de requisicoes. Aguarde alguns segundos e tente de novo.
