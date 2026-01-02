export type ErrorCatalogEntry = {
  code: string;
  title: string;
  symptoms: string[];
  cause: string;
  fix: string[];
  exampleLog?: string;
};

export const ERROR_CATALOG: ErrorCatalogEntry[] = [
  {
    code: 'SUZI-ENV-001',
    title: 'DISCORD_TOKEN ausente',
    symptoms: ['Bot nao inicia', 'Erro ao autenticar no Discord'],
    cause: 'Variavel DISCORD_TOKEN nao definida.',
    fix: ['Defina DISCORD_TOKEN no .env ou no host (Render/Discloud).'],
  },
  {
    code: 'SUZI-ENV-002',
    title: 'DISCORD_APP_ID ausente',
    symptoms: ['Slash commands nao registram'],
    cause: 'Variavel DISCORD_APP_ID nao definida.',
    fix: ['Defina DISCORD_APP_ID no .env ou no host.'],
  },
  {
    code: 'SUZI-ENV-003',
    title: 'GEMINI_API_KEY ausente/invalid',
    symptoms: ['Respostas do /pergunta ou /jogo falham', 'Logs indicam missing key'],
    cause: 'Chave do Gemini ausente ou invalida.',
    fix: ['Defina GEMINI_API_KEY correta no host.', 'Confirme se a chave nao esta expirada.'],
  },
  {
    code: 'SUZI-ENV-004',
    title: 'GEMINI_MODEL ausente/invalid',
    symptoms: ['Erro 404 no Gemini', 'Respostas vazias'],
    cause: 'Modelo configurado nao existe ou nao tem permissao.',
    fix: ['Defina GEMINI_MODEL valido (ex: gemini-2.5-flash).'],
  },
  {
    code: 'SUZI-ENV-005',
    title: 'STEAM_API_KEY ausente',
    symptoms: ['Comandos Steam desativados', 'Perfil nao mostra dados Steam'],
    cause: 'Variavel STEAM_API_KEY nao definida.',
    fix: ['Defina STEAM_API_KEY no host para habilitar recursos Steam.'],
  },
  {
    code: 'SUZI-DISCORD-001',
    title: 'Unknown interaction (10062)',
    symptoms: ['Resposta falha com interaction expired'],
    cause: 'A interacao expirou antes do bot responder.',
    fix: ['Garanta deferReply imediato em comandos com I/O.', 'Evite esperas longas sem defer.'],
  },
  {
    code: 'SUZI-DISCORD-002',
    title: 'Missing permissions (50013)',
    symptoms: ['Comando falha ao responder', 'Sem permissao no canal'],
    cause: 'Bot ou usuario sem permissao necessaria.',
    fix: ['Conceda permissao correta no servidor/canal.'],
  },
  {
    code: 'SUZI-DISCORD-003',
    title: 'Missing access (50001)',
    symptoms: ['Comando falha em canais privados ou bloqueados'],
    cause: 'Bot nao tem acesso ao canal ou thread.',
    fix: ['Verifique visibilidade e permissao de acesso.'],
  },
  {
    code: 'SUZI-DISCORD-004',
    title: 'Comando nao registrado',
    symptoms: ['Comando nao encontrado', 'Slash command inexistente'],
    cause: 'Deploy sem registrar comandos.',
    fix: ['Execute o registro de comandos no deploy.', 'Reinicie o bot.'],
  },
  {
    code: 'SUZI-GEMINI-001',
    title: 'Gemini 403 Forbidden',
    symptoms: ['Erro 403 ao chamar Gemini'],
    cause: 'Chave bloqueada, sem permissao ou vazada.',
    fix: ['Gere nova chave', 'Revise permissoes do modelo.'],
  },
  {
    code: 'SUZI-GEMINI-002',
    title: 'Gemini 404 Not Found',
    symptoms: ['Erro 404 ao chamar Gemini'],
    cause: 'Modelo/endpoint invalido.',
    fix: ['Confirme GEMINI_MODEL e atualize o deploy.'],
  },
  {
    code: 'SUZI-GEMINI-003',
    title: 'Gemini rate limit (429)',
    symptoms: ['Erro 429', 'Resposta lenta em picos'],
    cause: 'Limite de requisicoes excedido.',
    fix: ['Aguarde alguns segundos', 'Considere reduzir chamadas.'],
  },
  {
    code: 'SUZI-GEMINI-004',
    title: 'Gemini timeout',
    symptoms: ['Timeout ao chamar Gemini'],
    cause: 'Latencia alta ou indisponibilidade temporaria.',
    fix: ['Tente novamente', 'Aumente timeout se necessario.'],
  },
  {
    code: 'SUZI-DEPLOY-001',
    title: 'Service esperando porta HTTP',
    symptoms: ['Render acusa port scan timeout'],
    cause: 'Deploy como Web Service sem expor porta HTTP.',
    fix: ['Use Background Worker ou configure porta/healthcheck.'],
  },
  {
    code: 'SUZI-DEPLOY-002',
    title: 'dist/index.js nao encontrado',
    symptoms: ['Falha ao iniciar', 'Erro de build ausente'],
    cause: 'Build nao foi executado ou falhou.',
    fix: ['Rode npm run build antes do start.', 'Confirme scripts no host.'],
  },
  {
    code: 'SUZI-STORE-001',
    title: 'Falha ao ler JSON',
    symptoms: ['Dados resetados', 'Arquivo corrompido'],
    cause: 'JSON invalido ou truncado.',
    fix: ['Restaurar backup .corrupt', 'Recriar arquivo vazio.'],
  },
  {
    code: 'SUZI-STORE-002',
    title: 'Falha ao escrever JSON',
    symptoms: ['Dados nao persistem'],
    cause: 'Permissao/IO negado no host.',
    fix: ['Verifique permissao de escrita em data/.'],
  },
  {
    code: 'SUZI-ROLL-001',
    title: 'Expressao NdM invalida',
    symptoms: ['Mensagem de erro ao rolar'],
    cause: 'Formato fora do limite (1d2 a 100d100).',
    fix: ['Use exemplos como 1d2, 2d20, 100d100.'],
  },
  {
    code: 'SUZI-CMD-001',
    title: 'Parametro invalido',
    symptoms: ['Erro ao executar comando'],
    cause: 'Option faltando ou invalida.',
    fix: ['Revise os parametros do comando.'],
  },
  {
    code: 'SUZI-CMD-002',
    title: 'Falha inesperada no comando',
    symptoms: ['Erro generico ao executar comando'],
    cause: 'Excecao nao tratada no handler.',
    fix: ['Verifique logs e contexto do comando.'],
  },
  {
    code: 'SUZI-RUNTIME-001',
    title: 'Unhandled runtime error',
    symptoms: ['UnhandledRejection/UncaughtException'],
    cause: 'Promise rejeitada ou excecao nao capturada.',
    fix: ['Revisar logs e adicionar tratamento no ponto de origem.'],
  },
  {
    code: 'SUZI-CANVAS-001',
    title: 'Canvas backend indisponivel',
    symptoms: ['Imagens em branco', 'Falha ao renderizar cards'],
    cause: 'Falha ao carregar fonte ou backend do canvas no deploy.',
    fix: [
      'Verifique se @napi-rs/canvas esta instalado corretamente.',
      'Confirme se as fontes em assets/fonts existem no deploy.',
      'Reinicie o bot apos ajustar o ambiente.',
    ],
  },
];

export type ErrorCode = (typeof ERROR_CATALOG)[number]['code'];

export const ERROR_MAP: Record<ErrorCode, ErrorCatalogEntry> = ERROR_CATALOG.reduce(
  (acc, entry) => {
    acc[entry.code as ErrorCode] = entry;
    return acc;
  },
  {} as Record<ErrorCode, ErrorCatalogEntry>,
);
