# Política de Git, revisão e publicação do VibeDJ

Diretriz do usuário, adotada em 14/11/2026. Aplica-se às próximas etapas e ao
fechamento do PR-00. Prioridades: mudanças pequenas, histórico limpo, revisão
simples, compatibilidade, mobile-first e nenhuma regressão não autorizada.

## Desenvolvimento e revisão

1. Cada PR tem escopo independente, claramente definido e testável, com objetivo,
   critérios de aceite, evidências, riscos e rollback proporcionais ao escopo.
2. Realizar commits locais organizados durante o desenvolvimento. Esta política
   autoriza commits locais do trabalho em escopo; não autoriza push ou abertura
   de PR. Revisar exatamente os arquivos selecionados; preservar trabalho alheio.
3. Nunca desenvolver ou editar arquivos diretamente em `main`. Usar branch de
   trabalho; o PR-00 está em `build/pr-00-baseline`.
4. Ao concluir uma etapa, executar as verificações pertinentes e revisar o diff
   antes de propor o PR. Separar funcionalidade aprovada, defeito caracterizado e
   validação pendente; testes verdes de baseline não aprovam defeitos conhecidos.
5. Push e abertura de PR exigem autorização explícita. Confirmar fork, destino e
   branch-base; autorização para commit local não se estende a ações remotas.
6. Solicitar revisão do mantenedor antes de integrar alterações. Não mesclar
   automaticamente nem presumir aprovação; o PR descreve transição, testes e
   rollback quando houver mudança de comportamento.
7. Após merge, atualizar a base local a partir do remoto/destino efetivamente
   integrado antes da próxima etapa. Conferir commit e compatibilidade; iniciar
   nova branch da referência atualizada, sem carregar alterações de outro escopo
   ou criar commits de desenvolvimento em `main`.
8. Se uma etapa posterior precisar corrigir código já integrado, criar alteração
   pontual nova e testada. Não reescrever histórico integrado nem usar force push
   para alterar commits que já foram aceitos.
9. Para dependências reais, usar branches e PRs encadeados quando necessário.
   Declarar PR pai, base e ordem de integração; manter diffs revisáveis. Depois
   do merge pai, atualizar a base e conferir o diff do filho antes de integrar.

## Homologação e produção

10. Merge e publicação são decisões separadas. Merge não autoriza deploy em
    produção. Verificar os gatilhos efetivos antes de autorizar a integração;
    não presumir que apenas deixar de executar um comando de deploy é suficiente.
11. Validar mudanças funcionais em homologação, priorizando Android Chrome
    físico e preservando compatibilidade com iOS Safari e desktop. Registrar
    ambiente, versão, dados de teste, resultado e limitações. Viewport reduzido
    e testes de socket não equivalem à homologação Android.
12. Não introduzir incompatibilidade com funcionalidades existentes sem plano
    explícito de transição, testes e rollback. Não misturar redesign, migração
    estrutural e correções independentes num único escopo por conveniência.

## Gate obrigatório antes do primeiro merge

Verificar ambos os repositórios relevantes (fork e destino efetivo do merge)
e os serviços conectados, sem expor tokens, segredos ou URLs privadas de hooks:

- Workflows GitHub Actions da branch de destino e regras que rodam em `push`,
  merge, release ou conclusão de outro workflow; incluir workflows reutilizados.
- GitHub Apps, webhooks e integrações de hospedagem, inclusive deploy que ocorre
  fora de Actions. Identificar repositório, branch acompanhada e ambiente-alvo.
- Painel do provedor usado: auto-deploy de `main`, branch previews, build/start,
  promoção para produção, permissões/aprovações e mecanismo de rollback.
- Registrar evidência datada de quem verificou, provedor/serviço, branch e
  gatilho, ambiente afetado e responsável pela publicação. Não registrar segredos.

Estado da inspeção local de 14/11/2026: o único workflow preparado nesta
árvore, `.github/workflows/baseline.yml`, contém `npm ci`/`npm test` em push/PR,
sem job de deploy. Não há configuração de deploy rastreada na base local.
O HTML/servidor mencionam Render/Railway em comentários/textos, o que não prova
uma integração ativa. Painéis, apps/hooks e configurações remotas não foram
verificados nesta etapa. **Auto-deploy de `main`: desconhecido; gate pendente.**

Se houver auto-deploy, merge poderá publicar imediatamente, reiniciar o processo,
derrubar sockets e perder a sala em memória; um provedor com previews também pode
publicar uma branch após push. Informar esses efeitos antes de qualquer ação
remota. Não fazer merge até resolver o gate com o mantenedor e separar a decisão
de publicação; qualquer mudança em configuração externa deve ser autorizada.

Não realizar merge experimental para descobrir se há deploy. Ausência de um
arquivo de configuração local ou de um job Actions não comprova ausência de
automação externa.

### Atualização específica do PR-00: riscos aceitos em desenvolvimento

Em 14/11/2026, o usuário transmitiu a confirmação do responsável pelo
desenvolvimento: hospedagem na Render, aplicação em desenvolvimento/testes,
reinicializações temporárias e perda do estado volátil das salas aceitas;
auto-deploy não precisa ser desativado. A verificação de automações externas
passa a ser **informativa, não bloqueante para push/abertura do PR-00**.
Essa atualização substitui o bloqueio de abertura anterior, sem transformar
configurações não inspecionadas em verificadas. Ver o [gate atualizado](PR_00_GATE.md).

Push, abertura de PR e merge continuam exigindo suas autorizações explícitas;
revisão do mantenedor e verificações pré-merge permanecem. O aceite não autoriza
alterar configurações externas nem dispensa requisitos de segurança, transição,
rollback ou homologação de mudanças funcionais. Não aplicar essa aceitação de
desenvolvimento como aprovação genérica de uma futura produção.
