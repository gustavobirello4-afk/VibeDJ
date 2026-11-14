# VibeDJ

Protótipo de sala musical colaborativa: React no navegador, Express e Socket.IO
em um processo Node. Há **uma sala global**, sem contas, banco ou isolamento por
sala. PR-00 estabeleceu a baseline; PR-01 acrescenta sessões anônimas em memória,
identidade por participante e autorização de DJ independente do apelido.

## Diretriz obrigatória: mobile-first

**O VibeDJ é MOBILE-FIRST. Android com Google Chrome é a plataforma prioritária,
mantendo compatibilidade com iOS Safari e desktop.** Esta é uma decisão de
produto/arquitetura; não significa que o protótipo já cumpre todos os critérios.

- Projetar e validar a interface primeiro em smartphones, começando pelas
  larguras de 320, 360, 390 e 430 px; ampliar progressivamente para tablet/desktop.
- Priorizar baixo consumo de memória, CPU, bateria e dados. Medir em condições
  móveis registradas, separando aplicação, CDNs e mídia do YouTube; não declarar
  eficiência com base apenas em testes Node ou em viewport desktop reduzido.
- Manter JavaScript mínimo e carregamento eficiente; justificar cada dependência
  e evitar trabalho redundante, timers agressivos e recriação desnecessária do
  player. A migração de build segue as fases do plano, sem antecipá-la no PR-00.
- Usar interações touch-first, sem ações essenciais dependentes de hover ou
  drag-and-drop. Preservar alternativa de reordenação por botões e teclado.
- Preservar a instância do player na navegação interna quando tecnicamente e
  pelas políticas permitido. Persistência de instância não autoriza áudio com
  player oculto, tela bloqueada ou app minimizado; não garantir PiP externo.
- Recuperar estado após redes móveis instáveis e retomada; a futura identidade
  deve sobreviver à troca de socket com prova de posse, sem confiar no apelido.
- Garantir acessibilidade, legibilidade, foco, nomes acessíveis e áreas de toque
  adequadas; respeitar `prefers-reduced-motion`, orientação, teclado virtual e
  áreas seguras do dispositivo.
- Preservar as funcionalidades atuais durante a migração. Alterações em regras
  devem ser explícitas e testadas; defeitos conhecidos são caracterizados até
  sua correção, sem serem promovidos a requisitos permanentes.

Consulte a [matriz mobile e classificação dos testes](docs/REGRESSION_MATRIX.md)
e o [fechamento com gates do PR-00/PR-01](docs/PHASE_0_REPORT.md).

## Executar localmente

Para colaboração, commits, revisão e gates de publicação, seguir a
[política de Git e PRs](docs/CONTRIBUTING.md). Commits locais são autorizados;
push/abertura de PR exigem autorização explícita. Merge e deploy são decisões
separadas. Auto-deploy de `main` ainda exige verificação externa antes do merge.

Ambiente validado: Windows, Node **24.18.0**, npm **11.16.0**. Use essa versão
para reproduzir a linha de base. A árvore existente de `@distube/ytdl-core`
exige Node `^22.22.2 || ^24.15.0 || >=26.0.0`; versões antigas do Node não são
uma base suportada por esse lockfile. Outras versões não foram testadas.

Na raiz do repositório:

```powershell
npm ci
npm test
npm start
```

Abra `http://localhost:3000`. Para outra porta, no PowerShell:

```powershell
$env:PORT = '3179'
npm start
```

`npm start` inicia `server.js` e escuta `0.0.0.0` na porta `PORT` (padrão 3000).
Execute da raiz: `express.static('public')` depende do diretório de trabalho.
Interrompa com Ctrl+C. Não há build, lint ou typecheck no protótipo.

## Arquitetura e dependências

- `server.js`: HTTP, endpoints de áudio, sala em memória, fila circular, chat,
  votos, controle de reprodução e tolerância de desconexão de 15 segundos.
- `session-store.js`: IDs/tokens criptográficos, rotação, revogação, dono único
  por sessão e validade de 24 horas por inatividade, sem banco ou dependência nova.
- `public/session-client.js`: credencial no `sessionStorage` da aba, retomada,
  retry correlacionado e confirmação de logout, sem polling adicional.
- `public/index.html`: JSX compilado no navegador por Babel; React/ReactDOM 18
  development, Tailwind CDN, Socket.IO CDN, YouTube IFrame API e noembed.
- `package-lock.json`: trava Express 4.22.3, Socket.IO 4.8.4 e
  `@distube/ytdl-core` 5.2.1. As faixas do manifesto não são versões instaladas.
- `tests/`: testes nativos Node, funções reais extraídas somente no harness VM
  e integrações em processos descartáveis com clientes Socket.IO reais.
- `docs/`: protocolo legado, dependências, matriz de regressão e relatório PR-00.

A única dependência nova é `socket.io-client@4.8.4`, **de desenvolvimento**, para
testar WebSocket e polling. Não é carregada pela UI. O cliente CDN continua em
4.7.2; o fallback local é servido pelo Socket.IO do servidor. Não se instalaram
Vite, TypeScript, Tailwind, Zod, Vitest, Playwright ou banco nesta etapa.

Testes não consultam YouTube/noembed nem extraem mídia. Os testes de integração
abrem portas efêmeras, usam o `server.js` real e encerram seus processos. Um caso
documenta propositalmente o crash de chat numérico em processo descartável.
Os testes `KNOWN BASELINE` restantes confirmam defeitos existentes; verde **não** significa
que esses defeitos foram corrigidos. CI configurada com `npm ci` e `npm test`,
com resultado remoto a conferir antes de integrar cada PR.

## Limitações conhecidas

Apelido é somente visual: nomes iguais têm IDs, filas, playlists e votos
independentes. Token de retomada é privado e rotacionado; socket antigo perde
autoridade. Logout revoga a sessão no servidor e preserva playlist/volume/nome
salvo. Clientes sem token podem registrar identidade nova, nunca recuperar DJ
pelo apelido. Veja [regras e limitações de sessões](docs/SESSIONS.md).

Payloads ainda não têm validação de domínio suficiente; chat numérico de cliente
autenticado pode derrubar o processo e fim duplicado pode pular duas faixas.
CORS é aberto. Não use testes de caracterização como aprovação de segurança.

Playlist fica no `localStorage` sob chave por participante; a playlist legada é
preservada como semente local de migração. Apelido/volume continuam locais por
origem. O token fica somente no `sessionStorage` da aba (ou memória se indisponível).
A sala, o chat e as sessões são perdidos no restart da Render; o cliente volta
ao login quando a credencial não puder ser retomada. A rede externa é necessária para
CDNs, títulos e player. Os endpoints de extração de áudio continuam presentes,
embora sem chamadores no frontend deste repositório; o buffer silencioso também
continua presente. Conformidade de mídia requer revisão antes de publicação.

No primeiro smoke, o vídeo escolhido exibiu **“Este vídeo não está disponível”**.
Na complementação, o vídeo oficial de exemplo `M7lc1UVf-VE` reproduziu no iframe
do VibeDJ: avanço, pausa e retomada confirmados no elemento de vídeo. O vídeo
anterior continuou indisponível no mesmo player; sua causa exata não foi isolada.
Áudio audível, sync entre dispositivos, autoplay/desbloqueio físico e Chrome
Android **não foram homologados**. Ver [evidências e diagnóstico](docs/PHASE_0_REPORT.md).

Leia [o relatório da Fase 0](docs/PHASE_0_REPORT.md),
[o protocolo completo](docs/SOCKET_PROTOCOL.md) e
[a matriz de regressão](docs/REGRESSION_MATRIX.md).
