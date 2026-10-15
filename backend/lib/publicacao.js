/* 14/10/2026 — PUBLICAÇÃO
   Gera, a partir de uma escala já PUBLICADA, o pacote de divulgação:
     1 - Escala Geral              um PDF com todos os nomes;
     2 - Escalas por Empresa       um PDF por empresa, com código, nome e
                                   a unidade/setor onde cada um está;
     3 - Escalas por Unidade       um PDF por unidade/setor, para o mural.
   Tudo sai em um .zip. Nada aqui lê o banco nem muda a escala: recebe as
   linhas prontas e devolve o arquivo. O .zip é montado à mão (sem
   compressão), porque os PDFs já são comprimidos por dentro. */

const PDFDocument = require('pdfkit');

const COR = { tinta: '#0f172a', suave: '#64748b', linha: '#e2e8f0', zebra: '#f8fafc', marca: '#0f766e', marcaClara: '#ccfbf1' };

const dataBR = (d) => { const [a, m, x] = String(d).slice(0, 10).split('-'); return `${x}/${m}/${a}`; };
const diaMes = (d) => dataBR(d).slice(0, 5);
const diasEntre = (a, b) => Math.round((new Date(`${String(b).slice(0, 10)}T12:00:00Z`) - new Date(`${String(a).slice(0, 10)}T12:00:00Z`)) / 86400000) + 1;
const periodoTxt = (l) => (String(l.data_inicio).slice(0, 10) === String(l.data_fim).slice(0, 10)
  ? dataBR(l.data_inicio) : `${diaMes(l.data_inicio)} a ${dataBR(l.data_fim)}`);
const nomeDe = (l) => l.nome || '(sem nome)';
const horaBR = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/* ordem alfabética; quem está sem nome vai para o fim da lista */
const porNome = (a, b) => (!a.nome - !b.nome) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR') || String(a.codigo).localeCompare(String(b.codigo)) || String(a.data_inicio).localeCompare(String(b.data_inicio));

/* nome de arquivo seguro no Windows, sem perder os acentos */
const arquivoSeguro = (s) => String(s || 'sem nome').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

/* ----------------------------- PDF ------------------------------ */
function novoPdf(meta, { paisagem = false } = {}) {
  const doc = new PDFDocument({ size: 'A4', layout: paisagem ? 'landscape' : 'portrait', margins: { top: 40, bottom: 48, left: 36, right: 36 }, bufferPages: true,
    info: { Title: meta.titulo, Author: 'MMG Sindicatos', Subject: `Escala ${meta.rotulo}` } });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const pronto = new Promise((ok, erro) => { doc.on('end', () => ok(Buffer.concat(partes))); doc.on('error', erro); });
  return { doc, pronto };
}

function cabecalho(doc, meta, titulo, linhas, { grande = false } = {}) {
  const x = doc.page.margins.left, larg = doc.page.width - x - doc.page.margins.right;
  doc.rect(x, 36, larg, 4).fill(COR.marca);
  doc.fillColor(COR.suave).font('Helvetica-Bold').fontSize(8).text('MMG SINDICATOS  ·  ESCALA DO RODÍZIO', x, 48, { characterSpacing: 1 });
  doc.fillColor(COR.tinta).font('Helvetica-Bold').fontSize(grande ? 26 : 19).text(titulo, x, 62, { width: larg });
  let y = doc.y + 2;
  doc.font('Helvetica').fontSize(grande ? 12 : 10);
  for (const t of linhas) { doc.fillColor(COR.suave).text(t, x, y, { width: larg }); y = doc.y + 1; }
  return y + 8;
}

/* tabela com cabeçalho que se repete; devolve o y final */
function tabela(doc, y, cols, linhas, { fonte = 9, altura = 18 } = {}) {
  const x0 = doc.page.margins.left;
  const larg = doc.page.width - x0 - doc.page.margins.right;
  const soma = cols.reduce((s, c) => s + c.w, 0);
  const cs = cols.map((c) => ({ ...c, w: (c.w / soma) * larg }));
  const limite = () => doc.page.height - doc.page.margins.bottom - 6;
  const cab = (yy) => {
    doc.rect(x0, yy, larg, altura + 2).fill(COR.marcaClara);
    let x = x0;
    doc.fillColor(COR.marca).font('Helvetica-Bold').fontSize(fonte - 0.5);
    for (const c of cs) { doc.text(c.t.toUpperCase(), x + 5, yy + 6, { width: c.w - 10, height: altura, lineBreak: false, align: c.a || 'left', characterSpacing: 0.4 }); x += c.w; }
    return yy + altura + 2;
  };
  y = cab(y);
  linhas.forEach((r, i) => {
    if (y + altura > limite()) { doc.addPage(); y = cab(doc.page.margins.top); }
    if (i % 2) doc.rect(x0, y, larg, altura).fill(COR.zebra);
    let x = x0;
    doc.fillColor(COR.tinta).font('Helvetica').fontSize(fonte);
    r.forEach((v, k) => {
      const c = cs[k];
      doc.font(c.neg ? 'Helvetica-Bold' : 'Helvetica').text(String(v ?? ''), x + 5, y + (altura - fonte) / 2 - 0.5, { width: c.w - 10, height: altura, ellipsis: true, lineBreak: false, align: c.a || 'left' });
      x += c.w;
    });
    doc.moveTo(x0, y + altura).lineTo(x0 + larg, y + altura).lineWidth(0.4).strokeColor(COR.linha).stroke();
    y += altura;
  });
  return y;
}

/* rodapé em todas as páginas, com número e impressão digital */
function rodape(doc, meta) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const x = doc.page.margins.left, larg = doc.page.width - x - doc.page.margins.right;
    const y = doc.page.height - 34;
    doc.moveTo(x, y - 4).lineTo(x + larg, y - 4).lineWidth(0.4).strokeColor(COR.linha).stroke();
    doc.fillColor(COR.suave).font('Helvetica').fontSize(7.5);
    doc.text(`Escala ${meta.rotulo} · publicada em ${horaBR(meta.publicada_em)} por ${meta.publicada_por}${meta.hash ? ` · impressão digital ${String(meta.hash).slice(0, 12)}` : ''}`, x, y, { width: larg - 70, lineBreak: false, height: 10, ellipsis: true });
    doc.text(`página ${i - start + 1} de ${count}`, x, y, { width: larg, align: 'right', lineBreak: false });
  }
}

async function pdfGeral(meta, linhas) {
  const { doc, pronto } = novoPdf({ ...meta, titulo: 'Escala Geral' }, { paisagem: true });
  const pessoas = new Set(linhas.map((l) => l.trabalhador_id)).size;
  let y = cabecalho(doc, meta, 'Escala Geral', [
    `Quinzena de ${dataBR(meta.inicio)} a ${dataBR(meta.fim)}  ·  ${pessoas} trabalhadores  ·  ${linhas.length} linhas`]);
  const rs = [...linhas].sort(porNome).map((l) => [l.codigo, nomeDe(l), l.origem_nome ? `${l.origem_nome}${l.origem_cidade ? ` · ${l.origem_cidade}` : ''}` : '—',
    `${l.ucodigo} ${l.empresa} / ${l.setor || '—'}${l.cidade ? ` · ${l.cidade}` : ''}`, periodoTxt(l), diasEntre(l.data_inicio, l.data_fim)]);
  tabela(doc, y, [{ t: 'Código', w: 7 }, { t: 'Nome', w: 25, neg: true }, { t: 'Sai de', w: 19 }, { t: 'Vai para', w: 38 }, { t: 'Período', w: 15 }, { t: 'Dias', w: 6, a: 'right' }], rs, { fonte: 8.5, altura: 17 });
  rodape(doc, meta); doc.end();
  return pronto;
}

async function pdfEmpresa(meta, emp, linhas) {
  const { doc, pronto } = novoPdf({ ...meta, titulo: `Escala — ${emp.nome}` });
  const pessoas = new Set(linhas.map((l) => l.trabalhador_id)).size;
  let y = cabecalho(doc, meta, emp.nome, [
    `${emp.cidade ? `${emp.cidade}  ·  ` : ''}Quinzena de ${dataBR(meta.inicio)} a ${dataBR(meta.fim)}`,
    `${pessoas} ${pessoas === 1 ? 'trabalhador' : 'trabalhadores'} nesta empresa`]);
  const rs = [...linhas].sort((a, b) => String(a.setor || '').localeCompare(String(b.setor || ''), 'pt-BR') || porNome(a, b))
    .map((l) => [l.codigo, nomeDe(l), `${l.ucodigo} · ${l.setor || '—'}`, periodoTxt(l), diasEntre(l.data_inicio, l.data_fim)]);
  tabela(doc, y, [{ t: 'Código', w: 9.5 }, { t: 'Nome', w: 36.5, neg: true }, { t: 'Unidade / Setor', w: 24 }, { t: 'Período', w: 23 }, { t: 'Dias', w: 7, a: 'right' }], rs, { fonte: 9, altura: 19 });
  rodape(doc, meta); doc.end();
  return pronto;
}

async function pdfUnidade(meta, un, linhas) {
  const { doc, pronto } = novoPdf({ ...meta, titulo: `Escala — ${un.empresa} · ${un.setor || un.ucodigo}` });
  const pessoas = new Set(linhas.map((l) => l.trabalhador_id)).size;
  let y = cabecalho(doc, meta, `${un.empresa}`, [
    `Unidade ${un.ucodigo}  ·  Setor ${un.setor || '—'}${un.cidade ? `  ·  ${un.cidade}` : ''}`,
    `Quinzena de ${dataBR(meta.inicio)} a ${dataBR(meta.fim)}  ·  ${pessoas} ${pessoas === 1 ? 'trabalhador' : 'trabalhadores'}`], { grande: true });
  const rs = [...linhas].sort(porNome).map((l) => [l.codigo, nomeDe(l), periodoTxt(l), diasEntre(l.data_inicio, l.data_fim)]);
  tabela(doc, y + 4, [{ t: 'Código', w: 13 }, { t: 'Nome', w: 54, neg: true }, { t: 'Período', w: 24 }, { t: 'Dias', w: 9, a: 'right' }], rs, { fonte: 12, altura: 26 });
  rodape(doc, meta); doc.end();
  return pronto;
}

/* ----------------------------- ZIP ------------------------------ */
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function montarZip(arquivos) {
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const partes = [], central = [];
  let pos = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8'), crc = crc32(a.dados);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(0, 8);
    loc.writeUInt16LE(hora, 10); loc.writeUInt16LE(data, 12); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(a.dados.length, 18); loc.writeUInt32LE(a.dados.length, 22); loc.writeUInt16LE(nome.length, 26); loc.writeUInt16LE(0, 28);
    partes.push(loc, nome, a.dados);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(hora, 12); cen.writeUInt16LE(data, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(a.dados.length, 20); cen.writeUInt32LE(a.dados.length, 24); cen.writeUInt16LE(nome.length, 28);
    cen.writeUInt32LE(pos, 42);
    central.push(cen, nome);
    pos += 30 + nome.length + a.dados.length;
  }
  const cdTam = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(cdTam, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, ...central, fim]);
}

/* ---------------------------- o pacote --------------------------- */
/* linhas: uma por pessoa/período, já com os nomes (ver a rota). */
async function gerarPublicacao(meta, linhas) {
  const arquivos = [];
  const usados = new Set();
  const unico = (pasta, base) => {
    let nome = `${pasta}/${base}.pdf`, i = 2;
    while (usados.has(nome.toLowerCase())) nome = `${pasta}/${base} (${i++}).pdf`;
    usados.add(nome.toLowerCase());
    return nome;
  };

  arquivos.push({ nome: unico('1 - Escala Geral', `Escala Geral ${meta.rotulo.replace('/', '-')}`), dados: await pdfGeral(meta, linhas) });

  const porEmpresa = new Map(), porUnidade = new Map();
  for (const l of linhas) {
    const ke = l.local_id || `u:${l.unidade_id}`;
    if (!porEmpresa.has(ke)) porEmpresa.set(ke, { emp: { nome: l.empresa, cidade: l.cidade }, linhas: [] });
    porEmpresa.get(ke).linhas.push(l);
    if (!porUnidade.has(l.unidade_id)) porUnidade.set(l.unidade_id, { un: l, linhas: [] });
    porUnidade.get(l.unidade_id).linhas.push(l);
  }

  const emps = [...porEmpresa.values()].sort((a, b) => String(a.emp.nome).localeCompare(String(b.emp.nome), 'pt-BR'));
  for (const e of emps) {
    arquivos.push({ nome: unico('2 - Escalas por Empresa', arquivoSeguro(`${e.emp.nome}${e.emp.cidade ? ` - ${e.emp.cidade}` : ''}`)), dados: await pdfEmpresa(meta, e.emp, e.linhas) });
  }
  const unis = [...porUnidade.values()].sort((a, b) => String(a.un.empresa).localeCompare(String(b.un.empresa), 'pt-BR') || String(a.un.setor || '').localeCompare(String(b.un.setor || ''), 'pt-BR'));
  for (const u of unis) {
    arquivos.push({ nome: unico('3 - Escalas por Unidade', arquivoSeguro(`${u.un.ucodigo} - ${u.un.empresa} - ${u.un.setor || 'sem setor'}`)), dados: await pdfUnidade(meta, u.un, u.linhas) });
  }

  const pessoas = new Set(linhas.map((l) => l.trabalhador_id)).size;
  const leia = [
    `MMG SINDICATOS — PUBLICAÇÃO DA ESCALA ${meta.rotulo}`,
    `Quinzena de ${dataBR(meta.inicio)} a ${dataBR(meta.fim)}`,
    `Publicada em ${horaBR(meta.publicada_em)} por ${meta.publicada_por}`,
    meta.hash ? `Impressão digital da escala: ${meta.hash}` : '',
    '',
    `1 - Escala Geral ........ 1 arquivo, com os ${pessoas} trabalhadores`,
    `2 - Escalas por Empresa . ${emps.length} arquivos, um por empresa`,
    `3 - Escalas por Unidade . ${unis.length} arquivos, um por unidade/setor (para o mural)`,
    '',
    'Todos os arquivos saem da escala oficial publicada; esta pasta não altera a escala.',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\r\n');
  arquivos.push({ nome: 'LEIA-ME.txt', dados: Buffer.from(`﻿${leia}\r\n`, 'utf8') });

  return { zip: montarZip(arquivos), lista: arquivos, empresas: emps.length, unidades: unis.length, pessoas, arquivos: arquivos.length };
}

module.exports = { gerarPublicacao };