# Protocolo legado e mapa de efeitos

Referência: `server.js` e `public/index.html`, base
`b2fc55558e500ac51bd882a331379df064c2effb`, ambos preservados no PR-00.
Todas as linhas abaixo são 1-based nesses arquivos. Este documento descreve o
protocolo **existente**, não os contratos `room:*` propostos para o futuro.

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
