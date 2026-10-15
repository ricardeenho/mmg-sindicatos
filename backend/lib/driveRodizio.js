// ============================================================
// MMG Sindicatos | GOOGLE DRIVE (publicação das escalas)
// Salvar como: backend/lib/driveRodizio.js
//
// Usa a MESMA autorização do MMG+ (variáveis GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN). O acesso é do tipo
// drive.file: o sistema só enxerga o que ele mesmo criou. Por isso
// ele cria a própria pasta "Escalas de Rodízio" (a que você criou
// à mão fica invisível para ele).
// ============================================================
const { google } = require('googleapis');
const { Readable } = require('stream');

const RAIZ = 'Escalas de Rodízio';

function credenciaisPresentes() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

function cliente() {
  if (!credenciaisPresentes()) throw new Error('Faltam as variáveis do Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_REFRESH_TOKEN) no Railway.');
  const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth });
}

const seguro = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/* acha a pasta pelo nome dentro do pai; se não existir, cria */
async function pasta(drive, nome, paiId = null) {
  let q = `mimeType = 'application/vnd.google-apps.folder' and name = '${seguro(nome)}' and trashed = false`;
  q += paiId ? ` and '${paiId}' in parents` : ` and 'root' in parents`;
  const { data } = await drive.files.list({ q, fields: 'files(id, name)', pageSize: 5, spaces: 'drive' });
  if (data.files && data.files.length) return data.files[0].id;
  const { data: criada } = await drive.files.create({
    requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: paiId ? [paiId] : undefined },
    fields: 'id',
  });
  return criada.id;
}

/* caminho inteiro, a partir de "Escalas de Rodízio" */
async function pastaCaminho(drive, partes) {
  let id = await pasta(drive, RAIZ, null);
  for (const p of partes) id = await pasta(drive, p, id);
  return id;
}

/* nome -> id dos arquivos que já estão na pasta (para reenviar sem duplicar) */
async function arquivosDaPasta(drive, pastaId) {
  const mapa = new Map();
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${pastaId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name)', pageSize: 1000, pageToken, spaces: 'drive',
    });
    for (const f of data.files || []) mapa.set(f.name, f.id);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return mapa;
}

async function enviar(drive, { nome, mime, buffer, pastaId, existente }) {
  const media = { mimeType: mime, body: Readable.from(buffer) };
  if (existente) {
    const { data } = await drive.files.update({ fileId: existente, media, fields: 'id, name' });
    return data;
  }
  const { data } = await drive.files.create({ requestBody: { name: nome, parents: [pastaId] }, media, fields: 'id, name' });
  return data;
}

/* dá acesso de LEITURA a um e-mail (sem aviso por e-mail, para não encher a caixa deles) */
async function compartilhar(drive, fileId, email) {
  await drive.permissions.create({
    fileId, sendNotificationEmail: false,
    requestBody: { type: 'user', role: 'reader', emailAddress: email },
  });
}

/* quem já tem acesso (para não repetir) */
async function quemTemAcesso(drive, fileId) {
  const { data } = await drive.permissions.list({ fileId, fields: 'permissions(emailAddress, role)', pageSize: 100 });
  return new Set((data.permissions || []).map((p) => String(p.emailAddress || '').toLowerCase()).filter(Boolean));
}

const linkPasta = (id) => `https://drive.google.com/drive/folders/${id}`;

module.exports = { credenciaisPresentes, cliente, pastaCaminho, arquivosDaPasta, enviar, compartilhar, quemTemAcesso, linkPasta, RAIZ };