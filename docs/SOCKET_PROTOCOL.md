# Protocolo Socket.IO e mapa de efeitos

## Contrato vigente após PR-01

PR-01 depende de PR-00 (#1). Os nomes dos comandos legados são preservados;
`id` agora significa ID opaco permanente durante a sessão, também publicado como
`participantId`. Nunca significa socket ou apelido. Regras completas e cenários
de recuperação em [SESSIONS.md](SESSIONS.md).

| Comando | Contrato atual |
|---|---|
| `set_user` | Nova identidade: `{name,avatar?,resumeRequestId?}`. Nome trim/até 30; cliente legado sem token recebe nova sessão. Repetição no mesmo socket autenticado é idempotente. Retomada: `{resumeToken,resumeRequestId}`; credencial válida é obrigatória, nome recebido não troca identidade. Apenas um dono por sessão; substituído recebe `session_invalid(replaced)` e disconnect. |
| `confirm_session` (novo) | `{resumeToken,resumeRequestId}`; somente o dono atual pode confirmar a persistência do token sucessor e eliminar a prova anterior de retry. Sem ACK, idempotente. |
| `logout` (novo) | `{requestId?,participantId?,registrationRequestId?}`; revoga somente a sessão autorizada do socket e correspondente ao alvo quando correlacionado. Remove fila, avança uma vez se DJ. Mensagem antiga de outra identidade é rejeitada. Duplicação após revogação não avança novamente. |
| `toggle_queue` | Playlist, somente sessão dona autorizada; entrada/saída por participantId, sem comparação de nome. Rotação e saída de fila legadas mantidas. |
| `update_playlist` | Playlist, somente sua entrada na fila por participantId. Não altera playlist de homônimo. |
| `dj_play`, `dj_pause`, `dj_seek`, `skip_track` | Somente sessão autorizada cujo participantId é DJ atual; sem fallback por nome/socket. Regras de play/tempo/seek legadas preservadas. |
| `track_ended` | Somente DJ autorizado. Fallback anônimo eliminado; transição por timeout de desconexão permanece. Duplicação do DJ ainda pertence à fase de idempotência de reprodução. |
| `vote` | Exige sessão autorizada, mapa por participantId. Tipos/limites de payload continuam assunto do PR-02; reset legado por faixa preservado. |
| `send_message` | Exige sessão autorizada; nome/avatar vêm dessa sessão, campos de remetente do payload ignorados. String/objeto, trim/500 e histórico 100 preservados. Validação de text não-string ainda pendente PR-02. |
| `request_sync` | Leitura pública, payload/tempo legados; se socket autorizado, conta como atividade. Não concede identidade/privilégio. |

São 13 comandos de aplicação (11 legados + confirm/logout). Nenhuma sala nova.
Eventos públicos `init_state`, `update_room`, `update_votes`, `new_message`,
`player_action` e resposta pública `sync_time` conservam a forma legada, com IDs
estáveis. Snapshot ainda contém playlists/votantes, mas **nenhuma credencial**.

| Evento privado | Payload / efeito |
|---|---|
| `user_registered` | `{id,participantId,name,avatar,resumeToken,expiresAt,resumeRequestId}` só ao solicitante. ACK opcional de `set_user`: `{ok:true,user:mesmo_payload}`. Cliente separa credencial de user React e confirma sucessor após salvar. ACK/evento duplicados não criam outra identidade. |
| `session_error` (novo) | `{code,resumeRequestId}`; erros `invalid_user`, `invalid_session`, `invalid_request`, `session_conflict`, `session_busy`. ACK opcional: `{ok:false,code}`. Não transforma token inválido em nova identidade automaticamente. |
| `session_invalid` (novo) | `{reason}`: `replaced`, `expired` ou revogação. Cliente limpa credencial/identidade local e exibe aviso. Logout usa apenas resposta correlacionada, sem invalid genérico que atinja login posterior. |
| `logged_out` (novo) | `{ok:true,requestId,participantId,registrationRequestId}`, também ACK de logout. Cliente ignora eventos/ACKs de tentativas antigas. Logout com alvo conflitante retorna ACK `{ok:false,code:'session_conflict'}`. |
| `playlist_consumed` | Só ao socket dono atual da identidade, em rotação e retomada com fila ainda válida; nunca a todos com o mesmo apelido. |

São 11 eventos de aplicação de saída (8 legados + 3 de sessão). Nenhum token é
incluído em roomState, snapshot, broadcast ou log. `user_registered`/ACK e
`confirm_session` transportam tokens somente na conexão privada autenticada.

Disconnect: timer por participantId, 15s; retomada cancela timer com geração
conferida, sem varrer sockets por nome. Após expirar, libera fila/posição; token
ainda válido pode recuperar identidade, mas não a posição liberada. Uma limpeza
de sessão a cada minuto remove expirados; sem banco, sem polling novo no cliente.

## Baseline histórica PR-00 (não é o contrato vigente)

Referência: `server.js` e `public/index.html`, base
`b2fc55558e500ac51bd882a331379df064c2effb`, ambos preservados no PR-00.
Todas as linhas abaixo são 1-based na base PR-00. O mapa abaixo registra o legado
para comparação; diferenças de identidade/logout são substituídas pelo contrato
PR-01 acima. Contratos `room:*` do plano continuam propostas futuras.

## Transporte e estado

Um objeto `roomState` por processo (`server.js:117`); nenhum `socket.join` de sala
de negócio. Broadcasts usam `io.emit`, incluindo sockets não registrados.
Socket.IO mantém sua sala técnica por ID; isso não fornece salas de produto.
Servidor: WebSocket/polling, CORS `*`, ping timeout 60s, intervalo 25s, EIO3
permitido (`server.js:24`). Cliente: WS/polling, reconnect infinito, delay 1s,
timeout 20s (`index.html:59`). Não há ACK de aplicação, erros tipados ou revisão.

Snapshot público (`server.js:150`):

```text
{
  currentDj: null | { id, name, avatar, playlist },
  currentTrack: null | item da playlist sem validação de esquema,
  startTime: null | timestamp ms, isPlaying: boolean, pausedAt: null | ms,
  djQueue: [{ id, name, avatar, playlist }],
  messages: [{ id: string, user, avatar, text, time }],
  votes: { woot, meh, voters: { [nome ou socket.id]: tipo recebido } },
  currentTime: segundos calculados
}
```

O spread é integral: playlists e mapa de votantes são públicos. `currentDj`
referencia o objeto da fila; a faixa atual persiste mesmo se esse DJ sair da fila.

## Cliente → servidor: todos os 11 comandos

| Evento / referência servidor | Payload e condição atual | Mutação / saída / efeito cliente |
|---|---|---|
| `set_user` :168 | `{name, avatar?}`; nome truthy, convertido para string, trim, até 30 caracteres; avatar padrão 🎧 | Grava `socket.data.user={id:socket.id,name,avatar}`; cancela timer **por nome**; troca IDs de DJ/fila com nome igual; `user_registered` ao emissor e `update_room` global. Cliente grava nome/user. |
| `toggle_queue` :203 | Playlist; exige usuário; entrada por nome **ou** ID | Se já presente, remove; senão adiciona com array recebido (não-array vira `[]`). `checkNextDj` inicia quando sem faixa; `update_room` global. Pode emitir dois snapshots ao iniciar. UI atualiza fila/DJ. |
| `update_playlist` :230 | Playlist; encontra DJ por nome ou ID | Substitui array (não-array vira `[]`), inicia se ocioso, `update_room` global. Faixa em execução continua. UI envia ao adicionar/mover/remover. |
| `dj_play` :245 | Sem payload; `isCurrentDj`, faixa presente, pausada | Ajusta `startTime` pelo intervalo pausado, `isPlaying=true`, limpa `pausedAt`; `player_action(play)` seguido de `update_room`. UI/Media Session DJ. |
| `dj_pause` :268 | Sem payload; DJ e faixa tocando | `isPlaying=false`, `pausedAt=Date.now()`; `player_action(pause)` + `update_room`. UI/Media Session DJ. |
| `dj_seek` :285 | Valor aceito por `parseFloat`, não-NaN e >=0; DJ e faixa | Recalcula `startTime`, ajusta `pausedAt` se pausado; `player_action(seek)` + `update_room`. **Não há emit desse evento no HTML atual**; seek direto do iframe não é encaminhado ao servidor. Testado diretamente por socket. |
| `skip_track` :304 | Sem payload; DJ por nome ou ID | `nextTrack`, rotação da fila e playlist, reset de votos/relógio; `playlist_consumed` para DJ e snapshot global. UI/Media Session DJ. |
| `request_sync` :318 | Sem payload, nem registro obrigatório | Sem mutação; `sync_time` só ao emissor. Chamado no connect, player pronto, desbloqueio de áudio, foco, retorno visível e a cada 5s visível. |
| `track_ended` :329 | Sem payload/token; DJ **ou** nenhum socket com nome do DJ conectado e elapsed >10s | `nextTrack`. Todos os players podem emitir em ENDED. Sem idempotência/identificador de instância; DJ pode enviar duas vezes e avançar duas faixas. Fallback aceita anônimo. |
| `vote` :344 | Tipo arbitrário; requer faixa, registro não obrigatório | Substitui valor por nome ou socket.id; conta somente `woot`/`meh`, conserva outros valores; `update_votes` global com mapa completo. UI dois botões. |
| `send_message` :364 | String ou `{text,userName?,userAvatar?}`; chama `.trim()` | Remetente da sessão se registrado, senão aceita campos do cliente; trim/até 500 chars; mantém últimas 100; `new_message` global. Número truthy em `text` causa TypeError e encerra servidor. UI limita input a 300, limpa ao enviar. |

`isCurrentDj` (`server.js:132`) aceita **nome igual ou ID do socket**. Comandos
negados retornam silenciosamente; alguns escrevem aviso no console. Isso não é
autenticação segura. Nenhum comando permite escolher sala: todos usam singleton.

## Servidor → cliente: todos os 8 eventos de aplicação

| Evento / referência servidor | Destinatário / payload | Efeito no HTML |
|---|---|---|
| `init_state` :165 | Socket recém-conectado, snapshot integral | `onInitState` :590 substitui estado, tenta sync se player já registrou callback e há faixa. |
| `user_registered` :197 | Solicitante, `{id,name,avatar}` | :612 define user e persiste `vibedj_user_name`. |
| `update_room` :198 e outros | Todos, snapshot integral | :597 substitui estado completo; não invoca diretamente o sync callback. |
| `player_action` :263/280/299 | Todos, `{action:'play'|'pause'|'seek',currentTime,isPlaying}` | :626 atualiza tempo/estado e chama callback de sync. Sem ID de faixa/revisão. |
| `sync_time` :320 | Solicitante, `{currentTime,isPlaying,currentTrackId,serverTime}` | :618 chama sync; **ignora** `currentTrackId` e `serverTime`. |
| `update_votes` :360 | Todos, `{woot,meh,voters}` | :601 substitui votos. |
| `new_message` :381 | Todos, mensagem | :605 acrescenta mensagem e incrementa não lidas se aba móvel não é chat. Lista local pode crescer além de 100 até outro snapshot. |
| `playlist_consumed` :446 | Sockets com mesmo nome do DJ **ou** ID correspondente; array rotacionado | :635 substitui playlist se array e persiste `vibedj_playlist`. Pode afetar vários sockets com mesmo nome. |

## Ciclo de vida e timers (não são comandos de aplicação)

- `connection` no servidor (:157): log, `init_state`; `socket.conn` `upgrade`
  (:160) só registra mudança de transporte.
- `connect` no cliente (:568): marca online, reenvia `set_user` com nome salvo e
  `request_sync`. Também chamado se socket conectou antes do efeito montar.
- `connect_error` (:585): log/indicador offline.
- `disconnect` no cliente (:580): indicador offline; reconexão automática.
- `disconnect` no servidor (:385): cria timeout de **15.000 ms por nome**.
  Se nenhum socket com esse nome voltou, remove DJ por nome/ID. Se era DJ atual,
  chama `nextTrack`, senão snapshot. Sem alteração imediata ao desconectar.
- Retomar com `set_user` mesmo nome cancela timeout e troca ID; sem prova de posse.
- Listeners Socket.IO do efeito (:643–671) têm `off` no cleanup, mas socket global
  não é desconectado no logout. Foco/visibility e intervalo 5s têm cleanup
  (:674–717). Timer autoplay 1,2s tem cleanup; tentativa YT a cada 150ms depende
  de flag `isMounted`; player destruído ao desmontar. Media Session registra
  handlers, sem cleanup explícito de todos os handlers ao desmontar.

## Regras de rotação a preservar antes de renegociar

`nextTrack` (:416) desloca o primeiro DJ para o fim **antes** de tocar; ignora
playlists vazias com no máximo o tamanho da fila em tentativas. Desloca a primeira
faixa para o fim da playlist; emite `playlist_consumed`. Sem candidato válido,
limpa DJ/faixa/relógio/votos. A fila pode continuar contendo DJs sem músicas.
Se B entra depois de A começar e a fila era só A, B entra atrás de A: o próximo
skip ainda toca A, e só o seguinte toca B. Sair da fila não encerra faixa atual.
Votos são resetados em cada seleção de faixa, inclusive repetição do mesmo vídeo.
