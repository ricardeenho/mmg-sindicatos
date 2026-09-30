import { useState, useEffect, useRef, useMemo } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const TURNOS = [
  ["manha", "Manhã"], ["tarde", "Tarde"], ["noite", "Noite"], ["integral", "Dia inteiro"],
];

/* 14/09/2026 — motivos do cancelamento. Lista fechada, os mesmos
   códigos do backend. */
const MOTIVOS_CANCELAMENTO = [
  ["engano", "Foi engano — não era para ter pedido"],
  ["duplicado", "Duplicado — já havia esse pedido"],
  ["nao_precisa", "Não precisa mais"],
  ["outro_caminho", "Resolvido por outro caminho"],
  ["outro", "Outro"],
];

/* 16/09/2026 — REQUISIÇÃO POR QUINZENA.
   A unidade escolhe a quinzena (1 a 15 ou 16 ao fim) e diz quantas
   pessoas por função. O sistema calcula o corte, o encerramento da
   requisição e avisa quando o pedido chega depois do corte. Pedido
   avulso, com início e fim, continua existindo — e o sistema diz em
   qual escala ele cai. */

/* O recado da MMG sobre o prazo, no RECIBO de pedido fora do prazo. */
const RECADO_PRAZO = (corte) => [
  `Olá! Lembramos que, conforme nosso acordo, os pedidos para esta quinzena deveriam entrar até ${corte}. Esse prazo é o que permite montar as escalas de rodízio, conferir documentação, treinamentos e exames, e divulgar a escala aos trabalhadores com antecedência.`,
  "Como o pedido chegou depois do corte, ele foi registrado como fora do prazo e já estamos trabalhando para viabilizar o atendimento, sujeito à disponibilidade de trabalhadores aptos.",
  "Agradecemos a compreensão e contamos com a observância do prazo nos próximos pedidos.",
  "MMG.",
];

const hoje = () => new Date().toISOString().slice(0, 10);
const dataBR = (d) => {
  if (!d) return "";
  const [ano, mes, dia] = String(d).slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
};
const diaMes = (d) => dataBR(d).slice(0, 5);
const rotuloQuinzena = (q) =>
  q ? `${q.quinzena_numero === 1 || q.numero === 1 ? "1ª" : "2ª"} quinzena · ${diaMes(q.quinzena_inicio)} a ${dataBR(q.quinzena_fim)}` : "";

/* Fica FORA do componente de propósito: declarada dentro, seria uma
   função nova a cada tecla e o campo perderia o foco. */
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

const Contador = ({ valor, aoMudar, max = 200 }) => (
  <div className="flex items-center gap-2">
    <button onClick={() => aoMudar(Math.max(0, valor - 1))}
      className="w-10 h-10 rounded-lg border border-slate-300 text-lg">−</button>
    <input type="number" min="0" max={max} value={valor}
      onChange={(e) => aoMudar(Math.min(max, Math.max(0, parseInt(e.target.value || 0, 10))))}
      className="w-14 text-center border border-slate-300 rounded-lg py-2 text-[17px] font-semibold tabular-nums" />
    <button onClick={() => aoMudar(Math.min(max, valor + 1))}
      className="w-10 h-10 rounded-lg border border-slate-300 text-lg">+</button>
  </div>
);

/* ==================================================================
 * TELA PÚBLICA — quem abre o link não tem login
 * ================================================================ */
export default function Requisicao({ token, unidadeParam }) {
  const [estado, setEstado] = useState("carregando"); // carregando | erro | formulario | pronto
  const [erro, setErro] = useState("");
  const [atividades, setAtividades] = useState([]);
  const [funcoesRef, setFuncoesRef] = useState([]);
  const [quinzenas, setQuinzenas] = useState([]);
  const [unidade, setUnidade] = useState(null);
  const [travada, setTravada] = useState(false);

  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const debounce = useRef(null);

  const [funcoes, setFuncoes] = useState({});      // { codigo: quantidade }
  const [modo, setModo] = useState("quinzena");    // quinzena | avulsa
  const [quinzena, setQuinzena] = useState(null);  // objeto da lista
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [nome, setNome] = useState("");
  const [fone, setFone] = useState("");
  const [tipoSolic, setTipoSolic] = useState("unidade");

  const [detalhado, setDetalhado] = useState(false);
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
        setFuncoesRef(d.funcoes || []);
        setQuinzenas(d.quinzenas || []);
        // a próxima quinzena com corte aberto é a sugestão; senão a próxima
        const abertas = (d.quinzenas || []).filter((q) => q.posicao !== "atual");
        setQuinzena(abertas.find((q) => !q.corte_passou) || abertas[0] || null);
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

  const total = useMemo(() => Object.values(funcoes).reduce((a, v) => a + (v || 0), 0), [funcoes]);

  /* Em qual quinzena cai o pedido avulso, para avisar antes do envio */
  const quinzenaDoAvulso = useMemo(() => {
    if (modo !== "avulsa" || !inicio) return null;
    return quinzenas.find((q) =>
      String(q.quinzena_inicio).slice(0, 10) <= inicio && String(q.quinzena_fim).slice(0, 10) >= inicio) || null;
  }, [modo, inicio, quinzenas]);

  const foraDoPrazo = modo === "quinzena" ? !!quinzena?.corte_passou : !!quinzenaDoAvulso?.corte_passou;

  async function enviar() {
    setEnviando(true); setErro("");
    try {
      const r = await fetch(`${API}/requisicoes/publico/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unidade_id: unidade?.id,
          tipo: modo,
          quinzena_inicio: modo === "quinzena" ? String(quinzena?.quinzena_inicio).slice(0, 10) : null,
          previsao_inicio: modo === "avulsa" ? inicio : null,
          previsao_fim: modo === "avulsa" ? fim : null,
          funcoes: Object.entries(funcoes).filter(([, q]) => q > 0).map(([funcao, quantidade]) => ({ funcao, quantidade })),
          turno: turno || null,
          hora_inicio: horaInicio || null,
          hora_fim: horaFim || null,
          atividades: escolhidas,
          observacoes,
          solicitante_nome: nome,
          solicitante_fone: fone,
          solicitante_tipo: tipoSolic,
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
    setFuncoes({}); setInicio(""); setFim(""); setTurno("");
    setHoraInicio(""); setHoraFim(""); setEscolhidas([]); setObservacoes("");
    setDetalhado(false); setErro("");
  }

  const datasOk = modo === "quinzena" ? !!quinzena : (inicio && fim && fim >= inicio);
  const podeEnviar = unidade && total >= 1 && datasOk && nome.trim().length >= 3;

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
        <div className="bg-white rounded-2xl p-6">
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 grid place-items-center mx-auto mb-4">
              <span className="text-emerald-700 text-2xl">✓</span>
            </div>
            <p className="text-[16px] font-semibold text-slate-900">Pedido recebido</p>
            <p className="text-[13px] text-slate-600 mt-1">
              Protocolo <b className="tabular-nums">{recibo.protocolo}</b>
            </p>
          </div>

          <div className="mt-4 bg-slate-50 rounded-xl p-4 text-[12.5px] text-slate-700 space-y-1">
            <p><span className="text-slate-500">Unidade</span> · {unidade?.codigo} {unidade?.nome}</p>
            <p><span className="text-slate-500">Pessoas</span> · {recibo.quantidade} no total</p>
            {(recibo.funcoes || []).map((f) => (
              <p key={f.funcao} className="pl-3">{f.quantidade} × {f.nome}</p>
            ))}
            {recibo.tipo === "avulsa" ? (
              <p><span className="text-slate-500">Período</span> · {dataBR(inicio)} a {dataBR(fim)} · entra na escala da {rotuloQuinzena(recibo)}</p>
            ) : (
              <p><span className="text-slate-500">Período apurado</span> · {rotuloQuinzena(recibo)}</p>
            )}
            <p><span className="text-slate-500">Encerramento da requisição</span> · {dataBR(recibo.encerramento)}</p>
            {recibo.aditivo && (
              <p className="text-sky-800">A escala desta quinzena já foi publicada: o pedido entra como aditivo.</p>
            )}
          </div>

          {!recibo.fora_do_prazo && (
            <p className="text-[13px] text-slate-600 mt-4 leading-relaxed text-center">
              O sindicato vai montar a escala e divulgar aos trabalhadores antes do início da quinzena.
            </p>
          )}
          {recibo.fora_do_prazo && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
              {RECADO_PRAZO(dataBR(recibo.corte)).map((p, i) => (
                <p key={i} className={`text-[12.5px] text-amber-900 leading-relaxed ${i ? "mt-2.5" : ""}`}>{p}</p>
              ))}
            </div>
          )}
          <button onClick={outroPedido}
            className="mt-5 w-full bg-slate-900 text-white rounded-xl py-3 text-[14px] font-medium">
            Fazer outro pedido
          </button>
        </div>
      </Moldura>
    );
  }

  const quinzenasOferecidas = quinzenas.filter((q) => q.posicao !== "atual");

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

        {/* ---- quando ---- */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-[13px] font-medium text-slate-900 mb-1">Para quando?</p>
          <div className="flex gap-2 mb-3">
            {[["quinzena", "Uma quinzena"], ["avulsa", "Datas avulsas"]].map(([v, r]) => (
              <button key={v} onClick={() => setModo(v)}
                className={`flex-1 px-3 py-2.5 rounded-xl text-[13px] border ${
                  modo === v ? "bg-slate-900 text-white border-slate-900"
                             : "bg-white text-slate-600 border-slate-300"}`}>{r}</button>
            ))}
          </div>

          {modo === "quinzena" && (
            <div className="space-y-2">
              {quinzenasOferecidas.map((q) => {
                const marcada = quinzena?.quinzena_inicio === q.quinzena_inicio;
                return (
                  <button key={q.quinzena_inicio} onClick={() => setQuinzena(q)}
                    className={`w-full text-left rounded-xl border p-3 ${
                      marcada ? "border-teal-500 bg-teal-50" : "border-slate-200"}`}>
                    <p className="text-[14px] font-medium text-slate-900">{rotuloQuinzena(q)}</p>
                    <p className={`text-[11.5px] mt-0.5 ${q.corte_passou ? "text-amber-700" : "text-slate-500"}`}>
                      {q.corte_passou
                        ? `o prazo para pedir era ${dataBR(q.corte)} — entra como fora do prazo`
                        : `pedidos até ${dataBR(q.corte)} · escala divulgada antes de ${diaMes(q.quinzena_inicio)}`}
                    </p>
                  </button>
                );
              })}
              {quinzenasOferecidas.length === 0 && (
                <p className="text-[12px] text-rose-600">Não consegui calcular as quinzenas. Use datas avulsas.</p>
              )}
            </div>
          )}

          {modo === "avulsa" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Começa</p>
                <input type="date" value={inicio} min={hoje()}
                  onChange={(e) => { setInicio(e.target.value); if (!fim || fim < e.target.value) setFim(e.target.value); }}
                  className="w-full border border-slate-300 rounded-xl px-3 py-3 text-[15px]" />
              </div>
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Termina</p>
                <input type="date" value={fim} min={inicio || hoje()} onChange={(e) => setFim(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-3 text-[15px]" />
              </div>
              {quinzenaDoAvulso && (
                <p className="col-span-2 text-[11.5px] text-slate-600">
                  Entra na escala da {rotuloQuinzena(quinzenaDoAvulso)}
                  {quinzenaDoAvulso.corte_passou && <span className="text-amber-700"> · fora do prazo (corte era {dataBR(quinzenaDoAvulso.corte)})</span>}.
                  A requisição se encerra no último dia trabalhado.
                </p>
              )}
            </div>
          )}

          {foraDoPrazo && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-[12px] text-amber-900 leading-relaxed">
                <b>Depois do corte.</b> O pedido entra, mas fica registrado como fora do prazo. A escala
                dessa quinzena pode já estar montada — o sindicato faz o possível, e avisa por telefone
                também se puder.
              </p>
            </div>
          )}
        </div>

        {/* ---- quantas pessoas, por função ---- */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-[13px] font-medium text-slate-900 mb-1">Quantas pessoas, por função?</p>
          <p className="text-[11.5px] text-slate-500 mb-3">
            Contando as que já estão na unidade — é o quadro completo que você quer para o período.
          </p>
          <div className="space-y-2">
            {funcoesRef.map((f) => (
              <div key={f.codigo} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                funcoes[f.codigo] > 0 ? "border-teal-300 bg-teal-50/40" : "border-slate-200"}`}>
                <div className="min-w-0">
                  <p className="text-[13px] text-slate-900 leading-tight">{f.nome}</p>
                  <p className="text-[10.5px] text-slate-500">Lei 12.023, art. 2º, inc. {f.inciso}</p>
                </div>
                <Contador valor={funcoes[f.codigo] || 0}
                  aoMudar={(v) => setFuncoes({ ...funcoes, [f.codigo]: v })} />
              </div>
            ))}
          </div>
          <p className="text-[13px] text-slate-700 mt-3 text-right">
            Total: <b className="tabular-nums">{total}</b> {total === 1 ? "pessoa" : "pessoas"}
          </p>
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
              <button key={v} onClick={() => setTipoSolic(v)}
                className={`flex-1 px-3 py-2.5 rounded-xl text-[13px] border ${
                  tipoSolic === v ? "bg-slate-900 text-white border-slate-900"
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
            Falta escolher a unidade, o período, ao menos uma função e escrever seu nome.
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
  const [quinzenas, setQuinzenas] = useState([]);
  const [filtro, setFiltro] = useState("aberta");
  const [quinzenaFiltro, setQuinzenaFiltro] = useState("");
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");
  const [assinaturaPara, setAssinaturaPara] = useState(null);
  const [gerandoAssinatura, setGerandoAssinatura] = useState(false);
  const [assinaturaGerada, setAssinaturaGerada] = useState(null);
  const [qrAssinatura, setQrAssinatura] = useState("");

  const [cancelando, setCancelando] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvandoCancel, setSalvandoCancel] = useState(false);

  async function carregar() {
    try {
      const qs = [filtro ? `status=${filtro}` : "", quinzenaFiltro ? `quinzena=${quinzenaFiltro}` : ""]
        .filter(Boolean).join("&");
      const [r, l, q] = await Promise.all([
        pedir(`/requisicoes${qs ? `?${qs}` : ""}`, token),
        pedir("/requisicoes/links/lista", token).catch(() => []),
        pedir("/requisicoes/quinzenas", token).catch(() => []),
      ]);
      setLinhas(r); setLinks(l); setQuinzenas(q);
    } catch (e) { setErro(e.message); }
  }

  useEffect(() => { setLinhas(null); carregar(); }, [filtro, quinzenaFiltro, token]);

  async function mudar(id, status) {
    setErro("");
    try {
      await gravar(`/requisicoes/${id}`, token, { status }, "PATCH");
      await carregar();
    } catch (e) { setErro(e.message); }
  }

  function abrirCancelamento(id) { setCancelando(id); setMotivo(""); setObservacao(""); setErro(""); }
  function fecharCancelamento() { setCancelando(null); setMotivo(""); setObservacao(""); }

  async function confirmarCancelamento(id) {
    setSalvandoCancel(true); setErro("");
    try {
      await gravar(`/requisicoes/${id}`, token, { status: "cancelada", motivo, observacao }, "PATCH");
      fecharCancelamento();
      await carregar();
    } catch (e) { setErro(e.message); } finally { setSalvandoCancel(false); }
  }

  function abrirAssinatura(requisicao) {
    setAssinaturaPara(requisicao);
    setAssinaturaGerada(null);
    if (qrAssinatura) URL.revokeObjectURL(qrAssinatura);
    setQrAssinatura("");
    setErro("");
  }

  function fecharAssinatura() {
    if (qrAssinatura) URL.revokeObjectURL(qrAssinatura);
    setQrAssinatura("");
    setAssinaturaGerada(null);
    setAssinaturaPara(null);
  }

  async function gerarAssinatura() {
    if (!assinaturaPara || !assinaturaPara.gerente_usuario_id) return;
    setGerandoAssinatura(true); setErro("");
    try {
      const d = await gravar(`/assinaturas/requisicao/${assinaturaPara.id}`, token, {}, "POST");
      const r = await fetch(`${API}/assinaturas/${d.assinaturaId}/qr`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ token: d.token }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || "Não consegui gerar o QR da assinatura");
      }
      const url = URL.createObjectURL(await r.blob());
      if (qrAssinatura) URL.revokeObjectURL(qrAssinatura);
      setQrAssinatura(url);
      setAssinaturaGerada(d);
      await carregar();
    } catch (e) { setErro(e.message); } finally { setGerandoAssinatura(false); }
  }

  function copiarAssinatura() {
    if (!assinaturaGerada?.signingUrl) return;
    navigator.clipboard?.writeText(assinaturaGerada.signingUrl);
    setCopiado("assinatura");
    setTimeout(() => setCopiado(""), 2000);
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
            quem abre escolhe a unidade pelo número, a quinzena e as funções.
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

      {/* ---- as quinzenas de referência ---- */}
      {quinzenas.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-2">
          {quinzenas.map((q) => {
            const ativa = quinzenaFiltro === String(q.quinzena_inicio).slice(0, 10);
            return (
              <button key={q.quinzena_inicio}
                onClick={() => setQuinzenaFiltro(ativa ? "" : String(q.quinzena_inicio).slice(0, 10))}
                className={`text-left rounded-xl border p-3 ${
                  ativa ? "border-slate-900 bg-slate-900 text-white" : "bg-white border-slate-200"}`}>
                <p className="text-[10.5px] uppercase tracking-wide opacity-70">{q.posicao}</p>
                <p className="text-[13px] font-medium">{rotuloQuinzena(q)}</p>
                <p className={`text-[11px] mt-0.5 ${ativa ? "text-slate-300" : "text-slate-500"}`}>
                  {q.pedidos} {q.pedidos === 1 ? "pedido" : "pedidos"} · {q.unidades} unidades · {q.pessoas} pessoas
                </p>
                <p className={`text-[10.5px] mt-0.5 ${ativa ? "text-slate-400" : q.corte_passou ? "text-amber-700" : "text-slate-400"}`}>
                  corte {dataBR(q.corte)}{q.corte_passou ? " · passou" : ""} · encerra {dataBR(q.encerramento)}
                </p>
              </button>
            );
          })}
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
                  {r.fora_do_prazo && (
                    <span className="ml-2 text-[10.5px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5 align-middle">fora do prazo</span>
                  )}
                  {r.aditivo && (
                    <span className="ml-2 text-[10.5px] bg-sky-100 text-sky-800 rounded px-1.5 py-0.5 align-middle">aditivo</span>
                  )}
                  {r.tipo === "avulsa" && (
                    <span className="ml-2 text-[10.5px] bg-slate-100 text-slate-700 rounded px-1.5 py-0.5 align-middle">avulsa</span>
                  )}
                  {r.urgente && !r.fora_do_prazo && (
                    <span className="ml-2 text-[10.5px] bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 align-middle">urgente</span>
                  )}
                </p>
                <p className="text-[12.5px] text-slate-600">{r.unidade_nome}</p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  {r.local_cidade || "—"}
                  {r.quinzena_inicio && ` · ${rotuloQuinzena(r)}`}
                  {r.tipo === "avulsa" && ` · ${dataBR(r.previsao_inicio)} a ${dataBR(r.previsao_fim)}`}
                  {r.encerramento && ` · encerra ${dataBR(r.encerramento)}`}
                  {r.turno ? ` · ${r.turno}` : ""}
                </p>
                {(r.funcoes || []).length > 0 && (
                  <p className="text-[11.5px] text-slate-700 mt-1">
                    {r.funcoes.map((f) => `${f.quantidade} × ${f.nome}`).join(" · ")}
                  </p>
                )}
                <p className="text-[11.5px] text-slate-500 mt-1">
                  {r.solicitante_nome}
                  {r.solicitante_fone ? ` · ${r.solicitante_fone}` : ""}
                  {r.solicitante_tipo === "mmg" && <span className="text-sky-700"> · da MMG</span>}
                  {r.dias_antecedencia != null && ` · pedido com ${r.dias_antecedencia} ${
                    r.dias_antecedencia === 1 ? "dia" : "dias"} de antecedência`}
                </p>
                {(r.atividades_nomes || r.atividades)?.length > 0 && (
                  <p className="text-[11.5px] text-slate-600 mt-1">
                    {(r.atividades_nomes || r.atividades).join(", ")}
                    {r.atividades_de_risco > 0 && <span className="text-amber-700"> · exige NR em dia</span>}
                  </p>
                )}
                {r.observacoes && (
                  <p className="text-[12px] text-slate-600 mt-1.5 italic">"{r.observacoes}"</p>
                )}
                {(r.status === "cancelada" || r.status === "atendida") && r.atendida_obs && (
                  <p className="text-[11.5px] text-slate-500 mt-1.5">
                    <span className="text-slate-400">Motivo:</span> {r.atendida_obs}
                  </p>
                )}

                <div className={`mt-3 rounded-xl border px-3 py-2.5 ${
                  r.gerente_usuario_id ? "bg-violet-50 border-violet-200" : "bg-amber-50 border-amber-200"}`}>
                  <p className={`text-[10.5px] uppercase tracking-wide font-semibold ${
                    r.gerente_usuario_id ? "text-violet-700" : "text-amber-700"}`}>
                    Responsável pela assinatura
                  </p>
                  {r.gerente_usuario_id ? (
                    <>
                      <p className="text-[13px] font-semibold text-slate-900 mt-0.5">{r.gerente_nome}</p>
                      <p className="text-[11px] text-slate-500">@{r.gerente_usuario} · gerente da unidade</p>
                    </>
                  ) : (
                    <p className="text-[12px] text-amber-800 mt-0.5">Nenhum gerente vinculado a esta unidade. Configure em Acessos.</p>
                  )}
                </div>

                {(r.assinaturas || []).length > 0 && (
                  <div className="mt-3 space-y-2">
                    {(r.assinaturas || []).map((a) => (
                      <div key={a.id} className={`rounded-xl border px-3 py-2.5 ${
                        a.status === "assinada" ? "bg-emerald-50 border-emerald-200"
                        : a.status === "expirada" ? "bg-rose-50 border-rose-200"
                        : "bg-violet-50 border-violet-200"}`}>
                        <p className={`text-[10.5px] uppercase tracking-wide font-semibold ${
                          a.status === "assinada" ? "text-emerald-700"
                          : a.status === "expirada" ? "text-rose-700"
                          : "text-violet-700"}`}>
                          {a.status === "assinada" ? "Assinado por" : a.status === "expirada" ? "Assinatura expirada" : "Quem vai assinar"}
                        </p>
                        <div className="flex items-center justify-between gap-3 mt-0.5 flex-wrap">
                          <div>
                            <p className="text-[13px] font-semibold text-slate-900">{a.assinante_nome}</p>
                            {a.assinante_usuario && <p className="text-[11px] text-slate-500">@{a.assinante_usuario}</p>}
                          </div>
                          <span className={`text-[10.5px] rounded-full px-2 py-1 ${
                            a.status === "assinada" ? "bg-emerald-100 text-emerald-800"
                            : a.status === "expirada" ? "bg-rose-100 text-rose-700"
                            : "bg-violet-100 text-violet-800"}`}>
                            {a.status}
                          </span>
                        </div>
                        {a.status === "assinada" && a.assinada_em && (
                          <p className="text-[10.5px] text-slate-500 mt-1">Assinada em {new Date(a.assinada_em).toLocaleString("pt-BR")}</p>
                        )}
                        {a.status === "pendente" && a.expira_em && (
                          <p className="text-[10.5px] text-slate-500 mt-1">Aguardando assinatura · expira em {new Date(a.expira_em).toLocaleString("pt-BR")}</p>
                        )}
                        {a.status === "assinada" && a.validation_code && (
                          <div className="mt-2 flex items-center gap-3 flex-wrap">
                            <a href={`/?validar=${encodeURIComponent(a.validation_code)}`}
                              className="text-[11px] text-teal-700 underline font-medium">Validar assinatura</a>
                            <a href={`/?validar=${encodeURIComponent(a.validation_code)}`}
                              title={`Validar assinatura de ${a.assinante_nome}`}>
                              <img src={`${API}/assinaturas/validar/${encodeURIComponent(a.validation_code)}/qr`}
                                alt={`QR de validação de ${a.assinante_nome}`}
                                className="w-16 h-16 bg-white border border-slate-200 rounded-lg p-1" />
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
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

            {podeEditar && r.status !== "atendida" && r.status !== "cancelada" && cancelando !== r.id && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {r.status === "aberta" && (
                  <button onClick={() => mudar(r.id, "em_atendimento")}
                    className="px-3 py-1.5 rounded-lg text-[12px] bg-sky-600 text-white">Assumir</button>
                )}
                <button onClick={() => mudar(r.id, "atendida")}
                  className="px-3 py-1.5 rounded-lg text-[12px] bg-emerald-600 text-white">Marcar atendida</button>
                <button onClick={() => abrirAssinatura(r)}
                  className="px-3 py-1.5 rounded-lg text-[12px] bg-violet-600 text-white">Solicitar assinatura do gerente</button>
                <button onClick={() => abrirCancelamento(r.id)}
                  className="px-3 py-1.5 rounded-lg text-[12px] border border-slate-200 text-slate-600">Cancelar</button>
              </div>
            )}

            {podeEditar && cancelando === r.id && (
              <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[12.5px] font-medium text-slate-800">Por que está cancelando?</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  O pedido não é apagado: ele fica no arquivo com o motivo. Engano e duplicado ficam
                  de fora da estatística; "não precisa mais" continua contando.
                </p>
                <div className="mt-2.5 space-y-1.5">
                  {MOTIVOS_CANCELAMENTO.map(([codigo, rotulo]) => (
                    <button key={codigo} onClick={() => setMotivo(codigo)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-[12.5px] border ${
                        motivo === codigo ? "bg-slate-900 text-white border-slate-900"
                                          : "bg-white text-slate-600 border-slate-200"}`}>{rotulo}</button>
                  ))}
                </div>
                {motivo && (
                  <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2}
                    placeholder={motivo === "outro" ? "Escreva o motivo (obrigatório)" : "Quer acrescentar alguma coisa? (opcional)"}
                    className="mt-2.5 w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px]" />
                )}
                <div className="flex gap-2 mt-2.5 flex-wrap">
                  <button onClick={() => confirmarCancelamento(r.id)}
                    disabled={!motivo || salvandoCancel || (motivo === "outro" && observacao.trim().length < 5)}
                    className="px-3 py-1.5 rounded-lg text-[12px] bg-slate-900 text-white disabled:opacity-40">
                    {salvandoCancel ? "Cancelando…" : "Confirmar cancelamento"}
                  </button>
                  <button onClick={fecharCancelamento}
                    className="px-3 py-1.5 rounded-lg text-[12px] border border-slate-200 text-slate-600">Voltar</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {assinaturaPara && (
        <div className="fixed inset-0 z-40 bg-slate-900/55 p-4 overflow-y-auto" onClick={fecharAssinatura}>
          <div className="bg-white rounded-2xl max-w-lg mx-auto mt-10 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold">Assinatura da requisição</p>
                <p className="text-[16px] font-semibold mt-1">{assinaturaPara.unidade_codigo} · {assinaturaPara.unidade_nome}</p>
                <p className="text-[12px] text-slate-500">O responsável é definido automaticamente pela unidade.</p>
              </div>
              <button onClick={fecharAssinatura} className="text-slate-400 text-xl">×</button>
            </div>

            {!assinaturaGerada && (
              <div className="mt-4">
                {assinaturaPara.gerente_usuario_id ? (
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-3">
                    <p className="text-[10.5px] uppercase tracking-wide text-violet-700 font-semibold">Quem vai assinar</p>
                    <p className="text-[14px] font-semibold text-slate-900 mt-0.5">{assinaturaPara.gerente_nome}</p>
                    <p className="text-[11px] text-slate-500">@{assinaturaPara.gerente_usuario} · gerente responsável por esta unidade</p>
                    <p className="text-[11px] text-violet-700 mt-2">Não é possível trocar o assinante aqui. Para mudar, altere o vínculo da unidade em Acessos.</p>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-[12px] font-semibold text-amber-900">Esta unidade ainda não tem gerente responsável.</p>
                    <p className="text-[11px] text-amber-800 mt-1">Vá em Acessos, abra o gerente e vincule esta unidade antes de gerar o QR.</p>
                  </div>
                )}

                <button onClick={gerarAssinatura}
                  disabled={!assinaturaPara.gerente_usuario_id || gerandoAssinatura}
                  className="w-full mt-3 bg-violet-600 text-white rounded-xl py-3 text-[13px] font-semibold disabled:opacity-40">
                  {gerandoAssinatura ? "Gerando…" : assinaturaPara.gerente_usuario_id
                    ? `Gerar QR para ${assinaturaPara.gerente_nome}`
                    : "Vincule um gerente primeiro"}
                </button>
              </div>
            )}

            {assinaturaGerada && (
              <div className="mt-4 space-y-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[12px] font-medium text-amber-900">Este token é mostrado somente agora</p>
                  <p className="text-[11px] text-amber-800 mt-0.5">Apresente o QR ao usuário ou copie o link antes de fechar.</p>
                </div>
                {qrAssinatura && (
                  <img src={qrAssinatura} alt="QR para assinar" className="w-64 h-64 mx-auto rounded-xl border border-slate-200 p-2" />
                )}
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[11px] text-slate-500">Destinatário</p>
                  <p className="text-[13px] font-medium">{assinaturaGerada.usuario?.nome}</p>
                  <p className="text-[11px] text-slate-500 mt-2">Token</p>
                  <code className="block text-[11px] break-all bg-white border border-slate-200 rounded p-2 mt-1">{assinaturaGerada.token}</code>
                  <p className="text-[11px] text-slate-500 mt-2">Expira em {new Date(assinaturaGerada.expiraEm).toLocaleString("pt-BR")}</p>
                </div>
                <button onClick={copiarAssinatura}
                  className="w-full border border-slate-200 rounded-xl py-2.5 text-[12px] font-medium text-slate-700">
                  {copiado === "assinatura" ? "Link copiado" : "Copiar link de assinatura"}
                </button>
              </div>
            )}

            {erro && <p className="text-[12px] text-rose-600 mt-3">{erro}</p>}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Fora do prazo é o pedido que chegou depois do corte da quinzena — a data está nos Critérios.
        O encerramento é a data em que a requisição se encerra para faturamento; o período apurado é o
        que a escala e a folha cobrem.
      </p>
    </div>
  );
}
