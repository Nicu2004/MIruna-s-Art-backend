import nodemailer from "nodemailer";

// Create a transporter using SMTP
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // use STARTTLS (upgrade connection to TLS after connecting)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export function verifyConnection() {}

try {
  await transporter.verify();
  console.log("Server is ready to take our messages");
} catch (err) {
  console.error("Verification failed:", err);
}

export async function sendMessage(params) {
  console.log("====================================");
  console.log(`the following code is being sent ${params.code}`);
  console.log("====================================");
  try {
    const info = await transporter.sendMail({
      from: `"Miruna's Art" <${process.env.SMTP_USER}>`,
      to: params.email,
      subject: "Cod de verificare",
      text: `Salut, acesta este codul tău de verificare: ${params.code}`,
      html: `<p>Salut, acesta este codul tău de verificare: <strong>${params.code}</strong></p>`,
    });

    console.log("Message sent: %s", info.messageId);
    // Preview URL is only available when using an Ethereal test account
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
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
      await transporter.sendMail({
        from: `"Miruna's Art" <${process.env.SMTP_USER}>`,
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
      results.sent++;
    } catch (err) {
      console.error(`Eroare la trimiterea către ${recipient.email}:`, err);
      results.failed++;
    }
  }

  return results;
}
