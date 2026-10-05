import { useEffect, useMemo, useRef, useState } from "react";

const dataHoraBR = (d) =>
  d ? new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) : "—";

const dataCurtaBR = (d) =>
  d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit",
  }) : "";

const STATUS_TEXTO = {
  aberta: "Aguardando atendimento",
  em_atendimento: "Em atendimento",
  atendida: "Concluída",
  cancelada: "Cancelada",
};

function Icone({ nome, className = "w-4 h-4" }) {
  const comum = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (nome === "search") return <svg {...comum}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>;
  if (nome === "user") return <svg {...comum}><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.4 3.5-7 8-7s7.2 2.6 8 7"/></svg>;
  if (nome === "key") return <svg {...comum}><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 4l4 4M14 6l2 2"/></svg>;
  if (nome === "bell") return <svg {...comum}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 19h4"/></svg>;
  if (nome === "clock") return <svg {...comum}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (nome === "file") return <svg {...comum}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></svg>;
  if (nome === "check") return <svg {...comum}><path d="m5 12 4 4L19 6"/></svg>;
  if (nome === "warning") return <svg {...comum}><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/></svg>;
  return <svg {...comum}><circle cx="12" cy="12" r="9"/></svg>;
}

export function toast(texto, tipo = "sucesso") {
  window.dispatchEvent(new CustomEvent("mmg:toast", {
    detail: { texto, tipo, id: `${Date.now()}-${Math.random()}` },
  }));
}

export function ToastHost() {
  const [itens, setItens] = useState([]);

  useEffect(() => {
    const ouvir = (e) => {
      const item = e.detail || {};
      setItens((v) => [...v.slice(-3), item]);
      setTimeout(() => {
        setItens((v) => v.filter((x) => x.id !== item.id));
      }, 3200);
    };
    window.addEventListener("mmg:toast", ouvir);
    return () => window.removeEventListener("mmg:toast", ouvir);
  }, []);

  return (
    <div className="fixed right-4 top-20 z-[120] w-[min(360px,calc(100vw-2rem))] space-y-2 pointer-events-none">
      {itens.map((i) => (
        <div
          key={i.id}
          className={`pointer-events-auto rounded-xl border shadow-lg px-4 py-3 flex items-start gap-3 ${
            i.tipo === "erro"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : i.tipo === "aviso"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          <span className="mt-0.5">
            <Icone nome={i.tipo === "erro" || i.tipo === "aviso" ? "warning" : "check"} />
          </span>
          <p className="text-[12.5px] leading-relaxed font-medium">{i.texto || "Alteração salva."}</p>
        </div>
      ))}
    </div>
  );
}

function CartaoKpi({ rotulo, valor, sub, tom = "slate", onClick }) {
  const tons = {
    slate: "text-slate-900",
    teal: "text-teal-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
    violet: "text-violet-700",
    emerald: "text-emerald-700",
    sky: "text-sky-700",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left bg-white rounded-xl border border-slate-200 p-4 w-full transition ${
        onClick ? "hover:border-slate-400 hover:shadow-sm" : "cursor-default"
      }`}
    >
      <p className="text-[11px] text-slate-500">{rotulo}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-1 ${tons[tom] || tons.slate}`}>{valor ?? 0}</p>
      {sub && <p className="text-[10.5px] text-slate-400 mt-1 leading-tight">{sub}</p>}
    </button>
  );
}

function RotuloEvento({ tipo }) {
  const mapa = {
    requisicao_criada: ["bg-sky-50 text-sky-700", "Pedido"],
    requisicao_status_alterado: ["bg-slate-100 text-slate-700", "Status"],
    requisicao_concluida: ["bg-emerald-50 text-emerald-700", "Concluída"],
    requisicao_cancelada: ["bg-rose-50 text-rose-700", "Cancelada"],
    assinatura_solicitada: ["bg-violet-50 text-violet-700", "Assinatura"],
    assinatura_visualizada: ["bg-indigo-50 text-indigo-700", "Visualizada"],
    assinatura_concluida: ["bg-emerald-50 text-emerald-700", "Assinada"],
    usuario_criado: ["bg-slate-100 text-slate-700", "Acesso"],
    gerente_unidades_atualizadas: ["bg-amber-50 text-amber-700", "Gerente"],
    senha_alterada: ["bg-slate-100 text-slate-700", "Segurança"],
    login: ["bg-slate-100 text-slate-600", "Login"],
  };
  const [classe, texto] = mapa[tipo] || ["bg-slate-100 text-slate-600", "Evento"];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${classe}`}>{texto}</span>;
}

/* MMG_UI2_DASHBOARD */
export function DashboardExecutivo({
  token,
  pedir,
  aoAbrirRequisicoes,
  aoAbrirAtividades,
  aoAbrirEscalas,
  aoAbrirAcessos,
  aoAbrirImportar,
  podeEditar = false,
}) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");

  async function carregar() {
    setErro("");
    try {
      setD(await pedir("/profissional/dashboard", token));
    } catch (e) {
      setErro(e.message);
    }
  }

  useEffect(() => { carregar(); }, [token]);

  const maxTendencia = Math.max(
    1,
    ...(d?.tendencia || []).map((x) => Number(x.requisicoes || 0))
  );

  if (erro) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-[12px] text-rose-700">
        Dashboard profissional indisponível: {erro}
      </div>
    );
  }

  if (!d) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-400">
        Carregando visão operacional…
      </div>
    );
  }

  const c = d.cards || {};

  const acao = (rotulo, descricao, fn, destaque = false) => (
    <button
      type="button"
      onClick={fn}
      className={`text-left rounded-xl border px-3.5 py-3 transition ${
        destaque
          ? "bg-teal-600 border-teal-600 text-white hover:bg-teal-500"
          : "bg-white border-slate-200 hover:border-slate-400 hover:shadow-sm"
      }`}
    >
      <p className={`text-[12px] font-semibold ${destaque ? "text-white" : "text-slate-800"}`}>
        {rotulo}
      </p>
      <p className={`text-[10.5px] mt-0.5 leading-tight ${destaque ? "text-teal-50" : "text-slate-500"}`}>
        {descricao}
      </p>
    </button>
  );

  return (
    <div className="space-y-5">
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[16px] font-semibold text-slate-900">Visão operacional</p>
            <p className="text-[12px] text-slate-500 mt-1">
              O que precisa de atenção agora, sem alterar as regras do rodízio.
            </p>
          </div>
          <button
            onClick={carregar}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 hover:border-slate-400"
          >
            Atualizar dados
          </button>
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5 mt-4">
          {acao("Requisições", "Abrir fila e filtros", aoAbrirRequisicoes, true)}
          {acao("Escalas", "Conferir as escalas", aoAbrirEscalas)}
          {acao("Atividades", "Ver histórico do sistema", aoAbrirAtividades)}
          {podeEditar
            ? acao("Acessos", "Gerentes e permissões", aoAbrirAcessos)
            : acao("Minha operação", "Acompanhar requisições", aoAbrirRequisicoes)}
        </div>
      </section>

      <div className="grid xl:grid-cols-3 gap-4">
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400 font-semibold">Operação</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <CartaoKpi rotulo="Abertas" valor={c.abertas} tom="amber" onClick={aoAbrirRequisicoes} />
            <CartaoKpi rotulo="Em atendimento" valor={c.em_atendimento} tom="sky" onClick={aoAbrirRequisicoes} />
            <CartaoKpi rotulo="Pessoas em aberto" valor={c.pessoas_em_aberto} tom="teal" />
            <CartaoKpi rotulo="Concluídas hoje" valor={c.concluidas_hoje} tom="emerald" />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400 font-semibold">Assinaturas</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <CartaoKpi rotulo="Aguardando" valor={c.assinaturas_aguardando} tom="violet" onClick={aoAbrirRequisicoes} />
            <CartaoKpi rotulo="Assinadas hoje" valor={c.assinadas_hoje} tom="emerald" />
            <CartaoKpi rotulo="Links expirados" valor={c.assinaturas_expiradas} tom="rose" onClick={aoAbrirRequisicoes} />
            <CartaoKpi rotulo="Criadas em 30 dias" valor={c.criadas_30_dias} tom="slate" />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400 font-semibold">Pendências</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <CartaoKpi rotulo="Fora do prazo" valor={c.fora_do_prazo} tom="rose" onClick={aoAbrirRequisicoes} />
            <CartaoKpi rotulo="Sem gerente" valor={c.unidades_sem_gerente} tom="amber" onClick={aoAbrirAcessos} />
            <div className="col-span-2 rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500">Leitura rápida</p>
              <p className="text-[12px] text-slate-700 mt-1 leading-relaxed">
                Priorize unidades sem gerente, links vencidos e pedidos fora do prazo.
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[14px] font-semibold">Requisições nos últimos 30 dias</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Canceladas não entram no gráfico.</p>
            </div>
            <span className="text-[11px] text-slate-500">{c.criadas_30_dias || 0} criadas</span>
          </div>

          <div className="h-40 mt-5 flex items-end gap-1">
            {(d.tendencia || []).map((x, i) => (
              <div key={x.dia} className="flex-1 min-w-0 group relative">
                <div
                  className="bg-teal-500 rounded-t min-h-[3px] transition-opacity group-hover:opacity-80"
                  style={{ height: `${Math.max(3, (Number(x.requisicoes || 0) / maxTendencia) * 132)}px` }}
                />
                {(i === 0 || i === 9 || i === 19 || i === (d.tendencia || []).length - 1) && (
                  <span className="block text-[9px] text-slate-400 text-center mt-1">{dataCurtaBR(x.dia)}</span>
                )}
                <span className="hidden group-hover:block absolute bottom-[105%] left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] rounded-lg px-2 py-1 whitespace-nowrap z-10 shadow-lg">
                  {dataCurtaBR(x.dia)} · {x.requisicoes} pedido(s) · {x.pessoas} pessoa(s)
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-[14px] font-semibold">Unidades com mais pedidos</p>
          <p className="text-[11px] text-slate-400 mt-0.5 mb-4">Últimos 30 dias.</p>
          <div className="space-y-3">
            {(d.top_unidades || []).map((u, i) => (
              <div key={`${u.unidade_codigo}-${i}`} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-semibold grid place-items-center shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium truncate">{u.unidade_codigo} · {u.unidade_nome}</p>
                  <p className="text-[10.5px] text-slate-400">{u.requisicoes} pedido(s) · {u.pessoas} pessoa(s)</p>
                </div>
              </div>
            ))}
            {(d.top_unidades || []).length === 0 && (
              <p className="text-[11px] text-slate-400">Sem movimento recente.</p>
            )}
          </div>
        </section>
      </div>

      {(d.alertas || []).length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-semibold flex items-center gap-2">
                <Icone nome="bell" className="w-4 h-4 text-amber-600" />
                Pendências que precisam de atenção
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Vermelho fica reservado para o que realmente bloqueia o fluxo.
              </p>
            </div>
            <span className="bg-slate-100 text-slate-700 rounded-full px-2.5 py-1 text-[10px] font-semibold">
              {d.alertas.length}
            </span>
          </div>

          <div className="grid md:grid-cols-2 gap-2.5 mt-4">
            {d.alertas.map((a, i) => (
              <button
                key={`${a.tipo}-${a.requisicao_id}-${i}`}
                onClick={aoAbrirRequisicoes}
                className={`text-left rounded-xl border border-slate-200 border-l-4 bg-white p-3.5 hover:border-slate-400 transition ${
                  a.gravidade === "alta" ? "border-l-rose-500" : "border-l-amber-400"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-slate-800">{a.titulo}</p>
                  <code className="text-[9px] text-slate-400">{a.protocolo}</code>
                </div>
                <p className="text-[11px] text-slate-600 mt-1">{a.unidade_codigo} · {a.unidade_nome}</p>
                <p className="text-[10.5px] text-slate-500 mt-1">{a.detalhe}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold">Atividade recente</p>
            <p className="text-[11px] text-slate-400">Quem fez o quê no sistema.</p>
          </div>
          {aoAbrirAtividades && (
            <button onClick={aoAbrirAtividades} className="text-[11px] text-teal-700 hover:underline">
              Ver histórico completo
            </button>
          )}
        </div>
        <div>
          {(d.atividades || []).map((e) => (
            <div key={`${e.id}-${e.quando}`} className="px-5 py-3 border-b border-slate-100 last:border-0 flex items-start gap-3">
              <div className="mt-0.5"><RotuloEvento tipo={e.tipo} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-slate-800">{e.titulo}</p>
                <p className="text-[10.5px] text-slate-500 mt-0.5">
                  {[e.protocolo_requisicao, e.unidade_codigo, e.ator].filter(Boolean).join(" · ")}
                </p>
                {e.descricao && <p className="text-[10.5px] text-slate-400 mt-0.5 truncate">{e.descricao}</p>}
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">{dataHoraBR(e.quando)}</span>
            </div>
          ))}
        </div>
      </section>

      {podeEditar && aoAbrirImportar && (
        <div className="text-right">
          <button onClick={aoAbrirImportar} className="text-[10.5px] text-slate-400 hover:text-slate-600">
            Importar dados
          </button>
        </div>
      )}
    </div>
  );
}

export function Atividades({ token, pedir }) {
  const [linhas, setLinhas] = useState(null);
  const [q, setQ] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      setErro("");
      try {
        const qs = new URLSearchParams({ limite: "200" });
        if (q.trim()) qs.set("q", q.trim());
        setLinhas(await pedir(`/profissional/atividades?${qs}`, token));
      } catch (e) {
        setErro(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [token, q]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-semibold">Histórico de atividades</p>
        <p className="text-[11px] text-slate-500 mt-1">
          Registro operacional de requisições, assinaturas e acessos. Os novos eventos de auditoria são gravados separadamente.
        </p>
        <div className="relative mt-3">
          <Icone nome="search" className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por protocolo, unidade, pessoa ou ação…"
            className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-[12.5px]"
          />
        </div>
      </div>

      {erro && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[12px] text-rose-700">{erro}</div>}
      {!linhas && !erro && <p className="text-sm text-slate-400">Carregando histórico…</p>}

      {linhas && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {(linhas || []).map((e) => (
            <div key={`${e.id}-${e.quando}`} className="px-4 py-3 border-b border-slate-100 last:border-0 flex items-start gap-3">
              <div className="mt-0.5"><RotuloEvento tipo={e.tipo} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium text-slate-900">{e.titulo}</p>
                <p className="text-[10.5px] text-slate-500 mt-0.5">
                  {[e.protocolo_requisicao, e.protocolo_assinatura, e.unidade_codigo, e.unidade_nome].filter(Boolean).join(" · ")}
                </p>
                {e.descricao && <p className="text-[11px] text-slate-600 mt-1">{e.descricao}</p>}
                <p className="text-[10px] text-slate-400 mt-1">
                  {e.ator ? `por ${e.ator} · ` : ""}{dataHoraBR(e.quando)}
                </p>
              </div>
            </div>
          ))}
          {linhas.length === 0 && <p className="p-6 text-center text-[12px] text-slate-400">Nenhum evento encontrado.</p>}
        </div>
      )}
    </div>
  );
}

/* MMG_UI2_BUSCA */
export function BuscaGlobal({
  token,
  pedir,
  aoFechar,
  aoAbrirRequisicoes,
  aoAbrirAcessos,
  aoAbrirEscalas,
  aoAbrirAtividades,
  aoAbrirImportar,
}) {
  const [q, setQ] = useState("");
  const [d, setD] = useState({ requisicoes: [], unidades: [], usuarios: [] });
  const [carregando, setCarregando] = useState(false);
  const inputRef = useRef(null);

  const comandos = [
    { titulo: "Ir para Requisições", descricao: "Pedidos, filtros e assinaturas", acao: aoAbrirRequisicoes },
    { titulo: "Ir para Escalas", descricao: "Escalas e quinzenas", acao: aoAbrirEscalas },
    { titulo: "Abrir Atividades", descricao: "Histórico operacional", acao: aoAbrirAtividades },
    { titulo: "Gerenciar Acessos", descricao: "Gerentes e permissões", acao: aoAbrirAcessos },
    { titulo: "Importar dados", descricao: "Carga e atualização", acao: aoAbrirImportar },
  ].filter((x) => typeof x.acao === "function");

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 20); }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setD({ requisicoes: [], unidades: [], usuarios: [] });
      return;
    }
    const t = setTimeout(async () => {
      setCarregando(true);
      try {
        setD(await pedir(`/profissional/busca?q=${encodeURIComponent(q.trim())}`, token));
      } catch (_e) {
        setD({ requisicoes: [], unidades: [], usuarios: [] });
      } finally {
        setCarregando(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, token]);

  const comandosFiltrados = q.trim()
    ? comandos.filter((c) =>
        `${c.titulo} ${c.descricao}`.toLowerCase().includes(q.trim().toLowerCase())
      )
    : comandos;

  const total =
    (d.requisicoes?.length || 0) +
    (d.unidades?.length || 0) +
    (d.usuarios?.length || 0) +
    comandosFiltrados.length;

  const executar = (fn) => {
    aoFechar();
    setTimeout(() => fn?.(), 0);
  };

  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto" onClick={aoFechar}>
      <div className="max-w-2xl mx-auto mt-[8vh] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Icone nome="search" className="w-5 h-5 absolute left-3 top-3 text-slate-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar ou digitar uma ação…"
              className="w-full border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-[14px]"
              onKeyDown={(e) => e.key === "Escape" && aoFechar()}
            />
            <button onClick={aoFechar} className="absolute right-3 top-2.5 text-slate-400 text-lg">×</button>
          </div>
          <div className="flex items-center justify-between gap-3 mt-2">
            <p className="text-[10px] text-slate-400">Busque protocolo, unidade, gerente ou execute uma ação.</p>
            <span className="text-[9px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Esc fecha</span>
          </div>
        </div>

        <div className="max-h-[68vh] overflow-y-auto">
          {comandosFiltrados.length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50">Ações rápidas</p>
              <div className="p-2 grid sm:grid-cols-2 gap-1.5">
                {comandosFiltrados.map((c) => (
                  <button
                    key={c.titulo}
                    onClick={() => executar(c.acao)}
                    className="text-left rounded-xl border border-slate-200 px-3 py-2.5 hover:border-teal-300 hover:bg-teal-50/40 transition"
                  >
                    <p className="text-[12px] font-semibold text-slate-800">{c.titulo}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{c.descricao}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {carregando && <p className="p-4 text-[12px] text-slate-400">Buscando…</p>}

          {!carregando && q.trim().length >= 2 && total === 0 && (
            <div className="p-8 text-center">
              <p className="text-[13px] font-medium text-slate-700">Nada encontrado</p>
              <p className="text-[11px] text-slate-400 mt-1">Tente o número da unidade, nome ou protocolo.</p>
            </div>
          )}

          {(d.requisicoes || []).length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50">Requisições</p>
              {d.requisicoes.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    sessionStorage.setItem("mmg_busca_requisicoes", r.id);
                    executar(aoAbrirRequisicoes);
                  }}
                  className="w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12.5px] font-semibold">{r.protocolo}</p>
                    <span className="text-[10px] text-slate-400">{STATUS_TEXTO[r.status] || r.status}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">{r.unidade_codigo} · {r.unidade_nome}</p>
                  <p className="text-[10.5px] text-slate-400">{r.quantidade} pessoa(s) · {r.solicitante_nome || "—"}</p>
                </button>
              ))}
            </div>
          )}

          {(d.unidades || []).length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50">Unidades</p>
              {d.unidades.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setQ(u.codigo || u.nome || "");
                  }}
                  className="w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50"
                >
                  <p className="text-[12.5px] font-semibold">{u.codigo} · {u.nome}</p>
                  <p className="text-[10.5px] text-slate-400">{[u.local, u.cidade].filter(Boolean).join(" · ") || "—"}</p>
                </button>
              ))}
            </div>
          )}

          {(d.usuarios || []).length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50">Acessos e gerentes</p>
              {d.usuarios.map((u) => (
                <button
                  key={u.id}
                  onClick={() => executar(aoAbrirAcessos)}
                  className="w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50"
                >
                  <p className="text-[12.5px] font-semibold">{u.nome}</p>
                  <p className="text-[10.5px] text-slate-500">@{u.usuario} · {u.somente_assinatura ? "gerente" : u.perfil}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ContaMenu({ token, pedir, eu, aoTrocarSenha, aoSair }) {
  const [aberto, setAberto] = useState(false);
  const [conta, setConta] = useState(null);

  useEffect(() => {
    if (!aberto || conta) return;
    pedir("/profissional/minha-conta", token).then(setConta).catch(() => {});
  }, [aberto, token]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-800 text-left"
        title="Minha conta"
      >
        <span className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 grid place-items-center text-slate-300">
          <Icone nome="user" className="w-4 h-4" />
        </span>
        <span className="hidden sm:block">
          <span className="block text-[11px] text-slate-200 leading-tight">{eu.nome || eu.usuario}</span>
          <span className="block text-[9.5px] text-slate-500 leading-tight">{eu.perfil}</span>
        </span>
      </button>

      {aberto && (
        <>
          <button aria-label="Fechar menu" className="fixed inset-0 z-30 cursor-default bg-transparent" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-72 bg-white text-slate-900 rounded-xl border border-slate-200 shadow-xl p-3">
            <div className="px-2 py-2 border-b border-slate-100">
              <p className="text-[13px] font-semibold">{conta?.nome || eu.nome || eu.usuario}</p>
              <p className="text-[10.5px] text-slate-500 mt-0.5">@{conta?.usuario || eu.usuario} · {conta?.perfil || eu.perfil}</p>
              {conta?.ultimo_acesso_em && (
                <p className="text-[9.5px] text-slate-400 mt-1">Último acesso: {dataHoraBR(conta.ultimo_acesso_em)}</p>
              )}
            </div>

            <button
              onClick={() => { setAberto(false); aoTrocarSenha(); }}
              className="w-full mt-2 rounded-lg px-3 py-2 text-left text-[11.5px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <Icone nome="key" className="w-4 h-4 text-slate-500" />
              Trocar minha senha
            </button>

            <button
              onClick={aoSair}
              className="w-full rounded-lg px-3 py-2 text-left text-[11.5px] text-rose-700 hover:bg-rose-50"
            >
              Sair da conta
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function LinhaDoTempoRequisicao({ id, token, pedir, aoFechar }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setD(null);
    setErro("");
    pedir(`/profissional/requisicao/${encodeURIComponent(id)}/timeline`, token)
      .then(setD)
      .catch((e) => setErro(e.message));
  }, [id, token]);

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/65 backdrop-blur-sm p-4 overflow-y-auto" onClick={aoFechar}>
      <div className="bg-white rounded-2xl max-w-2xl mx-auto my-8 border border-slate-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wide text-teal-700 font-semibold">Linha do tempo</p>
            <h2 className="text-[16px] font-semibold mt-1">
              {d?.requisicao?.protocolo || "Requisição"}
            </h2>
            {d?.requisicao && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                {d.requisicao.unidade_codigo} · {d.requisicao.unidade_nome} · {d.requisicao.quantidade} pessoa(s)
              </p>
            )}
          </div>
          <button onClick={aoFechar} className="text-xl text-slate-400">×</button>
        </div>

        <div className="p-5">
          {erro && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[12px] text-rose-700">{erro}</div>}
          {!d && !erro && <p className="text-[12px] text-slate-400">Carregando histórico…</p>}

          {d && (
            <div className="relative ml-2">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />
              <div className="space-y-4">
                {(d.eventos || []).map((e, i) => (
                  <div key={`${e.id}-${i}`} className="relative pl-8">
                    <span className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-4 border-white ${
                      e.tipo === "assinatura_concluida" || e.tipo === "requisicao_concluida"
                        ? "bg-emerald-500"
                        : e.tipo === "requisicao_cancelada"
                        ? "bg-rose-500"
                        : e.tipo === "assinatura_solicitada" || e.tipo === "assinatura_visualizada"
                        ? "bg-violet-500"
                        : "bg-sky-500"
                    }`} />
                    <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-[12px] font-semibold">{e.titulo}</p>
                        <span className="text-[9.5px] text-slate-400">{dataHoraBR(e.quando)}</span>
                      </div>
                      {e.descricao && <p className="text-[10.5px] text-slate-600 mt-1">{e.descricao}</p>}
                      {e.ator && <p className="text-[10px] text-slate-400 mt-1">por {e.ator}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {(d.eventos || []).length === 0 && (
                <p className="text-[12px] text-slate-400">Nenhum evento registrado.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
