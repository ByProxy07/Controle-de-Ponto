# Instalação e entrada em uso

## 1. Preparar o banco

A URL e a chave pública do Supabase foram preservadas. Não é necessário trocar a API key. As correções de segurança só passam a valer no seu banco **depois de executar a migração**.

Antes de começar, faça backup/exportação do banco e dos anexos. Guarde também a versão anterior do site. Use inicialmente um banco de homologação quando possível. Não execute testes de automação contra dados reais.

### Se continuar no Supabase atual

1. Avise os usuários e suspenda o acesso ao site antigo durante a atualização.
2. Execute `supabase/preflight.sql` no SQL Editor. Revise duplicatas, administradores existentes, triggers e funções adicionais que não faziam parte do ZIP.
3. Se houver duplicatas, pare e revise. A migração falhará atomicamente ao criar o índice, sem escolher arbitrariamente qual ponto excluir. Como você informou que os dados são de teste e podem ser descartados, pode limpar as contas de teste manualmente no painel, após conferir o projeto e os alvos.
4. Execute **somente** `supabase/migrations/20260921120000_secure_time_clock.sql`, se as duas migrações originais já estão aplicadas.
5. O script mantém registros existentes; não exclui usuários. Na primeira aplicação, a nova coluna `active` começa como `false` para todas as contas. Isso evita manter acessos antigos sem conferência. Administradores precisam ser explicitamente ativados.
6. Não reaplique as migrações antigas isoladamente após a nova: elas recriam regras antigas inseguras. Se isso acontecer, reaplique a migração de segurança antes de reabrir o site.

### Se usar um projeto Supabase novo

Execute os três arquivos de `supabase/migrations/` em ordem de nome. Um projeto Supabase diferente possui URL/chave diferentes: nesse caso será necessário alterar `.env` e gerar um novo build por sua escolha. O pacote entregue mantém o projeto original.

### Usuários antigos

Nenhum usuário foi excluído neste trabalho. Se desejar descartar contas de teste, faça isso em Authentication > Users antes de criar as contas definitivas. Confira cada alvo. Na estrutura original, a exclusão do usuário pode remover em cascata perfil, pontos e solicitações; objetos anexados no Storage exigem tratamento separado. Para funcionários reais, prefira **desativar** na aplicação, preservando histórico.

## 2. Criar/ativar o administrador

1. Com o site novo disponível, use **Criar conta** e confirme o e-mail, quando solicitado. O cadastro começa inativo e como colaborador.
2. No Supabase, abra Authentication > Users e copie o **UUID exato** da sua conta confirmada.
3. Abra `supabase/ativar-administrador.sql`, substitua o UUID de zeros pelo seu UUID e execute no SQL Editor. O arquivo não executa com o marcador de zeros.
4. Volte ao site e clique em **Verificar novamente**, ou saia e entre.
5. Use **Coordenador** para gerir a equipe e **Meu ponto** para registrar sua própria jornada.
6. Crie outro administrador pelo mesmo procedimento se precisar que alguém analise suas justificativas; a autoaprovação é bloqueada.
7. Colaboradores solicitam cadastro. Confira identidade/e-mail e ative em **Colaboradores > Editar / ativar**. O início do controle define a partir de quando dias úteis sem registro entram na conferência.

Não conceda privilégios de banco ou chave `service_role` aos usuários do aplicativo. O papel `admin` do aplicativo não é o papel `authenticated` do PostgreSQL.

## 3. Configurar autenticação e anexos

- Em Authentication > URL Configuration, configure a Site URL e a lista de redirecionamentos com o endereço HTTPS final. Inclua localhost apenas enquanto necessário ao desenvolvimento.
- Configure envio de e-mail/SMTP e teste confirmação e recuperação de senha. O código funciona com confirmação habilitada; não precisa desativá-la.
- Configure a política de senha no Supabase para pelo menos 12 caracteres. A validação da tela não substitui a política do serviço de Auth. Configure limites de requisição e proteção contra abuso de cadastro no serviço conforme o uso da empresa.
- A migração cria o bucket **privado** `clock-documents`, limite de 5 MB e tipos PDF/PNG/JPEG. Não o torne público.
- O aplicativo não permite substituir ou apagar comprovantes já enviados. Faça retenção/limpeza pelo responsável com procedimento documentado. Envios interrompidos antes da criação da solicitação podem deixar anexos sem vínculo, a revisar em manutenção.
- Confira funções/RPC e outras exposições criadas diretamente no Supabase, fora do código enviado. Esta revisão não inventariou seu ambiente online.

## 4. Publicar no Windows Server / IIS

O projeto é um site estático: não precisa executar Node.js no servidor de produção. O banco e a autenticação continuam no Supabase.

1. Habilite IIS com conteúdo estático e instale o módulo URL Rewrite.
2. Prepare um nome DNS para o site e um certificado HTTPS confiável nos computadores/celulares da empresa. Configure o binding HTTPS no IIS.
3. Crie uma pasta dedicada, por exemplo `C:\Sites\ControlePonto`.
4. Copie **apenas o conteúdo de `dist/`** para essa pasta, incluindo `web.config` e `assets/`. Nunca aponte o IIS para a raiz do projeto, `.env`, `src`, `node_modules`, testes ou scripts SQL.
5. Configure o site IIS na raiz do domínio/hostname. Esta versão usa caminhos `/assets/...`; não está preparada para uma subpasta como `/ponto/` sem alterar o `base` do Vite e recompilar.
6. Dê permissão de leitura à identidade utilizada pelo IIS. Não são necessários privilégios de escrita no diretório do site.
7. O `web.config` força HTTPS e define cabeçalhos de proteção. O certificado deve estar pronto antes do primeiro acesso. Se TLS terminar em proxy reverso, adapte a regra de redirecionamento ao proxy para evitar loop.
8. A política CSP permite os domínios padrão `*.supabase.co`. Se você usar domínio próprio do Supabase, adapte `connect-src` ao domínio exato antes de publicar.
9. Se aparecer erro IIS 500.19, verifique URL Rewrite instalado, seções bloqueadas e cabeçalhos/hiddenSegments herdados duplicados; ajuste a configuração local, mantendo a proteção pretendida.
10. Os dispositivos dos usuários precisam alcançar o Supabase por HTTPS. Hospedar na rede interna não torna o banco local nem permite operação sem internet.

Para Linux/Nginx ou outro servidor estático, publique os mesmos arquivos com HTTPS, fallback de rotas para `index.html`, bloqueio de arquivos de desenvolvimento e cabeçalhos equivalentes. O arquivo `web.config` é específico do IIS.

## 5. Homologação antes de abrir para todos

Use contas de teste de colaborador e administrador, separadas.

1. Confirme que cadastro não permite escolher administrador e que conta inativa não consegue bater ponto.
2. Ative a conta; registre as quatro marcações na ordem. Confira horário do servidor, localização e protocolo. Repita clique/recarregue para verificar que não duplica a mesma marcação.
3. Entre como administrador e registre seu próprio ponto em **Meu ponto**. Confirme presença nos relatórios.
4. Solicite correção como funcionário; envie PDF/JPEG/PNG, verifique abertura apenas pelo titular/administrador. Rejeite arquivo maior que 5 MB e tipo não permitido.
5. Analise a solicitação por outra conta administrativa. Faça um ajuste justificado e confira valores anteriores/novos no histórico. Cancele uma marcação de teste e confira que continua armazenada e sai do cálculo.
6. Confira um dia encerrado: 08:00–12:00 e 13:00–17:48 = 528 minutos (8h48). Compare tela e Excel. Confira mês anterior, virada do mês e dia incompleto.
7. Teste recuperação de senha com endereço final e envio real de e-mail.
8. Desconecte a internet: a aplicação deve informar falha, sem afirmar que um ponto foi registrado. Reconecte, atualize e confira os registros antes de repetir.
9. Desative uma conta de teste e confira bloqueio de novas operações, inclusive com sessão antiga ainda aberta.
10. Teste computadores e celulares reais, certificado, GPS e permissões do navegador. Só então libere à equipe.

## 6. Disponibilidade e manutenção

- Um build local não comprova disponibilidade do servidor. Valide DNS, certificado, firewall, IIS e Supabase no ambiente real.
- Use backup do banco **e dos objetos do Storage**, com teste de restauração em ambiente separado. Não presuma que backup do banco inclui o conteúdo dos anexos.
- Monitore o endereço do site, vencimento do certificado e saúde/limites do projeto Supabase. Defina responsável e procedimento de contingência para registrar ocorrências quando houver indisponibilidade.
- Consultas paginam em lotes de 500. Configure o limite de linhas da API para pelo menos 500. A aplicação busca o mês de marcações; histórico de auditoria e solicitações ainda pode crescer e deve ser acompanhado em equipes maiores.
- Ao atualizar, publique o novo `dist` como conjunto consistente, em janela curta de manutenção. Cabeçalho `no-cache` reduz clientes presos em arquivos antigos.
- Uma reversão precisa considerar compatibilidade entre aplicação e banco. Não restaure o site antigo mantendo a expectativa de que suas gravações diretas continuem funcionando: a nova migração bloqueia esse fluxo por segurança. Prefira corrigir/republicar a versão nova. Restauração de backup exige decisão do responsável.

## 7. O que falta para usos mais avançados

Escalas noturnas/12x36, feriados, abonos automáticos, fechamento mensal, banco de horas com regras próprias, assinatura de espelho, comprovantes regulamentares e integração com folha não estão implementados. Combine essas regras com RH e valide adequação antes de usar o sistema como controle oficial de jornada.
