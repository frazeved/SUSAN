const { google } = require('googleapis');
const nodemailer = require('nodemailer');

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
}

function buildRawMime(mailOptions) {
  return new Promise((resolve, reject) => {
    const t = nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });
    t.sendMail(mailOptions, (err, info) => err ? reject(err) : resolve(info.message));
  });
}

const SHEET_ID = '1y0iL7PJldbVQmPIAnJi9wvA2hvjB8_aK2bU2kxvUf5Q';

const COL = {
  style: 2,    // C
  status: 3,   // D
  supplier: 6, // G
  category: 7, // H
  subcat: 8,   // I
  freight: 35, // AJ
  cost: 36,    // AK
  proto: 17,   // R
  sms: 25,     // Z
  ship: 51,    // AZ
  tp: 14       // O
};

const EXCLUDED_STATUSES = [
  "Canceled", "On Hold", "Other Supplier", "PO'd + production ok", "PO'd",
  "Waiting PO", "Changed supplier after tariffs", "Other supplier"
];

const REPORT_HEADER = [
  "Style#", "Status", "Supplier", "Category", "Subcategory",
  "Freight", "Cost", "Proto sent", "SMS sent", "Ship Date", "TP sent"
];

const SUPPLIER_CONTACTS = {
  "GAIA":        { email: "gburan@fama-sourcing.com", name: "Gozde" },
  "HS FASHION":  { email: ["miya.lin@hsfashion.cn", "aindy.wang@hsfashion.cn"], name: "Miya" },
  "H&F":         { email: ["daisy.zhu@hfourwing.com.cn", "abby.hu@hfourwing.com.cn"], name: "Daisy" },
  "JJ":          { email: "vivek@cmsassociates.net", name: "VIVEK" },
  "ECICO":       { email: ["elin@ecicogroup.com", "hyacinth@ecicogroup.com"], name: "Elin" },
  "CASCADE":     { email: "shilparawal@cascadenterprises.com", name: "Shilpa" },
  "KONCEPTION":  { email: "neha.shashi@konceptiondesigns.com", name: "Neha" },
  "S&S":         { email: "saintsandseers@gmail.com", name: "Ravi" },
  "PQSWIM":      { email: ["paola@pqswim.com", "pldesign@pqswim.com"], name: "Dir" }
};

const CC_LIST = [
  "paula@creativetwotwelve.com",
  "ozan.guruscu@creativetwotwelve.com",
  "rafaela@showroom212.com",
  "kamilla@creativetwotwelve.com"
];

function cleanStyle(raw) {
  if (!raw) return "";
  const str = raw.toString().trim();
  const match = str.match(/(\d.*)/);
  return match ? match[1] : str;
}

function todayFormatted(sep = '-') {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return sep === '/' ? `${mm}/${dd}` : `${mm}${sep}${dd}${sep}${d.getFullYear()}`;
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ── Step 1: read & filter sheet data ─────────────────────────────────────────

function buildSupplierData(data) {
  const reportMap  = {}; // supplier → rows for sheet report
  const emailMap   = {}; // supplier → rows for email (contacts only, has comments)

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const styleRaw = row[COL.style];
    const status   = (row[COL.status]   || '').toString().trim();
    const supplier = (row[COL.supplier] || '').toString().trim();

    if (!styleRaw || !status || !supplier) continue;
    if (EXCLUDED_STATUSES.includes(status)) continue;

    const style    = cleanStyle(styleRaw);
    const category = row[COL.category] || '';
    const cost     = row[COL.cost];

    // ── Report: include any row missing proto / sms / ship / tp ──
    const missingInfo = !row[COL.proto] || !row[COL.sms] || !row[COL.ship] || !row[COL.tp];
    if (missingInfo) {
      const costFmt = cost ? `$${Number(cost).toFixed(2)}` : '';
      if (!reportMap[supplier]) reportMap[supplier] = [];
      reportMap[supplier].push([
        style, status, supplier, category,
        row[COL.subcat]  || '',
        row[COL.freight] || '',
        costFmt,
        row[COL.proto] || '',
        row[COL.sms]   || '',
        row[COL.ship]  || '',
        row[COL.tp]    || ''
      ]);
    }

    // ── Email: only suppliers with known contacts, only rows with comments ──
    if (!SUPPLIER_CONTACTS[supplier]) continue;

    const comments = [];
    if (!cost)                              comments.push("Waiting Price");
    if (!row[COL.proto] || !row[COL.sms])  comments.push("Waiting Proto/SMS");

    let tpFormatted = '';
    const tpDate = parseDate(row[COL.tp]);
    if (tpDate) {
      const mm = String(tpDate.getMonth() + 1).padStart(2, '0');
      const dd = String(tpDate.getDate()).padStart(2, '0');
      tpFormatted = `${mm}/${dd}/${tpDate.getFullYear()}`;
      const diffDays = Math.floor((new Date() - tpDate) / (1000 * 60 * 60 * 24));
      if (diffDays > 15) comments.push('<span style="color:red;font-size:8pt;">Urgent</span>');
    }

    if (comments.length === 0) continue;

    if (!emailMap[supplier]) emailMap[supplier] = [];
    emailMap[supplier].push([style, category, comments.join(', '), tpFormatted, '']);
  }

  return { reportMap, emailMap };
}

// ── Step 2: write Google Sheets report ───────────────────────────────────────

async function writeSheetReport(sheets, reportMap) {
  const sheetName = `PO Weekly SUP - ${todayFormatted('-')}`;

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);

  const setupRequests = [];
  if (existing) setupRequests.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  setupRequests.push({ addSheet: { properties: { title: sheetName } } });

  const batchRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: setupRequests }
  });

  const newSheetId = batchRes.data.replies.find(r => r.addSheet).addSheet.properties.sheetId;

  const values = [];
  const headerRowIndices = [];
  let rowIndex = 0;

  for (const supplier of Object.keys(reportMap).sort()) {
    const rows = reportMap[supplier];
    values.push(REPORT_HEADER);
    headerRowIndices.push(rowIndex++);
    for (const r of rows) { values.push(r); rowIndex++; }
    values.push([]);
    rowIndex++;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });

  const formatRequests = headerRowIndices.map(ri => ({
    repeatCell: {
      range: { sheetId: newSheetId, startRowIndex: ri, endRowIndex: ri + 1, startColumnIndex: 0, endColumnIndex: REPORT_HEADER.length },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.812, green: 0.886, blue: 0.953 }, textFormat: { bold: true } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)'
    }
  }));

  if (formatRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: formatRequests } });
  }

  const totalStyles = Object.values(reportMap).reduce((s, r) => s + r.length, 0);
  console.log(`✅ Sheet report created: "${sheetName}" — ${Object.keys(reportMap).length} suppliers, ${totalStyles} styles`);
}

// ── Step 3: create Gmail drafts per supplier ─────────────────────────────────

async function createSupplierDrafts(emailMap) {
  const authClient = makeOAuth2Client();
  authClient.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  const todaySlash = todayFormatted('/');
  let created = 0;

  for (const supplier of Object.keys(emailMap).sort()) {
    const contact = SUPPLIER_CONTACTS[supplier];
    const rows = emailMap[supplier];
    if (!rows.length) continue;

    const to = Array.isArray(contact.email) ? contact.email.join(', ') : contact.email;
    const subject = `URGENT FUP - Development Status - ${supplier} - ${todaySlash}`;

    let htmlBody = `
      Hi ${contact.name}!<br><br>
      I hope all is well!<br><br>
      Please pay special attention to the styles below. The following styles updates are urgent!<br><br>
      We need them by Monday:<br><br>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <tr style="background-color:#cfe2f3;font-weight:bold;">
          <th>Style #</th><th>Category</th><th>Comments</th><th>TP sent</th><th>Updates</th>
        </tr>`;

    for (const r of rows) {
      htmlBody += `<tr>
        <td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td>
      </tr>`;
    }

    htmlBody += `</table><br>Best regards,<br>`;

    const rawMime = await buildRawMime({
      from: `"305 Team" <${process.env.GMAIL_SENDER_EMAIL}>`,
      to,
      cc: CC_LIST.join(', '),
      subject,
      html: htmlBody
    });

    const encoded = rawMime.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: encoded } } });

    console.log(`  📝  Draft created for ${supplier} (${rows.length} styles)`);
    created++;
  }

  console.log(`✅ ${created} Gmail drafts created`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Production & PO DataBase!A:BZ'
  });

  const data = response.data.values || [];
  const { reportMap, emailMap } = buildSupplierData(data);

  await writeSheetReport(sheets, reportMap);
  await createSupplierDrafts(emailMap);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
