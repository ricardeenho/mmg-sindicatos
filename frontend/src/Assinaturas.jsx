import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const dataBR = (d) => {
  if (!d) return "";
  const [a, m, dia] = String(d).slice(0, 10).split("-");
  return a && m && dia ? `${dia}/${m}/${a}` : "";
};
const dataHoraBR = (d) => d ? new Date(d).toLocaleString("pt-BR") : "";

async function jsonAutenticado(caminho, jwt, opcoes = {}) {
  const r = await fetch(API + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
      ...(opcoes.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Falha na operação");
  return d;
}

function Moldura({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-7">
      <div className="max-w-xl mx-auto">
        <img src="/logo-mmg.png" alt="MMG" className="h-11 w-auto mb-4" />
        {children}
      </div>
    </div>
  );
}

function Documento({ d }) {
  if (!d) return null;
  return (
    <div className="bg-slate-50 rounded-xl p-4 text-[13px] text-slate-700 space-y-1.5">
      <p><b>Requisição:</b> {String(d.requisicao_id || "").slice(0, 8).toUpperCase()}</p>
      <p><b>Unidade:</b> {d.unidade_codigo} · {d.unidade_nome}</p>
      <p><b>Período:</b> {dataBR(d.previsao_inicio)} a {dataBR(d.previsao_fim)}</p>
      <p><b>Quantidade:</b> {d.quantidade} {d.quantidade === 1 ? "pessoa" : "pessoas"}</p>
      {d.turno && <p><b>Turno:</b> {d.turno}</p>}
      {(d.funcoes || []).length > 0 && (
        <p><b>Funções:</b> {d.funcoes.map((f) => `${f.quantidade} × ${f.nome || f.funcao}`).join(" · ")}</p>
      )}
      {d.solicitante_nome && <p><b>Solicitante:</b> {d.solicitante_nome}</p>}
    </div>
  );
}

export function AssinarRequisicao({ jwt, assinaturaId, tokenAssinatura, sair }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [assinando, setAssinando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    jsonAutenticado(`/assinaturas/${assinaturaId}`, jwt)
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, [jwt, assinaturaId]);

  async function assinar() {
    setAssinando(true); setErro("");
    try {
      const d = await jsonAutenticado(`/assinaturas/${assinaturaId}/assinar`, jwt, {
        method: "POST",
        body: JSON.stringify({ token: tokenAssinatura }),
      });
      setResultado(d);
      setDados((anterior) => anterior ? { ...anterior, status: "assinada", assinada_em: d.assinada_em } : anterior);
    } catch (e) { setErro(e.message); } finally { setAssinando(false); }
  }

  if (erro && !dados) {
    return <Moldura><div className="bg-white rounded-2xl p-6"><p className="text-rose-700 text-sm">{erro}</p></div></Moldura>;
  }
  if (!dados) return <Moldura><p className="text-sm text-slate-500">Carregando solicitação…</p></Moldura>;

  const pendente = dados.status === "pendente";
  const codigoValidacao = resultado?.validation_code || dados.validation_code;
  return (
    <Moldura>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-teal-700 font-semibold">Assinatura de requisição</p>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">Confirme antes de assinar</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Esta solicitação foi destinada a <b>{dados.assinante_nome}</b>. Confira os dados abaixo.
          </p>
        </div>

        <Documento d={resultado?.documento || dados.documento} />

        <div className="text-[12px] text-slate-500">
          <p>Status: <b className="text-slate-700">{dados.status}</b></p>
          {dados.expira_em && pendente && <p>Token válido até {dataHoraBR(dados.expira_em)}</p>}
          {dados.assinada_em && <p>Assinada em {dataHoraBR(dados.assinada_em)}</p>}
        </div>

        {erro && <p className="text-[13px] text-rose-600">{erro}</p>}

        {pendente && !resultado && (
          <button onClick={assinar} disabled={assinando}
            className="w-full bg-teal-600 text-white rounded-xl py-3.5 text-sm font-semibold disabled:opacity-50">
            {assinando ? "Assinando…" : "Confirmar e assinar esta requisição"}
          </button>
        )}

        {(resultado || dados.status === "assinada") && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <p className="text-emerald-800 font-semibold text-sm">✓ Requisição assinada</p>
            {codigoValidacao && (
              <>
                <p className="text-[12px] text-emerald-800 mt-1 break-all">
                  Código de validação: <b>{codigoValidacao}</b>
                </p>
                <img
                  src={`${API}/assinaturas/validar/${encodeURIComponent(codigoValidacao)}/qr`}
                  alt="QR de validação"
                  className="w-48 h-48 bg-white rounded-lg p-2 mt-3"
                />
                <a href={`/?validar=${encodeURIComponent(codigoValidacao)}`}
                  className="inline-block text-[12px] text-teal-700 underline mt-2">
                  Abrir página de validação
                </a>
              </>
            )}
          </div>
        )}

        <button onClick={sair} className="text-[12px] text-slate-500 underline">Sair deste acesso</button>
      </div>
    </Moldura>
  );
}

export function ValidarAssinatura({ codigo }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch(`${API}/assinaturas/validar/${encodeURIComponent(codigo)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Código de validação não encontrado");
        return d;
      })
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, [codigo]);

  return (
    <Moldura>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Validação pública</p>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">Validação da requisição</h1>
        </div>

        {!dados && !erro && <p className="text-sm text-slate-500">Verificando…</p>}
        {erro && <p className="text-sm text-rose-700">{erro}</p>}

        {dados && (
          <>
            <div className={`rounded-xl border p-4 ${dados.valido ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
              <p className={`font-semibold ${dados.valido ? "text-emerald-800" : "text-rose-800"}`}>
                {dados.valido ? "✓ Documento íntegro e assinatura válida" : "✕ O conteúdo atual não corresponde ao que foi assinado"}
              </p>
              <p className="text-[12px] mt-1 text-slate-600">Status: {dados.status}</p>
            </div>

            <Documento d={dados.documento} />

            <div className="text-[13px] text-slate-700 space-y-1">
              <p><b>Assinado por:</b> {dados.assinante?.nome}</p>
              <p><b>Data da assinatura:</b> {dataHoraBR(dados.assinadaEm)}</p>
              <p className="break-all"><b>Código:</b> {dados.codigo}</p>
            </div>

            <details className="text-[11px] text-slate-500">
              <summary className="cursor-pointer">Dados técnicos de integridade</summary>
              <p className="break-all mt-2">Hash assinado: {dados.integridade?.hashAssinado}</p>
              <p className="break-all mt-1">Hash atual: {dados.integridade?.hashAtual || "indisponível"}</p>
            </details>
          </>
        )}
      </div>
    </Moldura>
  );
}
