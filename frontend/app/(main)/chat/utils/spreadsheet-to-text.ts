/**
 * Convert a spreadsheet file (xlsx/xls/xlsm/ods) to a small CSV text File in the
 * browser BEFORE upload.
 *
 * Why: a spreadsheet's binary is often huge (embedded styles/images push a
 * workbook to tens of MB), which makes uploads painfully slow on weak networks
 * and forces a heavy server-side Office→PDF→vision read. The actual cell data as
 * CSV text is tiny, so converting here makes the upload near-instant and the
 * read fast/cheap. Non-spreadsheet files pass through untouched, and any parse
 * error falls back to the original file (never blocks the upload).
 *
 * SheetJS is dynamically imported so it is code-split out of the main bundle and
 * only loaded the first time someone attaches a spreadsheet.
 */

const SPREADSHEET_EXTS = ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'];
const SPREADSHEET_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.oasis.opendocument.spreadsheet', // ods
];

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** True when the file is a spreadsheet workbook we can flatten to CSV. */
export function isSpreadsheet(file: File): boolean {
  return (
    SPREADSHEET_EXTS.includes(extensionOf(file.name)) ||
    SPREADSHEET_MIMES.includes(file.type)
  );
}

/**
 * Returns a `.csv` text File with the workbook's cell data (all sheets, each
 * labeled) when `file` is a spreadsheet and the conversion actually shrinks it;
 * otherwise returns the original file unchanged.
 */
export async function spreadsheetToCsvFile(file: File): Promise<File> {
  if (!isSpreadsheet(file)) return file;
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const NL = '\n';
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
      if (!csv) continue;
      // Label each sheet so multi-sheet workbooks stay legible in the answer.
      parts.push(`# Sheet: ${sheetName}${NL}${csv}`);
    }
    const text = parts.join(NL + NL);
    if (!text.trim()) return file; // nothing extracted — keep the original

    const base = file.name.replace(/\.[^./\\]+$/, '');
    const csvFile = new File([text], `${base}.csv`, { type: 'text/csv' });
    // Guard against the rare case where a tiny sheet with heavy embedded media
    // wouldn't actually shrink — keep whichever is smaller.
    return csvFile.size < file.size ? csvFile : file;
  } catch {
    return file;
  }
}
