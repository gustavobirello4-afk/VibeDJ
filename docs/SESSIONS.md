# PR-01: identidade anônima e sessões

## Escopo e dependência

Branch `fix/pr-01-session-security`, baseada em `55bae07` de PR-00
([#1](https://github.com/gustavobirello4-afk/VibeDJ/pull/1)), ainda aberto na
preparação. Não houve modificação de `main` nem merge. Alterações próprias devem
ser revisadas contra `55bae07`; os commits de baseline são dependência, não
implementação PR-01. Se o pai for integrado, atualizar base conforme o método de
merge (inclusive squash), conferir diff do filho e preservar histórico integrado.

## Identidade e autorização

- `crypto.randomUUID()` gera participantId; `randomBytes(32)` gera token opaco
  de 256 bits. Sem contas tradicionais, JWT ou dependência nova.
- Map privado armazena sessões; índices por SHA-256 de token permitem lookup
  direto. Token corrente fica em memória privada para reentregar a resposta
  idempotente; nunca entra em roomState, públicos ou logs.
- Cada sessão tem um único socket dono. `socket.id` é apenas transporte.
  `authorize` confere ID, socket dono e validade em cada mutação; apelido é
  somente visual. Nome duplicado não toma DJ, votos ou playlist.
- Uma retomada legítima substitui dono e desconecta o socket anterior, que não
  pode continuar mutando. Tentativas concorrentes com token consumido não tomam
  o dono novo. Prova anterior com mesmo requestId recebe `session_busy` enquanto
  houver outro socket dono; não há disputa automática em loop.
- Chat e voto exigem sessão; remetente deriva da sessão e votos usam participantId.
  Clientes antigos que emitem `set_user` sem token podem entrar como identidade
  nova, mas reconectar por nome não restaura privilégios. Recarregar o frontend
  atualizado é necessário para retomada segura e UI sem comparações por apelido.

## Rotação e respostas perdidas

O cliente grava `resumeRequestId` antes de tentar retomar, mantém a mesma
tentativa durante retries e salva o token sucessor antes de `confirm_session`.
O servidor conserva **uma** prova anterior não confirmada por sessão, associada
ao requestId, até confirmação, rotação seguinte ou expiração da sessão.

Repetição no mesmo dono reentrega o sucessor sem rotacionar novamente. Depois de
desconexão, a mesma prova/tentativa pode recuperar resposta perdida, desde que
não exista outro dono ativo. Outro requestId/token anterior não é autorizado.
Confirmar exige token sucessor, requestId e socket dono; só então a prova anterior
é descartada. Não há janela arbitrária de 60s que perca uma sessão de 24h porque
o Android suspendeu a aba. Perda do confirm é segura: há no máximo um registro de
retry por sessão, limpo no ciclo seguinte ou na expiração.

O browser faz no máximo duas repetições após timeout de ACK de 5s; não adiciona
polling. Resposta/evento obsoleto é ignorado pela tentativa atual. `session_busy`
mantém prova para retry explícito; inválida/expirada retorna ao login com aviso,
sem criar identidade privilegiada por nome.

## Validade e desconexão

Validade em memória: 24h a partir da última renovação. Atividade autenticada
renova no máximo uma vez por minuto, inclusive o resync já existente quando
visível. Nenhum pacote novo periódico foi adicionado. Limpeza global de sessões
a cada 60s, com timeout de desconexão somente onde necessário. Sessões expiradas
são rejeitadas imediatamente no acesso, mesmo antes da limpeza periódica.

O grace period de fila/DJ é **15s**, separado da validade de sessão. Retomada antes
do prazo conserva direito atual e sincroniza playlist do dono, sem avanço. Após
o prazo, sua entrada é liberada e o rodízio continua; retomar token válido não
reinsere a pessoa na fila. Novo toque em Entrar na Fila é uma decisão explícita.
Timer de socket antigo não remove a sessão retomada: só o dono pode agendar
disconnect e o callback confere sua geração antes de alterar fila.

## Logout, rede ausente e corridas

Logout revoga token/sessão, retira sua fila e, se era DJ, avança exatamente uma
vez. Logout repetido ou pacote direcionado a identidade antiga não afeta o novo
login. Confirmar saída exige requestId, participante e tentativa de registro
correspondentes; ACK/evento atrasado não limpa tombstone de uma sessão posterior.

O cliente sai da UI imediatamente, mas mantém uma marca privada de revogação
pendente no sessionStorage até confirmação. Com rede ausente, não é possível
revogar imediatamente no servidor: ao reconectar com credencial válida, ele
retoma somente para revogar, **sem exibir novamente o DJ**. Novo login aguarda
essa saída. Logout durante registro conectado é enviado imediatamente, mesmo
antes de conhecer participantId, correlacionado à tentativa de registro.

O apelido salvo, playlist e volume não são apagados. Playlists novas usam
`vibedj_playlist:<participantId>` em localStorage; `vibedj_playlist` legada é uma
semente preservada e pode ser copiada inicialmente para identidades novas, sem
compartilhar chave ou autoridade. A credencial está apenas em
`sessionStorage.vibedj_session` (inclui token, ID, tentativa e tombstone).
Storage indisponível degrada para memória da aba; reload pode exigir login.
Fechar a aba normalmente elimina sessionStorage, sem promessa de recuperar conta
ou playlist por nome. Duplicar uma aba pelo navegador pode copiar seu storage:
isso copia uma credencial bearer e representa a mesma sessão; o servidor ainda
permite apenas um dono. Nunca tratar sessionStorage como proteção contra XSS ou
acesso ao dispositivo.

## Reinício Render e limitações preservadas

Render reinicia: sessões, tokens, sala/fila/chat somem. Token antigo é inválido;
frontend informa falha e oferece login de identidade nova. Playlist local já
carregada e preferências são preservadas; posição na fila não é restaurada por
nome. Estado volátil/restart em desenvolvimento são riscos aceitos, não backup.
Configurações de Render não foram alteradas e nenhum deploy manual foi feito.

Escopo futuro: validação/limites/CORS, prevenção de abuso e crash por chat numérico
autenticado (PR-02); payload público mínimo; idempotência ENDED/sync por instância;
múltiplas salas; políticas de YouTube/background e layout mínimo do iframe.
Um DJ legítimo ainda pode enviar dois ENDED e avançar duas faixas. Esses casos
continuam `KNOWN BASELINE`, não são segurança aprovada. Expiração por inatividade
não é limite de quantidade de sessões; anti-abuso/cotas permanecem no PR-02.

## Verificação e revisão

Testes nativos Node sem novas dependências. Baseline atualizada onde corrigida
(tomada de DJ, logout local, fallback anônimo, votos por nome, chat sem sessão).
Suíte final: **45/45 PASS**, 0 FAIL/skipped/todo/cancelled, aproximadamente
43,23s (inclui duas esperas reais de 15s). [Log integral](evidence/pr-01-tests.txt).
Os 23 casos da baseline foram preservados/adaptados, com 22 novos casos.
Novos testes de store, integração e controlador real de browser verificam
rotação, confirmação/retry, concorrência, socket substituído, revogação, TTL,
grace real de 15s, ownership e ausência de tokens públicos/logs.

Revisão independente `security_reviewer` somente leitura, pin configurado e
metadata de papel `gpt-6.1-sol/high`, sem overrides. Três achados de recuperação/
logout geraram as correções e regressões correspondentes. Um erro do helper de
sync, que emitia duas solicitações e podia ler resposta antiga, foi corrigido;
não se alterou regra de produção para satisfazer o teste.
Na conferência das correções, o revisor não encontrou bloqueadores concretos
restantes e repetiu 19 testes focados com sucesso. Depois, as duas integrações
de correlação e o teste prolongado de grace foram incluídos na suíte final acima.

Smoke no navegador integrado: duas abas com mesmo nome, segunda aba inicialmente
no login (sem autenticação por nickname), somente dono exibe controles, playlist
da segunda independente, reload mantém dono/fila, pause e logout atualizam a
outra aba. Capturas em `docs/evidence/pr-01-*.jpg`; viewport 390 é apenas render,
não Android físico. Sem aparelho ADB, iOS, teste de rede celular, áudio audível
ou piloto autenticado na Render. Sem homologação física declarada.

O glow neon preexistente foi mantido por exigência de equivalência visual. A
exceção do detector é apenas `dark-glow`, no arquivo `public/index.html`, em
`.impeccable/config.json`; nenhuma regra global/skill foi alterada.

Rollback após integração: nova reversão pontual dos commits PR-01, sem reescrever
histórico integrado; reiniciar perde sessões/estado. Clientes devem recarregar a
versão correspondente. A volta do backend antigo restaura os riscos de apelido;
não tratar rollback como mitigação de segurança.
