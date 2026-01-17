import nodemailer from "nodemailer";

// SMTP configuration for PrivateEmail.com
const SMTP_CONFIG = {
  host: "mail.privateemail.com",
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: "rewards@lukethedegen.com",
    pass: process.env.SMTP_PASSWORD,
  },
};

const FROM_EMAIL = "LukeRewards <rewards@lukethedegen.com>";

// Create reusable transporter
const transporter = nodemailer.createTransport(SMTP_CONFIG);

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<EmailResult> {
  try {
    const info = await transporter.sendMail({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ""), // Strip HTML for plain text version
    });

    console.log("[Email] Sent successfully:", {
      to,
      subject,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error("[Email] Failed to send:", {
      to,
      subject,
      error: err?.message,
    });
    return { success: false, error: err?.message || "Unknown error" };
  }
}

// Email templates
export async function sendPasswordResetEmail(
  to: string,
  username: string,
  resetLink: string
): Promise<EmailResult> {
  const subject = "Reset Your LukeRewards Password";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #ffffff; padding: 30px; border-radius: 10px;">
      <h1 style="color: #00ff88; margin-bottom: 20px;">Password Reset Request</h1>
      <p>Hi <strong>${username}</strong>,</p>
      <p>We received a request to reset your password for your LukeRewards account.</p>
      <p>Click the button below to reset your password:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background: #00ff88; color: #1a1a2e; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #888;">This link will expire in 1 hour.</p>
      <p style="color: #888;">If you didn't request this, you can safely ignore this email.</p>
      <hr style="border-color: #333; margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">LukeRewards Spins - rewards@lukethedegen.com</p>
    </div>
  `;

  return sendEmail(to, subject, html);
}

export async function sendVerificationApprovedEmail(
  to: string,
  username: string
): Promise<EmailResult> {
  const subject = "Your LukeRewards Account is Verified!";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #ffffff; padding: 30px; border-radius: 10px;">
      <h1 style="color: #00ff88; margin-bottom: 20px;">Account Verified!</h1>
      <p>Congratulations <strong>${username}</strong>!</p>
      <p>Your LukeRewards account has been verified. You now have full access to all features including:</p>
      <ul style="color: #cccccc; line-height: 1.8;">
        <li>Spin the wheel with your earned tickets</li>
        <li>Claim daily bonus spins</li>
        <li>Convert tickets between tiers</li>
        <li>Request withdrawals for your winnings</li>
      </ul>
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://lukerewards.com" style="background: #00ff88; color: #1a1a2e; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          Start Playing
        </a>
      </div>
      <p>Good luck and happy spinning!</p>
      <hr style="border-color: #333; margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">LukeRewards Spins - rewards@lukethedegen.com</p>
    </div>
  `;

  return sendEmail(to, subject, html);
}

export async function sendPasswordChangedEmail(
  to: string,
  username: string
): Promise<EmailResult> {
  const subject = "Your LukeRewards Password Has Been Changed";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #ffffff; padding: 30px; border-radius: 10px;">
      <h1 style="color: #00ff88; margin-bottom: 20px;">Password Changed</h1>
      <p>Hi <strong>${username}</strong>,</p>
      <p>Your LukeRewards password was successfully changed.</p>
      <p style="color: #888; margin-top: 20px;">If you did not make this change, please contact us immediately at rewards@lukethedegen.com</p>
      <hr style="border-color: #333; margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">LukeRewards Spins - rewards@lukethedegen.com</p>
    </div>
  `;

  return sendEmail(to, subject, html);
}

// Verify SMTP connection on startup (optional)
export async function verifyEmailConnection(): Promise<boolean> {
  try {
    await transporter.verify();
    console.log("[Email] SMTP connection verified");
    return true;
  } catch (err: any) {
    console.warn("[Email] SMTP connection failed:", err?.message);
    return false;
  }
}
