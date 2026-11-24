import { useState, useEffect, useMemo } from "react";
import { toast } from "./Profissional.jsx";

/* 14/11/2026 — EDITAR UNIDADE (só administrador)
   Nome, setor, local, cidade, empresa, Gestor MMG Responsável e situação.
   Só vai para a API o que o administrador mudou. Parar ou encerrar exige
   unidade sem colaborador ativo e sem requisição aberta (a API confere;
   aqui o aviso aparece antes). Fusão de unidades fica fora de propósito. */

const SITUACOES = [
  { k: "ativa",     t: "Ativa",     d: "Aparece no rodízio normalmente." },
  { k: "parada",    t: "Parada",    d: "Pausa temporária, como entressafra. Volta quando reativada." },
  { k: "encerrada", t: "Encerrada", d: "Não é mais atendida. O histórico fica guardado." },
];
const cap = (s) => String(s || "").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const horaBR = (d) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const campo = "w-full border border-slate-300 rounded-lg px-3 py-2 text-[13.5px] bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500";

function Rotulo({ children, dica }) {
  return (
    <div className="mb-1">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{children}</span>
      {dica && <span className="block text-[11.5px] text-slate-400 normal-case tracking-normal font-normal">{dica}</span>}
    </div>
  );
}

export default function EditarUnidade({ unidade, token, pedir, gravar, aoFechar, aoSalvar }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [verHistorico, setVerHistorico] = useState(false);

  const [nome, setNome] = useState("");
  const [setor, setSetor] = useState("");
  const [localId, setLocalId] = useState(null);
  const [localNome, setLocalNome] = useState("");
  const [cidade, setCidade] = useState("");
  const [novo, setNovo] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [buscaLocal, setBuscaLocal] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [gestorId, setGestorId] = useState("");
  const [situacao, setSituacao] = useState("ativa");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await pedir(`/rodizio/admin/unidades/${unidade.id}`, token);
        if (!vivo) return;
        const u = r.unidade;
        setDados(r);
        setNome(u.nome_completo || ""); setSetor(u.setor || "");
        setLocalId(u.local_id || null); setLocalNome(u.local_nome || "");
        setCidade(u.cidade || ""); setEmpresaId(u.empresa_id || "");
        setGestorId(u.gestor_id || ""); setSituacao(u.situacao || "ativa");
      } catch (e) { if (vivo) setErro(e.message); }
    })();
    return () => { vivo = false; };
  }, [unidade.id, token, pedir]);

  useEffect(() => {
    const tecla = (e) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aoFechar]);

  const u = dados?.unidade;
  const localAtual = useMemo(() => (dados?.locais || []).find((l) => l.id === localId), [dados, localId]);
  const achados = useMemo(() => {
    const t = semAcento(buscaLocal).trim();
    if (!t) return [];
    return (dados?.locais || []).filter((l) => semAcento(`${l.nome} ${l.cidade || ""}`).includes(t)).slice(0, 7);
  }, [dados, buscaLocal]);

  /* o que mudou, comparado com o que veio da API */
  const corpo = useMemo(() => {
    if (!u) return {};
    const c = {};
    if (nome.trim() !== (u.nome_completo || "")) c.nome_completo = nome.trim();
    if (setor.trim() !== (u.setor || "")) c.setor = setor.trim();
    if (empresaId && empresaId !== (u.empresa_id || "")) c.empresa_id = empresaId;
    if ((gestorId || "") !== (u.gestor_id || "")) c.gestor_id = gestorId || null;
    if (situacao !== u.situacao) c.situacao = situacao;
    if (novo) {
      if (novoNome.trim()) c.novo_local = { nome: novoNome.trim(), cidade: cidade.trim() };
    } else {
      if (localId && localId !== u.local_id) c.local_id = localId;
      if (localId && localNome.trim() && localNome.trim() !== (localAtual?.nome || u.local_nome || "")) c.local_nome = localNome.trim();
      const baseCidade = localId && localId !== u.local_id ? (localAtual?.cidade || "") : (u.cidade || "");
      if (cidade.trim() !== baseCidade && localId) c.cidade = cidade.trim();
    }
    return c;
  }, [u, nome, setor, empresaId, gestorId, situacao, novo, novoNome, localId, localNome, cidade, localAtual]);

  const mudou = Object.keys(corpo).length > 0;
  const pend = dados?.pendencias || { ativos: 0, requisicoes: 0 };
  const barrado = u && situacao !== "ativa" && u.situacao === "ativa" && (pend.ativos > 0 || pend.requisicoes > 0);
  const semLocal = !novo && !localId;
  const falta = novo && novoNome.trim().length < 3 ? "Dê um nome ao novo local." : nome.trim().length < 3 ? "O nome precisa ter pelo menos 3 letras." : "";

  async function salvar() {
    setSalvando(true); setErro("");
    try {
      const r = await gravar(`/rodizio/admin/unidades/${unidade.id}`, token, corpo, "PUT");
      aoSalvar && (await aoSalvar(r));
      aoFechar();
    } catch (e) { setErro(e.message); toast(e.message, "erro"); }
    finally { setSalvando(false); }
  }

  function escolherLocal(l) {
    setLocalId(l.id); setLocalNome(l.nome); setCidade(l.cidade || ""); setBuscaLocal(""); setNovo(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto" role="dialog" aria-modal="true" aria-label={`Editar unidade ${unidade.codigo}`}>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={aoFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[640px] my-auto border border-slate-200">
        <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider text-teal-700 font-semibold">Editar unidade</p>
            <h2 className="text-[17px] font-semibold leading-tight mt-0.5">{unidade.codigo} · {cap(u?.local_nome || unidade.local_nome || unidade.nome_completo)}</h2>
          </div>
          <button onClick={aoFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-700 text-[22px] leading-none px-1">×</button>
        </div>

        {!dados && !erro && <p className="px-5 py-10 text-[13px] text-slate-500 text-center">Carregando…</p>}
        {!dados && erro && <p className="px-5 py-10 text-[13px] text-rose-600 text-center">{erro}</p>}

        {dados && (
          <div className="px-5 py-4 space-y-5">
            {/* identificação */}
            <div className="grid sm:grid-cols-[1fr_180px] gap-3">
              <div>
                <Rotulo>Nome da unidade</Rotulo>
                <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <Rotulo>Setor</Rotulo>
                <input className={campo} value={setor} placeholder="Ex.: Armazém" onChange={(e) => setSetor(e.target.value)} />
              </div>
            </div>

            {/* local */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-3 bg-slate-50/60">
              <div className="flex items-center justify-between gap-2">
                <Rotulo dica="É o lugar físico. Carrega a cidade e o ponto no mapa.">Local</Rotulo>
                <button onClick={() => { setNovo(!novo); setBuscaLocal(""); if (!novo) setCidade(""); else setCidade(localAtual?.cidade || u.cidade || ""); }}
                  className="text-[12px] font-semibold text-teal-700 whitespace-nowrap">{novo ? "Usar um local que já existe" : "+ Criar novo local"}</button>
              </div>

              {novo ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Rotulo>Nome do novo local</Rotulo>
                    <input className={campo} value={novoNome} placeholder="Ex.: AGRICOLA ANDREIS MOEGA" onChange={(e) => setNovoNome(e.target.value)} autoFocus />
                  </div>
                  <div>
                    <Rotulo>Cidade</Rotulo>
                    <input className={campo} value={cidade} onChange={(e) => setCidade(e.target.value)} />
                  </div>
                  <p className="sm:col-span-2 text-[11.5px] text-slate-500">
                    Se já existir um local com esse nome, a unidade é ligada a ele. O ponto no mapa você marca depois, na aba Locais.
                  </p>
                </div>
              ) : (
                <>
                  {localId ? (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <Rotulo>Nome do local</Rotulo>
                        <input className={campo} value={localNome} onChange={(e) => setLocalNome(e.target.value)} />
                      </div>
                      <div>
                        <Rotulo>Cidade</Rotulo>
                        <input className={campo} value={cidade} onChange={(e) => setCidade(e.target.value)} />
                      </div>
                      {(localAtual?.unidades || 0) > 1 && (
                        <p className="sm:col-span-2 text-[11.5px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                          Este local tem {localAtual.unidades} unidades. Mudar o nome ou a cidade vale para todas.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                      Esta unidade está sem local, por isso não tem cidade nem ponto no mapa. Procure um local abaixo ou crie um novo.
                    </p>
                  )}
                  <div>
                    <Rotulo>{localId ? "Trocar por outro local" : "Procurar local"}</Rotulo>
                    <input className={campo} value={buscaLocal} placeholder="Digite parte do nome ou da cidade" onChange={(e) => setBuscaLocal(e.target.value)} />
                    {achados.length > 0 && (
                      <div className="mt-1.5 border border-slate-200 rounded-lg overflow-hidden bg-white">
                        {achados.map((l) => (
                          <button key={l.id} onClick={() => escolherLocal(l)}
                            className="w-full text-left px-3 py-2 text-[13px] hover:bg-teal-50 border-b border-slate-100 last:border-0 flex justify-between gap-3">
                            <span className="font-semibold truncate">{cap(l.nome)}</span>
                            <span className="text-slate-500 text-[12px] whitespace-nowrap">{l.cidade || "sem cidade"} · {l.unidades} {l.unidades === 1 ? "unidade" : "unidades"}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {buscaLocal.trim() && achados.length === 0 && <p className="text-[12px] text-slate-500 mt-1.5">Nenhum local com isso. Use “Criar novo local”.</p>}
                  </div>
                </>
              )}
            </div>

            {/* empresa e gestor */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Rotulo>Empresa</Rotulo>
                <select className={campo} value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                  {!u.empresa_id && <option value="">Sem empresa</option>}
                  {dados.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
              <div>
                <Rotulo>Gestor MMG Responsável</Rotulo>
                <select className={campo} value={gestorId} onChange={(e) => setGestorId(e.target.value)}>
                  <option value="">Sem gestor</option>
                  {dados.gestores.map((g) => <option key={g.id} value={g.id}>{cap(g.nome)}{g.perfil === "admin" ? " (admin)" : ""}</option>)}
                </select>
              </div>
            </div>

            {/* situação */}
            <div>
              <Rotulo>Situação</Rotulo>
              <div className="grid sm:grid-cols-3 gap-2">
                {SITUACOES.map((s) => (
                  <button key={s.k} onClick={() => setSituacao(s.k)}
                    className={`text-left rounded-xl border px-3 py-2.5 transition ${situacao === s.k
                      ? (s.k === "ativa" ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500" : "border-amber-400 bg-amber-50 ring-1 ring-amber-400")
                      : "border-slate-200 hover:border-slate-300"}`}>
                    <span className="block text-[13px] font-semibold">{s.t}</span>
                    <span className="block text-[11.5px] text-slate-500 leading-snug mt-0.5">{s.d}</span>
                  </button>
                ))}
              </div>
              {barrado && (
                <p className="mt-2 text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {pend.ativos > 0 && <>Esta unidade tem <b>{pend.ativos}</b> {pend.ativos === 1 ? "colaborador ativo" : "colaboradores ativos"} nos últimos 5 dias. Transfira antes de {situacao === "parada" ? "parar" : "encerrar"}. </>}
                  {pend.requisicoes > 0 && <>Há <b>{pend.requisicoes}</b> {pend.requisicoes === 1 ? "requisição aberta" : "requisições abertas"}.</>}
                </p>
              )}
              {situacao !== "ativa" && !barrado && u.situacao === "ativa" && (
                <p className="mt-2 text-[12px] text-slate-500">A unidade some das listas do rodízio. Para voltar, edite e marque “Ativa”.</p>
              )}
            </div>

            {/* histórico */}
            <div>
              <button onClick={() => setVerHistorico(!verHistorico)} className="text-[12px] font-semibold text-slate-500 hover:text-slate-700">
                {verHistorico ? "▾" : "▸"} Histórico de alterações ({dados.historico.length})
              </button>
              {verHistorico && (
                <ul className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1">
                  {dados.historico.length === 0 && <li className="text-[12px] text-slate-400">Ainda não há alterações registradas.</li>}
                  {dados.historico.map((h, i) => (
                    <li key={i} className="text-[12px] border-l-2 border-slate-200 pl-3">
                      <span className="text-slate-400 tabular-nums">{horaBR(h.quando)}</span> · <span className="font-semibold">{h.ator || "sistema"}</span>
                      <span className="block text-slate-600">{h.descricao || h.titulo}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {erro && <p className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{erro}</p>}
          </div>
        )}

        {dados && (
          <div className="px-5 py-3.5 border-t border-slate-100 flex flex-wrap items-center gap-2 justify-end bg-slate-50/60 rounded-b-2xl">
            <span className="text-[12px] text-slate-500 mr-auto">
              {falta || (!mudou ? "Nenhuma alteração ainda." : semLocal ? "Atenção: continua sem local." : "Pronto para salvar.")}
            </span>
            <button onClick={aoFechar} className="border border-slate-300 rounded-lg px-4 py-2 text-[13px] font-semibold bg-white">Cancelar</button>
            <button onClick={salvar} disabled={!mudou || salvando || !!falta || barrado}
              className="bg-teal-600 text-white rounded-lg px-5 py-2 text-[13px] font-semibold disabled:opacity-40">{salvando ? "Salvando…" : "Salvar alterações"}</button>
          </div>
        )}
      </div>
    </div>
  );
}