# Controle de Ponto — versão 1.1

Leia primeiro **INSTALACAO.md**. A aplicação agora depende da migração de segurança incluída. Copiar apenas a pasta `dist` sem atualizar o banco não é suficiente.

## O que mudou

- Administradores continuam registrando a própria jornada em **Meu ponto**, e aparecem nos relatórios.
- Novos cadastros são sempre de colaborador, inicialmente inativos. O administrador confere e ativa cada conta.
- Ninguém escolhe ser administrador no cadastro. A concessão desse papel é feita pelo responsável no SQL Editor.
- Funcionários não podem alterar perfil/permissão, editar/apagar pontos nem aprovar as próprias solicitações, mesmo chamando a API diretamente.
- Marcações usam horário do banco, sequência validada, chave de repetição e trava por pessoa; o banco impede duplicidade do mesmo tipo no mesmo dia.
- Ajustes administrativos exigem justificativa e preservam antes/depois, responsável e data no histórico.
- Cancelamentos substituem exclusões físicas. O registro continua no banco, mas sai do cálculo.
- Outro administrador precisa analisar as solicitações do próprio administrador. Ajustes administrativos no próprio ponto são permitidos e auditados.
- Anexos PDF/JPEG/PNG, até 5 MB, ficam em bucket privado; abertura usa link temporário de 60 segundos.
- Relatórios mensais e Excel usam o mesmo cálculo, com horas históricas corrigidas, indicação de dias incompletos e sem débito em dias futuros/anteriores ao início do controle.
- Espelho mensal, impressão/PDF pelo navegador, confirmação com protocolo, pesquisa por pessoa e mapa das marcações.
- Recuperação de senha, captura de localização renovada, aviso de conexão, tempo limite nas requisições, atualização ao retornar à página e paginação das consultas.
- Dependências atualizadas e testes de cálculo, permissões e navegação incluídos.

## Arquivos

- `src/`: código React/TypeScript.
- `dist/`: versão compilada para hospedagem, com a configuração Supabase original.
- `.env`: preservado exatamente como no ZIP recebido. Não contém credencial administrativa; não publique este arquivo.
- `supabase/migrations/`: estrutura original e nova migração de segurança.
- `supabase/preflight.sql`: diagnóstico somente leitura antes de atualizar banco existente.
- `supabase/ativar-administrador.sql`: habilitação explícita da conta administrativa, após substituir o UUID.
- `tests/`: testes sem conexão com seu Supabase.
- `INSTALACAO.md`: instalação, ativação, homologação e operação.
- `VALIDACAO.md`: resultados e limites da validação.

## Desenvolvimento

Requer Node.js 22.12+ (ou 24 LTS) e npm.

```bash
npm ci
npm run dev
```

O endereço `localhost` permite testar localização no próprio computador. Para outros computadores/celulares, use HTTPS com certificado confiável. O servidor de desenvolvimento não deve ser exposto como servidor de produção.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Para testes de navegador, instale o Chromium de teste uma vez:

```bash
npx playwright install chromium
npm run test:ui
```

O teste de navegador intercepta todas as chamadas externas. O teste SQL usa PostgreSQL em WASM (PGlite) e simula apenas os schemas necessários de Auth/Storage. Não acessa nem limpa o Supabase real.

## Regras e limites desta versão

- Jornada de quatro marcações no mesmo dia civil de Brasília. Não modela plantões que atravessam a meia-noite, múltiplos intervalos, 12x36 ou revezamento.
- Meta padrão original: 528 minutos (8h48), segunda a sexta. A leitura considera `work_schedule.daily_target_minutes` e `work_schedule.work_days`, quando presentes, mas não há editor de escalas nem histórico de mudanças de jornada.
- Saldo é **previsto para conferência**, não cálculo definitivo de folha/banco de horas. Feriados, abonos, tolerâncias, adicional noturno, horas extras remuneradas e convenções coletivas não são calculados automaticamente.
- Dias com marcações incompletas são sinalizados para revisão e não geram débito definitivo. Pares completos são somados, descartando segundos incompletos no total diário.
- Aprovar uma justificativa não altera marcações e não abona automaticamente o saldo. O administrador deve realizar o ajuste de horário justificado, quando cabível.
- A meta e o início do controle vigentes são usados no relatório. Para desligados/inativos, revise o período de apuração manualmente: não existe histórico de admissões/desligamentos/reativações.
- Localização do navegador não é prova inviolável de presença e pode ser falsificada pelo dispositivo. Não há cerca geográfica nem biometria.
- Não há modo offline: só há confirmação após resposta do banco. O relógio exibido usa o dispositivo; o horário gravado é o do banco.
- O histórico protege contra mudanças pelas contas do aplicativo. Um proprietário do banco com privilégios administrativos continua capaz de modificar o banco fora do aplicativo.
- Confirmação interna com protocolo não equivale a comprovante regulamentar. Este pacote não certifica conformidade trabalhista nem substitui validação por RH/jurídico antes de uso como ponto oficial.

## Referências técnicas utilizadas

- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: funções do banco](https://supabase.com/docs/guides/database/functions)
- [Supabase: controle de acesso ao Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase: gestão de usuários](https://supabase.com/docs/guides/auth/managing-user-data)
