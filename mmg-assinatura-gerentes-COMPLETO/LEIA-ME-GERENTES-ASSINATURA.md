# Gerentes de unidade + assinatura automática

Esta versão muda o fluxo para:

`REQUISIÇÃO -> UNIDADE -> GERENTE RESPONSÁVEL -> QR -> PORTAL DE ASSINATURA`

O gestor da MMG **não escolhe mais manualmente quem assina**. Cada unidade tem um gerente previamente vinculado em **Acessos**.

## 1. Supabase — obrigatório antes do deploy

No SQL Editor execute, nesta ordem:

1. `backend/sql/2026-09-29-corrige-assinaturas.sql` (se ainda não executou)
2. `backend/sql/2026-09-29-gerentes-unidades.sql`

A segunda migration:

- adiciona `usuarios.somente_assinatura`;
- cria `unidade_gerentes`;
- permite um gerente responder por várias unidades;
- mantém apenas um gerente responsável por unidade.

## 2. Backend / Railway

Variáveis importantes:

```env
FRONTEND_URL=https://SEU-SITE-INTERNO
ASSINATURA_FRONTEND_URL=https://SEU-PORTAL-DE-ASSINATURA
ASSINATURA_TOKEN_MINUTOS=15
```

`ASSINATURA_FRONTEND_URL` é a URL do projeto Vercel cuja raiz é `assinatura-site`.

O backend usa `qrcode`. Se `package-lock.json` ainda não tiver essa dependência, rode localmente antes do commit:

```bash
cd backend
npm install
```

Depois versione o `package-lock.json` alterado.

## 3. Frontend interno

Opcionalmente configure no Vercel do site interno:

```env
VITE_ASSINATURA_URL=https://SEU-PORTAL-DE-ASSINATURA
```

Isso faz um gerente que tente entrar no site interno receber um aviso e um botão para o portal correto.

## 4. Cadastrar os gerentes

No site interno:

1. **Acessos**
2. **Novo acesso**
3. Tipo: **Gerente de unidade — somente assinatura**
4. Crie usuário e senha
5. O modal de unidades abre automaticamente
6. Marque todas as unidades pelas quais aquele gerente responde
7. Salve

Também é possível abrir **Vincular unidades** em um usuário existente. Ao vincular unidades, ele vira acesso exclusivo de assinatura.

## 5. Fluxo da assinatura

Na aba **Requisições**, cada cartão mostra:

- gerente responsável pela unidade; ou
- aviso de que ainda não existe gerente vinculado.

Ao clicar **Solicitar assinatura do gerente**:

- não existe seletor de usuário;
- o backend consulta o gerente da unidade;
- gera token único e QR para aquele gerente;
- outro usuário não consegue assinar;
- se o gerente da unidade mudar depois que o QR foi criado, o QR antigo é invalidado;
- depois de assinar, o token não pode ser reutilizado.

## 6. Portal separado

Crie um segundo projeto no Vercel com:

```text
Root Directory: assinatura-site
Framework: Vite
```

Variável:

```env
VITE_API_URL=https://SEU-BACKEND-RAILWAY
```

O gerente escaneia o QR, entra com a conta dele, confere a requisição e confirma a assinatura.

## 7. Teste recomendado

1. Cadastre um gerente e vincule uma unidade.
2. Abra uma requisição dessa unidade.
3. Confirme se aparece o nome do gerente no cartão.
4. Gere o QR.
5. Abra em aba anônima/celular.
6. Entre com o gerente correto e assine.
7. Tente o mesmo QR novamente: deve ser recusado.
8. Gere outro teste e tente entrar com outro usuário: deve ser recusado.
9. Troque o gerente da unidade depois de gerar um QR: o QR antigo deve ser recusado.
10. Tente usar a conta de gerente no painel interno: o backend deve bloquear o acesso.
