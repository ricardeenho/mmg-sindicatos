param(
  [string]$Repo = "."
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path $Repo).Path

$appPath = Join-Path $repoPath "frontend\src\App.jsx"
$mainPath = Join-Path $repoPath "frontend\src\main.jsx"
$validacoesPath = Join-Path $repoPath "frontend\src\Validacoes.jsx"
$themePath = Join-Path $repoPath "frontend\src\theme.css"
$backendPath = Join-Path $repoPath "backend\routes\assinaturas.js"
$sqlPath = Join-Path $repoPath "supabase-validacoes-auditoria.sql"

foreach ($p in @($appPath, $mainPath, $backendPath)) {
  if (-not (Test-Path $p)) { throw "Arquivo não encontrado: $p" }
}

Write-Host "Adicionando tema claro/escuro + central de validações..." -ForegroundColor Cyan

$validacoes = @'
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

'@
Set-Content $validacoesPath -Value $validacoes -Encoding UTF8

$tema = @'
/* Tema escuro do painel principal.
   O projeto usa Tailwind via CDN; estes overrides preservam o layout atual
   sem obrigar a reescrever todas as classes com dark:. */

html.mmg-dark {
  color-scheme: dark;
  background: #020617;
}

html.mmg-dark body {
  background: #020617 !important;
  color: #e2e8f0;
}

html.mmg-dark .bg-white {
  background-color: #0f172a !important;
}

html.mmg-dark .bg-slate-50 {
  background-color: #020617 !important;
}

html.mmg-dark .bg-slate-100 {
  background-color: #1e293b !important;
}

html.mmg-dark .bg-slate-200 {
  background-color: #334155 !important;
}

html.mmg-dark .border-slate-50,
html.mmg-dark .border-slate-100 {
  border-color: #1e293b !important;
}

html.mmg-dark .border-slate-200,
html.mmg-dark .border-slate-300 {
  border-color: #334155 !important;
}

html.mmg-dark .text-slate-900,
html.mmg-dark .text-slate-800,
html.mmg-dark .text-slate-700 {
  color: #f1f5f9 !important;
}

html.mmg-dark .text-slate-600 {
  color: #cbd5e1 !important;
}

html.mmg-dark .text-slate-500 {
  color: #94a3b8 !important;
}

html.mmg-dark .text-slate-400 {
  color: #94a3b8 !important;
}

html.mmg-dark input,
html.mmg-dark select,
html.mmg-dark textarea {
  background-color: #0f172a !important;
  color: #f8fafc !important;
  border-color: #334155 !important;
}

html.mmg-dark input::placeholder,
html.mmg-dark textarea::placeholder {
  color: #64748b !important;
}

html.mmg-dark table thead {
  background-color: #111827 !important;
}

html.mmg-dark table tbody tr {
  border-color: #1e293b !important;
}

html.mmg-dark details,
html.mmg-dark summary {
  color: #cbd5e1;
}

/* caixas de status continuam coloridas, mas com contraste adequado */
html.mmg-dark .bg-emerald-50 { background-color: #052e2b !important; }
html.mmg-dark .bg-teal-50 { background-color: #042f2e !important; }
html.mmg-dark .bg-sky-50 { background-color: #082f49 !important; }
html.mmg-dark .bg-violet-50 { background-color: #2e1065 !important; }
html.mmg-dark .bg-amber-50 { background-color: #451a03 !important; }
html.mmg-dark .bg-rose-50 { background-color: #4c0519 !important; }

html.mmg-dark .hover\:bg-slate-50:hover {
  background-color: #1e293b !important;
}

'@
Set-Content $themePath -Value $tema -Encoding UTF8

$sql = @'
-- MMG Sindicatos — auditoria reforçada de assinaturas
-- Rode no Supabase SQL Editor ANTES de publicar o backend com a tela "Validações".

begin;

alter table requisicao_assinaturas
  add column if not exists ip_assinatura text,
  add column if not exists navegador_assinatura text,
  add column if not exists assinante_nome_snapshot text,
  add column if not exists assinante_usuario_snapshot text,
  add column if not exists aceite_texto text,
  add column if not exists aceite_versao text;

-- Preserva o nome/usuário das assinaturas antigas usando o cadastro atual.
-- Não inventa declaração de aceite retroativa.
update requisicao_assinaturas a
   set assinante_nome_snapshot = coalesce(a.assinante_nome_snapshot, u.nome),
       assinante_usuario_snapshot = coalesce(a.assinante_usuario_snapshot, u.usuario)
  from usuarios u
 where u.id = a.usuario_id
   and a.status = 'assinada'
   and (a.assinante_nome_snapshot is null or a.assinante_usuario_snapshot is null);

create index if not exists idx_requisicao_assinaturas_auditoria
  on requisicao_assinaturas (status, assinada_em desc);

create index if not exists idx_requisicao_assinaturas_usuario
  on requisicao_assinaturas (usuario_id, assinada_em desc);

create unique index if not exists idx_requisicao_assinaturas_validation_code
  on requisicao_assinaturas (validation_code)
  where validation_code is not null;

-- Depois que uma assinatura vira "assinada", ela não pode ser editada/apagada
-- por operações normais. Isso protege o snapshot, hash e dados de auditoria.
create or replace function mmg_bloquear_assinatura_concluida()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'assinada' then
    raise exception 'Assinatura concluida e imutavel: %', old.id
      using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_mmg_assinatura_imutavel on requisicao_assinaturas;

create trigger trg_mmg_assinatura_imutavel
before update or delete on requisicao_assinaturas
for each row
execute function mmg_bloquear_assinatura_concluida();

commit;

'@
Set-Content $sqlPath -Value $sql -Encoding UTF8

# -------------------------------------------------------------------
# 2) Importa theme.css no main.jsx
# -------------------------------------------------------------------
$main = Get-Content $mainPath -Raw -Encoding UTF8
if (-not $main.Contains('import "./theme.css";')) {
  $main = $main.Replace('import App from "./App.jsx";', 'import App from "./App.jsx";' + "`r`n" + 'import "./theme.css";')
  Set-Content $mainPath -Value $main -Encoding UTF8
}

# -------------------------------------------------------------------
# 3) App.jsx: importa Validações, adiciona tema persistente, botão e aba
# -------------------------------------------------------------------
$app = Get-Content $appPath -Raw -Encoding UTF8

if (-not $app.Contains('import Validacoes from "./Validacoes.jsx";')) {
  $alvoImport = 'import { AssinarRequisicao, ValidarAssinatura } from "./Assinaturas.jsx";'
  if (-not $app.Contains($alvoImport)) { throw "Não encontrei o import de Assinaturas.jsx em App.jsx" }
  $app = $app.Replace($alvoImport, $alvoImport + "`r`n" + 'import Validacoes from "./Validacoes.jsx";')
}

if (-not $app.Contains('const [temaEscuro, setTemaEscuro]')) {
  $alvoAba = '  const [aba, setAba] = useState("painel");'
  if (-not $app.Contains($alvoAba)) { throw "Não encontrei o estado 'aba' no Painel" }

  $temaState = @'
  const [aba, setAba] = useState("painel");
  const [temaEscuro, setTemaEscuro] = useState(() => localStorage.getItem("mmg_tema") === "escuro");

  useEffect(() => {
    document.documentElement.classList.toggle("mmg-dark", temaEscuro);
    localStorage.setItem("mmg_tema", temaEscuro ? "escuro" : "claro");
  }, [temaEscuro]);
'@
  $app = $app.Replace($alvoAba, $temaState.TrimEnd())
}

if (-not $app.Contains('title={temaEscuro ? "Usar tema claro"')) {
  $alvoSair = '          <button onClick={sair} className="text-[11px] text-slate-400 hover:text-white">Sair</button>'
  if (-not $app.Contains($alvoSair)) { throw "Não encontrei o botão Sair do cabeçalho" }

  $botaoTema = @'
          <button
            onClick={() => setTemaEscuro((v) => !v)}
            title={temaEscuro ? "Usar tema claro" : "Usar tema escuro"}
            aria-label={temaEscuro ? "Usar tema claro" : "Usar tema escuro"}
            className="w-9 h-9 rounded-lg border border-slate-700 text-[17px] grid place-items-center text-slate-200 hover:bg-slate-800"
          >
            {temaEscuro ? "☀" : "☾"}
          </button>
          <button onClick={sair} className="text-[11px] text-slate-400 hover:text-white">Sair</button>
'@
  $app = $app.Replace($alvoSair, $botaoTema.TrimEnd())
}

if (-not $app.Contains('[["validacoes","Validações"]]')) {
  $alvoNav = '["safristas","Safristas fixos"],["cadastro","Sem cadastro"],'
  if (-not $app.Contains($alvoNav)) { throw "Não encontrei o trecho da navegação para inserir Validações" }
  $app = $app.Replace($alvoNav, '["safristas","Safristas fixos"],["cadastro","Sem cadastro"],...(podeEditar ? [["validacoes","Validações"]] : []),')
}

if (-not $app.Contains('aba === "validacoes" && <Validacoes')) {
  $alvoRender = '        {aba === "requisicoes" && ('
  if (-not $app.Contains($alvoRender)) { throw "Não encontrei o render de requisições para inserir Validações" }
  $novoRender = @'
        {aba === "validacoes" && <Validacoes token={token} pedir={pedir} />}
        {aba === "requisicoes" && (
'@
  $app = $app.Replace($alvoRender, $novoRender.TrimEnd())
}

Set-Content $appPath -Value $app -Encoding UTF8

# -------------------------------------------------------------------
# 4) Backend: central de auditoria
# -------------------------------------------------------------------
$backend = Get-Content $backendPath -Raw -Encoding UTF8

if (-not $backend.Contains("router.get('/auditoria'")) {
  $marcador = "/* Gestor solicita a assinatura do gerente que ja esta vinculado a unidade."
  $idx = $backend.IndexOf($marcador)
  if ($idx -lt 0) { throw "Não encontrei onde inserir as rotas de auditoria no backend" }

  $rotas = @'

/* Central interna de auditoria das assinaturas.
   Somente admin/gestor consegue consultar estes dados. */
router.get('/auditoria', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const statusPedido = String(req.query.status || 'assinada').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtros = [];
    const valores = [];

    if (statusPedido) {
      valores.push(statusPedido);
      filtros.push(`(
        case when a.status = 'pendente' and a.expira_em < now()
             then 'expirada' else a.status end
      ) = $${valores.length}`);
    }

    if (q) {
      valores.push(`%${q}%`);
      const p = `$${valores.length}`;
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

    const where = filtros.length ? `where ${filtros.join(' and ')}` : '';

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
       limit 500
    `, valores);

    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/auditoria/:id', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
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

    const atual = await carregarDocumento(a.requisicao_id);
    const hashAtual = atual ? hashDocumento(atual) : null;
    const confere = !!atual && !!a.document_hash && hashAtual === a.document_hash;

    res.json({
      id: a.id,
      requisicao_id: a.requisicao_id,
      usuario_id: a.usuario_id,
      assinante_nome: a.assinante_nome,
      assinante_usuario: a.assinante_usuario,
      status: a.status,
      criado_em: a.criado_em,
      expira_em: a.expira_em,
      assinada_em: a.assinada_em,
      validation_code: a.validation_code,
      document_hash: a.document_hash,
      documento_assinado: a.document_snapshot,
      criado_por: a.criado_por,
      ip_assinatura: a.ip_assinatura,
      navegador_assinatura: a.navegador_assinatura,
      aceite_texto: a.aceite_texto,
      aceite_versao: a.aceite_versao,
      validacaoUrl: a.validation_code ? urlValidacao(a.validation_code) : null,
      integridade: {
        confere,
        hashAssinado: a.document_hash,
        hashAtual,
      },
    });
  } catch (e) { next(e); }
});

'@

  $backend = $backend.Insert($idx, $rotas)
}

# -------------------------------------------------------------------
# 5) Assinatura: grava identidade + IP + navegador + aceite no MESMO commit
#    antes do trigger de imutabilidade passar a proteger o registro.
# -------------------------------------------------------------------
if (-not $backend.Contains("aceite_versao = '1'")) {
  $inicio = $backend.IndexOf("    const codigo = codigoValidacao();")
  if ($inicio -lt 0) { throw "Não encontrei o início do bloco de conclusão da assinatura" }
  $fim = $backend.IndexOf("    res.json({", $inicio)
  if ($fim -lt 0) { throw "Não encontrei o fim do bloco de conclusão da assinatura" }

  $novoBloco = @'
    const codigo = codigoValidacao();

    const forwarded = req.headers['x-forwarded-for'];
    const forwardedPrimeiro = Array.isArray(forwarded)
      ? String(forwarded[0] || '')
      : String(forwarded || '').split(',')[0];
    const ip = String(forwardedPrimeiro.trim() || req.socket?.remoteAddress || '').slice(0, 100);
    const navegador = String(req.headers['user-agent'] || '').slice(0, 300);
    const nomeAssinante = String(req.usuario.nome || req.usuario.usuario || '').slice(0, 200);
    const usuarioAssinante = String(req.usuario.usuario || '').slice(0, 120);
    const aceiteTexto = 'Confirmo que conferi os dados desta requisição e aprovo o conteúdo exibido para assinatura.';

    const { rows: [gravada] } = await client.query(`
      update requisicao_assinaturas set
        status = 'assinada',
        assinada_em = now(),
        validation_code = $2,
        ip_assinatura = $3,
        navegador_assinatura = $4,
        assinante_nome_snapshot = $5,
        assinante_usuario_snapshot = $6,
        aceite_texto = $7,
        aceite_versao = '1'
       where id = $1
      returning id, requisicao_id, status, assinada_em, validation_code
    `, [a.id, codigo, ip, navegador, nomeAssinante, usuarioAssinante, aceiteTexto]);

    await client.query('commit');

'@

  $backend = $backend.Substring(0, $inicio) + $novoBloco + $backend.Substring($fim)
}

Set-Content $backendPath -Value $backend -Encoding UTF8

# -------------------------------------------------------------------
# 6) Testes
# -------------------------------------------------------------------
Write-Host ""
Write-Host "Checando sintaxe do backend..." -ForegroundColor Cyan
node --check $backendPath
if ($LASTEXITCODE -ne 0) { throw "Backend com erro de sintaxe. Não faça push." }

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
Write-Host "Pronto. Arquivos alterados/criados:" -ForegroundColor Green
Write-Host "  frontend/src/App.jsx"
Write-Host "  frontend/src/main.jsx"
Write-Host "  frontend/src/Validacoes.jsx"
Write-Host "  frontend/src/theme.css"
Write-Host "  backend/routes/assinaturas.js"
Write-Host "  supabase-validacoes-auditoria.sql (fica ignorado pelo Git; rode no Supabase)"
Write-Host ""
Write-Host "IMPORTANTE: rode supabase-validacoes-auditoria.sql no Supabase ANTES do deploy do backend." -ForegroundColor Yellow
Write-Host ""
Push-Location $repoPath
try { git status --short } finally { Pop-Location }
