# Atualização da folha de ponto em Excel

Esta atualização usa a planilha enviada como modelo da exportação. Foi preparada sobre a última versão do projeto com a página de motoristas.

## 1. Faça uma cópia da pasta do projeto

No computador, copie a pasta do projeto para outro local antes de substituir os arquivos. Guarde essa cópia para poder voltar à versão anterior.

## 2. Copie os arquivos da atualização

Extraia o ZIP. Entre na pasta `atualizacao-excel-modelo` e copie o conteúdo dela para a raiz do seu projeto — a pasta onde já existe `package.json`.

Mescle as pastas e aceite substituir os arquivos com o mesmo nome. Não apague as pastas `src` ou `tests` antes de copiar. Não coloque a pasta inteira da atualização dentro de `src`.

Arquivos do sistema:

- `src/lib/excelExport.ts`: substitui o exportador anterior.
- `src/lib/timesheetTemplate.ts`: adiciona o preenchimento do modelo.
- `src/assets/folha-ponto-modelo.xlsx`: adiciona a planilha usada como modelo.
- `package.json` e `package-lock.json`: incluem JSZip como dependência direta.

Também seguem `tests/excel-template.mjs` e `tests/ui.mjs`, com a verificação da nova exportação. Os testes não são publicados no servidor.

Se você alterou outros recursos ou dependências depois da última versão enviada, compare os arquivos antes de substituir. Esta atualização não contém `.env`, configurações do Nginx, certificados nem migrações do Supabase.

## 3. Instale e teste no computador

Abra o terminal do VS Code na pasta do projeto e execute:

```powershell
npm ci
npm run dev
```

Abra o endereço que aparecer no terminal. Entre como administrador. Em Editar colaborador, confira:

- Nome: Moisés de Couto Almeida
- Cargo: Analista de redes

Salve o cadastro. Na exportação, escolha o colaborador e o mês e clique em Exportar Excel. Abra o arquivo e confira os dados e a visualização de impressão.

O cargo vem do cadastro: não é necessário modificar o código para cada funcionário. Se estiver vazio, a folha exibirá “Não informado”.

## 4. Gere a versão para o servidor

Encerre o servidor de teste com Ctrl+C. Execute:

```powershell
npm run build
```

Espere terminar sem erros. A pasta `dist` conterá o sistema atualizado, incluindo o modelo de Excel dentro de `dist/assets`.

No PowerShell, ainda dentro da pasta do projeto, envie:

```powershell
scp -r .\dist moises.almeida@10.18.0.122:/home/moises.almeida/
```

Entre no Ubuntu por SSH e execute, uma linha por vez:

```bash
sudo cp -a /var/www/controle-ponto "/var/www/controle-ponto.backup-$(date +%Y%m%d-%H%M%S)"
sudo cp -a /home/moises.almeida/dist/assets/. /var/www/controle-ponto/assets/
sudo cp /home/moises.almeida/dist/index.html /var/www/controle-ponto/index.html.novo
sudo mv /var/www/controle-ponto/index.html.novo /var/www/controle-ponto/index.html
```

Continue apenas se cada comando terminar sem erro. Os arquivos de assets devem ser copiados antes do index.html. Não é necessário reiniciar o Nginx.

Abra `https://ponto.intranet.setre/`, atualize com Ctrl+F5 e faça uma exportação de conferência.

## Como fica o Excel

- Um colaborador selecionado: download de um arquivo `.xlsx`.
- Vários colaboradores selecionados: download de um `.zip`, com um Excel individual para cada pessoa.
- A aba FOLHA DE PONTO mantém as informações da empresa, bordas, cores, dimensões, desenhos e campos de assinatura do modelo.
- Nome, cargo, mês, dias da semana e horários são preenchidos com os dados selecionados. A data ao lado de Salvador é a data de emissão.
- Meses com 28, 29, 30 ou 31 dias são tratados automaticamente. Linhas excedentes ficam vazias.
- Horários ausentes permanecem vazios. Marcações canceladas são desconsideradas. Uma marcação duplicada interrompe a exportação e pede revisão, para não esconder registros.
- Rubrica e abono não são preenchidos automaticamente. Os campos Colaborador, Supervisor (coordenador) e Fiscal do Contrato permanecem para assinatura. Não há assinatura eletrônica automática.
- Havendo solicitações no mês, a área Ocorrência indica uma aba adicional com descrição, situação e parecer de cada solicitação do colaborador.
- O modelo mantém a carga horária fixa de 44 horas semanais e a lotação SETRE, conforme a planilha enviada. Não são valores calculados por funcionário.
- A configuração original de impressão é A3, retrato. Confira a visualização de impressão no Excel antes de imprimir; não foi convertida para A4.

Este botão passa a gerar a folha no modelo da empresa em lugar das antigas abas Resumo/Espelho. Os cálculos exibidos nas telas do sistema não foram alterados.

## Verificações realizadas

Compilação TypeScript/Vite, testes no navegador e leitura dos arquivos gerados. Foram conferidos identificação, cargo, quatro tipos de marcação, virada de dia no fuso de São Paulo, registros cancelados, isolamento por funcionário, meses de tamanhos diferentes, duplicidades e exportação múltipla. Bordas, mesclagens, dimensões e configuração de impressão foram comparadas com o modelo; desenhos e imagens foram preservados byte a byte. A folha também foi inspecionada visualmente.

A verificação final no Microsoft Excel do seu computador e a publicação no seu servidor ainda precisam ser feitas por você. Não houve alteração no banco de dados durante os testes.

Para executar o teste específico de exportação no ambiente de desenvolvimento com o navegador Playwright instalado:

```powershell
node tests/excel-template.mjs
```

## Se precisar voltar

No computador, restaure a cópia anterior do projeto e execute `npm ci` antes de gerar outro build. No servidor, a pasta `controle-ponto.backup-...` contém a versão anterior. Não exclua os backups até conferir a nova exportação.
