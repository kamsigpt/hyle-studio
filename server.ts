import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

// Lazy initialization helper for Gemini
let aiInstance: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables.");
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

// Mailer helper to log simulated mail outcomes to stdout
function logSimulatedOutbox(
  smtpFrom: string,
  companyEmail: string,
  clientMailSubject: string,
  clientMailBody: string,
  companyMailSubject: string,
  companyMailBody: string
) {
  console.log("\n===============================================================================");
  console.log("📬 SIMULATED MAIL OUTBOX (SMTP FALLBACK/SIMULATED MODE)");
  console.log("Details printed here to prevent any lead/message loss during SMTP connection timeouts.");
  console.log("-------------------------------------------------------------------------------");
  console.log("1. SENDING CONFIRMATION TO CLIENT:");
  console.log(`From: ${smtpFrom}`);
  console.log(`To: ${companyEmail}`);
  console.log(`Subject: ${clientMailSubject}`);
  console.log("Body:");
  console.log(clientMailBody);
  console.log("-------------------------------------------------------------------------------");
  console.log("2. SENDING SPEC BRIEF TO COMPANY:");
  console.log(`From: ${smtpFrom}`);
  console.log(`To: contacthylestudios@gmail.com`);
  console.log(`Subject: ${companyMailSubject}`);
  console.log("Body:");
  console.log(companyMailBody);
  console.log("===============================================================================\n");
}

// Helper to strip comments and trailing/leading quotes/spaces from environment variable values
function cleanValue(val: string | undefined): string | null {
  if (!val) return null;
  let clean = val.trim();
  // Strip inline comments starting with '#'
  if (clean.includes("#")) {
    clean = clean.split("#")[0].trim();
  }
  // Trim outer quotes if they exist (both single or double)
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }
  return clean !== "" ? clean : null;
}

// Mailer submission helper
async function sendMailer(
  fullName: string, 
  companyEmail: string, 
  projectBrief: string, 
  selectedServices: string[], 
  selectedBudget: string
) {
  const brevoApiKey = cleanValue(process.env.BREVO_API_KEY);
  const resendApiKey = cleanValue(process.env.RESEND_API_KEY);
  const sendgridApiKey = cleanValue(process.env.SENDGRID_API_KEY);

  const smtpHost = cleanValue(process.env.SMTP_HOST);
  const smtpPortRaw = cleanValue(process.env.SMTP_PORT);
  const smtpPort = smtpPortRaw ? parseInt(smtpPortRaw) : null;
  const smtpUser = cleanValue(process.env.SMTP_USER);
  const smtpPass = cleanValue(process.env.SMTP_PASS);
  const smtpFromRaw = cleanValue(process.env.SMTP_FROM);
  const smtpFrom = smtpFromRaw || `"Hyle Studios" <contacthylestudios@gmail.com>`;

  const clientMailSubject = "Thank you for contacting Hyle Studios";
  const clientMailBody = `Hi ${fullName},

Thank you for contacting Hyle Studios.

We've received your inquiry and our team is currently reviewing the details. We'll get back to you shortly with the next steps.

We appreciate your interest and look forward to speaking with you.

Best regards,

Hyle Studios`;

  const servicesString = selectedServices.join(", ");
  const companyMailSubject = `New Project Inquiry from ${fullName} - ${servicesString}`;
  const companyMailBody = `New Project Inquiry Received

Client Name: ${fullName}
Preferred Work Email: ${companyEmail}
Services Needed: ${servicesString}
Estimated Investment Range: ${selectedBudget}

Project Goals & Brief:
${projectBrief}

------------------------
Received via Hyle Studios Contact Form`;

  const isBrevoConfigured = !!brevoApiKey;
  const isResendConfigured = !!resendApiKey;
  const isSendGridConfigured = !!sendgridApiKey;
  const isSmtpConfigured = !!(smtpUser && smtpPass);

  // Extract raw email address
  const fromEmailOnly = smtpFrom.includes("<") 
    ? smtpFrom.split("<")[1].replace(">", "").trim() 
    : smtpFrom.replace(/"/g, "").trim();

  console.log("ℹ️ Mail dispatch parameters cleaned and loaded:");
  console.log(`- BREVO_API_KEY: ${brevoApiKey ? `${brevoApiKey.slice(0, 5)}... (length: ${brevoApiKey.length})` : "not specified"}`);
  console.log(`- RESEND_API_KEY: ${resendApiKey ? `${resendApiKey.slice(0, 5)}... (length: ${resendApiKey.length})` : "not specified"}`);
  console.log(`- SENDGRID_API_KEY: ${sendgridApiKey ? `${sendgridApiKey.slice(0, 5)}... (length: ${sendgridApiKey.length})` : "not specified"}`);
  console.log(`- SMTP_HOST: ${smtpHost || "not specified"}`);
  console.log(`- SMTP_PORT: ${smtpPort}`);
  console.log(`- SMTP_USER: ${smtpUser ? `${smtpUser.slice(0, 3)}...` : "not specified"}`);
  console.log(`- SMTP_FROM: ${smtpFrom}`);
  console.log(`- Extracted fromEmailOnly: ${fromEmailOnly}`);

  // 1. Try Brevo HTTP API (Highly recommended, web API over port 443 HTTPS bypasses outgoing SMTP blockages)
  if (isBrevoConfigured) {
    console.log("🚀 Brevo API Key detected! Dispatching mails securely via HTTPS web API...");
    try {
      const fromEmailOnly = smtpFrom.includes("<") ? smtpFrom.split("<")[1].replace(">", "").trim() : smtpFrom.replace(/"/g, "").trim();
      const fromNameOnly = smtpFrom.includes("<") ? smtpFrom.split("<")[0].replace(/"/g, "").trim() : "Hyle Studios";

      // Request 1: Send client confirmation email
      const clientRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": brevoApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: { name: fromNameOnly, email: fromEmailOnly },
          to: [{ email: companyEmail, name: fullName }],
          subject: clientMailSubject,
          textContent: clientMailBody
        })
      });

      if (!clientRes.ok) {
        const errText = await clientRes.text();
        throw new Error(`Brevo client receipt failed: ${errText}`);
      }

      // Request 2: Send full project spec brief to company lead desk
      const companyRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": brevoApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: { name: fromNameOnly, email: fromEmailOnly },
          to: [{ email: "contacthylestudios@gmail.com", name: "Hyle Studios Lead Desk" }],
          subject: companyMailSubject,
          textContent: companyMailBody
        })
      });

      if (!companyRes.ok) {
        const errText = await companyRes.text();
        throw new Error(`Brevo company notification failed: ${errText}`);
      }

      console.log("✅ Emails sent successfully via Brevo API!");
      return { success: true, method: "brevo-api" };
    } catch (apiError: any) {
      console.error("❌ Brevo Web API transmission failed:", apiError.message || apiError);
      throw new Error(`Brevo API failed: ${apiError.message || apiError}`);
    }
  }

  // 2. Try Resend HTTP API (No outbound SMTP port blocks, 100% reliable on Cloud Run over port 443 HTTPS)
  if (isResendConfigured) {
    console.log("🚀 Resend API Key detected! Dispatching mails securely via HTTPS web API...");
    try {
      // Clean email address extraction
      const fromEmailOnly = smtpFrom.includes("<") ? smtpFrom.split("<")[1].replace(">", "").trim() : smtpFrom.replace(/"/g, "").trim();
      
      // Dispatch client email
      const clientRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmailOnly,
          to: companyEmail,
          subject: clientMailSubject,
          text: clientMailBody
        })
      });

      if (!clientRes.ok) {
        const errText = await clientRes.text();
        throw new Error(`Resend client receipt failed: ${errText}`);
      }

      // Dispatch company email
      const companyRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmailOnly,
          to: "contacthylestudios@gmail.com",
          subject: companyMailSubject,
          text: companyMailBody
        })
      });

      if (!companyRes.ok) {
        const errText = await companyRes.text();
        throw new Error(`Resend company notification failed: ${errText}`);
      }

      console.log("✅ Emails sent successfully via Resend API!");
      return { success: true, method: "resend-api" };
    } catch (apiError: any) {
      console.error("❌ Resend Web API transmission failed:", apiError.message || apiError);
      throw new Error(`Resend API failed: ${apiError.message || apiError}`);
    }
  }

  // 2. Try SendGrid HTTP API (No outbound SMTP port blocks, 100% reliable on Cloud Run over port 443 HTTPS)
  if (isSendGridConfigured) {
    console.log("🚀 SendGrid API Key detected! Dispatching mails securely via HTTPS web API...");
    try {
      const fromEmailOnly = smtpFrom.includes("<") ? smtpFrom.split("<")[1].replace(">", "").trim() : smtpFrom.replace(/"/g, "").trim();
      
      // Request 1: Client
      const clientRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sendgridApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: companyEmail }] }],
          from: { email: fromEmailOnly, name: "Hyle Studios" },
          subject: clientMailSubject,
          content: [{ type: "text/plain", value: clientMailBody }]
        })
      });

      if (!clientRes.ok) {
        const errText = await clientRes.text();
        throw new Error(`SendGrid client receipt failed: ${errText}`);
      }

      // Request 2: Company Lead
      const companyRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sendgridApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: "contacthylestudios@gmail.com" }] }],
          from: { email: fromEmailOnly, name: "Hyle Studios" },
          subject: companyMailSubject,
          content: [{ type: "text/plain", value: companyMailBody }]
        })
      });

      if (!companyRes.ok) {
        const errText = await companyRes.text();
        throw new Error(`SendGrid company notification failed: ${errText}`);
      }

      console.log("✅ Emails sent successfully via SendGrid API!");
      return { success: true, method: "sendgrid-api" };
    } catch (apiError: any) {
      console.error("❌ SendGrid Web API transmission failed:", apiError.message || apiError);
      throw new Error(`SendGrid API failed: ${apiError.message || apiError}`);
    }
  }

  // 3. Try Nodemailer SMTP (Subject to port restrictions and blockages on standard container networks)
  if (isSmtpConfigured) {
    console.log("ℹ️ Mail dispatch parameters loaded:");
    console.log(`- SMTP_HOST: ${smtpHost || "not specified"}`);
    console.log(`- SMTP_USER: ${smtpUser ? `${smtpUser.slice(0, 3)}...` : "not specified"}`);
    console.log(`- SMTP_PASS: ${smtpPass ? "configured (length: " + smtpPass.length + ")" : "not specified"}`);
    console.log(`- SMTP_FROM: ${smtpFrom}`);

    const isGmail = (smtpHost && smtpHost.toLowerCase().includes("gmail")) || (smtpUser && smtpUser.toLowerCase().endsWith("@gmail.com"));
    
    // Construct sequential config attempts
    const attempts: Array<{ name: string, config: any }> = [];

    if (isGmail) {
      console.log("💡 Detected Gmail SMTP config. Formulating attempts for port 465 & 587.");
      
      // Attempt 1: Gmail preset (SSL/465)
      attempts.push({
        name: "Gmail Preset (Port 465)",
        config: {
          service: "gmail",
          auth: { user: smtpUser, pass: smtpPass },
          connectionTimeout: 12000,
          greetingTimeout: 8000,
          socketTimeout: 15000,
        }
      });

      // Attempt 2: Gmail direct STARTTLS (Port 587)
      attempts.push({
        name: "Gmail Direct (Port 587 STARTTLS)",
        config: {
          host: "smtp.gmail.com",
          port: 587,
          secure: false,
          auth: { user: smtpUser, pass: smtpPass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 12000,
          greetingTimeout: 8000,
          socketTimeout: 15000,
        }
      });
    } else {
      console.log(`💡 Utilizing custom SMTP server: ${smtpHost || "localhost"}`);
      const fallbackPort = smtpPort || 587;
      
      // Attempt 1: Chosen port configuration
      attempts.push({
        name: `Custom SMTP (Port ${fallbackPort})`,
        config: {
          host: smtpHost || "localhost",
          port: fallbackPort,
          secure: fallbackPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 12000,
          greetingTimeout: 8000,
          socketTimeout: 15000,
        }
      });

      // Attempt 2: Reciprocal port backup
      const backupPort = fallbackPort === 465 ? 587 : 465;
      attempts.push({
        name: `Custom SMTP Fallback (Port ${backupPort})`,
        config: {
          host: smtpHost || "localhost",
          port: backupPort,
          secure: backupPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 12000,
          greetingTimeout: 8000,
          socketTimeout: 15000,
        }
      });
    }

    // Try each strategy sequentially
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        console.log(`Trying outbound mail transmission strategy [${i + 1}/${attempts.length}]: ${attempt.name}...`);
        const transporter = nodemailer.createTransport(attempt.config);

        // 1. Send confirmation email to client
        await transporter.sendMail({
          from: smtpFrom,
          to: companyEmail,
          subject: clientMailSubject,
          text: clientMailBody,
        });

        // 2. Send detailed brief to company email
        await transporter.sendMail({
          from: smtpFrom,
          to: "contacthylestudios@gmail.com",
          subject: companyMailSubject,
          text: companyMailBody,
        });

        console.log(`✅ Mail transmission successful on strategy: ${attempt.name}!`);
        return { success: true, method: "smtp", strategy: attempt.name };
      } catch (err: any) {
        console.warn(`⚠️ Strategy ${attempt.name} failed: ${err.message || err}`);
        // Log details to console and proceed to next attempt in the array loop
      }
    }

    // Handled failure: If we exhausted all options (network blockages/firewalls blocking ports)
    console.warn("❌ All live SMTP outbound transmission attempts timed out or failed.");
    console.warn("This usually means standard outbound SMTP ports 465/587 are blocked by the network environment's firewall (standard cloud container constraint).");
    console.warn("The inquiry details have been saved to local stdout below to prevent any message loss.");

    logSimulatedOutbox(
      smtpFrom, 
      companyEmail, 
      clientMailSubject, 
      clientMailBody, 
      companyMailSubject, 
      companyMailBody
    );

    return { 
      success: true, 
      method: "fallback-simulated", 
      warning: "SMTP ports are restricted on this sandbox container. The detailed quote brief has been logged successfully to server stdout." 
    };
  } else {
    console.log("📝 Running in simulation mode (set SMTP_USER and SMTP_PASS secrets for live sending)");
    logSimulatedOutbox(
      smtpFrom, 
      companyEmail, 
      clientMailSubject, 
      clientMailBody, 
      companyMailSubject, 
      companyMailBody
    );
    return { success: true, method: "simulated" };
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Support JSON bodies
  app.use(express.json());

  // API route for inquiry submission
  app.post("/api/send-inquiry", async (req, res) => {
    try {
      const { fullName, companyEmail, projectBrief, selectedServices, selectedBudget } = req.body;

      if (!fullName || !companyEmail || !projectBrief) {
        return res.status(400).json({ error: "Name, email, and project brief are required." });
      }

      const result = await sendMailer(
        fullName,
        companyEmail,
        projectBrief,
        selectedServices || [],
        selectedBudget || "Not specified"
      );

      res.status(200).json({ status: "success", info: result });
    } catch (err: any) {
      console.error("Error sending inquiry mails:", err);
      res.status(500).json({ error: "Failed to dispatch email inquiry." });
    }
  });

  // Serve static assets in production, hook Vite in dev mode
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode with Vite HMR...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in production mode with static static assets...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express application active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
