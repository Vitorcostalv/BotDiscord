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

Obs: rolagem de dados e sempre local com `crypto.randomInt`.

## Troubleshooting (Gemini)
- 403/404: chave ou modelo invalido/sem permissao. Verifique `GEMINI_API_KEY` e `GEMINI_MODEL`.
- 429: limite de requisicoes. Aguarde alguns segundos e tente de novo.
