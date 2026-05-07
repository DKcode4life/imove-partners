#!/usr/bin/env node
/**
 * Bulk-imports catalog icons from an Excel (.xlsx) file into the iMove inventory catalog.
 *
 * Usage:
 *   node scripts/import-catalog-icons.js <path-to-excel.xlsx> --email=you@example.com --password=yourpassword [--api-url=http://localhost:3001]
 *
 * Requirements:
 *   - The dev server must be running (so the script can hit /api/settings/catalog)
 *   - Each row in the Excel sheet should have an item name in a text cell and an
 *     image anchored to the same row.
 *
 * The script will:
 *   1. Extract all embedded images from the .xlsx file
 *   2. Map each image to the item name in the same row
 *   3. Load the current catalog from the API
 *   4. Match catalog items by name (case-insensitive, trimmed)
 *   5. Update matched items' icon to a base64 data URL
 *   6. Save a backup of the original catalog to catalog-backup.json
 *   7. PUT the updated catalog back to the API
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');

// ── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const excelArg = args.find(a => !a.startsWith('--'));
const apiUrlArg = args.find(a => a.startsWith('--api-url='));
const emailArg = args.find(a => a.startsWith('--email='));
const passwordArg = args.find(a => a.startsWith('--password='));
const API_BASE = apiUrlArg ? apiUrlArg.split('=')[1] : 'http://localhost:3001';
const LOGIN_EMAIL = emailArg ? emailArg.split('=').slice(1).join('=') : null;
const LOGIN_PASSWORD = passwordArg ? passwordArg.split('=').slice(1).join('=') : null;

if (!excelArg || !LOGIN_EMAIL || !LOGIN_PASSWORD) {
  console.error('Usage: node scripts/import-catalog-icons.js <excel-file.xlsx> --email=you@example.com --password=yourpassword [--api-url=http://localhost:3001]');
  process.exit(1);
}

const excelPath = path.resolve(excelArg);
if (!fs.existsSync(excelPath)) {
  console.error(`File not found: ${excelPath}`);
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function mimeForFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  return map[ext] || 'image/png';
}

function toDataUrl(buffer, filename) {
  return `data:${mimeForFilename(filename)};base64,${buffer.toString('base64')}`;
}

// Normalise a name for fuzzy matching: lowercase, collapse whitespace
function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Log in and get JWT token
  console.log(`\nLogging in as ${LOGIN_EMAIL} ...`);
  let authToken;
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    authToken = data.token;
    console.log('Logged in successfully.\n');
  } catch (err) {
    console.error(`Login failed: ${err.message}`);
    process.exit(1);
  }

  const authHeaders = { Authorization: `Bearer ${authToken}` };

  console.log(`Opening: ${excelPath}`);
  const xlsxBuf = fs.readFileSync(excelPath);
  const zip = await JSZip.loadAsync(xlsxBuf);

  // 1. Extract all media files (images)
  const mediaFiles = {};  // filename (e.g. "image1.png") → Buffer
  const mediaPrefix = 'xl/media/';
  for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
    if (zipPath.startsWith(mediaPrefix) && !zipEntry.dir) {
      const buf = Buffer.from(await zipEntry.async('arraybuffer'));
      mediaFiles[path.basename(zipPath)] = { buf, zipPath };
    }
  }
  console.log(`Found ${Object.keys(mediaFiles).length} image(s) in xl/media/`);

  // 2. Find drawing relationship files to map rId → image filename
  //    xl/drawings/_rels/drawing1.xml.rels  (or drawingN)
  const rIdToMedia = {};  // e.g. "rId1" → "image1.png"
  for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
    if (zipPath.startsWith('xl/drawings/_rels/') && zipPath.endsWith('.xml.rels')) {
      const xml = await zipEntry.async('string');
      const parsed = xmlParser.parse(xml);
      const rels = parsed?.Relationships?.Relationship;
      const relArray = Array.isArray(rels) ? rels : rels ? [rels] : [];
      for (const rel of relArray) {
        const target = rel['@_Target'] || '';
        const id = rel['@_Id'] || '';
        const filename = path.basename(target);
        if (mediaFiles[filename]) {
          rIdToMedia[id] = filename;
        }
      }
    }
  }

  // 3. Parse drawing XMLs to get image anchor → row index
  //    <xdr:oneCellAnchor> or <xdr:twoCellAnchor> each have <xdr:from><xdr:row>N</xdr:row>
  //    Row index is 0-based in the XML.
  const rowToImageFile = {};  // 0-based row → image filename
  for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
    if (zipPath.startsWith('xl/drawings/') && zipPath.endsWith('.xml') && !zipPath.includes('_rels')) {
      const xml = await zipEntry.async('string');
      const parsed = xmlParser.parse(xml);
      const wsDr = parsed?.['xdr:wsDr'] || parsed?.['wsDr'] || {};

      const anchors = [
        ...(asArray(wsDr['xdr:oneCellAnchor'] || wsDr['oneCellAnchor'])),
        ...(asArray(wsDr['xdr:twoCellAnchor'] || wsDr['twoCellAnchor'])),
      ];

      for (const anchor of anchors) {
        const from = anchor['xdr:from'] || anchor['from'] || {};
        const row = parseInt(from['xdr:row'] ?? from['row'] ?? -1, 10);
        if (row < 0) continue;

        // Find the picture element and its relationship id
        const pic = anchor['xdr:pic'] || anchor['pic'] || {};
        const blipFill = pic['xdr:blipFill'] || pic['blipFill'] || {};
        const blip = blipFill['a:blip'] || blipFill['blip'] || {};
        const rId = blip['@_r:embed'] || blip['@_embed'] || '';

        if (rId && rIdToMedia[rId]) {
          rowToImageFile[row] = rIdToMedia[rId];
        }
      }
    }
  }

  console.log(`Mapped ${Object.keys(rowToImageFile).length} image(s) to row positions`);

  // 4. Parse worksheet to get cell text values by row
  //    We look at every sheet to find the one with the most text matches
  const rowToName = {};  // 0-based row → item name string
  for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
    if (zipPath.startsWith('xl/worksheets/sheet') && zipPath.endsWith('.xml')) {
      const xml = await zipEntry.async('string');
      const parsed = xmlParser.parse(xml);
      const rows = asArray(parsed?.worksheet?.sheetData?.row);

      // Also need shared strings table for <v> references to sst
      let sharedStrings = [];
      const sstFile = zip.files['xl/sharedStrings.xml'];
      if (sstFile) {
        const sstXml = await sstFile.async('string');
        const sstParsed = xmlParser.parse(sstXml);
        const siArray = asArray(sstParsed?.sst?.si);
        sharedStrings = siArray.map(si => {
          // si.t is a plain string; si.r is rich text array
          if (si.t !== undefined) return String(si.t);
          if (si.r) return asArray(si.r).map(r => r.t ?? '').join('');
          return '';
        });
      }

      for (const row of rows) {
        // row attribute "r" is 1-based
        const rowIdx = parseInt(row['@_r'] || 0, 10) - 1;
        const cells = asArray(row.c);
        for (const cell of cells) {
          const t = cell['@_t'];  // type: "s"=shared string, "str"=formula string, undefined=number
          const v = cell.v;
          let cellText = '';
          if (t === 's' && v !== undefined) {
            cellText = sharedStrings[parseInt(v, 10)] || '';
          } else if (t === 'str' || t === 'inlineStr') {
            cellText = String(v ?? cell.is?.t ?? '');
          } else if (v !== undefined && typeof v === 'string') {
            cellText = v;
          }
          if (cellText && cellText.trim()) {
            // Take the first non-empty text cell in this row as the item name
            if (!rowToName[rowIdx]) {
              rowToName[rowIdx] = cellText.trim();
            }
          }
        }
      }
      // Use the first worksheet only
      break;
    }
  }

  console.log(`Found text in ${Object.keys(rowToName).length} row(s)`);

  // 5. Build name → data URL map
  const nameToDataUrl = {};
  for (const [rowStr, imageFile] of Object.entries(rowToImageFile)) {
    const row = parseInt(rowStr, 10);
    const name = rowToName[row];
    if (name) {
      const { buf, zipPath } = mediaFiles[imageFile];
      nameToDataUrl[norm(name)] = { dataUrl: toDataUrl(buf, imageFile), originalName: name };
    }
  }
  console.log(`Built ${Object.keys(nameToDataUrl).length} name→image mapping(s)\n`);

  // 6. Fetch current catalog from API
  console.log(`Fetching catalog from ${API_BASE}/api/settings/catalog ...`);
  let catalog;
  try {
    const res = await fetch(`${API_BASE}/api/settings/catalog`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = await res.json();
  } catch (err) {
    console.error(`Failed to fetch catalog: ${err.message}`);
    console.error('Make sure the dev server is running.');
    process.exit(1);
  }

  // Save backup
  const backupPath = path.resolve('catalog-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(catalog, null, 2));
  console.log(`Backup saved to ${backupPath}\n`);

  // 7. Match and update catalog items
  let matched = 0;
  const unmatched = [];

  for (const category of catalog) {
    for (const item of (category.items || [])) {
      const key = norm(item.name);
      if (nameToDataUrl[key]) {
        item.icon = nameToDataUrl[key].dataUrl;
        matched++;
      } else {
        unmatched.push(item.name);
      }
    }
  }

  console.log(`Matched: ${matched} items`);
  if (unmatched.length) {
    console.log(`Unmatched (${unmatched.length}):`);
    unmatched.forEach(n => console.log(`  - ${n}`));
  }

  // 8. PUT updated catalog
  if (matched === 0) {
    console.error('\nNo items matched — aborting update. Check that item names in the Excel match the catalog.');
    process.exit(1);
  }

  console.log(`\nUpdating catalog via API ...`);
  try {
    const res = await fetch(`${API_BASE}/api/settings/catalog`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(catalog),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error(`Failed to update catalog: ${err.message}`);
    process.exit(1);
  }

  console.log(`\nDone! ${matched} icon(s) updated.`);
  if (unmatched.length) {
    console.log(`${unmatched.length} item(s) were not matched and still have their original icons.`);
    console.log('Tip: Check for spelling differences between the Excel names and catalog names.');
  }
}

function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
