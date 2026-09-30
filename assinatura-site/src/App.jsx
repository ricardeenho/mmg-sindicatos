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

