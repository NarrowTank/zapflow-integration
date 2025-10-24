# 🔐 Como Funciona o .env - Guia Completo

## 📋 O que é o arquivo `.env`?

O `.env` é um arquivo que contém **variáveis de ambiente** com **credenciais e configurações sensíveis** do sistema. Ele **NUNCA** deve ser commitado no Git/GitHub por questões de segurança.

---

## 🎯 Arquivos de Ambiente no Projeto

### **1. `env.example`** ✅ VAI para o GitHub
**Propósito:** Template de exemplo para desenvolvimento local

**Conteúdo:** Variáveis com valores de exemplo/placeholder
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/db
ZAPI_INSTANCE=SEU_INSTANCE_ID_AQUI
ZAPI_TOKEN=SEU_TOKEN_AQUI
```

**Uso:**
```bash
# Desenvolvedor copia e preenche
cp env.example .env
nano .env  # Preenche com credenciais reais
```

---

### **2. `env.prod.example`** ✅ VAI para o GitHub
**Propósito:** Template para produção (VPS)

**Conteúdo:** Variáveis configuradas para ambiente de produção, mas sem credenciais reais
```bash
NODE_ENV=production
DATABASE_URL=postgresql://metta_user:SENHA@metta_postgres:5432/metta_db
ZAPI_INSTANCE=SEU_INSTANCE_ID_AQUI
```

**Uso:**
```bash
# Na VPS, após clonar o repositório
cp env.prod.example .env
nano .env  # Preenche com credenciais reais de produção
```

---

### **3. `.env`** ❌ NÃO VAI para o GitHub
**Propósito:** Arquivo real com credenciais

**Conteúdo:** Credenciais reais e sensíveis
```bash
DATABASE_URL=postgresql://metta_user:04022002Gui@metta_postgres:5432/metta_db
ZAPI_INSTANCE=3E77F2E4E5B130A5127B864C13D95647
ZAPI_TOKEN=4FE9EC5E2109EBCDDCD36712
METTA_PASSWORD=SenhaSecreta123!
```

**Proteção:**
- ✅ Listado no `.gitignore` (não vai para o GitHub)
- ✅ Listado no `.dockerignore` (não vai para a imagem Docker)
- ✅ Criado manualmente em cada ambiente

---

### **4. `.env.new`** ❓ (Você mencionou, mas não encontrei)
**Possíveis cenários:**

**A) Arquivo temporário criado por erro:**
- Pode deletar com segurança se não estiver usando

**B) Backup de configuração antiga:**
- Se for backup, renomeie para `.env.backup` e adicione ao `.gitignore`

**C) Arquivo de migração:**
- Se contém novas variáveis, mescle com `.env` e delete

**Recomendação:** Se não sabe para que serve, **delete** ou me mostre o conteúdo.

---

## 🔄 Fluxo Completo: Desenvolvimento → GitHub → Produção

### **1. Desenvolvimento Local (Seu Computador)**

```powershell
# Criar .env a partir do template
cp env.example .env

# Editar com credenciais de desenvolvimento
notepad .env

# Arquivo .env fica APENAS no seu computador
# NÃO vai para o GitHub (protegido pelo .gitignore)
```

---

### **2. GitHub (Repositório)**

```
✅ VAI para o GitHub:
├── env.example          (template sem credenciais)
├── env.prod.example     (template de produção sem credenciais)
├── .gitignore           (protege .env)
└── docker-compose.yml   (usa variáveis do .env)

❌ NÃO VAI para o GitHub:
├── .env                 (credenciais reais)
├── .env.*               (qualquer variação)
└── node_modules/        (dependências)
```

---

### **3. Produção (VPS)**

```bash
# 1. Clonar repositório (vem sem .env)
git clone https://github.com/SEU_USUARIO/zapflow-integration.git
cd zapflow-integration

# 2. Criar .env a partir do template de produção
cp env.prod.example .env

# 3. Editar com credenciais REAIS de produção
nano .env

# 4. Arquivo .env fica APENAS na VPS
# Nunca é commitado de volta para o GitHub
```

---

## 🔒 Por que `.env` NÃO vai para o GitHub?

### **Riscos se commitar `.env`:**

❌ **Exposição de Credenciais:**
- Senhas de banco de dados
- Tokens de API (Z-API, etc.)
- Chaves secretas

❌ **Acesso Não Autorizado:**
- Qualquer pessoa com acesso ao repositório vê as credenciais
- Se repositório for público, TODO MUNDO vê

❌ **Ataques:**
- Bots varrem GitHub procurando credenciais expostas
- Podem usar para acessar seu sistema

❌ **Compliance:**
- Violação de boas práticas de segurança
- Problemas com LGPD/GDPR

---

## ✅ Como o Sistema Funciona SEM `.env` no GitHub

### **Docker Compose:**

```yaml
# docker-compose.yml
services:
  zapflow-integration:
    env_file:
      - .env  # ← Lê o arquivo .env LOCAL (não do GitHub)
    environment:
      - NODE_ENV=${NODE_ENV:-production}
```

**Fluxo:**
1. Docker Compose procura arquivo `.env` **no diretório local**
2. Se não encontrar, usa valores padrão ou falha
3. Por isso você **CRIA** o `.env` manualmente na VPS

---

## 📝 Checklist de Segurança

### **Antes de fazer `git push`:**

```powershell
# 1. Verificar o que será commitado
git status

# 2. GARANTIR que .env NÃO aparece na lista
# Se aparecer, PARE e verifique o .gitignore

# 3. Verificar conteúdo do que será commitado
git diff --cached

# 4. Se tudo OK, fazer push
git push
```

### **Se acidentalmente commitou `.env`:**

```powershell
# URGENTE: Remover do histórico
git rm --cached .env
git commit -m "Remove .env from repository"
git push

# Depois, TROCAR TODAS AS CREDENCIAIS
# (senhas, tokens, etc.) pois foram expostas
```

---

## 🎯 Resumo Prático

### **O que VOCÊ faz:**

**No seu computador:**
```powershell
cp env.example .env
notepad .env  # Preenche credenciais de dev
# .env fica APENAS no seu PC
```

**No GitHub:**
```powershell
git add .
git push
# .env NÃO vai (protegido pelo .gitignore)
# Apenas templates (env.example, env.prod.example) vão
```

**Na VPS:**
```bash
git clone https://github.com/...
cd zapflow-integration
cp env.prod.example .env
nano .env  # Preenche credenciais de produção
# .env fica APENAS na VPS
```

---

## 🔍 Como Verificar se Está Seguro

### **Teste 1: Verificar .gitignore**
```powershell
# Deve retornar: .env
grep "^\.env$" .gitignore
```

### **Teste 2: Verificar o que será commitado**
```powershell
git status
# .env NÃO deve aparecer na lista
```

### **Teste 3: Simular commit**
```powershell
git add .
git status
# .env NÃO deve aparecer em "Changes to be committed"
```

### **Teste 4: Verificar no GitHub**
Após o push, acesse o repositório no GitHub e confirme que `.env` **NÃO** está lá.

---

## ❓ Perguntas Frequentes

### **P: E se eu perder meu `.env`?**
**R:** Copie novamente do template:
```bash
cp env.prod.example .env
nano .env  # Preenche credenciais novamente
```

### **P: Posso ter `.env` diferente em dev e prod?**
**R:** Sim! E deve! Cada ambiente tem seu próprio `.env` local.

### **P: Como compartilhar credenciais com a equipe?**
**R:** Use um gerenciador de senhas (1Password, LastPass, etc.) ou variáveis de ambiente do CI/CD. **NUNCA** via Git.

### **P: E se eu quiser versionar configurações?**
**R:** Versione os **templates** (`env.example`, `env.prod.example`), não o `.env` real.

---

## 🎉 Conclusão

**Regra de Ouro:**
> `.env` = Credenciais reais = **NUNCA** no Git/GitHub

**Fluxo Seguro:**
1. ✅ Templates vão para o GitHub
2. ✅ `.env` é criado manualmente em cada ambiente
3. ✅ `.gitignore` protege o `.env`
4. ✅ Cada ambiente tem suas próprias credenciais

**Resultado:**
- 🔒 Credenciais seguras
- 🚀 Deploy fácil (copia template e preenche)
- 👥 Colaboração segura (sem expor senhas)

---

**Dúvidas?** Consulte [FAQ.md](./FAQ.md) ou [DEPLOY_GITHUB.md](./DEPLOY_GITHUB.md)

