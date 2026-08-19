import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function pedir(caminho, token) {
  const r = await fetch(API + caminho, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json()).error || "Falha na consulta");
  return r.json();
}
async function enviar(caminho, token, corpo) {
  const r = await fetch(API + caminho, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const dados = await r.json();
  if (!r.ok) throw Object.assign(new Error(dados.error || "Falha ao enviar"), { dados });
  return dados;
}

const Linha = ({ rotulo, valor, cor = "text-slate-900" }) => (
  <div className="flex justify-between py-1.5 border-b border-slate-50 last:border-0">
    <span className="text-[12px] text-slate-600">{rotulo}</span>
    <span className={`text-[12px] font-semibold tabular-nums ${cor}`}>{valor}</span>
  </div>
);

export default function Importar({ token }) {
  const [arquivo, setArquivo] = useState(null);
  const [conteudo, setConteudo] = useState("");
  const [conferencia, setConferencia] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { pedir("/importacao/historico", token).then(setHistorico).catch(() => {}); }, [token, resultado]);

  function escolher(e) {
    const f = e.target.files?.[0];
    setArquivo(null); setConteudo(""); setConferencia(null); setResultado(null); setErro("");
    if (!f) return;
    const leitor = new FileReader();
    leitor.onload = () => { setArquivo(f); setConteudo(leitor.result); };
    leitor.onerror = () => setErro("Não consegui ler o arquivo");
    leitor.readAsText(f, "utf-8");
  }

  async function conferir() {
    setOcupado(true); setErro(""); setConferencia(null);
    try {
      setConferencia(await enviar("/importacao/conferir", token, { conteudo }));
    } catch (e) {
      setErro(e.message);
      if (e.dados?.problemas) setConferencia({ problemas: e.dados.problemas });
    } finally { setOcupado(false); }
  }

  async function gravar() {
    setOcupado(true); setErro("");
    try {
      setResultado(await enviar("/importacao/ponto", token, {
        conteudo, arquivo_nome: arquivo?.name,
      }));
      setConferencia(null);
    } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Apuração mensal do Ponto</p>
        <p className="text-[11px] text-slate-500 mt-1">
          Arquivo CSV com quatro colunas, nesta ordem: data (AAAA-MM-DD), código do trabalhador,
          código da unidade e nome da unidade. Subir o mesmo período duas vezes não duplica nada —
          o sistema reconhece o que já existe.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={escolher}
            className="text-[13px] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0
                       file:text-[13px] file:font-medium file:bg-slate-900 file:text-white" />
          {arquivo && (
            <span className="text-[12px] text-slate-500">
              {arquivo.name} · {(arquivo.size / 1024 / 1024).toFixed(1)} MB
            </span>
          )}
        </div>

        {conteudo && !conferencia && !resultado && (
          <button onClick={conferir} disabled={ocupado}
            className="mt-4 w-full bg-white border border-slate-300 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {ocupado ? "Conferindo…" : "Conferir antes de gravar"}
          </button>
        )}

        {erro && <p className="text-[12px] text-rose-600 mt-3">{erro}</p>}
      </div>

      {conferencia && !resultado && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-medium mb-3">Conferência — nada foi gravado ainda</p>

          {conferencia.validas != null && (
            <>
              <Linha rotulo="Linhas no arquivo" valor={conferencia.total_lidas} />
              <Linha rotulo="Linhas válidas" valor={conferencia.validas} cor="text-emerald-700" />
              <Linha rotulo="Descartadas" valor={conferencia.descartadas}
                     cor={conferencia.descartadas > 0 ? "text-amber-600" : "text-slate-500"} />
              <Linha rotulo="Período" valor={`${conferencia.primeiro_dia} a ${conferencia.ultimo_dia}`} />
              <Linha rotulo="Trabalhadores distintos" valor={conferencia.trabalhadores} />
              <Linha rotulo="Unidades distintas" valor={conferencia.unidades} />
              <Linha rotulo="Trabalhadores que ainda não existem" valor={conferencia.trabalhadores_novos}
                     cor={conferencia.trabalhadores_novos > 0 ? "text-sky-700" : "text-slate-500"} />
              <Linha rotulo="Unidades que ainda não existem" valor={conferencia.unidades_novas}
                     cor={conferencia.unidades_novas > 0 ? "text-sky-700" : "text-slate-500"} />
            </>
          )}

          {conferencia.problemas?.length > 0 && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-[12px] font-medium text-amber-900 mb-1">
                Primeiras linhas com problema
              </p>
              {conferencia.problemas.map((p, i) => (
                <p key={i} className="text-[11px] text-amber-800 font-mono">
                  linha {p.linha} · {p.motivo} · {p.conteudo}
                </p>
              ))}
            </div>
          )}

          {conferencia.validas > 0 && (
            <button onClick={gravar} disabled={ocupado}
              className="mt-4 w-full bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
              {ocupado ? "Gravando e recalculando…" : `Gravar ${conferencia.validas} linhas`}
            </button>
          )}
        </div>
      )}

      {resultado && (
        <div className="bg-white rounded-xl border border-teal-500 p-4">
          <p className="text-sm font-medium text-teal-800 mb-3">Importação concluída</p>
          <Linha rotulo="Linhas válidas" valor={resultado.validas} />
          <Linha rotulo="Gravadas agora" valor={resultado.gravadas} cor="text-emerald-700" />
          <Linha rotulo="Já existiam" valor={resultado.repetidas} cor="text-slate-500" />
          <Linha rotulo="Descartadas" valor={resultado.descartadas}
                 cor={resultado.descartadas > 0 ? "text-amber-600" : "text-slate-500"} />
          <p className="text-[11px] text-slate-500 mt-3">
            O relógio já foi recalculado. Volte ao Painel para ver os números atualizados.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-medium text-slate-600">
          Importações anteriores
        </div>
        {historico.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-slate-400">Nenhuma importação registrada.</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <tbody>
              {historico.map((h) => (
                <tr key={h.id} className="border-t border-slate-50">
                  <td className="px-3 py-2 font-medium">{h.competencia}</td>
                  <td className="px-3 py-2 text-slate-500">{h.arquivo_nome}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {new Date(h.periodo_inicio).toLocaleDateString("pt-BR")} a{" "}
                    {new Date(h.periodo_fim).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.linhas_gravadas} gravadas</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {h.linhas_repetidas} repetidas
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {new Date(h.enviado_em).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        O prazo combinado é o quinto dia útil do mês seguinte. Depois de gravar, o relógio de
        todos os trabalhadores é recalculado automaticamente.
      </p>
    </div>
  );
}
