# Matriz de regressão — Fase 0

## Atualização funcional PR-01 (vigente)

As tabelas da Fase 0 abaixo são históricas. PR-01 substitui os asserts dos
defeitos corrigidos, mantendo a cobertura funcional; não mantém teste exigindo
tomada de DJ, logout apenas local ou ENDED anônimo. Contrato atual em
[SESSIONS.md](SESSIONS.md) e [SOCKET_PROTOCOL.md](SOCKET_PROTOCOL.md).
Resultado final: **45/45 PASS**, 0 FAIL/skipped/todo/cancelled; os 23 casos
anteriores adaptados + 22 novos, [log](evidence/pr-01-tests.txt).

| Aceite PR-01 | Evidência automática atual |
|---|---|
| Homônimos independentes; DJ não usurpável | integração `A01/A07 fixed` e `same-name playlist ownership` |
| Somente dono autorizado controla reprodução/fila/playlist/chat/voto | integração `distinct-name listener`, `replacement`, `logout revokes` |
| Retomada legítima com rotação | `credentialed reconnect`; store e client de sessão |
| Token inválido, expirado ou revogado | store com relógio controlado, logout/restart reais |
| Socket antigo e tentativas concorrentes | integração `replacement`, `simultaneous old-token` |
| Resposta perdida/duplicada e confirmação de token | store e controlador real em fixture, recuperação além de 60s |
| Logout durante registro, offline e confirmação antiga | client e integrações `correlated logout`, `delayed logout` |
| Grace de 15s antes/depois sem reinserção automática | integração real `disconnect expiry` + retomada após liberar fila |
| Token não público nem em logs | integração `no token in public events` |
| Sem fallback anônimo ENDED | integração `A06 authorization fixed` |

Persistem fora do escopo: ENDED duplicado pelo DJ legítimo, sync obsoleto,
snapshot amplo e itens inválidos, chat numérico autenticado causa crash,
validação/CORS/anti-abuso, política de mídia e altura mínima do player. Esses
testes KNOWN BASELINE continuam caracterização, não aceitação do defeito.

Smoke integrado repetiu login isolado por aba, mesmo apelido sem controles do
outro, reordenação isolada, reload com papel DJ preservado, pause e logout real.
Capturas: [DJ retomado](evidence/pr-01-dj-resumed.jpg),
[homônimo ouvinte a 390px](evidence/pr-01-same-name-listener-390.jpg).
Android físico/iOS, troca real de redes e expiração de 24h em aparelho continuam
PENDING. TTL é validado com relógio controlado, não com espera de 24h.

## Registro histórico PR-00

Data: 14/11/2026. Base: `b2fc55558e500ac51bd882a331379df064c2effb`.
PASS significa resultado observado conforme baseline, não adequação ao alvo.
KNOWN BASELINE identifica defeito reproduzido. BLOCKED é falta de ambiente ou
dependência externa. PENDING exige sessão humana ou execução posterior.

## Automatizado, sem mídia externa

| Cenário | Evidência | Estado / contrato atual |
|---|---|---|
| Extrair ID, watch/Shorts/live/embed/ID cru, inválidos | `unit.test.cjs`: URL baseline | PASS; regex também aceita domínio malicioso contendo substring YouTube; defeito mantido |
| Formatar tempo e relógio play/pausa/idle | unit: time formatting / room clock | PASS com relógio determinístico |
| Playlist: topo, título e fallback noembed | unit: actual add-song, fixtures de fetch | PASS sem rede; não é teste do serviço externo |
| Playlist: setas, limites, drag/drop, remover/persistir | unit: actual playlist handlers | PASS em VM; gestos reais de arrastar/touch ainda pendentes |
| Logout | unit: KNOWN BASELINE A09 | PASS da reprodução; remove nome local, nenhum evento servidor |
| Sync obsoleto | unit: KNOWN BASELINE A10 | PASS da reprodução; aplica tempo de faixa antiga |
| HTTP, HTML, client local, OPTIONS/CORS, IDs áudio inválidos | integration: HTTP baseline | PASS; nenhuma extração feita |
| Dois clientes, WS e polling | integration: HTTP baseline + two clients | PASS; não são dois navegadores físicos |
| Login, trim/registro, snapshot e rotação | integration: two clients | PASS; A tem outro turno se B entrou depois |
| DJ pause/play/seek/skip | integration: two clients | PASS por socket; seek não é emitido pela UI |
| Não-DJ nome diferente é rejeitado | integration: distinct-name listener | PASS para controles e ENDED com DJ presente |
| Trocar playlist tocando / sair fila / vazio / idle | integration: playlist update / empty DJ | PASS; sair da fila mantém faixa tocando |
| Woot→Meh, valor inválido e reset | integration: votes | PASS; inválido fica no mapa, não conta |
| Chat string/objeto, remetente, trim, limite/histórico | integration: chat | PASS; anônimo pode escolher nome; 500 servidor x 300 UI |
| Nome duplicado assume DJ | integration: KNOWN BASELINE A01/A07 | PASS da reprodução local; falha de segurança permanece |
| Dois ENDED | integration: KNOWN BASELINE A06 | PASS da reprodução; avança duas faixas |
| Faixas inválidas e playlists públicas | integration: KNOWN BASELINE A04/A05 | PASS da reprodução; não é stress de payload gigante |
| Reconexão antes TTL | integration: reconnect by name | PASS por novo socket mesmo nome, sem token |
| Expiração após 15s reais | integration: disconnect expiry | PASS, avança DJ e remove ausente; sem fake timers |
| ENDED anônimo com DJ ausente e elapsed >10 | integration: A06 fallback | PASS da reprodução; seek simula posição >10, não duração real do vídeo |
| Payload chat `{text:42}` | integration: numeric chat | PASS da reprodução do **crash** do processo descartável; segurança FAIL |
| Restart | integration: restart loses room state | PASS; memória perdida conforme contrato existente |

## Smoke visual inicial (histórico)

Navegador integrado do Codex, duas abas, viewport ambiente (captura sala
1280×720; captura chat 895×905). Não eram dois browsers independentes e
compartilhavam `localStorage`. Nomes de teste: Baseline Alice e Baseline Bob.
A segunda aba entrou automaticamente como Alice por nome salvo; efetuamos
logout local e login Bob para separar os sockets. Sem mocks de player/CDN.

| Fluxo | Estado / evidência |
|---|---|
| Login, indicador Online e segunda aba | PASS visual, dois sockets e nomes distintos |
| Adicionar URL e obter título real via noembed | PASS visual; Rick Astley foi adicionado no topo |
| Entrar fila, DJ e controles visíveis | PASS visual; Alice DJ, Bob ouvinte |
| Voto Woot e chat Bob→Alice | PASS visual, contador 1 e mesma mensagem |
| Pausa de Alice propagada ao estado de Bob | PASS visual; badge “Pausado pelo DJ” |
| Abrir aba Chat e contador de mensagens | PASS visual, mensagem recebida; [captura](evidence/baseline-chat.jpg) |
| Iframe YouTube | BLOCKED reprodução: “Este vídeo não está disponível”; [captura](evidence/baseline-room.jpg) |
| Som, autoplay, seek real no iframe, drift e fim natural | BLOCKED pela reprodução indisponível; não inferir dos testes socket |

## Pendências explícitas e roteiro manual

1. **Dois browsers/perfis isolados desktop**: usar origens iguais, storages
   separados; cadastrar A/B, adicionar 3 faixas permitidas para embed; repetir
   topo/setas/drag/drop/remover; recarregar e confirmar playlist/volume/nome.
2. **Dois Android Chrome físicos**: registrar modelo, OS, versão Chrome, rede,
   gesto inicial e ID do vídeo. `adb devices` retornou lista vazia nesta sessão.
   Testar 360/390px, teclado, touch, scroll, volume/mudo, autoplay bloqueado,
   mudança Sala↔Chat (iframe fica oculto por CSS), background, bloqueio de tela,
   Media Session e retorno com resync. Nenhum desses itens foi homologado.
3. **Reconexão real**: desabilitar/reabilitar rede, trocar Wi-Fi/dados, voltar
   antes/depois de 15s; verificar snapshot, papel DJ, duplicação e progressão.
   Teste Node cobre novo socket, não suspensão/gestão de processos Android.
4. **Mídia**: erro YT, indisponibilidade, rede lenta, faixa repetida e fim natural;
   medir drift de 2–5 players e guardar vídeo/logs. Metas do plano não são medidas.
   PiP não tem fluxo implementado; não tratá-lo como recurso validado.
5. **Conversa com mantenedor/amigo**: decidir saída de fila, prioridade de quem
   entra durante faixa, política de DJ ausente, duplicidade de nome futura,
   retenção e uso externo dos endpoints de áudio. Não houve essa conversa.
6. **CI remoto/Linux**: workflow foi escrito, não publicado nem executado no
   GitHub. Lint/build/typecheck não existem ainda; não há resultado PASS deles.

Casos de correção futura devem substituir explicitamente as expectativas
KNOWN BASELINE pelo comportamento seguro. Não manter testes exigindo o defeito
depois de corrigi-lo, nem simplesmente removê-los para esconder regressões.

## Classificação dos 23 testes preservados

Complementação mobile-first de 14/11/2026. Arquivos de teste e expectativas
permanecem intactos. Nova execução: **23/23 PASS**, zero skipped/todo/cancelled;
[log integral](evidence/mobile-first-tests.txt). Os IDs abaixo são documentais,
não novos testes implementados.

**F** = funcionalidade correta verificada dentro do alcance do teste.
**D** = caracterização de defeito conhecido; PASS confirma a existência da falha.
**C** = contrato legado que depende de decisão explícita do mantenedor.
Um teste pode conter asserts das três categorias: sua cor verde não aprova todos
os comportamentos nem homologa o browser/dispositivo. Os nomes abreviados abaixo
correspondem aos testes existentes em `tests/unit.test.cjs` e `tests/integration.test.cjs`.

| ID | Teste existente | Categoria e alcance |
|---|---|---|
| U01 | URL baseline | F URLs suportadas + D aceita substring de domínio falso |
| U02 | time formatting | F formatação/rounding/fallback |
| U03 | room clock | F play/paused/idle + C `startTime=0` tratado como ausente |
| U04 | KNOWN BASELINE A09 logout | D logout só local |
| U05 | KNOWN BASELINE A10 sync | D aplica resposta de faixa antiga |
| U06 | actual playlist handlers | F setas/limite/reordenação/remoção/storage em VM; não gesto touch |
| U07 | actual add-song / title | F inserção no topo, título fixture e persistência |
| U08 | actual add-song / failure fallback | F fallback de título quando fetch fixture falha |
| I01 | HTTP baseline | F HTTP/IDs inválidos/client/transporte + D CORS aberto |
| I02 | two clients | F registro/rotação/controles/skip + C turno adicional de A quando B entra depois |
| I03 | distinct-name listener | F rejeição por servidor de não-DJ com nome distinto; não prova identidade segura |
| I04 | playlist update | F atualização/idle + C saída da fila preserva faixa |
| I05 | empty DJ | F ignora vazios e inicia após update |
| I06 | votes | F troca/reset + D conserva tipo inválido + C chave por nome/ID |
| I07 | chat | F trim/limites/histórico + D anônimo pode forjar remetente |
| I08 | KNOWN BASELINE A01/A07 | D nome igual toma identidade/privilégio do DJ |
| I09 | KNOWN BASELINE A06 duplicate | D dois ENDED avançam duas faixas |
| I10 | KNOWN BASELINE A04/A05 | D itens inválidos e playlists completas públicas |
| I11 | reconnect by name | F preserva faixa/posição em novo socket + D retoma sem credencial |
| I12 | disconnect expiry | F expiração real em 15s + C política de avanço do ausente |
| I13 | KNOWN BASELINE A06 fallback | D anônimo termina faixa com DJ ausente e posição >10s |
| I14 | numeric chat crashes server | D crash confirmado em processo descartável, segurança FAIL |
| I15 | restart | C estado volátil perdido; F boot novo fica idle sem dados anteriores |

### Expectativas futuras após correções (ainda não implementadas)

| Futuro teste de aceite | Resultado necessário | Fase/PR dono |
|---|---|---|
| Nomes iguais e takeover | Identidades distintas, outro participante não assume DJ | PR-01 |
| Reconnect após Wi-Fi→dados | Token legítimo retoma participante; token ausente/inválido não assume nome | PR-01 + validação Android |
| Logout com socket conectado | Remove autoridade/sessão no servidor, impede comandos seguintes | PR-01 |
| Payloads inválidos, inclusive chat numérico | Rejeição controlada, servidor vivo e regras/limites explícitos | PR-02 |
| URL com host falso/ID inválido | Rejeição antes de consultar serviços; política de URL explícita | PR-02 |
| Projeção pública | Retorna somente dados necessários ao contrato combinado | Fase de contratos/backend |
| ENDED duplicado/antigo e sync obsoleto | Transição única e mensagens obsoletas ignoradas por instância/revisão | Fase de máquina de estados/sync |
| Fallback de ausência do DJ | Política explícita baseada em estado; sem salto anônimo arbitrário | Fase de reprodução/sync |
| Performance/consumo mobile | Comparação antes/depois nas mesmas condições, sem metas declaradas cumpridas sem medição | Build/mobile |

Quando corrigidos, atualizar os asserts D correspondentes com regressões de
segurança/correção; manter nesta etapa os 23 testes exatamente como estão.
Os casos C devem ser negociados, não alterados silenciosamente na migração.

## Matriz Android Chrome físico (prioridade de produto)

Todos os casos **PENDING físico** abaixo exigem Android real; resultado desktop,
VM ou viewport estreito não muda esse status. Usar dois aparelhos independentes,
com storages distintos, quando o cenário mencionar sincronização.

| ID | Procedimento reproduzível | Resultado a observar / futuro aceite | Estado |
|---|---|---|---|
| A-M01 | Login A/B, perder rede e reconectar antes/depois de 15s | Registro e snapshot coerentes; documentar identidade por nome insegura atual; futura retomada com prova de posse | PENDING físico; I02/I11/I12 cobrem apenas servidor |
| A-M02 | Adicionar vídeo/Shorts, mover com setas, remover, recarregar | Topo/ordem persistem, nenhuma ação exige hover/drag; invalid URL/título fallback explícitos | PENDING físico; U01/U06–08 parciais |
| A-M03 | Entrar/sair da fila com playlist vazia/cheia durante faixa | Uma entrada, fila consistente, regra atual de saída/turnos documentada; sem dupla ação por toque | PENDING físico; I02/I04/I05 parciais |
| A-M04 | No vídeo oficial reproduzível, play/pausa/skip/fim natural | Conferir player real e snapshot separadamente; vídeo/tempo coerentes, nenhuma transição duplicada | PENDING físico; vídeo desktop confirmado, I09 reproduz defeito |
| A-M05 | Dois aparelhos: um DJ, outro ouvinte; pausar/retomar/trocar faixas | Registrar tempos nos dois players, drift e demora de convergência; ouvinte sem privilégio coletivo | PENDING físico; sem medição de drift |
| A-M06 | Durante faixa, Wi-Fi→dados→Wi-Fi, perda de sinal e volta | Registrar desconexão, novo socket, snapshot, faixa/posição/privilégios; nenhuma fila duplicada | PENDING físico; rede real não exercitada |
| A-M07 | Outra aba→voltar; Sala↔Chat→Sala | Observar visibilidade, estado real do iframe e resync; não promover reprodução oculta a requisito | PENDING físico; chat atualmente oculta player por CSS |
| A-M08 | Minimizar Chrome, bloquear tela, aguardar e retomar | Aceitar suspensão imposta pelo sistema; ao retornar, recuperar estado sem saltos indevidos; não exigir áudio em background | PENDING físico |
| A-M09 | Perfil novo/sem permissões prévias; iniciar sem gesto e tocar ação legítima | Distinguir bloqueio de autoplay de erro do vídeo; gesto recupera quando permitido, sem loops nem contorno de política | PENDING físico; banner desktop transitório não homologou gesto |
| A-M10 | Verificar opção PiP nativa, se exposta pelo browser/player | Registrar disponível/indisponível e retorno; ausência não reprova MVP. Não criar overlay/stream/áudio substituto para forçar PiP | PENDING físico; app não tem fluxo PiP |

Para cada execução registrar: data, aparelho, Android, Chrome, resolução e
viewport CSS, orientação, rede, permissões/perfil, vídeo/ID, gesto, sequência,
resultado esperado/observado, tempos e evidência. Resultado não executado continua
PENDING; interrupção externa identificada é BLOCKED com motivo, nunca PASS.

## Matriz de interface touch e responsividade

Executar I-M01–06 em **320, 360, 390 e 430 px**, vertical e horizontal. Os pares
usados no smoke integrado foram 320×800, 360×800, 390×844, 430×932 e 844×390.
Não substituem rotação real de cada dispositivo nem testes com teclado virtual.

| ID | Cenário | Critério e evidência necessária | Estado |
|---|---|---|---|
| I-M01 | Header, player, controles, chat e fila nas quatro larguras | Sem cortes/overflow que impeçam ação; player respeita mínimo da API, controles/atribuições acessíveis | Smoke parcial; altura do iframe <200px em 320/360 e horizontal — FAIL conhecido |
| I-M02 | Rotacionar vertical↔horizontal com música e input ativos | Sem perda de estado/teclado/foco, elementos continuam acessíveis; conferir áreas seguras | PENDING físico; 844×390 apenas smoke de layout |
| I-M03 | Abrir teclado em login, URL e chat; enviar e fechar | Campo/botão e mensagens alcançáveis, resize/scroll sem esconder ação ou travar conteúdo | PENDING físico |
| I-M04 | Notch/recortes, barras do navegador e navegação por gestos | Áreas seguras respeitadas, header/elementos fixos sem encobrir ações; testar barras expandidas/recolhidas | PENDING físico |
| I-M05 | Scroll até fila/playlist/chat, conteúdos longos e elementos fixos | Rolagem intencional acessível, sem aprisionamento; ausência de overflow da página não prova ausência de conteúdo cortado | PENDING interação; medido scrollWidth apenas da raiz |
| I-M06 | Touch, zoom/tamanho de texto, TalkBack, foco/teclado e movimento reduzido | Nomes/estados anunciados, ordem lógica, legibilidade, toque sem hover, animações respeitam preferência | PENDING físico/acessibilidade; markup atual desabilita zoom, sem correção nesta etapa |

### Resultado medido no navegador integrado (não Android)

| Viewport CSS | Iframe medido (px) | ScrollWidth raiz | Mínimo 200×200 do player |
|---|---|---|---|
| 320×800 | 288×161,125 | 320 | FAIL altura |
| 360×800 | 328×183,625 | 360 | FAIL altura |
| 390×844 | 358×200,5 | 390 | Atende tamanho nesta captura; não aprova UX integral |
| 430×932 | 398×223 | 430 | Atende tamanho nesta captura; não aprova UX integral |
| 844×390 | 804×185,1875 | 844 | FAIL altura |

Medições DOM em [mobile-viewports.json](evidence/mobile-viewports.json).
Capturas: [320](evidence/mobile-320.jpg), [360](evidence/mobile-360.jpg),
[390](evidence/mobile-390.jpg), [430](evidence/mobile-430.jpg),
[horizontal](evidence/mobile-844.jpg). A altura mínima vem da
[IFrame API oficial](https://developers.google.com/youtube/iframe_api_reference#Requirements).
São riscos encontrados, não alterações de layout autorizadas neste fechamento.

## Compatibilidade secundária e eficiência

- **iOS Safari físico — PENDING:** repetir login/playlist/fila/player, gesto,
  teclado, safe areas, orientação, suspensão/retomada e VoiceOver. Não há
  resultado herdado do Android ou do navegador integrado.
- **Desktop/tablet — PENDING integral:** repetir fluxos em dois browsers/perfis
  isolados, mouse/teclado, layouts amplos e intermediários; smoke integrado e
  testes de socket não substituem essa compatibilidade.
- **Memória/CPU/bateria/dados — PENDING:** registrar dispositivo/rede, duração,
  faixas e número de participantes; medir carga inicial, sessão contínua e
  retorno de rede, separando JS próprio/CDNs/mídia. Comparar migração com baseline
  equivalente, sem inventar orçamento cumprido nem estimar bateria em desktop.
- Reprodução do vídeo oficial foi confirmada no integrado; detalhes de
  diagnóstico, limites e procedimento controlado constam no
  [fechamento da Fase 0](PHASE_0_REPORT.md#complementação-mobile-first--fechamento-local).
