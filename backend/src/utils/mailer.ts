import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      ...(env.SMTP_USER
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    })
  : null;

export const loginUrl = () => `${env.CLIENT_URLS[0]}/auth-login`;

// Mail is best-effort: an SMTP outage must never fail the request that sent it.
// Awaited rather than fired off, because Vercel freezes the function once the
// response is sent.
export const sendMail = async (to: string, subject: string, text: string) => {
  if (!transport) {
    // Without SMTP in development, print the mail so reset links stay usable.
    if (!env.IS_PRODUCTION && env.NODE_ENV !== "test") {
      console.info(`[mail] SMTP not configured. To: ${to}\n${subject}\n\n${text}`);
    } else if (env.IS_PRODUCTION) {
      console.warn(`[mail] SMTP not configured; "${subject}" to ${to} not sent`);
    }
    return;
  }

  try {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
  } catch (error) {
    console.error(`[mail] Failed to send "${subject}" to ${to}:`, error);
  }
};

export const sendWelcomeEmail = (user: { name: string; email: string; role: string }) =>
  sendMail(
    user.email,
    "Your MiriSoft account is ready",
    `Hi ${user.name},

Your ${user.role.toLowerCase().replace(/_/g, " ")} account has been created.

Sign in: ${loginUrl()}
Email: ${user.email}

Use the passcode you were given, or choose "Forgot Code?" on the sign-in page to set your own.`
  );
