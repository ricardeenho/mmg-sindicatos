import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const TURNOS = [
  ["manha", "Manhã"], ["tarde", "Tarde"], ["noite", "Noite"], ["integral", "Dia inteiro"],
];

const hoje = () => new Date().toISOString().slice(0, 10);
const maisDias = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const proximaSegunda = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};
/* A API devolve a data como ISO completo. Cortar os 10 primeiros
   caracteres e montar a mao evita fuso horario e "Invalid Date". */
const dataBR = (d) => {
  if (!d) return "";
  const [ano, mes, dia] = String(d).slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
};

/* Fica FORA do componente de proposito. Declarada dentro, ela seria uma
   funcao nova a cada tecla digitada, e o React destruiria e recriaria
   tudo que esta dentro dela — o campo perderia o foco e o teclado do
   celular fecharia a cada letra. */
function Moldura({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="max-w-lg mx-auto">
        <div className="mb-5">
          <img src="/logo-mmg.png" alt="MMG · Movimentação de Mercadorias em Geral"
               className="h-11 w-auto mb-3" />
          <h1 className="font-semibold text-slate-900 leading-tight">Pedido de trabalhadores</h1>
          <p className="text-[12px] text-slate-500 leading-tight">Sindicato · módulo Rodízio</p>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ==================================================================
 * TELA PÚBLICA — quem abre o link não tem login
 * ================================================================ */
export default function Requisicao({ token, unidadeParam }) {
  const [estado, setEstado] = useState("carregando"); // carregando | erro | formulario | pronto
  const [erro, setErro] = useState("");
  const [atividades, setAtividades] = useState([]);
  const [unidade, setUnidade] = useState(null);
  const [travada, setTravada] = useState(false);

  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const debounce = useRef(null);

  const [quantidade, setQuantidade] = useState(1);
  const [inicio, setInicio] = useState("");
  const [nome, setNome] = useState("");
  const [fone, setFone] = useState("");
  const [tipo, setTipo] = useState("unidade");

  const [detalhado, setDetalhado] = useState(false);
  const [fim, setFim] = useState("");
  const [turno, setTurno] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFim, setHoraFim] = useState("");
  const [escolhidas, setEscolhidas] = useState([]);
  const [observacoes, setObservacoes] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [recibo, setRecibo] = useState(null);

  useEffect(() => {
    fetch(`${API}/requisicoes/publico/${token}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Link inválido");
        setAtividades(d.atividades || []);
        if (d.unidade) { setUnidade(d.unidade); setTravada(false); }
        setEstado("formulario");
      })
      .catch((e) => { setErro(e.message); setEstado("erro"); });
  }, [token]);

  useEffect(() => {
    if (unidade || busca.trim().length < 2) { setAchados([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(
          `${API}/requisicoes/publico/${token}/unidades?q=${encodeURIComponent(busca.trim())}`);
        setAchados(r.ok ? await r.json() : []);
      } catch (e) { setAchados([]); } finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [busca, unidade, token]);

  async function enviar() {
    setEnviando(true); setErro("");
    try {
      const r = await fetch(`${API}/requisicoes/publico/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unidade_id: unidade?.id,
          quantidade,
          previsao_inicio: inicio,
          previsao_fim: fim || null,
          turno: turno || null,
          hora_inicio: horaInicio || null,
          hora_fim: horaFim || null,
          atividades: escolhidas,
          observacoes,
          solicitante_nome: nome,
          solicitante_fone: fone,
          solicitante_tipo: tipo,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não consegui enviar");
      setRecibo(d); setEstado("pronto");
    } catch (e) { setErro(e.message); } finally { setEnviando(false); }
  }

  function outroPedido() {
    setRecibo(null); setEstado("formulario");
    if (!travada) { setUnidade(null); setBusca(""); }
    setQuantidade(1); setInicio(""); setFim(""); setTurno("");
    setHoraInicio(""); setHoraFim(""); setEscolhidas([]); setObservacoes("");
    setDetalhado(false); setErro("");
  }

  const podeEnviar = unidade && quantidade >= 1 && inicio && nome.trim().length >= 3;

  if (estado === "carregando") {
    return <Moldura><p className="text-sm text-slate-400">Abrindo…</p></Moldura>;
  }

  if (estado === "erro") {
    return (
      <Moldura>
        <div className="bg-white rounded-2xl p-6">
          <p className="text-[15px] font-medium text-rose-700 mb-2">Este link não está funcionando</p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            {erro}. Peça um link novo ao sindicato, ou ligue para fazer o pedido por telefone.
          </p>
        </div>
      </Moldura>
    );
  }

  if (estado === "pronto") {
    return (
      <Moldura>
        <div className="bg-white rounded-2xl p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 grid place-items-center mx-auto mb-4">
            <span className="text-emerald-700 text-2xl">✓</span>
          </div>
          <p className="text-[16px] font-semibold text-slate-900">Pedido recebido</p>
          <p className="text-[13px] text-slate-600 mt-1">
            Protocolo <b className="tabular-nums">{recibo.protocolo}</b>
          </p>
          <p className="text-[13px] text-slate-600 mt-3 leading-relaxed">
            {recibo.urgente
              ? "O pedido é para os próximos dias, então entra como urgente. Se puder, avise o sindicato por telefone também."
              : "O sindicato vai montar a escala e avisar os trabalhadores."}
          </p>
          <button onClick={outroPedido}
            className="mt-5 w-full bg-slate-900 text-white rounded-xl py-3 text-[14px] font-medium">
            Fazer outro pedido
          </button>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="space-y-3">

        {/* ---- unidade ---- */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-[13px] font-medium text-slate-900 mb-2">Para qual unidade?</p>
          {unidade ? (
            <div className="flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-xl p-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-teal-900">{unidade.codigo}</p>
                <p className="text-[12.5px] text-teal-800 leading-tight">{unidade.nome || unidade.nome_completo}</p>
                {(unidade.cidade || unidade.local) && (
                  <p className="text-[11.5px] text-teal-700 mt-0.5">
                    {unidade.local}{unidade.cidade ? ` · ${unidade.cidade}` : ""}
                  </p>
                )}
              </div>
              {!travada && (
                <button onClick={() => { setUnidade(null); setBusca(""); }}
                  className="text-[12px] text-teal-700 underline shrink-0">trocar</button>
              )}
            </div>
          ) : (
            <>
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Digite o número, ex.: 376"
                inputMode="text" autoComplete="off"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-[15px]" />
              <p className="text-[11.5px] text-slate-500 mt-1.5">
                Pode digitar o número da unidade ou parte do nome.
              </p>
              {buscando && <p className="text-[12px] text-slate-400 mt-2">procurando…</p>}
              {achados.length > 0 && (
                <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
                  {achados.map((u) => (
                    <button key={u.id}
                      onClick={() => { setUnidade({ ...u, nome: u.nome_completo }); setAchados([]); }}
                      className="w-full text-left px-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <p className="text-[13.5px]">
                        <b className="tabular-nums">{u.codigo}</b> · {u.nome_completo}
                      </p>
                      <p className="text-[11.5px] text-slate-500">
                        {u.cidade || "—"}
                        {!u.viva && <span className="text-amber-700"> · sem movimento recente</span>}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {!buscando && busca.trim().length >= 2 && achados.length === 0 && (
                <p className="text-[12px] text-slate-500 mt-2">
                  Não achei nenhuma unidade com isso. Tente só o número.
                </p>
              )}
            </>
          )}
        </div>

        {/* ---- quantas pessoas ---- */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-[13px] font-medium text-slate-900 mb-1">Quantas pessoas no total?</p>
          <p className="text-[11.5px] text-slate-500 mb-2">Contando as que já estão na unidade. É o total que você quer a partir da data abaixo.</p>
          <div className="flex items-center gap-3">
            <button onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
              className="w-12 h-12 rounded-xl border border-slate-300 text-xl">−</button>
            <input type="number" min="1" max="200" value={quantidade}
              onChange={(e) => setQuantidade(Math.min(200, Math.max(1, parseInt(e.target.value || 1, 10))))}
              className="flex-1 text-center border border-slate-300 rounded-xl py-3 text-2xl font-semibold tabular-nums" />
            <button onClick={() => setQuantidade((q) => Math.min(200, q + 1))}
              className="w-12 h-12 rounded-xl border border-slate-300 text-xl">+</button>
          </div>
        </div>

        {/* ---- quando ---- */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-[13px] font-medium text-slate-900 mb-2">A partir de quando?</p>
          <div className="flex gap-2 mb-2 flex-wrap">
            {[["Hoje", hoje()], ["Amanhã", maisDias(1)], ["Segunda", proximaSegunda()]].map(([r, v]) => (
              <button key={r} onClick={() => setInicio(v)}
                className={`px-3 py-2 rounded-lg text-[13px] border ${
                  inicio === v ? "bg-slate-900 text-white border-slate-900"
                               : "bg-white text-slate-600 border-slate-300"}`}>{r}</button>
            ))}
          </div>
          <input type="date" value={inicio} min={hoje()} onChange={(e) => setInicio(e.target.value)}
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-[15px]" />
        </div>

        {/* ---- quem está pedindo ---- */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-[13px] font-medium text-slate-900 mb-2">Quem está pedindo?</p>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome"
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-[15px] mb-2" />
          <input value={fone} onChange={(e) => setFone(e.target.value)} placeholder="Telefone com DDD"
            inputMode="tel"
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-[15px] mb-2" />
          <div className="flex gap-2">
            {[["unidade", "Sou da unidade"], ["mmg", "Sou da MMG"]].map(([v, r]) => (
              <button key={v} onClick={() => setTipo(v)}
                className={`flex-1 px-3 py-2.5 rounded-xl text-[13px] border ${
                  tipo === v ? "bg-slate-900 text-white border-slate-900"
                             : "bg-white text-slate-600 border-slate-300"}`}>{r}</button>
            ))}
          </div>
        </div>

        {/* ---- detalhes, escondidos ---- */}
        <div className="bg-white rounded-2xl p-4">
          <button onClick={() => setDetalhado((v) => !v)}
            className="w-full flex items-center justify-between">
            <span className="text-[13px] font-medium text-slate-900">Detalhar o pedido</span>
            <span className="text-[12px] text-slate-500">{detalhado ? "esconder" : "opcional"}</span>
          </button>

          {detalhado && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-[12px] text-slate-500 mb-1.5">Até quando</p>
                <input type="date" value={fim} min={inicio || hoje()}
                  onChange={(e) => setFim(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-[14px]" />
              </div>

              <div>
                <p className="text-[12px] text-slate-500 mb-1.5">Turno</p>
                <div className="grid grid-cols-2 gap-2">
                  {TURNOS.map(([v, r]) => (
                    <button key={v} onClick={() => setTurno(turno === v ? "" : v)}
                      className={`px-3 py-2.5 rounded-xl text-[13px] border ${
                        turno === v ? "bg-slate-900 text-white border-slate-900"
                                    : "bg-white text-slate-600 border-slate-300"}`}>{r}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[12px] text-slate-500 mb-1.5">Entrada</p>
                  <input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-[14px]" />
                </div>
                <div>
                  <p className="text-[12px] text-slate-500 mb-1.5">Saída</p>
                  <input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-[14px]" />
                </div>
              </div>

              <div>
                <p className="text-[12px] text-slate-500 mb-1.5">O que vão fazer</p>
                <div className="flex flex-wrap gap-2">
                  {atividades.map((a) => {
                    const marcada = escolhidas.includes(a.codigo);
                    return (
                      <button key={a.codigo}
                        onClick={() => setEscolhidas((v) =>
                          marcada ? v.filter((x) => x !== a.codigo) : [...v, a.codigo])}
                        className={`px-3 py-2 rounded-xl text-[13px] border text-left ${
                          marcada ? "bg-teal-600 text-white border-teal-600"
                                  : "bg-white text-slate-600 border-slate-300"}`}>
                        {a.nome}
                        {a.exige_nr && (
                          <span className={`block text-[10px] ${marcada ? "text-teal-100" : "text-amber-700"}`}>
                            exige {a.exige_nr}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[12px] text-slate-500 mb-1.5">Alguma observação</p>
                <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3}
                  placeholder="Ex.: precisa de gente com experiência em moega"
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-[14px]" />
              </div>
            </div>
          )}
        </div>

        {erro && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
            <p className="text-[13px] text-rose-700">{erro}</p>
          </div>
        )}

        <button onClick={enviar} disabled={!podeEnviar || enviando}
          className="w-full bg-teal-600 text-white rounded-xl py-4 text-[15px] font-semibold disabled:opacity-40">
          {enviando ? "Enviando…" : "Enviar pedido"}
        </button>

        {!podeEnviar && (
          <p className="text-[12px] text-slate-500 text-center">
            Falta escolher a unidade, a data e escrever seu nome.
          </p>
        )}
        <div className="h-6" />
      </div>
    </Moldura>
  );
}

/* ==================================================================
 * ABA DO PAINEL — quem já está logado
 * ================================================================ */
export function Requisicoes({ token, podeEditar, pedir, gravar }) {
  const [linhas, setLinhas] = useState(null);
  const [links, setLinks] = useState([]);
  const [filtro, setFiltro] = useState("aberta");
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");

  async function carregar() {
    try {
      const [r, l] = await Promise.all([
        pedir(`/requisicoes${filtro ? `?status=${filtro}` : ""}`, token),
        pedir("/requisicoes/links/lista", token).catch(() => []),
      ]);
      setLinhas(r); setLinks(l);
    } catch (e) { setErro(e.message); }
  }

  useEffect(() => { setLinhas(null); carregar(); }, [filtro, token]);

  async function mudar(id, status) {
    setErro("");
    try {
      await gravar(`/requisicoes/${id}`, token, { status }, "PATCH");
      await carregar();
    } catch (e) { setErro(e.message); }
  }

  const universal = links.find((l) => !l.unidade_codigo);
  const enderecoDoLink = universal ? `${window.location.origin}/?r=${universal.token}` : "";

  function copiar() {
    navigator.clipboard?.writeText(enderecoDoLink);
    setCopiado("copiado"); setTimeout(() => setCopiado(""), 2000);
  }

  return (
    <div className="space-y-4">
      {universal && (
        <div className="bg-slate-900 text-white rounded-xl p-4">
          <p className="text-[13px] font-medium text-teal-300">Link do pedido</p>
          <p className="text-[12px] text-slate-300 mt-1 leading-relaxed">
            É este endereço que vai para os gestores das unidades. Ele serve para todas —
            quem abre escolhe a unidade pelo número.
          </p>
          <div className="mt-3 flex gap-2 items-center flex-wrap">
            <code className="flex-1 min-w-[200px] text-[11.5px] bg-slate-800 rounded-lg px-3 py-2 break-all">
              {enderecoDoLink}
            </code>
            <button onClick={copiar}
              className="bg-teal-600 rounded-lg px-4 py-2 text-[12.5px] font-medium">
              {copiado || "Copiar"}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {[["aberta", "Abertas"], ["em_atendimento", "Em atendimento"],
          ["atendida", "Atendidas"], ["cancelada", "Canceladas"], ["", "Todas"]].map(([k, r]) => (
          <button key={k || "todas"} onClick={() => setFiltro(k)}
            className={`px-3 py-2 rounded-lg text-[13px] border ${
              filtro === k ? "bg-slate-900 text-white border-slate-900"
                           : "bg-white text-slate-600 border-slate-200"}`}>{r}</button>
        ))}
      </div>

      {erro && <p className="text-[13px] text-rose-600">{erro}</p>}
      {!linhas && <p className="text-sm text-slate-400">Carregando…</p>}

      {linhas && linhas.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
          <p className="text-[13px] text-slate-500">Nenhum pedido por aqui ainda.</p>
        </div>
      )}

      <div className="space-y-2">
        {(linhas || []).map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <p className="text-[14px] font-semibold">
                  {r.quantidade} {r.quantidade === 1 ? "pessoa" : "pessoas"} · {r.unidade_codigo}
                  {r.urgente && (
                    <span className="ml-2 text-[10.5px] bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 align-middle">
                      urgente
                    </span>
                  )}
                </p>
                <p className="text-[12.5px] text-slate-600">{r.unidade_nome}</p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  {r.local_cidade || "—"} · a partir de {dataBR(r.previsao_inicio)}
                  {r.previsao_fim ? ` até ${dataBR(r.previsao_fim)}` : ""}
                  {r.turno ? ` · ${r.turno}` : ""}
                  {r.dias_antecedencia != null && ` · pedido com ${r.dias_antecedencia} ${
                    r.dias_antecedencia === 1 ? "dia" : "dias"} de antecedência`}
                </p>
                <p className="text-[11.5px] text-slate-500 mt-1">
                  {r.solicitante_nome}
                  {r.solicitante_fone ? ` · ${r.solicitante_fone}` : ""}
                  {r.solicitante_tipo === "mmg" && <span className="text-sky-700"> · da MMG</span>}
                </p>
                {(r.atividades_nomes || r.atividades)?.length > 0 && (
                  <p className="text-[11.5px] text-slate-600 mt-1">
                    {(r.atividades_nomes || r.atividades).join(", ")}
                    {r.atividades_de_risco > 0 && (
                      <span className="text-amber-700"> · exige NR em dia</span>
                    )}
                  </p>
                )}
                {r.observacoes && (
                  <p className="text-[12px] text-slate-600 mt-1.5 italic">"{r.observacoes}"</p>
                )}
              </div>

              <div className="text-right shrink-0">
                <span className={`text-[11px] px-2 py-1 rounded ${
                  r.status === "aberta" ? "bg-amber-50 text-amber-700"
                  : r.status === "em_atendimento" ? "bg-sky-50 text-sky-700"
                  : r.status === "atendida" ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"}`}>
                  {r.status.replace("_", " ")}
                </span>
                {r.atendida_por && (
                  <p className="text-[10.5px] text-slate-400 mt-1">por {r.atendida_por}</p>
                )}
              </div>
            </div>

            {podeEditar && r.status !== "atendida" && r.status !== "cancelada" && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {r.status === "aberta" && (
                  <button onClick={() => mudar(r.id, "em_atendimento")}
                    className="px-3 py-1.5 rounded-lg text-[12px] bg-sky-600 text-white">
                    Assumir
                  </button>
                )}
                <button onClick={() => mudar(r.id, "atendida")}
                  className="px-3 py-1.5 rounded-lg text-[12px] bg-emerald-600 text-white">
                  Marcar atendida
                </button>
                <button onClick={() => mudar(r.id, "cancelada")}
                  className="px-3 py-1.5 rounded-lg text-[12px] border border-slate-200 text-slate-600">
                  Cancelar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-400">
        A antecedência é calculada no momento do envio, não declarada por quem pede. Pedido com
        três dias ou menos entra como urgente — e a soma desses casos por unidade é o que mostra
        quem sempre pede em cima da hora.
      </p>
    </div>
  );
}
