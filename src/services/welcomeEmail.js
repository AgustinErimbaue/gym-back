import nodemailer from "nodemailer";

const requiredEmailSettings = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
];

export function isEmailConfigured() {
  const hasRequiredSettings = requiredEmailSettings.every((key) => Boolean(process.env[key]));
  const port = Number(process.env.SMTP_PORT);
  return hasRequiredSettings && Number.isInteger(port) && port > 0 && port <= 65535;
}

export function isReservedEmailAddress(email) {
  const domain = String(email).trim().toLowerCase().split("@").at(-1) ?? "";
  return domain === "invalid" || domain.endsWith(".invalid");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildRegistrationReceivedEmail({ member, plan, paymentUrl }) {
  const fullName = `${member.firstName} ${member.lastName}`;
  const planDescription = plan.description || "Consulta con nuestro equipo para conocer todos los detalles del plan.";
  const price = `$${Number(plan.price).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
  const duration = `${plan.durationDays} días`;
  const paymentInstructions = paymentUrl
    ? [
        paymentUrl.includes(".invalid/")
          ? "Este es un enlace ficticio de demostración. No abre un pago ni realiza ningún cobro:"
          : "Para completar tu inscripción y autorizar el cobro mensual, usa este enlace seguro de Mercado Pago:",
        paymentUrl,
        paymentUrl.includes(".invalid/")
          ? "No ingreses datos de pago. Para una inscripción real, el gimnasio debe habilitar Mercado Pago."
          : "El acceso se activa cuando Mercado Pago confirma el primer pago. No compartas este enlace.",
      ]
    : [
        "Nuestro equipo se pondrá en contacto contigo para completar el pago y confirmar tu alta.",
        "Esta solicitud no confirma una membresía ni habilita el acceso al gimnasio.",
      ];
  const paymentSection = paymentUrl
    ? `
        <p>${paymentUrl.includes(".invalid/")
          ? "Este es un enlace ficticio de demostración. No abre un pago ni realiza ningún cobro:"
          : "Para completar tu inscripción y autorizar el cobro mensual, usa este enlace seguro de Mercado Pago:"}</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(paymentUrl)}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#c6f36a;color:#10130f;font-weight:bold;text-decoration:none">
            ${paymentUrl.includes(".invalid/") ? "Ver enlace ficticio de prueba" : "Continuar al pago seguro"}
          </a>
        </p>
        <p>${paymentUrl.includes(".invalid/")
          ? "No ingreses datos de pago. Para una inscripción real, el gimnasio debe habilitar Mercado Pago."
          : "El acceso se activa cuando Mercado Pago confirma el primer pago. No compartas este enlace."}</p>
      `
    : `
        <p>Nuestro equipo se pondrá en contacto contigo para completar el pago y confirmar tu alta.</p>
        <p>Esta solicitud no confirma una membresía ni habilita el acceso al gimnasio.</p>
      `;

  return {
    from: process.env.SMTP_FROM,
    to: member.email,
    subject: `Recibimos tu solicitud de inscripción en IRONCORE`,
    text: [
      `Hola, ${fullName}.`,
      "",
      "Recibimos tu solicitud de inscripción en IRONCORE.",
      ...paymentInstructions,
      "",
      `Plan solicitado: ${plan.name}`,
      `Precio publicado: ${price}`,
      `Duración del plan: ${duration}`,
      "",
      "Beneficios informativos del plan:",
      planDescription,
      "",
      "El equipo de IRONCORE Gym Club",
    ].join("\n"),
    html: `
      <main style="max-width:600px;margin:0 auto;padding:32px;color:#20242c;font-family:Arial,sans-serif;line-height:1.6">
        <h1 style="color:#f07824">Recibimos tu solicitud</h1>
        <p>Hola ${escapeHtml(fullName)}, recibimos tu solicitud de inscripción en IRONCORE.</p>
        ${paymentSection}
        <h2>Plan solicitado: ${escapeHtml(plan.name)}</h2>
        <ul>
          <li><strong>Precio publicado:</strong> ${escapeHtml(price)}</li>
          <li><strong>Duración:</strong> ${escapeHtml(duration)}</li>
        </ul>
        <h2>Beneficios informativos</h2>
        <p>${escapeHtml(planDescription).replaceAll("\n", "<br>")}</p>
        <p>El equipo de IRONCORE Gym Club</p>
      </main>
    `,
  };
}

export async function sendRegistrationReceivedEmail({ member, plan, paymentUrl }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  await transporter.sendMail(buildRegistrationReceivedEmail({ member, plan, paymentUrl }));
}
