import { useEffect, useMemo, useState } from "react";

const dataHoraBR = (d) =>
  d ? new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }) : "—";

const dataBR = (d) => {
  if (!d) return "—";
  const [a, m, dia] = String(d).slice(0, 10).split("-");
  return a && m && dia ? `${dia}/${m}/${a}` : String(d);
};

function baixarJson(nome, conteudo) {
  const blob = new Blob([JSON.stringify(conteudo, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Documento({ d }) {
  if (!d) return <p className="text-[12px] text-slate-500">Snapshot indisponível.</p>;
  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-[12px] text-slate-700 space-y-1.5">
      <p><b>Requisição:</b> #{String(d.requisicao_id || "").slice(0, 8).toUpperCase()}</p>
      <p><b>Unidade:</b> {d.unidade_codigo || "—"}{d.unidade_nome ? ` · ${d.unidade_nome}` : ""}</p>
      <p><b>Período:</b> {dataBR(d.previsao_inicio)} a {dataBR(d.previsao_fim)}</p>
      <p><b>Quantidade:</b> {d.quantidade ?? "—"}</p>
      {d.turno && <p><b>Turno:</b> {d.turno}</p>}
      {(d.funcoes || []).length > 0 && (
        <p><b>Funções:</b> {d.funcoes.map((f) => `${f.quantidade} × ${f.nome || f.funcao}`).join(" · ")}</p>
      )}
      {d.solicitante_nome && <p><b>Solicitante:</b> {d.solicitante_nome}</p>}
      {d.observacoes && <p><b>Observações:</b> {d.observacoes}</p>}
    </div>
  );
}

export default function Validacoes({ token, pedir }) {
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("assinada");
  const [detalhe, setDetalhe] = useState(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

  async function carregar() {
    setErro("");
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (busca.trim()) qs.set("q", busca.trim());
      setLinhas(await pedir(`/assinaturas/auditoria?${qs}`, token));
    } catch (e) {
      setErro(e.message);
    }
  }

  useEffect(() => {
    const t = setTimeout(carregar, 250);
    return () => clearTimeout(t);
  }, [status, busca, token]);

  async function abrir(id) {
    setCarregandoDetalhe(true);
    setErro("");
    try {
      setDetalhe(await pedir(`/assinaturas/auditoria/${id}`, token));
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  const totalAssinadas = useMemo(
    () => (linhas || []).filter((x) => x.status === "assinada").length,
    [linhas]
  );

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #dossie-assinatura, #dossie-assinatura * { visibility: visible !important; }
          #dossie-assinatura {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            background: white !important;
            color: black !important;
          }
          #dossie-assinatura .nao-imprimir { display: none !important; }
        }
      `}</style>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium">Validações e provas de assinatura</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Histórico central das assinaturas. O registro guarda o gerente, data e hora,
              IP, navegador, código de validação, hash e uma cópia dos dados exatamente como
              estavam quando a assinatura foi solicitada.
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-teal-700 tabular-nums">{totalAssinadas}</p>
            <p className="text-[10.5px] text-slate-500">assinadas no filtro atual</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex gap-2 flex-wrap">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar gerente, unidade, código ou requisição…"
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] flex-1 min-w-[240px]"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
          >
            <option value="assinada">Assinadas</option>
            <option value="pendente">Pendentes</option>
            <option value="expirada">Expiradas</option>
            <option value="cancelada">Canceladas</option>
            <option value="">Todas</option>
          </select>
          <button onClick={carregar}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[12px]">
            Atualizar
          </button>
        </div>
      </div>

      {erro && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[12px] text-rose-700">{erro}</div>}

      {!linhas && !erro && <p className="text-sm text-slate-400">Carregando validações…</p>}

      {linhas && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Assinatura</th>
                  <th className="text-left px-3 py-2">Unidade</th>
                  <th className="text-left px-3 py-2">Gerente</th>
                  <th className="text-left px-3 py-2">Quando</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Validação</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium">#{String(a.requisicao_id || "").slice(0, 8).toUpperCase()}</p>
                      <p className="text-[10px] text-slate-400 break-all">{a.id}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{a.unidade_codigo || "—"}</p>
                      <p className="text-[10.5px] text-slate-500">{a.unidade_nome || "—"}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{a.assinante_nome || "—"}</p>
                      <p className="text-[10.5px] text-slate-500">{a.assinante_usuario ? `@${a.assinante_usuario}` : ""}</p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {a.assinada_em ? dataHoraBR(a.assinada_em) : dataHoraBR(a.criado_em)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded px-2 py-1 text-[10.5px] font-medium ${
                        a.status === "assinada" ? "bg-emerald-50 text-emerald-700"
                        : a.status === "pendente" ? "bg-violet-50 text-violet-700"
                        : a.status === "expirada" ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                      }`}>{a.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {a.validation_code
                        ? <code className="text-[10px] break-all">{a.validation_code}</code>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => abrir(a.id)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] text-slate-700">
                        Ver prova
                      </button>
                    </td>
                  </tr>
                ))}
                {linhas.length === 0 && (
                  <tr><td colSpan="7" className="px-3 py-6 text-center text-slate-400">
                    Nenhum registro encontrado.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(detalhe || carregandoDetalhe) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 p-4 overflow-y-auto"
             onClick={() => !carregandoDetalhe && setDetalhe(null)}>
          <div id="dossie-assinatura"
               className="bg-white rounded-2xl max-w-3xl mx-auto my-6 p-5"
               onClick={(e) => e.stopPropagation()}>
            {carregandoDetalhe && !detalhe ? (
              <p className="text-sm text-slate-400">Carregando dossiê…</p>
            ) : detalhe && (
              <>
                <div className="flex items-start justify-between gap-4 nao-imprimir">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-teal-700 font-semibold">Dossiê de assinatura</p>
                    <h2 className="text-lg font-semibold mt-1">Prova técnica da requisição</h2>
                  </div>
                  <button onClick={() => setDetalhe(null)}
                    className="text-xl text-slate-400 leading-none">×</button>
                </div>

                <div className={`mt-4 rounded-xl border p-4 ${
                  detalhe.integridade?.confere ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
                }`}>
                  <p className={`text-sm font-semibold ${detalhe.integridade?.confere ? "text-emerald-800" : "text-amber-800"}`}>
                    {detalhe.integridade?.confere
                      ? "✓ Documento atual confere com o que foi assinado"
                      : "⚠ O documento atual não confere com o snapshot assinado"}
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  {[
                    ["Assinado por", detalhe.assinante_nome],
                    ["Usuário", detalhe.assinante_usuario ? `@${detalhe.assinante_usuario}` : "—"],
                    ["ID do usuário", detalhe.usuario_id || "—"],
                    ["Data e hora", dataHoraBR(detalhe.assinada_em)],
                    ["IP registrado", detalhe.ip_assinatura || "não registrado"],
                    ["Solicitado por", detalhe.criado_por || "—"],
                    ["Código de validação", detalhe.validation_code || "—"],
                    ["Versão do aceite", detalhe.aceite_versao || "anterior à auditoria v1"],
                  ].map(([r, v]) => (
                    <div key={r} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <p className="text-[10.5px] text-slate-500">{r}</p>
                      <p className="text-[12px] font-medium break-all mt-0.5">{v}</p>
                    </div>
                  ))}
                </div>

                {detalhe.aceite_texto && (
                  <div className="mt-4 bg-slate-50 rounded-xl border border-slate-200 p-4">
                    <p className="text-[10.5px] uppercase tracking-wide text-slate-500 font-semibold">Declaração aceita</p>
                    <p className="text-[12px] text-slate-700 mt-1 leading-relaxed">{detalhe.aceite_texto}</p>
                  </div>
                )}

                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Documento assinado</p>
                  <Documento d={detalhe.documento_assinado} />
                </div>

                <div className="mt-4 bg-slate-950 text-slate-200 rounded-xl p-4 text-[10.5px] space-y-2">
                  <p className="break-all"><b>Hash assinado:</b> {detalhe.document_hash || "—"}</p>
                  <p className="break-all"><b>Hash atual:</b> {detalhe.integridade?.hashAtual || "—"}</p>
                  <p className="break-all"><b>Navegador:</b> {detalhe.navegador_assinatura || "não registrado"}</p>
                </div>

                <div className="mt-4 flex gap-2 flex-wrap nao-imprimir">
                  {detalhe.validacaoUrl && (
                    <a href={detalhe.validacaoUrl} target="_blank" rel="noreferrer"
                       className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[12px] font-medium">
                      Abrir validação pública
                    </a>
                  )}
                  <button onClick={() => baixarJson(
                    `dossie-assinatura-${String(detalhe.requisicao_id || detalhe.id).slice(0, 8)}.json`,
                    detalhe
                  )} className="border border-slate-200 rounded-lg px-4 py-2 text-[12px] text-slate-700">
                    Baixar dossiê JSON
                  </button>
                  <button onClick={() => window.print()}
                    className="border border-slate-200 rounded-lg px-4 py-2 text-[12px] text-slate-700">
                    Imprimir / salvar PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

