const { google } = require("googleapis");
require("dotenv").config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/oauth2callback";

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// 1️⃣ Generate auth URL
const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline", // important! This gives refresh token
  scope: SCOPES,
  prompt: "consent",      // ensures refresh token is always returned
});

console.log("🔗 Open this URL in your browser:\n", authUrl);
console.log("\nAfter allowing access, you will get a code in the URL, like: ?code=XXXX\n");

// 2️⃣ Paste the code here to get tokens
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

readline.question("Enter the code from Google here: ", async (code) => {
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    oAuth2Client.setCredentials(tokens);

    console.log("\n✅ Your tokens:");
    console.log(tokens);
    console.log("\n💡 Save the refresh_token in your .env as GMAIL_REFRESH_TOKEN");
  } catch (err) {
    console.error("❌ Error getting token:", err);
  } finally {
    readline.close();
  }
});
