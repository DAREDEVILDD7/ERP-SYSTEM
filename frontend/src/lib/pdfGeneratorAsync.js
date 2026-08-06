/**
 * Lazy entry point for the PDF exporters.
 *
 * `pdfGenerator.js` statically imports jspdf + jspdf-autotable, which is ~117 kB
 * gzipped — by far the heaviest thing this app ships. Importing it directly
 * welds that weight onto whichever page chunk does the import, so Finance,
 * Procurement and any quotation detail view paid for it on navigation even
 * though a PDF is only produced when the user actually clicks Export/Download.
 *
 * These wrappers keep the exporters' signatures identical and defer the
 * `import()` to the click, so the jspdf chunk is fetched on first export and
 * then cached by the browser for the rest of the session.
 *
 * Import PDF exporters from THIS module, not from `pdfGenerator.js`. A static
 * import of that module anywhere puts jspdf back into that page's chunk.
 *
 * Every call site is a fire-and-forget `onClick` whose return value is
 * discarded, so returning a promise is transparent to them. A failed chunk
 * fetch (offline, stale deploy) is reported rather than swallowed.
 */

const load = () =>
  import(/* webpackChunkName: "pdf" */ './pdfGenerator');

function defer(name) {
  return (...args) =>
    load()
      .then((mod) => mod[name](...args))
      .catch((err) => {
        console.error(`[pdf] ${name} failed`, err);
      });
}

export const downloadQuotationPDF = defer('downloadQuotationPDF');
export const downloadInvoicePDF = defer('downloadInvoicePDF');
export const downloadPurchaseOrderPDF = defer('downloadPurchaseOrderPDF');
export const downloadZReportPDF = defer('downloadZReportPDF');
