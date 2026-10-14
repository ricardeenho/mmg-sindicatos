import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "./Profissional.jsx";

/* 11/10/2026 — RODÍZIO POR UNIDADE
   Cada Gestor MMG Responsável roda as unidades que assumiu. Três colunas:
   unidades | unidade aberta | destinos e par. A COR da unidade é a
   urgência, calculada da apuração; o SELO é o andamento da quinzena.
   O Gestor MMG Responsável não é o gerente de unidade (que é da empresa
   tomadora e só assina requisição). */

const dataBR = (d) => {
  if (!d) return "";
  const [a, m, dia] = String(d).slice(0, 10).split("-");
  return a && m && dia ? `${dia}/${m}/${a}` : "";
};
const diaMes = (d) => dataBR(d).slice(0, 5);
const horaBR = (d) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const D = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00Z`);
const txt = (d) => d.toISOString().slice(0, 10);
const somaDias = (s, k) => { const d = D(s); d.setUTCDate(d.getUTCDate() + k); return txt(d); };
const diasEntre = (a, b) => Math.round((D(b) - D(a)) / 86400000) + 1;
const primeiroNome = (s) => String(s || "").split(" ")[0];
const cap = (s) => String(s || "").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/* Semanas de segunda a sexta que cabem inteiras na quinzena. */
function semanasDa(inicio, fim) {
  const out = [];
  let d = inicio;
  while (D(d).getUTCDay() !== 1) d = somaDias(d, 1);
  while (somaDias(d, 4) <= fim) { out.push([d, somaDias(d, 4)]); d = somaDias(d, 7); }
  return out;
}

const SELO = {
  pendente:  { txt: "Pendente",     cls: "border border-dashed border-slate-300 text-slate-500" },
  andamento: { txt: "Em andamento", cls: "bg-sky-50 text-sky-700" },
  concluida: { txt: "Concluída",    cls: "bg-emerald-50 text-emerald-700" },
  mantida:   { txt: "Mantida",      cls: "bg-teal-50 text-teal-700" },
  ajuste:    { txt: "Ajuste",       cls: "bg-amber-50 text-amber-700" },
};
const MOTIVOS_MANTER = [
  "Único setor na cidade, sem destino perto",
  "Efetivo mínimo, sem como repor",
  "Ninguém deve dias",
  "Destinos da mesma cidade parados",
];

function Selo({ status }) {
  const s = SELO[status] || SELO.pendente;
  return <span className={`text-[10.5px] font-semibold rounded-md px-2 py-0.5 whitespace-nowrap ${s.cls}`}>{s.txt}</span>;
}

function urgencia(u, pessoas) {
  const ps = pessoas.filter((p) => p.unidade_id === u.id && !p.ausente && p.perfil === "permanente");
  const max = Math.max(0, ...ps.map((p) => p.falta));
  if (max === 0) return { k: "g", barra: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", txt: "Ninguém deve dias" };
  if (max > 5 && !u.rodou) return { k: "r", barra: "bg-rose-500", chip: "bg-rose-50 text-rose-700", txt: `Há quem deva ${max} dias e a unidade não rodou na última quinzena` };
  return { k: "a", barra: "bg-amber-500", chip: "bg-amber-50 text-amber-700", txt: u.rodou ? `Rodou na última quinzena; ainda há quem deva ${max} dias` : `O maior saldo é de ${max} dias` };
}

function TagPessoa({ p }) {
  if (p.ausente) return <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-slate-100 text-slate-600">Ausente na quinzena</span>;
  if (p.perfil === "permanente" && p.falta > 0) return <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-amber-50 text-amber-700">Deve {p.falta} dias</span>;
  if (p.perfil === "permanente") return <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-emerald-50 text-emerald-700">Em dia</span>;
  return <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-slate-100 text-slate-600">{p.perfil === "safrista" ? "Safrista" : "Isento"}</span>;
}

const RESPOSTA = { aceita: "Aceitou", recusada: "Recusou", vista: "Viu, sem responder", enviada: "Sem resposta" };

/* =================================================================== */
export default function RodizioUnidade({ token, podeEditar, pedir, gravar }) {
  const [inicio, setInicio] = useState(null);
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const [vista, setVista] = useState("unidades");
  const [filtro, setFiltro] = useState("minhas");
  const [cidade, setCidade] = useState("Todas");
  const [busca, setBusca] = useState("");
  /* 11/10: em "Minhas" o bloco de cidades começa recolhido; nas outras abas, aberto */
  const [cidadesAbertas, setCidadesAbertas] = useState(false);
  const [uSel, setUSel] = useState(null);
  const [pSel, setPSel] = useState(null);
  const [dSel, setDSel] = useState(null);
  const [parSel, setParSel] = useState(null);
  const [periodo, setPeriodo] = useState(0);
  const [pIni, setPIni] = useState("");
  const [pFim, setPFim] = useState("");
  const [buscaOutra, setBuscaOutra] = useState(null);
  const [painel, setPainel] = useState(null);
  const [motivoManter, setMotivoManter] = useState("");
  const [confirmar, setConfirmar] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const r = await pedir(`/rodizio/quinzena${inicio ? `?inicio=${inicio}` : ""}`, token);
      setD(r); setErro("");
    } catch (e) { setErro(e.message); }
  }, [inicio, token, pedir]);
  useEffect(() => { carregar(); }, [carregar]);

  async function agir(caminho, corpo, ok) {
    setOcupado(true);
    try {
      const r = await gravar(caminho, token, corpo || {}, "POST");
      if (ok) toast(typeof ok === "function" ? ok(r) : ok);
      await carregar();
      return r;
    } catch (e) { toast(e.message, "erro"); return null; }
    finally { setOcupado(false); }
  }

  const eu = d?.eu || {};
  const q = d?.quinzena;
  const unidades = d?.unidades || [];
  const pessoas = d?.pessoas || [];
  const trocasVivas = useMemo(() => (d?.trocas || []).filter((t) => t.estado !== "recusada"), [d]);
  const uDe = (id) => unidades.find((u) => u.id === id);
  const pDe = (id) => pessoas.find((p) => p.id === id);
  const minha = (u) => !!u && !!eu.id && u.gestor_id === eu.id;
  const trocaDe = (id) => trocasVivas.find((t) => t.a_trabalhador_id === id || t.b_trabalhador_id === id);
  const recusadaDe = (id) => (d?.trocas || []).find((t) => t.estado === "recusada" && (t.a_trabalhador_id === id || t.b_trabalhador_id === id));
  const editavel = (u) => podeEditar && minha(u) && q && q.etapa !== "publicada";

  const semanas = useMemo(() => (q ? semanasDa(q.inicio, q.fim) : []), [q]);
  useEffect(() => { if (q) { setPIni(semanas[0]?.[0] || q.inicio); setPFim(semanas[0]?.[0] ? somaDias(semanas[0][0], 2) : q.inicio); } }, [q?.id]); // eslint-disable-line

  if (erro && !d) return <p className="text-sm text-rose-600">{erro}</p>;
  if (!d) return <p className="text-sm text-slate-400">Carregando…</p>;

  /* ---------------- números da quinzena ---------------- */
  const resolvidas = unidades.filter((u) => u.gestor_id && ["concluida", "mantida"].includes(u.status)).length;
  const semGestor = unidades.filter((u) => !u.gestor_id).length;
  const conta = (s) => unidades.filter((u) => u.status === s).length;
  const faltam = unidades.length - resolvidas;
  const recusas = (d.trocas || []).filter((t) => t.estado === "recusada").length;
  const cidades = ["Todas", ...[...new Set(unidades.map((u) => u.cidade).filter(Boolean))].sort()];
  const regras = d.regras || {};
  const limiteBloco = regras.dias_por_mes || 5;

  const etapas = [
    ["montagem", `Até ${diaMes(d.calendario.previa)}`, "Cada gestor roda as suas unidades"],
    ["previa", diaMes(d.calendario.previa), "Prévia vai a quem muda de unidade"],
    ["ajustes", `${diaMes(d.calendario.publicacao)} · manhã`, "Ajustar o que foi recusado"],
    ["publicada", diaMes(d.calendario.publicacao), "Escala definitiva publicada"],
  ];
  const idxEtapa = q.etapa === "montagem" ? 0 : q.etapa === "ajustes" ? 2 : 3;

  /* ---------------- ações ---------------- */
  const abrirUnidade = (id) => { setUSel(id); setPSel(null); setDSel(null); setParSel(null); setPainel(null); setBuscaOutra(null); };
  const assumir = (u) => agir(`/rodizio/unidades/${u.id}/assumir`, {}, `Você agora é o Gestor MMG Responsável pela ${u.codigo}`);
  const deixar = (u) => agir(`/rodizio/unidades/${u.id}/deixar`, {}, `A ${u.codigo} ficou sem Gestor MMG Responsável`);
  const status = (u, s, motivo) => agir(`/rodizio/quinzenas/${q.id}/unidades/${u.id}/status`, { status: s, motivo },
    s === "concluida" ? `Unidade ${u.codigo} finalizada` : s === "mantida" ? `Unidade ${u.codigo}: colaboradores mantidos` : `Unidade ${u.codigo} reaberta`)
    .then((r) => { if (r) { setPainel(null); setMotivoManter(""); } });
  const ausente = (p, sim) => agir(`/rodizio/quinzenas/${q.id}/ausente`, { trabalhador_id: p.id, unidade_id: p.unidade_id, ausente: sim });
  const desfazer = (t, motivo) => agir(`/rodizio/trocas/${t.id}/desfazer`, { motivo }, "Troca desfeita. As duas unidades precisam ser revistas.");

  const periodoAtual = periodo < semanas.length ? semanas[periodo] : [pIni, pFim];
  const diasPeriodo = periodoAtual[0] && periodoAtual[1] ? diasEntre(periodoAtual[0], periodoAtual[1]) : 0;
  const periodoValido = periodoAtual[0] && periodoAtual[1] && periodoAtual[0] <= periodoAtual[1]
    && periodoAtual[0] >= q.inicio && periodoAtual[1] <= q.fim && diasPeriodo <= limiteBloco;

  async function validarTroca() {
    const a = pDe(pSel), b = pDe(parSel);
    const r = await agir(`/rodizio/quinzenas/${q.id}/trocas`, {
      a_trabalhador_id: a.id, a_unidade_id: a.unidade_id, b_trabalhador_id: b.id, b_unidade_id: b.unidade_id,
      data_inicio: periodoAtual[0], data_fim: periodoAtual[1],
    }, (r) => `Troca validada: ${cap(primeiroNome(a.nome))} ⇄ ${cap(primeiroNome(b.nome))}${r.outro_gestor ? ` · ${r.outro_gestor} verá a troca na unidade dele` : ""}`);
    if (r) { setPSel(null); setDSel(null); setParSel(null); setBuscaOutra(null); }
  }

  /* =================================================================
   * TOPO, ETAPAS E PROGRESSO
   * =============================================================== */
  const topo = (
    <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-wrap gap-4 items-center justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[17px] font-semibold">Rodízio por Unidade</h2>
          <select value={q.inicio} onChange={(e) => { setInicio(e.target.value); abrirUnidade(null); }}
            className="!bg-slate-800 !text-white !border-slate-700 border rounded-lg px-2 py-1 text-[12.5px]">
            {[...(d.opcoes || []), ...((d.opcoes || []).some((o) => o.inicio === q.inicio) ? [] : [{ inicio: q.inicio, fim: q.fim, numero: q.numero }])]
              .map((o) => <option key={o.inicio} value={o.inicio}>{o.numero === 1 ? "1ª" : "2ª"} quinzena · {diaMes(o.inicio)} a {dataBR(o.fim)}</option>)}
          </select>
        </div>
        <p className="text-[12px] text-slate-400 mt-1">
          Ativos para a escala: últimos {regras.dias_ativo_escala} dias apurados (até {dataBR(regras.ultimo_dia_apurado)}) · bloco de rodízio de até {limiteBloco} dias
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {etapas.map(([k, quando, oque], i) => (
          <span key={k} className={`rounded-full px-3 py-1 text-[11.5px] border ${
            i === idxEtapa ? "bg-teal-600 border-teal-600 text-white" : i < idxEtapa ? "border-teal-800 text-teal-300" : "border-slate-700 text-slate-400"}`}>
            <b className="font-semibold">{quando}</b> {oque}
          </span>
        ))}
      </div>
    </div>
  );

  let acao;
  if (q.etapa === "montagem") {
    acao = (
      <div className="flex flex-col items-end gap-1">
        <button disabled={!podeEditar || faltam > 0 || ocupado} onClick={() => setConfirmar("previa")}
          className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40">
          Enviar prévia aos colaboradores
        </button>
        <span className="text-[11.5px] text-slate-500">
          {faltam ? `Faltam ${faltam} ${faltam === 1 ? "unidade" : "unidades"}${semGestor ? `, ${semGestor} sem Gestor MMG Responsável` : ""}` : "Todas as unidades resolvidas"}
        </span>
      </div>
    );
  } else if (q.etapa === "ajustes") {
    acao = (
      <div className="flex flex-col items-end gap-1">
        <button disabled={!podeEditar || faltam > 0 || ocupado} onClick={() => setConfirmar("publicar")}
          className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40">
          Publicar escala definitiva
        </button>
        <span className="text-[11.5px] text-slate-500">
          {faltam ? `${faltam} ${faltam === 1 ? "unidade precisa" : "unidades precisam"} de atenção` : "Pronta para publicar"}
          {d.previa && ` · prévia enviada em ${horaBR(d.previa.previa_em)} por ${d.previa.previa_por}`}
        </span>
      </div>
    );
  } else {
    acao = (
      <div className="text-right">
        <p className="text-[13px] font-semibold">Escala {String(d.definitiva.numero).padStart(3, "0")}/{d.definitiva.ano} publicada</p>
        <p className="text-[11.5px] text-slate-500">{horaBR(d.definitiva.publicada_em)} por {d.definitiva.publicada_por} · não se altera</p>
      </div>
    );
  }

  const segs = [["concluida", "bg-emerald-500"], ["mantida", "bg-teal-500"], ["andamento", "bg-sky-500"], ["ajuste", "bg-amber-500"]];
  const progresso = (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-4 items-center">
      <div className="flex-1 min-w-[240px]">
        <div className="flex justify-between gap-2 mb-1.5">
          <b className="text-[13.5px]">{resolvidas} de {unidades.length} unidades resolvidas</b>
          <span className="text-[11.5px] text-slate-500">{trocasVivas.length} trocas · {pessoas.filter((p) => p.ausente).length} ausentes · {recusas} recusas</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex">
          {segs.map(([k, c]) => <i key={k} className={`block h-full ${c}`} style={{ width: `${unidades.length ? conta(k) / unidades.length * 100 : 0}%` }} />)}
        </div>
        <div className="flex flex-wrap gap-3 mt-1.5 text-[11.5px] text-slate-500">
          {segs.map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><i className={`w-2 h-2 rounded-full ${c}`} />{SELO[k].txt} {conta(k)}</span>)}
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-slate-300" />Pendente {conta("pendente")}</span>
        </div>
      </div>
      <div className="flex gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
        {[["unidades", "Unidades"], ["escala", "Escala geral"]].map(([k, r]) => (
          <button key={k} onClick={() => setVista(k)}
            className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${vista === k ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>{r}</button>
        ))}
      </div>
      {acao}
    </div>
  );

  const caixaConfirmar = typeof confirmar === "string" && (
    <div className="bg-white border-2 border-teal-500 rounded-2xl p-4 flex flex-col gap-2">
      <b className="text-[14px]">{confirmar === "previa" ? "Enviar a prévia da quinzena?" : "Publicar a escala definitiva?"}</b>
      <p className="text-[12.5px] text-slate-600 leading-relaxed max-w-2xl">
        {confirmar === "previa"
          ? "A prévia fica registrada com data, hora e autor e não pode mais ser alterada. Quem muda de unidade recebe o pedido de aceite pelo link pessoal. O que for recusado volta para o Gestor MMG Responsável da unidade."
          : "A escala recebe número, hora e autor e não pode mais ser alterada; corrigir depois só por retificação. Quem não respondeu à prévia continua escalado, marcado como sem resposta. Trocas feitas no ajuste recebem convocação nova."}
      </p>
      <div className="flex gap-2">
        <button disabled={ocupado} onClick={async () => {
          const r = await agir(`/rodizio/quinzenas/${q.id}/${confirmar === "previa" ? "previa" : "publicar"}`, {},
            (r) => confirmar === "previa" ? `Prévia enviada: ${r.linhas} linhas, ${r.convocacoes} pedidos de aceite` : `Escala ${String(r.numero).padStart(3, "0")}/${r.ano} publicada`);
          if (r) { setConfirmar(null); setVista("escala"); }
        }} className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40">
          {ocupado ? "Aguarde…" : confirmar === "previa" ? "Enviar prévia" : "Publicar"}
        </button>
        <button onClick={() => setConfirmar(null)} className="border border-slate-300 rounded-lg px-3 py-2 text-[13px] text-slate-600">Voltar</button>
      </div>
    </div>
  );

  if (vista === "escala") {
    return (
      <div className="space-y-3">
        {topo}{progresso}{caixaConfirmar}
        <EscalaGeral token={token} pedir={pedir} d={d} pessoas={pessoas} trocas={trocasVivas} uDe={uDe} />
      </div>
    );
  }

  /* =================================================================
   * COLUNA 1 — UNIDADES
   * =============================================================== */
  const t = busca.trim().toLowerCase();
  const lista = unidades.filter((u) =>
    (filtro === "todas" || (filtro === "minhas" ? minha(u) : !u.gestor_id)) &&
    (cidade === "Todas" || u.cidade === cidade) &&
    (!t || u.codigo.includes(t) || (u.local_nome || "").toLowerCase().includes(t) || (u.setor || "").toLowerCase().includes(t)));
  const nMinhas = unidades.filter(minha).length;

  const col1 = (
    <aside className="bg-white border border-slate-200 rounded-2xl flex flex-col min-w-0">
      <div className="p-3 border-b border-slate-100 space-y-2">
        <p className="text-[13.5px] font-semibold">Unidades</p>
        <div className="flex gap-1">
          {[["minhas", `Minhas ${nMinhas}`], ["semgestor", `Sem gestor ${semGestor}`], ["todas", "Todas"]].map(([k, r]) => (
            <button key={k} onClick={() => { setFiltro(k); setCidadesAbertas(k !== "minhas"); }}
              className={`flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold border ${filtro === k ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-500 border-slate-200"}`}>{r}</button>
          ))}
        </div>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número ou nome da unidade"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setCidadesAbertas((v) => !v)}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-lg px-2.5 py-1 hover:border-slate-400">
            <span className={`inline-block transition-transform ${cidadesAbertas ? "rotate-90" : ""}`}>›</span>
            {cidadesAbertas ? "Ocultar cidades" : "Filtrar por cidade"}
          </button>
          {!cidadesAbertas && cidade !== "Todas" && (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] border border-teal-500 bg-teal-50 text-teal-700 font-semibold">
              {cidade}
              <button onClick={() => setCidade("Todas")} aria-label="Tirar filtro de cidade" className="leading-none ml-0.5">×</button>
            </span>
          )}
        </div>
        {cidadesAbertas && (
          <div className="flex flex-wrap gap-1">
            {cidades.map((c) => (
              <button key={c} onClick={() => setCidade(c)}
                className={`rounded-full px-2.5 py-0.5 text-[11.5px] border ${cidade === c ? "border-teal-500 bg-teal-50 text-teal-700 font-semibold" : "border-slate-200 text-slate-500"}`}>{c}</button>
            ))}
          </div>
        )}
      </div>
      <div className="p-2 space-y-1.5 overflow-y-auto max-h-[calc(100vh-260px)]">
        {lista.length === 0 && (
          <p className="text-[12.5px] text-slate-500 border border-dashed border-slate-300 rounded-xl p-4 text-center">
            {filtro === "minhas" && nMinhas === 0
              ? "Você ainda não é Gestor MMG Responsável por nenhuma unidade. Abra a aba \"Sem gestor\" para assumir as suas."
              : "Nenhuma unidade com esse filtro."}
          </p>
        )}
        {lista.map((u) => {
          const ur = urgencia(u, pessoas);
          const n = pessoas.filter((p) => p.unidade_id === u.id && !p.ausente).length;
          return (
            <button key={u.id} onClick={() => abrirUnidade(u.id)}
              className={`relative w-full text-left border rounded-xl pl-4 pr-3 py-2.5 transition ${
                uSel === u.id ? "border-teal-500 ring-1 ring-teal-500" : "border-slate-200 hover:border-slate-400"} ${u.gestor_id && !minha(u) ? "opacity-70" : ""}`}>
              <i className={`absolute left-0 top-2 bottom-2 w-1 rounded-r ${ur.barra}`} />
              <span className="flex items-baseline gap-2">
                <b className="text-[12.5px] tabular-nums">{u.codigo}</b>
                <span className="text-[12.5px] font-semibold flex-1 min-w-0 truncate">{cap(u.local_nome)} · {cap(u.setor)}</span>
                <Selo status={u.status} />
              </span>
              <span className="block text-[11.5px] text-slate-500 mt-0.5">
                {u.cidade || "sem cidade"} · {n} {n === 1 ? "ativo" : "ativos"} · {u.req_qtd ? `pede ${u.req_qtd}` : <span className="text-rose-600">sem requisição</span>}
              </span>
              <span className="block text-[11.5px] mt-0.5">
                {u.gestor_id
                  ? <span className="text-slate-500">{minha(u) ? "Você é o Gestor MMG Responsável" : `Gestor MMG Responsável: ${u.gestor_nome}`}</span>
                  : <span className="text-amber-700 font-semibold">Sem Gestor MMG Responsável</span>}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );

  /* =================================================================
   * COLUNA 2 — UNIDADE ABERTA
   * =============================================================== */
  const u = uDe(uSel);
  let col2;
  if (!u) {
    col2 = (
      <section className="bg-white border border-slate-200 rounded-2xl p-6 min-w-0">
        <p className="text-[14px] font-semibold">Escolha uma unidade à esquerda</p>
        <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed max-w-lg">
          A faixa colorida mostra a urgência, que vem da apuração: vermelho quando há quem deva mais de {limiteBloco} dias
          e a unidade não rodou na última quinzena, âmbar quando ainda há saldo, verde quando ninguém deve.
          O selo mostra o andamento desta quinzena.
        </p>
        {!eu.id && (
          <p className="text-[12.5px] text-amber-700 bg-amber-50 rounded-lg p-3 mt-3">
            Você entrou pelo login de administração. Para ser Gestor MMG Responsável, entre com o seu acesso pessoal.
          </p>
        )}
      </section>
    );
  } else {
    const ur = urgencia(u, pessoas);
    const ps = pessoas.filter((p) => p.unidade_id === u.id);
    const presentes = ps.filter((p) => !p.ausente).length;
    const pode = editavel(u);
    const fechada = u.status === "concluida" || u.status === "mantida";

    col2 = (
      <section className="bg-white border border-slate-200 rounded-2xl flex flex-col min-w-0">
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="flex flex-wrap gap-2 items-start justify-between">
            <div className="min-w-0">
              <p className="text-[15.5px] font-semibold">{u.codigo} · {cap(u.local_nome)}</p>
              <p className="text-[12px] text-slate-500">
                {cap(u.setor)} · {u.cidade || "sem cidade"} · {u.gestor_id ? `Gestor MMG Responsável: ${minha(u) ? "você" : u.gestor_nome}` : "sem Gestor MMG Responsável"}
              </p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <span className={`text-[11.5px] font-semibold rounded-md px-2 py-0.5 ${ur.chip}`}>{ur.txt}</span>
              <Selo status={u.status} />
            </div>
          </div>
          {u.req_qtd ? (
            <div className="flex flex-wrap gap-4 items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">Requisição da quinzena</p>
                <p className="text-[11.5px] text-slate-500">pedido em {dataBR(u.req_em)}{u.req_por ? ` por ${u.req_por}` : ""}</p>
              </div>
              <div className="flex gap-5 ml-auto">
                <div><p className="text-xl font-bold tabular-nums">{u.req_qtd}</p><p className="text-[11px] text-slate-500">pedidos</p></div>
                <div><p className={`text-xl font-bold tabular-nums ${presentes < u.req_qtd ? "text-rose-600" : ""}`}>{presentes}</p><p className="text-[11px] text-slate-500">escalados</p></div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 items-center border border-dashed border-slate-300 rounded-xl px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">Sem requisição aberta para a quinzena</p>
                <p className="text-[11.5px] text-slate-500">
                  {u.ultima_req_em ? `Última requisição em ${dataBR(u.ultima_req_em)} (${u.ultima_req_qtd} pessoas, ${String(u.ultima_req_status || "").replace("_", " ")}).` : "Nenhuma requisição registrada."}
                </p>
              </div>
              {pode && (
                <a href={`/?r=${d.link_requisicao || ""}`} onClick={(e) => { if (!d.link_requisicao) { e.preventDefault(); toast("Não achei o link universal de requisição. Use o da aba Requisições.", "erro"); } else toast(`Escolha a unidade ${u.codigo} no formulário que abriu.`); }}
                  target="_blank" rel="noreferrer"
                  className="ml-auto bg-teal-600 text-white rounded-lg px-3 py-1.5 text-[12px] font-semibold">Fazer requisição</a>
              )}
            </div>
          )}
        </div>

        <div className="p-3 space-y-2 flex-1">
          {painel === "manter" && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <b className="text-[13px]">Manter os colaboradores desta unidade nesta quinzena</b>
              <p className="text-[11.5px] text-slate-500">O motivo fica registrado e vira estatística.</p>
              <div className="flex flex-wrap gap-1.5">
                {MOTIVOS_MANTER.map((m) => (
                  <button key={m} onClick={() => setMotivoManter(m)}
                    className={`rounded-full px-2.5 py-1 text-[11.5px] border ${motivoManter === m ? "border-teal-500 bg-teal-50 text-teal-700 font-semibold" : "border-slate-200 text-slate-600 bg-white"}`}>{m}</button>
                ))}
              </div>
              <input value={motivoManter} onChange={(e) => setMotivoManter(e.target.value)} placeholder="Ou escreva o motivo"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
              <div className="flex gap-2">
                <button disabled={ocupado || motivoManter.trim().length < 5} onClick={() => status(u, "mantida", motivoManter.trim())}
                  className="bg-teal-600 text-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">Confirmar e manter</button>
                <button onClick={() => setPainel(null)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px] text-slate-600">Voltar</button>
              </div>
            </div>
          )}
          {painel === "incluir" && (
            <Incluir token={token} pedir={pedir} unidade={u} quinzena={q} ocupado={ocupado}
              aoIncluir={(corpo) => agir(`/rodizio/quinzenas/${q.id}/incluir`, { unidade_id: u.id, ...corpo }, "Colaborador incluído").then((r) => { if (r) setPainel(null); })}
              aoVoltar={() => setPainel(null)} />
          )}

          <p className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold px-1">
            Ativos nos últimos {regras.dias_ativo_escala} dias apurados · {ps.length}
          </p>
          {ps.length === 0 && <p className="text-[12.5px] text-slate-500 border border-dashed border-slate-300 rounded-xl p-4 text-center">Ninguém ativo nesta unidade.</p>}
          {ps.map((p) => {
            const tr = trocaDe(p.id), rec = recusadaDe(p.id);
            const clicavel = pode && !tr && !p.ausente && !fechada;
            let faixa = null;
            if (tr) {
              const ehA = tr.a_trabalhador_id === p.id;
              const outro = pDe(ehA ? tr.b_trabalhador_id : tr.a_trabalhador_id);
              const destino = uDe(ehA ? tr.b_unidade_id : tr.a_unidade_id);
              const resp = ehA ? tr.a_resposta : tr.b_resposta;
              faixa = (
                <div className="col-span-2 flex flex-wrap justify-between gap-2 bg-sky-50 text-sky-800 rounded-lg px-2.5 py-1.5 text-[11.5px]">
                  <span>Vai para <b>{destino?.codigo}</b> de {diaMes(tr.data_inicio)} a {dataBR(tr.data_fim)} · par com {cap(outro?.nome)}</span>
                  <span className="flex gap-2 items-center">
                    {resp && <span>{RESPOSTA[resp] || resp}</span>}
                    {pode && (
                      <span role="button" onClick={(e) => { e.stopPropagation(); setConfirmar({ desfazer: tr }); }}
                        className="font-semibold underline cursor-pointer">Desfazer</span>
                    )}
                  </span>
                </div>
              );
            } else if (rec) {
              const ehA = rec.a_trabalhador_id === p.id;
              const quemRecusou = rec.a_resposta === "recusada" ? pDe(rec.a_trabalhador_id) : pDe(rec.b_trabalhador_id);
              faixa = (
                <div className="col-span-2 bg-rose-50 text-rose-700 rounded-lg px-2.5 py-1.5 text-[11.5px]">
                  Troca com a {uDe(ehA ? rec.b_unidade_id : rec.a_unidade_id)?.codigo} recusada por {cap(quemRecusou?.nome)}
                  {(rec.a_motivo || rec.b_motivo) ? ` · ${rec.a_motivo || rec.b_motivo}` : ""}. Remonte ou mantenha.
                </div>
              );
            }
            return (
              <div key={p.id} onClick={() => clicavel && (setPSel(p.id), setDSel(null), setParSel(null), setBuscaOutra(null))}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center border rounded-xl px-3 py-2 ${
                  pSel === p.id ? "border-teal-500 ring-1 ring-teal-500" : "border-slate-200"} ${clicavel ? "cursor-pointer hover:border-slate-400" : ""} ${p.ausente ? "opacity-60" : ""}`}>
                <span className="min-w-0">
                  <span className="text-[13px] font-semibold">{cap(p.nome) || "Sem cadastro"}</span>{" "}
                  <span className="text-[11.5px] text-slate-400 tabular-nums">{p.codigo}</span>
                </span>
                <span className="flex gap-1 flex-wrap justify-end">
                  {p.provisorio && <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-teal-50 text-teal-700">Provisório</span>}
                  {p.incluido && !p.provisorio && <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-teal-50 text-teal-700">Incluído</span>}
                  <TagPessoa p={p} />
                </span>
                <span className="text-[11.5px] text-slate-500">{p.dias_fora} dias fora na janela</span>
                <span className="text-right">
                  {pode && !tr && !fechada && (
                    <span role="button" onClick={(e) => { e.stopPropagation(); ausente(p, !p.ausente); }}
                      className="text-[11.5px] text-teal-700 font-semibold cursor-pointer">{p.ausente ? "Volta a contar" : "Marcar ausente"}</span>
                  )}
                  {pode && p.incluido && !tr && !fechada && (
                    <span role="button" onClick={(e) => { e.stopPropagation(); agir(`/rodizio/quinzenas/${q.id}/incluir/${p.id}`, {}, "Inclusão retirada"); }}
                      className="text-[11.5px] text-rose-600 font-semibold cursor-pointer ml-3">Retirar</span>
                  )}
                </span>
                {faixa}
              </div>
            );
          })}
          {pode && !fechada && ps.length > 0 && (
            <p className="text-[11.5px] text-slate-500 px-1">Clique em quem vai rodar. Quem deve dias aparece primeiro, com a etiqueta âmbar.</p>
          )}
        </div>

        <div className="p-3 border-t border-slate-100 flex flex-wrap gap-2 items-center">
          {!u.gestor_id && podeEditar && (
            <>
              <button disabled={ocupado || !eu.id} onClick={() => assumir(u)}
                className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40">Assumir como Gestor MMG Responsável</button>
              <span className="text-[11.5px] text-slate-500 flex-1 min-w-[200px]">
                Abrir a unidade não faz de ninguém o responsável; só este botão faz. A unidade continua sua nas próximas quinzenas.
              </span>
            </>
          )}
          {u.gestor_id && !minha(u) && (
            <span className="text-[12px] text-slate-500">O Gestor MMG Responsável por esta unidade é {u.gestor_nome}. Só ele finaliza ou mantém.</span>
          )}
          {pode && (fechada ? (
            <>
              <span className="text-[12px] text-slate-600">{u.status === "mantida" ? `Mantida · ${u.motivo || ""}` : "Finalizada"} {u.atualizado_por ? `por ${u.atualizado_por}` : ""}</span>
              <button disabled={ocupado} onClick={() => status(u, "andamento")} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px]">Reabrir</button>
            </>
          ) : (
            <>
              <button onClick={() => setPainel("incluir")} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold">+ Incluir colaborador</button>
              <button onClick={() => { setPainel("manter"); setMotivoManter(""); }} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold">Manter colaboradores</button>
              <button disabled={ocupado} onClick={() => status(u, "concluida")} className="bg-teal-600 text-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">Finalizar unidade</button>
            </>
          ))}
          {u.gestor_id && (minha(u) || eu.perfil === "admin") && podeEditar && (
            <button onClick={() => setConfirmar({ deixar: u })} className="ml-auto text-[11.5px] text-teal-700 font-semibold">
              {minha(u) ? "Deixar de ser o Gestor MMG Responsável" : "Retirar o Gestor MMG Responsável"}
            </button>
          )}
        </div>
      </section>
    );
  }

  /* =================================================================
   * COLUNA 3 — DESTINOS E PAR
   * =============================================================== */
  const p = pDe(pSel);
  let col3;
  if (!p) {
    col3 = (
      <section className="bg-white border border-slate-200 rounded-2xl flex flex-col min-w-0 xl:col-span-1 lg:col-span-2 xl:col-start-3">
        <div className="p-3 border-b border-slate-100">
          <p className="text-[13.5px] font-semibold">Trocas desta quinzena</p>
          <p className="text-[11.5px] text-slate-500">Toda troca é casada: quem sai é reposto por quem vem.</p>
        </div>
        <div className="p-3 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
          {(d.trocas || []).length === 0 && (
            <p className="text-[12.5px] text-slate-500 border border-dashed border-slate-300 rounded-xl p-4 text-center">
              Nenhuma troca ainda. Abra uma unidade sua e clique em um colaborador.
            </p>
          )}
          {(d.trocas || []).map((t) => {
            const a = pDe(t.a_trabalhador_id), b = pDe(t.b_trabalhador_id);
            const cor = t.estado === "recusada" ? "bg-rose-50 text-rose-700" : t.estado === "aceita" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700";
            const rot = { montada: "Montada", enviada: "Na prévia", aceita: "Aceita", recusada: "Recusada", sem_resposta: "Sem resposta" }[t.estado];
            return (
              <div key={t.id} className="border border-slate-200 rounded-xl p-2.5">
                <div className="flex justify-between gap-2">
                  <b className="text-[12.5px] tabular-nums">{uDe(t.a_unidade_id)?.codigo} ⇄ {uDe(t.b_unidade_id)?.codigo}</b>
                  <span className={`text-[10.5px] font-semibold rounded-md px-2 py-0.5 ${cor}`}>{rot}{t.rodada === 2 ? " · ajuste" : ""}</span>
                </div>
                <p className="text-[11.5px] text-slate-600 mt-0.5">{cap(a?.nome)} vai para {uDe(t.b_unidade_id)?.codigo} · {cap(b?.nome)} vai para {uDe(t.a_unidade_id)?.codigo}</p>
                <p className="text-[11px] text-slate-400">{diaMes(t.data_inicio)} a {dataBR(t.data_fim)} · montada por {t.montada_por}</p>
              </div>
            );
          })}
        </div>
      </section>
    );
  } else {
    const origem = uDe(p.unidade_id);
    const nivel = (x) => (x.local_id && x.local_id === origem.local_id ? 1 : x.cidade && x.cidade === origem.cidade ? 2 : 3);
    const comGente = (x) => pessoas.some((pp) => pp.unidade_id === x.id && !pp.ausente);
    const dests = unidades.filter((x) => x.id !== origem.id && minha(x) && comGente(x) && (cidade === "Todas" || x.cidade === cidade || x.local_id === origem.local_id))
      .map((x) => ({ x, n: nivel(x) })).sort((a, b) => a.n - b.n || a.x.codigo.localeCompare(b.x.codigo));
    const grupos = [[1, "No mesmo local · outro setor"], [2, `Em ${origem.cidade || "mesma cidade"} · outro local`], [3, "Em outra cidade"]];
    const dest = uDe(dSel);
    const qo = (buscaOutra || "").trim().toLowerCase();
    const outras = buscaOutra === null ? [] : unidades.filter((x) => x.id !== origem.id && !minha(x) && comGente(x) &&
      (!qo || x.codigo.includes(qo) || (x.local_nome || "").toLowerCase().includes(qo) || (x.cidade || "").toLowerCase().includes(qo))).slice(0, 20);
    const cand = dest ? pessoas.filter((x) => x.unidade_id === dest.id && !x.ausente && !trocaDe(x.id))
      .sort((a, b) => (b.perfil === "permanente" && b.falta > 0) - (a.perfil === "permanente" && a.falta > 0) || b.falta - a.falta) : [];
    const BotaoDestino = ({ x }) => (
      <button onClick={() => { if (x.gestor_id) { setDSel(x.id); setParSel(null); } }} disabled={!x.gestor_id}
        className={`w-full text-left border rounded-xl px-3 py-2 flex justify-between gap-2 items-center ${
          dSel === x.id ? "border-sky-500 ring-1 ring-sky-500" : "border-slate-200 hover:border-slate-400"} disabled:opacity-50`}>
        <span className="min-w-0">
          <b className="text-[12.5px] tabular-nums">{x.codigo}</b> <span className="text-[12.5px]">{cap(x.local_nome)} · {cap(x.setor)}</span>
          <span className="block text-[11px] text-slate-500">
            {minha(x) ? `${pessoas.filter((pp) => pp.unidade_id === x.id && !pp.ausente).length} ativos · ${x.req_qtd ? `pede ${x.req_qtd}` : "sem requisição"}`
              : x.gestor_id ? `${x.cidade || ""} · Gestor MMG Responsável: ${x.gestor_nome}` : `${x.cidade || ""} · sem Gestor MMG Responsável; precisa ser assumida antes`}
          </span>
        </span>
        <i className={`w-2.5 h-2.5 rounded-full shrink-0 ${urgencia(x, pessoas).barra}`} />
      </button>
    );

    col3 = (
      <section className="bg-white border border-slate-200 rounded-2xl flex flex-col min-w-0 xl:col-span-1 lg:col-span-2 xl:col-start-3">
        <div className="p-3 border-b border-slate-100">
          <p className="text-[13.5px] font-semibold">Para onde {cap(primeiroNome(p.nome))} pode ir</p>
          <p className="text-[11.5px] text-slate-500">Sai da {origem.codigo} · {p.perfil === "permanente" && p.falta > 0 ? `deve ${p.falta} dias` : "em dia"} · {cidade === "Todas" ? "todas as cidades" : `filtro ${cidade}`}</p>
        </div>
        <div className="p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-260px)]">
          {grupos.map(([n, rot]) => {
            const g = dests.filter((x) => x.n === n);
            if (!g.length) return null;
            return (
              <div key={n} className="space-y-1.5">
                <p className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">{rot}</p>
                {g.map(({ x }) => <BotaoDestino key={x.id} x={x} />)}
              </div>
            );
          })}
          {dests.length === 0 && <p className="text-[12px] text-slate-500 border border-dashed border-slate-300 rounded-xl p-3 text-center">Nenhuma unidade sua serve de destino com este filtro.</p>}

          {buscaOutra === null ? (
            <button onClick={() => setBuscaOutra("")} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold">Buscar outra unidade</button>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
              <b className="text-[12.5px]">Buscar outra unidade</b>
              <input autoFocus value={buscaOutra} onChange={(e) => setBuscaOutra(e.target.value)} placeholder="Número, nome ou cidade"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
              {outras.map((x) => <BotaoDestino key={x.id} x={x} />)}
              {outras.length === 0 && <p className="text-[12px] text-slate-500">Nenhuma unidade com isso.</p>}
            </div>
          )}
          <p className="text-[11px] text-slate-400">Aparecem só as suas unidades. As de outro Gestor MMG Responsável entram pela busca.</p>

          {dest && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <b className="text-[13px]">Com quem {cap(primeiroNome(p.nome))} troca na {dest.codigo}?</b>
              <p className="text-[11.5px] text-slate-500">Quem também precisa rodar aparece primeiro: a troca resolve os dois.</p>
              <div className="space-y-1.5">
                {cand.map((x) => (
                  <button key={x.id} onClick={() => setParSel(x.id)}
                    className={`w-full text-left border rounded-lg px-3 py-2 flex justify-between gap-2 items-center bg-white ${parSel === x.id ? "border-sky-500 ring-1 ring-sky-500" : "border-slate-200"}`}>
                    <span className="text-[12.5px]"><b>{cap(x.nome)}</b> <span className="text-slate-400 tabular-nums">{x.codigo}</span></span>
                    <TagPessoa p={x} />
                  </button>
                ))}
                {cand.length === 0 && <p className="text-[12px] text-slate-500">Todos daqui já estão em troca ou ausentes.</p>}
              </div>

              <p className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold pt-1">Período da troca</p>
              <div className="flex gap-1.5 flex-wrap">
                {semanas.map(([a, b], i) => (
                  <button key={a} onClick={() => setPeriodo(i)}
                    className={`flex-1 min-w-[90px] border rounded-lg py-1.5 text-[12px] font-semibold ${periodo === i ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-300 bg-white"}`}>
                    {diaMes(a)} a {diaMes(b)}
                  </button>
                ))}
                <button onClick={() => setPeriodo(semanas.length)}
                  className={`flex-1 min-w-[90px] border rounded-lg py-1.5 text-[12px] font-semibold ${periodo >= semanas.length ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-300 bg-white"}`}>
                  Outro período
                </button>
              </div>
              {periodo >= semanas.length && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11.5px] text-slate-500">De
                    <input type="date" value={pIni} min={q.inicio} max={q.fim} onChange={(e) => { setPIni(e.target.value); if (pFim < e.target.value) setPFim(e.target.value); }}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] mt-0.5" />
                  </label>
                  <label className="text-[11.5px] text-slate-500">Até
                    <input type="date" value={pFim} min={pIni || q.inicio} max={q.fim} onChange={(e) => setPFim(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] mt-0.5" />
                  </label>
                  <p className={`col-span-2 text-[11.5px] ${diasPeriodo > limiteBloco || !periodoValido ? "text-rose-600" : "text-slate-500"}`}>
                    {diasPeriodo} {diasPeriodo === 1 ? "dia" : "dias"} · o limite é o critério "Bloco de rodízio" ({limiteBloco} dias). Dentro dele, o Gestor MMG decide.
                  </p>
                </div>
              )}
              <button disabled={!parSel || !periodoValido || ocupado} onClick={validarTroca}
                className="w-full bg-teal-600 text-white rounded-lg py-2 text-[13px] font-semibold disabled:opacity-40">Validar troca</button>
              {parSel && (
                <p className="text-[11.5px] text-slate-500 leading-relaxed">
                  {cap(p.nome)} vai para a {dest.codigo} e {cap(pDe(parSel)?.nome)} vem para a {origem.codigo}, de {diaMes(periodoAtual[0])} a {dataBR(periodoAtual[1])}.
                  O resto da quinzena cada um fica na sua unidade.
                  {!minha(dest) && ` A ${dest.codigo} é de ${dest.gestor_nome}: ele verá a troca e ainda precisa finalizar a unidade dele.`}
                </p>
              )}
            </div>
          )}
          <button onClick={() => { setPSel(null); setDSel(null); setParSel(null); setBuscaOutra(null); }} className="text-[12px] text-teal-700 font-semibold">Cancelar</button>
        </div>
      </section>
    );
  }

  /* confirmações pequenas: desfazer troca e deixar a unidade */
  let confirmaPequeno = null;
  if (confirmar && confirmar.desfazer) {
    const tr = confirmar.desfazer;
    confirmaPequeno = (
      <ConfirmaDesfazer troca={tr} ocupado={ocupado} aoVoltar={() => setConfirmar(null)}
        aoConfirmar={async (motivo) => { const r = await desfazer(tr, motivo); if (r) setConfirmar(null); }} />
    );
  }
  if (confirmar && confirmar.deixar) {
    const x = confirmar.deixar;
    confirmaPequeno = (
      <div className="bg-white border-2 border-amber-400 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <span className="text-[13px] flex-1 min-w-[240px]">
          A {x.codigo} vai ficar sem Gestor MMG Responsável e volta para a lista "Sem gestor". Enquanto ninguém assumir, a prévia não sai.
        </span>
        <button disabled={ocupado} onClick={async () => { const r = await deixar(x); if (r) setConfirmar(null); }}
          className="bg-amber-500 text-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold">Confirmar</button>
        <button onClick={() => setConfirmar(null)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px]">Voltar</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {topo}
      {progresso}
      {caixaConfirmar}
      {confirmaPequeno}
      <div className="grid gap-3 items-start grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_350px]">
        {col1}{col2}{col3}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function ConfirmaDesfazer({ troca, ocupado, aoVoltar, aoConfirmar }) {
  const [motivo, setMotivo] = useState("");
  const exige = troca.estado !== "montada";
  return (
    <div className="bg-white border-2 border-amber-400 rounded-2xl p-4 space-y-2">
      <b className="text-[13.5px]">Desfazer esta troca?</b>
      <p className="text-[12.5px] text-slate-600">
        As duas unidades voltam para "Em andamento" e precisam ser revistas. A troca fica no histórico, com quem desfez.
        {exige && " Ela já foi enviada aos colaboradores, então o motivo é obrigatório."}
      </p>
      {exige && (
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
      )}
      <div className="flex gap-2">
        <button disabled={ocupado || (exige && motivo.trim().length < 5)} onClick={() => aoConfirmar(motivo.trim())}
          className="bg-amber-500 text-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">Desfazer troca</button>
        <button onClick={aoVoltar} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px]">Voltar</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Incluir({ token, pedir, unidade, ocupado, aoIncluir, aoVoltar }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [novoNome, setNovoNome] = useState("");

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const h = setTimeout(() => {
      pedir(`/rodizio/pessoas/buscar?q=${encodeURIComponent(q.trim())}`, token).then(setRes).catch(() => setRes([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q, token, pedir]);

  const soNumero = /^\d{3,}$/.test(q.trim());
  const codigoNovo = soNumero && !res.some((r) => r.codigo === q.trim());

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
      <b className="text-[13px]">Incluir na {unidade.codigo} quem não aparece nos ativos</b>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código ou nome"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
      {res.map((r) => (
        <button key={r.id} disabled={ocupado} onClick={() => aoIncluir({ trabalhador_id: r.id })}
          className="w-full text-left bg-white border border-slate-200 rounded-lg px-3 py-2 flex justify-between gap-2 items-center hover:border-slate-400">
          <span className="text-[12.5px] min-w-0">
            <b>{cap(r.nome) || "Sem cadastro"}</b> <span className="text-slate-400 tabular-nums">{r.codigo}</span>
            <span className="block text-[11px] text-slate-500">
              {r.provisorio ? "Provisório · ainda não veio no Ponto" : r.ultimo_dia ? `Último dia apurado ${dataBR(r.ultimo_dia)}${r.ultima_unidade ? ` na ${r.ultima_unidade}` : ""}` : "Sem dia apurado"}
            </span>
          </span>
          <span className="text-[12px] font-semibold text-teal-700">Incluir</span>
        </button>
      ))}
      {codigoNovo && (
        <div className="bg-white border border-dashed border-teal-400 rounded-lg p-2.5 space-y-1.5">
          <p className="text-[12px]">O código <b>{q.trim()}</b> ainda não existe aqui. Para quem está em contratação, informe o nome completo e ele entra como provisório até vir no Ponto.</p>
          <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome completo"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
          <button disabled={ocupado || novoNome.trim().split(/\s+/).length < 2} onClick={() => aoIncluir({ codigo: q.trim(), nome: novoNome.trim() })}
            className="bg-teal-600 text-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">Incluir como provisório</button>
        </div>
      )}
      <button onClick={aoVoltar} className="border border-slate-300 rounded-lg px-3 py-1.5 text-[12.5px] text-slate-600">Voltar</button>
    </div>
  );
}

/* ------------------------------------------------------------------
 * ESCALA GERAL — a mesma lista vista pelo sindicato, pelo fiscal de
 * uma unidade e pelo colaborador. Antes da prévia é um rascunho
 * calculado na tela; depois, as linhas gravadas no banco.
 *
 * 13/10/2026 — FILTROS. Tipo, resposta, "sem nome" e busca por código,
 * nome ou unidade. Os filtros se somam e valem para a visão do
 * Sindicato e a do Fiscal; na visão do Colaborador, a busca e o
 * "sem nome" encurtam a lista de pessoas. Cada botão mostra quantas
 * linhas ele traria, já considerando os outros filtros.
 * ---------------------------------------------------------------- */
const TIPOS_FILTRO = [
  ["todos", "Todos"],
  ["rodizio", "Rodízio"],
  ["permanece", "Permanece"],
  ["base", "Na unidade de origem"],
];
const RESPOSTAS_FILTRO = [
  ["todas", "Todas"],
  ["aceita", "Aceitou"],
  ["recusada", "Recusou"],
  ["vista", "Viu, sem responder"],
  ["enviada", "Sem resposta"],
  ["nao_precisa", "Não precisa"],
];
const semNomeDe = (l) => !String(l.nome || "").trim();
const chaveResposta = (l) => (l.tipo !== "rodizio" ? "nao_precisa" : (l.resposta || "sem_convocacao"));
const semAcento = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function Chip({ ativo, onClick, children, n, tom = "slate" }) {
  const cores = {
    slate: ativo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400",
    amber: ativo ? "bg-amber-500 text-white border-amber-500" : "bg-white text-amber-700 border-amber-200 hover:border-amber-400",
  };
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${cores[tom]}`}>
      {children}
      {n != null && (
        <span className={`tabular-nums text-[10.5px] rounded-full px-1.5 ${ativo ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{n}</span>
      )}
    </button>
  );
}

function EscalaGeral({ token, pedir, d, pessoas, trocas, uDe }) {
  const [linhasBanco, setLinhasBanco] = useState(null);
  const [verComo, setVerComo] = useState("sindicato");
  const [fiscal, setFiscal] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [copiado, setCopiado] = useState("");
  const [fTipo, setFTipo] = useState("todos");
  const [fResposta, setFResposta] = useState("todas");
  const [fSemNome, setFSemNome] = useState(false);
  const [fBusca, setFBusca] = useState("");
  const escala = d.definitiva || d.previa;
  const q = d.quinzena;

  useEffect(() => {
    if (!escala) { setLinhasBanco(null); return; }
    pedir(`/rodizio/escala/${escala.id}/linhas`, token).then(setLinhasBanco).catch(() => setLinhasBanco([]));
  }, [escala?.id, token, pedir]);

  const linhas = useMemo(() => {
    if (linhasBanco) {
      return linhasBanco.map((l) => ({ ...l, data_inicio: String(l.data_inicio).slice(0, 10), data_fim: String(l.data_fim).slice(0, 10) }));
    }
    const out = [];
    for (const p of pessoas) {
      if (p.ausente) continue;
      const u0 = uDe(p.unidade_id);
      const base = { trabalhador_id: p.id, codigo: p.codigo, nome: p.nome };
      const t = trocas.find((x) => x.a_trabalhador_id === p.id || x.b_trabalhador_id === p.id);
      const L = (u, ini, fim, tipo) => ini <= fim && out.push({ ...base, unidade_id: u.id, unidade_codigo: u.codigo, unidade_nome: u.local_nome, setor: u.setor, data_inicio: ini, data_fim: fim, tipo });
      if (!t) { L(u0, q.inicio, q.fim, "permanece"); continue; }
      const di = String(t.data_inicio).slice(0, 10), df = String(t.data_fim).slice(0, 10);
      const destino = uDe(t.a_trabalhador_id === p.id ? t.b_unidade_id : t.a_unidade_id);
      L(u0, q.inicio, somaDias(di, -1), "base");
      L(destino, di, df, "rodizio");
      L(u0, somaDias(df, 1), q.fim, "base");
    }
    return out.sort((a, b) => a.unidade_codigo.localeCompare(b.unidade_codigo) || String(a.nome).localeCompare(String(b.nome)));
  }, [linhasBanco, pessoas, trocas, q]); // eslint-disable-line

  const unidadesLista = [...new Map(linhas.map((l) => [l.unidade_id, l])).values()];
  const pessoasLista = [...new Map(linhas.map((l) => [l.trabalhador_id, l])).values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const fiscalId = fiscal || unidadesLista[0]?.unidade_id;
  const daVisao = verComo === "fiscal" ? linhas.filter((l) => l.unidade_id === fiscalId) : linhas;
  const rotTipo = { permanece: "Permanece", base: "Na unidade de origem", rodizio: "Rodízio" };
  const titulo = d.definitiva
    ? `Escala ${String(d.definitiva.numero).padStart(3, "0")}/${d.definitiva.ano} · publicada`
    : d.previa ? `Prévia enviada em ${horaBR(d.previa.previa_em)}` : "Rascunho · como vai sair hoje";

  /* Cada filtro como função; para contar um botão, aplica todos os outros. */
  const termo = semAcento(fBusca.trim());
  const passa = {
    tipo: (l, v = fTipo) => v === "todos" || l.tipo === v,
    resposta: (l, v = fResposta) => v === "todas" || chaveResposta(l) === v,
    semNome: (l) => !fSemNome || semNomeDe(l),
    busca: (l) => !termo || semAcento(`${l.codigo} ${l.nome} ${l.unidade_codigo} ${l.unidade_nome} ${l.setor}`).includes(termo),
  };
  const filtrar = (lista, exceto) => lista.filter((l) =>
    Object.entries(passa).every(([k, f]) => k === exceto || f(l)));
  const vis = filtrar(daVisao);
  const contaTipo = (v) => filtrar(daVisao, "tipo").filter((l) => passa.tipo(l, v)).length;
  const contaResp = (v) => filtrar(daVisao, "resposta").filter((l) => passa.resposta(l, v)).length;
  const totalSemNome = filtrar(daVisao, "semNome").filter(semNomeDe).length;
  const filtrando = fTipo !== "todos" || fResposta !== "todas" || fSemNome || termo;
  const limpar = () => { setFTipo("todos"); setFResposta("todas"); setFSemNome(false); setFBusca(""); };

  const pessoasFiltradas = pessoasLista.filter((l) => passa.semNome(l) && passa.busca(l));
  const pessoaId = (pessoasFiltradas.some((l) => l.trabalhador_id === pessoa) ? pessoa : null) || pessoasFiltradas[0]?.trabalhador_id;

  async function copiar(tk) {
    const url = `${window.location.origin}/?c=${tk}`;
    try { await navigator.clipboard.writeText(url); setCopiado(tk); setTimeout(() => setCopiado(""), 1800); }
    catch { window.prompt("Copie o link:", url); }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl">
      <div className="p-4 border-b border-slate-100 space-y-2">
        <div className="flex flex-wrap gap-3 justify-between items-center">
          <div>
            <p className="text-[14px] font-semibold">Escala geral</p>
            <p className="text-[11.5px] text-slate-500">
              {titulo} · {filtrando && verComo !== "colaborador" ? <><b className="text-slate-700">{vis.length}</b> de </> : null}
              {daVisao.length} linhas · {pessoasLista.length} pessoas
            </p>
          </div>
          <div className="flex gap-1">
            {[["sindicato", "Sindicato"], ["fiscal", "Fiscal"], ["colaborador", "Colaborador"]].map(([k, r]) => (
              <button key={k} onClick={() => setVerComo(k)}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold border ${verComo === k ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-500 border-slate-200"}`}>{r}</button>
            ))}
          </div>
        </div>
        {verComo === "fiscal" && (
          <>
            <select value={fiscalId || ""} onChange={(e) => setFiscal(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
              {unidadesLista.map((l) => <option key={l.unidade_id} value={l.unidade_id}>Fiscal da {l.unidade_codigo} · {cap(l.unidade_nome)} · {cap(l.setor)}</option>)}
            </select>
            <p className="text-[11.5px] text-slate-500">O fiscal recebe só quem trabalha na unidade dele, inclusive quem chega de fora no período da troca.</p>
          </>
        )}
      </div>

      {/* ---------- filtros ---------- */}
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 space-y-2.5">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input value={fBusca} onChange={(e) => setFBusca(e.target.value)}
              placeholder="Buscar código, nome ou unidade…"
              className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-[13px] focus:outline-none focus:border-slate-400" />
            {fBusca && (
              <button onClick={() => setFBusca("")} aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200 text-[13px] leading-none">×</button>
            )}
          </div>
          <Chip tom="amber" ativo={fSemNome} onClick={() => setFSemNome(!fSemNome)} n={totalSemNome}>Sem nome</Chip>
          {filtrando && (
            <button onClick={limpar}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:border-slate-500">
              Limpar filtros
            </button>
          )}
        </div>

        {verComo !== "colaborador" && (
          <>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold w-20">Tipo</span>
              {TIPOS_FILTRO.map(([k, r]) => (
                <Chip key={k} ativo={fTipo === k} onClick={() => setFTipo(k)} n={contaTipo(k)}>{r}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold w-20">Resposta</span>
              {RESPOSTAS_FILTRO.map(([k, r]) => (
                <Chip key={k} ativo={fResposta === k} onClick={() => setFResposta(k)} n={contaResp(k)}>{r}</Chip>
              ))}
            </div>
          </>
        )}
      </div>

      {verComo === "colaborador" ? (
        <div className="p-4 space-y-3">
          {pessoasFiltradas.length > 0 && (
            <select value={pessoaId || ""} onChange={(e) => setPessoa(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
              {pessoasFiltradas.map((l) => <option key={l.trabalhador_id} value={l.trabalhador_id}>{l.nome ? cap(l.nome) : "(sem nome)"} · {l.codigo}</option>)}
            </select>
          )}
          {(() => {
            const minhas = linhas.filter((l) => l.trabalhador_id === pessoaId).sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
            const pp = minhas[0];
            if (!pp) return <p className="text-[12.5px] text-slate-500">{linhas.length ? "Ninguém com esses filtros." : "Ninguém na escala ainda."}</p>;
            return (
              <div className="max-w-sm border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
                <p className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">O que {pp.nome ? cap(primeiroNome(pp.nome)) : "o colaborador"} vê</p>
                <p className="text-[16px] font-semibold">{pp.nome ? cap(pp.nome) : <span className="text-amber-700">Sem nome no cadastro</span>}</p>
                <p className="text-[11.5px] text-slate-500">Código {pp.codigo} · {diaMes(q.inicio)} a {dataBR(q.fim)}</p>
                {minhas.map((l, i) => (
                  <div key={i} className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-[12.5px]">
                    <span>{diaMes(l.data_inicio)} a {diaMes(l.data_fim)}</span>
                    <b className="text-right">{l.unidade_codigo} · {cap(l.unidade_nome)}</b>
                  </div>
                ))}
                <p className="text-[11px] text-slate-400">Ele não vê colegas nem a escala da unidade. Só o que é dele.</p>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-slate-50 text-slate-500 text-[10.5px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Código</th><th className="text-left px-3 py-2">Colaborador</th>
                <th className="text-left px-3 py-2">Unidade</th><th className="text-left px-3 py-2">Período</th>
                <th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Resposta</th>
              </tr>
            </thead>
            <tbody>
              {vis.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2 tabular-nums">{l.codigo}</td>
                  <td className="px-3 py-2">
                    {semNomeDe(l)
                      ? <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-amber-50 text-amber-700">Sem nome</span>
                      : cap(l.nome)}
                  </td>
                  <td className="px-3 py-2"><b className="tabular-nums">{l.unidade_codigo}</b> {cap(l.unidade_nome)} · {cap(l.setor)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{diaMes(l.data_inicio)} a {diaMes(l.data_fim)}</td>
                  <td className="px-3 py-2">
                    {l.tipo === "rodizio"
                      ? <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-sky-50 text-sky-700">Rodízio</span>
                      : <span className="text-slate-500">{rotTipo[l.tipo] || l.tipo}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {l.tipo !== "rodizio" ? <span className="text-slate-400">Não precisa</span> : (
                      <span className="flex gap-2 items-center flex-wrap">
                        {l.resposta ? (RESPOSTA[l.resposta] || l.resposta) : "—"}
                        {l.token && (
                          <button onClick={() => copiar(l.token)} className="text-[11.5px] text-teal-700 font-semibold">
                            {copiado === l.token ? "Link copiado" : "Copiar link"}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {vis.length === 0 && (
                <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-400">
                  {daVisao.length === 0 ? "Ninguém na escala ainda." : (
                    <>Nenhuma linha com esses filtros. <button onClick={limpar} className="text-teal-700 font-semibold">Limpar filtros</button></>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
