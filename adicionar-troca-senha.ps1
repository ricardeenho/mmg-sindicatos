param(
  [string]$Repo = "."
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path $Repo).Path
$frontApp = Join-Path $repoPath "frontend\src\App.jsx"
$portalApp = Join-Path $repoPath "assinatura-site\src\App.jsx"
$portalCss = Join-Path $repoPath "assinatura-site\src\style.css"

foreach ($p in @($frontApp, $portalApp, $portalCss)) {
  if (-not (Test-Path $p)) { throw "Arquivo não encontrado: $p" }
}

Write-Host "Adicionando troca de senha nos dois sistemas..." -ForegroundColor Cyan

$app = Get-Content $frontApp -Raw -Encoding UTF8

if (-not $app.Contains("function TrocarSenhaModal(")) {
  $marcador = "function Painel({ token, sair })"
  $idx = $app.IndexOf($marcador)
  if ($idx -lt 0) { throw "Não encontrei Painel no frontend/src/App.jsx" }
  $componente = @'

function TrocarSenhaModal({ token, aoFechar, aoConcluir }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  async function salvar(e) {
    e?.preventDefault();
    setErro("");

    if (!atual || !nova || !confirmacao) {
      setErro("Preencha os três campos.");
      return;
    }
    if (nova.length < 8) {
      setErro("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (nova !== confirmacao) {
      setErro("A confirmação não é igual à nova senha.");
      return;
    }
    if (nova === atual) {
      setErro("Escolha uma senha diferente da atual.");
      return;
    }

    setSalvando(true);
    try {
      await gravar("/auth/senha", token, { atual, nova }, "POST");
      setSucesso(true);
      setTimeout(() => aoConcluir(), 1100);
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-sm p-4 grid place-items-center"
      onClick={() => !salvando && !sucesso && aoFechar()}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 grid place-items-center shrink-0">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth="1.8">
              <circle cx="8" cy="15" r="4" />
              <path d="M11 12l8-8M16 4l4 4M14 6l2 2" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-wide text-teal-700 font-semibold">Segurança da conta</p>
            <h2 className="text-lg font-semibold text-slate-900 mt-0.5">Trocar minha senha</h2>
            <p className="text-[11.5px] text-slate-500 mt-1">
              Informe sua senha atual e escolha uma nova. Depois da troca você entrará novamente.
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={salvando || sucesso}
            className="text-xl text-slate-400 hover:text-slate-700 leading-none px-1 disabled:opacity-40"
          >
            ×
          </button>
        </div>

        {sucesso ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-800">✓ Senha alterada com sucesso</p>
            <p className="text-[11.5px] text-emerald-700 mt-1">Saindo da conta para você entrar com a nova senha…</p>
          </div>
        ) : (
          <form onSubmit={salvar} className="mt-5 space-y-3">
            <label className="block">
              <span className="text-[11.5px] text-slate-600">Senha atual</span>
              <input
                type="password"
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                autoComplete="current-password"
                autoFocus
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px]"
              />
            </label>

            <label className="block">
              <span className="text-[11.5px] text-slate-600">Nova senha</span>
              <input
                type="password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px]"
              />
            </label>

            <label className="block">
              <span className="text-[11.5px] text-slate-600">Confirmar nova senha</span>
              <input
                type="password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px]"
              />
            </label>

            <p className="text-[10.5px] text-slate-400">Mínimo de 8 caracteres.</p>

            {erro && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11.5px] text-rose-700">
                {erro}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={aoFechar}
                disabled={salvando}
                className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] text-slate-600 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="flex-1 bg-teal-600 text-white rounded-xl px-4 py-2.5 text-[12px] font-semibold disabled:opacity-50"
              >
                {salvando ? "Alterando…" : "Trocar senha"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}


'@
  $app = $app.Insert($idx, $componente)
}

if (-not $app.Contains('const [senhaAberta, setSenhaAberta]')) {
  $alvo = '  const [aba, setAba] = useState("painel");'
  if (-not $app.Contains($alvo)) { throw "Não encontrei o estado aba no Painel." }
  $app = $app.Replace($alvo, $alvo + "`r`n" + '  const [senhaAberta, setSenhaAberta] = useState(false);')
}

if (-not $app.Contains('title="Trocar minha senha"')) {
  $alvoSair = '          <button onClick={sair} className="text-[11px] text-slate-400 hover:text-white">Sair</button>'
  if (-not $app.Contains($alvoSair)) { throw "Não encontrei o botão Sair no cabeçalho principal." }

  $botao = @'
          <button
            type="button"
            onClick={() => setSenhaAberta(true)}
            title="Trocar minha senha"
            aria-label="Trocar minha senha"
            className="w-9 h-9 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 grid place-items-center transition"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="1.9">
              <circle cx="8" cy="15" r="4" />
              <path d="M11 12l8-8M16 4l4 4M14 6l2 2" />
            </svg>
          </button>
          <button onClick={sair} className="text-[11px] text-slate-400 hover:text-white">Sair</button>
'@
  $app = $app.Replace($alvoSair, $botao.TrimEnd())
}

if (-not $app.Contains('<TrocarSenhaModal token={token}')) {
  $alvo = @'
      </header>

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
'@
  if (-not $app.Contains($alvo)) { throw "Não encontrei o final do header principal." }

  $novo = @'
      </header>

      {senhaAberta && (
        <TrocarSenhaModal
          token={token}
          aoFechar={() => setSenhaAberta(false)}
          aoConcluir={sair}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
'@
  $app = $app.Replace($alvo, $novo)
}

Set-Content $frontApp -Value $app -Encoding UTF8

$portal = Get-Content $portalApp -Raw -Encoding UTF8

if (-not $portal.Contains("function TrocarSenhaPortal(")) {
  $marcador = "function Documento({ d })"
  $idx = $portal.IndexOf($marcador)
  if ($idx -lt 0) { throw "Não encontrei Documento no portal." }
  $componente = @'

function TrocarSenhaPortal({ jwt, onClose, onDone }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro('');

    if (!atual || !nova || !confirmacao) {
      setErro('Preencha os três campos.');
      return;
    }
    if (nova.length < 8) {
      setErro('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (nova !== confirmacao) {
      setErro('A confirmação não é igual à nova senha.');
      return;
    }
    if (nova === atual) {
      setErro('Escolha uma senha diferente da atual.');
      return;
    }

    setSalvando(true);
    try {
      await json('/auth/senha', {
        method: 'POST',
        headers: authHeaders(jwt, true),
        body: JSON.stringify({ atual, nova }),
      });
      setSucesso(true);
      setTimeout(onDone, 1100);
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="passwordOverlay" onClick={() => !salvando && !sucesso && onClose()}>
      <div className="passwordModal" onClick={(e) => e.stopPropagation()}>
        <div className="passwordModalHead">
          <div className="passwordIcon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="8" cy="15" r="4" />
              <path d="M11 12l8-8M16 4l4 4M14 6l2 2" />
            </svg>
          </div>
          <div className="passwordModalTitle">
            <span>SEGURANÇA DA CONTA</span>
            <strong>Trocar minha senha</strong>
            <p>Informe sua senha atual e escolha uma nova.</p>
          </div>
          <button
            type="button"
            className="passwordClose"
            onClick={onClose}
            disabled={salvando || sucesso}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {sucesso ? (
          <div className="passwordSuccess">
            <strong>✓ Senha alterada com sucesso</strong>
            <span>Você será desconectado para entrar com a nova senha.</span>
          </div>
        ) : (
          <form onSubmit={salvar} className="form passwordForm">
            <label>
              Senha atual
              <input
                autoFocus
                type="password"
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            <label>
              Nova senha
              <input
                type="password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                autoComplete="new-password"
              />
            </label>

            <label>
              Confirmar nova senha
              <input
                type="password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                autoComplete="new-password"
              />
            </label>

            <span className="passwordHint">Mínimo de 8 caracteres.</span>
            {erro && <div className="error">{erro}</div>}

            <div className="passwordActions">
              <button type="button" className="passwordCancel" onClick={onClose} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" disabled={salvando}>
                {salvando ? 'Alterando…' : 'Trocar senha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}


'@
  $portal = $portal.Insert($idx, $componente)
}

if (-not $portal.Contains('const [trocarSenha, setTrocarSenha]')) {
  $alvo = @'
  const [jwt, setJwt] = useState(
    () => localStorage.getItem(STORAGE) || ''
  );
'@
  if (-not $portal.Contains($alvo)) { throw "Não encontrei o estado JWT do portal." }

  $novo = @'
  const [jwt, setJwt] = useState(
    () => localStorage.getItem(STORAGE) || ''
  );
  const [trocarSenha, setTrocarSenha] = useState(false);
'@
  $portal = $portal.Replace($alvo, $novo)
}

if (-not $portal.Contains('className="portalAccountBar"')) {
  $alvo = @'
        <Logo />

        {validar ? (
'@
  if (-not $portal.Contains($alvo)) { throw "Não encontrei Logo no portal." }

  $novo = @'
        <Logo />

        {jwt && !validar && (
          <div className="portalAccountBar">
            <button
              type="button"
              className="passwordKeyButton"
              onClick={() => setTrocarSenha(true)}
              title="Trocar minha senha"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="8" cy="15" r="4" />
                <path d="M11 12l8-8M16 4l4 4M14 6l2 2" />
              </svg>
              <span>Trocar senha</span>
            </button>
          </div>
        )}

        {trocarSenha && jwt && (
          <TrocarSenhaPortal
            jwt={jwt}
            onClose={() => setTrocarSenha(false)}
            onDone={() => {
              setTrocarSenha(false);
              logout();
            }}
          />
        )}

        {validar ? (
'@
  $portal = $portal.Replace($alvo, $novo)
}

Set-Content $portalApp -Value $portal -Encoding UTF8

$css = Get-Content $portalCss -Raw -Encoding UTF8
if (-not $css.Contains(".passwordOverlay {")) {
  $css += @'


/* Troca de senha do gerente */
.portalAccountBar {
  display: flex;
  justify-content: flex-end;
  margin: -8px 4px 10px;
}

.passwordKeyButton {
  width: auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid #334155;
  border-radius: 999px;
  background: #1e293b;
  color: #cbd5e1;
  font-size: 11.5px;
  font-weight: 600;
}

.passwordKeyButton:hover:not(:disabled) {
  background: #334155;
  border-color: #475569;
}

.passwordKeyButton svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.passwordOverlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgb(2 6 23 / .78);
  backdrop-filter: blur(5px);
}

.passwordModal {
  width: min(440px, 100%);
  border-radius: 18px;
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 22px;
  box-shadow: 0 30px 60px rgb(0 0 0 / .32);
}

.passwordModalHead {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.passwordIcon {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #ccfbf1;
  color: #0f766e;
}

.passwordIcon svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.passwordModalTitle {
  flex: 1;
  min-width: 0;
}

.passwordModalTitle > span {
  display: block;
  color: #0f766e;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
}

.passwordModalTitle strong {
  display: block;
  color: #0f172a;
  font-size: 18px;
  margin-top: 2px;
}

.passwordModalTitle p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 11.5px;
  line-height: 1.45;
}

.passwordClose {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 8px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 20px;
  line-height: 1;
}

.passwordClose:hover:not(:disabled) {
  background: #e2e8f0;
  color: #334155;
}

.passwordForm {
  margin-top: 20px;
}

.passwordHint {
  color: #94a3b8;
  font-size: 10.5px;
  margin-top: -4px;
}

.passwordActions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  margin-top: 4px;
}

.passwordCancel {
  background: #f1f5f9;
  color: #475569;
}

.passwordCancel:hover:not(:disabled) {
  background: #e2e8f0;
}

.passwordSuccess {
  margin-top: 20px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #a7f3d0;
  background: #ecfdf5;
  color: #047857;
}

.passwordSuccess strong,
.passwordSuccess span {
  display: block;
}

.passwordSuccess strong {
  font-size: 13px;
}

.passwordSuccess span {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.45;
}

@media (max-width: 520px) {
  .passwordModal {
    padding: 18px;
  }

  .passwordKeyButton span {
    display: none;
  }

  .passwordKeyButton {
    padding: 8px;
  }
}

'@
}
Set-Content $portalCss -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Buildando principal..." -ForegroundColor Cyan
Push-Location (Join-Path $repoPath "frontend")
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build do principal falhou. Não faça push." }
} finally { Pop-Location }

Write-Host ""
Write-Host "Buildando portal de assinatura..." -ForegroundColor Cyan
Push-Location (Join-Path $repoPath "assinatura-site")
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build do portal falhou. Não faça push." }
} finally { Pop-Location }

Write-Host ""
Write-Host "Pronto: chave de troca de senha adicionada nos dois sistemas." -ForegroundColor Green
Write-Host "Nenhuma migration é necessária; o backend já possui POST /auth/senha."
Write-Host ""
Push-Location $repoPath
try { git status --short } finally { Pop-Location }
