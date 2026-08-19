import { useState, useEffect, useMemo, useCallback } from "react";
import Importar from "./Importar.jsx";
import Requisicao, { Requisicoes } from "./Requisicao.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
// O ciclo agraria comeca em dezembro: dependendo do ano a safra ja abre nele.
const CICLO = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

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

const dataBR = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");

/* O perfil vem dentro do proprio token, entao sobrevive a recarga da
   pagina sem precisar guardar nada a mais. */
function lerToken(t) {
  try {
    return JSON.parse(
      atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
  } catch (e) { return null; }
}

/* Como esta pessoa pode rodar, na ordem do mais barato para o mais caro. */
function comoRodar(t) {
  if (t.tem_nivel_1) return { texto: "outro setor, no mesmo local", cor: "text-teal-700", nivel: 1 };
  if (t.setores_no_local > 1 && t.locais_mesma_cidade > 0)
    return { texto: "outro local, mesma cidade (setor vizinho parado)", cor: "text-sky-700", nivel: 2 };
  if (t.locais_mesma_cidade > 0) return { texto: "outro local, mesma cidade", cor: "text-sky-700", nivel: 2 };
  if (t.km_mais_proximo != null) {
    return {
      texto: `outro local, ~${Math.round(t.km_mais_proximo)} km${t.ponto_aproximado ? " (aprox.)" : ""}`,
      cor: "text-amber-700", nivel: 3,
    };
  }
  return { texto: "sem destino conhecido", cor: "text-rose-700", nivel: 9 };
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
        <div className="mb-6">
          <img src="/logo-mmg.png" alt="MMG · Movimentação de Mercadorias em Geral"
               className="h-12 w-auto mb-3" />
          <h1 className="font-semibold text-slate-900">MMG Sindicatos</h1>
          <p className="text-xs text-slate-500">Módulo Rodízio</p>
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
                      <th className="text-left px-3 py-2">Cidade</th>
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
                        <td className="px-3 py-2 text-slate-500">{h.cidade || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{h.setor} · {h.unidade}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{h.dias}</td>
                        <td className="px-3 py-2 text-slate-500 text-[11px]">
                          {dataBR(h.primeiro)} a {dataBR(h.ultimo)}
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
                  <td className="px-3 py-2 text-slate-500">{dataBR(t.ultimo_dia)}</td>
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
function Safra({ token, aoAtualizar, podeEditar }) {
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
      if (aoAtualizar) await aoAtualizar();
      setAviso("Calendário gravado, relógio recalculado e painel atualizado.");
    } catch (e) { setAviso(e.message); } finally { setSalvando(false); }
  }

  const max = Math.max(...dados.meses.map((m) => m.media_pessoas), 1);
  const ciclo = CICLO.map((n) => dados.meses.find((m) => m.mes === n)).filter(Boolean);
  const eco = ciclo[0]; // dezembro repetido no fim, so para mostrar que o ciclo fecha
  const maxRec = Math.max(...(dados.recente || []).map((m) => m.pessoas), 1);
  const divergentes = dados.meses.filter((m) => meses.includes(m.mes) !== m.acima_da_media);
  const r = dados.restantes || { meses: 0, dias: 0, horizonte: 6 };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Janelas de safra e entressafra</p>
        <p className="text-[11px] text-slate-500 mt-1">
          Marque os meses de safra do sindicato. O rodízio só é exigido nos meses não marcados.
          Os dois gráficos abaixo servem a perguntas diferentes: o primeiro mostra como é um mês
          típico em todos os anos do arquivo, e é o que ajuda a declarar o calendário; o segundo
          mostra os últimos doze meses de verdade, e é onde uma safra curta aparece.
        </p>
      </div>

      {/* -------- calendário + gráfico do mês típico -------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-1.5 mb-4">
          {ciclo.map((m) => {
            const marcado = meses.includes(m.mes);
            const diverge = marcado !== m.acima_da_media;
            return (
              <button key={m.mes} onClick={() => alternar(m.mes)}
                className={`flex-1 min-w-[52px] rounded-lg py-2 text-[12px] font-medium border ${
                  marcado ? "bg-amber-400 border-amber-500 text-amber-950"
                          : "bg-teal-50 border-teal-200 text-teal-800"}`}>
                {MESES[m.mes - 1]}
                {diverge && <span className="block text-[9px] text-rose-600">confira</span>}
              </button>
            );
          })}
          {eco && (
            <div title="mesmo dezembro do começo — o ciclo fecha aqui"
              className={`flex-1 min-w-[52px] rounded-lg py-2 text-[12px] font-medium border border-dashed opacity-40 text-center ${
                meses.includes(eco.mes) ? "bg-amber-400 border-amber-500 text-amber-950"
                                        : "bg-teal-50 border-teal-200 text-teal-800"}`}>
              {MESES[eco.mes - 1]}
              <span className="block text-[9px]">repete</span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-500 mb-2">
          Mês típico · média de todos os anos do arquivo · média geral {dados.media} pessoas ·
          o ciclo começa em dezembro, porque dependendo do ano a safra já abre nele
        </p>
        <div className="flex items-end gap-1 h-24">
          {ciclo.map((m) => (
            <div key={m.mes} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full rounded-sm ${meses.includes(m.mes) ? "bg-amber-400" : "bg-teal-500"}`}
                   style={{ height: `${Math.max(3, (m.media_pessoas / max) * 76)}px` }} />
              <span className="text-[9px] text-slate-400">{m.media_pessoas}</span>
            </div>
          ))}
          {eco && (
            <div className="flex-1 flex flex-col items-center gap-1 opacity-30">
              <div className={`w-full rounded-sm ${meses.includes(eco.mes) ? "bg-amber-400" : "bg-teal-500"}`}
                   style={{ height: `${Math.max(3, (eco.media_pessoas / max) * 76)}px` }} />
              <span className="text-[9px] text-slate-400">{eco.media_pessoas}</span>
            </div>
          )}
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

        {podeEditar ? (
          <button onClick={salvar} disabled={salvando}
            className="w-full mt-4 bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {salvando ? "Gravando…" : "Gravar calendário"}
          </button>
        ) : (
          <p className="text-[11.5px] text-slate-500 mt-4 text-center">
            Seu acesso é de leitura — o calendário pode ser consultado, mas não alterado.
          </p>
        )}
        {aviso && <p className="text-[12px] text-slate-600 mt-2 text-center">{aviso}</p>}
      </div>

      {/* -------- os últimos 12 meses de verdade -------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Os últimos doze meses, de verdade</p>
        <p className="text-[11px] text-slate-500 mt-1 mb-3">
          Efetivo mês a mês, do que foi realmente apurado. É aqui que uma safra fraca fica visível:
          se a barra âmbar de um mês marcado como safra ficar baixa, aquela safra não aconteceu
          como o calendário previa — e a entressafra daquele ano foi maior do que se declarou.
        </p>
        <div className="flex items-end gap-1 h-28">
          {(dados.recente || []).map((m) => (
            <div key={m.competencia} className="flex-1 group relative flex flex-col items-center gap-1">
              <div className={`w-full rounded-sm ${m.em_safra ? "bg-amber-400" : "bg-teal-500"}`}
                   style={{ height: `${Math.max(3, (m.pessoas / maxRec) * 84)}px` }} />
              <span className="text-[9px] text-slate-400 tabular-nums">{m.pessoas}</span>
              <span className="hidden group-hover:block absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                {m.competencia}: {m.pessoas} pessoas
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          {(dados.recente || []).map((m) => (
            <span key={m.competencia} className="flex-1 text-center text-[8.5px] text-slate-400 leading-tight">
              {MESES[m.mes - 1]}
              {m.mes === 1 && <span className="block text-[7.5px] text-slate-600 font-semibold">{m.ano}</span>}
            </span>
          ))}
        </div>
      </div>

      {/* -------- o que vem pela frente -------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium">O que vem pela frente</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Os próximos {r.horizonte} meses pelo calendário declarado. Isto é previsão, não
              apuração — nenhum destes dias foi trabalhado ainda.
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums text-teal-700">{r.dias}</p>
            <p className="text-[11px] text-slate-500 leading-tight">
              dias de entressafra pela frente<br />em {r.meses} {r.meses === 1 ? "mês" : "meses"}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1.5 mt-4">
          {(dados.aFrente || []).map((m) => (
            <div key={m.competencia}
              className={`rounded-lg py-2 text-center border border-dashed ${
                m.em_safra ? "bg-amber-50 border-amber-300 text-amber-800"
                           : "bg-teal-50 border-teal-300 text-teal-800"}`}>
              <p className="text-[12px] font-medium">{MESES[m.mes - 1]}</p>
              <p className="text-[9px] opacity-70">{m.em_safra ? "safra" : `${m.dias} dias`}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function PontoDoLocal({ token, local, aoGravar, podeEditar }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(limpar = false) {
    setSalvando(true); setErro("");
    try {
      const p = await gravar(`/painel/local/${local.id}/ponto`, token, { texto: limpar ? "" : texto });
      aoGravar(p); setAberto(false); setTexto("");
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  const chip =
    local.fonte === "mapa"
      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">ponto exato</span>
      : local.fonte === "municipio"
      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">ponto do município</span>
      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">sem ponto</span>;

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2 flex-wrap">
        {chip}
        {podeEditar && (
          <button onClick={() => setAberto((v) => !v)} className="text-[10.5px] text-teal-700 underline">
            {aberto ? "fechar" : local.fonte === "mapa" ? "corrigir" : "definir no mapa"}
          </button>
        )}
        {local.fonte === "mapa" && (
          <span className="text-[10px] text-slate-400 tabular-nums">
            {Number(local.latitude).toFixed(4)}, {Number(local.longitude).toFixed(4)}
          </span>
        )}
      </div>

      {aberto && (
        <div className="mt-2 bg-slate-50 rounded-lg p-3">
          <p className="text-[11px] text-slate-600 leading-relaxed mb-2">
            No Google Maps, procure a unidade pelo nome. Clique com o <b>botão direito</b> sobre o
            pino — os números que aparecem no topo do menu são a coordenada, e clicar neles copia.
            Cole aqui. Link curto (maps.app.goo.gl) não serve: abra ele primeiro.
          </p>
          <div className="flex gap-2 flex-wrap">
            <input value={texto} onChange={(e) => setTexto(e.target.value)}
              placeholder="-24.9555, -53.4552"
              onKeyDown={(e) => e.key === "Enter" && salvar()}
              className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-[12px]" />
            <button onClick={() => salvar()} disabled={salvando}
              className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[12px] font-medium disabled:opacity-50">
              {salvando ? "…" : "Gravar"}
            </button>
            {local.fonte === "mapa" && (
              <button onClick={() => salvar(true)} disabled={salvando}
                className="border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-600">
                Limpar
              </button>
            )}
          </div>
          {erro && <p className="text-[11px] text-rose-600 mt-2 leading-relaxed">{erro}</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Usuarios({ token }) {
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [novo, setNovo] = useState({ nome: "", usuario: "", senha: "", perfil: "leitura" });
  const [salvando, setSalvando] = useState(false);

  const recarregar = () =>
    pedir("/auth/usuarios", token).then(setLinhas).catch((e) => setErro(e.message));

  useEffect(() => { recarregar(); }, [token]);

  async function criar() {
    setSalvando(true); setErro(""); setAviso("");
    try {
      await gravar("/auth/usuarios", token, novo, "POST");
      setAviso(`${novo.nome} criado. Passe a senha por um canal seguro e peça para trocar no primeiro acesso.`);
      setNovo({ nome: "", usuario: "", senha: "", perfil: "leitura" });
      await recarregar();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  async function mudar(id, corpo) {
    setErro(""); setAviso("");
    try {
      await gravar(`/auth/usuarios/${id}`, token, corpo, "PATCH");
      await recarregar();
    } catch (e) { setErro(e.message); }
  }

  const PERFIL_TEXTO = {
    admin: "mexe em usuários e em tudo",
    gestor: "grava calendário, regra e ponto",
    leitura: "só consulta",
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Quem tem acesso</p>
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
          Cada pessoa com o seu próprio acesso. Isso não é burocracia: quando a escala publicada
          existir, ela é o registro que a lei exige, e o valor dela como prova está em ter data,
          hora e autor. Escala assinada por "admin" vale menos numa fiscalização do que escala
          assinada por uma pessoa.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-[13px] font-medium mb-3">Novo acesso</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
            placeholder="Nome completo"
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
          <input value={novo.usuario} onChange={(e) => setNovo({ ...novo, usuario: e.target.value })}
            placeholder="Usuário para entrar"
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
          <input value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })}
            placeholder="Senha inicial (8 caracteres ou mais)"
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
          <select value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
            <option value="leitura">Leitura — só consulta</option>
            <option value="gestor">Gestor — grava calendário, regra e ponto</option>
            <option value="admin">Admin — mexe em usuários também</option>
          </select>
        </div>
        <button onClick={criar} disabled={salvando}
          className="mt-3 bg-teal-600 text-white rounded-lg px-4 py-2 text-[13px] font-medium disabled:opacity-50">
          {salvando ? "Criando…" : "Criar acesso"}
        </button>
        {erro && <p className="text-[12px] text-rose-600 mt-2">{erro}</p>}
        {aviso && <p className="text-[12px] text-emerald-700 mt-2">{aviso}</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Nome</th>
                <th className="text-left px-3 py-2">Usuário</th>
                <th className="text-left px-3 py-2">Perfil</th>
                <th className="text-left px-3 py-2">Último acesso</th>
                <th className="text-left px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {(linhas || []).map((u) => (
                <tr key={u.id} className={`border-t border-slate-50 ${u.ativo ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2 font-medium">{u.nome}</td>
                  <td className="px-3 py-2 text-slate-600">{u.usuario}</td>
                  <td className="px-3 py-2">
                    <select value={u.perfil} onChange={(e) => mudar(u.id, { perfil: e.target.value })}
                      className="border border-slate-200 rounded px-2 py-1 text-[11.5px]">
                      <option value="leitura">leitura</option>
                      <option value="gestor">gestor</option>
                      <option value="admin">admin</option>
                    </select>
                    <span className="block text-[10px] text-slate-400 mt-0.5">{PERFIL_TEXTO[u.perfil]}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {u.ultimo_acesso_em ? new Date(u.ultimo_acesso_em).toLocaleString("pt-BR") : "nunca entrou"}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => mudar(u.id, { ativo: !u.ativo })}
                      className={`text-[11px] px-2 py-1 rounded ${
                        u.ativo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {u.ativo ? "ativo · desativar" : "desativado · reativar"}
                    </button>
                  </td>
                </tr>
              ))}
              {linhas && linhas.length === 0 && (
                <tr><td colSpan="5" className="px-3 py-4 text-slate-400">
                  Nenhum acesso criado ainda. Você está entrando pelo login de administração.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        O login de administração continua valendo e não aparece nesta lista — ele vive nas
        variáveis do Railway e serve para não haver como ficar trancado do lado de fora.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Painel({ token, sair }) {
  const eu = lerToken(token) || {};
  const podeEditar = eu.perfil === "admin" || eu.perfil === "gestor";
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("painel");
  const [grupo, setGrupo] = useState(null);
  const [ficha, setFicha] = useState(null);
  const [buscaFila, setBuscaFila] = useState("");
  const [filtroLocal, setFiltroLocal] = useState("");
  const [soSemNivel1, setSoSemNivel1] = useState(false);
  const [raio, setRaio] = useState("");
  const [buscaLocal, setBuscaLocal] = useState("");
  const [soSemPonto, setSoSemPonto] = useState(false);

  const carregar = useCallback(
    () =>
      Promise.all([
        pedir("/painel/resumo", token),
        pedir("/painel/curva", token),
        pedir("/painel/locais", token),
        pedir("/painel/fila", token),
        pedir("/painel/sem-cadastro", token),
        pedir("/painel/safristas-fixos", token),
        pedir("/requisicoes/resumo", token).catch(() => null),
      ])
        .then(([resumo, curva, locais, fila, semCadastro, safristas, reqs]) =>
          setD({ resumo, curva, locais, fila, semCadastro, safristas, reqs }))
        .catch((e) => setErro(e.message)),
    [token]
  );

  useEffect(() => { carregar(); }, [carregar]);

  const filaFiltrada = useMemo(() => {
    if (!d) return [];
    const t = buscaFila.trim().toLowerCase();
    return d.fila.filter((x) => {
      const c = comoRodar(x);
      const passaRaio =
        !raio ||
        (raio === "cidade" && c.nivel <= 2) ||
        (["30", "60"].includes(raio) &&
          (c.nivel <= 2 || (x.km_mais_proximo != null && x.km_mais_proximo <= Number(raio))));
      return (
        (!t || (x.nome || "").toLowerCase().includes(t) || x.codigo.includes(t)) &&
        (!filtroLocal || x.local_base === filtroLocal) &&
        (!soSemNivel1 || c.nivel >= 3) &&
        passaRaio
      );
    });
  }, [d, buscaFila, filtroLocal, soSemNivel1, raio]);

  const locaisFiltrados = useMemo(() => {
    if (!d) return [];
    const t = buscaLocal.trim().toLowerCase();
    return d.locais.filter(
      (l) =>
        (!t || l.local_base.toLowerCase().includes(t) || (l.cidade || "").toLowerCase().includes(t)) &&
        (!soSemPonto || l.fonte !== "mapa")
    );
  }, [d, buscaLocal, soSemPonto]);

  function abrirGrupo(g) { setGrupo(g); setAba("lista"); }

  function atualizarPonto(p) {
    setD((v) => ({
      ...v,
      locais: v.locais.map((l) =>
        l.id === p.id
          ? { ...l, latitude: p.latitude, longitude: p.longitude, fonte: p.fonte, aproximada: p.aproximada }
          : l),
    }));
  }

  if (erro) return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="text-center">
        <p className="text-rose-600 text-sm mb-3">{erro}</p>
        <button onClick={sair} className="text-sm text-slate-600 underline">Entrar de novo</button>
      </div>
    </div>
  );
  if (!d) return <div className="min-h-screen grid place-items-center text-slate-400 text-sm">Carregando…</div>;

  const { resumo, curva, locais, fila, semCadastro, safristas, reqs } = d;
  const j = resumo.janela, a = resumo.ativos, r = resumo.regras, fx = resumo.fixos;
  const comPonto = resumo.base.locais_com_ponto ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-slate-900 text-white px-4 py-3 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <span className="bg-white rounded-lg px-2 py-1.5 shrink-0">
            <img src="/logo-mmg-letras.png" alt="MMG" className="h-4 w-auto block" />
          </span>
          <div className="flex-1">
            <h1 className="text-sm font-semibold leading-tight">Rodízio</h1>
            <p className="text-[11px] text-slate-400 leading-tight">
              Janela de {dataBR(j.janela_inicio)} a {dataBR(j.janela_fim)} · {j.percentual}% da entressafra
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-300 leading-tight">{eu.nome || eu.usuario}</p>
            <p className="text-[10px] text-slate-500 leading-tight">
              {eu.perfil === "leitura" ? "somente leitura" : eu.perfil}
            </p>
          </div>
          <button onClick={sair} className="text-[11px] text-slate-400 hover:text-white">Sair</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-1.5 flex-wrap">
          {[["painel","Painel"],["safra","Safra"],["locais","Locais"],["fila","Fila"],
            ["requisicoes","Requisições"],
            ["safristas","Safristas fixos"],["cadastro","Sem cadastro"],
            ...(podeEditar ? [["importar","Importar"]] : []),
            ...(eu.perfil === "admin" ? [["usuarios","Acessos"]] : [])].map(([k, rot]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium ${
                aba === k ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
              {rot}
              {k === "cadastro" && semCadastro.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-amber-400 text-amber-950 rounded px-1">{semCadastro.length}</span>
              )}
              {k === "requisicoes" && reqs?.abertas > 0 && (
                <span className={`ml-1.5 text-[10px] rounded px-1 ${
                  reqs.urgentes > 0 ? "bg-rose-400 text-rose-950" : "bg-teal-400 text-teal-950"}`}>
                  {reqs.abertas}
                </span>
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
                <li><b>A janela</b> termina em {dataBR(j.janela_fim)}, que é o último dia apurado — não a data de hoje. Dia que ainda não foi apurado não pode contar, então a janela anda quando a apuração do mês entra.</li>
                <li><b>Unidade viva</b> — teve ao menos um trabalhador nos últimos {r.dias_unidade_ativa} dias contados do último dia apurado. Unidade parada não entra como destino de rodízio: hoje são {resumo.base.unidades_vivas} das {resumo.base.unidades} cadastradas, em {resumo.base.locais_vivos} locais.</li>
              </ul>
              <p className="text-[11px] text-teal-700 mt-2">Clique em qualquer cartão para ver quem são.</p>
            </div>

            <Curva dados={curva} primeiro={resumo.base.primeiro_mes} ultimo={resumo.base.ultimo_mes} />

            <div className="bg-slate-900 text-white rounded-xl p-4">
              <p className="text-[13px] font-medium text-teal-300">Fila de regularização</p>
              <p className="text-[12.5px] mt-2 leading-relaxed text-slate-200">
                <b className="text-white">{fx.pessoas} pessoas</b> ativas passaram 95% ou mais
                dos dias no mesmo local e estão obrigadas ao rodízio. Somam{" "}
                <b className="text-white">{fx.dias_a_cumprir} dias-pessoa</b>, o que dá{" "}
                <b className="text-white">{fx.semanas} semanas de rodízio</b> na regra de no
                máximo {r.dias_por_mes} dias por mês.
              </p>

              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xl font-semibold tabular-nums text-teal-300">{fx.com_nivel_1}</p>
                  <p className="text-[10.5px] text-slate-300 leading-tight mt-0.5">
                    trocam de setor no próprio local, com o setor vizinho vivo
                  </p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xl font-semibold tabular-nums text-sky-300">{fx.mesma_cidade}</p>
                  <p className="text-[10.5px] text-slate-300 leading-tight mt-0.5">
                    vão a outro local na mesma cidade
                  </p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xl font-semibold tabular-nums text-amber-300">{fx.precisa_transporte}</p>
                  <p className="text-[10.5px] text-slate-300 leading-tight mt-0.5">
                    precisam sair da cidade — {fx.semanas_transporte} semanas de carro
                  </p>
                </div>
              </div>

              {fx.nivel_1_perdido > 0 && (
                <p className="text-[11.5px] mt-3 text-amber-300 leading-relaxed">
                  {fx.nivel_1_perdido} pessoas estão em local com mais de um setor cadastrado, mas
                  com o setor vizinho parado — por isso não contam como troca dentro do local.
                </p>
              )}

              <p className="text-[11px] mt-3 text-slate-400 leading-relaxed">
                Só entra como destino a unidade que teve gente nos últimos {r.dias_unidade_ativa} dias.
                Mesma cidade não quer dizer sem carro: dois locais em Cascavel podem estar a
                20 km um do outro. A separação entre as três colunas depende da cidade de cada local, e{" "}
                {comPonto === 0
                  ? "nenhum local tem ponto exato ainda — a distância está sendo estimada pelo centro do município."
                  : `${comPonto} de ${resumo.base.locais} locais já têm ponto exato no mapa.`}{" "}
                Quanto mais pontos definidos na aba Locais, mais confiável fica esta conta.
              </p>
            </div>
          </>
        )}

        {aba === "importar" && podeEditar && <Importar token={token} />}
        {aba === "usuarios" && eu.perfil === "admin" && <Usuarios token={token} />}
        {aba === "requisicoes" && (
          <Requisicoes token={token} podeEditar={podeEditar} pedir={pedir} gravar={gravar} />
        )}
        {aba === "safra" && <Safra token={token} aoAtualizar={carregar} podeEditar={podeEditar} />}

        {aba === "locais" && (
          <>
            <div className="flex gap-2 items-center flex-wrap">
              <Busca valor={buscaLocal} aoMudar={setBuscaLocal} dica="Buscar local ou cidade…" />
              <button onClick={() => setSoSemPonto((v) => !v)}
                className={`px-3 py-2 rounded-lg text-[13px] border ${
                  soSemPonto ? "bg-slate-900 text-white border-slate-900"
                             : "bg-white text-slate-600 border-slate-200"}`}>
                Só quem falta definir no mapa
              </button>
              <span className="text-[12px] text-slate-500">{locaisFiltrados.length} de {locais.length}</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {locaisFiltrados.map((l) => (
                <div key={l.id} className="px-4 py-3 border-b border-slate-50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{l.local_base}</p>
                      <p className="text-[11px] text-slate-500">
                        {l.vivo
                          ? <span className="text-emerald-700">ativa</span>
                          : <span className="text-slate-400">
                              {l.dias_parado != null ? `parada há ${l.dias_parado} dias` : "sem movimento no arquivo"}
                            </span>}
                        {" · "}
                        {l.cidade || <span className="text-rose-600">sem cidade</span>}
                        {" · "}{l.setores_vivos} de {l.setores} {l.setores === 1 ? "setor ativo" : "setores ativos"}
                        {l.setores_vivos <= 1 && l.locais_mesma_cidade === 0 && (
                          <span className="text-rose-600"> · precisa sair da cidade</span>
                        )}
                        {l.locais_mesma_cidade > 0 && (
                          <span className="text-sky-700"> · {l.locais_mesma_cidade} local(is) vivo(s) na mesma cidade</span>
                        )}
                        {l.km_mais_proximo != null && (
                          <span className="text-slate-400"> · vizinho a {Math.round(l.km_mais_proximo)} km</span>
                        )}
                      </p>
                      <PontoDoLocal token={token} local={l} aoGravar={atualizarPonto}
                                    podeEditar={podeEditar} />
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{l.pessoas}</p>
                      <p className="text-[11px] text-slate-400">{l.dias_a_cumprir} dias</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              O filtro por Sede e Filial ainda não é possível: o arquivo do Ponto não traz essa
              informação. Ela virá no arquivo cadastral que será pedido ao TI.
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
                {locais.map((l) => <option key={l.id} value={l.local_base}>{l.local_base}</option>)}
              </select>
              <select value={raio} onChange={(e) => setRaio(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
                <option value="">Qualquer distância</option>
                <option value="cidade">Sem sair da cidade</option>
                <option value="30">Destino a até 30 km</option>
                <option value="60">Destino a até 60 km</option>
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
                      <th className="text-left px-3 py-2">Cidade</th>
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
                    {filaFiltrada.map((t) => {
                      const c = comoRodar(t);
                      return (
                        <tr key={t.codigo} onClick={() => setFicha(t.codigo)}
                          className="border-t border-slate-50 hover:bg-slate-50 cursor-pointer">
                          <td className="px-3 py-2 font-medium">{t.codigo}</td>
                          <td className="px-3 py-2">
                            {t.nome || <span className="text-amber-700 text-[11px]">sem cadastro no MMG+</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{t.local_base}</td>
                          <td className="px-3 py-2 text-slate-500">{t.cidade || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{t.dias}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_entressafra}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_fora}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{t.meta}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                            t.falta > 0 ? "text-amber-600" : "text-emerald-600"}`}>{t.falta}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.semanas}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[11px] ${c.cor}`}>{c.texto}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              "Como rodar" vai do mais barato ao mais caro: outro setor no mesmo local não exige
              deslocamento; outro local na mesma cidade costuma dispensar carro; acima disso entra
              a logística. Só conta como destino a unidade que teve gente nos últimos{" "}
              {r.dias_unidade_ativa} dias — setor cadastrado mas parado não serve. Onde o local ainda
              não tem ponto exato no mapa, a distância é estimada pelo centro do município e vem
              marcada como aproximada.
            </p>
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
                        <td className="px-3 py-2 text-slate-500">{dataBR(t.primeiro_dia)}</td>
                        <td className="px-3 py-2 text-slate-500">{dataBR(t.ultimo_dia)}</td>
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
          Cada bloco de rodízio vai de segunda a sexta, com no máximo {r.dias_por_mes} dias por mês —
          só 27 dos 181 locais funcionam no sábado, então o bloco curto é o que cabe em todo lugar.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  function sair() { localStorage.removeItem("token"); setToken(null); }

  /* Endereço público do pedido: ?r=token, com ?u=unidade opcional.
     Resolve ANTES do login — quem abre este link não tem conta. */
  const params = new URLSearchParams(window.location.search);
  const linkRequisicao = params.get("r");
  if (linkRequisicao) {
    return <Requisicao token={linkRequisicao} unidadeParam={params.get("u")} />;
  }

  return token ? <Painel token={token} sair={sair} /> : <Login aoEntrar={setToken} />;
}
