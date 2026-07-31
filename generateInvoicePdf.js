// npm install pdfkit

import PDFDocument from "pdfkit";

export function generateInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fontSize(20)
      .text("Miruna's Art", { align: "left" })
      .fontSize(10)
      .text("Factură fiscală", { align: "left" })
      .moveDown(2);

    doc
      .fontSize(12)
      .text(`Factură nr: INV-${String(invoice.id).padStart(4, "0")}`)
      .text(
        `Data emiterii: ${new Date(invoice.issuedAt).toLocaleDateString("ro-RO")}`,
      )
      .moveDown();

    doc
      .fontSize(12)
      .text("Client:", { underline: true })
      .fontSize(11)
      .text(invoice.customerName)
      .text(invoice.customerAddress)
      .moveDown();

    doc
      .fontSize(12)
      .text("Sumă achitată:", { underline: true })
      .fontSize(14)
      .text(`${Number(invoice.amountPaid).toLocaleString("ro-RO")} lei`)
      .moveDown(2);

    doc
      .fontSize(9)
      .fillColor("#666666")
      .text("Mulțumim pentru achiziție.", { align: "center" });

    doc.end();
  });
}
