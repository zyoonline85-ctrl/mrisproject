const XLSX = require("xlsx");
const AdmZip = require("adm-zip");

const STATUS_ACTIVE = new Set(["", "active", "aktif", "ya", "yes", "true", "1"]);
const STATUS_INACTIVE = new Set(["inactive", "nonaktif", "tidak aktif", "no", "false", "0"]);
const FINANCIAL_ACCOUNT_GROUPS = new Set([
  "cash_bank",
  "inventory",
  "other_current_asset",
  "fixed_asset",
  "moving_asset",
  "liability",
  "equity",
  "income",
  "cogs",
  "expense",
  "other_income",
  "other_expense"
]);

function roleHasApkAccess(role) {
  const permissions = role?.permissions || {};
  return Object.entries(permissions).some(
    ([key, actions]) => key.startsWith("apk.") && Array.isArray(actions) && actions.includes("view")
  );
}

const SHEETS = [
  {
    key: "products",
    name: "Produk",
    columns: [
      "name",
      "category_id",
      "category_name",
      "status",
      "sku",
      "outlet_id",
      "outlet_name",
      "price",
      "price_status",
      "variant",
      "variant_sort_order",
      "variant_status"
    ]
  },
  {
    key: "materials",
    name: "Harga Pokok Produksi",
    columns: ["name", "type", "category_id", "category_name", "account_code", "account_name", "unit", "low_stock_threshold", "status"]
  }
];

const SHEET_BY_KEY = new Map(SHEETS.map((sheet) => [sheet.key, sheet]));

function getImportData(api) {
  if (typeof api.getImportData === "function") {
    return api.getImportData();
  }
  const legacyGetter = api["getStaticData"];
  if (typeof legacyGetter === "function") {
    return legacyGetter.call(api);
  }
  const error = new Error("Import reference data provider tidak tersedia.");
  error.status = 500;
  error.code = "IMPORT_REFERENCE_PROVIDER_MISSING";
  throw error;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLookup(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSheetLookup(value) {
  return normalizeLookup(value).replace(/[^a-z0-9]+/g, "");
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

function normalizeNumber(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const text = normalizeText(value).replace(/\./g, "").replace(/,/g, ".");
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStatus(value) {
  const status = normalizeLookup(value);
  if (STATUS_INACTIVE.has(status)) return "inactive";
  if (STATUS_ACTIVE.has(status)) return "active";
  return status || "active";
}

function normalizeMaterialType(value) {
  const type = normalizeLookup(value);
  if (["biaya", "biaya produksi", "produksi", "expense"].includes(type)) return "biaya";
  return "hpp";
}

function normalizeDiscountType(value) {
  const type = normalizeLookup(value);
  if (["percent", "persen", "%"].includes(type)) return "percent";
  return "nominal";
}

function splitList(value) {
  return normalizeText(value)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function rowValue(row, keys) {
  const aliases = Array.isArray(keys) ? keys : [keys];
  const normalized = Object.entries(row).reduce((result, [key, value]) => {
    result[normalizeSheetLookup(key)] = value;
    return result;
  }, {});
  for (const key of aliases) {
    const value = normalized[normalizeSheetLookup(key)];
    if (value !== undefined && value !== null) return value;
  }
  return "";
}

function appendWorkbookSheet(workbook, name, rows, widths = []) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  if (widths.length) worksheet["!cols"] = widths.map((width) => ({ wch: width }));
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
  return worksheet;
}

function ensureWorksheetRange(worksheet, endAddress) {
  const currentRange = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  const endCell = XLSX.utils.decode_cell(endAddress);
  currentRange.e.r = Math.max(currentRange.e.r, endCell.r);
  currentRange.e.c = Math.max(currentRange.e.c, endCell.c);
  worksheet["!ref"] = XLSX.utils.encode_range(currentRange);
}

function applyFormulaColumn(worksheet, column, fromRow, toRow, formulaBuilder) {
  for (let row = fromRow; row <= toRow; row += 1) {
    worksheet[`${column}${row}`] = { f: formulaBuilder(row) };
  }
  ensureWorksheetRange(worksheet, `${column}${toRow}`);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectWorksheetDataValidation(xml, validations) {
  if (!validations.length) return xml;
  const validationXml = `<dataValidations count="${validations.length}">${validations
    .map(
      (validation) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${xmlEscape(validation.sqref)}"><formula1>${xmlEscape(validation.formula1)}</formula1></dataValidation>`
    )
    .join("")}</dataValidations>`;
  const cleanedXml = xml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/, "");
  if (cleanedXml.includes("<ignoredErrors")) return cleanedXml.replace("<ignoredErrors", `${validationXml}<ignoredErrors`);
  if (cleanedXml.includes("<pageMargins")) return cleanedXml.replace("<pageMargins", `${validationXml}<pageMargins`);
  return cleanedXml.replace("</worksheet>", `${validationXml}</worksheet>`);
}

function withTemplateDropdowns(buffer) {
  const zip = new AdmZip(buffer);
  const updates = [
    {
      path: "xl/worksheets/sheet2.xml",
      validations: [
        { sqref: "B2:B500", formula1: "ref_kategori_produk_ids" },
        { sqref: "F2:F500", formula1: "ref_outlet_ids" }
      ]
    },
    {
      path: "xl/worksheets/sheet3.xml",
      validations: [{ sqref: "C2:C500", formula1: "ref_kategori_hpp_ids" }]
    }
  ];
  updates.forEach((update) => {
    const entry = zip.getEntry(update.path);
    if (!entry) return;
    const nextXml = injectWorksheetDataValidation(entry.getData().toString("utf8"), update.validations);
    zip.updateFile(update.path, Buffer.from(nextXml, "utf8"));
  });
  return zip.toBuffer();
}

function isImportRowFilled(key, row) {
  if (key === "products") {
    return ["name", "category_id", "status", "sku", "outlet_id", "price", "variant"].some((field) =>
      normalizeText(rowValue(row, field))
    );
  }
  if (key === "materials") {
    return ["name", "type", "category_id", "unit", "low_stock_threshold", "status"].some((field) =>
      normalizeText(rowValue(row, field))
    );
  }
  return Object.values(row).some((value) => normalizeText(value));
}

function accountLabel(data, accountCode) {
  const code = normalizeText(accountCode);
  if (!code) return "";
  const account = (data.financial_accounts || []).find((item) => normalizeLookup(item.code) === normalizeLookup(code));
  return account ? `[${account.code}] ${account.name}` : `[${code}] Akun belum terdaftar`;
}

function materialTypeLabel(type) {
  return normalizeMaterialType(type) === "biaya" ? "Biaya Produksi" : "HPP";
}

function statusLabel(status) {
  return normalizeStatus(status) === "inactive" ? "inactive" : "active";
}

function createTemplateBuffer(data = {}) {
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = {
    Names: [
      { Name: "ref_kategori_produk_ids", Ref: "'REF Kategori Produk'!$A$2:$A$5000" },
      { Name: "ref_outlet_ids", Ref: "'REF Outlet'!$A$2:$A$5000" },
      { Name: "ref_kategori_hpp_ids", Ref: "'REF Kategori HPP'!$A$2:$A$5000" }
    ]
  };
  const firstActiveCategory = (data.categories || []).find((category) => normalizeStatus(category.status) === "active") || (data.categories || [])[0];
  const firstActiveOutlet = (data.outlets || []).find((outlet) => normalizeStatus(outlet.status) === "active") || (data.outlets || [])[0];
  const firstActiveMaterialCategory =
    (data.raw_material_categories || []).find((category) => normalizeStatus(category.status) === "active") || (data.raw_material_categories || [])[0];
  const firstActiveUnit = (data.units || []).find((unit) => normalizeStatus(unit.status) === "active") || (data.units || [])[0];
  appendWorkbookSheet(
    workbook,
    "Panduan",
    [
      ["Topik", "Penjelasan"],
      ["Fokus Template", "Template ini hanya untuk import Produk dan Harga Pokok Produksi."],
      ["Alur", "Isi sheet Produk atau Harga Pokok Produksi, lalu upload untuk Preview. Commit hanya bisa dilakukan jika tidak ada row error."],
      ["Referensi", "Kategori, satuan, dan referensi lain diambil dari sheet REF. Copy ID dari sheet REF ke sheet input."],
      ["Kolom _id", "Kolom category_id wajib dicopy dari sheet REF. Jangan membuat ID sendiri."],
      ["Kolom bantuan", "Kolom category_name/account_code/account_name hanya untuk memudahkan baca file. Sistem tetap memakai category_id."],
      ["Status", "Gunakan active/aktif atau inactive/nonaktif. Kosong dianggap active."],
      ["Type HPP", "Gunakan hpp untuk Harga Pokok Penjualan atau biaya untuk Biaya Produksi."],
      ["SKU Produk", "SKU boleh kosong untuk produk baru karena backend membuat SKU otomatis."],
      ["Produk Baru", "Untuk produk baru, isi name dan category_id dari REF Kategori Produk. Kosongkan SKU agar dibuat otomatis."],
      ["Kategori Produk", "Isi category_id dengan copy dari sheet REF Kategori Produk. category_name hanya bantuan baca."],
      ["Harga Produk Outlet", "Di sheet Produk, isi outlet_id dari REF Outlet dan price. Kosongkan jika produk belum dijual di outlet."],
      ["Catatan Variant Produk", "Di sheet Produk, isi variant dan variant_sort_order. Variant tidak mengubah harga."],
      ["Produk Multi Outlet/Variant", "Jika satu produk punya beberapa outlet atau variant, ulangi nama produk + category_id di baris berikutnya."],
      ["Harga Pokok Produksi", "Isi category_id dengan copy dari sheet REF Kategori HPP. Akun laporan otomatis mengikuti kategori."]
    ],
    [24, 100]
  );

  SHEETS.forEach((sheet) => {
    let rows = [sheet.columns];
    if (sheet.key === "products") {
      rows = [
        sheet.columns,
        [
          "Contoh Produk Baru",
          firstActiveCategory?.id || "",
          firstActiveCategory?.name || "",
          "active",
          "",
          firstActiveOutlet?.id || "",
          firstActiveOutlet?.name || "",
          25000,
          "active",
          "Sambal Lamongan",
          1,
          "active"
        ]
      ];
    }
    if (sheet.key === "materials") {
      rows = [
        sheet.columns,
        [
          "Contoh HPP Baru",
          normalizeMaterialType(firstActiveMaterialCategory?.type || "hpp"),
          firstActiveMaterialCategory?.id || "",
          firstActiveMaterialCategory?.name || "",
          firstActiveMaterialCategory?.account_code || "",
          accountLabel(data, firstActiveMaterialCategory?.account_code),
          firstActiveUnit?.code || firstActiveUnit?.name || "",
          10,
          "active"
        ]
      ];
    }
    const worksheet = appendWorkbookSheet(workbook, sheet.name, rows, sheet.columns.map((column) => Math.max(14, column.length + 4)));
    if (sheet.key === "products") {
      applyFormulaColumn(
        worksheet,
        "C",
        2,
        500,
        (row) => `IFERROR(VLOOKUP(B${row},'REF Kategori Produk'!$A$2:$B$5000,2,FALSE),"")`
      );
      applyFormulaColumn(
        worksheet,
        "G",
        2,
        500,
        (row) => `IFERROR(VLOOKUP(F${row},'REF Outlet'!$A$2:$B$5000,2,FALSE),"")`
      );
    }
    if (sheet.key === "materials") {
      applyFormulaColumn(
        worksheet,
        "D",
        2,
        500,
        (row) => `IFERROR(VLOOKUP(C${row},'REF Kategori HPP'!$A$2:$B$5000,2,FALSE),"")`
      );
      applyFormulaColumn(
        worksheet,
        "E",
        2,
        500,
        (row) => `IFERROR(VLOOKUP(C${row},'REF Kategori HPP'!$A$2:$D$5000,4,FALSE),"")`
      );
      applyFormulaColumn(
        worksheet,
        "F",
        2,
        500,
        (row) => `IFERROR(VLOOKUP(C${row},'REF Kategori HPP'!$A$2:$E$5000,5,FALSE),"")`
      );
    }
  });

  appendWorkbookSheet(
    workbook,
    "REF Status",
    [
      ["value", "label", "keterangan"],
      ["active", "Aktif", "Data aktif dan bisa dipakai."],
      ["inactive", "Nonaktif", "Data tidak aktif, histori lama tetap aman."]
    ],
    [18, 18, 50]
  );
  appendWorkbookSheet(
    workbook,
    "REF Type HPP",
    [
      ["value", "label", "masuk_laporan"],
      ["hpp", "HPP", "Laba Rugi bagian Harga Pokok Penjualan"],
      ["biaya", "Biaya Produksi", "Laba Rugi bagian Expense / Biaya"]
    ],
    [18, 24, 50]
  );
  appendWorkbookSheet(
    workbook,
    "REF Kategori Produk",
    [["category_id", "name", "status"], ...(data.categories || []).map((category) => [category.id, category.name, statusLabel(category.status)])],
    [24, 34, 14]
  );
  appendWorkbookSheet(
    workbook,
    "REF Produk",
    [
      ["product_id", "sku", "name", "category_id", "category_name", "status"],
      ...(data.products || []).map((product) => {
        const category = (data.categories || []).find((item) => item.id === product.category_id);
        return [product.id, product.sku, product.name, product.category_id || "", category?.name || "", statusLabel(product.status)];
      })
    ],
    [24, 18, 34, 24, 28, 14]
  );
  appendWorkbookSheet(
    workbook,
    "REF Outlet",
    [["outlet_id", "name", "code", "status"], ...(data.outlets || []).map((outlet) => [outlet.id, outlet.name, outlet.code || "", statusLabel(outlet.status)])],
    [24, 32, 18, 14]
  );
  appendWorkbookSheet(
    workbook,
    "REF Satuan",
    [["unit_id", "code", "name", "status"], ...(data.units || []).map((unit) => [unit.id || unit.code, unit.code, unit.name, statusLabel(unit.status)])],
    [24, 14, 24, 14]
  );
  appendWorkbookSheet(
    workbook,
    "REF Kategori HPP",
    [
      ["category_id", "name", "type", "account_code", "account", "status"],
      ...(data.raw_material_categories || []).map((category) => [
        category.id,
        category.name,
        normalizeMaterialType(category.type),
        category.account_code || "",
        accountLabel(data, category.account_code),
        statusLabel(category.status)
      ])
    ],
    [24, 34, 16, 16, 44, 14]
  );
  appendWorkbookSheet(
    workbook,
    "REF HPP Produksi",
    [
      ["material_id", "name", "type", "type_label", "category_id", "category_name", "unit", "status"],
      ...(data.raw_materials || []).map((material) => {
        const category = (data.raw_material_categories || []).find((item) => item.id === material.category_id);
        return [material.id, material.name, normalizeMaterialType(material.type), materialTypeLabel(material.type), material.category_id || "", category?.name || "", material.unit || "", statusLabel(material.status)];
      })
    ],
    [24, 34, 16, 20, 24, 34, 14, 14]
  );
  return withTemplateDropdowns(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const result = Object.fromEntries(SHEETS.map((sheet) => [sheet.key, []]));
  const keyBySheetName = new Map(SHEETS.map((sheet) => [normalizeSheetLookup(sheet.name), sheet.key]));

  workbook.SheetNames.forEach((sheetName) => {
    const key = keyBySheetName.get(normalizeSheetLookup(sheetName));
    if (!key) return;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
    result[key] = rows
      .map((row, index) => ({ rowNumber: index + 2, row }))
      .filter(({ row }) => isImportRowFilled(key, row));
  });

  return result;
}

function findByIdOrName(items, value, { codeKey = "code", nameKey = "name" } = {}) {
  const target = normalizeLookup(value);
  if (!target) return null;
  return (
    items.find((item) => normalizeLookup(item.id) === target) ||
    items.find((item) => normalizeLookup(item[codeKey]) === target) ||
    items.find((item) => normalizeLookup(item[nameKey]) === target) ||
    null
  );
}

function hasRowValue(row, keys) {
  return normalizeText(rowValue(row, keys)) !== "";
}

function relationValue(row, idKeys, fallbackKeys) {
  const idValue = normalizeText(rowValue(row, idKeys));
  if (idValue) return { value: idValue, fromId: true };
  return { value: rowValue(row, fallbackKeys), fromId: false };
}

function findByExactId(items, value) {
  const target = normalizeLookup(value);
  if (!target) return null;
  return items.find((item) => normalizeLookup(item.id) === target) || null;
}

function findByIdOrAlias(items, row, idKeys, fallbackKeys, options = {}) {
  const relation = relationValue(row, idKeys, fallbackKeys);
  if (relation.fromId) return findByExactId(items, relation.value);
  return findByIdOrName(items, relation.value, options);
}

function findAccount(data, value) {
  return findByIdOrName(data.financial_accounts || [], value, { codeKey: "code", nameKey: "name" });
}

function findOutlet(data, value) {
  return findByIdOrName(data.outlets || [], value, { codeKey: "code", nameKey: "name" });
}

function findOutletFromRow(data, row) {
  return findByIdOrAlias(data.outlets || [], row, "outlet_id", ["outlet", "outlet_name"], { codeKey: "code", nameKey: "name" });
}

function findOutletsFromRowList(data, row) {
  const relation = relationValue(row, "outlet_ids", "outlets");
  const values = splitList(relation.value);
  const outlets = values.map((value) => (relation.fromId ? findByExactId(data.outlets || [], value) : findOutlet(data, value))).filter(Boolean);
  return { values, outlets, fromId: relation.fromId };
}

function findCategory(data, value) {
  return findByIdOrName(data.categories || [], value, { codeKey: "id", nameKey: "name" });
}

function findCategoryFromRow(data, row) {
  return findByIdOrAlias(data.categories || [], row, "category_id", ["category", "category_name"], { codeKey: "id", nameKey: "name" });
}

function findMaterialCategory(data, value, type = "") {
  const found = findByIdOrName(data.raw_material_categories || [], value, { codeKey: "id", nameKey: "name" });
  if (!found || !type) return found;
  return found.type === type ? found : null;
}

function findMaterialCategoryFromRow(data, row, type = "") {
  const relation = relationValue(row, "category_id", ["category", "category_name"]);
  const found = relation.fromId
    ? findByExactId(data.raw_material_categories || [], relation.value)
    : findMaterialCategory(data, relation.value, type);
  if (!found || !type) return found;
  return found.type === type ? found : null;
}

function findMaterial(data, value) {
  return findByIdOrName(data.raw_materials || [], value, { codeKey: "id", nameKey: "name" });
}

function findMaterialFromRow(data, row) {
  return findByIdOrAlias(data.raw_materials || [], row, "material_id", ["hpp", "material_name"], { codeKey: "id", nameKey: "name" });
}

function findProduct(data, { id, sku, name, categoryId }) {
  const normalizedProductId = normalizeLookup(id);
  if (normalizedProductId) {
    const byId = (data.products || []).find((product) => normalizeLookup(product.id) === normalizedProductId);
    if (byId) return byId;
  }
  const normalizedSku = normalizeLookup(sku);
  if (normalizedSku) {
    const bySku = (data.products || []).find((product) => normalizeLookup(product.sku) === normalizedSku);
    if (bySku) return bySku;
  }
  const normalizedName = normalizeLookup(name);
  if (!normalizedName) return null;
  return (data.products || []).find(
    (product) => normalizeLookup(product.name) === normalizedName && (!categoryId || product.category_id === categoryId)
  ) || null;
}

function findProductForChild(data, row) {
  const productId = normalizeText(rowValue(row, "product_id"));
  const sku = normalizeText(rowValue(row, ["product_sku", "sku"]));
  const productName = normalizeText(rowValue(row, ["product_name", "product", "produk", "name"]));
  const category = findCategoryFromRow(data, row);
  return findProduct(data, { id: productId, sku, name: productName, categoryId: category?.id });
}

function relationIdError(row, idKeys, label) {
  return hasRowValue(row, idKeys) ? `${Array.isArray(idKeys) ? idKeys[0] : idKeys} tidak ditemukan di ${label}.` : null;
}

function hasProductPriceInput(row) {
  return hasRowValue(row, ["outlet_id", "outlet", "outlet_name", "price"]);
}

function hasProductVariantInput(row) {
  return hasRowValue(row, ["variant", "variant_name"]);
}

function operation(sheetKey, rowNumber, status, message, values = {}) {
  const sheet = SHEET_BY_KEY.get(sheetKey);
  return { id: `${sheetKey}-${rowNumber}`, sheet_key: sheetKey, sheet: sheet?.name || sheetKey, row_number: rowNumber, status, message, values };
}

function statusFromExisting(existing) {
  return existing ? "update" : "create";
}

function addVirtual(context, collection, item) {
  context[collection] = context[collection] || [];
  context[collection].push(item);
}

function createPreviewContext(data, sheets) {
  const context = {
    outlets: [...(data.outlets || [])],
    categories: [...(data.categories || [])],
    financial_accounts: [...(data.financial_accounts || [])],
    raw_material_categories: [...(data.raw_material_categories || [])],
    raw_materials: [...(data.raw_materials || [])],
    products: [...(data.products || [])]
  };

  for (const { row } of sheets.financial_accounts || []) {
    const code = normalizeText(rowValue(row, ["account_code", "code"]));
    if (code && !findAccount(context, code)) addVirtual(context, "financial_accounts", { id: `import_account_${code}`, code, name: normalizeText(rowValue(row, "name")) });
  }
  for (const { row } of sheets.outlets || []) {
    const code = normalizeText(rowValue(row, "code"));
    if (code && !findOutlet(context, code)) addVirtual(context, "outlets", { id: `import_outlet_${code}`, code, name: normalizeText(rowValue(row, "name")) });
  }
  for (const { row } of sheets.categories || []) {
    const name = normalizeText(rowValue(row, "name"));
    if (name && !findCategory(context, name)) addVirtual(context, "categories", { id: `import_category_${name}`, name });
  }
  for (const { row } of sheets.material_categories || []) {
    const name = normalizeText(rowValue(row, "name"));
    const type = normalizeMaterialType(rowValue(row, "type"));
    if (name && !findMaterialCategory(context, name, type)) {
      addVirtual(context, "raw_material_categories", { id: `import_mat_cat_${type}_${name}`, name, type, account_code: normalizeText(rowValue(row, "account_code")) });
    }
  }
  for (const { row } of sheets.materials || []) {
    const name = normalizeText(rowValue(row, "name"));
    if (name && !findMaterial(context, name)) addVirtual(context, "raw_materials", { id: `import_material_${name}`, name, unit: normalizeText(rowValue(row, "unit")) });
  }
  for (const { row } of sheets.products || []) {
    const sku = normalizeText(rowValue(row, "sku"));
    const name = normalizeText(rowValue(row, "name"));
    const category = findCategoryFromRow(context, row);
    if (name && !findProduct(context, { sku, name, categoryId: category?.id })) {
      addVirtual(context, "products", { id: `import_product_${sku || name}`, sku, name, category_id: category?.id });
    }
  }

  return context;
}

function validateStatus(status, label = "Status") {
  if (!["active", "inactive"].includes(status)) return `${label} harus active/aktif atau inactive/nonaktif.`;
  return null;
}

function validateRows(data, sheets) {
  const context = createPreviewContext(data, sheets);
  const rows = [];

  (sheets.financial_accounts || []).forEach(({ rowNumber, row }) => {
    const code = normalizeText(rowValue(row, ["account_code", "code"]));
    const name = normalizeText(rowValue(row, "name"));
    const reportGroup = normalizeText(rowValue(row, "report_group"));
    const normalBalance = normalizeText(rowValue(row, "normal_balance")) || "debit";
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = findAccount(data, code);
    let error = null;
    if (!code || !name || !reportGroup) error = "Kode, nama, dan group laporan wajib diisi.";
    else if (!FINANCIAL_ACCOUNT_GROUPS.has(reportGroup)) error = "Group laporan akun tidak valid.";
    else if (!["debit", "credit"].includes(normalBalance)) error = "Normal balance wajib debit atau credit.";
    else error = validateStatus(status);
    rows.push(operation("financial_accounts", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Akun akan diperbarui." : "Akun baru akan dibuat."), { code, name, report_group: reportGroup, status }));
    if (!error && !context.financial_accounts.some((item) => normalizeLookup(item.code) === normalizeLookup(code))) context.financial_accounts.push({ code, name, report_group: reportGroup, normal_balance: normalBalance, status });
  });

  (sheets.outlets || []).forEach(({ rowNumber, row }) => {
    const code = normalizeText(rowValue(row, "code")).toUpperCase();
    const name = normalizeText(rowValue(row, "name"));
    const openedAt = normalizeDate(rowValue(row, "opened_at"));
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = findOutlet(data, code);
    const error = !code || !name || !openedAt ? "Kode, nama, dan tanggal buka outlet wajib diisi." : validateStatus(status);
    rows.push(operation("outlets", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Outlet akan diperbarui." : "Outlet baru akan dibuat."), { code, name, opened_at: openedAt, status }));
  });

  (sheets.users || []).forEach(({ rowNumber, row }) => {
    const username = normalizeText(rowValue(row, "username")).toLowerCase();
    const name = normalizeText(rowValue(row, "name"));
    const email = normalizeText(rowValue(row, "email"));
    const roleValue = normalizeText(rowValue(row, "role"));
    const role = findByIdOrName(data.roles || [], roleValue, { codeKey: "id", nameKey: "name" });
    const { values: outletValues, outlets } = findOutletsFromRowList(context, row);
    const pin = normalizeText(rowValue(row, "pin"));
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.users || []).find((user) => normalizeLookup(user.username) === normalizeLookup(username));
    let error = null;
    if (!username || !name || !email || !role) error = "Username, nama, email, dan role wajib valid.";
    else if (!outletValues.length || outletValues.length !== outlets.length) error = "Outlet akses user tidak valid.";
    else if (roleHasApkAccess(role) && !existing && !/^\d{6}$/.test(pin)) error = "PIN APK wajib 6 digit untuk user APK baru.";
    else error = validateStatus(status);
    rows.push(operation("users", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "User akan diperbarui." : "User baru akan dibuat."), { username, name, role: role?.name || roleValue, outlet_ids: outlets.map((outlet) => outlet.id).join(", "), status }));
  });

  (sheets.categories || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = findCategory(data, name);
    const error = !name ? "Nama kategori produk wajib diisi." : validateStatus(status);
    rows.push(operation("categories", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Kategori akan diperbarui." : "Kategori baru akan dibuat."), { name, status }));
  });

  (sheets.material_categories || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const type = normalizeMaterialType(rowValue(row, "type"));
    const accountCode = normalizeText(rowValue(row, "account_code")) || (type === "biaya" ? "6000" : "5002");
    const account = findAccount(context, accountCode);
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = findMaterialCategory(data, name, type);
    let error = null;
    if (!name) error = "Nama kategori HPP wajib diisi.";
    else if (!account) error = "Akun kategori HPP belum terdaftar.";
    else if (type === "hpp" && account.report_group && account.report_group !== "cogs") error = "Akun kategori HPP type HPP harus group COGS/HPP.";
    else if (type === "biaya" && account.report_group && account.report_group !== "expense") error = "Akun kategori type Biaya Produksi harus group Expense.";
    else error = validateStatus(status);
    rows.push(operation("material_categories", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Kategori HPP akan diperbarui." : "Kategori HPP baru akan dibuat."), { name, type: type === "biaya" ? "Biaya Produksi" : "HPP", account_code: accountCode, status }));
  });

  (sheets.materials || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const type = normalizeMaterialType(rowValue(row, "type"));
    const category = findMaterialCategoryFromRow(context, row, type);
    const unit = normalizeText(rowValue(row, "unit"));
    const threshold = normalizeNumber(rowValue(row, "low_stock_threshold"), 0);
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = findMaterial(data, name);
    let error = null;
    if (!name || !unit || threshold < 0) error = "Nama, unit, dan threshold HPP wajib valid.";
    else if (!category) error = relationIdError(row, "category_id", "REF Kategori HPP") || "Kategori HPP tidak ditemukan atau tidak sesuai type.";
    else error = validateStatus(status);
    rows.push(operation("materials", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "HPP akan diperbarui." : "HPP baru akan dibuat."), { name, type: type === "biaya" ? "Biaya Produksi" : "HPP", category_id: category?.id || "", category: category?.name || "", unit, status }));
  });

  (sheets.products || []).forEach(({ rowNumber, row }) => {
    const sku = normalizeText(rowValue(row, "sku"));
    const name = normalizeText(rowValue(row, "name"));
    const category = findCategoryFromRow(context, row);
    const status = normalizeStatus(rowValue(row, "status"));
    const outlet = hasProductPriceInput(row) ? findOutletFromRow(context, row) : null;
    const price = normalizeNumber(rowValue(row, "price"), 0);
    const priceStatus = normalizeStatus(rowValue(row, "price_status"));
    const variant = normalizeText(rowValue(row, ["variant", "variant_name"]));
    const variantStatus = normalizeStatus(rowValue(row, "variant_status"));
    const existing = findProduct(data, { sku, name, categoryId: category?.id });
    let error = null;
    if (!name) error = "Nama produk wajib diisi.";
    else if (!category) error = relationIdError(row, "category_id", "REF Kategori Produk") || "Kategori produk tidak ditemukan.";
    else if (hasProductPriceInput(row) && !outlet) error = relationIdError(row, "outlet_id", "REF Outlet") || "Outlet harga produk tidak ditemukan.";
    else if (hasProductPriceInput(row) && price <= 0) error = "Harga outlet produk wajib lebih dari 0.";
    else if (hasProductVariantInput(row) && !variant) error = "Nama catatan variant wajib diisi.";
    else error = validateStatus(status) || (hasProductPriceInput(row) ? validateStatus(priceStatus, "Status harga outlet") : null) || (hasProductVariantInput(row) ? validateStatus(variantStatus, "Status variant") : null);
    const additions = [hasProductPriceInput(row) ? "harga outlet" : "", hasProductVariantInput(row) ? "variant" : ""].filter(Boolean).join(" + ");
    const message = existing ? "Produk akan diperbarui." : "Produk baru akan dibuat, SKU otomatis.";
    rows.push(
      operation("products", rowNumber, error ? "error" : statusFromExisting(existing), error || (additions ? `${message} Termasuk ${additions}.` : message), {
        sku,
        name,
        category_id: category?.id || "",
        category: category?.name || "",
        outlet_id: outlet?.id || "",
        outlet: outlet?.name || "",
        price: hasProductPriceInput(row) ? price : "",
        variant,
        status
      })
    );
  });

  (sheets.product_prices || []).forEach(({ rowNumber, row }) => {
    const product = findProductForChild(context, row);
    const outlet = findOutletFromRow(context, row);
    const price = Math.round(normalizeNumber(rowValue(row, "price"), 0));
    const status = normalizeStatus(rowValue(row, "status"));
    let error = null;
    if (!product) error = relationIdError(row, "product_id", "REF Produk") || "Produk harga outlet tidak ditemukan di master atau sheet Produk.";
    else if (!outlet) error = relationIdError(row, "outlet_id", "REF Outlet") || "Outlet harga produk tidak ditemukan.";
    else if (price <= 0) error = "Harga produk wajib lebih dari 0.";
    else error = validateStatus(status);
    rows.push(operation("product_prices", rowNumber, error ? "error" : "update", error || "Harga outlet akan di-upsert ke produk.", { product: product?.name || "", outlet_id: outlet?.id || "", outlet: outlet?.name || "", price, status }));
  });

  (sheets.product_compositions || []).forEach(({ rowNumber, row }) => {
    const product = findProductForChild(context, row);
    const material = findMaterialFromRow(context, row);
    const quantity = normalizeNumber(rowValue(row, "quantity"), 0);
    const unit = normalizeText(rowValue(row, "unit")) || material?.unit || "";
    let error = null;
    if (!product) error = relationIdError(row, "product_id", "REF Produk") || "Produk komposisi tidak ditemukan di master atau sheet Produk.";
    else if (!material) error = relationIdError(row, "material_id", "REF HPP Produksi") || "Harga Pokok Produksi komposisi tidak ditemukan.";
    else if (quantity <= 0) error = "Qty komposisi wajib lebih dari 0.";
    rows.push(operation("product_compositions", rowNumber, error ? "error" : "update", error || "Komposisi akan di-upsert ke produk.", { product: product?.name || "", material_id: material?.id || "", hpp: material?.name || "", quantity, unit }));
  });

  (sheets.product_variants || []).forEach(({ rowNumber, row }) => {
    const product = findProductForChild(context, row);
    const variant = normalizeText(rowValue(row, ["name", "variant"]));
    const status = normalizeStatus(rowValue(row, "status"));
    let error = null;
    if (!product) error = relationIdError(row, "product_id", "REF Produk") || "Produk variant tidak ditemukan di master atau sheet Produk.";
    else if (!variant) error = "Nama catatan variant wajib diisi.";
    else error = validateStatus(status);
    rows.push(operation("product_variants", rowNumber, error ? "error" : "update", error || "Variant akan di-upsert ke produk.", { product: product?.name || "", variant, status }));
  });

  (sheets.customers || []).forEach(({ rowNumber, row }) => {
    const outlet = findOutletFromRow(context, row);
    const name = normalizeText(rowValue(row, "name"));
    const phone = normalizeText(rowValue(row, "phone"));
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.customers || []).find((customer) => customer.outlet_id === outlet?.id && normalizeLookup(customer.phone || customer.name) === normalizeLookup(phone || name));
    const error = !outlet || !name || !phone ? relationIdError(row, "outlet_id", "REF Outlet") || "Outlet, nama, dan phone customer wajib valid." : validateStatus(status);
    rows.push(operation("customers", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Customer akan diperbarui." : "Customer baru akan dibuat."), { outlet: outlet?.name || "", name, phone, status }));
  });

  (sheets.tables || []).forEach(({ rowNumber, row }) => {
    const outlet = findOutletFromRow(context, row);
    const number = normalizeText(rowValue(row, "number")).toUpperCase();
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.tables || []).find((table) => table.outlet_id === outlet?.id && normalizeLookup(table.number) === normalizeLookup(number));
    const error = !outlet || !number ? relationIdError(row, "outlet_id", "REF Outlet") || "Outlet dan nomor meja wajib valid." : validateStatus(status);
    rows.push(operation("tables", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Meja akan diperbarui." : "Meja baru akan dibuat."), { outlet: outlet?.name || "", number, status }));
  });

  (sheets.suppliers || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.suppliers || []).find((supplier) => normalizeLookup(supplier.name) === normalizeLookup(name));
    const error = !name ? "Nama supplier wajib diisi." : validateStatus(status);
    rows.push(operation("suppliers", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Supplier akan diperbarui." : "Supplier baru akan dibuat."), { name, status }));
  });

  (sheets.units || []).forEach(({ rowNumber, row }) => {
    const code = normalizeText(rowValue(row, "code")) || normalizeText(rowValue(row, "name"));
    const name = normalizeText(rowValue(row, "name")) || code;
    const status = normalizeStatus(rowValue(row, "status"));
    const error = !code || !name ? "Kode dan nama unit wajib diisi." : validateStatus(status);
    rows.push(operation("units", rowNumber, error ? "error" : "update", error || "Unit akan dibuat/diperbarui.", { code, name, status }));
  });

  (sheets.expense_categories || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const accountCode = normalizeText(rowValue(row, "account_code"));
    const account = findAccount(context, accountCode);
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.expense_categories || []).find((category) => normalizeLookup(category.name) === normalizeLookup(name));
    let error = null;
    if (!name) error = "Nama pengeluaran operasional wajib diisi.";
    else if (!account || account.report_group !== "expense") error = "Akun pengeluaran wajib group Expense.";
    else error = validateStatus(status);
    rows.push(operation("expense_categories", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Nama pengeluaran akan diperbarui." : "Nama pengeluaran baru akan dibuat."), { name, account_code: accountCode, status }));
  });

  (sheets.payment_methods || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const code = normalizeText(rowValue(row, "code")).toLowerCase();
    const accountCode = normalizeText(rowValue(row, "account_code"));
    const account = findAccount(context, accountCode);
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.payment_methods || []).find((method) => normalizeLookup(method.code) === normalizeLookup(code));
    let error = null;
    if (!name || !code) error = "Nama dan kode metode pembayaran wajib diisi.";
    else if (!account || account.report_group !== "cash_bank") error = "Akun metode pembayaran wajib group Cash/Bank.";
    else error = validateStatus(status);
    rows.push(operation("payment_methods", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Metode pembayaran akan diperbarui." : "Metode pembayaran baru akan dibuat."), { name, code, account_code: accountCode, status }));
  });

  (sheets.discounts || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const type = normalizeDiscountType(rowValue(row, "type"));
    const value = normalizeNumber(rowValue(row, "value"), 0);
    const startsAt = normalizeDate(rowValue(row, "starts_at"));
    const endsAt = normalizeDate(rowValue(row, "ends_at"));
    const { values: outletValues, outlets } = findOutletsFromRowList(context, row);
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.discounts || []).find((discount) => normalizeLookup(discount.name) === normalizeLookup(name) && discount.starts_at === startsAt && discount.ends_at === endsAt);
    let error = null;
    if (!name || !startsAt || !endsAt) error = "Nama dan periode discount wajib diisi.";
    else if (endsAt < startsAt) error = "Tanggal selesai discount tidak boleh sebelum mulai.";
    else if (type === "percent" && (value < 1 || value > 100)) error = "Discount persen wajib 1-100.";
    else if (type === "nominal" && value <= 0) error = "Discount nominal wajib lebih dari 0.";
    else if (!outletValues.length || outletValues.length !== outlets.length) error = "Outlet discount wajib valid.";
    else error = validateStatus(status);
    rows.push(operation("discounts", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Discount akan diperbarui." : "Discount baru akan dibuat."), { name, type, value, starts_at: startsAt, ends_at: endsAt, outlet_ids: outlets.map((outlet) => outlet.id).join(", "), status }));
  });

  (sheets.finance_entry_groups || []).forEach(({ rowNumber, row }) => {
    const name = normalizeText(rowValue(row, "name"));
    const accountCode = normalizeText(rowValue(row, "account_code"));
    const account = findAccount(context, accountCode);
    const hasOutlet = hasRowValue(row, ["outlet_id", "outlet", "outlet_name"]);
    const outlet = hasOutlet ? findOutletFromRow(context, row) : null;
    const status = normalizeStatus(rowValue(row, "status"));
    const existing = (data.finance_entry_groups || []).find((group) => normalizeLookup(group.name) === normalizeLookup(name) && normalizeLookup(group.account_code) === normalizeLookup(accountCode) && (group.outlet_id || "") === (outlet?.id || ""));
    let error = null;
    if (!name || !account) error = "Nama pos dan akun laporan wajib valid.";
    else if (hasOutlet && !outlet) error = relationIdError(row, "outlet_id", "REF Outlet") || "Outlet pos keuangan tidak ditemukan.";
    else error = validateStatus(status);
    rows.push(operation("finance_entry_groups", rowNumber, error ? "error" : statusFromExisting(existing), error || (existing ? "Pos Keuangan akan diperbarui." : "Pos Keuangan baru akan dibuat."), { name, account_code: accountCode, outlet: outlet?.name || "Semua Outlet", status }));
  });

  return rows;
}

function summarize(rows) {
  const summary = rows.reduce(
    (result, row) => {
      result.total += 1;
      result[row.status] = (result[row.status] || 0) + 1;
      result.by_sheet[row.sheet_key] = result.by_sheet[row.sheet_key] || { sheet: row.sheet, total: 0, create: 0, update: 0, skip: 0, error: 0 };
      result.by_sheet[row.sheet_key].total += 1;
      result.by_sheet[row.sheet_key][row.status] = (result.by_sheet[row.sheet_key][row.status] || 0) + 1;
      return result;
    },
    { total: 0, create: 0, update: 0, skip: 0, error: 0, by_sheet: {} }
  );
  summary.sheets = Object.values(summary.by_sheet);
  delete summary.by_sheet;
  return summary;
}

function previewMasterDataImport(api, buffer, filename = "import.xlsx") {
  const sheets = parseWorkbook(buffer);
  const data = getImportData(api);
  const rows = validateRows(data, sheets);
  const summary = summarize(rows);
  return {
    filename,
    sheets: SHEETS.map((sheet) => ({ key: sheet.key, name: sheet.name, columns: sheet.columns, row_count: (sheets[sheet.key] || []).length })),
    rows,
    summary,
    can_commit: summary.error === 0 && summary.total > 0
  };
}

function nextSortOrder(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), 0) + 1;
}

async function applySimpleRows(api, sheets) {
  const data = getImportData(api);
  for (const { row } of sheets.financial_accounts || []) {
    const code = normalizeText(rowValue(row, ["account_code", "code"]));
    const existing = findAccount(data, code);
    const payload = {
      code,
      name: normalizeText(rowValue(row, "name")),
      report_group: normalizeText(rowValue(row, "report_group")),
      normal_balance: normalizeText(rowValue(row, "normal_balance")) || "debit",
      sort_order: normalizeNumber(rowValue(row, "sort_order"), existing?.sort_order || nextSortOrder(data.financial_accounts)),
      status: normalizeStatus(rowValue(row, "status"))
    };
    if (existing) await api.updateFinancialAccount(existing.id, payload);
    else await api.createFinancialAccount(payload);
  }

  for (const { row } of sheets.outlets || []) {
    const code = normalizeText(rowValue(row, "code")).toUpperCase();
    const existing = findOutlet(data, code);
    const payload = {
      code,
      name: normalizeText(rowValue(row, "name")),
      address: normalizeText(rowValue(row, "address")) || "Alamat belum diisi",
      phone: normalizeText(rowValue(row, "phone")) || "000000",
      opened_at: normalizeDate(rowValue(row, "opened_at")),
      status: normalizeStatus(rowValue(row, "status"))
    };
    if (existing) await api.updateOutlet(existing.id, payload);
    else await api.createOutlet(payload);
  }

  for (const { row } of sheets.categories || []) {
    const name = normalizeText(rowValue(row, "name"));
    const existing = findCategory(data, name);
    const payload = { name, sort_order: normalizeNumber(rowValue(row, "sort_order"), existing?.sort_order || nextSortOrder(data.categories)), status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateCategory(existing.id, payload);
    else await api.createCategory(payload);
  }

  for (const { row } of sheets.units || []) {
    const code = normalizeText(rowValue(row, "code")) || normalizeText(rowValue(row, "name"));
    const name = normalizeText(rowValue(row, "name")) || code;
    const unitRows = (data.raw_materials || []).map((material) => material.unit);
    const existing = (data.units || []).find((unit) => normalizeLookup(unit.code) === normalizeLookup(code)) || null;
    const payload = { code, name, status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateUnit(existing.id, payload);
    else if (!unitRows.some((unit) => normalizeLookup(unit) === normalizeLookup(code))) await api.createUnit(payload);
  }

  for (const { row } of sheets.material_categories || []) {
    const type = normalizeMaterialType(rowValue(row, "type"));
    const name = normalizeText(rowValue(row, "name"));
    const existing = findMaterialCategory(data, name, type);
    const payload = {
      name,
      type,
      account_code: normalizeText(rowValue(row, "account_code")) || (type === "biaya" ? "6000" : "5002"),
      sort_order: normalizeNumber(rowValue(row, "sort_order"), existing?.sort_order || nextSortOrder(data.raw_material_categories)),
      status: normalizeStatus(rowValue(row, "status"))
    };
    if (existing) await api.updateMaterialCategory(existing.id, payload);
    else await api.createMaterialCategory(payload);
  }

  for (const { row } of sheets.materials || []) {
    const type = normalizeMaterialType(rowValue(row, "type"));
    const category = findMaterialCategoryFromRow(data, row, type);
    const name = normalizeText(rowValue(row, "name"));
    const existing = findMaterial(data, name);
    const payload = {
      name,
      type,
      category_id: category.id,
      unit: normalizeText(rowValue(row, "unit")),
      low_stock_threshold: normalizeNumber(rowValue(row, "low_stock_threshold"), 0),
      status: normalizeStatus(rowValue(row, "status"))
    };
    if (existing) await api.updateMaterial(existing.id, payload);
    else await api.createMaterial(payload);
  }

  for (const { row } of sheets.expense_categories || []) {
    const name = normalizeText(rowValue(row, "name"));
    const existing = (data.expense_categories || []).find((category) => normalizeLookup(category.name) === normalizeLookup(name));
    const payload = { name, account_code: normalizeText(rowValue(row, "account_code")), sort_order: normalizeNumber(rowValue(row, "sort_order"), existing?.sort_order || nextSortOrder(data.expense_categories)), status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateExpenseCategory(existing.id, payload);
    else await api.createExpenseCategory(payload);
  }

  for (const { row } of sheets.payment_methods || []) {
    const code = normalizeText(rowValue(row, "code")).toLowerCase();
    const existing = (data.payment_methods || []).find((method) => normalizeLookup(method.code) === normalizeLookup(code));
    const payload = { name: normalizeText(rowValue(row, "name")), code, account_code: normalizeText(rowValue(row, "account_code")), sort_order: normalizeNumber(rowValue(row, "sort_order"), existing?.sort_order || nextSortOrder(data.payment_methods)), status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updatePaymentMethod(existing.id, payload);
    else await api.createPaymentMethod(payload);
  }

  for (const { row } of sheets.suppliers || []) {
    const name = normalizeText(rowValue(row, "name"));
    const existing = (data.suppliers || []).find((supplier) => normalizeLookup(supplier.name) === normalizeLookup(name));
    const payload = { name, phone: normalizeText(rowValue(row, "phone")) || "-", status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateSupplier(existing.id, payload);
    else await api.createSupplier(payload);
  }
}

function currentProductPayload(data, product) {
  return {
    name: product.name,
    category_id: product.category_id,
    status: product.status || "active",
    prices: (data.product_prices || []).filter((price) => price.product_id === product.id),
    composition: (data.product_compositions || []).filter((item) => item.product_id === product.id),
    variants: (data.product_variants || []).filter((item) => item.product_id === product.id)
  };
}

function upsertBy(list, keyFn, row) {
  const key = keyFn(row);
  const index = list.findIndex((item) => keyFn(item) === key);
  if (index >= 0) list[index] = { ...list[index], ...row };
  else list.push(row);
}

async function applyProductRows(api, sheets) {
  const data = getImportData(api);
  const plans = new Map();

  function ensurePlan(product, fallback = {}) {
    const key = product?.id || `new:${normalizeLookup(fallback.sku || fallback.name)}:${normalizeLookup(fallback.category_id)}`;
    if (!plans.has(key)) {
      plans.set(key, product ? { product, payload: currentProductPayload(data, product) } : { product: null, payload: { name: fallback.name, category_id: fallback.category_id, status: fallback.status || "active", prices: [], composition: [], variants: [] } });
    }
    return plans.get(key);
  }

  for (const { row } of sheets.products || []) {
    const sku = normalizeText(rowValue(row, "sku"));
    const name = normalizeText(rowValue(row, "name"));
    const category = findCategoryFromRow(data, row);
    const product = findProduct(data, { sku, name, categoryId: category?.id });
    const plan = ensurePlan(product, { sku, name, category_id: category.id, status: normalizeStatus(rowValue(row, "status")) });
    plan.payload.name = name;
    plan.payload.category_id = category.id;
    plan.payload.status = normalizeStatus(rowValue(row, "status"));
    if (hasProductPriceInput(row)) {
      const outlet = findOutletFromRow(data, row);
      upsertBy(plan.payload.prices, (item) => item.outlet_id, {
        outlet_id: outlet.id,
        price: Math.round(normalizeNumber(rowValue(row, "price"), 0)),
        status: normalizeStatus(rowValue(row, "price_status"))
      });
    }
    if (hasProductVariantInput(row)) {
      const variantName = normalizeText(rowValue(row, ["variant", "variant_name"]));
      upsertBy(plan.payload.variants, (item) => normalizeLookup(item.name), {
        name: variantName,
        sort_order: normalizeNumber(rowValue(row, "variant_sort_order"), plan.payload.variants.length + 1),
        status: normalizeStatus(rowValue(row, "variant_status"))
      });
    }
  }

  function planForChild(row) {
    const product = findProductForChild(data, row);
    if (product) return ensurePlan(product);
    const sku = normalizeText(rowValue(row, ["product_sku", "sku"]));
    const productName = normalizeText(rowValue(row, ["product_name", "product", "produk", "name"]));
    const productRow = (sheets.products || []).find(({ row: productSheetRow }) => {
      const rowSku = normalizeText(rowValue(productSheetRow, "sku"));
      const rowName = normalizeText(rowValue(productSheetRow, "name"));
      const rowCategory = findCategoryFromRow(data, productSheetRow);
      const childCategory = findCategoryFromRow(data, row);
      const categoryMatches = !childCategory?.id || rowCategory?.id === childCategory.id;
      return ((sku && normalizeLookup(rowSku) === normalizeLookup(sku)) || normalizeLookup(rowName) === normalizeLookup(productName)) && categoryMatches;
    });
    if (!productRow) return null;
    const category = findCategoryFromRow(data, productRow.row);
    return ensurePlan(null, { sku, name: normalizeText(rowValue(productRow.row, "name")), category_id: category.id, status: normalizeStatus(rowValue(productRow.row, "status")) });
  }

  for (const { row } of sheets.product_prices || []) {
    const plan = planForChild(row);
    if (!plan) continue;
    const outlet = findOutletFromRow(data, row);
    upsertBy(plan.payload.prices, (item) => item.outlet_id, { outlet_id: outlet.id, price: Math.round(normalizeNumber(rowValue(row, "price"), 0)), status: normalizeStatus(rowValue(row, "status")) });
  }

  for (const { row } of sheets.product_compositions || []) {
    const plan = planForChild(row);
    if (!plan) continue;
    const material = findMaterialFromRow(data, row);
    upsertBy(plan.payload.composition, (item) => item.material_id, { material_id: material.id, quantity: normalizeNumber(rowValue(row, "quantity"), 0), unit: normalizeText(rowValue(row, "unit")) || material.unit });
  }

  for (const { row } of sheets.product_variants || []) {
    const plan = planForChild(row);
    if (!plan) continue;
    const name = normalizeText(rowValue(row, ["name", "variant"]));
    upsertBy(plan.payload.variants, (item) => normalizeLookup(item.name), { name, sort_order: normalizeNumber(rowValue(row, "sort_order"), plan.payload.variants.length + 1), status: normalizeStatus(rowValue(row, "status")) });
  }

  for (const plan of plans.values()) {
    if (plan.product) await api.updateProduct(plan.product.id, plan.payload);
    else await api.createProduct(plan.payload);
  }
}

async function applyRemainingRows(api, sheets) {
  const data = getImportData(api);
  for (const { row } of sheets.users || []) {
    const username = normalizeText(rowValue(row, "username")).toLowerCase();
    const existing = (data.users || []).find((user) => normalizeLookup(user.username) === normalizeLookup(username));
    const role = findByIdOrName(data.roles || [], rowValue(row, "role"), { codeKey: "id", nameKey: "name" });
    const outletIds = findOutletsFromRowList(data, row).outlets.map((outlet) => outlet.id);
    const pin = normalizeText(rowValue(row, "pin"));
    const payload = {
      username,
      name: normalizeText(rowValue(row, "name")),
      email: normalizeText(rowValue(row, "email")),
      role_id: role.id,
      outlet_ids: outletIds,
      status: normalizeStatus(rowValue(row, "status"))
    };
    if (roleHasApkAccess(role) && pin) payload.cashier_pin = pin;
    if (existing) await api.updateUser(existing.id, payload);
    else await api.createUser(payload);
  }

  for (const { row } of sheets.customers || []) {
    const outlet = findOutletFromRow(data, row);
    const phone = normalizeText(rowValue(row, "phone"));
    const name = normalizeText(rowValue(row, "name"));
    const existing = (data.customers || []).find((customer) => customer.outlet_id === outlet.id && normalizeLookup(customer.phone || customer.name) === normalizeLookup(phone || name));
    const payload = { outlet_id: outlet.id, name, phone, barcode: normalizeText(rowValue(row, "barcode")), points: normalizeNumber(rowValue(row, "points"), existing?.points || 0), status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateCustomer(existing.id, payload);
    else await api.createCustomer(payload);
  }

  for (const { row } of sheets.tables || []) {
    const outlet = findOutletFromRow(data, row);
    const number = normalizeText(rowValue(row, "number")).toUpperCase();
    const existing = (data.tables || []).find((table) => table.outlet_id === outlet.id && normalizeLookup(table.number) === normalizeLookup(number));
    const payload = { outlet_id: outlet.id, number, status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateTable(existing.id, payload);
    else await api.createTable(payload);
  }

  for (const { row } of sheets.discounts || []) {
    const name = normalizeText(rowValue(row, "name"));
    const startsAt = normalizeDate(rowValue(row, "starts_at"));
    const endsAt = normalizeDate(rowValue(row, "ends_at"));
    const existing = (data.discounts || []).find((discount) => normalizeLookup(discount.name) === normalizeLookup(name) && discount.starts_at === startsAt && discount.ends_at === endsAt);
    const payload = { name, type: normalizeDiscountType(rowValue(row, "type")), value: normalizeNumber(rowValue(row, "value"), 0), starts_at: startsAt, ends_at: endsAt, outlet_ids: findOutletsFromRowList(data, row).outlets.map((outlet) => outlet.id), status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateDiscount(existing.id, payload);
    else await api.createDiscount(payload);
  }

  for (const { row } of sheets.finance_entry_groups || []) {
    const account = findAccount(data, rowValue(row, "account_code"));
    const hasOutlet = hasRowValue(row, ["outlet_id", "outlet", "outlet_name"]);
    const outlet = hasOutlet ? findOutletFromRow(data, row) : null;
    const name = normalizeText(rowValue(row, "name"));
    const existing = (data.finance_entry_groups || []).find((group) => normalizeLookup(group.name) === normalizeLookup(name) && normalizeLookup(group.account_code) === normalizeLookup(account.code) && (group.outlet_id || "") === (outlet?.id || ""));
    const payload = { name, account_code: account.code, outlet_id: outlet?.id || null, note: normalizeText(rowValue(row, "note")), status: normalizeStatus(rowValue(row, "status")) };
    if (existing) await api.updateFinanceEntryGroup(existing.id, payload);
    else await api.createFinanceEntryGroup(payload);
  }
}

async function commitMasterDataImport(api, buffer, { filename = "import.xlsx", actorUserId = null } = {}) {
  const preview = previewMasterDataImport(api, buffer, filename);
  if (!preview.can_commit) {
    await api.createActivityLog({
      actor_user_id: actorUserId,
      source: "admin_web",
      module: "master_import",
      action: "failed",
      entity_type: "master_import",
      entity_id: filename,
      description: `Import master data ${filename} gagal validasi.`,
      metadata_json: { summary: preview.summary }
    });
    throw new Error("File import masih memiliki error. Perbaiki data lalu preview ulang.");
  }

  const sheets = parseWorkbook(buffer);
  await applySimpleRows(api, sheets);
  await applyProductRows(api, sheets);
  await applyRemainingRows(api, sheets);

  await api.createActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "master_import",
    action: "commit",
    entity_type: "master_import",
    entity_id: filename,
    description: `Import master data ${filename} berhasil diproses.`,
    metadata_json: { summary: preview.summary, sheets: preview.sheets.map((sheet) => ({ key: sheet.key, row_count: sheet.row_count })) }
  });

  return { ...preview, committed: true };
}

module.exports = {
  SHEETS,
  createTemplateBuffer,
  previewMasterDataImport,
  commitMasterDataImport
};
