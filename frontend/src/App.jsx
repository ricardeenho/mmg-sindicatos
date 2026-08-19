import { useState, useEffect, useMemo } from "react";
import Importar from "./Importar.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

const GRUPOS = {
  ativos:      "Ativos",
  obrigados:   "Obrigados ao rodízio",
  precisam:    "Precisam rodar",
  em_dia:      "Em dia",
  cadastrados: "Cadastrados",
  safristas:   "Safristas",
  isentos:     "Isentos",
};

async function pedir(caminho, token) {
  const r = await fetch(API + caminho, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json()).error || "Falha na consulta");
  return r.json();
}
async function gravar(caminho, token, corpo, metodo = "PUT") {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error((await r.json()).error || "Falha ao gravar");
  return r.json();
}

/* ------------------------------------------------------------------ */
function Login({ aoEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar() {
    setErro(""); setCarregando(true);
    try {
      const r = await fetch(API + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha }),
      });
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.error);
      localStorage.setItem("token", dados.token);
      aoEntrar(dados.token);
    } catch (e) { setErro(e.message); } finally { setCarregando(false); }
  }

  return (
    <div className="min-h-screen bg-slate-900 grid place-items-center px-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-10 h-10 rounded-xl bg-teal-500 grid place-items-center text-white font-bold">M+</span>
          <div>
            <h1 className="font-semibold text-slate-900">MMG Sindicatos</h1>
            <p className="text-xs text-slate-500">Módulo Rodízio</p>
          </div>
        </div>
        <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-2"
          placeholder="Usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()} />
        <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-4"
          placeholder="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()} />
        {erro && <p className="text-[12px] text-rose-600 mb-3">{erro}</p>}
        <button onClick={entrar} disabled={carregando}
          className="w-full bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const Cartao = ({ rotulo, valor, sub, cor = "text-slate-900", aoClicar }) => (
  <button onClick={aoClicar} disabled={!aoClicar}
    className={`text-left bg-white rounded-xl border border-slate-200 p-4 w-full transition ${
      aoClicar ? "hover:border-slate-400 hover:shadow-sm cursor-pointer" : "cursor-default"}`}>
    <p className="text-xs text-slate-500">{rotulo}</p>
    <p className={`text-3xl font-semibold mt-1 tabular-nums ${cor}`}>{valor}</p>
    {sub && <p className="text-[11px] text-slate-500 mt-1 leading-tight">{sub}</p>}
    {aoClicar && <p className="text-[10px] text-teal-600 mt-1.5">ver a lista →</p>}
  </button>
);

const Busca = ({ valor, aoMudar, dica }) => (
  <input value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={dica}
    className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] w-full sm:w-64" />
);

function Curva({ dados, primeiro, ultimo }) {
  if (!dados?.length) return null;
  const max = Math.max(...dados.map((d) => d.pessoas));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-medium">Efetivo por mês</p>
      <p className="text-[11px] text-slate-500 mt-1 mb-3">
        Todo o histórico apurado, de {primeiro} a {ultimo}. Âmbar é safra pelo calendário do
        sindicato; verde é entressafra, quando o rodízio pode acontecer.
      </p>
      <div className="flex items-end gap-[2px] h-32">
        {dados.map((d) => (
          <div key={d.competencia} className="flex-1 group relative">
            <div className={`w-full rounded-sm ${d.em_safra ? "bg-amber-400" : "bg-teal-500"}`}
                 style={{ height: `${Math.max(3, (d.pessoas / max) * 124)}px` }} />
            <span className="hidden group-hover:block absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
              {d.competencia}: {d.pessoas}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1">
        {dados.map((d) => {
          const [ano, mes] = d.competencia.split("-");
          const m = parseInt(mes) - 1;
          return (
            <span key={d.competencia} className="flex-1 text-center text-[7.5px] text-slate-400 leading-tight">
              {MESES[m]}
              {m === 0 && <span className="block text-[7px] text-slate-600 font-semibold">{ano}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
function Ficha({ token, codigo, aoFechar }) {
  const [t, setT] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setT(null); setErro("");
    pedir(`/painel/trabalhador/${codigo}`, token).then(setT).catch((e) => setErro(e.message));
  }, [codigo, token]);

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-30 flex items-start justify-center p-4 overflow-y-auto"
         onClick={aoFechar}>
      <div className="bg-white rounded-xl w-full max-w-2xl mt-10 mb-10" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold">{t?.nome || `Código ${codigo}`}</p>
            <p className="text-[11px] text-slate-500">{codigo}{t?.local_base ? ` · base em ${t.local_base}` : ""}</p>
          </div>
          <button onClick={aoFechar} className="text-slate-400 text-lg leading-none">×</button>
        </div>

        {erro && <p className="p-5 text-sm text-rose-600">{erro}</p>}
        {!t && !erro && <p className="p-5 text-sm text-slate-400">Carregando…</p>}

        {t && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[["Dias na janela", t.dias], ["Entressafra", t.dias_entressafra],
                ["Dias fora da base", t.dias_fora], ["Meta", t.meta]].map(([r, v]) => (
                <div key={r} className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10.5px] text-slate-500">{r}</p>
                  <p className="text-xl font-semibold tabular-nums">{v}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 flex-wrap text-[11px]">
              <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">{t.situacao}</span>
              <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">{t.perfil}</span>
              <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
                {Math.round(t.pct_no_local_base)}% no local-base
              </span>
              {t.falta > 0 && (
                <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">
                  faltam {t.falta} dias
                </span>
              )}
            </div>

            <div>
              <p className="text-[13px] font-medium mb-2">
                Por onde passou · {t.historico?.length || 0} setores em todo o histórico
              </p>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Local</th>
                      <th className="text-left px-3 py-2">Setor</th>
                      <th className="text-right px-3 py-2">Dias</th>
                      <th className="text-left px-3 py-2">Período</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(t.historico || []).map((h, i) => (
                      <tr key={i} className={`border-t border-slate-50 ${
                        h.local === t.local_base ? "bg-slate-50" : ""}`}>
                        <td className="px-3 py-2">
                          {h.local}
                          {h.local === t.local_base && (
                            <span className="ml-1 text-[10px] text-slate-400">base</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{h.setor} · {h.unidade}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{h.dias}</td>
                        <td className="px-3 py-2 text-slate-500 text-[11px]">
                          {new Date(h.primeiro).toLocaleDateString("pt-BR")} a{" "}
                          {new Date(h.ultimo).toLocaleDateString("pt-BR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Este histórico é de todo o arquivo, não só da janela de 12 meses.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Lista({ token, grupo, locais, aoVoltar, diasPorMes, aoAbrirFicha }) {
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [local, setLocal] = useState("");

  useEffect(() => {
    setLinhas(null); setErro("");
    pedir(`/painel/trabalhadores?grupo=${grupo}`, token).then(setLinhas).catch((e) => setErro(e.message));
  }, [grupo, token]);

  const filtradas = useMemo(() => {
    if (!linhas) return [];
    const t = busca.trim().toLowerCase();
    return linhas.filter((x) =>
      (!t || (x.nome || "").toLowerCase().includes(t) || x.codigo.includes(t)) &&
      (!local || x.local_base === local)
    );
  }, [linhas, busca, local]);

  if (erro) return <p className="text-sm text-rose-600">{erro}</p>;
  if (!linhas) return <p className="text-sm text-slate-400">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={aoVoltar} className="text-[13px] text-slate-600 underline">← Painel</button>
        <span className="text-sm font-medium">{GRUPOS[grupo]}</span>
        <Busca valor={busca} aoMudar={setBusca} dica="Buscar nome ou código…" />
        <select value={local} onChange={(e) => setLocal(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
          <option value="">Todos os locais</option>
          {locais.map((l) => <option key={l.local_base} value={l.local_base}>{l.local_base}</option>)}
        </select>
        <span className="text-[12px] text-slate-500">{filtradas.length} de {linhas.length}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Código</th>
                <th className="text-left px-3 py-2">Nome</th>
                <th className="text-left px-3 py-2">Local-base</th>
                <th className="text-left px-3 py-2">Situação</th>
                <th className="text-right px-3 py-2">Dias</th>
                <th className="text-right px-3 py-2">Entressafra</th>
                <th className="text-right px-3 py-2">Fora</th>
                <th className="text-right px-3 py-2">Meta</th>
                <th className="text-right px-3 py-2">Falta</th>
                <th className="text-right px-3 py-2">Semanas</th>
                <th className="text-right px-3 py-2">% no local</th>
                <th className="text-left px-3 py-2">Último dia</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((t) => (
                <tr key={t.codigo} onClick={() => aoAbrirFicha(t.codigo)}
                    className="border-t border-slate-50 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2 font-medium">{t.codigo}</td>
                  <td className="px-3 py-2">
                    {t.nome || <span className="text-amber-700 text-[11px]">sem cadastro no MMG+</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{t.local_base}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                      t.situacao === "Em dia" ? "bg-emerald-50 text-emerald-700"
                      : t.situacao === "Precisa rodar" ? "bg-amber-50 text-amber-700"
                      : t.situacao === "Safrista" ? "bg-sky-50 text-sky-700"
                      : "bg-slate-100 text-slate-600"}`}>{t.situacao}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.dias}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_entressafra}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_fora}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.meta}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                    t.falta > 0 ? "text-amber-600" : "text-emerald-600"}`}>{t.falta}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.semanas}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.pct_no_local_base}%</td>
                  <td className="px-3 py-2 text-slate-500">
                    {t.ultimo_dia && new Date(t.ultimo_dia).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Semanas = dias que faltam divididos por {diasPorMes}, a permanência máxima fora da base por mês.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Safra({ token }) {
  const [dados, setDados] = useState(null);
  const [meses, setMeses] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    pedir("/painel/safra", token).then((d) => {
      setDados(d); setMeses(d.meses.filter((m) => m.em_safra).map((m) => m.mes));
    });
  }, [token]);

  if (!dados) return <p className="text-sm text-slate-400">Carregando…</p>;

  const alternar = (m) =>
    setMeses((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m].sort((a, b) => a - b)));

  async function salvar() {
    setSalvando(true); setAviso("");
    try {
      await gravar("/painel/safra", token, { meses });
      setDados(await pedir("/painel/safra", token));
      setAviso("Calendário gravado. Recarregue o painel para ver o efeito nos números.");
    } catch (e) { setAviso(e.message); } finally { setSalvando(false); }
  }

  const max = Math.max(...dados.meses.map((m) => m.media_pessoas));
  const divergentes = dados.meses.filter((m) => meses.includes(m.mes) !== m.acima_da_media);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Janelas de safra e entressafra</p>
        <p className="text-[11px] text-slate-500 mt-1">
          Marque os meses de safra do sindicato. O rodízio só é exigido nos meses não marcados.
          A barra mostra o efetivo médio de cada mês — é a curva do seu próprio Ponto, e serve
          para conferir se o declarado bate com o que acontece.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-6 md:grid-cols-12 gap-1.5 mb-4">
          {dados.meses.map((m) => {
            const marcado = meses.includes(m.mes);
            const diverge = marcado !== m.acima_da_media;
            return (
              <button key={m.mes} onClick={() => alternar(m.mes)}
                className={`rounded-lg py-2 text-[12px] font-medium border ${
                  marcado ? "bg-amber-400 border-amber-500 text-amber-950"
                          : "bg-teal-50 border-teal-200 text-teal-800"}`}>
                {MESES[m.mes - 1]}
                {diverge && <span className="block text-[9px] text-rose-600">confira</span>}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-500 mb-2">
          Efetivo médio por mês · média geral {dados.media} pessoas
        </p>
        <div className="flex items-end gap-1 h-24">
          {dados.meses.map((m) => (
            <div key={m.mes} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full rounded-sm ${meses.includes(m.mes) ? "bg-amber-400" : "bg-teal-500"}`}
                   style={{ height: `${Math.max(3, (m.media_pessoas / max) * 76)}px` }} />
              <span className="text-[9px] text-slate-400">{m.media_pessoas}</span>
            </div>
          ))}
        </div>

        {divergentes.length > 0 && (
          <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-[12px] font-medium text-rose-800">
              {divergentes.length} {divergentes.length === 1 ? "mês diverge" : "meses divergem"} da curva
            </p>
            <p className="text-[11px] text-rose-700 mt-1">
              {divergentes.map((m) => MESES[m.mes - 1]).join(", ")} — o marcado não bate com o movimento
              observado. Não é erro por si só, mas é o primeiro ponto que um fiscal vai olhar.
            </p>
          </div>
        )}

        <button onClick={salvar} disabled={salvando}
          className="w-full mt-4 bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
          {salvando ? "Gravando…" : "Gravar calendário"}
        </button>
        {aviso && <p className="text-[12px] text-slate-600 mt-2 text-center">{aviso}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Painel({ token, sair }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("painel");
  const [grupo, setGrupo] = useState(null);
  const [ficha, setFicha] = useState(null);
  const [buscaFila, setBuscaFila] = useState("");
  const [filtroLocal, setFiltroLocal] = useState("");
  const [soSemNivel1, setSoSemNivel1] = useState(false);
  const [buscaLocal, setBuscaLocal] = useState("");

  useEffect(() => {
    Promise.all([
      pedir("/painel/resumo", token),
      pedir("/painel/curva", token),
      pedir("/painel/locais", token),
      pedir("/painel/fila", token),
      pedir("/painel/sem-cadastro", token),
      pedir("/painel/safristas-fixos", token),
    ])
      .then(([resumo, curva, locais, fila, semCadastro, safristas]) =>
        setD({ resumo, curva, locais, fila, semCadastro, safristas }))
      .catch((e) => setErro(e.message));
  }, [token]);

  const filaFiltrada = useMemo(() => {
    if (!d) return [];
    const t = buscaFila.trim().toLowerCase();
    return d.fila.filter((x) =>
      (!t || (x.nome || "").toLowerCase().includes(t) || x.codigo.includes(t)) &&
      (!filtroLocal || x.local_base === filtroLocal) &&
      (!soSemNivel1 || !x.tem_nivel_1)
    );
  }, [d, buscaFila, filtroLocal, soSemNivel1]);

  const locaisFiltrados = useMemo(() => {
    if (!d) return [];
    const t = buscaLocal.trim().toLowerCase();
    return d.locais.filter((l) => !t || l.local_base.toLowerCase().includes(t));
  }, [d, buscaLocal]);

  function abrirGrupo(g) { setGrupo(g); setAba("lista"); }

  if (erro) return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="text-center">
        <p className="text-rose-600 text-sm mb-3">{erro}</p>
        <button onClick={sair} className="text-sm text-slate-600 underline">Entrar de novo</button>
      </div>
    </div>
  );
  if (!d) return <div className="min-h-screen grid place-items-center text-slate-400 text-sm">Carregando…</div>;

  const { resumo, curva, locais, fila, semCadastro, safristas } = d;
  const j = resumo.janela, a = resumo.ativos, r = resumo.regras;
  const semNivel1 = resumo.fixos.pessoas - resumo.fixos.com_nivel_1;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-slate-900 text-white px-4 py-3 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-teal-500 grid place-items-center text-sm font-bold">M+</span>
          <div className="flex-1">
            <h1 className="text-sm font-semibold leading-tight">Rodízio</h1>
            <p className="text-[11px] text-slate-400 leading-tight">
              Janela de {new Date(j.janela_inicio).toLocaleDateString("pt-BR")} a{" "}
              {new Date(j.janela_fim).toLocaleDateString("pt-BR")} · {j.percentual}% da entressafra
            </p>
          </div>
          <button onClick={sair} className="text-[11px] text-slate-400 hover:text-white">Sair</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-1.5 flex-wrap">
          {[["painel","Painel"],["safra","Safra"],["locais","Locais"],["fila","Fila"],
            ["safristas","Safristas fixos"],["cadastro","Sem cadastro"],["importar","Importar"]].map(([k, rot]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium ${
                aba === k ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
              {rot}
              {k === "cadastro" && semCadastro.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-amber-400 text-amber-950 rounded px-1">{semCadastro.length}</span>
              )}
              {k === "safristas" && safristas.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-sky-400 text-sky-950 rounded px-1">{safristas.length}</span>
              )}
            </button>
          ))}
        </div>

        {ficha && <Ficha token={token} codigo={ficha} aoFechar={() => setFicha(null)} />}

        {aba === "lista" && (
          <Lista token={token} grupo={grupo} locais={locais} aoAbrirFicha={setFicha}
                 aoVoltar={() => setAba("painel")} diasPorMes={r.dias_por_mes} />
        )}

        {aba === "painel" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Cartao rotulo="Ativos" valor={a.ativos} aoClicar={() => abrirGrupo("ativos")}
                      sub={`com movimento nos últimos ${r.dias_ativo} dias`} />
              <Cartao rotulo="Obrigados" valor={a.obrigados} aoClicar={() => abrirGrupo("obrigados")}
                      sub={`${j.isencao_dias}+ dias trabalhados na entressafra`} />
              <Cartao rotulo="Precisam rodar" valor={a.precisam} cor="text-amber-600"
                      aoClicar={() => abrirGrupo("precisam")}
                      sub={`meta não cumprida · ${a.dias_a_cumprir} dias-pessoa`} />
              <Cartao rotulo="Em dia" valor={a.em_dia} cor="text-emerald-600"
                      aoClicar={() => abrirGrupo("em_dia")} sub="já cumprem sem intervenção" />
              <Cartao rotulo="Cadastrados" valor={resumo.base.cadastrados}
                      aoClicar={() => abrirGrupo("cadastrados")}
                      sub={`${resumo.base.locais} locais · ${resumo.base.unidades} unidades`} />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[13px] font-medium mb-2">Como cada número é apurado</p>
              <ul className="text-[11.5px] text-slate-600 space-y-1 leading-relaxed">
                <li><b>Ativos</b> — trabalharam ao menos um dia nos últimos {r.dias_ativo} dias. Só eles entram no rodízio.</li>
                <li><b>Obrigados</b> — dos ativos, os que somam {j.isencao_dias} dias ou mais trabalhados nos meses de entressafra da janela. Abaixo disso, isento.</li>
                <li><b>Precisam rodar</b> — obrigados cuja meta ainda não foi cumprida. A meta é {j.percentual}% dos dias de entressafra de cada um, com teto de {j.teto_dias}.</li>
                <li><b>Em dia</b> — obrigados que já acumularam dias fora da unidade-base suficientes.</li>
              </ul>
              <p className="text-[11px] text-teal-700 mt-2">Clique em qualquer cartão para ver quem são.</p>
            </div>

            <Curva dados={curva} primeiro={resumo.base.primeiro_mes} ultimo={resumo.base.ultimo_mes} />

            <div className="bg-slate-900 text-white rounded-xl p-4">
              <p className="text-[13px] font-medium text-teal-300">Fila de regularização</p>
              <p className="text-[12.5px] mt-2 leading-relaxed text-slate-200">
                <b className="text-white">{resumo.fixos.pessoas} pessoas</b> ativas passaram 95% ou mais
                dos dias no mesmo local e estão obrigadas ao rodízio. Somam{" "}
                <b className="text-white">{resumo.fixos.dias_a_cumprir} dias-pessoa</b>, o que dá{" "}
                <b className="text-white">{resumo.fixos.semanas} semanas de rodízio</b> na regra de no
                máximo {r.dias_por_mes} dias por mês.
              </p>
              <p className="text-[12px] mt-3 text-slate-300 leading-relaxed">
                <b className="text-amber-300">{resumo.fixos.com_nivel_1}</b> resolvem trocando de setor no
                próprio local, sem transporte. <b className="text-amber-300">{semNivel1}</b> precisam sair
                do local — e é aí que entra a logística de carro.
              </p>
            </div>
          </>
        )}

        {aba === "importar" && <Importar token={token} />}
        {aba === "safra" && <Safra token={token} />}

        {aba === "locais" && (
          <>
            <div className="flex gap-2 items-center flex-wrap">
              <Busca valor={buscaLocal} aoMudar={setBuscaLocal} dica="Buscar local…" />
              <span className="text-[12px] text-slate-500">{locaisFiltrados.length} de {locais.length}</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {locaisFiltrados.map((l) => (
                <div key={l.local_base} className="px-4 py-3 border-b border-slate-50 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{l.local_base}</p>
                    <p className="text-[11px] text-slate-500">
                      {l.setores} {l.setores === 1 ? "setor" : "setores"}
                      {l.setores === 1 && <span className="text-rose-600"> · precisa sair do local</span>}
                      {" · "}{l.semanas} semanas de rodízio
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{l.pessoas}</p>
                    <p className="text-[11px] text-slate-400">{l.dias_a_cumprir} dias</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              O filtro por Sede e Filial ainda não é possível: o arquivo do Ponto não traz essa
              informação. Ela precisa vir do cadastro de unidades tomadoras.
            </p>
          </>
        )}

        {aba === "fila" && (
          <>
            <div className="flex gap-2 items-center flex-wrap">
              <Busca valor={buscaFila} aoMudar={setBuscaFila} dica="Buscar nome ou código…" />
              <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
                <option value="">Todos os locais</option>
                {locais.map((l) => <option key={l.local_base} value={l.local_base}>{l.local_base}</option>)}
              </select>
              <button onClick={() => setSoSemNivel1((v) => !v)}
                className={`px-3 py-2 rounded-lg text-[13px] border ${
                  soSemNivel1 ? "bg-rose-600 text-white border-rose-600"
                              : "bg-white text-slate-600 border-slate-200"}`}>
                Só quem precisa de transporte
              </button>
              <span className="text-[12px] text-slate-500">{filaFiltrada.length} de {fila.length}</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Código</th>
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Local</th>
                      <th className="text-right px-3 py-2">Dias</th>
                      <th className="text-right px-3 py-2">Entressafra</th>
                      <th className="text-right px-3 py-2">Fora</th>
                      <th className="text-right px-3 py-2">Meta</th>
                      <th className="text-right px-3 py-2">Falta</th>
                      <th className="text-right px-3 py-2">Semanas</th>
                      <th className="text-left px-3 py-2">Como rodar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filaFiltrada.map((t) => (
                      <tr key={t.codigo} onClick={() => setFicha(t.codigo)}
                        className="border-t border-slate-50 hover:bg-slate-50 cursor-pointer">
                        <td className="px-3 py-2 font-medium">{t.codigo}</td>
                        <td className="px-3 py-2">
                          {t.nome || <span className="text-amber-700 text-[11px]">sem cadastro no MMG+</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{t.local_base}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.dias}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_entressafra}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_fora}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.meta}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                          t.falta > 0 ? "text-amber-600" : "text-emerald-600"}`}>{t.falta}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.semanas}</td>
                        <td className="px-3 py-2">
                          {t.tem_nivel_1
                            ? <span className="text-teal-700 text-[11px]">outro setor, sem transporte</span>
                            : <span className="text-rose-700 text-[11px]">precisa sair do local</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {aba === "safristas" && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium">{safristas.length} safristas fixos há 2 anos ou mais</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Não têm obrigação de rodízio, porque não atravessam a entressafra. Mas voltam sempre
                para o mesmo local, safra após safra — e isso constrói habitualidade do mesmo jeito,
                só que sazonal. Vale o gestor avaliar a troca.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Código</th>
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Local</th>
                      <th className="text-right px-3 py-2">Dias</th>
                      <th className="text-right px-3 py-2">Meses de vínculo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safristas.map((t) => (
                      <tr key={t.codigo} className="border-t border-slate-50">
                        <td className="px-3 py-2 font-medium">{t.codigo}</td>
                        <td className="px-3 py-2">{t.nome || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{t.local}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.dias}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.meses_vinculo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {aba === "cadastro" && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium">{semCadastro.length} sem cadastro no MMG+</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Trabalharam e aparecem no Ponto, mas não têm cadastro no MMG+. O nome não se edita
                aqui de propósito: a fonte é o MMG+. Cadastre lá e o nome entra na próxima carga.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Código</th>
                      <th className="text-right px-3 py-2">Dias trabalhados</th>
                      <th className="text-left px-3 py-2">Primeiro dia</th>
                      <th className="text-left px-3 py-2">Último dia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semCadastro.map((t) => (
                      <tr key={t.codigo} className="border-t border-slate-50">
                        <td className="px-3 py-2 font-medium">{t.codigo}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.dias}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {t.primeiro_dia && new Date(t.primeiro_dia).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {t.ultimo_dia && new Date(t.ultimo_dia).toLocaleDateString("pt-BR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <p className="text-[11px] text-slate-400 text-center pt-2">
          Meia diária conta como um dia. Um dia de rodízio por data, no máximo.
          Cada bloco de rodízio vai de segunda a sábado, com no máximo {r.dias_por_mes} dias por mês.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  function sair() { localStorage.removeItem("token"); setToken(null); }
  return token ? <Painel token={token} sair={sair} /> : <Login aoEntrar={setToken} />;
}
