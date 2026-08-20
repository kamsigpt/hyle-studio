export default async (request, context) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { fullName, companyEmail, projectBrief, selectedServices, selectedBudget } = body;

    if (!fullName || !companyEmail || !projectBrief) {
      return new Response(JSON.stringify({ error: "Name, email, and project brief are required." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const servicesString = (selectedServices || []).join(", ");

    const clientMailSubject = "Thank you for contacting Hyle Studios";
    const clientMailBody = `Hi ${fullName},

Thank you for contacting Hyle Studios.

We've received your inquiry and our team is currently reviewing the details. We'll get back to you shortly with the next steps.

We appreciate your interest and look forward to speaking with you.

Best regards,

Hyle Studios`;

    const companyMailSubject = `New Project Inquiry from ${fullName} - ${servicesString}`;
    const companyMailBody = `New Project Inquiry Received

Client Name: ${fullName}
Preferred Work Email: ${companyEmail}
Services Needed: ${servicesString}
Estimated Budget Amount: ${selectedBudget || "Not specified"}

Project Goals & Brief:
${projectBrief}

------------------------
Received via Hyle Studios Contact Form`;

    function cleanValue(val) {
      if (!val) return null;
      let clean = val.trim();
      if (clean.includes("#")) {
        clean = clean.split("#")[0].trim();
      }
      if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
        clean = clean.slice(1, -1).trim();
      }
      return clean !== "" ? clean : null;
    }

    const resendApiKey = cleanValue(process.env.RESEND_API_KEY);
    const sendgridApiKey = cleanValue(process.env.SENDGRID_API_KEY);
    const smtpUser = cleanValue(process.env.SMTP_USER);
    const smtpPass = cleanValue(process.env.SMTP_PASS);
    const smtpFromRaw = cleanValue(process.env.SMTP_FROM);
    const smtpFrom = smtpFromRaw || `"Hyle Studios" <onboarding@resend.dev>`;

    const studioRecipient = cleanValue(process.env.STUDIO_RECIPIENT_EMAIL) || "contacthylestudios@gmail.com";

    // 1. Try Resend API
    if (resendApiKey && resendApiKey.length > 10) {
      try {
        let resendFrom = "Hyle Studios <onboarding@resend.dev>";
        if (smtpFromRaw && smtpFromRaw.includes("@") && !smtpFromRaw.includes("gmail.com") && !smtpFromRaw.includes("contacthylestudios")) {
          resendFrom = smtpFromRaw;
        }

        const defaultRecipient = resendFrom.includes("onboarding@resend.dev")
          ? (cleanValue(process.env.RESEND_ACCOUNT_OWNER_EMAIL) || studioRecipient)
          : studioRecipient;

        const companyRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: resendFrom,
            to: defaultRecipient,
            subject: companyMailSubject,
            text: companyMailBody
          })
        });

        const clientRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: resendFrom,
            to: companyEmail,
            subject: clientMailSubject,
            text: clientMailBody
          })
        });

        if (companyRes.ok || clientRes.ok) {
          return new Response(JSON.stringify({ status: "success", info: { success: true, method: "resend-api" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.warn("Resend failed:", e.message);
      }
    }

    // 2. Try SendGrid API
    if (sendgridApiKey) {
      try {
        const fromEmailOnly = smtpFrom.includes("<")
          ? smtpFrom.split("<")[1].replace(">", "").trim()
          : smtpFrom.replace(/"/g, "").trim();

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

        if (clientRes.ok || companyRes.ok) {
          return new Response(JSON.stringify({ status: "success", info: { success: true, method: "sendgrid-api" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.warn("SendGrid failed:", e.message);
      }
    }

    // 3. Fallback: log the inquiry
    console.log("\n=== INQUIRY RECEIVED (No email provider configured) ===");
    console.log(`Name: ${fullName}`);
    console.log(`Email: ${companyEmail}`);
    console.log(`Services: ${servicesString}`);
    console.log(`Budget: ${selectedBudget || "Not specified"}`);
    console.log(`Brief: ${projectBrief}`);
    console.log("=====================================================\n");

    return new Response(JSON.stringify({
      status: "success",
      info: { success: true, method: "logged", message: "Inquiry received. Configure RESEND_API_KEY or SENDGRID_API_KEY for email delivery." }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Error processing inquiry:", err);
    return new Response(JSON.stringify({ error: "Failed to process inquiry." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/send-inquiry",
};
