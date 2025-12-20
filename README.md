# GameBuddy Bot

Bot Discord em TypeScript para ajudar jogadores com dicas e respostas rápidas.

## Pré-requisitos
- Node.js 18+
- Yarn ou npm

## Configuração
1. Copie `.env.example` para `.env` e preencha:
```
DISCORD_TOKEN=seu_token
DISCORD_APP_ID=seu_app_id
LLM_API_KEY=opcional_para_LLM
```
2. Instale dependências:
```
npm install
```

## Scripts
- `npm run dev` — modo desenvolvimento com watch (tsx)
- `npm run build` — transpila para `dist`
- `npm run start` — roda build transpiled
- `npm run lint` — ESLint
- `npm run format` — Prettier

## Registro de comandos
O bot registra os slash commands automaticamente ao iniciar, usando `DISCORD_TOKEN` e `DISCORD_APP_ID`.

## Permissões e convite
Use este link substituindo `<APP_ID>`: 
```
https://discord.com/oauth2/authorize?client_id=<APP_ID>&permissions=2147485696&scope=bot%20applications.commands
```
Permissões mínimas: `applications.commands` e permissão de enviar mensagens.

## Rodando local
```
npm run dev
```

## Estrutura
- `src/index.ts` — bootstrap do bot
- `src/config/env.ts` — carrega variáveis de ambiente
- `src/discord/` — client e comandos
- `src/services/` — lógica de ajuda, storage simples, LLM stub
- `src/utils/logger.ts` — logger simples

## Observações
- Nunca versione tokens.
- Respostas são em pt-BR e evitam inventar detalhes específicos.
