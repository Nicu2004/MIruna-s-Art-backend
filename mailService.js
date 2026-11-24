import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS =
  process.env.RESEND_FROM || "Miruna's Art <onboarding@resend.dev>";

export async function verifyConnection() {
  console.log("Resend configurat, gata de trimitere (fără SMTP).");
}

export async function sendMessage(params) {
  console.log("====================================");
  console.log(`the following code is being sent ${params.code}`);
  console.log("====================================");

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: params.email,
      subject: "Cod de verificare",
      text: `Salut, acesta este codul tău de verificare: ${params.code}`,
      html: `<p>Salut, acesta este codul tău de verificare: <strong>${params.code}</strong></p>`,
    });

    if (error) {
      console.error("Error while sending mail:", error);
      return;
    }

    console.log("Message sent:", data.id);
  } catch (err) {
    console.error("Error while sending mail:", err);
  }
}

export async function sendBulkEventEmail(recipients, event) {
  const dateFormatted = new Date(event.date).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const results = { sent: 0, failed: 0 };

  for (const recipient of recipients) {
    try {
      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: recipient.email,
        subject: `Eveniment nou: ${event.title}`,
        text: `Bună ziua ${recipient.name},\n\nLa data de ${dateFormatted} va avea loc "${event.title}", la ${event.location}.\n\n${event.description}`,
        html: `
          <p>Bună ziua <strong>${recipient.name}</strong>,</p>
          <p>La data de <strong>${dateFormatted}</strong> va avea loc
             "<strong>${event.title}</strong>", la <strong>${event.location}</strong>.</p>
          <p>${event.description}</p>
        `,
      });

      if (error) {
        console.error(`Eroare la trimiterea către ${recipient.email}:`, error);
        results.failed++;
      } else {
        results.sent++;
      }
    } catch (err) {
      console.error(`Eroare la trimiterea către ${recipient.email}:`, err);
      results.failed++;
    }
  }

  return results;
}

export async function sendInvoiceEmail(email, pdfBuffer, invoice) {
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `Factura ta — INV-${String(invoice.id).padStart(4, "0")}`,
    text: `Bună ziua,\n\nAtașat găsești factura pentru achiziția ta de la Miruna's Art.\n\nMulțumim!`,
    html: `<p>Bună ziua,</p><p>Atașat găsești factura pentru achiziția ta de la Miruna's Art.</p><p>Mulțumim!</p>`,
    attachments: [
      {
        filename: `factura-INV-${String(invoice.id).padStart(4, "0")}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  if (error) {
    console.error("Eroare la trimiterea facturii:", error);
    throw new Error(error.message);
  }
}
