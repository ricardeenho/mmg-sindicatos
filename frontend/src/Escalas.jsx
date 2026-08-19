import { useState, useEffect, useMemo } from "react";

const DIAS_POR_MES = 5;

const dataBR = (d) => {
  if (!d) return "";
  const [a, m, dia] = String(d).slice(0, 10).split("-");
  return a && m && dia ? `${dia}/${m}/${a}` : "";
};
const horaBR = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "");
const iso = (d) => d.toISOString().slice(0, 10);

/* Proxima segunda-feira, que e onde todo bloco de rodizio comeca */
function proximaSegunda() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
}
function somaDias(texto, n) {
  const d = new Date(texto + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
}
function diasEntre(a, b) {
  return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000) + 1;
}

const Selo = ({ status }) => {
  const cor =
    status === "publicada" ? "bg-emerald-50 text-emerald-700"
    : status === "rascunho" ? "bg-amber-50 text-amber-700"
    : "bg-slate-100 text-slate-500";
  return <span className={`text-[11px] px-2 py-1 rounded ${cor}`}>{status}</span>;
};

/* ================================================================== */
export default function Escalas({ token, podeEditar, pedir, gravar }) {
  const [lista, setLista] = useState(null);
  const [aberta, setAberta] = useState(null);   // id da escala aberta
  const [erro, setErro] = useState("");

  async function carregarLista() {
    try { setLista(await pedir("/escalas", token)); }
    catch (e) { setErro(e.message); }
  }
  useEffect(() => { carregarLista(); }, [token]);

  if (aberta) {
    return (
      <Detalhe token={token} id={aberta} podeEditar={podeEditar}
        pedir={pedir} gravar={gravar}
        aoVoltar={() => { setAberta(null); carregarLista(); }} />
    );
  }

  return (
    <div className="space-y-4">
      <Nova token={token} podeEditar={podeEditar} gravar={gravar}
        aoCriar={(e) => { carregarLista(); setAberta(e.id); }} />

      {erro && <p className="text-[13px] text-rose-600">{erro}</p>}
      {!lista && <p className="text-sm text-slate-400">Carregando…</p>}

      {lista && lista.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
          <p className="text-[13px] text-slate-500">
            Nenhuma escala ainda. A primeira publicada vira a Escala 001 do ano.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {(lista || []).map((e) => (
          <button key={e.id} onClick={() => setAberta(e.id)}
            className="w-full text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-400">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <p className="text-[14px] font-semibold">
                  {e.numero ? `Escala ${String(e.numero).padStart(3, "0")}/${e.ano}` : "Rascunho sem número"}
                  {e.titulo && <span className="font-normal text-slate-600"> · {e.titulo}</span>}
                </p>
                <p className="text-[12px] text-slate-600 mt-0.5">
                  {dataBR(e.periodo_inicio)} a {dataBR(e.periodo_fim)} ·{" "}
                  {e.pessoas} {e.pessoas === 1 ? "pessoa" : "pessoas"} · {e.dias_pessoa} dias-pessoa
                  {e.destinos > 0 && ` · ${e.destinos} destinos`}
                </p>
                {e.publicada_em && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    publicada em {horaBR(e.publicada_em)} por {e.publicada_por}
                  </p>
                )}
                {e.retifica_numero && (
                  <p className="text-[11px] text-sky-700 mt-0.5">
                    retifica a Escala {String(e.retifica_numero).padStart(3, "0")}/{e.retifica_ano}
                  </p>
                )}
                {e.retificacoes > 0 && (
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    esta escala foi retificada {e.retificacoes === 1 ? "uma vez" : `${e.retificacoes} vezes`}
                  </p>
                )}
                {e.motivo_cancelamento && (
                  <p className="text-[11px] text-slate-500 mt-0.5 italic">"{e.motivo_cancelamento}"</p>
                )}
              </div>
              <Selo status={e.status} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
function Nova({ token, podeEditar, gravar, aoCriar }) {
  const seg = proximaSegunda();
  const [aberto, setAberto] = useState(false);
  const [inicio, setInicio] = useState(iso(seg));
  const [fim, setFim] = useState(somaDias(iso(seg), 4));
  const [titulo, setTitulo] = useState("");
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);

  if (!podeEditar) return null;

  async function criar() {
    setCriando(true); setErro("");
    try {
      const e = await gravar("/escalas", token,
        { periodo_inicio: inicio, periodo_fim: fim, titulo }, "POST");
      setAberto(false); setTitulo(""); aoCriar(e);
    } catch (e) { setErro(e.message); } finally { setCriando(false); }
  }

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="w-full bg-slate-900 text-white rounded-xl py-3 text-[14px] font-medium">
        Nova escala
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[13px] font-medium mb-3">Período da escala</p>
      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <p className="text-[11px] text-slate-500 mb-1">Começa</p>
          <input type="date" value={inicio}
            onChange={(e) => { setInicio(e.target.value); setFim(somaDias(e.target.value, 4)); }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-1">Termina</p>
          <input type="date" value={fim} min={inicio}
            onChange={(e) => setFim(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-1">Título (opcional)</p>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: rodízio de setembro"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        O padrão é a próxima segunda a sexta. O rascunho não recebe número —
        ele só vira documento na publicação.
      </p>
      {erro && <p className="text-[12px] text-rose-600 mt-2">{erro}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={criar} disabled={criando}
          className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[13px] font-medium disabled:opacity-50">
          {criando ? "Abrindo…" : "Abrir rascunho"}
        </button>
        <button onClick={() => setAberto(false)}
          className="border border-slate-200 rounded-lg px-4 py-2 text-[13px] text-slate-600">
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
function Detalhe({ token, id, podeEditar, pedir, gravar, aoVoltar }) {
  const [e, setE] = useState(null);
  const [erro, setErro] = useState("");
  const [candidatos, setCandidatos] = useState(null);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const [cancelando, setCancelando] = useState(false);

  async function carregar() {
    try { setE(await pedir(`/escalas/${id}`, token)); }
    catch (err) { setErro(err.message); }
  }
  useEffect(() => { carregar(); }, [id, token]);

  useEffect(() => {
    if (e?.status === "rascunho" && !candidatos) {
      pedir("/escalas/candidatos", token).then(setCandidatos).catch(() => setCandidatos([]));
    }
  }, [e, candidatos, token]);

  const jaNaEscala = useMemo(
    () => new Set((e?.itens || []).map((i) => i.trabalhador_codigo)), [e]);

  const filtrados = useMemo(() => {
    if (!candidatos) return [];
    const t = busca.trim().toLowerCase();
    return candidatos
      .filter((c) => !jaNaEscala.has(c.codigo))
      .filter((c) => !t || (c.nome || "").toLowerCase().includes(t) || c.codigo.includes(t))
      .slice(0, 60);
  }, [candidatos, busca, jaNaEscala]);

  async function remover(itemId) {
    setErro("");
    try { await gravar(`/escalas/${id}/itens/${itemId}`, token, {}, "DELETE"); await carregar(); }
    catch (err) { setErro(err.message); }
  }

  async function publicar() {
    setErro("");
    try { await gravar(`/escalas/${id}/publicar`, token, {}, "POST"); setConfirmar(false); await carregar(); }
    catch (err) { setErro(err.message); setConfirmar(false); }
  }

  async function cancelar() {
    setCancelando(true); setErro("");
    try {
      await gravar(`/escalas/${id}/cancelar`, token, { motivo: motivoCancelar }, "POST");
      setMotivoCancelar(""); await carregar();
    } catch (err) { setErro(err.message); } finally { setCancelando(false); }
  }

  async function descartar() {
    setErro("");
    try { await gravar(`/escalas/${id}`, token, {}, "DELETE"); aoVoltar(); }
    catch (err) { setErro(err.message); }
  }

  if (!e) return <p className="text-sm text-slate-400">Carregando…</p>;

  const rascunho = e.status === "rascunho";
  const titulo = e.numero
    ? `Escala ${String(e.numero).padStart(3, "0")}/${e.ano}`
    : "Rascunho";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={aoVoltar} className="text-[13px] text-slate-600 underline">← Escalas</button>
        <span className="text-sm font-medium">{titulo}</span>
        <Selo status={e.status} />
        <span className="text-[12px] text-slate-500">
          {dataBR(e.periodo_inicio)} a {dataBR(e.periodo_fim)}
        </span>
      </div>

      {erro && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
          <p className="text-[13px] text-rose-700">{erro}</p>
        </div>
      )}

      {/* ---------- cabeçalho do documento publicado ---------- */}
      {!rascunho && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[13px] font-medium">{titulo}{e.titulo ? ` · ${e.titulo}` : ""}</p>
          <p className="text-[12px] text-slate-600 mt-1">
            {e.pessoas} {e.pessoas === 1 ? "pessoa" : "pessoas"} · {e.dias_pessoa} dias-pessoa ·{" "}
            {e.destinos} {e.destinos === 1 ? "destino" : "destinos"}
          </p>
          {e.publicada_em && (
            <p className="text-[12px] text-slate-600 mt-1">
              Publicada em <b>{horaBR(e.publicada_em)}</b> por <b>{e.publicada_por}</b>
            </p>
          )}
          {e.hash_publicacao && (
            <p className="text-[10.5px] text-slate-400 mt-1 break-all">
              impressão digital {e.hash_publicacao}
            </p>
          )}
          {e.status === "cancelada" && (
            <p className="text-[12px] text-rose-700 mt-2">
              Cancelada em {horaBR(e.cancelada_em)} por {e.cancelada_por} — "{e.motivo_cancelamento}"
            </p>
          )}
          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            Escala publicada não se altera. Se algo precisar mudar, publique uma retificação:
            uma escala nova apontando para esta. As duas ficam no arquivo, e é isso que mostra
            que houve correção em vez de o documento simplesmente ter mudado.
          </p>
        </div>
      )}

      {/* ---------- as linhas ---------- */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-[13px] font-medium">
            Quem vai rodar · {e.itens?.length || 0}
          </p>
          {rascunho && (
            <p className="text-[11px] text-slate-500">{e.dias_pessoa} dias-pessoa</p>
          )}
        </div>

        {(!e.itens || e.itens.length === 0) ? (
          <p className="px-4 py-6 text-[13px] text-slate-500 text-center">
            Nenhuma pessoa ainda. Escolha da fila ao lado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Código</th>
                  <th className="text-left px-3 py-2">Nome</th>
                  <th className="text-left px-3 py-2">Sai de</th>
                  <th className="text-left px-3 py-2">Vai para</th>
                  <th className="text-left px-3 py-2">Movimento</th>
                  <th className="text-left px-3 py-2">Período</th>
                  <th className="text-right px-3 py-2">Dias</th>
                  {rascunho && podeEditar && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {e.itens.map((i) => (
                  <tr key={i.id} className="border-t border-slate-50">
                    <td className="px-3 py-2 font-medium">{i.trabalhador_codigo}</td>
                    <td className="px-3 py-2">{i.trabalhador_nome || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {i.origem_local || "—"}
                      {i.origem_cidade && <span className="text-slate-400"> · {i.origem_cidade}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <b>{i.destino_codigo}</b> {i.destino_nome}
                      {i.destino_cidade && <span className="text-slate-400 block">{i.destino_cidade}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] ${
                        i.tipo_movimento === "outro setor, mesmo local" ? "text-teal-700"
                        : i.tipo_movimento === "outro local, mesma cidade" ? "text-sky-700"
                        : "text-amber-700"}`}>{i.tipo_movimento}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {dataBR(i.data_inicio)} a {dataBR(i.data_fim)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.dias}</td>
                    {rascunho && podeEditar && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => remover(i.id)}
                          className="text-[11px] text-rose-600 underline">tirar</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- montagem ---------- */}
      {rascunho && podeEditar && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[13px] font-medium">Fila de quem precisa rodar</p>
          <p className="text-[11px] text-slate-500 mt-1 mb-3">
            Na ordem de quem está há mais tempo sem sair da unidade-base. Este é o primeiro
            critério, e é ele que sustenta a escala perante o fiscal.
          </p>
          <input value={busca} onChange={(ev) => setBusca(ev.target.value)}
            placeholder="Buscar nome ou código…"
            className="w-full sm:w-72 border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-3" />

          {!candidatos && <p className="text-[13px] text-slate-400">Carregando a fila…</p>}

          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {filtrados.map((c) => (
              <div key={c.codigo}>
                <button onClick={() => setEscolhido(escolhido?.codigo === c.codigo ? null : c)}
                  className={`w-full text-left rounded-lg border p-2.5 ${
                    escolhido?.codigo === c.codigo
                      ? "border-teal-500 bg-teal-50"
                      : "border-slate-200 hover:border-slate-400"}`}>
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-[13px]">
                        <b>{c.codigo}</b> {c.nome || <span className="text-amber-700">sem cadastro no MMG+</span>}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {c.local_base} {c.cidade && `· ${c.cidade}`}
                      </p>
                    </div>
                    <div className="text-right text-[11px] text-slate-500">
                      <p>saiu {c.dias_fora} dias em 12 meses</p>
                      <p className="text-amber-700">faltam {c.falta}</p>
                    </div>
                  </div>
                  {c.ja_escalado_em && (
                    <p className="text-[10.5px] text-rose-600 mt-1">
                      já está numa escala publicada a partir de {dataBR(c.ja_escalado_em)}
                    </p>
                  )}
                </button>

                {escolhido?.codigo === c.codigo && (
                  <Destinos token={token} escala={e} candidato={c}
                    pedir={pedir} gravar={gravar}
                    aoIncluir={async () => { setEscolhido(null); await carregar(); }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- publicar ---------- */}
      {rascunho && podeEditar && (
        <div className="bg-slate-900 text-white rounded-xl p-4">
          {!confirmar ? (
            <>
              <p className="text-[13px] font-medium text-teal-300">Publicar</p>
              <p className="text-[12px] text-slate-300 mt-1 leading-relaxed">
                A publicação dá número à escala e grava a hora e o seu nome. Depois disso ela
                não pode mais ser alterada — é isso que a torna prova do cumprimento do rodízio.
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                <button onClick={() => setConfirmar(true)} disabled={!e.itens?.length}
                  className="bg-teal-600 rounded-lg px-4 py-2 text-[13px] font-medium disabled:opacity-40">
                  Publicar escala
                </button>
                <button onClick={descartar}
                  className="border border-slate-700 rounded-lg px-4 py-2 text-[13px] text-slate-300">
                  Descartar rascunho
                </button>
              </div>
              {!e.itens?.length && (
                <p className="text-[11px] text-slate-400 mt-2">
                  Inclua ao menos uma pessoa antes de publicar.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-amber-300">Confirma?</p>
              <p className="text-[12px] text-slate-300 mt-1 leading-relaxed">
                Vai publicar {e.itens.length} {e.itens.length === 1 ? "pessoa" : "pessoas"} de{" "}
                {dataBR(e.periodo_inicio)} a {dataBR(e.periodo_fim)}. Depois de publicada, correção
                só por retificação.
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={publicar}
                  className="bg-teal-600 rounded-lg px-4 py-2 text-[13px] font-medium">
                  Sim, publicar
                </button>
                <button onClick={() => setConfirmar(false)}
                  className="border border-slate-700 rounded-lg px-4 py-2 text-[13px] text-slate-300">
                  Voltar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- cancelar publicada ---------- */}
      {e.status === "publicada" && podeEditar && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[13px] font-medium">Cancelar esta escala</p>
          <p className="text-[11px] text-slate-500 mt-1 mb-2">
            O cancelamento não apaga nada: a escala continua no arquivo, marcada como cancelada,
            com o motivo e o seu nome.
          </p>
          <div className="flex gap-2 flex-wrap">
            <input value={motivoCancelar} onChange={(ev) => setMotivoCancelar(ev.target.value)}
              placeholder="Motivo do cancelamento"
              className="flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
            <button onClick={cancelar} disabled={motivoCancelar.trim().length < 5 || cancelando}
              className="border border-rose-200 text-rose-700 rounded-lg px-4 py-2 text-[13px] disabled:opacity-40">
              {cancelando ? "…" : "Cancelar escala"}
            </button>
          </div>
        </div>
      )}

      {/* ---------- trilha ---------- */}
      {e.eventos?.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[13px] font-medium mb-2">O que aconteceu com esta escala</p>
          <div className="space-y-1">
            {e.eventos.map((ev, n) => (
              <p key={n} className="text-[11.5px] text-slate-600">
                <span className="text-slate-400">{horaBR(ev.quando)}</span> · {ev.descricao || ev.tipo}
                {ev.quem && <span className="text-slate-400"> · {ev.quem}</span>}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
function Destinos({ token, escala, candidato, pedir, gravar, aoIncluir }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [destino, setDestino] = useState(null);
  const [inicio, setInicio] = useState(String(escala.periodo_inicio).slice(0, 10));
  const [fim, setFim] = useState(String(escala.periodo_fim).slice(0, 10));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!candidato.local_base_id) { setLista([]); return; }
    pedir(`/escalas/destinos/${candidato.local_base_id}`, token)
      .then(setLista).catch((e) => { setErro(e.message); setLista([]); });
  }, [candidato.local_base_id, token]);

  const dias = diasEntre(inicio, fim);

  async function incluir() {
    setSalvando(true); setErro("");
    try {
      await gravar(`/escalas/${escala.id}/itens`, token, {
        trabalhador_id: candidato.trabalhador_id,
        origem_local_id: candidato.local_base_id,
        destino_unidade_id: destino.id,
        data_inicio: inicio,
        data_fim: fim,
      }, "POST");
      await aoIncluir();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  const porNivel = { 1: [], 2: [], 3: [] };
  (lista || []).forEach((d) => porNivel[d.nivel]?.push(d));
  const rotulos = {
    1: "No mesmo local, outro setor — sem deslocamento",
    2: "Outro local, mesma cidade",
    3: "Outra cidade — exige transporte",
  };

  return (
    <div className="mt-1.5 ml-2 border-l-2 border-teal-200 pl-3 pb-2">
      {!lista && <p className="text-[12px] text-slate-400">Procurando destinos…</p>}
      {lista && lista.length === 0 && (
        <p className="text-[12px] text-rose-600">
          Nenhuma unidade viva serve de destino para esta pessoa hoje.
        </p>
      )}

      {[1, 2, 3].map((n) => porNivel[n].length > 0 && (
        <div key={n} className="mb-2">
          <p className="text-[10.5px] text-slate-500 uppercase tracking-wide mb-1">{rotulos[n]}</p>
          <div className="flex flex-wrap gap-1.5">
            {porNivel[n].slice(0, 12).map((d) => (
              <button key={d.id} onClick={() => setDestino(d)}
                className={`text-left rounded-lg border px-2.5 py-1.5 text-[11.5px] ${
                  destino?.id === d.id
                    ? "bg-teal-600 text-white border-teal-600"
                    : "bg-white border-slate-200 hover:border-slate-400"}`}>
                <b>{d.codigo}</b> {d.setor || d.nome_completo}
                <span className={`block text-[10px] ${destino?.id === d.id ? "text-teal-100" : "text-slate-500"}`}>
                  {d.cidade || "—"}
                  {d.km != null && ` · ${Math.round(d.km)} km${d.km_aproximado ? " aprox." : ""}`}
                  {d.gente_no_mes > 0 && ` · ${d.gente_no_mes} pessoas no mês`}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {destino && (
        <div className="mt-2 bg-slate-50 rounded-lg p-3">
          <div className="flex gap-2 flex-wrap items-end">
            <div>
              <p className="text-[10.5px] text-slate-500 mb-1">De</p>
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px]" />
            </div>
            <div>
              <p className="text-[10.5px] text-slate-500 mb-1">Até</p>
              <input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px]" />
            </div>
            <button onClick={incluir} disabled={salvando || dias < 1 || dias > DIAS_POR_MES}
              className="bg-teal-600 text-white rounded-lg px-4 py-2 text-[12.5px] font-medium disabled:opacity-40">
              {salvando ? "…" : `Incluir · ${dias} ${dias === 1 ? "dia" : "dias"}`}
            </button>
          </div>
          {dias > DIAS_POR_MES && (
            <p className="text-[11px] text-rose-600 mt-1.5">
              O bloco vai de segunda a sexta, no máximo {DIAS_POR_MES} dias. Este tem {dias}.
            </p>
          )}
        </div>
      )}

      {erro && <p className="text-[11.5px] text-rose-600 mt-1.5">{erro}</p>}
    </div>
  );
}
