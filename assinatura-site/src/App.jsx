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
async function json(url, options = {}) {
  const r = await fetch(`${API}${url}`, options);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
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
      <div className="brandMark">M</div>
      <div><strong>MMG</strong><span>Assinaturas</span></div>
    </div>
  );
}
function Card({ children }) { return <main className="card">{children}</main>; }

function Login({ onLogin, destino }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro(''); setCarregando(true);
    try {
      const d = await json('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, senha }),
      });
      localStorage.setItem(STORAGE, d.token);
      onLogin(d.token);
    } catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }

  return <Card>
    <div className="eyebrow">ACESSO DO ASSINANTE</div>
    <h1>Entre para assinar</h1>
    <p className="muted">Use sua conta de gerente vinculada à unidade desta requisição{destino ? ` (${destino})` : ''}.</p>
    <form onSubmit={entrar} className="form">
      <label>Usuário<input autoFocus value={usuario} onChange={e => setUsuario(e.target.value)} autoComplete="username" /></label>
      <label>Senha<input type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="current-password" /></label>
      {erro && <div className="error">{erro}</div>}
      <button disabled={carregando || !usuario || !senha}>{carregando ? 'Entrando…' : 'Continuar'}</button>
    </form>
  </Card>;
}

function Documento({ d }) {
  if (!d) return null;
  return <section className="doc">
    <div className="docRow"><span>Requisição</span><b>{String(d.requisicao_id || '').slice(0,8).toUpperCase()}</b></div>
    <div className="docRow"><span>Unidade</span><b>{d.unidade_codigo || ''} {d.unidade_nome ? `· ${d.unidade_nome}` : ''}</b></div>
    <div className="docRow"><span>Período</span><b>{fmtData(d.previsao_inicio)} a {fmtData(d.previsao_fim)}</b></div>
    <div className="docRow"><span>Quantidade</span><b>{d.quantidade ?? '—'}</b></div>
    {d.turno && <div className="docRow"><span>Turno</span><b>{d.turno}</b></div>}
    {d.solicitante_nome && <div className="docRow"><span>Solicitante</span><b>{d.solicitante_nome}</b></div>}
    {(d.funcoes || []).length > 0 && <div className="funcoes">{d.funcoes.map((f,i)=><span key={i}>{f.quantidade}× {f.nome || f.funcao}</span>)}</div>}
  </section>;
}

function Assinatura({ id, tokenSecreto, jwt, logout }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [assinando, setAssinando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    setErro('');
    json(`/assinaturas/${encodeURIComponent(id)}`, { headers: authHeaders(jwt) })
      .then(setDados)
      .catch(e => setErro(e.message));
  }, [id, jwt]);

  async function assinar() {
    setAssinando(true); setErro('');
    try {
      const d = await json(`/assinaturas/${encodeURIComponent(id)}/assinar`, {
        method: 'POST', headers: authHeaders(jwt, true),
        body: JSON.stringify({ token: tokenSecreto }),
      });
      setResultado(d);
      setDados(v => ({ ...v, status: 'assinada', assinada_em: d.assinada_em, validation_code: d.validation_code }));
    } catch (e) { setErro(e.message); }
    finally { setAssinando(false); }
  }

  if (erro && !dados) return <Card><div className="error">{erro}</div><button className="secondary" onClick={logout}>Entrar com outro usuário</button></Card>;
  if (!dados) return <Card><p>Carregando requisição…</p></Card>;
  const concluida = resultado || dados.status === 'assinada';
  return <Card>
    <div className="eyebrow">ASSINATURA DE REQUISIÇÃO</div>
    <h1>{concluida ? 'Assinatura concluída' : 'Confira antes de assinar'}</h1>
    <p className="muted">Assinatura destinada a <strong>{dados.assinante_nome}</strong>{dados.assinante_usuario ? ` (@${dados.assinante_usuario})` : ''}.</p>
    <Documento d={resultado?.documento || dados.documento} />
    {!concluida && <div className="notice">Ao confirmar, você declara que conferiu os dados acima. O token é de uso único.</div>}
    {erro && <div className="error">{erro}</div>}
    {!concluida && dados.status === 'pendente' && <>
      <div className="expires">Válido até {fmtDataHora(dados.expira_em)}</div>
      <button onClick={assinar} disabled={assinando}>{assinando ? 'Assinando…' : 'Confirmar e assinar'}</button>
    </>}
    {concluida && <div className="success">
      <b>✓ Requisição assinada com sucesso</b>
      <span>Em {fmtDataHora(resultado?.assinada_em || dados.assinada_em)}</span>
      {(resultado?.validation_code || dados.validation_code) && <a href={`/?validar=${encodeURIComponent(resultado?.validation_code || dados.validation_code)}`}>Validar assinatura</a>}
    </div>}
    {!concluida && dados.status !== 'pendente' && <div className="notice">Status atual: <b>{dados.status}</b>. Solicite um novo QR se necessário.</div>}
    <button className="linkButton" onClick={logout}>Sair</button>
  </Card>;
}

function Validacao({ codigo }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { json(`/assinaturas/validar/${encodeURIComponent(codigo)}`).then(setDados).catch(e=>setErro(e.message)); }, [codigo]);
  return <Card>
    <div className="eyebrow">VALIDAÇÃO PÚBLICA</div>
    <h1>Validar assinatura</h1>
    {!dados && !erro && <p>Verificando…</p>}
    {erro && <div className="error">{erro}</div>}
    {dados && <>
      <div className={dados.valido ? 'success' : 'error'}><b>{dados.valido ? '✓ Assinatura válida e documento íntegro' : '✕ Documento alterado ou inválido'}</b></div>
      <Documento d={dados.documento} />
      <div className="validation"><span>Assinado por</span><b>{dados.assinante?.nome}</b><span>Data</span><b>{fmtDataHora(dados.assinadaEm)}</b><span>Código</span><code>{dados.codigo}</code></div>
    </>}
  </Card>;
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const hash = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, '')), []);
  const assinaturaId = params.get('assinar');
  const tokenSecreto = hash.get('st') || params.get('st');
  const validar = params.get('validar');
  const [jwt, setJwt] = useState(() => localStorage.getItem(STORAGE) || '');
  const logout = () => { localStorage.removeItem(STORAGE); setJwt(''); };

  return <div className="page"><div className="shell"><Logo />
    {validar ? <Validacao codigo={validar} /> :
      assinaturaId && tokenSecreto ? (jwt ? <Assinatura id={assinaturaId} tokenSecreto={tokenSecreto} jwt={jwt} logout={logout} /> : <Login onLogin={setJwt} />) :
      <Card><div className="eyebrow">MMG ASSINATURAS</div><h1>Abra o QR enviado pela MMG</h1><p className="muted">Este portal é exclusivo para gerentes confirmarem e validarem requisições das unidades pelas quais são responsáveis.</p></Card>}
    <footer>MMG · ambiente de assinatura</footer>
  </div></div>;
}
