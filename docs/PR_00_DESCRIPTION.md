# PR-00: estabelecer baseline mobile-first e testes de caracterização

> Rascunho local de título e corpo. Não foi criado PR.
> Head proposto: `weszzy:build/pr-00-baseline`.
> Destino proposto: `gustavobirello4-afk/VibeDJ:main`.
> Gate de prontidão: READY; execução de push/abertura aguarda autorização explícita.

## Objetivo

O protótipo não tinha testes, documentação de setup ou contratos registrados.
Esta entrega cria uma linha de base reproduzível para a modernização incremental,
com Android Chrome como plataforma prioritária e compatibilidade iOS Safari e
desktop, preservando o comportamento existente da aplicação.

## Alterações

- README e plano com diretriz mobile-first, política colaborativa, limites e
  sequência da migração; relatório de evidências e matriz de regressão ampliada.
- Inventário dos 11 comandos Socket.IO e 8 eventos de saída, efeitos, identidade,
  persistência, timers e dependências.
- 23 testes: 8 unitários/harness e 15 integrações em servidores descartáveis,
  com clientes Socket.IO reais, WebSocket e polling.
- `npm test` com runner nativo Node; somente `socket.io-client@4.8.4` em dev.
- Gitignore e CI mínima Ubuntu/Node 24.18.0 com `npm ci`/`npm test`, permissão
  somente leitura de conteúdo, sem etapa de deploy.
- Evidências de reprodução incorporada e de viewports 320/360/390/430px e horizontal.

`server.js` e `public/index.html` são idênticos à base. Entrada da aplicação,
script `start`, dependências de produção e versões já travadas no lockfile foram
preservados. Não há nova stack, redesign, salas adicionais ou correção funcional.
Os únicos efeitos operacionais novos são os artefatos de validação e a CI.

## Validação

- `npm ci`: PASS no ambiente local registrado.
- `npm test`: **23/23 PASS**, sem skipped/todo/cancelled, Windows/Node 24.18.0/
  npm 11.16.0. Repetição no fechamento READY: ~23,88s, log em
  `docs/evidence/pr-00-ready-tests.txt`.
- Diff e invariantes de arquivos da aplicação/scripts/runtime/lockfile conferidos.
- Vídeo oficial `M7lc1UVf-VE` reproduziu no integrado, com avanço, pausa, retomada
  e troca de faixa; estado real do vídeo capturado. Outra faixa continuou
  indisponível, sem código de erro suficiente para atribuir causa exata.
- CI GitHub/Ubuntu ainda não executada; seu resultado precisa ser verificado
  após publicação autorizada, antes de integrar.

## Limitações e riscos conhecidos

Testes de caracterização de defeitos estão separados das funcionalidades
verificadas e das expectativas de correção futura. **Verde no baseline não
significa segurança corrigida:** nomes iguais podem tomar DJ, chat numérico
pode encerrar o processo, ENDED duplicado pode avançar duas faixas; logout,
sync obsoleto, payloads e exposição do snapshot também têm limitações registradas.
Continuam bloqueadores de produção para as fases responsáveis.

Android Chrome físico, iOS Safari, áudio audível, sincronização entre aparelhos,
troca Wi-Fi/dados, autoplay/gesto físico, bateria/CPU e PiP não foram homologados.
O iframe ficou com altura inferior a 200px em 320/360px e no cenário horizontal;
não houve correção de layout neste PR. Extração/background preexistentes não
foram ampliados nem aprovados. Ver `docs/REGRESSION_MATRIX.md`.

As consultas acessíveis não identificaram workflows/deployments na base remota;
apps, hooks do upstream e detalhes dos gatilhos não foram verificados integralmente.
O responsável confirmou a hospedagem na **Render**, em desenvolvimento/testes,
e aceitou reinicializações temporárias e perda do estado volátil das salas.
Não é necessário desativar auto-deploy. Verificações de automações externas são
informativas e não bloqueiam a abertura deste PR. Ausência de workflow continua
sem comprovar ausência de deploy automático.

- Push pode disparar CI e automações de branch/preview no fork.
- Abrir PR, inclusive draft, pode disparar CI ou preview externo.
- Merge pode disparar produção e restart, desconectar sockets e perder a sala
  em memória. Merge não constitui autorização de deploy.

Ver `docs/PR_00_GATE.md` para resultados, aceite e pendências informativas.
Push/abertura dependem de autorização explícita, ainda não concedida. Solicitar
revisão do mantenedor antes de integrar e manter verificações pré-merge da
política; não há exigência de desativar auto-deploy. O aceite operacional não
homologa segurança, funcionalidades ou Android nem autoriza merge.

## Rollback e continuidade

Reverter os commits deste PR remove documentação/testes/CI e a dependência dev;
não há migração de dados ou protocolo para desfazer. Se ocorrer deploy externo,
o rollback operacional depende do provedor e não recupera estado volátil perdido.

Após merge aprovado, atualizar a base local antes da próxima etapa. Próximo
escopo proposto: PR-01 de identidade/autorização/retomada/logout, com decisões do
mantenedor e testes específicos, sem antecipar redesign ou migração da stack.
