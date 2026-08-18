import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

async function pedir(caminho, token) {
  const r = await fetch(API + caminho, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json()).error || "Falha na consulta");
  return r.json();
}
async function gravar(caminho, token, corpo, metodo = "PUT") {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error((await r.json()).error || "Falha ao gravar");
  return r.json();
}

/* ------------------------------------------------------------------ */
function Login({ aoEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar() {
    setErro(""); setCarregando(true);
    try {
      const r = await fetch(API + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha }),
      });
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.error);
      localStorage.setItem("token", dados.token);
      aoEntrar(dados.token);
    } catch (e) { setErro(e.message); } finally { setCarregando(false); }
  }

  return (
    <div className="min-h-screen bg-slate-900 grid place-items-center px-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-10 h-10 rounded-xl bg-teal-500 grid place-items-center text-white font-bold">M+</span>
          <div>
            <h1 className="font-semibold text-slate-900">MMG Sindicatos</h1>
            <p className="text-xs text-slate-500">Módulo Rodízio</p>
          </div>
        </div>
        <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-2"
          placeholder="Usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()} />
        <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-4"
          placeholder="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()} />
        {erro && <p className="text-[12px] text-rose-600 mb-3">{erro}</p>}
        <button onClick={entrar} disabled={carregando}
          className="w-full bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const Cartao = ({ rotulo, valor, sub, cor = "text-slate-900" }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4">
    <p className="text-xs text-slate-500">{rotulo}</p>
    <p className={`text-3xl font-semibold mt-1 tabular-nums ${cor}`}>{valor}</p>
    {sub && <p className="text-[11px] text-slate-500 mt-1">{sub}</p>}
  </div>
);

function Curva({ dados }) {
  if (!dados?.length) return null;
  const ultimos = dados.slice(-24);
  const max = Math.max(...ultimos.map((d) => d.pessoas));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-medium">Efetivo por mês</p>
      <p className="text-[11px] text-slate-500 mt-1 mb-3">
        Âmbar é safra pelo calendário do sindicato; verde é entressafra, quando o rodízio pode acontecer.
      </p>
      <div className="flex items-end gap-[2px] h-32">
        {ultimos.map((d) => (
          <div key={d.competencia} className="flex-1 group relative">
            <div className={`w-full rounded-sm ${d.em_safra ? "bg-amber-400" : "bg-teal-500"}`}
                 style={{ height: `${Math.max(3, (d.pessoas / max) * 124)}px` }} />
            <span className="hidden group-hover:block absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
              {d.competencia}: {d.pessoas}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1">
        {ultimos.map((d) => {
          const [ano, mes] = d.competencia.split("-");
          const m = parseInt(mes) - 1;
          return (
            <span key={d.competencia} className="flex-1 text-center text-[8px] text-slate-400 leading-tight">
              {MESES[m]}
              {m === 0 && <span className="block text-[7px] text-slate-500 font-medium">{ano.slice(2)}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Safra({ token }) {
  const [dados, setDados] = useState(null);
  const [meses, setMeses] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    pedir("/painel/safra", token).then((d) => {
      setDados(d);
      setMeses(d.meses.filter((m) => m.em_safra).map((m) => m.mes));
    });
  }, [token]);

  if (!dados) return <p className="text-sm text-slate-400">Carregando…</p>;

  const alternar = (m) =>
    setMeses((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m].sort((a, b) => a - b)));

  async function salvar() {
    setSalvando(true); setAviso("");
    try {
      await gravar("/painel/safra", token, { meses });
      const d = await pedir("/painel/safra", token);
      setDados(d);
      setAviso("Calendário gravado. O painel já usa a janela nova.");
    } catch (e) { setAviso(e.message); } finally { setSalvando(false); }
  }

  const max = Math.max(...dados.meses.map((m) => m.media_pessoas));
  const divergentes = dados.meses.filter(
    (m) => meses.includes(m.mes) !== m.acima_da_media
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-medium">Janelas de safra e entressafra</p>
        <p className="text-[11px] text-slate-500 mt-1">
          Marque os meses de safra do sindicato. O rodízio só é exigido nos meses não marcados.
          A barra mostra o efetivo médio de cada mês — é a curva do seu próprio Ponto, e serve
          para conferir se o que foi declarado bate com o que acontece.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-6 md:grid-cols-12 gap-1.5 mb-4">
          {dados.meses.map((m) => {
            const marcado = meses.includes(m.mes);
            const diverge = marcado !== m.acima_da_media;
            return (
              <button key={m.mes} onClick={() => alternar(m.mes)}
                className={`rounded-lg py-2 text-[12px] font-medium border transition ${
                  marcado ? "bg-amber-400 border-amber-500 text-amber-950"
                          : "bg-teal-50 border-teal-200 text-teal-800"}`}>
                {MESES[m.mes - 1]}
                {diverge && <span className="block text-[9px] text-rose-600">confira</span>}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-500 mb-2">
          Efetivo médio por mês · média geral {dados.media} pessoas
        </p>
        <div className="flex items-end gap-1 h-24">
          {dados.meses.map((m) => (
            <div key={m.mes} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full rounded-sm ${meses.includes(m.mes) ? "bg-amber-400" : "bg-teal-500"}`}
                   style={{ height: `${Math.max(3, (m.media_pessoas / max) * 76)}px` }} />
              <span className="text-[9px] text-slate-400">{m.media_pessoas}</span>
            </div>
          ))}
        </div>

        {divergentes.length > 0 && (
          <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-[12px] font-medium text-rose-800">
              {divergentes.length} {divergentes.length === 1 ? "mês diverge" : "meses divergem"} da curva
            </p>
            <p className="text-[11px] text-rose-700 mt-1">
              {divergentes.map((m) => MESES[m.mes - 1]).join(", ")} — o que foi marcado não bate com o
              movimento observado. Não é erro por si só, mas é o primeiro ponto que um fiscal vai olhar.
            </p>
          </div>
        )}

        <button onClick={salvar} disabled={salvando}
          className="w-full mt-4 bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
          {salvando ? "Gravando…" : "Gravar calendário"}
        </button>
        {aviso && <p className="text-[12px] text-slate-600 mt-2 text-center">{aviso}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Painel({ token, sair }) {
  const [resumo, setResumo] = useState(null);
  const [curva, setCurva] = useState([]);
  const [locais, setLocais] = useState([]);
  const [fila, setFila] = useState([]);
  const [semCadastro, setSemCadastro] = useState([]);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("painel");

  useEffect(() => {
    Promise.all([
      pedir("/painel/resumo", token),
      pedir("/painel/curva", token),
      pedir("/painel/locais", token),
      pedir("/painel/fila?limite=200", token),
      pedir("/painel/sem-cadastro", token),
    ])
      .then(([r, c, l, f, s]) => { setResumo(r); setCurva(c); setLocais(l); setFila(f); setSemCadastro(s); })
      .catch((e) => setErro(e.message));
  }, [token]);

  if (erro) return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="text-center">
        <p className="text-rose-600 text-sm mb-3">{erro}</p>
        <button onClick={sair} className="text-sm text-slate-600 underline">Entrar de novo</button>
      </div>
    </div>
  );
  if (!resumo) return <div className="min-h-screen grid place-items-center text-slate-400 text-sm">Carregando…</div>;

  const perfil = (p) => resumo.perfis.find((x) => x.perfil === p)?.pessoas || 0;
  const sit = (s) => resumo.situacoes.find((x) => x.situacao === s)?.pessoas || 0;
  const j = resumo.janela;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-slate-900 text-white px-4 py-3 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-teal-500 grid place-items-center text-sm font-bold">M+</span>
          <div className="flex-1">
            <h1 className="text-sm font-semibold leading-tight">Rodízio</h1>
            <p className="text-[11px] text-slate-400 leading-tight">
              Janela de {new Date(j.janela_inicio).toLocaleDateString("pt-BR")} a{" "}
              {new Date(j.janela_fim).toLocaleDateString("pt-BR")} · {j.percentual}% da entressafra
            </p>
          </div>
          <button onClick={sair} className="text-[11px] text-slate-400 hover:text-white">Sair</button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-1.5 flex-wrap">
          {[["painel","Painel"],["safra","Safra"],["locais","Locais"],["fila","Fila"],["cadastro","Sem cadastro"]]
            .map(([k, rot]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium ${
                aba === k ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
              {rot}
              {k === "cadastro" && semCadastro.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-amber-400 text-amber-950 rounded px-1">
                  {semCadastro.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {aba === "painel" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Cartao rotulo="Cadastrados" valor={resumo.base.cadastrados}
                      sub={`${resumo.base.locais} locais · ${resumo.base.unidades} unidades`} />
              <Cartao rotulo="Obrigados ao rodízio" valor={perfil("permanente")} sub="30+ dias de entressafra" />
              <Cartao rotulo="Precisam rodar" valor={sit("Precisa rodar")} cor="text-amber-600"
                      sub={`${resumo.pendencia.dias_a_cumprir} dias-pessoa`} />
              <Cartao rotulo="Já em dia" valor={sit("Em dia")} cor="text-emerald-600" sub="cumprem sem intervenção" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Cartao rotulo="Safristas" valor={perfil("safrista")} sub="fora da obrigação" />
              <Cartao rotulo="Isentos" valor={perfil("isento")} sub={`menos de ${j.isencao_dias} dias`} />
              <Cartao rotulo="Sem movimento" valor={sit("Sem movimento")} sub="há mais de 60 dias" />
            </div>

            <Curva dados={curva} />

            <div className="bg-slate-900 text-white rounded-xl p-4">
              <p className="text-[13px] font-medium text-teal-300">Fila de regularização</p>
              <p className="text-[12.5px] mt-2 leading-relaxed text-slate-200">
                <b className="text-white">{resumo.fixos.pessoas} pessoas</b> passaram 95% ou mais dos dias
                no mesmo local, estão obrigadas ao rodízio e seguem ativas. Somam{" "}
                <b className="text-white">{resumo.fixos.dias_a_cumprir} dias-pessoa</b> a cumprir.
              </p>
            </div>
          </>
        )}

        {aba === "safra" && <Safra token={token} />}

        {aba === "locais" && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-medium text-slate-600">
              Onde a fila se concentra · {locais.length} locais
            </div>
            {locais.map((l) => (
              <div key={l.local_base} className="px-4 py-3 border-b border-slate-50 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{l.local_base}</p>
                  <p className="text-[11px] text-slate-500">
                    {l.setores} {l.setores === 1 ? "setor" : "setores"}
                    {l.setores === 1 && <span className="text-rose-600"> · precisa sair do local</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{l.pessoas}</p>
                  <p className="text-[11px] text-slate-400">{l.dias_a_cumprir} dias</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {aba === "fila" && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-medium text-slate-600">
              {fila.length} pessoas · ordenadas por dias trabalhados
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">Código</th>
                    <th className="text-left px-3 py-2">Nome</th>
                    <th className="text-left px-3 py-2">Local</th>
                    <th className="text-right px-3 py-2">Dias</th>
                    <th className="text-right px-3 py-2">Entressafra</th>
                    <th className="text-right px-3 py-2">Fora</th>
                    <th className="text-right px-3 py-2">Meta</th>
                    <th className="text-right px-3 py-2">Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {fila.map((t) => (
                    <tr key={t.codigo} className="border-t border-slate-50">
                      <td className="px-3 py-2 font-medium">{t.codigo}</td>
                      <td className="px-3 py-2">
                        {t.nome || <span className="text-amber-700 text-[11px]">sem cadastro no MMG+</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{t.local_base}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.dias}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_entressafra}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.dias_fora}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.meta}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        t.falta > 0 ? "text-amber-600" : "text-emerald-600"}`}>{t.falta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {aba === "cadastro" && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium">{semCadastro.length} sem cadastro no MMG+</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Estas pessoas trabalharam e aparecem no Ponto, mas não têm cadastro no MMG+.
                O nome não se edita aqui de propósito: a fonte é o MMG+. Cadastre lá e o nome
                entra na próxima carga.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Código</th>
                      <th className="text-right px-3 py-2">Dias trabalhados</th>
                      <th className="text-left px-3 py-2">Primeiro dia</th>
                      <th className="text-left px-3 py-2">Último dia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semCadastro.map((t) => (
                      <tr key={t.codigo} className="border-t border-slate-50">
                        <td className="px-3 py-2 font-medium">{t.codigo}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.dias}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {t.primeiro_dia && new Date(t.primeiro_dia).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {t.ultimo_dia && new Date(t.ultimo_dia).toLocaleDateString("pt-BR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <p className="text-[11px] text-slate-400 text-center pt-2">
          Meia diária conta como um dia. Um dia de rodízio por data, no máximo.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  function sair() { localStorage.removeItem("token"); setToken(null); }
  return token ? <Painel token={token} sair={sair} /> : <Login aoEntrar={setToken} />;
}
