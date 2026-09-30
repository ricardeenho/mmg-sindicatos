param(
  [string]$Repo = "."
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path $Repo).Path

$validacoesPath = Join-Path $repoPath "frontend\src\Validacoes.jsx"
$backendPath = Join-Path $repoPath "backend\routes\assinaturas.js"
$packagePath = Join-Path $repoPath "backend\package.json"

foreach ($p in @($validacoesPath, $backendPath, $packagePath)) {
  if (-not (Test-Path $p)) { throw "Arquivo não encontrado: $p" }
}

Write-Host "Instalando Central de Validações 2.0..." -ForegroundColor Cyan

$validacoes = @'
import { useEffect, useState } from "react";

const API = String(import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/$/, "");

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

function nomeArquivoResposta(r, fallback) {
  const cd = r.headers.get("content-disposition") || "";
  const m = cd.match(/filename="?([^"]+)"?/i);
  return m?.[1] || fallback;
}

function Documento({ d }) {
  if (!d) return <p className="text-[12px] text-slate-500">Snapshot indisponível.</p>;

  const horario = d.hora_inicio || d.hora_fim
    ? `${String(d.hora_inicio || "—").slice(0, 5)} às ${String(d.hora_fim || "—").slice(0, 5)}`
    : null;

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-[12px] text-slate-700 space-y-1.5">
      <p><b>Requisição:</b> #{String(d.requisicao_id || "").slice(0, 8).toUpperCase()}</p>
      <p><b>Unidade:</b> {d.unidade_codigo || "—"}{d.unidade_nome ? ` · ${d.unidade_nome}` : ""}</p>
      {(d.local_nome || d.local_cidade) && (
        <p><b>Local:</b> {[d.local_nome, d.local_cidade].filter(Boolean).join(" · ")}</p>
      )}
      <p><b>Período:</b> {dataBR(d.previsao_inicio)} a {dataBR(d.previsao_fim)}</p>
      <p><b>Quantidade:</b> {d.quantidade ?? "—"}</p>
      {d.turno && <p><b>Turno:</b> {d.turno}</p>}
      {horario && <p><b>Horário:</b> {horario}</p>}
      {(d.funcoes || []).length > 0 && (
        <p><b>Funções:</b> {d.funcoes.map((f) => `${f.quantidade} × ${f.nome || f.funcao}`).join(" · ")}</p>
      )}
      {(d.atividades || []).length > 0 && <p><b>Atividades:</b> {d.atividades.join(" · ")}</p>}
      {d.solicitante_nome && <p><b>Solicitante:</b> {d.solicitante_nome}</p>}
      {d.solicitante_fone && <p><b>Telefone do solicitante:</b> {d.solicitante_fone}</p>}
      {d.observacoes && <p><b>Observações:</b> {d.observacoes}</p>}
    </div>
  );
}

export default function Validacoes({ token, pedir }) {
  const [linhas, setLinhas] = useState([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("assinada");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);
  const [total, setTotal] = useState(0);

  const [detalhe, setDetalhe] = useState(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [baixandoPdf, setBaixandoPdf] = useState("");

  async function carregar(p = pagina) {
    setCarregando(true);
    setErro("");
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (busca.trim()) qs.set("q", busca.trim());
      if (de) qs.set("de", de);
      if (ate) qs.set("ate", ate);
      qs.set("pagina", String(p));
      qs.set("limite", "50");

      const resposta = await pedir(`/assinaturas/auditoria?${qs}`, token);

      if (Array.isArray(resposta)) {
        setLinhas(resposta);
        setTotal(resposta.length);
        setPaginas(1);
      } else {
        setLinhas(resposta.itens || []);
        setTotal(Number(resposta.total || 0));
        setPaginas(Math.max(1, Number(resposta.paginas || 1)));
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => carregar(pagina), 300);
    return () => clearTimeout(t);
  }, [status, busca, de, ate, pagina, token]);

  function mudarFiltro(setter, valor) {
    setPagina(1);
    setter(valor);
  }

  async function abrir(id) {
    setCarregandoDetalhe(true);
    setErro("");
    setDetalhe(null);
    try {
      setDetalhe(await pedir(`/assinaturas/auditoria/${id}`, token));
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  async function baixarPdfDossie(id) {
    setBaixandoPdf(id);
    setErro("");
    try {
      const r = await fetch(`${API}/assinaturas/auditoria/${encodeURIComponent(id)}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Não foi possível gerar o PDF");
      }

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivoResposta(r, `dossie-assinatura-${String(id).slice(0, 8)}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e.message);
    } finally {
      setBaixandoPdf("");
    }
  }

  const inicio = total === 0 ? 0 : (pagina - 1) * 50 + 1;
  const fim = Math.min(total, pagina * 50);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium">Central de Validações</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Arquivo de evidências das assinaturas eletrônicas das requisições.
              O dossiê PDF é produzido pelo backend a partir do snapshot salvo no momento da assinatura,
              junto com identidade do gerente, aceite, data e hora, IP, navegador, hashes e QR de validação.
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-teal-700 tabular-nums">{total}</p>
            <p className="text-[10.5px] text-slate-500">registros encontrados</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <input
            value={busca}
            onChange={(e) => mudarFiltro(setBusca, e.target.value)}
            placeholder="Gerente, unidade, código ou requisição…"
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] lg:col-span-2"
          />

          <select
            value={status}
            onChange={(e) => mudarFiltro(setStatus, e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
          >
            <option value="assinada">Assinadas</option>
            <option value="pendente">Pendentes</option>
            <option value="expirada">Expiradas</option>
            <option value="cancelada">Canceladas</option>
            <option value="">Todas</option>
          </select>

          <label className="text-[10.5px] text-slate-500">
            De
            <input
              type="date"
              value={de}
              onChange={(e) => mudarFiltro(setDe, e.target.value)}
              className="mt-1 block w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px]"
            />
          </label>

          <label className="text-[10.5px] text-slate-500">
            Até
            <input
              type="date"
              value={ate}
              onChange={(e) => mudarFiltro(setAte, e.target.value)}
              className="mt-1 block w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px]"
            />
          </label>
        </div>

        {(busca || de || ate || status !== "assinada") && (
          <button
            onClick={() => {
              setBusca("");
              setDe("");
              setAte("");
              setStatus("assinada");
              setPagina(1);
            }}
            className="mt-3 text-[11px] text-slate-500 underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {erro && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[12px] text-rose-700">
          {erro}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {carregando && linhas.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">Carregando validações…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Requisição</th>
                  <th className="text-left px-3 py-2">Unidade</th>
                  <th className="text-left px-3 py-2">Gerente</th>
                  <th className="text-left px-3 py-2">Quando</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Validação</th>
                  <th className="text-right px-3 py-2">Ações</th>
                </tr>
              </thead>

              <tbody>
                {linhas.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium">#{String(a.requisicao_id || "").slice(0, 8).toUpperCase()}</p>
                      <p className="text-[9.5px] text-slate-400 break-all">{a.id}</p>
                    </td>

                    <td className="px-3 py-2">
                      <p className="font-medium">{a.unidade_codigo || "—"}</p>
                      <p className="text-[10.5px] text-slate-500">{a.unidade_nome || "—"}</p>
                    </td>

                    <td className="px-3 py-2">
                      <p className="font-medium">{a.assinante_nome || "—"}</p>
                      <p className="text-[10.5px] text-slate-500">
                        {a.assinante_usuario ? `@${a.assinante_usuario}` : ""}
                      </p>
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
                      }`}>
                        {a.status}
                      </span>
                    </td>

                    <td className="px-3 py-2">
                      {a.validation_code
                        ? <code className="text-[9.5px] break-all">{a.validation_code}</code>
                        : <span className="text-slate-400">—</span>}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex gap-1.5 justify-end flex-wrap min-w-[160px]">
                        <button
                          onClick={() => abrir(a.id)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] text-slate-700"
                        >
                          Ver prova
                        </button>

                        {a.status === "assinada" && (
                          <button
                            onClick={() => baixarPdfDossie(a.id)}
                            disabled={baixandoPdf === a.id}
                            className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-[11px] disabled:opacity-50"
                          >
                            {baixandoPdf === a.id ? "Gerando…" : "PDF"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {!carregando && linhas.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-3 py-8 text-center text-slate-400">
                      Nenhum registro encontrado com estes filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-slate-500">
              Mostrando {inicio}–{fim} de {total}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina <= 1}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span className="text-[11px] text-slate-500">
                Página {pagina} de {paginas}
              </span>
              <button
                onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
                disabled={pagina >= paginas}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {(detalhe || carregandoDetalhe) && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 p-4 overflow-y-auto"
          onClick={() => !carregandoDetalhe && setDetalhe(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-3xl mx-auto my-6 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {carregandoDetalhe && !detalhe ? (
              <p className="text-sm text-slate-400">Carregando dossiê…</p>
            ) : detalhe && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-teal-700 font-semibold">
                      Dossiê de assinatura
                    </p>
                    <h2 className="text-lg font-semibold mt-1">Prova técnica da requisição</h2>
                    <p className="text-[10.5px] text-slate-500 mt-1">
                      Protocolo {detalhe.protocolo || "—"}
                    </p>
                  </div>
                  <button onClick={() => setDetalhe(null)} className="text-xl text-slate-400 leading-none">×</button>
                </div>

                <div className={`mt-4 rounded-xl border p-4 ${
                  detalhe.integridade?.confere
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-amber-50 border-amber-200"
                }`}>
                  <p className={`text-sm font-semibold ${
                    detalhe.integridade?.confere ? "text-emerald-800" : "text-amber-800"
                  }`}>
                    {detalhe.integridade?.confere
                      ? "✓ Documento atual confere com o conteúdo assinado"
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
                    <p className="text-[10.5px] uppercase tracking-wide text-slate-500 font-semibold">
                      Declaração aceita pelo gerente
                    </p>
                    <p className="text-[12px] text-slate-700 mt-1 leading-relaxed">
                      {detalhe.aceite_texto}
                    </p>
                  </div>
                )}

                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                    Documento assinado
                  </p>
                  <Documento d={detalhe.documento_assinado} />
                </div>

                <div className="mt-4 bg-slate-950 text-slate-200 rounded-xl p-4 text-[10.5px] space-y-2">
                  <p className="break-all"><b>Hash assinado:</b> {detalhe.document_hash || "—"}</p>
                  <p className="break-all"><b>Hash atual:</b> {detalhe.integridade?.hashAtual || "—"}</p>
                  <p className="break-all"><b>Navegador:</b> {detalhe.navegador_assinatura || "não registrado"}</p>
                </div>

                <div className="mt-4 flex gap-2 flex-wrap">
                  {detalhe.validacaoUrl && (
                    <a
                      href={detalhe.validacaoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-slate-900 text-white rounded-lg px-4 py-2 text-[12px] font-medium"
                    >
                      Abrir validação pública
                    </a>
                  )}

                  {detalhe.status === "assinada" && (
                    <button
                      onClick={() => baixarPdfDossie(detalhe.id)}
                      disabled={baixandoPdf === detalhe.id}
                      className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[12px] font-medium disabled:opacity-50"
                    >
                      {baixandoPdf === detalhe.id ? "Gerando PDF…" : "Baixar dossiê PDF"}
                    </button>
                  )}

                  <button
                    onClick={() => baixarJson(
                      `dossie-assinatura-${String(detalhe.requisicao_id || detalhe.id).slice(0, 8)}.json`,
                      detalhe
                    )}
                    className="border border-slate-200 rounded-lg px-4 py-2 text-[12px] text-slate-700"
                  >
                    Baixar JSON
                  </button>
                </div>

                <p className="mt-4 text-[10px] text-slate-400 leading-relaxed">
                  O dossiê registra evidências técnicas da aceitação eletrônica realizada dentro da aplicação.
                  Ele não representa, por si só, certificado digital ICP-Brasil.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'@
Set-Content $validacoesPath -Value $validacoes -Encoding UTF8

$backend = Get-Content $backendPath -Raw -Encoding UTF8

# PDFKit
if (-not $backend.Contains("const PDFDocument = require('pdfkit');")) {
  $alvo = "const QRCode = require('qrcode');"
  if (-not $backend.Contains($alvo)) { throw "Não encontrei o import do qrcode no backend." }
  $backend = $backend.Replace($alvo, $alvo + "`r`n" + "const PDFDocument = require('pdfkit');")
}

# Helpers do PDF
if (-not $backend.Contains("function protocoloDossie(")) {
  $marcador = "async function carregarDocumento("
  $idx = $backend.IndexOf($marcador)
  if ($idx -lt 0) { throw "Não encontrei carregarDocumento para inserir helpers." }

  $helpers = @'

function fmtDataHoraDossie(valor) {
  if (!valor) return 'Nao registrado';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch (_e) {
    return String(valor);
  }
}

function fmtDataDossie(valor) {
  if (!valor) return 'Nao informado';
  const p = String(valor).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(valor);
}

function textoDossie(valor, vazio = 'Nao registrado') {
  if (valor == null || valor === '') return vazio;
  return String(valor);
}

function protocoloDossie(a) {
  const id = String(a?.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase() || 'SEMID';
  const data = a?.assinada_em
    ? new Date(a.assinada_em).toISOString().slice(0, 10).replace(/-/g, '')
    : 'SEMDATA';
  return `MMG-ASS-${data}-${id}`;
}

function garantirEspacoPdf(doc, altura = 40) {
  if (doc.y + altura > doc.page.height - 55) doc.addPage();
}

function tituloSecaoPdf(doc, titulo) {
  garantirEspacoPdf(doc, 34);
  doc.moveDown(0.55);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text(String(titulo).toUpperCase());
  doc.moveDown(0.25);
  doc.strokeColor('#cbd5e1').lineWidth(0.6).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
}

function campoPdf(doc, rotulo, valor) {
  garantirEspacoPdf(doc, 32);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#475569')
    .text(String(rotulo), 50, y, { width: 125 });
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a')
    .text(textoDossie(valor), 178, y, { width: 367 });
  doc.y = Math.max(doc.y, y + 15);
  doc.moveDown(0.15);
}

function paragrafoPdf(doc, texto) {
  garantirEspacoPdf(doc, 45);
  doc.font('Helvetica').fontSize(9).fillColor('#334155')
    .text(textoDossie(texto), 50, doc.y, { width: 495, lineGap: 2 });
  doc.moveDown(0.45);
}


'@
  $backend = $backend.Insert($idx, $helpers)
}

# Atualiza lista de auditoria para filtros + paginação
$inicioLista = $backend.IndexOf("router.get('/auditoria',")
$inicioDetalhe = $backend.IndexOf("router.get('/auditoria/:id'", $inicioLista)

if ($inicioLista -lt 0 -or $inicioDetalhe -lt 0) {
  throw "Não encontrei as rotas atuais da Central de Validações."
}

$rotaLista = @'
router.get('/auditoria', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const statusPedido = String(req.query.status || 'assinada').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const de = String(req.query.de || '').trim();
    const ate = String(req.query.ate || '').trim();
    const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
    const limite = Math.max(10, Math.min(200, Number.parseInt(req.query.limite, 10) || 50));

    const filtros = [];
    const valores = [];

    const adicionar = (valor) => {
      valores.push(valor);
      return `$${valores.length}`;
    };

    if (statusPedido) {
      const p = adicionar(statusPedido);
      filtros.push(`(
        case when a.status = 'pendente' and a.expira_em < now()
             then 'expirada' else a.status end
      ) = ${p}`);
    }

    if (q) {
      const p = adicionar(`%${q}%`);
      filtros.push(`(
        lower(coalesce(a.assinante_nome_snapshot, u.nome, '')) like ${p}
        or lower(coalesce(a.assinante_usuario_snapshot, u.usuario, '')) like ${p}
        or lower(coalesce(a.validation_code, '')) like ${p}
        or lower(a.requisicao_id::text) like ${p}
        or lower(a.id::text) like ${p}
        or lower(coalesce(a.document_snapshot->>'unidade_codigo', '')) like ${p}
        or lower(coalesce(a.document_snapshot->>'unidade_nome', '')) like ${p}
      )`);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(de)) {
      const p = adicionar(de);
      filtros.push(`coalesce(a.assinada_em, a.criado_em)::date >= ${p}::date`);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
      const p = adicionar(ate);
      filtros.push(`coalesce(a.assinada_em, a.criado_em)::date <= ${p}::date`);
    }

    const where = filtros.length ? `where ${filtros.join(' and ')}` : '';

    const { rows: [contagem] } = await consulta(`
      select count(*)::int as total
        from requisicao_assinaturas a
        left join usuarios u on u.id = a.usuario_id
        ${where}
    `, valores);

    const total = Number(contagem?.total || 0);
    const paginas = Math.max(1, Math.ceil(total / limite));
    const paginaReal = Math.min(pagina, paginas);
    const offset = (paginaReal - 1) * limite;

    const valoresLista = [...valores, limite, offset];
    const pLimite = `$${valoresLista.length - 1}`;
    const pOffset = `$${valoresLista.length}`;

    const { rows } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id,
             coalesce(a.assinante_nome_snapshot, u.nome) as assinante_nome,
             coalesce(a.assinante_usuario_snapshot, u.usuario) as assinante_usuario,
             case when a.status = 'pendente' and a.expira_em < now()
                  then 'expirada' else a.status end as status,
             a.criado_em, a.expira_em, a.assinada_em, a.validation_code,
             a.criado_por, a.ip_assinatura,
             a.document_snapshot->>'unidade_codigo' as unidade_codigo,
             a.document_snapshot->>'unidade_nome' as unidade_nome
        from requisicao_assinaturas a
        left join usuarios u on u.id = a.usuario_id
        ${where}
       order by coalesce(a.assinada_em, a.criado_em) desc
       limit ${pLimite} offset ${pOffset}
    `, valoresLista);

    res.json({
      itens: rows,
      total,
      pagina: paginaReal,
      limite,
      paginas,
    });
  } catch (e) { next(e); }
});


'@
$backend = $backend.Substring(0, $inicioLista) + $rotaLista + $backend.Substring($inicioDetalhe)

# Endpoint PDF antes do endpoint de detalhe
if (-not $backend.Contains("router.get('/auditoria/:id/pdf'")) {
  $inicioDetalhe = $backend.IndexOf("router.get('/auditoria/:id'")
  if ($inicioDetalhe -lt 0) { throw "Não encontrei a rota de detalhe da auditoria." }

  $rotaPdf = @'
router.get('/auditoria/:id/pdf', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(`
      select a.*,
             coalesce(a.assinante_nome_snapshot, u.nome) as assinante_nome,
             coalesce(a.assinante_usuario_snapshot, u.usuario) as assinante_usuario
        from requisicao_assinaturas a
        left join usuarios u on u.id = a.usuario_id
       where a.id = $1
    `, [req.params.id]);

    if (!a) return res.status(404).json({ error: 'Registro de assinatura nao encontrado' });
    if (a.status !== 'assinada') {
      return res.status(409).json({ error: 'O dossie PDF so pode ser emitido para uma assinatura concluida.' });
    }

    const atual = await carregarDocumento(a.requisicao_id);
    const hashAtual = atual ? hashDocumento(atual) : null;
    const integridade = !!atual && !!a.document_hash && hashAtual === a.document_hash;
    const snapshot = a.document_snapshot || {};
    const protocolo = protocoloDossie(a);
    const validacao = a.validation_code ? urlValidacao(a.validation_code) : null;
    const qr = validacao
      ? await QRCode.toBuffer(validacao, { type: 'png', width: 260, margin: 1, errorCorrectionLevel: 'M' })
      : null;

    const nomeArquivo = `dossie-mmg-${String(a.requisicao_id || a.id).slice(0, 8)}-${String(a.id).slice(0, 8)}.pdf`;

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.set('Cache-Control', 'no-store');

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, right: 50, bottom: 55, left: 50 },
      info: {
        Title: `Dossie de assinatura ${protocolo}`,
        Author: 'MMG Sindicatos',
        Subject: 'Evidencias tecnicas de assinatura eletronica de requisicao',
      },
    });

    doc.pipe(res);

    doc.on('pageAdded', () => {
      doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
        .text(`MMG Sindicatos - ${protocolo}`, 50, 28, { width: 495, align: 'right' });
      doc.y = 48;
    });

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('MMG SINDICATOS');
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f766e').text('DOSSIÊ DE ASSINATURA ELETRÔNICA');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(`Protocolo: ${protocolo}`);
    doc.text(`Dossiê emitido em: ${fmtDataHoraDossie(new Date())}`);

    if (qr) {
      doc.image(qr, 437, 47, { width: 108, height: 108 });
      doc.font('Helvetica').fontSize(7).fillColor('#64748b')
        .text('QR de validação pública', 425, 158, { width: 120, align: 'center' });
    }

    doc.moveDown(1.1);
    doc.roundedRect(50, doc.y, 350, 42, 6)
      .fillAndStroke(integridade ? '#ecfdf5' : '#fff7ed', integridade ? '#a7f3d0' : '#fed7aa');
    const boxY = doc.y + 12;
    doc.font('Helvetica-Bold').fontSize(10)
      .fillColor(integridade ? '#047857' : '#c2410c')
      .text(
        integridade
          ? 'INTEGRIDADE CONFIRMADA - o documento atual confere com o conteúdo assinado.'
          : 'ATENÇÃO - o documento atual não confere com o snapshot assinado.',
        64, boxY, { width: 322 }
      );
    doc.y += 50;

    tituloSecaoPdf(doc, 'Identificação da assinatura');
    campoPdf(doc, 'Assinatura ID', a.id);
    campoPdf(doc, 'Requisição ID', a.requisicao_id);
    campoPdf(doc, 'Gerente / assinante', a.assinante_nome);
    campoPdf(doc, 'Usuário do gerente', a.assinante_usuario ? `@${a.assinante_usuario}` : null);
    campoPdf(doc, 'ID do usuário', a.usuario_id);
    campoPdf(doc, 'Assinada em', fmtDataHoraDossie(a.assinada_em));
    campoPdf(doc, 'Solicitada por', a.criado_por);
    campoPdf(doc, 'IP registrado', a.ip_assinatura);
    campoPdf(doc, 'Versão do aceite', a.aceite_versao || 'Registro anterior a auditoria v1');

    tituloSecaoPdf(doc, 'Declaração de aceite');
    paragrafoPdf(
      doc,
      a.aceite_texto ||
      'Não há texto de aceite individual armazenado neste registro (assinatura anterior à auditoria v1).'
    );

    tituloSecaoPdf(doc, 'Conteúdo da requisição no momento da assinatura');
    campoPdf(doc, 'Unidade', [snapshot.unidade_codigo, snapshot.unidade_nome].filter(Boolean).join(' - '));
    campoPdf(doc, 'Local', [snapshot.local_nome, snapshot.local_cidade].filter(Boolean).join(' - '));
    campoPdf(doc, 'Período', `${fmtDataDossie(snapshot.previsao_inicio)} a ${fmtDataDossie(snapshot.previsao_fim)}`);
    campoPdf(doc, 'Quantidade', snapshot.quantidade);
    campoPdf(doc, 'Turno', snapshot.turno);
    campoPdf(
      doc,
      'Horário',
      snapshot.hora_inicio || snapshot.hora_fim
        ? `${textoDossie(snapshot.hora_inicio, '-').slice(0, 5)} às ${textoDossie(snapshot.hora_fim, '-').slice(0, 5)}`
        : 'Nao informado'
    );
    campoPdf(doc, 'Tipo', snapshot.tipo);
    campoPdf(doc, 'Solicitante', snapshot.solicitante_nome);
    campoPdf(doc, 'Telefone', snapshot.solicitante_fone);
    campoPdf(doc, 'Tipo solicitante', snapshot.solicitante_tipo);

    const funcoes = (snapshot.funcoes || [])
      .map((f) => `${f.quantidade} x ${f.nome || f.funcao}`)
      .join(' | ');
    campoPdf(doc, 'Funções', funcoes || 'Nao informado');

    const atividades = (snapshot.atividades || []).join(' | ');
    campoPdf(doc, 'Atividades', atividades || 'Nao informado');

    if (snapshot.observacoes) {
      campoPdf(doc, 'Observações', snapshot.observacoes);
    }

    tituloSecaoPdf(doc, 'Integridade criptográfica');
    campoPdf(doc, 'Algoritmo', 'SHA-256');
    campoPdf(doc, 'Hash assinado', a.document_hash);
    campoPdf(doc, 'Hash atual', hashAtual);
    campoPdf(doc, 'Resultado', integridade ? 'CONFERE' : 'NAO CONFERE');

    tituloSecaoPdf(doc, 'Validação pública');
    campoPdf(doc, 'Código', a.validation_code);
    campoPdf(doc, 'Endereço', validacao);

    tituloSecaoPdf(doc, 'Informações técnicas');
    campoPdf(doc, 'Navegador / agente', a.navegador_assinatura);
    paragrafoPdf(
      doc,
      'Este dossiê reúne evidências técnicas mantidas pela aplicação MMG Sindicatos: identidade da conta autenticada, data e hora, IP registrado pela aplicação, agente do navegador, declaração de aceite, snapshot da requisição e hash de integridade. O documento não equivale, por si só, a certificado digital ICP-Brasil.'
    );

    garantirEspacoPdf(doc, 35);
    doc.moveDown(0.8);
    doc.strokeColor('#cbd5e1').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
      .text(`Gerado automaticamente pelo MMG Sindicatos. Protocolo ${protocolo}.`, {
        width: 495,
        align: 'center',
      });

    doc.end();
  } catch (e) {
    if (!res.headersSent) return next(e);
    try { res.end(); } catch (_e) {}
  }
});


'@
  $backend = $backend.Insert($inicioDetalhe, $rotaPdf)
}

# Protocolo também no JSON do dossiê
if (-not $backend.Contains("protocolo: protocoloDossie(a),")) {
  $alvo = @'
    res.json({
      id: a.id,
'@
  $novo = @'
    res.json({
      protocolo: protocoloDossie(a),
      id: a.id,
'@
  if (-not $backend.Contains($alvo)) { throw "Não encontrei o retorno JSON do dossiê." }
  $backend = $backend.Replace($alvo, $novo)
}

Set-Content $backendPath -Value $backend -Encoding UTF8

Write-Host ""
Write-Host "Instalando pdfkit no backend..." -ForegroundColor Cyan
Push-Location (Join-Path $repoPath "backend")
try {
  npm install pdfkit --save
  if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar pdfkit." }

  node --check .\routes\assinaturas.js
  if ($LASTEXITCODE -ne 0) { throw "Backend com erro de sintaxe. Não faça push." }

  node -e "require('pdfkit'); console.log('pdfkit OK')"
  if ($LASTEXITCODE -ne 0) { throw "pdfkit não foi carregado corretamente." }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Buildando frontend principal..." -ForegroundColor Cyan
Push-Location (Join-Path $repoPath "frontend")
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build do frontend falhou. Não faça push." }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Central de Validações 2.0 pronta." -ForegroundColor Green
Write-Host "Agora existem filtros por data, paginação e PDF oficial gerado pelo backend."
Write-Host ""
Push-Location $repoPath
try { git status --short } finally { Pop-Location }
