import nodemailer from "nodemailer";
import { logger } from "./logger";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM ?? "noreply@qa-assistant.app";

let transporter: nodemailer.Transporter | null = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export const isEmailConfigured = !!transporter;

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<boolean> {
  if (!transporter) {
    // Redact the token from the URL before logging to avoid leaking credentials
    // even in development logs. The URL contains a one-time token — never log it.
    const redactedUrl = resetUrl.replace(/token=[^&]+/, "token=REDACTED");
    logger.info({ to, resetUrl: redactedUrl }, "SMTP not configured — password reset email not sent (development mode)");
    return false;
  }

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: "Reset your QA Assistant password",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; background: #0f1117; color: #e4e4e7; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-flex; align-items: center; gap: 10px; margin-bottom: 8px;">
              <div style="width: 40px; height: 40px; background: rgba(139,92,246,0.15); border-radius: 10px; border: 1px solid rgba(139,92,246,0.3); display: flex; align-items: center; justify-content: center;">
                🛡
              </div>
              <span style="font-size: 20px; font-weight: 800; color: #fff;">QA<span style="color: #8B5CF6;">Assistant</span></span>
            </div>
          </div>

          <h1 style="font-size: 22px; font-weight: 700; color: #fff; margin: 0 0 12px;">Reset your password</h1>
          <p style="color: #a1a1aa; font-size: 15px; line-height: 1.6; margin: 0 0 28px;">
            Someone requested a password reset for your QA Assistant account. Click the button below to set a new password.
            This link expires in <strong style="color: #e4e4e7;">1 hour</strong>.
          </p>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, hsl(258,85%,60%), hsl(258,85%,52%)); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 15px; letter-spacing: 0.01em;">
              Reset Password →
            </a>
          </div>

          <p style="color: #52525b; font-size: 13px; line-height: 1.6; margin: 28px 0 0; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06);">
            If you didn't request this, you can safely ignore this email. Your password will not change.
          </p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send password reset email");
    return false;
  }
}
