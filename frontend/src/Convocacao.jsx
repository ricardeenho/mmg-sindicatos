import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const dataBR = (d) => {
  if (!d) return "";
  const [a, m, dia] = String(d).slice(0, 10).split("-");
  return a && m && dia ? `${dia}/${m}/${a}` : "";
};
const horaBR = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "");

/* Fica FORA do componente de propósito: declarada dentro, seria função
   nova a cada render e o React destruiria os campos, matando o foco. */
function Moldura({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="max-w-lg mx-auto">
        <img src="/logo-mmg.png" alt="MMG" className="h-10 w-auto mb-5" />
        {children}
      </div>
    </div>
  );
}

/* ==================================================================
 * TELA PÚBLICA — o trabalhador abre pelo link do WhatsApp
 * ================================================================ */
export default function Convocacao({ token }) {
  const [c, setC] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch(`${API}/convocacoes/publico/${token}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Link inválido");
        setC(d);
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [token]);

  async function responder(caminho, corpo) {
    setEnviando(true); setErro("");
    try {
      const r = await fetch(`${API}/convocacoes/publico/${token}/${caminho}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo || {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não consegui registrar");
      setC({ ...c, status: d.status, respondida_em: new Date().toISOString() });
      setRecusando(false);
    } catch (e) { setErro(e.message); } finally { setEnviando(false); }
  }

  if (carregando) {
    return <Moldura><p className="text-sm text-slate-400">Abrindo…</p></Moldura>;
  }

  if (erro && !c) {
    return (
      <Moldura>
        <div className="bg-white rounded-2xl p-6">
          <p className="text-[15px] font-medium text-rose-700 mb-2">Este link não está funcionando</p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            {erro}. Fale com o sindicato.
          </p>
        </div>
      </Moldura>
    );
  }

  /* --------- já respondida --------- */
  if (c.status === "aceita" || c.status === "recusada") {
    const aceitou = c.status === "aceita";
    return (
      <Moldura>
        <div className="bg-white rounded-2xl p-6 text-center">
          <div className={`w-14 h-14 rounded-full grid place-items-center mx-auto mb-4 ${
            aceitou ? "bg-emerald-100" : "bg-slate-100"}`}>
            <span className={`text-2xl ${aceitou ? "text-emerald-700" : "text-slate-500"}`}>
              {aceitou ? "✓" : "—"}
            </span>
          </div>
          <p className="text-[16px] font-semibold text-slate-900">
            {aceitou ? "Combinado!" : "Resposta registrada"}
          </p>

          {aceitou ? (
            <div className="mt-3 text-[14px] text-slate-700 leading-relaxed">
              <p>Apresente-se em <b>{c.destino_local}</b>{c.destino_setor ? ` · ${c.destino_setor}` : ""}</p>
              <p className="mt-1">de <b>{dataBR(c.data_inicio)}</b> a <b>{dataBR(c.data_fim)}</b></p>
              {c.destino_cidade && <p className="text-[12.5px] text-slate-500 mt-1">{c.destino_cidade}</p>}
            </div>
          ) : (
            <p className="mt-3 text-[13.5px] text-slate-600 leading-relaxed">
              O sindicato foi avisado{c.motivo_nome ? ` — ${c.motivo_nome.toLowerCase()}` : ""}.
              Não há nenhum problema: você continua na fila normalmente e será chamado de novo.
            </p>
          )}

          <p className="text-[11px] text-slate-400 mt-4">
            Escala {c.escala} · respondida em {horaBR(c.respondida_em)}
          </p>
        </div>
      </Moldura>
    );
  }

  /* --------- a responder --------- */
  return (
    <Moldura>
      <div className="space-y-3">
        <div className="bg-white rounded-2xl p-5">
          <p className="text-[13px] text-slate-500">Olá,</p>
          <p className="text-[19px] font-semibold text-slate-900 leading-tight">
            {c.nome || `Código ${c.codigo}`}
          </p>
          <p className="text-[13px] text-slate-600 mt-3 leading-relaxed">
            O sindicato escalou você para trabalhar em outra unidade nestes dias.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5">
          <p className="text-[11.5px] text-slate-500 uppercase tracking-wide mb-1">Onde</p>
          <p className="text-[17px] font-semibold text-slate-900 leading-tight">{c.destino_local}</p>
          {c.destino_setor && <p className="text-[14px] text-slate-700">{c.destino_setor}</p>}
          {c.destino_cidade && <p className="text-[13px] text-slate-500 mt-0.5">{c.destino_cidade}</p>}

          <div className="h-px bg-slate-100 my-4" />

          <p className="text-[11.5px] text-slate-500 uppercase tracking-wide mb-1">Quando</p>
          <p className="text-[17px] font-semibold text-slate-900">
            {dataBR(c.data_inicio)} a {dataBR(c.data_fim)}
          </p>
          <p className="text-[13px] text-slate-500">
            {c.dias} {c.dias === 1 ? "dia" : "dias"} · de segunda a sexta
          </p>

          {c.origem_local && (
            <p className="text-[12px] text-slate-400 mt-3">
              Você sai de {c.origem_local}
            </p>
          )}
        </div>

        {erro && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
            <p className="text-[13px] text-rose-700">{erro}</p>
          </div>
        )}

        {!recusando ? (
          <>
            <button onClick={() => responder("aceitar")} disabled={enviando}
              className="w-full bg-teal-600 text-white rounded-xl py-4 text-[16px] font-semibold disabled:opacity-50">
              {enviando ? "Registrando…" : "Confirmo que vou"}
            </button>
            <button onClick={() => setRecusando(true)} disabled={enviando}
              className="w-full bg-white border border-slate-300 text-slate-700 rounded-xl py-4 text-[15px] font-medium">
              Não vou poder ir
            </button>
            <p className="text-[12px] text-slate-500 text-center leading-relaxed px-2">
              Você pode recusar sem nenhum problema. Não há punição, não perde a vez
              e continua na fila para as próximas.
            </p>
          </>
        ) : (
          <div className="bg-white rounded-2xl p-5">
            <p className="text-[14px] font-medium text-slate-900 mb-1">Por que não vai poder ir?</p>
            <p className="text-[12px] text-slate-500 mb-3">
              Isso ajuda o sindicato a resolver o problema — se muita gente não consegue
              chegar, dá para providenciar transporte.
            </p>
            <div className="space-y-1.5">
              {(c.motivos || []).map((m) => (
                <button key={m.codigo} onClick={() => setMotivo(m.codigo)}
                  className={`w-full text-left rounded-xl border px-4 py-3 text-[14px] ${
                    motivo === m.codigo
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white border-slate-200 text-slate-700"}`}>
                  {m.nome}
                </button>
              ))}
            </div>

            {motivo === "outro" && (
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3}
                placeholder="Conte com suas palavras"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] mt-3" />
            )}

            <button onClick={() => responder("recusar", { motivo, motivo_texto: texto })}
              disabled={!motivo || enviando}
              className="w-full mt-4 bg-slate-900 text-white rounded-xl py-3.5 text-[15px] font-medium disabled:opacity-40">
              {enviando ? "Registrando…" : "Enviar resposta"}
            </button>
            <button onClick={() => setRecusando(false)}
              className="w-full mt-2 text-[13px] text-slate-500 py-2">
              Voltar
            </button>
          </div>
        )}
        <div className="h-6" />
      </div>
    </Moldura>
  );
}

/* ==================================================================
 * BLOCO DO PAINEL — dentro da escala publicada
 * ================================================================ */
export function BlocoConvocacoes({ token, escalaId, podeEditar, pedir, gravar }) {
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState("");
  const [registrando, setRegistrando] = useState(null);
  const [resposta, setResposta] = useState("aceita");
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [motivos, setMotivos] = useState([]);

  async function carregar() {
    try { setLinhas(await pedir(`/convocacoes?escala=${escalaId}`, token)); }
    catch (e) { setErro(e.message); }
  }
  useEffect(() => { carregar(); }, [escalaId, token]);

  useEffect(() => {
    if (registrando && motivos.length === 0) {
      fetch(`${API}/convocacoes/publico/${registrando.token}`)
        .then((r) => r.json()).then((d) => setMotivos(d.motivos || []))
        .catch(() => {});
    }
  }, [registrando, motivos.length]);

  async function gerar() {
    setGerando(true); setErro("");
    try { await gravar(`/convocacoes/gerar/${escalaId}`, token, {}, "POST"); await carregar(); }
    catch (e) { setErro(e.message); } finally { setGerando(false); }
  }

  async function registrar() {
    setErro("");
    try {
      await gravar(`/convocacoes/${registrando.id}/registrar`, token,
        { resposta, motivo: resposta === "recusada" ? motivo : null, observacao: obs }, "POST");
      setRegistrando(null); setMotivo(""); setObs(""); setResposta("aceita");
      await carregar();
    } catch (e) { setErro(e.message); }
  }

  const endereco = (t) => `${window.location.origin}/?c=${t}`;

  function copiar(c) {
    const msg =
      `Olá, ${c.trabalhador_nome || ""}. O sindicato escalou você para trabalhar em ` +
      `${c.destino_local}${c.destino_setor ? " · " + c.destino_setor : ""}, ` +
      `de ${dataBR(c.data_inicio)} a ${dataBR(c.data_fim)}. ` +
      `Confirme ou recuse por aqui: ${endereco(c.token)}`;
    navigator.clipboard?.writeText(msg);
    setCopiado(c.id); setTimeout(() => setCopiado(""), 2000);
  }

  const chip = (s) =>
    s === "aceita" ? "bg-emerald-50 text-emerald-700"
    : s === "recusada" ? "bg-rose-50 text-rose-700"
    : s === "vista" ? "bg-sky-50 text-sky-700"
    : "bg-amber-50 text-amber-700";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[13px] font-medium">Convocação dos trabalhadores</p>
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            Cada pessoa recebe um link só dela. Abrir o link já registra que a convocação
            chegou — e é a divulgação que cumpre o dever, não o aceite.
          </p>
        </div>
        {podeEditar && (!linhas || linhas.length === 0) && (
          <button onClick={gerar} disabled={gerando}
            className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[12.5px] font-medium disabled:opacity-50">
            {gerando ? "Gerando…" : "Gerar convocações"}
          </button>
        )}
      </div>

      {erro && <p className="text-[12px] text-rose-600 mt-2">{erro}</p>}
      {!linhas && <p className="text-[13px] text-slate-400 mt-3">Carregando…</p>}
      {linhas && linhas.length === 0 && (
        <p className="text-[13px] text-slate-500 mt-3">
          Nenhuma convocação gerada ainda.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {(linhas || []).map((c) => (
          <div key={c.id} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <p className="text-[13px]">
                  <b>{c.trabalhador_codigo}</b> {c.trabalhador_nome || "—"}
                </p>
                <p className="text-[11.5px] text-slate-500">
                  {c.destino_local} · {dataBR(c.data_inicio)} a {dataBR(c.data_fim)}
                </p>
                {c.respondida_em && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {c.status === "recusada" && c.motivo_nome ? `${c.motivo_nome} · ` : ""}
                    {horaBR(c.respondida_em)}
                    {c.respondida_por === "fiscal" && ` · registrado por ${c.registrada_por}`}
                  </p>
                )}
                {c.motivo_texto && (
                  <p className="text-[11.5px] text-slate-600 italic mt-0.5">"{c.motivo_texto}"</p>
                )}
                {c.observacao && (
                  <p className="text-[11px] text-slate-500 mt-0.5">{c.observacao}</p>
                )}
              </div>
              <span className={`text-[11px] px-2 py-1 rounded ${chip(c.status)}`}>{c.status}</span>
            </div>

            {podeEditar && (c.status === "enviada" || c.status === "vista") && (
              <div className="flex gap-2 mt-2 flex-wrap">
                <button onClick={() => copiar(c)}
                  className="text-[11.5px] px-3 py-1.5 rounded-lg bg-slate-900 text-white">
                  {copiado === c.id ? "copiado" : "Copiar mensagem"}
                </button>
                <button onClick={() => setRegistrando(c)}
                  className="text-[11.5px] px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600">
                  Registrar pelo fiscal
                </button>
              </div>
            )}

            {registrando?.id === c.id && (
              <div className="mt-3 bg-slate-50 rounded-lg p-3">
                <p className="text-[11.5px] text-slate-600 mb-2 leading-relaxed">
                  Use isto quando a pessoa não tem celular e respondeu presencialmente.
                  O seu nome fica gravado como quem registrou.
                </p>
                <div className="flex gap-2 mb-2">
                  {[["aceita", "Aceitou"], ["recusada", "Recusou"]].map(([v, r]) => (
                    <button key={v} onClick={() => setResposta(v)}
                      className={`flex-1 px-3 py-2 rounded-lg text-[12.5px] border ${
                        resposta === v ? "bg-slate-900 text-white border-slate-900"
                                       : "bg-white text-slate-600 border-slate-200"}`}>{r}</button>
                  ))}
                </div>

                {resposta === "recusada" && (
                  <select value={motivo} onChange={(e) => setMotivo(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] mb-2">
                    <option value="">Escolha o motivo…</option>
                    {motivos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}
                  </select>
                )}

                <input value={obs} onChange={(e) => setObs(e.target.value)}
                  placeholder="Observação — ex.: lista física assinada, arquivo 12"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] mb-2" />

                <div className="flex gap-2">
                  <button onClick={registrar}
                    disabled={resposta === "recusada" && !motivo}
                    className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[12.5px] font-medium disabled:opacity-40">
                    Registrar
                  </button>
                  <button onClick={() => setRegistrando(null)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] text-slate-600">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {linhas && linhas.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          A recusa não altera a escala e não gera penalidade — a pessoa continua na fila.
          O que a escala registra é que o sindicato ofereceu; a convocação registra o que
          a pessoa respondeu. As duas coisas juntas é que formam a prova.
        </p>
      )}
    </div>
  );
}
