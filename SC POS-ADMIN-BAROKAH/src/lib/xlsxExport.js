const textEncoder = new globalThis.TextEncoder();

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pushUInt16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUInt32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function concatChunks(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function createZip(files) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const { dosDate, dosTime } = getDosDateTime();

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.name);
    const contentBytes = typeof file.content === "string" ? textEncoder.encode(file.content) : file.content;
    const checksum = crc32(contentBytes);
    const size = contentBytes.length;
    const localHeader = [];

    pushUInt32(localHeader, 0x04034b50);
    pushUInt16(localHeader, 20);
    pushUInt16(localHeader, 0x0800);
    pushUInt16(localHeader, 0);
    pushUInt16(localHeader, dosTime);
    pushUInt16(localHeader, dosDate);
    pushUInt32(localHeader, checksum);
    pushUInt32(localHeader, size);
    pushUInt32(localHeader, size);
    pushUInt16(localHeader, nameBytes.length);
    pushUInt16(localHeader, 0);

    chunks.push(Uint8Array.from(localHeader), nameBytes, contentBytes);

    const centralHeader = [];
    pushUInt32(centralHeader, 0x02014b50);
    pushUInt16(centralHeader, 20);
    pushUInt16(centralHeader, 20);
    pushUInt16(centralHeader, 0x0800);
    pushUInt16(centralHeader, 0);
    pushUInt16(centralHeader, dosTime);
    pushUInt16(centralHeader, dosDate);
    pushUInt32(centralHeader, checksum);
    pushUInt32(centralHeader, size);
    pushUInt32(centralHeader, size);
    pushUInt16(centralHeader, nameBytes.length);
    pushUInt16(centralHeader, 0);
    pushUInt16(centralHeader, 0);
    pushUInt16(centralHeader, 0);
    pushUInt16(centralHeader, 0);
    pushUInt32(centralHeader, 0);
    pushUInt32(centralHeader, offset);
    centralDirectory.push(Uint8Array.from(centralHeader), nameBytes);

    offset += localHeader.length + nameBytes.length + size;
  }

  const centralDirectoryStart = offset;
  const centralChunks = concatChunks(centralDirectory);
  chunks.push(centralChunks);
  offset += centralChunks.length;

  const endRecord = [];
  pushUInt32(endRecord, 0x06054b50);
  pushUInt16(endRecord, 0);
  pushUInt16(endRecord, 0);
  pushUInt16(endRecord, files.length);
  pushUInt16(endRecord, files.length);
  pushUInt32(endRecord, centralChunks.length);
  pushUInt32(endRecord, centralDirectoryStart);
  pushUInt16(endRecord, 0);
  chunks.push(Uint8Array.from(endRecord));

  return concatChunks(chunks);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function normalizeSheetName(value) {
  const name = String(value || "Sheet1").replace(/[\\/?*[\]:]/g, " ").trim();
  return escapeXml((name || "Sheet1").slice(0, 31));
}

function cellXml(value, rowIndex, columnIndex, { bordered = false, headerRows = 1 } = {}) {
  const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
  const style = rowIndex < headerRows ? ' s="1"' : bordered ? ' s="2"' : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${style}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(matrix, { autoFilter = false, bordered = false, columnWidths = [], freezeHeader = false, headerRows = 1, merges = [] } = {}) {
  const columnCount = matrix[0]?.length || 0;
  const rowCount = matrix.length;
  const cols = columnWidths.length
    ? `<cols>${columnWidths
        .map((width, index) => {
          const numericWidth = Number(width || 0);
          if (!numericWidth) return "";
          return `<col min="${index + 1}" max="${index + 1}" width="${numericWidth}" customWidth="1"/>`;
        })
        .join("")}</cols>`
    : "";
  const sheetViews = freezeHeader
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`
    : "";
  const rows = matrix
    .map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cellXml(value, rowIndex, columnIndex, { bordered, headerRows })).join("")}</row>`)
    .join("");
  const filter = autoFilter && columnCount && rowCount > headerRows
    ? `<autoFilter ref="A${headerRows}:${columnName(columnCount - 1)}${rowCount}"/>`
    : "";
  const mergeCells = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${escapeXml(ref)}"/>`).join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheetViews}${cols}<sheetData>${rows}</sheetData>${mergeCells}${filter}</worksheet>`;
}

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${normalizeSheetName(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF2B3A4A"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD5E0E7"/></left><right style="thin"><color rgb="FFD5E0E7"/></right><top style="thin"><color rgb="FFD5E0E7"/></top><bottom style="thin"><color rgb="FFD5E0E7"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;
}

function downloadBlob(blob, filename) {
  const url = globalThis.URL.createObjectURL(blob);
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = filename;
  globalThis.document.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.URL.revokeObjectURL(url);
}

function safeFilename(value) {
  return String(value || "export").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
}

export function exportRowsToXlsx({ autoFilter = true, bordered = false, columns, filename, freezeHeader = true, headerRows, merges = [], rows, sheetName = "Sheet1" }) {
  const resolvedHeaderRows = headerRows?.length ? headerRows : [columns.map((column) => column.header)];
  const matrix = [
    ...resolvedHeaderRows,
    ...rows.map((row, rowIndex) =>
      columns.map((column) => (typeof column.value === "function" ? column.value(row, rowIndex) : row[column.value]))
    )
  ];
  const columnWidths = columns.map((column) => column.width || 16);
  const zipBytes = createZip([
    { name: "[Content_Types].xml", content: contentTypesXml() },
    { name: "_rels/.rels", content: rootRelsXml() },
    { name: "xl/workbook.xml", content: workbookXml(sheetName) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml() },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(matrix, { autoFilter, bordered, columnWidths, freezeHeader, headerRows: resolvedHeaderRows.length, merges }) },
    { name: "xl/styles.xml", content: stylesXml() }
  ]);
  const blob = new globalThis.Blob([zipBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  downloadBlob(blob, `${safeFilename(filename)}.xlsx`);
}
