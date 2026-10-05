# Atualização parcial: portal dos motoristas

Este ZIP contém somente os arquivos novos e alterados da versão com motoristas já entregue, mais este guia e a lista de arquivos. Não é um projeto completo para abrir isoladamente. A comparação foi feita com o último ZIP enviado por você em 23/09/2026 (`355164c2-5cb7-4d50-8907-2602c153ef66.zip`). Alterações locais posteriores não estão nessa comparação.

O sistema continua usando o mesmo Supabase e as mesmas marcações e relatórios. O administrador continua com Meu ponto. Nenhuma conta é apagada pela atualização.

Endereços após a instalação:

- Equipe: https://ponto.intranet.setre/
- Motoristas: https://ponto.intranet.setre/motoristas

## 1. Aplicar os arquivos no projeto do VS Code

1. Faça uma cópia de segurança da pasta do projeto atual e um backup do banco.
2. Extraia este ZIP em uma pasta temporária.
3. Copie os arquivos e pastas extraídos para a raiz do seu projeto antigo, onde está o `package.json`.
4. Mescle as pastas e substitua somente os arquivos de mesmo nome. Não apague as pastas `src`, `tests` ou `supabase` antes de copiar: os arquivos que não mudaram precisam continuar lá.
5. Consulte `ARQUIVOS-DA-ATUALIZACAO.txt` para ver quais são novos e quais substituem arquivos. Se você modificou algum deles depois do ZIP enviado, compare o conteúdo antes de substituir.

Seu `.env` não está neste pacote: mantenha o arquivo atual. Não é necessário alterar a URL ou a chave pública do Supabase. Os quatro arquivos de testes incluídos acompanham a integração; não são publicados no site.

Se já criou um `supabase/config.toml` com outras funções, mescle nele a seção `[functions.driver-auth]` do arquivo fornecido e mantenha as demais configurações. No ZIP usado como base esse arquivo não existia.

## 2. Atualizar o Supabase antes de publicar o site

Somente copiar os arquivos da página não configura o login por CPF. É obrigatório aplicar a migração nova e publicar a função de autenticação.

Este pacote pressupõe que a migração de segurança `20260921120000_secure_time_clock.sql` da versão anterior já está aplicada. Não execute novamente as migrações antigas para instalar este portal.

No SQL Editor do mesmo projeto Supabase, execute todo o conteúdo de:

`supabase/migrations/20260923100000_driver_portal.sql`

A migração mantém usuários, pontos e ativações existentes. Os novos motoristas começam inativos, como colaboradores. As instruções de segredo e publicação estão abaixo.

### 2.1 Criar o segredo exclusivo dos motoristas

No PowerShell de sua máquina, gere um valor aleatório com este comando:

```powershell
$driverBytes = New-Object byte[] 32
$driverRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$driverRng.GetBytes($driverBytes)
$driverRng.Dispose()
[Convert]::ToBase64String($driverBytes)
```

Guarde o resultado em um gerenciador de senhas da empresa. No painel Supabase, em **Edge Functions > Secrets**, adicione:

- Nome: `DRIVER_AUTH_SECRET`
- Valor: o resultado aleatório gerado acima.

Esse segredo é novo e exclusivo da função; **não é uma troca de API key**. Não coloque no `.env` do React, nem em variável `VITE_`, nem dentro de `dist`. Nunca envie o segredo aos motoristas.

**Se `DRIVER_AUTH_SECRET` já existir, preserve seu valor.** Ele determina a identificação interna e a senha dos motoristas. Trocar ou perder esse segredo impede o login das contas já criadas; uma rotação exige migração planejada. Não gere outro a cada publicação.

### 2.2 Publicar a função incluída no ZIP

Na máquina de desenvolvimento, use Node.js 22.12 ou superior. Abra o terminal **na pasta que contém `package.json`**. No PowerShell:

```powershell
npx supabase login
```

Conclua o login com sua conta Supabase. Depois, ainda na mesma pasta:

```powershell
$driverUrlLine = Get-Content .env | Where-Object { $_ -match '^VITE_SUPABASE_URL\s*=' } | Select-Object -First 1
if ($driverUrlLine -notmatch 'https://([a-z0-9]+)\.supabase\.co') { throw 'Confira o Reference ID do projeto no painel Supabase.' }
$driverProjectRef = $Matches[1]
npx supabase functions deploy driver-auth --project-ref $driverProjectRef --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'Publicação falhou. Não substitua o site ainda.' }
```

Confira que o Reference ID corresponde ao projeto usado pelo site. Para domínio Supabase personalizado, substitua apenas a obtenção automática da referência pelo Reference ID de **Project Settings > General**.

O comando publica `supabase/functions/driver-auth/index.ts`, `handler.mjs` e o módulo compartilhado importado. `supabase/config.toml` já configura `verify_jwt = false` somente para essa função. Cadastro e login precisam aceitar pessoas que ainda não têm sessão. **A redefinição de PIN valida a sessão e a autorização administrativa dentro da própria função.** Não aplique essa configuração indiscriminadamente a outras funções.

As variáveis internas `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente hospedado do Supabase. Não copie a chave administrativa para o frontend. Não desative a confirmação de e-mail da equipe; ela continua independente.

Documentação oficial: https://supabase.com/docs/guides/functions/deploy e https://supabase.com/docs/guides/functions/secrets.



## 3. Compilar no computador de desenvolvimento

No terminal do VS Code, na raiz do projeto antigo já atualizado (não na pasta isolada deste ZIP), com Node.js 22.12 ou superior:

```powershell
npm ci
npm run build
```

Se algum comando falhar, resolva antes de publicar. A compilação gera `dist` usando seu `.env` atual. O ZIP parcial não inclui um `dist` pronto: ele deve ser gerado com o projeto completo.

## 4. Publicar no servidor Ubuntu atual

O Nginx já serve `/var/www/controle-ponto`, com fallback para `index.html`, e já está configurado para HTTPS. Não substitua `/etc/nginx`, não recrie os certificados e não altere o Docker.

No PowerShell do Windows, na pasta do projeto depois do build, envie a pasta compilada:

```powershell
scp -r .\dist moises.almeida@10.18.0.122:/home/moises.almeida/
```

Isso envia os arquivos para `/home/moises.almeida/dist`. Só faça a publicação após a cópia terminar com sucesso e depois de concluir a configuração do Supabase.

No terminal SSH do Ubuntu, cole este bloco. Ele faz backup do site, copia os assets e troca o `index.html` por último. Os assets antigos permanecem para reduzir falhas em abas já abertas.

```bash
sudo bash <<'PUBLICAR'
set -eu
SRC=/home/moises.almeida/dist
DST=/var/www/controle-ponto
test -f "$SRC/index.html"
test -d "$SRC/assets"
test -f "$DST/index.html"
BACKUP="/var/www/controle-ponto.backup-$(date +%Y%m%d-%H%M%S)"
test ! -e "$BACKUP"
cp -a "$DST" "$BACKUP"
mkdir -p "$DST/assets"
cp -r "$SRC/assets/." "$DST/assets/"
install -m 644 "$SRC/index.html" "$DST/index.html.novo"
mv "$DST/index.html.novo" "$DST/index.html"
echo "Site publicado. Backup em: $BACKUP"
PUBLICAR
```

O build desta versão usa `index.html` e `assets/`. O `web.config` gerado para IIS não é usado pelo seu Nginx. Não envie fonte, `.env`, SQL ou chaves para a pasta pública. Não é necessário reiniciar o Nginx para atualizar esses arquivos estáticos.

Se precisar reverter somente o site, use o caminho exato do backup exibido para restaurar seus arquivos, mantendo os certificados e as configurações do Nginx. A migração de motoristas é adicional; não apague tabelas ou contas para reverter a interface.

## 5. Testar antes de liberar

1. Atualize o navegador com Ctrl+F5 e confira o login da equipe e Meu ponto do administrador.
2. Abra `https://ponto.intranet.setre/motoristas` e solicite um cadastro de teste autorizado, usando CPF e PIN de seis números. Não precisa de e-mail.
3. Confira que o motorista ainda não consegue registrar ponto antes da ativação.
4. Como administrador, abra Colaboradores, filtre Grupo > Motoristas, confira a identidade e use Editar / ativar. Confira a data de início do controle.
5. Entre como motorista, permita a localização e registre um ponto. Confira a confirmação verde, o protocolo e a presença nos relatórios do administrador.
6. Teste Redefinir PIN pelo painel e depois o login com o novo PIN.
7. Teste em um celular com acesso ao DNS/rede interna e confiança no certificado. O HTTPS continua exigido, tanto para motoristas quanto para a equipe.

O portal mostra a próxima marcação em um botão grande e encerra a sessão local após 30 segundos na confirmação. Não há marcação offline. A jornada mantém quatro registros no mesmo dia: entrada, saída para intervalo, retorno e saída. Turnos que atravessam a meia-noite e regras específicas de direção/descanso não foram implementados.

Se já foram usadas contas do rascunho antigo com endereço `CPF@terceiros.local` ou registros na tabela `registros_ponto`, esse histórico não é convertido automaticamente. Preserve os dados para uma migração específica, se houver uso real.

## Verificação deste pacote

Os 22 arquivos da atualização são idênticos aos do ZIP completo entregue. A aplicação da atualização sobre a base foi conferida para reproduzir os arquivos de código, dependências e funções dessa entrega, preservando o `.env`. A versão completa já passou por 65 testes automatizados e pelos testes de navegador descritos anteriormente; não houve nova mudança funcional neste pacote parcial. Não publicamos nada no seu servidor ou Supabase.
