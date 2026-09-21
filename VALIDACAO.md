# Validação da versão 1.1

Data: 21/09/2026. Revisão baseada no ZIP fornecido, sem acesso ao Supabase ou servidor da empresa.

| Verificação | Resultado |
| --- | --- |
| TypeScript (`npm run typecheck`) | Aprovado |
| ESLint (`npm run lint`) | Sem erros ou avisos |
| Testes automatizados (`npm test`) | 56 testes aprovados, zero falhas |
| Build de produção (`npm run build`) | Gerado com sucesso |
| Auditoria de dependências (`npm audit`) | Zero vulnerabilidades conhecidas reportadas na data da revisão |
| Testes de navegador com API simulada | Oito verificações aprovadas |
| Preservação da configuração | `.env` mantido byte a byte em relação ao ZIP original |

## O que foi testado no banco local

PostgreSQL em WASM (PGlite), com schemas mínimos simulados de Auth e Storage. As três migrações foram executadas; a nova migração também foi reaplicada para verificar repetibilidade.

- Metadados de cadastro não podem conceder papel administrativo ou ativação.
- Funcionário não consegue se promover, ativar terceiros ou consultar perfis/pontos de terceiros.
- Conta inativa, inclusive sessão já existente após desativação, não consegue bater ponto.
- Batida usa horário do banco. Repetir o mesmo identificador retorna o mesmo registro.
- Tipo duplicado e sequência inválida são rejeitados.
- Inserção de horário direto, edição e exclusão por funcionário são negadas.
- Administrador também consegue registrar a própria batida.
- Administrador precisa usar ajuste com justificativa; escrita direta que pularia o histórico é negada.
- Inclusão de ponto histórico, ordem dos horários, alteração com antes/depois, cancelamento sem exclusão e substituição de marcação cancelada.
- Funcionário não aprova solicitação; administrador não aprova a própria; parecer já concluído não é sobrescrito.
- Auditoria não pode ser editada/apagada pelas contas do aplicativo.
- Isolamento de pastas de comprovantes, inclusive na presença de uma política de Storage genérica permissiva.
- Não é possível vincular comprovante de outro colaborador.
- Administrador não pode desativar a própria conta.
- Acesso anônimo às tabelas é bloqueado.

## Cálculos verificados

- Dia histórico 08:00–12:00 / 13:00–17:48 = 528 minutos; saldo padrão zero.
- Intervalo aberto histórico não continua somando até hoje.
- Intervalo aberto de hoje pode ser exibido como estimativa sem exigir segunda marcação.
- Dias futuros, anteriores ao início do controle e marcações canceladas não criam débito indevido nos cenários testados.
- Agrupamento de horário UTC no dia correto de Brasília e exibição de datas sem deslocamento.
- Virada de dezembro para janeiro, dia parcial, jornada em fim de semana e intervalo negativo.

## Navegador

Chromium headless, build de produção e requisições externas interceptadas antes de qualquer acesso ao Supabase. Houve download e reabertura do Excel por ExcelJS.

1. Cadastro sem seleção de administrador.
2. Administrador batendo ponto via RPC sem enviar horário próprio.
3. Excel gerado, baixado e aberto com quatro abas.
4. Ajuste encaminhando justificativa obrigatória.
5. Gestão de colaboradores acessível ao administrador.
6. Tela de solicitações em largura móvel (390 px) sem transbordamento horizontal.
7. Falha simulada de consulta exibida ao usuário.
8. Ausência de erros JavaScript não tratados nos fluxos exercitados.

## Limites da verificação

- Os testes não comprovam as configurações atuais do Supabase real, e-mail, Auth, Storage HTTP, DNS, TLS, firewall ou IIS. O roteiro de homologação está em INSTALACAO.md.
- O teste de banco executa as funções e RLS em PostgreSQL; não substitui teste ponta a ponta com Supabase Auth/PostgREST/Storage reais.
- Os testes de navegador simulam respostas da API; não enviam dados à empresa.
- Não foi realizado teste de carga, pentest independente, auditoria regulatória, certificação de ponto ou garantia de SLA.
- Dados, regras, triggers e funções adicionados diretamente ao banco fora do ZIP não foram inspecionados.
- O build avisa que o módulo Excel é maior que 500 kB. Ele é carregado sob demanda ao exportar, não no carregamento inicial. Isso não é falha de compilação.
- Uma auditoria npm sem alertas conhecidos não garante ausência de vulnerabilidades futuras ou falhas de configuração.
- Regras de folha, feriados, abonos automáticos, turnos noturnos e outras limitações funcionais estão explicitadas no README.
