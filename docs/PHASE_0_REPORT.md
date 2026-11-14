# Relatório da Fase 0 / proposta concreta do PR-00

14/11/2026 — revisão local da base
`b2fc55558e500ac51bd882a331379df064c2effb`.
Branch de trabalho: `build/pr-00-baseline`. `main` preservada. Plano original
fornecido pelo usuário estava não rastreado; foi preservado na preparação inicial
e recebeu as diretrizes documentais autorizadas nos fechamentos. O registro
inicial foi preparado sem commit; a política posterior autoriza commits locais.
Sem push, PR, merge ou deploy; sem mudanças globais do Codex.

## Resultado e escopo

Plano lido integralmente; árvore original inteira inspecionada: `server.js`,
`public/index.html`, manifesto e lockfile (dependências/engines/versionamento).
O repositório original possui apenas esses quatro arquivos rastreados, sem
testes, README, gitignore, CI, build ou TypeScript. Remotes conferidos:
`origin=https://github.com/weszzy/VibeDJ.git` (fork),
`upstream=https://github.com/gustavobirello4-afk/VibeDJ.git`.
Não houve fetch, sincronização, escrita nos remotes ou modificação de referências
de `main`. Contagem local PowerShell: 473 linhas de servidor, 1312 de HTML;
diferença de uma linha das contagens do plano não altera os achados.

A skill `project-audit` orientou somente a conferência inicial, sem reparos.
A entrega documental/testes segue a Fase 0 explicitamente pedida, sem criar
fila `tasks/` ou workflow persistente paralelo. Um `code_explorer` somente de
leitura levantou frontend; configuração e metadata disponível concordaram com
`gpt-6-luna`, esforço medium. Não se mediu economia de uso/custo. Pai conferiu
o servidor, integrou achados e executou validação.

## Conferência A01–A14 do documento

| ID | Evidência no código original | Resultado da conferência |
|---|---|---|
| A01 | `server.js:132,168–198` | CONFIRMADO + reproduzido: nome igual atualiza ID e permite pausar como DJ. |
| A02 | `server.js:117,150,198,466` | CONFIRMADO: singleton/broadcast global, sem API de salas. Multi-sala é recurso futuro, não recurso existente quebrado. |
| A03 | `server.js:43–115`; `index.html:96–122,736` | CONFIRMADO código de extração/buffer. **Sem chamadores de `/api/audio` ou `/api/stream` no HTML**. Não há stream paralelo na UI atual. Uso por consumidores externos desconhecido. Conformidade não foi homologada nesta fase. |
| A04 | `server.js:203–237,364–366` | CONFIRMADO falta de validação de itens/limites de domínio; faixas inválidas aceitas. Chat numérico derruba processo local descartável. Socket.IO possui limite de transporte próprio: ausência de limite de playlist não significa pacote ilimitado. |
| A05 | `server.js:150–154,360` | CONFIRMADO + reproduzido: playlists completas/mapa de votantes na projeção pública. |
| A06 | `server.js:329–340,416–466` | CONFIRMADO + reproduzido: ENDED duplicado avança duas faixas; anônimo pode acionar fallback sem DJ presente após posição >10s. Sem duração/instância. |
| A07 | `server.js:129,182–194,385–406` | CONFIRMADO: timers por nome, retomada sem token. Testado novo socket mesmo nome antes do TTL e expiração real de 15s. Colisões múltiplas de timers ainda sem teste dedicado. |
| A08 | `server.js:14–32` e handlers | CONFIRMADO CORS `*` e ausência de rate limit de aplicação; CORS HTTP reproduzido. Não foi executado teste de carga ou abuso em produção. |
| A09 | `index.html:743–746`; ausência de handler logout servidor | CONFIRMADO em execução da função real isolada: só limpa estado/storage. Socket não encerra sessão. |
| A10 | `index.html:618–623,174–201` | CONFIRMADO em VM: aplica resposta antiga sem examinar ID. Drift >1,5s aciona seek local; qualidade de sync real não medida. |
| A11 | `index.html:9–17,55` | CONFIRMADO React dev, Babel text/babel, Tailwind CDN; custo mobile ainda sem benchmark. |
| A12 | Árvore Git original | CONFIRMADO: dois arquivos de aplicação, testes ausentes antes de PR-00. |
| A13 | `index.html:280,478–490` | PARCIAL: overlay presente e `allow=picture-in-picture`; **não existe chamada de API/fluxo para iniciar PiP**. Não afirmar PiP funcional. |
| A14 | `index.html:521,552–564,789`; `server.js:117` | CONFIRMADO storage por origem e memória de processo; restart perde estado em integração. Reload/persistência real entre browsers ainda pendentes. |

## Dependências e comportamentos preservados

| Área | Dependências / comportamento / risco de remoção |
|---|---|
| HTTP/runtime | Node 24.18.0 e npm 11.16.0 validados; Express 4.22.3, Socket.IO 4.8.4, ytdl 5.2.1 do lockfile. CommonJS requer pacote ESM de ytdl no runtime atual. `public` relativo ao CWD; `PORT` e bind `0.0.0.0` mantidos. |
| Entrega frontend | React/ReactDOM 18 UMD development do unpkg; Babel standalone não pinado; Tailwind runtime CDN não pinado. Falha de CDN pode impedir render completo. Não trocados nesta fase. |
| Socket.IO | CDN cliente 4.7.2; fallback local se `io` indefinido. Fallback local acompanha servidor 4.8.4. Não equivale a fallback para falha de conexão. Mesmos eventos/ordem e snapshots mantidos. |
| Player | YouTube IFrame API, thumbs img.youtube.com, Web Audio e Media Session; player persistente com loadVideoById, volume/mudo local. Sync em foco/visibilidade/5s, correção >1,5s, fallback autoplay 1,2s. Som e mobile não homologados. |
| Metadados | Fetch noembed externo; título fallback `Vídeo (ID)`; adiciona no topo e aceita duplicatas. Falta timeout explícito no fetch. |
| Persistência | `vibedj_user_name`, `vibedj_playlist`, `vibedj_volume` por origem. Mudo só em React. Nick não é conta; playlist não é por usuário. Logout não apaga playlist/volume. |
| Fila/reprodução | Rotação circular de DJs e músicas, vazios ignorados, saída mantém faixa atual, novo DJ pode aguardar turno adicional do atual. Reprodução e votos reiniciam a cada seleção. |
| Chat/votos | Chat 100 no servidor/500 chars, UI 300; string/objeto, anônimo pode escolher remetente. Votos trocáveis por nome/socket, valores arbitrários ficam no mapa. |
| Áudio servidor | ytdl usado exclusivamente pelas duas rotas. `/api/audio` cacheia 30 min em Map sem coleta; `/api/stream` usa cache sem verificar validade e redireciona HTTP, **não transmite/proxy 206 por si**. Não foram chamadas com ID válido. Remover exige verificar consumidores externos e revisão específica. |

Ver [protocolo](SOCKET_PROTOCOL.md) para os 11 comandos, 8 eventos de saída,
ciclo de vida, payloads, destinatários, autorização e efeitos de UI.

## Menor conjunto de alterações preparado

1. README com setup, versões reais, arquitetura/limitações e scripts.
2. Um script `npm test` usando `node:test`; uma dependência dev exata:
   `socket.io-client@4.8.4`, para integração WS/polling. Só sete pacotes novos
   na árvore final; dependências de produção/versionamento preservados.
3. Oito testes unitários/harness e quinze integrações, funções **reais** do
   legado extraídas somente para VM de teste. Isso evita extrair módulos ou
   alterar assinaturas/HTML nesta fase. Quando migrar, trocar a extração por
   imports dos módulos. O harness falha se os delimitadores do legado mudarem.
4. Bootstrap só de testes observa a porta escolhida pelo SO via IPC; não altera
   `server.js`, não fixa porta nem usa serviço compartilhado nos testes.
5. Gitignore mínimo e workflow CI somente install/test com permissão de leitura.
6. Documentos e evidências de comandos/screenshots. O plano original permanece
   material do usuário, agora com a diretriz mobile-first autorizada; inclusão
   num futuro PR deve ser deliberada, pois segue não rastreado.

**Nenhuma alteração de produção em `server.js` ou `public/index.html`.** Sem nova
stack, identidade/salas, redesign, correção de segurança ou extração de mídia.
Optou-se por ainda não extrair lógica para módulos de produção: o test seam no
harness fornece referência sem mudar bootstrap, estado ou comportamento.

## Testes e evidências

- `npm ci` original: PASS, 130 pacotes instalados, audit 0 vulnerabilidades.
- Tentativa de client 4.7.2 (igual ao CDN): audit trouxe 3 alertas em dev
  (2 moderate/1 high via engine.io-client/ws); substituído somente o cliente
  novo por 4.8.4, sem `npm audit fix --force` e sem mudar produção. Isso não
  demonstra vulnerabilidade do bundle de navegador 4.7.2: o alerta era da árvore
  Node instalada experimentalmente. Nenhuma evidência de ataque remoto.
- Primeira execução de testes: 17/20, três falhas. Dois testes liam broadcasts
  pendentes de registro/fila; harness passou a usar resposta sync como barreira
  de ordenação. Outro supunha prioridade imediata do novo DJ; corrigiu-se a
  expectativa para a regra real do código. Nenhuma aplicação foi alterada.
- Unitários ampliados: 8/8 PASS. Suíte após setup limpo: **23/23 PASS**
  (8 unitários e 15 integrações), zero skipped/todo/cancelled, cerca de 24,3s.
  Setup limpo final: 137 pacotes instalados, audit 0 vulnerabilidades. Logs em
  [npm-test.txt](evidence/npm-test.txt) e [npm-ci.txt](evidence/npm-ci.txt).
- Após adicionar timeout de proteção ao teste de crash, esse caso foi repetido
  isoladamente: 1/1 PASS. Nenhuma lógica de produção ou expectativa foi mudada.
- Checagem sintática `node --check` do servidor e quatro arquivos de teste:
  PASS. `git diff --check` padrão acusou CRLF como whitespace nos dois JSON já
  em CRLF; `git -c core.whitespace=cr-at-eol diff --check`: PASS, sem normalizar
  arquivos inteiros nem alterar configuração Git global/local.
- [Matriz](REGRESSION_MATRIX.md) separa regressão, defeitos caracterizados,
  smoke visual e lacunas. Capturas: [sala](evidence/baseline-room.jpg),
  [chat](evidence/baseline-chat.jpg). Login, título real noembed, fila, chat,
  voto e badge de pausa foram observados em duas abas do browser integrado.
- No smoke inicial, YouTube retornou vídeo indisponível; **não** validado áudio/autoplay/drift/fim
  natural. Não houve Android conectado, segundo browser independente, teste de
  rede móvel real, benchmark, carga, auditoria de conformidade ou execução CI
  remota. `npm audit` não analisa o código próprio nem CDNs.

## Riscos e próximas decisões

**Bloqueadores antes de publicação:** identidade por nome, payload capaz de crash,
ENDED não idempotente e mídia/background sem revisão. A ausência de multi-sala
deve ser declarada: adicionar isolamento é fase futura, não parte do baseline.
Os testes verdes são linha de base; não liberam produção nem garantem Android.

Discutir com mantenedor/amigo antes de alterar regras: saída de fila, fairness
na entrada tardia, DJ ausente, retomada e nomes repetidos, TTL mobile, retenção e
consumidores de áudio. Não houve conversa nem decisões atribuídas a terceiros.

## Plano de execução/revisão do PR-00

1. Revisar localmente o diff restrito preparado nesta branch; conferir versões
   de produção invariantes e arquivos originais intactos.
2. Reproduzir `npm ci` e `npm test` com Node 24.18.0. Conferir que casos KNOWN
   BASELINE exibem o risco real e não estão skipped/todo.
3. Completar o roteiro de dois browsers e dois Android quando disponíveis;
   guardar versões, condições de rede, vídeo reproduzível e screenshots. Fase 0
   documental/automatizada pronta; gate de homologação mobile continua aberto.
4. Revisar semântica com mantenedor; atualizar matriz com evidência, sem presumir
   concordância. Não misturar correções dos PR-01/02.
5. Selecionar/revisar arquivos e criar commits locais organizados, conforme a
   política posterior. **Somente com autorização explícita:** push no fork e
   abertura de PR para destino combinado. Revisão do mantenedor antes de integrar;
   CI remota e verificação de auto-deploy ainda precisam ocorrer antes do merge.

Aceite local: setup limpo, testes de referência reproduzíveis, mapa completo de
eventos/dependências, limitações explícitas e UI/servidor intactos. Aceite visual
completo Android/áudio: pendente pelos bloqueios descritos, sem declarar fase
mobile homologada. Rollback: abandonar esta branch ou reverter apenas o futuro
commit PR-00; não há dados, protocolos ou runtime para migrar/reverter. Remover
arquivos de suporte deve preservar o plano original não rastreado do usuário.

## Complementação mobile-first e fechamento local

### Resultado atualizado

Diretriz formalizada no [plano](../VibeDJ_Plano_Modernizacao_Arquitetura.md) e
detalhada no [README](../README.md): **smartphone primeiro, Android Chrome
prioritário, compatibilidade iOS Safari e desktop**. Evolução progressiva para
tablet/desktop; eficiência de JS/carregamento/memória/CPU/bateria/dados;
touch-first sem hover obrigatório; acessibilidade/legibilidade/movimento
reduzido; player persistente somente quando permitido; recuperação em rede
móvel; preservação das funcionalidades durante a migração.

Este fechamento modifica somente documentação/evidências. Nenhum teste,
manifesto, lockfile, workflow, fonte da aplicação, skill ou instrução Codex foi
alterado. Não houve instalação. A `main` permanece na base informada. Resultado
atual: Fase 0 documental e automatizada preparada; homologação mobile, áudio
audível e sincronização física continuam **PENDING**, sem aceite simulado.

### Validação de reprodução incorporada

Ambiente: navegador integrado do Codex no Windows, aplicação real em
`http://127.0.0.1:3179`, sem mocks nem novo mecanismo de mídia. Vídeo público
selecionado: **YouTube Developers Live: Embedded Web Player Customization**,
ID `M7lc1UVf-VE`, usado no
[exemplo oficial da IFrame API](https://developers.google.com/youtube/iframe_api_reference#Getting_started).
A possibilidade de embed foi confirmada por reprodução efetiva nesta sessão,
não apenas por título/metadados ou pela presença no exemplo oficial.

| Ação no VibeDJ | Evidência observada | Conclusão limitada |
|---|---|---|
| Adicionar vídeo oficial e entrar na fila | Título via noembed e frames/legendas no iframe; controles YouTube mostram tempo decorrido | PASS reprodução visual local |
| Pausar pela UI DJ | Elemento `<video>`: `paused=true`, `currentTime=33.047037`, `duration=1343.661`, `readyState=4`, `muted=false` | PASS pausa real, além do badge de estado |
| Retomar pela UI DJ | `paused=false`, tempo 33.430361, mesma duração/readyState | PASS retomada real |
| Skip para vídeo anterior `dQw4w9WgXcQ` | Player exibe “Este vídeo não está disponível”; aviso onError serializado como `Object` | BLOCKED essa faixa, sem código numérico capturado |
| Skip de volta ao vídeo oficial | `paused=false`, tempo 0.044541 e depois 27.259161 | PASS recuperação/avanço no mesmo fluxo de player |
| Banner de desbloqueio | Apareceu transitoriamente após a troca, desapareceu antes do clique de verificação; vídeo depois estava reproduzindo | Não validado desbloqueio por gesto; aviso não comprova causa de autoplay |

Dados: [mobile-media.json](evidence/mobile-media.json); capturas
[vídeo oficial](evidence/youtube-official-playing.jpg) e
[faixa indisponível](evidence/youtube-comparison-unavailable.jpg).
O teste utilizou somente o player/controles existentes. Não se acessaram rotas
de extração, não se criaram streams, fontes de áudio ou mecanismos de background.
O pipeline silencioso preexistente não foi removido nem homologado.

**Diagnóstico:** a comparação reduz a hipótese de falha universal do VibeDJ ou
bloqueio universal de mídia no ambiente: a mesma instalação reproduziu um vídeo
e não o outro. A falha é compatível com uma indisponibilidade/restrição específica
da faixa/contexto, mas **a causa exata não foi isolada**. Não atribuir
automaticamente a copyright, região, autoplay, Referer ou bug do código. A UI
exibir “Ao Vivo” durante erro também não prova reprodução; isso reflete o estado
do servidor. Não foi verificada identidade persistente do nó iframe entre trocas.

### Procedimento de diagnóstico para desktop e aparelhos físicos

1. Usar perfil/sessão de teste, registrar versões, origem, rede, ID e gesto;
   testar primeiro `M7lc1UVf-VE` visível, por ação do usuário. Confirmar frames,
   progresso e pause/play do vídeo real; observar separadamente som audível.
2. Se falhar, registrar mensagem, evento `onError.data`, contexto do iframe e
   requisições/status no DevTools ou inspeção remota autorizada. Na sessão atual
   o coletor serializou o objeto, impedindo classificar pelo código.
3. Conforme [referência da API](https://developers.google.com/youtube/iframe_api_reference#onError):
   `2` indica parâmetro inválido; `5`, falha de player HTML5; `100`, vídeo
   ausente/privado; `101/150`, incorporação não permitida pelo proprietário;
   `153`, identificação/Referer ausente. Não inferir esses códigos da mensagem.
4. Para identificar ambiente versus código, repetir o mesmo vídeo/rede em Chrome
   real e numa página-controle mínima com o exemplo oficial, sem lógica de sala,
   servida por origem HTTP(S) válida com identificação normal. Comparar logs,
   políticas de permissões, bloqueios/extensões e headers **observados**, sem
   falsificar identificação, desabilitar proteções ou contornar restrições.
   Essa comparação com página-controle/perfil independente ainda não foi feita.
5. Registrar `onAutoplayBlocked` quando disponível e condições de gesto/permissão;
   o aviso genérico do fallback atual não distingue erro de mídia de bloqueio de
   autoplay. Não alterar handlers de produção neste fechamento. Testar gesto
   legítimo no aparelho quando o vídeo é incorporável e carregou sem erro.
6. Repetir A-M01–10 e I-M01–06 da matriz em Android Chrome e compatibilidade iOS.
   Para PiP, apenas observar oferta nativa permitida e retomada; não forçar API
   ou substituir mídia. Tela bloqueada/minimização podem suspender reprodução;
   o critério é retomar estado corretamente quando permitido, não tocar oculto.

Referências verificadas em 14/11/2026:
[IFrame API](https://developers.google.com/youtube/iframe_api_reference),
[identificação e requisitos mínimos](https://developers.google.com/youtube/terms/required-minimum-functionality#api-client-identity-and-credentials),
[políticas do player](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions).
A documentação de origem exige viewport mínimo do player e identificação do
cliente; proíbe separar áudio e promover player oculto. A diretriz de persistência
não prevalece sobre esses limites. Não foi feita uma homologação de conformidade.

### Evidências de layout e testes

- `npm test` repetido com os **mesmos 23 testes**: 23 PASS, 0 FAIL, 0 skipped,
  0 todo e 0 cancelled, 22,77s. [Log desta execução](evidence/mobile-first-tests.txt).
  A matriz agora classifica cada teste como funcionalidade, defeito caracterizado
  e/ou contrato a decidir, e lista expectativas futuras sem implementá-las.
- Viewports integrados 320/360/390/430px e horizontal 844×390 medidos no DOM.
  Iframe com altura inferior a 200px em 320, 360 e horizontal: **FAIL conhecido**,
  não corrigido. As outras duas alturas atendem ao mínimo nessa captura, sem
  aprovação integral de layout. Dados e cinco capturas estão na matriz.
- `scrollWidth` da raiz igualou a largura em todos os cenários; isso não verifica
  clipping interno, alcance de scroll, teclado virtual, safe areas ou touch.
- `adb devices`: lista vazia novamente. Sem Android físico nem iOS Safari.
  Viewport foi restaurado ao padrão após as capturas. Sem benchmark de recursos,
  medição de bateria, rede celular, sync entre aparelhos ou fim natural.
- [Conferência SHA-256](evidence/mobile-preservation.json): aplicação, quatro
  arquivos de testes/harness, manifesto, lockfile, gitignore e workflow iguais
  ao início deste fechamento; `main` preservada em `b2fc555`. A alteração do plano
  foi exclusivamente documental e autorizada. Trinta e um links locais foram
  conferidos antes desta referência adicional; diff rastreado passou com a
  convenção CRLF existente. O servidor local de verificação foi encerrado.

### Critérios de aceite do PR-00

| Critério | Situação atual / gate |
|---|---|
| Escopo somente baseline/docs, sem mudança de comportamento | Atendido; código, dependências e 23 testes preservados neste fechamento |
| Diretriz mobile-first vinculante e compatibilidade secundária declarada | Atendido no plano/README/matriz |
| Setup e testes reproduzíveis com evidências | Atendido localmente; npm ci anterior + repetição atual 23/23; CI remota pendente |
| Eventos/dependências e defeitos conhecidos transparentes | Atendido; protocolo legado e classificação F/D/C sem mascarar falhas |
| Matriz Android/UI com procedimentos, estados e evidências | Atendido documentalmente; execuções físicas ainda PENDING |
| Reprodução com vídeo incorporável | Atendido no integrado para vídeo/pausa/retomada/troca; áudio audível e Android não homologados |
| Riscos mobile descobertos registrados sem redesign | Atendido; mínimo do iframe falha em três cenários, não corrigido |
| Decisões do mantenedor e homologação física | Pendentes; precisam de responsável, ambiente e registro real, sem presumir concordância |
| Commit/push/PR/CI remota | Commits locais autorizados pela política posterior; push/PR dependem de autorização explícita; CI remota pendente |

**Aceite documental/local do PR-00** pode ser revisado com essas pendências
explícitas. **Aceite de Android/lançamento** não está atendido. Nenhum PASS local
substitui os gates físicos nem remove os bloqueadores de segurança/conformidade.

### Recomendação de continuidade para PR-01 (não implementado)

Priorizar identidade e autorização: `participantId` opaco, prova de posse de
retomada por token, separação entre nome de exibição e autoridade, logout que
revoga sessão no servidor e invalidação do socket anterior ao retomar. Adaptar
o protocolo legado com a menor mudança compatível; sem salas novas, build ou
redesign. A troca de rede mobile deve poder mudar `socket.id` sem conceder
autoridade a quem só conhece o apelido.

Aceite proposto: nomes iguais não compartilham privilégios/votos de identidade;
token ausente/inválido/expirado não toma DJ; retomada legítima mantém estado na
janela acordada e revoga autoridade antiga; logout impede comandos posteriores;
tokens não aparecem em snapshots nem logs. Atualizar os casos D de identidade/
logout para exigir comportamento seguro, preservando regressões funcionais.

Mantenedor precisa decidir TTL/rotação/revogação do token, retomadas concorrentes,
efeito do logout do DJ e política de ausência/saída da fila. Registrar decisões
e critérios antes de mudar regras. PR-02 continua dono de validação/limites/CORS
e do crash de chat; correções ENDED/sync e layout mantêm seus escopos posteriores.
Nenhum desses problemas deve ficar oculto por um PR-01 verde.

Recomenda-se seguir ao PR-01 após aceite do escopo e das decisões de identidade,
mantendo homologação mobile como gate aberto e prioritário. Não é necessário
antecipar redesign/stack para corrigir autoridade; a liberação de produção
continua bloqueada pelos riscos documentados. Não se iniciou o PR-01 aqui.

## Política colaborativa adotada após o fechamento mobile-first

A [política de Git, revisão e publicação](CONTRIBUTING.md) formaliza os doze
pontos do usuário. A autorização para commits locais substitui a restrição
anterior somente nessa operação. Push/PR exigem autorização explícita; revisão
do mantenedor precede integração; homologação prioriza Android Chrome; merge
não autoriza produção. Mudanças incompatíveis exigem transição, testes e rollback.

O PR-00 é um único escopo de baseline, documentação e testes, com arquivos
revisados antes do commit local. A aplicação permanece inalterada. Os registros
de preservação SHA-256 anteriores são evidências históricas das respectivas
rodadas, não do estado de todos os documentos após esta política.
Após registrar a política, `npm test` foi executado novamente: **23/23 PASS**,
sem skipped/todo/cancelled, aproximadamente 23,38s. Na revisão do índice, cinco
quebras Markdown de dois espaços no plano original foram convertidas para
quebras explícitas com barra invertida, preservando a apresentação e permitindo
a checagem de whitespace. Nenhum código ou teste foi alterado nesta rodada.

Verificação de deploy realizada nesta rodada: inspeção da árvore local e do
workflow `baseline.yml`, somente install/test. Configurações externas dos
repositórios/provedores permanecem desconhecidas. **Gate antes do primeiro merge:
pendente.** Não se verificou auto-deploy em painel remoto nem se alterou serviço.
Risco: integrar `main` pode disparar publicação automática, restart, desconexão
e perda do estado volátil; push também pode disparar preview. Esses efeitos
precisam ser esclarecidos com evidência antes de autorizar ações remotas.
