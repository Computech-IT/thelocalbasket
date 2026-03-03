const { google } = require("googleapis");
require("dotenv").config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/oauth2callback";
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const EMAIL_USER = process.env.EMAIL_USER;

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

async function sendTestEmail() {
  try {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const raw = Buffer.from(
      `From: ${EMAIL_USER}\r\n` +
      `To: ${EMAIL_USER}\r\n` +
      `Subject: Test Email from Node.js\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
      `This is a test email sent using Gmail API.`
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    console.log("✅ Test email sent! Message ID:", res.data.id);
  } catch (err) {
    console.error("❌ Error sending test email:", err);
  }
}

sendTestEmail();
