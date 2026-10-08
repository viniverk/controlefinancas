# Nossas Finanças — app + alertas no celular

## O que tem nesta pasta
| Arquivo | Para que serve |
|---|---|
| `index.html` | O app (menu lateral, lançamentos, calendário, gastos e limites) |
| `manifest.json`, `icon-*.png` | Fazem o site virar um **app instalável** no celular |
| `sw.js` | Recebe e mostra as notificações no celular |
| `scripts/notify.js` + `.github/workflows/alertas.yml` | Mandam o **resumo diário** (contas perto de vencer e limites quase estourados) |
| `regras-do-banco.json` | Regras de segurança novas do Realtime Database |

## Passo a passo (faça uma vez)

### 1) Subir os arquivos no GitHub
No repositório do site: **Add file → Upload files** e arraste **tudo** (inclusive as pastas `scripts` e `.github`), substituindo o `index.html` antigo.
> Se a pasta `.github` não subir arrastando, use **Add file → Create new file**, digite `.github/workflows/alertas.yml` como nome e cole o conteúdo do arquivo.

### 2) Atualizar as regras do banco (obrigatório)
Firebase → **Realtime Database → Regras** → apague tudo, cole o conteúdo de `regras-do-banco.json` → **Publicar**.
(Sem isso, o histórico de gastos, os limites e as notificações não salvam.)

### 3) Chave das notificações (VAPID) — já está colada no `index.html`
Firebase → ⚙️ **Configurações do projeto → Cloud Messaging → Certificados push da Web → Gerar par de chaves**.
Copie a chave e cole no `index.html`, no lugar de `COLE_AQUI_A_CHAVE_VAPID` (perto do começo do `<script>`). Salve o arquivo no GitHub.

### 4) Liberar o envio automático (GitHub Actions)
1. Firebase → ⚙️ **Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Baixa um arquivo `.json`. **Não suba esse arquivo no site, no chat nem em nenhum lugar — ele dá acesso total ao banco.**
2. GitHub → seu repositório → **Settings → Secrets and variables → Actions → New repository secret**
   - Nome: `FIREBASE_SERVICE_ACCOUNT`
   - Valor: abra o `.json` no bloco de notas, copie **tudo** e cole.
3. (Opcional) Na aba **Variables**, crie `SITE_URL` com o endereço do seu site (para a notificação abrir o app ao ser tocada).

### 5) Ativar em cada celular (você e sua esposa)
1. Abra o site no celular e **instale o app**:
   - Android (Chrome): menu ⋮ → **Instalar app**.
   - iPhone (Safari): **Compartilhar → Adicionar à Tela de Início** (precisa ser iOS 16.4 ou mais novo e abrir **pelo ícone**).
2. Entre na conta → **Configurações → Notificações no celular → Ativar** → permita.
3. Toque em **Testar** para ver a notificação de teste.

### 6) Testar o envio automático
GitHub → aba **Actions → Alertas diários no celular → Run workflow**. Marque “Modo teste” para só ver no log; desmarque para enviar de verdade.
O envio automático acontece todo dia às 08:00 (Brasília).


## Cartão de crédito
1. Aba **Cartões → + Novo cartão**: dia de **vencimento**, dia de **fechamento** (ou marque **“Fecha no último dia do mês”** para jogar todas as compras do mês na fatura do mês seguinte) e, se quiser, um **limite de gastos por mês**.
2. **+ Compra no cartão**: escolha o cartão; a compra entra na fatura certa e **debita o limite do mês em que foi feita**.
   - **Compra parcelada**: escolha o número de parcelas (2x a 24x) e se o valor digitado é o total ou o de cada parcela. Cada parcela vira um lançamento (ex.: “TV (2/3)”) na fatura do seu mês e conta no limite daquele mês. Ao excluir uma parcela, o app pergunta se quer apagar todas.
   - **Editar**: nas compras do cartão, nos gastos avulsos e nos pagamentos concluídos aparece o botão ✏️ (ao lado da 🗑). Em compra parcelada dá para aplicar a mudança a todas as parcelas ou só a escolhida.
   - **Expandir/recolher**: na aba Cartões, clique no nome do cartão para recolher, em “Ver/Ocultar compras” para esconder as compras de cada fatura e use **Por data / Por categoria** para agrupar as compras (cada categoria também recolhe, com subtotal). “Expandir tudo / Recolher tudo” no topo. O app lembra o que você deixou aberto.
   - **Compilados**: no topo da aba Cartões aparece o total por cartão e por categoria (soma de todos os cartões) das faturas que vencem no mês. Em Gastos e limites, “De onde saiu o gasto” separa crédito × débito/à vista (gasto avulso) × contas, por categoria.
3. **+ Fatura (informar total)**: lance só o total que veio no banco (ex.: R$ 1.500), com o **vencimento que você escolher**. Ela entra no caixa/calendário na data do vencimento, mas o **gasto conta no limite do mês em que a fatura foi gerada** (mês do meio do período), não no mês em que vence.
4. Em cada fatura há **Editar vencimento / total** e **Marcar como paga**. Só o pagamento mexe no saldo.
5. Fatura que você já tinha lançado como conta comum? Abra o lançamento e use **“Converter em fatura do cartão”**.
6. Em **Gastos e limites** aparece uma linha 💳 por cartão (gasto do mês × limite) e os alertas (Início e celular) avisam quando chega perto.

## Observações
- Só chega notificação se houver algo importante no dia (conta perto de vencer/atrasada ou limite ≥ % escolhido nas Configurações).
- Se o repositório ficar 60 dias sem nenhuma alteração, o GitHub pausa agendamentos: é só reativar na aba Actions.
- WhatsApp: não incluí porque o jeito oficial exige conta comercial da Meta e é pago por mensagem. Dá para adicionar um aviso por Telegram ou CallMeBot depois, se quiserem.
