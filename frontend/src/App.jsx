import { useState, useEffect, useMemo, useCallback } from "react";
import Importar from "./Importar.jsx";
import Requisicao, { Requisicoes } from "./Requisicao.jsx";
import Escalas from "./Escalas.jsx";
import Convocacao from "./Convocacao.jsx";
import { AssinarRequisicao, ValidarAssinatura } from "./Assinaturas.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const ASSINATURA_SITE = String(import.meta.env.VITE_ASSINATURA_URL || "").replace(/\/$/, "");
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

/* 14/09/2026 — TOKEN VENCIDO NÃO VIRA TELA VERMELHA.
   Antes, quando o token expirava, a API devolvia "Sem token" ou
   "Token invalido ou expirado" e isso caía como texto cru na tela —
   o Ricardo tinha que clicar em "Entrar de novo" toda vez.
   Agora `pedir` e `gravar` reconhecem esses dois casos, limpam o
   token guardado e mandam direto para o login (window.location.reload
   com o token já removido; sem token, App() cai no <Login>). Qualquer
   outro erro continua subindo normal, para a tela de erro que já
   existia — este atalho é só para token vencido. */
function tokenVencido(msg) {
  const m = String(msg || "").toLowerCase();
  return m.includes("token invalido") || m.includes("token inválido")
    || m.includes("sem token") || m.includes("token expirado");
}

function forcarLogout() {
  localStorage.removeItem("token");
  window.location.reload();
}

async function pedir(caminho, token) {
  const r = await fetch(API + caminho, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}));
    if (r.status === 401 || tokenVencido(corpo.error)) { forcarLogout(); return new Promise(() => {}); }
    throw new Error(corpo.error || "Falha na consulta");
  }
  return r.json();
}
async function gravar(caminho, token, corpo, metodo = "PUT") {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || tokenVencido(d.error)) { forcarLogout(); return new Promise(() => {}); }
    throw new Error(d.error || "Falha ao gravar");
  }
  return r.json();
}

/* 16/09/2026 — data formatada pelo texto, não pelo relógio do navegador.
   A API devolve "2026-08-31T00:00:00.000Z"; new Date() disso, em
   Brasília, cai em 30/08. Cortar os dez primeiros caracteres resolve. */
const dataBR = (d) => {
  if (!d) return "";
  const [ano, mes, dia] = String(d).slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
};
const dataHoraBR = (d) =>
  d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

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
function Lista({ token, grupo, locais, empresas, aoVoltar, diasPorMes, aoAbrirFicha }) {
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [local, setLocal] = useState("");
  const [empresa, setEmpresa] = useState("");

  useEffect(() => {
    setLinhas(null); setErro("");
    pedir(`/painel/trabalhadores?grupo=${grupo}`, token).then(setLinhas).catch((e) => setErro(e.message));
  }, [grupo, token]);

  const filtradas = useMemo(() => {
    if (!linhas) return [];
    const t = busca.trim().toLowerCase();
    return linhas.filter((x) =>
      (!t || (x.nome || "").toLowerCase().includes(t) || x.codigo.includes(t)) &&
      (!empresa || x.empresa_id === empresa) &&
      (!local || x.local_base === local)
    );
  }, [linhas, busca, local, empresa]);

  if (erro) return <p className="text-sm text-rose-600">{erro}</p>;
  if (!linhas) return <p className="text-sm text-slate-400">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={aoVoltar} className="text-[13px] text-slate-600 underline">← Painel</button>
        <span className="text-sm font-medium">{GRUPOS[grupo]}</span>
        <Busca valor={busca} aoMudar={setBusca} dica="Buscar nome ou código…" />
        <select value={empresa} onChange={(e) => { setEmpresa(e.target.value); setLocal(""); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
          <option value="">Todas as empresas</option>
          {(empresas || []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <select value={local} onChange={(e) => setLocal(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
          <option value="">Todos os locais</option>
          {locais.filter((l) => !empresa || l.empresa_id === empresa)
            .map((l) => <option key={l.local_base} value={l.local_base}>{l.local_base}</option>)}
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

/* ------------------------------------------------------------------
 * CRITÉRIOS — 15/09/2026
 * Tudo que decide "quem está em dia" vive na tabela `parametros` e é
 * editado aqui. Cada gravação exige motivo; o banco grava o histórico
 * e recusa alteração enquanto os critérios estiverem congelados.
 * ---------------------------------------------------------------- */
const CRITERIOS = [
  {
    campo: "dias_ativo", rotulo: "Dias para considerar ativo", unidade: "dias", min: 1, max: 365,
    ajuda: "Quem teve ao menos um dia apurado nesse intervalo, contado do fim da janela, entra no rodízio. Quem não teve fica de fora da conta.",
  },
  {
    campo: "isencao_dias", rotulo: "Isenção", unidade: "dias de entressafra", min: 0, max: 365,
    ajuda: "Abaixo disso a pessoa é isenta: trabalhou pouco na entressafra e não tem obrigação de rodar.",
  },
  {
    campo: "tipo_meta", rotulo: "Como a meta é calculada", tipo: "opcao",
    opcoes: [
      ["percentual", "Percentual dos dias de entressafra"],
      ["dias", "Número fixo de dias"],
    ],
    ajuda: "Percentual acompanha quanto cada pessoa trabalhou; número fixo cobra o mesmo de todos os obrigados.",
  },
  {
    campo: "percentual", rotulo: "Percentual", unidade: "% dos dias de entressafra", min: 1, max: 100, decimal: true, so: "percentual",
    ajuda: "A meta de cada pessoa é esta fatia dos dias que ela trabalhou na entressafra dentro da janela.",
  },
  {
    campo: "teto_dias", rotulo: "Teto", unidade: "dias", min: 1, max: 365, so: "percentual",
    ajuda: "A meta percentual nunca passa disto, por mais dias que a pessoa tenha trabalhado.",
  },
  {
    campo: "meta_dias", rotulo: "Meta fixa", unidade: "dias fora da base", min: 1, max: 365, so: "dias",
    ajuda: "Todo obrigado precisa deste número de dias fora da unidade-base na janela.",
  },
  {
    campo: "dias_por_mes", rotulo: "Bloco de rodízio", unidade: "dias por mês", min: 1, max: 31,
    ajuda: "Permanência máxima fora da base por mês. É o que converte dias que faltam em semanas de rodízio.",
  },
  {
    campo: "dias_unidade_ativa", rotulo: "Unidade viva", unidade: "dias", min: 1, max: 365,
    ajuda: "Unidade com gente nesse intervalo, contado do último dia apurado, serve de destino. Unidade parada não.",
  },
  {
    campo: "meses_a_frente", rotulo: "Projeção da Safra", unidade: "meses", min: 1, max: 12,
    ajuda: "Quantos meses o bloco \"o que vem pela frente\" mostra na aba Safra.",
  },
  /* 16/09/2026 — calendário da requisição, da escala e do pagamento */
  {
    campo: "corte_q1", rotulo: "Corte do pedido · 1ª quinzena", unidade: "dia do mês anterior", min: 1, max: 28, grupo: "calendario",
    ajuda: "Até este dia do mês anterior a unidade pede para a quinzena de 1 a 15. Depois, o pedido entra fora do prazo.",
  },
  {
    campo: "corte_q2", rotulo: "Corte do pedido · 2ª quinzena", unidade: "dia do mesmo mês", min: 1, max: 28, grupo: "calendario",
    ajuda: "Até este dia a unidade pede para a quinzena de 16 ao fim do mês.",
  },
  {
    campo: "antecedencia_divulgacao", rotulo: "Divulgação da escala", unidade: "dias antes da quinzena", min: 0, max: 15, grupo: "calendario",
    ajuda: "Quantos dias antes do início da quinzena a escala precisa estar publicada. A tela de Escalas mostra a data-limite.",
  },
  {
    campo: "encerramento_q1", rotulo: "Encerramento · 1ª quinzena", unidade: "dia do mesmo mês", min: 1, max: 28, grupo: "calendario",
    ajuda: "Dia em que a requisição da quinzena de 1 a 15 se encerra para faturamento. É a data que dispara o prazo de 72 horas úteis da empresa (Lei 12.023, art. 6º).",
  },
  {
    campo: "encerramento_q2", rotulo: "Encerramento · 2ª quinzena", unidade: "dia do mês seguinte", min: 1, max: 28, grupo: "calendario",
    ajuda: "Dia do mês seguinte em que a requisição da quinzena de 16 ao fim se encerra para faturamento.",
  },
  {
    campo: "repasse_q1", rotulo: "Repasse · 1ª quinzena", unidade: "dia do mesmo mês", min: 1, max: 28, grupo: "calendario",
    ajuda: "Dia em que o sindicato paga os trabalhadores pelo que foi apurado de 1 a 15.",
  },
  {
    campo: "repasse_q2", rotulo: "Repasse · 2ª quinzena", unidade: "dia do mês seguinte", min: 1, max: 28, grupo: "calendario",
    ajuda: "Dia do mês seguinte em que o sindicato paga pelo que foi apurado de 16 ao fim do mês.",
  },
];
const ROTULO_CAMPO = Object.fromEntries(CRITERIOS.map((c) => [c.campo, c.rotulo]));
ROTULO_CAMPO.janela = "Janela";
ROTULO_CAMPO.congelado = "Congelamento";
ROTULO_CAMPO.carencia_antes = "Carência antes da safra";
ROTULO_CAMPO.carencia_depois = "Carência depois da safra";
ROTULO_CAMPO.meia_diaria_conta = "Meia diária conta";
ROTULO_CAMPO.prazo_envio_dia = "Prazo de envio";

function valorLegivel(campo, v) {
  if (v == null) return "—";
  if (campo === "tipo_meta") return v === "dias" ? "número fixo de dias" : "percentual";
  if (campo === "percentual") return `${Number(v)}%`;
  return String(v);
}

function Criterios({ token, aoAtualizar, podeEditar, souAdmin }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({});
  const [motivo, setMotivo] = useState("");
  const [motivoGelo, setMotivoGelo] = useState("");
  const [geloAberto, setGeloAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  const aplicar = (d) => {
    setDados(d);
    const f = {};
    CRITERIOS.forEach((c) => { f[c.campo] = d.atual[c.campo]; });
    setForm(f);
  };

  useEffect(() => {
    pedir("/painel/criterios", token).then(aplicar).catch((e) => setErro(e.message));
  }, [token]);

  const a = dados?.atual;
  const congelado = !!a?.congelado;
  const travado = !podeEditar || congelado;

  const mudancas = useMemo(() => {
    if (!a) return [];
    return CRITERIOS.filter((c) => {
      if (c.so && form.tipo_meta !== c.so) return false;
      return String(form[c.campo] ?? "") !== String(a[c.campo] ?? "");
    });
  }, [form, a]);

  const invalido = useMemo(() => {
    return CRITERIOS.find((c) => {
      if (c.tipo === "opcao") return false;
      if (c.so && form.tipo_meta !== c.so) return false;
      const v = Number(String(form[c.campo] ?? "").replace(",", "."));
      if (!Number.isFinite(v)) return true;
      if (!c.decimal && !Number.isInteger(v)) return true;
      return v < c.min || v > c.max;
    });
  }, [form]);

  async function salvar() {
    setSalvando(true); setErro(""); setAviso("");
    try {
      const corpo = { motivo };
      mudancas.forEach((c) => { corpo[c.campo] = form[c.campo]; });
      const d = await gravar("/painel/criterios", token, corpo);
      aplicar(d); setMotivo("");
      if (aoAtualizar) await aoAtualizar();
      setAviso(`${mudancas.length} ${mudancas.length === 1 ? "critério gravado" : "critérios gravados"}, relógio recalculado e painel atualizado.`);
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  async function congelar(descongelar = false) {
    setSalvando(true); setErro(""); setAviso("");
    try {
      const d = await gravar(`/painel/criterios/${descongelar ? "descongelar" : "congelar"}`, token, { motivo: motivoGelo }, "POST");
      aplicar(d); setMotivoGelo(""); setGeloAberto(false);
      if (aoAtualizar) await aoAtualizar();
      setAviso(descongelar
        ? "Critérios descongelados. A janela volta a acompanhar a apuração."
        : "Critérios congelados. A janela ficou travada nas datas de hoje.");
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  if (erro && !dados) return <p className="text-sm text-rose-600">{erro}</p>;
  if (!dados) return <p className="text-sm text-slate-400">Carregando…</p>;

  const ultimaPor = (campo) => (dados.historico || []).find((h) => h.campo === campo && h.evento === "alteracao");

  return (
    <div className="space-y-4">
      {/* -------- situação -------- */}
      <div className={`rounded-xl border p-4 ${congelado ? "bg-sky-50 border-sky-200" : "bg-white border-slate-200"}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <p className="text-sm font-medium">Critérios do rodízio</p>
            <p className="text-[11.5px] text-slate-600 mt-1 leading-relaxed">
              São estes números que decidem quem é obrigado, quem está em dia e quanto falta.
              Toda alteração pede motivo e fica no histórico abaixo, com quem mudou, quando e o
              valor anterior — porque critério alterado no meio da janela, sem rastro, é o que um
              fiscal usa contra a entidade.
            </p>
          </div>
          <div className="text-right shrink-0">
            {congelado ? (
              <>
                <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full bg-sky-600 text-white">
                  congelados
                </span>
                <p className="text-[11px] text-slate-600 mt-1.5 leading-tight">
                  desde {dataHoraBR(a.congelado_em)}<br />por {a.congelado_por}
                </p>
              </>
            ) : (
              <>
                <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                  abertos
                </span>
                {a.alterado_em && (
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-tight">
                    última alteração {dataHoraBR(a.alterado_em)}<br />por {a.alterado_por}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* -------- janela -------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[13px] font-medium">Janela de apuração</p>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed max-w-xl">
              {congelado
                ? "Travada nas datas em que os critérios foram congelados. Dias apurados depois do fim entram no banco mas não mudam quem está em dia — é a fotografia que vale para a fiscalização."
                : `Móvel: termina no último dia apurado (${dataBR(dados.ultimo_dia_apurado)}) e começa doze meses antes. Anda sozinha a cada importação. Congelar trava as datas de hoje.`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums">{dataBR(a.janela_inicio)} <span className="text-slate-400 font-normal">a</span> {dataBR(a.janela_fim)}</p>
            <p className="text-[11px] text-slate-500">{congelado ? "congelada" : "acompanha a apuração"}</p>
          </div>
        </div>
      </div>

      {/* -------- os critérios -------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        {[["apuracao", "Apuração do rodízio"], ["calendario", "Calendário da requisição, da escala e do pagamento"]].map(([g, rot], gi) => (
        <div key={g} className={gi ? "mt-5 pt-5 border-t border-slate-100" : ""}>
        <p className="text-[12px] font-medium text-slate-500 uppercase tracking-wide mb-3">{rot}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CRITERIOS.filter((c) => (c.grupo || "apuracao") === g).map((c) => {
            const escondido = c.so && form.tipo_meta !== c.so;
            if (escondido) return null;
            const mudou = mudancas.some((m) => m.campo === c.campo);
            const ult = ultimaPor(c.campo);
            return (
              <div key={c.campo}
                className={`rounded-lg border p-3 ${mudou ? "border-teal-400 bg-teal-50/40" : "border-slate-200"}`}>
                <p className="text-[12px] font-medium text-slate-800">{c.rotulo}</p>
                {c.tipo === "opcao" ? (
                  <select value={form.tipo_meta || "percentual"} disabled={travado}
                    onChange={(e) => setForm({ ...form, tipo_meta: e.target.value })}
                    className="mt-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] disabled:bg-slate-50 disabled:text-slate-500">
                    {c.opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                ) : (
                  <div className="mt-2 flex items-baseline gap-2">
                    <input value={form[c.campo] ?? ""} disabled={travado} inputMode="decimal"
                      onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })}
                      className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-[15px] font-semibold tabular-nums disabled:bg-slate-50 disabled:text-slate-500" />
                    <span className="text-[11px] text-slate-500">{c.unidade}</span>
                  </div>
                )}
                <p className="text-[10.5px] text-slate-500 mt-2 leading-relaxed">{c.ajuda}</p>
                <p className="text-[10px] text-slate-400 mt-1.5">
                  {mudou
                    ? <span className="text-teal-700">era {valorLegivel(c.campo, a[c.campo])}</span>
                    : ult ? `alterado em ${dataHoraBR(ult.alterado_em)} por ${ult.alterado_por}` : "nunca alterado"}
                </p>
              </div>
            );
          })}
        </div>
        </div>
        ))}

        {podeEditar && !congelado && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
              placeholder="Motivo da alteração — obrigatório. Ex.: ajuste combinado com a fiscalização em 15/09."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <button onClick={salvar}
                disabled={salvando || !mudancas.length || motivo.trim().length < 5 || !!invalido}
                className="bg-teal-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50">
                {salvando ? "Gravando…" : mudancas.length
                  ? `Gravar ${mudancas.length} ${mudancas.length === 1 ? "alteração" : "alterações"} e recalcular`
                  : "Nada alterado"}
              </button>
              {invalido && (
                <span className="text-[11px] text-rose-600">
                  {invalido.rotulo}: use um número entre {invalido.min} e {invalido.max}.
                </span>
              )}
              {!invalido && mudancas.length > 0 && motivo.trim().length < 5 && (
                <span className="text-[11px] text-slate-500">Escreva o motivo para liberar o botão.</span>
              )}
            </div>
          </div>
        )}
        {!podeEditar && (
          <p className="text-[11.5px] text-slate-500 mt-4 text-center">
            Seu acesso é de leitura — os critérios podem ser consultados, mas não alterados.
          </p>
        )}
        {podeEditar && congelado && (
          <p className="text-[11.5px] text-sky-800 mt-4 text-center">
            Critérios congelados: nada pode ser alterado até que um administrador descongele, com motivo.
          </p>
        )}
        {erro && <p className="text-[12px] text-rose-600 mt-2 text-center leading-relaxed">{erro}</p>}
        {aviso && <p className="text-[12px] text-emerald-700 mt-2 text-center">{aviso}</p>}
      </div>

      {/* -------- congelar / descongelar -------- */}
      {podeEditar && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[260px]">
              <p className="text-[13px] font-medium">{congelado ? "Descongelar" : "Congelar critérios"}</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                {congelado
                  ? "Só o administrador descongela, com motivo. A janela volta a acompanhar a apuração e os critérios voltam a aceitar alteração."
                  : "Trava tudo: critérios e janela. Use quando os números forem acordados com a fiscalização — a partir daí ninguém altera, nem pelo banco. Descongelar fica registrado."}
              </p>
            </div>
            {(!congelado || souAdmin) && !geloAberto && (
              <button onClick={() => setGeloAberto(true)}
                className={`rounded-lg px-4 py-2 text-[13px] font-medium border ${
                  congelado ? "bg-white border-slate-300 text-slate-700" : "bg-sky-600 border-sky-600 text-white"}`}>
                {congelado ? "Descongelar…" : "Congelar…"}
              </button>
            )}
            {congelado && !souAdmin && (
              <span className="text-[11px] text-slate-400 self-center">só o administrador</span>
            )}
          </div>
          {geloAberto && (
            <div className="mt-3 bg-slate-50 rounded-lg p-3">
              <textarea value={motivoGelo} onChange={(e) => setMotivoGelo(e.target.value)} rows={2}
                placeholder={congelado ? "Motivo do descongelamento — obrigatório." : "Motivo do congelamento — obrigatório. Ex.: critérios acordados com a fiscalização em 15/09."}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => congelar(congelado)} disabled={salvando || motivoGelo.trim().length < 5}
                  className="bg-sky-600 text-white rounded-lg px-4 py-2 text-[13px] font-medium disabled:opacity-50">
                  {salvando ? "…" : congelado ? "Confirmar descongelamento" : "Confirmar congelamento"}
                </button>
                <button onClick={() => { setGeloAberto(false); setMotivoGelo(""); }}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-600">
                  Voltar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* -------- histórico -------- */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-baseline gap-2">
          <p className="text-[13px] font-medium">Histórico de alterações</p>
          <span className="text-[11px] text-slate-400">{(dados.historico || []).length} registros · não se edita nem se apaga</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Quando</th>
                <th className="text-left px-3 py-2">Quem</th>
                <th className="text-left px-3 py-2">Critério</th>
                <th className="text-left px-3 py-2">De</th>
                <th className="text-left px-3 py-2">Para</th>
                <th className="text-left px-3 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {(dados.historico || []).map((h) => (
                <tr key={h.id} className="border-t border-slate-50 align-top">
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{dataHoraBR(h.alterado_em)}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{h.alterado_por}</td>
                  <td className="px-3 py-2">
                    {h.evento === "alteracao"
                      ? (ROTULO_CAMPO[h.campo] || h.campo)
                      : <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                          h.evento === "congelar" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>
                          {h.evento === "congelar" ? "congelou" : "descongelou"}
                        </span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{valorLegivel(h.campo, h.valor_anterior)}</td>
                  <td className="px-3 py-2 font-medium">{valorLegivel(h.campo, h.valor_novo)}</td>
                  <td className="px-3 py-2 text-slate-600">{h.motivo}</td>
                </tr>
              ))}
              {(dados.historico || []).length === 0 && (
                <tr><td colSpan="6" className="px-3 py-4 text-slate-400">
                  Nenhuma alteração registrada ainda. Os valores em vigor são os iniciais do sistema.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * TOMADORA — 28/09/2026
 * A tela que se abre na frente da empresa: uma unidade tomadora, os
 * ativos com base nela e a situação de cada um, os pedidos que ela fez
 * e o que já foi escalado para lá. Com impressão.
 * ---------------------------------------------------------------- */
const ESTILO_IMPRESSAO_TOMADORA = `
@media print {
  @page { size: A4; margin: 14mm; }
  body * { visibility: hidden !important; }
  #doc-tomadora, #doc-tomadora * { visibility: visible !important; }
  #doc-tomadora { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
  #doc-tomadora tr { page-break-inside: avoid; }
}`;

const SITUACAO_COR = {
  "Precisa rodar": "bg-amber-50 text-amber-700",
  "Em dia": "bg-emerald-50 text-emerald-700",
  "Safrista": "bg-sky-50 text-sky-700",
  "Isento": "bg-slate-100 text-slate-600",
  "Sem movimento": "bg-slate-100 text-slate-500",
};
const rotuloQz = (r) =>
  r.quinzena_inicio ? `${r.quinzena_numero === 1 ? "1ª" : "2ª"} quinzena · ${dataBR(r.quinzena_inicio).slice(0, 5)} a ${dataBR(r.quinzena_fim)}` : "";

function Tomadora({ token, locais, empresas, inicial, aoAbrirFicha }) {
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState(null);     // { tipo: "empresa" | "local", id }
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  useEffect(() => { if (inicial) setAlvo({ tipo: inicial.tipo, id: inicial.id }); }, [inicial]);

  const t = busca.trim().toLowerCase();
  const opcoesEmpresas = useMemo(
    () => (t.length >= 2 ? (empresas || []).filter((e) => e.nome.toLowerCase().includes(t)).slice(0, 6) : []),
    [empresas, t]);
  const opcoesLocais = useMemo(
    () => (t.length >= 2
      ? locais.filter((l) => l.local_base.toLowerCase().includes(t)
          || (l.cidade || "").toLowerCase().includes(t)
          || (l.empresa || "").toLowerCase().includes(t)).slice(0, 12)
      : []),
    [locais, t]);

  useEffect(() => {
    if (!alvo) { setD(null); return; }
    setD(null); setCarregando(true); setErro("");
    const rota = alvo.tipo === "empresa" ? `/painel/tomadora-empresa/${alvo.id}` : `/painel/tomadora/${alvo.id}`;
    pedir(rota, token).then(setD).catch((e) => setErro(e.message)).finally(() => setCarregando(false));
  }, [alvo, token]);

  const a = d?.alvo, r = d?.resumo;
  const ehEmpresa = d?.tipo === "empresa";
  const pedidosAbertos = (d?.pedidos || []).filter((p) => p.status === "aberta" || p.status === "em_atendimento");
  const escolher = (tipo, id) => { setAlvo({ tipo, id }); setBusca(""); };

  return (
    <div className="space-y-4">
      {/* ---- escolher a empresa ou a unidade ---- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Situação por empresa ou unidade tomadora</p>
        <p className="text-[11px] text-slate-500 mt-1 mb-3">
          Escolha a empresa inteira (todas as unidades dela somadas) ou uma unidade só. A tela mostra quem está
          ativo com base nela e a situação de cada um no rodízio, os pedidos que fez e o que já foi escalado.
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <Busca valor={busca} aoMudar={setBusca} dica="Buscar empresa, unidade ou cidade…" />
          {a && (
            <span className="text-[12px] text-slate-600">
              selecionada: <b>{a.titulo}</b>{ehEmpresa && " · empresa"}
              <button onClick={() => { setAlvo(null); setBusca(""); }} className="ml-2 text-teal-700 underline">trocar</button>
            </span>
          )}
        </div>

        {!alvo && t.length < 2 && (empresas || []).length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-slate-500 mb-1.5">Maiores empresas, por trabalhadores ativos:</p>
            <div className="flex gap-1.5 flex-wrap">
              {empresas.slice(0, 10).map((e) => (
                <button key={e.id} onClick={() => escolher("empresa", e.id)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-[12.5px] hover:border-slate-400">
                  {e.nome} <span className="text-slate-400">· {e.ativos}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!alvo && t.length >= 2 && (
          <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
            {opcoesEmpresas.length > 0 && (
              <p className="px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-slate-500 bg-slate-50">Empresas</p>
            )}
            {opcoesEmpresas.map((e) => (
              <button key={e.id} onClick={() => escolher("empresa", e.id)}
                className="w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50">
                <span className="text-[13px] font-medium">{e.nome}</span>
                <span className="text-[11.5px] text-slate-500"> · {e.unidades} unidades · {e.ativos} ativos · {e.precisam} precisam rodar</span>
              </button>
            ))}
            {opcoesLocais.length > 0 && (
              <p className="px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-slate-500 bg-slate-50">Unidades</p>
            )}
            {opcoesLocais.map((o) => (
              <button key={o.id} onClick={() => escolher("local", o.id)}
                className="w-full text-left px-3 py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <span className="text-[13px] font-medium">{o.local_base}</span>
                <span className="text-[11.5px] text-slate-500">
                  {o.empresa ? ` · ${o.empresa}` : ""} · {o.cidade || "sem cidade"} · {o.vivo ? "ativa" : "parada"} · {o.pessoas} na fila
                </span>
              </button>
            ))}
            {opcoesEmpresas.length === 0 && opcoesLocais.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-slate-500">Nada com isso.</p>
            )}
          </div>
        )}
      </div>

      {erro && <p className="text-[13px] text-rose-600">{erro}</p>}
      {carregando && <p className="text-sm text-slate-400">Carregando…</p>}

      {d && a && (
        <>
          {/* ---- cabeçalho + resumo ---- */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[16px] font-semibold">{a.titulo}</p>
                {ehEmpresa ? (
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    Empresa · {a.unidades} {a.unidades === 1 ? "unidade" : "unidades"} em {a.locais} {a.locais === 1 ? "local" : "locais"}
                    {a.cidades > 0 && ` · ${a.cidades} ${a.cidades === 1 ? "cidade" : "cidades"}`}
                    {" · "}{a.unidades_vivas} com movimento recente
                    {a.cnpj ? ` · CNPJ ${a.cnpj}` : ""}
                  </p>
                ) : (
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    {a.empresa ? `${a.empresa} · ` : ""}{a.cidade || "sem cidade"} · {a.setores_vivos} de {a.setores} {a.setores === 1 ? "setor ativo" : "setores ativos"} ·{" "}
                    {a.vivo ? <span className="text-emerald-700">ativa</span> : <span className="text-slate-400">parada{a.dias_parado != null ? ` há ${a.dias_parado} dias` : ""}</span>}
                  </p>
                )}
              </div>
              <button onClick={() => window.print()}
                className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px] text-slate-700 hover:border-slate-500">
                Imprimir
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-4">
              {[["Ativos", r.ativos, ""], ["Obrigados", r.obrigados, ""], ["Precisam rodar", r.precisam, "text-amber-600"],
                ["Em dia", r.em_dia, "text-emerald-600"], ["Isentos", r.isentos, "text-slate-500"], ["Safristas", r.safristas, "text-sky-600"],
                ["Dias a cumprir", r.dias_a_cumprir, "text-amber-600"]].map(([rot, v, cor]) => (
                <div key={rot} className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10.5px] text-slate-500">{rot}</p>
                  <p className={`text-xl font-semibold tabular-nums ${cor}`}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ---- pessoas ---- */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[13px] font-medium">Trabalhadores ativos com base {ehEmpresa ? "nesta empresa" : "nesta unidade"} · {d.pessoas.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Ativo = movimento nos últimos {d.regras.dias_ativo} dias da janela. Quem precisa rodar aparece primeiro.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">Código</th>
                    <th className="text-left px-3 py-2">Nome</th>
                    {ehEmpresa && <th className="text-left px-3 py-2">Local-base</th>}
                    <th className="text-left px-3 py-2">Situação</th>
                    <th className="text-right px-3 py-2">Dias</th>
                    <th className="text-right px-3 py-2">Entressafra</th>
                    <th className="text-right px-3 py-2">Fora</th>
                    <th className="text-right px-3 py-2">Meta</th>
                    <th className="text-right px-3 py-2">Falta</th>
                    <th className="text-right px-3 py-2">% aqui</th>
                    <th className="text-left px-3 py-2">Último dia</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pessoas.map((p) => (
                    <tr key={p.codigo} onClick={() => aoAbrirFicha(p.codigo)}
                        className="border-t border-slate-50 hover:bg-slate-50 cursor-pointer">
                      <td className="px-3 py-2 font-medium">{p.codigo}</td>
                      <td className="px-3 py-2">{p.nome || <span className="text-amber-700 text-[11px]">sem cadastro no MMG+</span>}</td>
                      {ehEmpresa && <td className="px-3 py-2 text-slate-600">{p.local_base}</td>}
                      <td className="px-3 py-2">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${SITUACAO_COR[p.situacao] || "bg-slate-100 text-slate-600"}`}>{p.situacao}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.dias}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{p.dias_entressafra}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{p.dias_fora}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.meta}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${p.falta > 0 ? "text-amber-600" : "text-emerald-600"}`}>{p.falta}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{p.pct_no_local_base}%</td>
                      <td className="px-3 py-2 text-slate-500">{dataBR(p.ultimo_dia)}</td>
                    </tr>
                  ))}
                  {d.pessoas.length === 0 && (
                    <tr><td colSpan="11" className="px-3 py-4 text-slate-400">Ninguém ativo com base {ehEmpresa ? "nesta empresa" : "nesta unidade"}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- pedidos ---- */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[13px] font-medium">
                Pedidos {ehEmpresa ? "da empresa" : "desta unidade"} · {d.pedidos.length}
                {pedidosAbertos.length > 0 && <span className="ml-2 text-[11px] text-amber-700">{pedidosAbertos.length} em aberto</span>}
              </p>
            </div>
            {d.pedidos.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-slate-500">Nenhum pedido registrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Pedido em</th>
                      <th className="text-left px-3 py-2">Unidade</th>
                      <th className="text-left px-3 py-2">Para</th>
                      <th className="text-right px-3 py-2">Pessoas</th>
                      <th className="text-left px-3 py-2">Quem pediu</th>
                      <th className="text-left px-3 py-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pedidos.map((pd) => (
                      <tr key={pd.id} className="border-t border-slate-50 align-top">
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dataHoraBR(pd.criado_em)}</td>
                        <td className="px-3 py-2"><b>{pd.unidade_codigo}</b> <span className="text-slate-500">{pd.unidade_nome}</span></td>
                        <td className="px-3 py-2">
                          {pd.tipo === "avulsa"
                            ? `${dataBR(pd.previsao_inicio)}${pd.previsao_fim ? ` a ${dataBR(pd.previsao_fim)}` : " em diante"}`
                            : rotuloQz(pd)}
                          {pd.fora_do_prazo && <span className="ml-1.5 text-[10.5px] bg-amber-100 text-amber-800 rounded px-1">fora do prazo</span>}
                          {pd.aditivo && <span className="ml-1.5 text-[10.5px] bg-sky-100 text-sky-800 rounded px-1">aditivo</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {pd.quantidade}
                          {(pd.funcoes || []).length > 0 && (
                            <span className="block text-[10.5px] text-slate-500 text-right">
                              {pd.funcoes.map((f) => `${f.quantidade} ${f.nome}`).join(" · ")}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{pd.solicitante_nome}{pd.solicitante_tipo === "mmg" ? " · MMG" : ""}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                            pd.status === "aberta" ? "bg-amber-50 text-amber-700"
                            : pd.status === "em_atendimento" ? "bg-sky-50 text-sky-700"
                            : pd.status === "atendida" ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"}`}>{pd.status.replace("_", " ")}</span>
                          {pd.atendida_obs && <span className="block text-[10.5px] text-slate-400 mt-0.5">{pd.atendida_obs}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---- escalados para cá ---- */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[13px] font-medium">Escalados para {ehEmpresa ? "esta empresa" : "esta unidade"} · {d.escalados.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Escalas dos últimos 45 dias e futuras, rascunhos incluídos.</p>
            </div>
            {d.escalados.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-slate-500">Nenhuma escala com destino aqui.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Escala</th>
                      <th className="text-left px-3 py-2">Código</th>
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Vem de</th>
                      <th className="text-left px-3 py-2">Unidade</th>
                      <th className="text-left px-3 py-2">Período</th>
                      <th className="text-right px-3 py-2">Dias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.escalados.map((i, k) => (
                      <tr key={k} className="border-t border-slate-50">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {i.numero ? `${String(i.numero).padStart(3, "0")}/${i.ano}` : "rascunho"}
                          <span className={`ml-1.5 text-[10.5px] px-1 rounded ${
                            i.natureza === "inicial" ? "bg-slate-100 text-slate-600" : i.natureza === "aditivo" ? "bg-sky-50 text-sky-700" : "bg-teal-50 text-teal-700"}`}>
                            {i.natureza}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium">{i.codigo}</td>
                        <td className="px-3 py-2">{i.nome || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{i.natureza === "inicial" ? "permanece" : (i.origem_local || "—")}</td>
                        <td className="px-3 py-2 text-slate-600">{i.unidade_codigo} · {i.setor || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{dataBR(i.data_inicio)} a {dataBR(i.data_fim)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.dias}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---- documento impresso ---- */}
          <div id="doc-tomadora" className="hidden text-slate-900" style={{ fontSize: "11px" }}>
            <style>{ESTILO_IMPRESSAO_TOMADORA}</style>
            <div className="border-b-2 border-slate-900 pb-2 flex items-start justify-between">
              <div>
                <p className="text-[15px] font-semibold">MMG · Movimentação de Mercadorias em Geral</p>
                <p>Situação do rodízio por {ehEmpresa ? "empresa tomadora" : "unidade tomadora"} · Lei 12.023/2009, art. 5º, I e II</p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-semibold">{a.titulo}</p>
                <p>
                  {ehEmpresa ? `${a.unidades} unidades em ${a.locais} locais` : (a.cidade || "")}
                  {" · "}emitido em {new Date().toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
            <p className="py-2">
              Ativos {r.ativos} · obrigados ao rodízio {r.obrigados} · precisam rodar {r.precisam} · em dia {r.em_dia} ·
              isentos {r.isentos} · safristas {r.safristas} · dias a cumprir {r.dias_a_cumprir}.
              Meta: {d.regras.tipo_meta === "dias" ? `${d.regras.meta_dias} dias fixos` : "percentual dos dias de entressafra"} ·
              ativo = movimento nos últimos {d.regras.dias_ativo} dias da janela.
            </p>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead><tr className="text-left text-slate-500">
                <th className="px-1 py-0.5">Código</th><th className="px-1 py-0.5">Nome</th>
                {ehEmpresa && <th className="px-1 py-0.5">Local-base</th>}
                <th className="px-1 py-0.5">Situação</th>
                <th className="px-1 py-0.5 text-right">Dias</th><th className="px-1 py-0.5 text-right">Entressafra</th>
                <th className="px-1 py-0.5 text-right">Fora</th><th className="px-1 py-0.5 text-right">Meta</th><th className="px-1 py-0.5 text-right">Falta</th>
              </tr></thead>
              <tbody>
                {d.pessoas.map((p) => (
                  <tr key={p.codigo} className="border-t border-slate-200">
                    <td className="px-1 py-0.5 tabular-nums">{p.codigo}</td>
                    <td className="px-1 py-0.5">{p.nome || "sem cadastro"}</td>
                    {ehEmpresa && <td className="px-1 py-0.5">{p.local_base}</td>}
                    <td className="px-1 py-0.5">{p.situacao}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{p.dias}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{p.dias_entressafra}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{p.dias_fora}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{p.meta}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{p.falta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.pedidos.length > 0 && (
              <>
                <p className="mt-3 font-semibold">Pedidos</p>
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <tbody>
                    {d.pedidos.slice(0, 30).map((pd) => (
                      <tr key={pd.id} className="border-t border-slate-200">
                        <td className="px-1 py-0.5">{dataBR(pd.criado_em)}</td>
                        <td className="px-1 py-0.5">{pd.unidade_codigo}</td>
                        <td className="px-1 py-0.5">{pd.tipo === "avulsa" ? `${dataBR(pd.previsao_inicio)}${pd.previsao_fim ? ` a ${dataBR(pd.previsao_fim)}` : " em diante"}` : rotuloQz(pd)}</td>
                        <td className="px-1 py-0.5 text-right tabular-nums">{pd.quantidade}</td>
                        <td className="px-1 py-0.5">{pd.solicitante_nome}</td>
                        <td className="px-1 py-0.5">{pd.status.replace("_", " ")}{pd.fora_do_prazo ? " · fora do prazo" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <p className="mt-3 text-slate-500" style={{ fontSize: "9px" }}>
              Documento gerado pelo MMG Sindicatos. Situação apurada pela janela de doze meses do sistema, a partir do ponto das unidades tomadoras.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
 * AJUSTES DO LOCAL — 28/09/2026
 * O que o MMG+ não conhece: local sem empresa ou sem cidade. Só aparece
 * quando falta alguma das duas, e só para quem pode editar.
 * ---------------------------------------------------------------- */
function AjustesDoLocal({ token, local, empresas, podeEditar, aoAtualizar }) {
  const [empresaId, setEmpresaId] = useState("");
  const [cidade, setCidade] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  if (!podeEditar || (local.empresa && local.cidade)) return null;

  async function ligar() {
    setSalvando(true); setErro("");
    try { await gravar(`/painel/local/${local.id}/empresa`, token, { empresa_id: empresaId }); await aoAtualizar(); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }
  async function definirCidade() {
    setSalvando(true); setErro("");
    try { await gravar(`/painel/local/${local.id}/cidade`, token, { cidade }); await aoAtualizar(); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  return (
    <div className="mt-2 flex gap-2 flex-wrap items-center">
      {!local.empresa && (
        <>
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px]">
            <option value="">Sem empresa — escolher…</option>
            {(empresas || []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <button onClick={ligar} disabled={!empresaId || salvando}
            className="bg-teal-600 text-white rounded-lg px-3 py-1.5 text-[12px] disabled:opacity-40">Ligar</button>
        </>
      )}
      {!local.cidade && (
        <>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade do local"
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] w-44" />
          <button onClick={definirCidade} disabled={cidade.trim().length < 3 || salvando}
            className="bg-teal-600 text-white rounded-lg px-3 py-1.5 text-[12px] disabled:opacity-40">Gravar cidade</button>
        </>
      )}
      {erro && <span className="text-[11px] text-rose-600">{erro}</span>}
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
  const [novo, setNovo] = useState({ nome: "", usuario: "", senha: "", perfil: "leitura", tipo: "gerente" });
  const [salvando, setSalvando] = useState(false);

  const [editandoUnidades, setEditandoUnidades] = useState(null);
  const [buscaUnidade, setBuscaUnidade] = useState("");
  const [unidadesBusca, setUnidadesBusca] = useState([]);
  const [unidadesSelecionadas, setUnidadesSelecionadas] = useState([]);
  const [buscandoUnidades, setBuscandoUnidades] = useState(false);
  const [salvandoUnidades, setSalvandoUnidades] = useState(false);

  const recarregar = async () => {
    try {
      const dados = await pedir("/auth/usuarios", token);
      setLinhas(dados);
      return dados;
    } catch (e) {
      setErro(e.message);
      return [];
    }
  };

  useEffect(() => { recarregar(); }, [token]);

  useEffect(() => {
    if (!editandoUnidades) return;
    const t = setTimeout(async () => {
      setBuscandoUnidades(true);
      try {
        const q = buscaUnidade.trim();
        const dados = await pedir(`/auth/unidades${q ? `?q=${encodeURIComponent(q)}` : ""}`, token);
        setUnidadesBusca(dados);
      } catch (e) {
        setErro(e.message);
      } finally {
        setBuscandoUnidades(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [buscaUnidade, editandoUnidades, token]);

  async function criar() {
    setSalvando(true); setErro(""); setAviso("");
    try {
      const gerente = novo.tipo === "gerente";
      const criado = await gravar("/auth/usuarios", token, {
        nome: novo.nome,
        usuario: novo.usuario,
        senha: novo.senha,
        perfil: gerente ? "leitura" : novo.perfil,
        somente_assinatura: gerente,
      }, "POST");
      setNovo({ nome: "", usuario: "", senha: "", perfil: "leitura", tipo: "gerente" });
      const dados = await recarregar();
      setAviso(gerente
        ? `${criado.nome} criado como gerente. Agora vincule as unidades pelas quais ele responde.`
        : `${criado.nome} criado. Passe a senha por um canal seguro.`);
      if (gerente) {
        const atualizado = dados.find((u) => u.id === criado.id) || { ...criado, unidades: [] };
        abrirUnidades(atualizado);
      }
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  async function mudar(id, corpo) {
    setErro(""); setAviso("");
    try {
      await gravar(`/auth/usuarios/${id}`, token, corpo, "PATCH");
      await recarregar();
    } catch (e) { setErro(e.message); }
  }

  function abrirUnidades(u) {
    setEditandoUnidades(u);
    setBuscaUnidade("");
    setUnidadesBusca([]);
    setUnidadesSelecionadas((u.unidades || []).map((x) => x.id));
    setErro("");
  }

  function fecharUnidades() {
    setEditandoUnidades(null);
    setBuscaUnidade("");
    setUnidadesBusca([]);
    setUnidadesSelecionadas([]);
  }

  function alternarUnidade(id) {
    setUnidadesSelecionadas((lista) =>
      lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  }

  async function salvarUnidades() {
    if (!editandoUnidades) return;
    setSalvandoUnidades(true); setErro(""); setAviso("");
    try {
      await gravar(`/auth/usuarios/${editandoUnidades.id}/unidades`, token,
        { unidade_ids: unidadesSelecionadas }, "PUT");
      const nome = editandoUnidades.nome;
      fecharUnidades();
      await recarregar();
      setAviso(`${nome}: unidades responsáveis atualizadas.`);
    } catch (e) { setErro(e.message); } finally { setSalvandoUnidades(false); }
  }

  async function tornarInterno(u) {
    if (!window.confirm(`Remover ${u.nome} como gerente das unidades e liberar como acesso interno?`)) return;
    setErro(""); setAviso("");
    try {
      await gravar(`/auth/usuarios/${u.id}/unidades`, token, { unidade_ids: [] }, "PUT");
      await gravar(`/auth/usuarios/${u.id}`, token, { somente_assinatura: false, perfil: "leitura" }, "PATCH");
      await recarregar();
      setAviso(`${u.nome} agora é um acesso interno de leitura.`);
    } catch (e) { setErro(e.message); }
  }

  const PERFIL_TEXTO = {
    admin: "mexe em usuários e em tudo",
    gestor: "grava calendário, critérios e ponto",
    leitura: "só consulta",
  };

  const selecionadasSet = new Set(unidadesSelecionadas);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Quem tem acesso</p>
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
          Gerentes de unidade têm conta própria, mas o acesso deles é exclusivo para assinatura.
          Cada unidade fica vinculada a um gerente responsável; a requisição escolhe esse assinante automaticamente.
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
          <select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
            <option value="gerente">Gerente de unidade — somente assinatura</option>
            <option value="interno">Equipe interna</option>
          </select>
          {novo.tipo === "interno" && (
            <select value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] sm:col-span-2">
              <option value="leitura">Leitura — só consulta</option>
              <option value="gestor">Gestor — grava calendário, critérios e ponto</option>
              <option value="admin">Admin — mexe em usuários também</option>
            </select>
          )}
        </div>
        <button onClick={criar} disabled={salvando || !novo.nome || !novo.usuario || !novo.senha}
          className="mt-3 bg-teal-600 text-white rounded-lg px-4 py-2 text-[13px] font-medium disabled:opacity-50">
          {salvando ? "Criando…" : novo.tipo === "gerente" ? "Criar gerente" : "Criar acesso"}
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
                <th className="text-left px-3 py-2">Tipo / perfil</th>
                <th className="text-left px-3 py-2">Unidades</th>
                <th className="text-left px-3 py-2">Último acesso</th>
                <th className="text-left px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {(linhas || []).map((u) => (
                <tr key={u.id} className={`border-t border-slate-50 align-top ${u.ativo ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2 font-medium">{u.nome}</td>
                  <td className="px-3 py-2 text-slate-600">{u.usuario}</td>
                  <td className="px-3 py-2 min-w-[190px]">
                    {u.somente_assinatura ? (
                      <div>
                        <span className="inline-block bg-violet-100 text-violet-800 rounded px-2 py-1 text-[11px]">
                          gerente · só assinatura
                        </span>
                        <button onClick={() => tornarInterno(u)}
                          className="block text-[10.5px] text-slate-500 underline mt-1">
                          transformar em acesso interno
                        </button>
                      </div>
                    ) : (
                      <>
                        <select value={u.perfil} onChange={(e) => mudar(u.id, { perfil: e.target.value })}
                          className="border border-slate-200 rounded px-2 py-1 text-[11.5px]">
                          <option value="leitura">leitura</option>
                          <option value="gestor">gestor</option>
                          <option value="admin">admin</option>
                        </select>
                        <span className="block text-[10px] text-slate-400 mt-0.5">{PERFIL_TEXTO[u.perfil]}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 min-w-[220px]">
                    {(u.unidades || []).length > 0 ? (
                      <div className="space-y-0.5">
                        {(u.unidades || []).slice(0, 3).map((un) => (
                          <p key={un.id} className="text-[10.5px] text-slate-600">
                            <b>{un.codigo}</b> · {un.nome}
                          </p>
                        ))}
                        {(u.unidades || []).length > 3 && (
                          <p className="text-[10px] text-slate-400">+ {(u.unidades || []).length - 3} unidade(s)</p>
                        )}
                      </div>
                    ) : <span className="text-[10.5px] text-slate-400">nenhuma vinculada</span>}
                    <button onClick={() => abrirUnidades(u)}
                      className="block mt-1 text-[11px] text-violet-700 underline font-medium">
                      {(u.unidades || []).length ? "Editar unidades" : "Vincular unidades"}
                    </button>
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
                <tr><td colSpan="6" className="px-3 py-4 text-slate-400">Nenhum acesso criado ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editandoUnidades && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 p-4 overflow-y-auto" onClick={fecharUnidades}>
          <div className="bg-white rounded-2xl max-w-2xl mx-auto mt-8 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold">Gerente responsável</p>
                <h2 className="text-lg font-semibold mt-1">{editandoUnidades.nome}</h2>
                <p className="text-[12px] text-slate-500">
                  Marque todas as unidades pelas quais esta pessoa responde. Uma unidade só pode ter um gerente.
                </p>
              </div>
              <button onClick={fecharUnidades} className="text-xl text-slate-400">×</button>
            </div>

            <input value={buscaUnidade} onChange={(e) => setBuscaUnidade(e.target.value)}
              placeholder="Buscar por número, unidade, local ou cidade…"
              className="mt-4 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px]" />

            <div className="mt-3 border border-slate-200 rounded-xl max-h-[50vh] overflow-y-auto">
              {buscandoUnidades && <p className="p-3 text-[12px] text-slate-400">Buscando…</p>}
              {!buscandoUnidades && unidadesBusca.map((un) => {
                const marcada = selecionadasSet.has(un.id);
                const outroGerente = un.gerente_usuario_id
                  && String(un.gerente_usuario_id) !== String(editandoUnidades.id);
                return (
                  <label key={un.id} className={`flex items-start gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 cursor-pointer ${
                    marcada ? "bg-violet-50" : ""}`}>
                    <input type="checkbox" checked={marcada} onChange={() => alternarUnidade(un.id)} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-slate-900"><b>{un.codigo}</b> · {un.nome}</p>
                      <p className="text-[10.5px] text-slate-500">{[un.local, un.cidade].filter(Boolean).join(" · ") || "—"}</p>
                      {outroGerente && (
                        <p className="text-[10.5px] text-amber-700 mt-0.5">
                          Hoje pertence a {un.gerente_nome}. Ao salvar, será transferida para {editandoUnidades.nome}.
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
              {!buscandoUnidades && unidadesBusca.length === 0 && (
                <p className="p-3 text-[12px] text-slate-400">Nenhuma unidade encontrada.</p>
              )}
            </div>

            <div className="mt-3 bg-slate-50 rounded-xl px-3 py-2 text-[11.5px] text-slate-600">
              {unidadesSelecionadas.length} unidade(s) selecionada(s).
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={salvarUnidades} disabled={salvandoUnidades}
                className="flex-1 bg-violet-600 text-white rounded-xl py-2.5 text-[12.5px] font-semibold disabled:opacity-50">
                {salvandoUnidades ? "Salvando…" : "Salvar unidades do gerente"}
              </button>
              <button onClick={fecharUnidades}
                className="border border-slate-200 rounded-xl px-4 py-2.5 text-[12.5px] text-slate-600">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        O login de administração continua valendo e não aparece nesta lista. Gerentes só conseguem usar as rotas de assinatura.
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
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [soSemEmpresa, setSoSemEmpresa] = useState(false);
  const [alvoTomadora, setAlvoTomadora] = useState(null);

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
        pedir("/painel/empresas", token).catch(() => []),
      ])
        .then(([resumo, curva, locais, fila, semCadastro, safristas, reqs, empresas]) =>
          setD({ resumo, curva, locais, fila, semCadastro, safristas, reqs, empresas }))
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
        (!filtroEmpresa || x.empresa_id === filtroEmpresa) &&
        (!filtroLocal || x.local_base === filtroLocal) &&
        (!soSemNivel1 || c.nivel >= 3) &&
        passaRaio
      );
    });
  }, [d, buscaFila, filtroEmpresa, filtroLocal, soSemNivel1, raio]);

  const locaisFiltrados = useMemo(() => {
    if (!d) return [];
    const t = buscaLocal.trim().toLowerCase();
    return d.locais.filter(
      (l) =>
        (!t || l.local_base.toLowerCase().includes(t) || (l.cidade || "").toLowerCase().includes(t)) &&
        (!soSemPonto || l.fonte !== "mapa") &&
        (!soSemEmpresa || !l.empresa)
    );
  }, [d, buscaLocal, soSemPonto, soSemEmpresa]);

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
  const empresas = d.empresas || [];
  const j = resumo.janela, a = resumo.ativos, r = resumo.regras, fx = resumo.fixos;
  const comPonto = resumo.base.locais_com_ponto ?? 0;
  const metaTexto = r.tipo_meta === "dias"
    ? `A meta é fixa: ${r.meta_dias} dias fora da unidade-base para todo obrigado.`
    : `A meta é ${j.percentual}% dos dias de entressafra de cada um, com teto de ${j.teto_dias}.`;

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
              Janela de {dataBR(j.janela_inicio)} a {dataBR(j.janela_fim)}
              {j.congelado ? " · congelada" : ""} · {r.tipo_meta === "dias" ? `meta de ${r.meta_dias} dias` : `${j.percentual}% da entressafra`}
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
          {[["painel","Painel"],["safra","Safra"],["criterios","Critérios"],["locais","Locais"],["tomadora","Tomadora"],["fila","Fila"],
            ["requisicoes","Requisições"],["escalas","Escalas"],
            ["safristas","Safristas fixos"],["cadastro","Sem cadastro"],
            ...(podeEditar ? [["importar","Importar"]] : []),
            ...(eu.perfil === "admin" ? [["usuarios","Acessos"]] : [])].map(([k, rot]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium ${
                aba === k ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
              {rot}
              {k === "criterios" && j.congelado && (
                <span className="ml-1.5 text-[10px] bg-sky-400 text-sky-950 rounded px-1">congelados</span>
              )}
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
          <Lista token={token} grupo={grupo} locais={locais} empresas={empresas} aoAbrirFicha={setFicha}
                 aoVoltar={() => setAba("painel")} diasPorMes={r.dias_por_mes} />
        )}

        {aba === "painel" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Cartao rotulo="Ativos" valor={a.ativos} aoClicar={() => abrirGrupo("ativos")}
                      sub={`com movimento nos últimos ${r.dias_ativo} dias da janela`} />
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
                <li><b>Ativos</b> — trabalharam ao menos um dia nos últimos {r.dias_ativo} dias da janela. Só eles entram no rodízio.</li>
                <li><b>Obrigados</b> — dos ativos, os que somam {j.isencao_dias} dias ou mais trabalhados nos meses de entressafra da janela. Abaixo disso, isento.</li>
                <li><b>Precisam rodar</b> — obrigados cuja meta ainda não foi cumprida. {metaTexto}</li>
                <li><b>Em dia</b> — obrigados que já acumularam dias fora da unidade-base suficientes.</li>
                <li><b>A janela</b> termina em {dataBR(j.janela_fim)}{j.congelado
                  ? ", data em que foi congelada — dias apurados depois disso não mudam quem está em dia."
                  : ", que é o último dia apurado — não a data de hoje. Dia que ainda não foi apurado não pode contar, então a janela anda quando a apuração do mês entra."}</li>
                <li><b>Unidade viva</b> — teve ao menos um trabalhador nos últimos {r.dias_unidade_ativa} dias contados do último dia apurado. Unidade parada não entra como destino de rodízio: hoje são {resumo.base.unidades_vivas} das {resumo.base.unidades} cadastradas, em {resumo.base.locais_vivos} locais.</li>
              </ul>
              <p className="text-[11px] text-teal-700 mt-2">
                Clique em qualquer cartão para ver quem são. Os números da regra ficam na aba Critérios.
              </p>
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
        {aba === "escalas" && (
          <Escalas token={token} podeEditar={podeEditar} pedir={pedir} gravar={gravar} />
        )}
        {aba === "safra" && <Safra token={token} aoAtualizar={carregar} podeEditar={podeEditar} />}
        {aba === "tomadora" && <Tomadora token={token} locais={locais} empresas={empresas} inicial={alvoTomadora} aoAbrirFicha={setFicha} />}
        {aba === "criterios" && (
          <Criterios token={token} aoAtualizar={carregar} podeEditar={podeEditar}
                     souAdmin={eu.perfil === "admin"} />
        )}

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
              <button onClick={() => setSoSemEmpresa((v) => !v)}
                className={`px-3 py-2 rounded-lg text-[13px] border ${
                  soSemEmpresa ? "bg-slate-900 text-white border-slate-900"
                               : "bg-white text-slate-600 border-slate-200"}`}>
                Só quem está sem empresa
              </button>
              <span className="text-[12px] text-slate-500">{locaisFiltrados.length} de {locais.length}</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {locaisFiltrados.map((l) => (
                <div key={l.id} className="px-4 py-3 border-b border-slate-50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {l.local_base}
                        {l.empresa
                          ? <span className="ml-2 text-[11px] text-slate-500">· {l.empresa}</span>
                          : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">sem empresa</span>}
                      </p>
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
                      <AjustesDoLocal token={token} local={l} empresas={empresas}
                                      podeEditar={podeEditar} aoAtualizar={carregar} />
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
              <select value={filtroEmpresa} onChange={(e) => { setFiltroEmpresa(e.target.value); setFiltroLocal(""); }}
                className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
                <option value="">Todas as empresas</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
                <option value="">Todos os locais</option>
                {locais.filter((l) => !filtroEmpresa || l.empresa_id === filtroEmpresa)
                  .map((l) => <option key={l.id} value={l.local_base}>{l.local_base}</option>)}
              </select>
              {filtroEmpresa && (
                <button onClick={() => { setAlvoTomadora({ tipo: "empresa", id: filtroEmpresa, n: Date.now() }); setAba("tomadora"); }}
                  className="px-3 py-2 rounded-lg text-[13px] border border-teal-300 text-teal-700 bg-white">
                  Abrir a tela da empresa →
                </button>
              )}
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

  /* QR público de validação da assinatura. Não exige login. */
  const codigoValidacao = params.get("validar");
  if (codigoValidacao) {
    return <ValidarAssinatura codigo={codigoValidacao} />;
  }

  /* QR de assinatura. O token `st` é da solicitação e não substitui o login:
     o usuário ainda precisa entrar com seu acesso próprio. */
  const assinaturaId = params.get("assinar");
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const tokenAssinatura = hashParams.get("st") || params.get("st"); // compatibilidade com links antigos
  if (assinaturaId && tokenAssinatura) {
    return token
      ? <AssinarRequisicao jwt={token} assinaturaId={assinaturaId} tokenAssinatura={tokenAssinatura} sair={sair} />
      : <Login aoEntrar={setToken} />;
  }

  /* Endereço público da convocação: ?c=token */
  const linkConvocacao = params.get("c");
  if (linkConvocacao) {
    return <Convocacao token={linkConvocacao} />;
  }

  const eu = token ? lerToken(token) : null;
  if (token && eu?.somente_assinatura) {
    return (
      <div className="min-h-screen bg-slate-900 grid place-items-center px-4">
        <div className="bg-white rounded-2xl p-8 w-full max-w-sm text-center">
          <img src="/logo-mmg.png" alt="MMG" className="h-12 w-auto mx-auto mb-4" />
          <p className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold">Acesso de gerente</p>
          <h1 className="font-semibold text-slate-900 mt-1">Seu acesso é exclusivo para assinaturas</h1>
          <p className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
            Abra o QR ou o link enviado pela MMG para conferir e assinar a requisição da sua unidade.
          </p>
          {ASSINATURA_SITE && (
            <a href={ASSINATURA_SITE}
              className="block mt-4 bg-violet-600 text-white rounded-xl py-3 text-[13px] font-semibold">
              Abrir portal de assinaturas
            </a>
          )}
          <button onClick={sair} className="mt-3 text-[12px] text-slate-500 underline">Sair</button>
        </div>
      </div>
    );
  }

  return token ? <Painel token={token} sair={sair} /> : <Login aoEntrar={setToken} />;
}
