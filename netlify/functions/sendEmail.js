import nodemailer from "nodemailer";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { to, subject, text, html } = JSON.parse(event.body || "{}");

  if (!to || !subject || (!text && !html)) {
    return { statusCode: 400, body: "Missing fields: to, subject, text/html" };
    }
  
  // Usa variables de entorno en Netlify UI (Site settings → Environment)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });

  return { statusCode: 200, body: "Email sent" };
}
