# Teste de assinatura sem banco de dados

Este modo existe só para validar o fluxo antes de mexer no Supabase/PostgreSQL.
Todos os dados ficam em RAM e são apagados quando o backend reinicia.

## 1. Backend

```bash
cd backend
npm install
npm run dev:memory
```

Não configure `DATABASE_URL`.

Usuários demo:

- gestor: `admin` / `admin1234`
- assinante: `joao` / `joao1234`
- segundo assinante para testar usuário errado: `ana` / `ana1234`

Requisição fake: `req-demo-001`.

## 2. Frontend

Em outro terminal:

```bash
cd frontend
npm install
npm run dev
```

O frontend continua em `http://localhost:5173` e a API em `http://localhost:3001`.

## 3. Gerar uma assinatura com curl

Faça login como admin:

```bash
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","senha":"admin1234"}'
```

Copie o campo `token` da resposta para `JWT_ADMIN`:

```bash
JWT_ADMIN='COLE_O_TOKEN_AQUI'
```

Gere a solicitação para João (id 42):

```bash
curl -s -X POST http://localhost:3001/assinaturas/requisicao/req-demo-001 \
  -H "Authorization: Bearer $JWT_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"usuario_id":"42"}'
```

A resposta traz `assinaturaId`, `token` e `signingUrl`.
Abra `signingUrl` no navegador. A tela pedirá login; use `joao` / `joao1234`.

## Testes importantes

1. Login João + token correto => assina.
2. Login Ana + token do João => `403`.
3. João + token errado => `401`.
4. Repetir assinatura => `409`.
5. Código de validação => abre `/?validar=CODIGO` e deve mostrar `VALIDO`.
6. Alterar o documento depois da assinatura e validar de novo => `DOCUMENTO_ALTERADO`.

Para simular alteração, logado como admin:

```bash
curl -X PATCH http://localhost:3001/demo/documento \
  -H "Authorization: Bearer $JWT_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"quantidade":99}'
```

Depois consulte novamente o mesmo código em:

```text
http://localhost:3001/assinaturas/validar/SEU_CODIGO
```

## Voltar ao backend normal

```bash
npm run dev
```

O comando normal continua usando PostgreSQL/Supabase. O modo memória é ativado somente com `npm run dev:memory`.
