param(
  [string]$Repo = "."
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path $Repo).Path

$frontApp = Join-Path $repoPath "frontend\src\App.jsx"
$frontTheme = Join-Path $repoPath "frontend\src\theme.css"
$assinaturaApp = Join-Path $repoPath "assinatura-site\src\App.jsx"
$assinaturaCss = Join-Path $repoPath "assinatura-site\src\style.css"

foreach ($p in @($frontApp, $frontTheme, $assinaturaApp, $assinaturaCss)) {
  if (-not (Test-Path $p)) { throw "Arquivo não encontrado: $p" }
}

Write-Host "Ajustando fundo branco do logo MMG no tema escuro e no portal de assinatura..." -ForegroundColor Cyan

# -------------------------------------------------------------------
# 1) frontend/src/App.jsx
# -------------------------------------------------------------------
$app = Get-Content $frontApp -Raw -Encoding UTF8

# Login do principal: coloca o logo sobre cápsula branca
$logoLoginAntigo = @'
          <img src="/logo-mmg.png" alt="MMG · Movimentação de Mercadorias em Geral"
               className="h-12 w-auto mb-3" />
'@

$logoLoginNovo = @'
          <div className="logo-shell inline-flex mb-3">
            <img src="/logo-mmg.png" alt="MMG · Movimentação de Mercadorias em Geral"
                 className="h-12 w-auto block" />
          </div>
'@

if ($app.Contains($logoLoginAntigo) -and -not $app.Contains('className="logo-shell inline-flex mb-3"')) {
  $app = $app.Replace($logoLoginAntigo, $logoLoginNovo)
}

# Cabeçalho do principal: fixa a casca branca mesmo no dark
$app = $app.Replace(
  '<span className="bg-white rounded-lg px-2 py-1.5 shrink-0">',
  '<span className="logo-shell bg-white rounded-lg px-2 py-1.5 shrink-0">'
)

Set-Content $frontApp -Value $app -Encoding UTF8

# -------------------------------------------------------------------
# 2) frontend/src/theme.css
# -------------------------------------------------------------------
$theme = Get-Content $frontTheme -Raw -Encoding UTF8

if (-not $theme.Contains('.logo-shell')) {
  $theme += @'

/* Mantém o logo MMG visível no tema escuro */
.logo-shell {
  background: #ffffff !important;
  border-radius: 0.75rem;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
}

.logo-shell img {
  display: block;
}

html.mmg-dark .logo-shell {
  background: #ffffff !important;
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
}
'@
}

Set-Content $frontTheme -Value $theme -Encoding UTF8

# -------------------------------------------------------------------
# 3) assinatura-site/src/App.jsx
# -------------------------------------------------------------------
$assinatura = Get-Content $assinaturaApp -Raw -Encoding UTF8

$logoAssAntigo = '<img src="/logo-mmg.png" alt="MMG" className="h-11 w-auto mb-4" />'
$logoAssNovo = @'
        <div className="logoWrap">
          <img src="/logo-mmg.png" alt="MMG" className="h-11 w-auto block" />
        </div>
'@

if ($assinatura.Contains($logoAssAntigo) -and -not $assinatura.Contains('className="logoWrap"')) {
  $assinatura = $assinatura.Replace($logoAssAntigo, $logoAssNovo)
}

# compatibilidade com uma possível logo maior
$logoAssAntigo2 = '<img src="/logo-mmg.png" alt="MMG" className="h-12 w-auto mb-4" />'
if ($assinatura.Contains($logoAssAntigo2) -and -not $assinatura.Contains('className="logoWrap"')) {
  $assinatura = $assinatura.Replace($logoAssAntigo2, $logoAssNovo)
}

Set-Content $assinaturaApp -Value $assinatura -Encoding UTF8

# -------------------------------------------------------------------
# 4) assinatura-site/src/style.css
# -------------------------------------------------------------------
$css = Get-Content $assinaturaCss -Raw -Encoding UTF8

if (-not $css.Contains('.logoWrap')) {
  $css += @'

/* Logo MMG sempre visível */
.logoWrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 10px 12px;
  margin-bottom: 16px;
  box-shadow:
    0 10px 15px -3px rgb(15 23 42 / 0.08),
    0 4px 6px -4px rgb(15 23 42 / 0.08);
}

.logoWrap img {
  display: block;
}

@media (max-width: 520px) {
  .logoWrap {
    margin-bottom: 14px;
  }
}
'@
}

Set-Content $assinaturaCss -Value $css -Encoding UTF8

# -------------------------------------------------------------------
# 5) Build de segurança
# -------------------------------------------------------------------
Write-Host ""
Write-Host "Buildando frontend principal..." -ForegroundColor Cyan
Push-Location (Join-Path $repoPath "frontend")
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build do frontend principal falhou." }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Buildando portal de assinatura..." -ForegroundColor Cyan
Push-Location (Join-Path $repoPath "assinatura-site")
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build do portal de assinatura falhou." }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Ajuste concluído. Arquivos alterados:" -ForegroundColor Green
Write-Host "  frontend/src/App.jsx"
Write-Host "  frontend/src/theme.css"
Write-Host "  assinatura-site/src/App.jsx"
Write-Host "  assinatura-site/src/style.css"
Write-Host ""
Push-Location $repoPath
try { git status --short } finally { Pop-Location }
