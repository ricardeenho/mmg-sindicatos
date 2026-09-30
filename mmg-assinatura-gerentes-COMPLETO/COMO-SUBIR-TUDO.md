# MMG - subir assinatura por QR + gerentes de unidade

Este pacote deve ser extraido **por cima do repositorio atual** `mmg-sindicatos`.
Nao substitua o repositorio inteiro por uma versao antiga: copie somente os arquivos deste pacote para a raiz atual.

## Ordem

1. No Supabase SQL Editor, rode `00-RODAR-NO-SUPABASE-ASSINATURAS.sql`.
2. Extraia este ZIP por cima da raiz atual do repositorio.
3. Em `backend`, rode `npm install` para instalar `qrcode` e atualizar o lock.
4. No Railway/backend configure:
   - `FRONTEND_URL=https://URL-DO-SITE-INTERNO`
   - `ASSINATURA_FRONTEND_URL=https://URL-DO-PORTAL-DE-ASSINATURA`
   - `ASSINATURA_TOKEN_MINUTOS=15`
   - mantenha `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USUARIO`, `ADMIN_SENHA` ja usados em producao.
5. No Vercel do site interno, mantenha `VITE_API_URL` apontando para o Railway. Opcional: `VITE_ASSINATURA_URL=https://URL-DO-PORTAL-DE-ASSINATURA`.
6. Crie um segundo projeto Vercel no mesmo repo, Root Directory `assinatura-site`, Framework Vite, com `VITE_API_URL=https://URL-DO-BACKEND-RAILWAY`.
7. Depois que o segundo Vercel gerar a URL, atualize `ASSINATURA_FRONTEND_URL` no Railway e redeploy o backend.
8. Commit/push na `main`.
9. No site interno: Acessos -> Novo acesso -> Gerente de unidade - somente assinatura -> vincule as unidades.
10. Em Requisicoes, gere o QR e teste em aba anonima/celular com a conta do gerente correto.

## Antes do push

Confirme que `backend/.env` NAO sera enviado:

```powershell
git check-ignore backend/.env
git status --short
```

## Testes esperados

- gerente correto consegue assinar;
- outro usuario nao consegue;
- mesmo QR nao pode ser usado duas vezes;
- QR expirado e recusado;
- se trocar o gerente da unidade depois de gerar o QR, o QR anterior e recusado;
- conta marcada como `somente_assinatura` nao acessa o painel interno;
- QR final de validacao mostra quem assinou e detecta alteracao da requisicao.
