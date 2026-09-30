param(
  [string]$Repo = "."
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path $Repo).Path
$appPath = Join-Path $repoPath "frontend\src\App.jsx"
$themePath = Join-Path $repoPath "frontend\src\theme.css"

foreach ($p in @($appPath, $themePath)) {
  if (-not (Test-Path $p)) { throw "Arquivo não encontrado: $p" }
}

Write-Host "Deixando o botão de tema mais bonito..." -ForegroundColor Cyan

$app = Get-Content $appPath -Raw -Encoding UTF8

$antigo = @'
          <button
            onClick={() => setTemaEscuro((v) => !v)}
            title={temaEscuro ? "Usar tema claro" : "Usar tema escuro"}
            aria-label={temaEscuro ? "Usar tema claro" : "Usar tema escuro"}
            className="w-9 h-9 rounded-lg border border-slate-700 text-[17px] grid place-items-center text-slate-200 hover:bg-slate-800"
          >
            {temaEscuro ? "☀" : "☾"}
          </button>
'@

$novo = @'
          <button
            onClick={() => setTemaEscuro((v) => !v)}
            title={temaEscuro ? "Usar tema claro" : "Usar tema escuro"}
            aria-label={temaEscuro ? "Usar tema claro" : "Usar tema escuro"}
            className={`theme-toggle ${temaEscuro ? "is-dark" : ""}`}
          >
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb">
                {temaEscuro ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
                  </svg>
                )}
              </span>
            </span>
          </button>
'@

if ($app.Contains($antigo)) {
  $app = $app.Replace($antigo, $novo)
} elseif (-not $app.Contains('className={`theme-toggle')) {
  throw "Não encontrei o botão de tema esperado. Parei para não alterar o lugar errado."
}

Set-Content $appPath -Value $app -Encoding UTF8

$css = Get-Content $themePath -Raw -Encoding UTF8

if (-not $css.Contains('.theme-toggle {')) {
  $css += @'

/* Botão claro/escuro */
.theme-toggle {
  width: 52px;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 999px;
  cursor: pointer;
  flex: 0 0 auto;
  outline: none;
}

.theme-toggle-track {
  position: relative;
  display: block;
  width: 52px;
  height: 30px;
  border-radius: 999px;
  background: #334155;
  border: 1px solid #475569;
  box-shadow:
    inset 0 1px 2px rgb(0 0 0 / 0.18),
    0 1px 2px rgb(0 0 0 / 0.12);
  transition:
    background .22s ease,
    border-color .22s ease,
    box-shadow .22s ease;
}

.theme-toggle:hover .theme-toggle-track {
  border-color: #64748b;
  box-shadow:
    inset 0 1px 2px rgb(0 0 0 / 0.15),
    0 0 0 3px rgb(148 163 184 / 0.10);
}

.theme-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #ffffff;
  color: #334155;
  box-shadow:
    0 2px 5px rgb(0 0 0 / 0.22),
    0 1px 2px rgb(0 0 0 / 0.12);
  transition:
    transform .22s cubic-bezier(.2,.8,.2,1),
    background .22s ease,
    color .22s ease;
}

.theme-toggle-thumb svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.theme-toggle.is-dark .theme-toggle-track {
  background: #0f766e;
  border-color: #14b8a6;
}

.theme-toggle.is-dark .theme-toggle-thumb {
  transform: translateX(22px);
  background: #fef3c7;
  color: #ca8a04;
}

.theme-toggle:focus-visible .theme-toggle-track {
  box-shadow:
    0 0 0 3px rgb(20 184 166 / 0.28);
}

@media (prefers-reduced-motion: reduce) {
  .theme-toggle-track,
  .theme-toggle-thumb {
    transition: none;
  }
}
'@
}

Set-Content $themePath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Buildando frontend..." -ForegroundColor Cyan
Push-Location (Join-Path $repoPath "frontend")
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build falhou. Não faça push." }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Pronto." -ForegroundColor Green
Write-Host "O seletor agora é um switch animado com lua/sol em SVG."
Write-Host ""
Push-Location $repoPath
try { git status --short } finally { Pop-Location }
