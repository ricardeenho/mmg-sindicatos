import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

/* ------------------------------------------------------------------ */
/*  chamadas                                                           */
/* ------------------------------------------------------------------ */
async function pedir(caminho, token) {
  const r = await fetch(API + caminho, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error((await r.json()).error || "Falha na consulta");
  return r.json();
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
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
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
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

        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-2"
          placeholder="Usuário" value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-4"
          placeholder="Senha" type="password" value={senha}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />

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
/*  peças                                                              */
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
  const max = Math.max(...dados.map((d) => d.pessoas));
  const ultimos = dados.slice(-24);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-medium">Efetivo por mês</p>
      <p className="text-[11px] text-slate-500 mt-1 mb-3">
        Âmbar é safra pelo calendário regional; verde é entressafra, quando o rodízio pode acontecer.
      </p>
      <div className="flex items-end gap-[2px] h-32">
        {ultimos.map((d) => (
          <div key={d.competencia} className="flex-1 group relative">
            <div
              className={`w-full rounded-sm ${d.em_safra ? "bg-amber-400" : "bg-teal-500"}`}
              style={{ height: `${Math.max(3, (d.pessoas / max) * 124)}px` }}
            />
            <span className="hidden group-hover:block absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
              {d.competencia}: {d.pessoas}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{ultimos[0]?.competencia}</span>
        <span>{ultimos[ultimos.length - 1]?.competencia}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Painel                                                             */
/* ------------------------------------------------------------------ */
function Painel({ token, sair }) {
  const [resumo, setResumo] = useState(null);
  const [curva, setCurva] = useState([]);
  const [locais, setLocais] = useState([]);
  const [fila, setFila] = useState([]);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("painel");

  useEffect(() => {
    Promise.all([
      pedir("/painel/resumo", token),
      pedir("/painel/curva", token),
      pedir("/painel/locais", token),
      pedir("/painel/fila?limite=200", token),
    ])
      .then(([r, c, l, f]) => { setResumo(r); setCurva(c); setLocais(l); setFila(f); })
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

  if (!resumo) return (
    <div className="min-h-screen grid place-items-center text-slate-400 text-sm">Carregando…</div>
  );

  const n = (chave, lista) => lista.find((x) => x[Object.keys(x)[0]] === chave)?.pessoas || 0;
  const perfil = (p) => resumo.perfis.find((x) => x.perfil === p)?.pessoas || 0;
  const sit = (s) => resumo.situacoes.find((x) => x.situacao === s)?.pessoas || 0;
  const j = resumo.janela;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-slate-900 text-white px-4 py-3 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
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

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">

        <div className="flex gap-1.5">
          {[["painel","Painel"],["locais","Locais"],["fila","Fila"]].map(([k, rot]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium ${
                aba === k ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
              {rot}
            </button>
          ))}
        </div>

        {aba === "painel" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Cartao rotulo="Cadastrados" valor={resumo.base.cadastrados}
                      sub={`${resumo.base.locais} locais · ${resumo.base.unidades} unidades`} />
              <Cartao rotulo="Obrigados ao rodízio" valor={perfil("permanente")}
                      sub="30+ dias de entressafra" />
              <Cartao rotulo="Precisam rodar" valor={sit("Precisa rodar")}
                      cor="text-amber-600" sub={`${resumo.pendencia.dias_a_cumprir} dias-pessoa`} />
              <Cartao rotulo="Já em dia" valor={sit("Em dia")} cor="text-emerald-600"
                      sub="cumprem sem intervenção" />
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
                <b className="text-white">{resumo.fixos.pessoas} pessoas</b> passaram 95% ou mais dos
                dias no mesmo local, estão obrigadas ao rodízio e seguem ativas. Somam{" "}
                <b className="text-white">{resumo.fixos.dias_a_cumprir} dias-pessoa</b> a cumprir.
              </p>
            </div>
          </>
        )}

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
