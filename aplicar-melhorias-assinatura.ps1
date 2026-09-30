param(
  [string]$Repo = "."
)

$ErrorActionPreference = "Stop"

$repoPath = (Resolve-Path $Repo).Path
$backendPath = Join-Path $repoPath "backend\routes\assinaturas.js"
$appPath = Join-Path $repoPath "assinatura-site\src\App.jsx"
$cssPath = Join-Path $repoPath "assinatura-site\src\style.css"

foreach ($p in @($backendPath, $appPath, $cssPath)) {
  if (-not (Test-Path $p)) {
    throw "Arquivo não encontrado: $p`nRode este script na raiz do repositório mmg-sindicatos."
  }
}

Write-Host "Aplicando melhorias SOMENTE no backend de assinaturas e no assinatura-site..." -ForegroundColor Cyan

# -------------------------------------------------------------------
# BACKEND
# - padrão de 60 min
# - permite até 480 min por variável de ambiente
# - ao gerar novo link, cancela o pendente anterior e cria um novo
# - mensagem amigável para link substituído
# - envia mais detalhes para o resumo exibido ao gerente
# -------------------------------------------------------------------
$backend = Get-Content $backendPath -Raw -Encoding UTF8

$oldToken = "const TOKEN_MINUTOS = Math.max(2, Math.min(120, Number(process.env.ASSINATURA_TOKEN_MINUTOS || 15)));"
$newToken = "const TOKEN_MINUTOS = Math.max(5, Math.min(480, Number(process.env.ASSINATURA_TOKEN_MINUTOS || 60)));"

if (-not $backend.Contains($oldToken) -and -not $backend.Contains($newToken)) {
  throw "Não encontrei a linha TOKEN_MINUTOS esperada. Parei para não alterar o backend errado."
}
$backend = $backend.Replace($oldToken, $newToken)

$oldResumo = @'
    turno: documento.turno,
    funcoes: documento.funcoes,
    solicitante_nome: documento.solicitante_nome,
    tipo: documento.tipo,
'@

$newResumo = @'
    turno: documento.turno,
    hora_inicio: documento.hora_inicio,
    hora_fim: documento.hora_fim,
    atividades: documento.atividades,
    observacoes: documento.observacoes,
    funcoes: documento.funcoes,
    solicitante_nome: documento.solicitante_nome,
    solicitante_tipo: documento.solicitante_tipo,
    tipo: documento.tipo,
'@

if ($backend.Contains($oldResumo)) {
  $backend = $backend.Replace($oldResumo, $newResumo)
}

$oldPendente = @'
    await consulta(`
      update requisicao_assinaturas
         set status = 'cancelada'
       where requisicao_id = $1
         and status = 'pendente'
         and (usuario_id <> $2 or expira_em < now())
    `, [req.params.requisicaoId, u.id]);

    const { rows: [pendente] } = await consulta(`
      select id, expira_em
        from requisicao_assinaturas
       where requisicao_id = $1 and usuario_id = $2
         and status = 'pendente' and expira_em >= now()
       order by criado_em desc
       limit 1
    `, [req.params.requisicaoId, u.id]);
    if (pendente) {
      return res.status(409).json({
        error: `Ja existe uma assinatura pendente para ${u.nome}. Use o QR ja gerado ou aguarde o vencimento para gerar outro.`,
        codigo: 'ASSINATURA_JA_PENDENTE',
        assinaturaId: pendente.id,
        expiraEm: pendente.expira_em,
      });
    }

'@

$newPendente = @'
    // Um token secreto nunca é salvo em texto puro, apenas o hash.
    // Por isso, se o gestor perdeu o QR/link de uma solicitação pendente,
    // não existe forma segura de "recuperar" o mesmo link.
    // Gerar novamente cancela o pendente anterior e cria um token novo.
    const cancelamento = await consulta(`
      update requisicao_assinaturas
         set status = 'cancelada'
       where requisicao_id = $1
         and status = 'pendente'
    `, [req.params.requisicaoId]);
    const pendentesSubstituidas = Number(cancelamento.rowCount || 0);

'@

if ($backend.Contains($oldPendente)) {
  $backend = $backend.Replace($oldPendente, $newPendente)
} elseif (-not $backend.Contains("const pendentesSubstituidas = Number(cancelamento.rowCount || 0);")) {
  throw "Não encontrei o bloco de assinatura pendente esperado. Parei para não fazer uma substituição insegura."
}

$oldAviso = @'
      aviso: `QR destinado automaticamente a ${u.nome}, gerente responsavel pela unidade.`,
'@
$newAviso = @'
      substituiuPendente: pendentesSubstituidas > 0,
      aviso: pendentesSubstituidas > 0
        ? `Um link pendente anterior foi cancelado e substituido por este novo link para ${u.nome}.`
        : `QR destinado automaticamente a ${u.nome}, gerente responsavel pela unidade.`,
'@
if ($backend.Contains($oldAviso)) {
  $backend = $backend.Replace($oldAviso, $newAviso)
}

$oldStatus = @'
    if (a.status !== 'pendente') {
      await client.query('rollback');
      return res.status(409).json({ error: 'Esta solicitacao ja foi utilizada' });
    }
'@
$newStatus = @'
    if (a.status === 'cancelada') {
      await client.query('rollback');
      return res.status(409).json({
        error: 'Este link foi substituido por uma nova solicitacao de assinatura. Use o link mais recente enviado pela MMG.',
        codigo: 'LINK_SUBSTITUIDO',
      });
    }
    if (a.status !== 'pendente') {
      await client.query('rollback');
      return res.status(409).json({ error: 'Esta solicitacao ja foi utilizada' });
    }
'@
if ($backend.Contains($oldStatus)) {
  $backend = $backend.Replace($oldStatus, $newStatus)
}

Set-Content $backendPath -Value $backend -Encoding UTF8

# -------------------------------------------------------------------
# PORTAL DE ASSINATURA
# -------------------------------------------------------------------
$app = @'
import React, { useEffect, useMemo, useState } from 'react';

const API = String(import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const STORAGE = 'mmg_assinatura_jwt';

function fmtData(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(d);
}

function fmtDataHora(d) {
  return d ? new Date(d).toLocaleString('pt-BR') : '—';
}

function fmtHora(h) {
  return h ? String(h).slice(0, 5) : '';
}

async function json(url, options = {}) {
  const r = await fetch(`${API}${url}`, options);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const erro = new Error(d.error || `Erro ${r.status}`);
    erro.status = r.status;
    erro.codigo = d.codigo;
    throw erro;
  }
  return d;
}

function authHeaders(jwt, body = false) {
  return {
    Authorization: `Bearer ${jwt}`,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
}

function Logo() {
  return (
    <div className="brand">
      <img
        src="/logo-mmg.png"
        alt="MMG · Movimentação de Mercadorias em Geral"
        className="brandLogo"
      />
      <div className="brandText">
        <strong>MMG Sindicatos</strong>
        <span>Portal de assinaturas</span>
      </div>
    </div>
  );
}

function Card({ children }) {
  return <main className="card">{children}</main>;
}

function Estado({ tipo = 'info', icone, titulo, texto, children }) {
  return (
    <div className={`state state-${tipo}`}>
      <div className="stateIcon">{icone}</div>
      <div className="stateBody">
        <strong>{titulo}</strong>
        {texto && <p>{texto}</p>}
        {children}
      </div>
    </div>
  );
}

function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const d = await json('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, senha }),
      });
      localStorage.setItem(STORAGE, d.token);
      onLogin(d.token);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Card>
      <div className="eyebrow">ACESSO DO ASSINANTE</div>
      <h1>Entre para assinar</h1>
      <p className="muted">
        Use sua conta de gerente vinculada à unidade desta requisição.
      </p>

      <form onSubmit={entrar} className="form">
        <label>
          Usuário
          <input
            autoFocus
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoComplete="username"
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {erro && <div className="error">{erro}</div>}

        <button disabled={carregando || !usuario || !senha}>
          {carregando ? 'Entrando…' : 'Continuar'}
        </button>
      </form>

      <div className="secureLine">🔒 Acesso seguro e individual do gerente</div>
    </Card>
  );
}

function Documento({ d }) {
  if (!d) return null;

  const horario =
    d.hora_inicio || d.hora_fim
      ? `${fmtHora(d.hora_inicio) || '—'} às ${fmtHora(d.hora_fim) || '—'}`
      : '';

  return (
    <section className="doc">
      <div className="docTitle">Resumo da requisição</div>

      <div className="docRow">
        <span>Requisição</span>
        <b>#{String(d.requisicao_id || '').slice(0, 8).toUpperCase()}</b>
      </div>

      <div className="docRow">
        <span>Unidade</span>
        <b>
          {d.unidade_codigo || ''}
          {d.unidade_nome ? ` · ${d.unidade_nome}` : ''}
        </b>
      </div>

      {(d.local_nome || d.local_cidade) && (
        <div className="docRow">
          <span>Local</span>
          <b>
            {[d.local_nome, d.local_cidade].filter(Boolean).join(' · ')}
          </b>
        </div>
      )}

      <div className="docRow">
        <span>Período</span>
        <b>
          {fmtData(d.previsao_inicio)} a {fmtData(d.previsao_fim)}
        </b>
      </div>

      <div className="docRow">
        <span>Quantidade</span>
        <b>
          {d.quantidade ?? '—'}{' '}
          {Number(d.quantidade) === 1 ? 'trabalhador' : 'trabalhadores'}
        </b>
      </div>

      {d.turno && (
        <div className="docRow">
          <span>Turno</span>
          <b>{d.turno}</b>
        </div>
      )}

      {horario && (
        <div className="docRow">
          <span>Horário</span>
          <b>{horario}</b>
        </div>
      )}

      {d.solicitante_nome && (
        <div className="docRow">
          <span>Solicitante</span>
          <b>{d.solicitante_nome}</b>
        </div>
      )}

      {(d.funcoes || []).length > 0 && (
        <div className="docSection">
          <span className="docSectionLabel">Funções</span>
          <div className="funcoes">
            {d.funcoes.map((f, i) => (
              <span key={i}>
                {f.quantidade}× {f.nome || f.funcao}
              </span>
            ))}
          </div>
        </div>
      )}

      {(d.atividades || []).length > 0 && (
        <div className="docSection">
          <span className="docSectionLabel">Atividades</span>
          <p className="docText">{d.atividades.join(' · ')}</p>
        </div>
      )}

      {d.observacoes && (
        <div className="docSection">
          <span className="docSectionLabel">Observações</span>
          <p className="docText">{d.observacoes}</p>
        </div>
      )}
    </section>
  );
}

function Assinatura({ id, tokenSecreto, jwt, logout }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [assinando, setAssinando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    setErro('');
    json(`/assinaturas/${encodeURIComponent(id)}`, {
      headers: authHeaders(jwt),
    })
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, [id, jwt]);

  async function assinar() {
    setAssinando(true);
    setErro('');
    try {
      const d = await json(`/assinaturas/${encodeURIComponent(id)}/assinar`, {
        method: 'POST',
        headers: authHeaders(jwt, true),
        body: JSON.stringify({ token: tokenSecreto }),
      });

      setResultado(d);
      setDados((v) => ({
        ...v,
        status: 'assinada',
        assinada_em: d.assinada_em,
        validation_code: d.validation_code,
      }));
    } catch (e) {
      setErro(e.message);
    } finally {
      setAssinando(false);
    }
  }

  if (erro && !dados) {
    const outroUsuario =
      erro.toLowerCase().includes('outro usuario') ||
      erro.toLowerCase().includes('outro usuário');

    return (
      <Card>
        <Estado
          tipo="erro"
          icone="!"
          titulo={outroUsuario ? 'Este link pertence a outro gerente' : 'Não foi possível abrir esta assinatura'}
          texto={
            outroUsuario
              ? 'Saia desta conta e entre com o usuário do gerente responsável pela unidade.'
              : erro
          }
        />
        <button className="secondary" onClick={logout}>
          Entrar com outro usuário
        </button>
      </Card>
    );
  }

  if (!dados) {
    return (
      <Card>
        <div className="loadingRow">
          <span className="spinner" />
          <span>Carregando requisição…</span>
        </div>
      </Card>
    );
  }

  const documento = resultado?.documento || dados.documento;
  const codigo = resultado?.validation_code || dados.validation_code;
  const assinadaEm = resultado?.assinada_em || dados.assinada_em;
  const concluida = !!resultado || dados.status === 'assinada';

  if (!concluida && dados.status === 'expirada') {
    return (
      <Card>
        <div className="eyebrow">ASSINATURA DE REQUISIÇÃO</div>
        <h1>Este link expirou</h1>
        <Estado
          tipo="aviso"
          icone="⌛"
          titulo="O prazo deste link terminou"
          texto="Peça à MMG para gerar um novo link de assinatura. O link vencido não pode mais ser utilizado."
        />
        <Documento d={documento} />
        <button className="linkButton" onClick={logout}>Sair</button>
      </Card>
    );
  }

  if (!concluida && dados.status === 'cancelada') {
    return (
      <Card>
        <div className="eyebrow">ASSINATURA DE REQUISIÇÃO</div>
        <h1>Este link foi substituído</h1>
        <Estado
          tipo="aviso"
          icone="↻"
          titulo="Existe um link mais recente"
          texto="Por segurança, este link foi cancelado quando a MMG gerou uma nova solicitação. Use o link mais recente recebido."
        />
        <button className="linkButton" onClick={logout}>Sair</button>
      </Card>
    );
  }

  if (concluida) {
    return (
      <Card>
        <div className="eyebrow">ASSINATURA DE REQUISIÇÃO</div>
        <h1>Assinatura concluída</h1>

        <Estado
          tipo="sucesso"
          icone="✓"
          titulo="Requisição assinada com sucesso"
          texto={`Assinada por ${dados.assinante_nome} em ${fmtDataHora(assinadaEm)}.`}
        />

        <Documento d={documento} />

        {codigo && (
          <div className="validationResult">
            <span>Código de validação</span>
            <code>{codigo}</code>
            <a
              className="primaryLink"
              href={`/?validar=${encodeURIComponent(codigo)}`}
            >
              Validar assinatura
            </a>
          </div>
        )}

        <button className="linkButton" onClick={logout}>Sair</button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="eyebrow">ASSINATURA DE REQUISIÇÃO</div>
      <h1>Confira antes de assinar</h1>

      <p className="muted">
        Assinatura destinada a <strong>{dados.assinante_nome}</strong>
        {dados.assinante_usuario ? ` (@${dados.assinante_usuario})` : ''}.
      </p>

      <Documento d={documento} />

      <div className="notice">
        Ao confirmar, você declara que conferiu e aprovou os dados desta
        requisição. A confirmação fica vinculada ao seu usuário e ao conteúdo
        exibido acima.
      </div>

      {erro && <div className="error">{erro}</div>}

      <div className="expires">
        Link válido até <strong>{fmtDataHora(dados.expira_em)}</strong>
      </div>

      <button onClick={assinar} disabled={assinando}>
        {assinando ? 'Confirmando assinatura…' : 'Confirmar e assinar'}
      </button>

      <div className="secureLine">🔒 Link individual, protegido e de uso único</div>

      <button className="linkButton" onClick={logout}>
        Sair
      </button>
    </Card>
  );
}

function Validacao({ codigo }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    json(`/assinaturas/validar/${encodeURIComponent(codigo)}`)
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, [codigo]);

  return (
    <Card>
      <div className="eyebrow">VALIDAÇÃO PÚBLICA</div>
      <h1>Validar assinatura</h1>

      {!dados && !erro && (
        <div className="loadingRow">
          <span className="spinner" />
          <span>Verificando assinatura…</span>
        </div>
      )}

      {erro && (
        <Estado
          tipo="erro"
          icone="!"
          titulo="Assinatura não encontrada"
          texto={erro}
        />
      )}

      {dados && (
        <>
          <Estado
            tipo={dados.valido ? 'sucesso' : 'erro'}
            icone={dados.valido ? '✓' : '!'}
            titulo={
              dados.valido
                ? 'Assinatura válida e documento íntegro'
                : 'O documento foi alterado'
            }
            texto={
              dados.valido
                ? 'O conteúdo atual confere com o conteúdo que foi assinado.'
                : 'O conteúdo atual não corresponde ao conteúdo registrado no momento da assinatura.'
            }
          />

          <Documento d={dados.documento} />

          <div className="validation">
            <span>Assinado por</span>
            <b>{dados.assinante?.nome}</b>

            <span>Data</span>
            <b>{fmtDataHora(dados.assinadaEm)}</b>

            <span>Código</span>
            <code>{dados.codigo}</code>
          </div>
        </>
      )}
    </Card>
  );
}

export default function App() {
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    []
  );

  const hash = useMemo(
    () => new URLSearchParams(window.location.hash.replace(/^#/, '')),
    []
  );

  const assinaturaId = params.get('assinar');
  const tokenSecreto = hash.get('st') || params.get('st');
  const validar = params.get('validar');

  const [jwt, setJwt] = useState(
    () => localStorage.getItem(STORAGE) || ''
  );

  const logout = () => {
    localStorage.removeItem(STORAGE);
    setJwt('');
  };

  return (
    <div className="page">
      <div className="shell">
        <Logo />

        {validar ? (
          <Validacao codigo={validar} />
        ) : assinaturaId && tokenSecreto ? (
          jwt ? (
            <Assinatura
              id={assinaturaId}
              tokenSecreto={tokenSecreto}
              jwt={jwt}
              logout={logout}
            />
          ) : (
            <Login onLogin={setJwt} />
          )
        ) : (
          <Card>
            <div className="eyebrow">MMG ASSINATURAS</div>
            <h1>Abra o link enviado pela MMG</h1>
            <p className="muted">
              Este portal é exclusivo para gerentes confirmarem e validarem
              requisições das unidades pelas quais são responsáveis.
            </p>
          </Card>
        )}

        <footer>MMG · Portal seguro de assinaturas</footer>
      </div>
    </div>
  );
}
'@

Set-Content $appPath -Value $app -Encoding UTF8

$css = @'
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #0f172a;
  background: #0f172a;
  font-synthesis: none;
}

* { box-sizing: border-box; }

html, body, #root {
  min-height: 100%;
  margin: 0;
}

body { background: #0f172a; }

.page {
  min-height: 100vh;
  background: #0f172a;
  display: grid;
  place-items: center;
  padding: 24px 16px;
}

.shell {
  width: min(620px, 100%);
  margin: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 0 18px 4px;
  color: #fff;
}

.brandLogo {
  height: 50px;
  width: auto;
  max-width: 180px;
  object-fit: contain;
}

.brandText {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brandText strong {
  color: #fff;
  font-size: 17px;
  font-weight: 600;
}

.brandText span {
  color: #94a3b8;
  font-size: 12px;
  margin-top: 4px;
}

.card {
  background: #fff;
  border-radius: 16px;
  padding: 32px;
  border: 1px solid #e2e8f0;
  box-shadow:
    0 20px 25px -5px rgb(0 0 0 / 0.15),
    0 8px 10px -6px rgb(0 0 0 / 0.12);
}

.eyebrow {
  color: #0d9488;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  margin-bottom: 8px;
}

h1 {
  margin: 0 0 8px;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.25;
  font-weight: 600;
}

.muted {
  margin: 0 0 22px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.form {
  display: grid;
  gap: 12px;
}

.form label {
  display: grid;
  gap: 6px;
  color: #334155;
  font-size: 13px;
  font-weight: 500;
}

.form input {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  outline: none;
  transition: .15s ease;
}

.form input:hover { border-color: #cbd5e1; }

.form input:focus {
  border-color: #0d9488;
  box-shadow: 0 0 0 3px rgb(13 148 136 / .12);
}

button {
  width: 100%;
  border: 0;
  border-radius: 8px;
  padding: 11px 16px;
  background: #0d9488;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: .15s ease;
}

button:hover:not(:disabled) { background: #0f766e; }

button:disabled {
  cursor: default;
  opacity: .5;
}

.secondary {
  margin-top: 14px;
  background: #334155;
}

.secondary:hover { background: #1e293b; }

.linkButton {
  width: auto;
  padding: 8px 0;
  margin-top: 12px;
  background: transparent;
  color: #64748b;
  text-decoration: underline;
}

.linkButton:hover {
  background: transparent !important;
  color: #334155;
}

.doc {
  margin: 20px 0;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.docTitle {
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 6px;
}

.docRow {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 18px;
  padding: 9px 0;
  border-bottom: 1px solid #e2e8f0;
  font-size: 13px;
}

.docRow span { color: #64748b; }

.docRow b {
  color: #0f172a;
  text-align: right;
  font-weight: 600;
}

.docSection {
  padding-top: 12px;
}

.docSectionLabel {
  display: block;
  color: #64748b;
  font-size: 12px;
  margin-bottom: 7px;
}

.docText {
  margin: 0;
  color: #334155;
  font-size: 12px;
  line-height: 1.5;
}

.funcoes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.funcoes span {
  padding: 5px 9px;
  border-radius: 999px;
  background: #ccfbf1;
  color: #115e59;
  font-size: 11px;
  font-weight: 600;
}

.notice {
  margin: 14px 0;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  line-height: 1.5;
}

.expires {
  margin: 14px 0;
  color: #64748b;
  font-size: 12px;
}

.expires strong { color: #334155; }

.error {
  margin: 12px 0;
  padding: 12px 14px;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  background: #fff1f2;
  color: #be123c;
  font-size: 13px;
  line-height: 1.45;
}

.state {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border: 1px solid;
  border-radius: 12px;
  padding: 14px;
  margin: 16px 0;
}

.stateIcon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 17px;
  font-weight: 800;
}

.stateBody strong {
  display: block;
  font-size: 13px;
}

.stateBody p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

.state-sucesso {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #065f46;
}

.state-sucesso .stateIcon { background: #d1fae5; }

.state-aviso {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}

.state-aviso .stateIcon { background: #fef3c7; }

.state-erro {
  background: #fff1f2;
  border-color: #fecdd3;
  color: #9f1239;
}

.state-erro .stateIcon { background: #ffe4e6; }

.state-info {
  background: #f8fafc;
  border-color: #e2e8f0;
  color: #334155;
}

.state-info .stateIcon { background: #e2e8f0; }

.validationResult {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
}

.validationResult span {
  color: #64748b;
  font-size: 11px;
}

.validationResult code {
  word-break: break-all;
  font-size: 12px;
}

.primaryLink {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-height: 42px;
  border-radius: 8px;
  background: #0d9488;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  padding: 10px 14px;
}

.primaryLink:hover { background: #0f766e; }

.validation {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  margin-top: 18px;
  font-size: 13px;
}

.validation span { color: #64748b; }

.validation code { word-break: break-all; }

.secureLine {
  text-align: center;
  color: #94a3b8;
  font-size: 10.5px;
  margin-top: 13px;
}

.loadingRow {
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #64748b;
  font-size: 13px;
}

.spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #cbd5e1;
  border-top-color: #0d9488;
  animation: girar .75s linear infinite;
}

@keyframes girar {
  to { transform: rotate(360deg); }
}

footer {
  padding: 18px;
  color: #64748b;
  text-align: center;
  font-size: 11px;
}

@media (max-width: 520px) {
  .page {
    display: block;
    padding: 18px 12px;
  }

  .brandLogo { height: 42px; }

  .brandText strong { font-size: 15px; }

  .card { padding: 24px 20px; }

  .docRow {
    display: grid;
    gap: 3px;
  }

  .docRow b { text-align: left; }

  .validation { grid-template-columns: 1fr; }
}
'@

Set-Content $cssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Arquivos alterados:" -ForegroundColor Green
Write-Host "  backend/routes/assinaturas.js"
Write-Host "  assinatura-site/src/App.jsx"
Write-Host "  assinatura-site/src/style.css"
Write-Host ""
Write-Host "Nenhum arquivo dentro de frontend/ foi alterado." -ForegroundColor Green

# Valida o build do portal.
Push-Location (Join-Path $repoPath "assinatura-site")
try {
  Write-Host ""
  Write-Host "Testando build do portal..." -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "O build do assinatura-site falhou. Não faça push antes de corrigir."
  }
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Build OK. Confira agora:" -ForegroundColor Green
Push-Location $repoPath
try {
  git status --short
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "IMPORTANTE: no Railway production altere ASSINATURA_TOKEN_MINUTOS para 60." -ForegroundColor Yellow
Write-Host "Depois, se o git status estiver correto, faça commit/push." -ForegroundColor Yellow
