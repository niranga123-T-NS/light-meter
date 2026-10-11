// Reading a PDF's text needs the web portal (pdf.js); on the phone app the rates are typed in instead.
export async function pdfText(_bytes: ArrayBuffer): Promise<string> {
  throw new Error('Reading the PDF works in the web portal – open the app in a browser, or type the rates in');
}
