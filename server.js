// ========================
// server.js - Gmail API + Razorpay + Coupons + Products
// Production-ready
// ========================

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { google } = require("googleapis");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const multer = require("multer");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Required Environment Variables Check
const REQUIRED_ENV = ["SESSION_SECRET", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"];
REQUIRED_ENV.forEach(key => {
  if (!process.env[key] && NODE_ENV === "production") {
    console.warn(`⚠️ WARNING: Missing environment variable: ${key}. Features requiring this will fail.`);
  }
});

// ========================
// Database Setup
// ========================
const Database = require("better-sqlite3");
const db = new Database("./products.db");

// ========================
// Middleware & Security
// ========================
if (NODE_ENV === "production") {
  app.set("trust proxy", 1); // Needed for Hostinger/Reverse Proxies
}

app.use(cors({
  origin: NODE_ENV === "production" ? ["https://thelocalbasket.in", "https://www.thelocalbasket.in"] : true,
  credentials: true
}));

app.use(express.json({
  limit: "100kb", verify: (req, res, buf) => {
    if (req.originalUrl === "/razorpay-webhook") req.rawBody = buf;
  }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "public/images")));

// Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per window
  message: { success: false, error: "Too many login attempts, please try again later." }
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: "Too many requests from this IP, please try again later." }
});

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 order attempts per hour
  message: { success: false, error: "Too many order attempts, please try again later." }
});

app.use("/api/", generalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/test-email", authLimiter);
app.use("/create-razorpay-order", orderLimiter);

// Explicit routes for HTML files (improves reliability)
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public/login.html")));
app.get("/admin", isAdmin, (req, res) => res.sendFile(path.join(__dirname, "public/admin.html")));
app.get("/seller", isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, "public/seller.html")));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://apis.google.com"],
      "frame-src": ["'self'", "https://api.razorpay.com", "https://tds.razorpay.com", "https://checkout.razorpay.com"],
      "img-src": ["'self'", "data:", "https://*.razorpay.com"],
    },
  },
}));
app.disable("x-powered-by");

// ========================
// Session Setup
// ========================
app.use(session({
  store: new FileStore({ path: "./sessions" }),
  secret: process.env.SESSION_SECRET || "local-basket-dev-secret",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ========================
// Multer Setup (for Image Uploads)
// ========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/images/"),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ========================
// Razorpay Setup
// ========================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ========================
// Gmail API Setup
// ========================
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const EMAIL_USER = process.env.EMAIL_USER;

const REDIRECT_URI = NODE_ENV === "production"
  ? process.env.GMAIL_REDIRECT_URI
  : "http://localhost:3000/oauth2callback";

console.log("📧 Email config check:");
console.log("   CLIENT_ID:", CLIENT_ID ? "✅ Set" : "❌ Missing");
console.log("   CLIENT_SECRET:", CLIENT_SECRET ? "✅ Set" : "❌ Missing");
console.log("   REFRESH_TOKEN:", REFRESH_TOKEN ? "✅ Set" : "❌ Missing");
console.log("   EMAIL_USER:", EMAIL_USER ? "✅ Set" : "❌ Missing");
console.log("   REDIRECT_URI:", REDIRECT_URI);

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

// ========================
// Gmail Send Function
// ========================
async function sendGmail(to, subject, html) {
  try {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const encodedSubject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const rawMessage = Buffer.from(
      `From: "The Local Basket" <${EMAIL_USER}>\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${encodedSubject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      Buffer.from(html).toString("base64")
    ).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: rawMessage },
    });
    console.log(`✅ Gmail sent to ${to}, messageId: ${res.data.id}`);
    return res.data.id;
  } catch (err) {
    console.error("❌ Gmail send error:", err?.response?.data || err.message || err);
    throw err;
  }
}

// ========================
// Helpers
// ========================
const sanitize = (str = "") => String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrapEmail(title, body) {
  return `
  <div style="max-width:600px; margin:0 auto; border:1px solid #eee; border-radius:8px; overflow:hidden; font-family:Arial, sans-serif;">
    <div style="background:#198754; color:white; padding:15px; text-align:center;">
      <h2 style="margin:0;">The Local Basket</h2>
    </div>
    <div style="padding:20px; color:#333; line-height:1.6;">
      <h3 style="color:#198754;">${title}</h3>
      ${body}
      <p style="margin-top:20px; font-size:12px; color:#777;">This is an automated message. Do not reply.</p>
    </div>
    <div style="background:#f5f5f5; padding:10px; text-align:center; font-size:12px; color:#666;">
      © ${new Date().getFullYear()} The Local Basket
    </div>
  </div>`;
}

// ========================
// Auth Middlewares
// ========================
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ success: false, error: "Unauthorized" });
}

function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === "admin") return next();
  res.status(403).json({ success: false, error: "Access denied" });
}

// ========================
// Send Order Emails
// ========================
async function sendOrderEmails(orderData) {
  try {
    const sanitizedOrder = {
      ...orderData,
      shipping: {
        name: sanitize(orderData.shipping?.name || ""),
        email: sanitize(orderData.shipping?.email || ""),
        address: sanitize(orderData.shipping?.address || ""),
        phone: sanitize(orderData.shipping?.phone || ""),
        pincode: sanitize(orderData.shipping?.pincode || ""),
      },
      items: (orderData.items || []).map(item => ({ ...item, name: sanitize(item.name || "") })),
      couponCode: sanitize(orderData.coupon?.code || "NONE"),
      couponName: sanitize(orderData.coupon?.name || ""),
      discount: parseFloat(orderData.coupon?.discount || 0),
      grandTotal: parseFloat(orderData.grandTotal || 0),
      paymentId: sanitize(orderData.paymentId || "")
    };

    const itemsTable = `
      <table style="width:100%; border-collapse:collapse; margin-top:15px; font-family:'Segoe UI',Arial,sans-serif; font-size:14px;">
        <thead>
          <tr style="background:#198754; color:#fff;">
            <th style="text-align:left; padding:10px;">Item</th>
            <th style="text-align:right; padding:10px;">Rate (₹)</th>
            <th style="text-align:right; padding:10px;">Qty</th>
            <th style="text-align:right; padding:10px;">Total (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${(sanitizedOrder.items || []).map(item => `
            <tr style="border-bottom:1px solid #e0e0e0;">
              <td style="padding:8px;">${item.name}</td>
              <td style="padding:8px; text-align:right;">₹${(parseFloat(item.price) || 0).toFixed(2)}</td>
              <td style="padding:8px; text-align:right;">${item.qty}</td>
              <td style="padding:8px; text-align:right;">₹${((parseFloat(item.price) || 0) * (item.qty || 0)).toFixed(2)}</td>
            </tr>`).join("")}
          ${sanitizedOrder.couponCode !== "NONE" ? `
            <tr style="background:#fff8e1;">
              <td colspan="3" style="padding:10px; text-align:right; font-weight:600; color:#856404;">
                Coupon Applied: ${sanitizedOrder.couponName} (${sanitizedOrder.couponCode})
              </td>
              <td style="padding:10px; text-align:right; font-weight:600; color:#d9534f;">
                - ₹${sanitizedOrder.discount.toFixed(2)}
              </td>
            </tr>` : ""}
          <tr style="background:#f8f9fa;">
            <td colspan="3" style="padding:10px; text-align:right; font-weight:700;">Total (incl. shipping)</td>
            <td style="padding:10px; text-align:right; font-weight:700; color:#198754;">₹${sanitizedOrder.grandTotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    `;

    // Admin Email
    await sendGmail(
      process.env.RECEIVER_EMAIL,
      `🛒 New Order - ₹${sanitizedOrder.grandTotal.toFixed(2)}`,
      wrapEmail(
        "New Order Received",
        `
      <h2 style="margin-bottom:10px;">Customer Details</h2>
      <p><strong>Name:</strong> ${sanitizedOrder.shipping.name}</p>
      <p><strong>Address:</strong> ${sanitizedOrder.shipping.address}</p>
      <p><strong>Phone:</strong> ${sanitizedOrder.shipping.phone}</p>
      <p><strong>Email:</strong> ${sanitizedOrder.shipping.email}</p>
      <p><strong>Pincode:</strong> ${sanitizedOrder.shipping.pincode}</p>

      <h2 style="margin-top:20px; margin-bottom:10px;">Payment Details</h2>
      <p><strong>Payment ID:</strong> ${sanitizedOrder.paymentId}</p>

      <h2 style="margin-top:20px; margin-bottom:10px;">Coupon</h2>
      <p><strong>Coupon Used:</strong> ${sanitizedOrder.couponCode !== "NONE"
          ? `${sanitizedOrder.couponName} (${sanitizedOrder.couponCode})`
          : "No Coupon Used"
        }</p>

      <h2 style="margin-top:20px; margin-bottom:10px;">Order Items</h2>
      ${itemsTable}
    `
      )
    );

    // Customer Email
    await sendGmail(
      sanitizedOrder.shipping.email,
      `✅ Order Confirmation - ₹${sanitizedOrder.grandTotal.toFixed(2)}`,
      wrapEmail(
        "Order Confirmation",
        `
    <div style="padding:20px; font-family: 'Segoe UI', Arial, sans-serif; color:#333;">
      <p style="font-size:16px;">Hi <strong>${sanitizedOrder.shipping.name}</strong>,</p>
      <p style="font-size:16px;">Thank you for your order! Here’s a summary of your purchase:</p>
      
      <div style="background:#f8f9fa; border-radius:10px; padding:20px; box-shadow:0 4px 10px rgba(0,0,0,0.05); margin-top:20px;">
        <h3 style="color:#198754; margin-bottom:10px;">Payment Details</h3>
        <p style="margin:5px 0;"><strong>Payment ID:</strong> ${sanitizedOrder.paymentId}</p>
        
        <h3 style="color:#198754; margin:20px 0 10px;">Coupon</h3>
        <p style="margin:5px 0;"><strong>Coupon Used:</strong> ${sanitizedOrder.couponCode !== "NONE"
          ? `${sanitizedOrder.couponName} (${sanitizedOrder.couponCode})`
          : "No Coupon Used"
        }</p>
        
        <h3 style="color:#198754; margin:20px 0 10px;">Order Items</h3>
        ${itemsTable}
        
        <p style="margin-top:20px; font-size:16px; color:#555;">We appreciate your business and hope you enjoy your order!</p>
      </div>
      
      <p style="margin-top:30px; font-size:14px; color:#777;">If you have any questions, reply to this email or contact our support team.</p>
      <p style="font-size:14px; color:#777;">© ${new Date().getFullYear()} The Local Basket</p>
    </div>
    `
      )
    );


  } catch (err) {
    console.error("❌ [EMAIL ERROR]:", err);
  }
}

// ========================
// Routes
// ========================

// OAuth2 callback (for generating refresh token)
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    console.log("✅ Gmail API tokens received:", tokens);
    res.send("Gmail API authorized successfully! Copy the refresh_token to your .env");
  } catch (err) {
    console.error("❌ OAuth2 callback error:", err);
    res.status(500).send("Error exchanging code for token");
  }
});

// ========================
// Auth Routes
// ========================

// Login
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: "Missing credentials" });

  try {
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      business_name: user.business_name
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ success: false, error: "Login failed" });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get Current User
app.get("/api/auth/me", (req, res) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.json({ success: false, user: null });
  }
});

// Test email
app.post("/test-email", async (req, res) => {
  try {
    await sendGmail(
      process.env.RECEIVER_EMAIL,
      "Test Email - Local Basket",
      wrapEmail("Test Email", "<p>If you receive this, Gmail API is working correctly!</p>")
    );
    res.json({ success: true, message: "Test email sent!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Razorpay order creation
app.post("/create-razorpay-order", async (req, res) => {
  try {
    const { amount, currency, notes } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Invalid amount" });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: currency || "INR",
      receipt: "order_rcptid_" + Date.now(),
      notes: notes || {},
    });

    res.json({ success: true, order: { id: order.id, amount: order.amount, currency: order.currency, key_id: process.env.RAZORPAY_KEY_ID } });
  } catch (err) {
    console.error("❌ Razorpay order error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Razorpay webhook
app.post("/razorpay-webhook", async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const shasum = crypto.createHmac("sha256", webhookSecret);
      shasum.update(req.rawBody);
      const digest = shasum.digest("hex");
      if (digest !== req.headers["x-razorpay-signature"]) {
        return res.status(400).json({ status: "invalid signature" });
      }
    }

    const payment = req.body.payload?.payment?.entity || req.body.payment?.entity || req.body;
    if (!payment) return res.status(400).json({ status: "invalid payload" });

    const notes = payment.notes || {};
    const orderData = {
      paymentId: payment.id,
      grandTotal: (payment.amount || 0) / 100,
      shipping: notes.shipping ? JSON.parse(String(notes.shipping)) : {},
      items: notes.items ? JSON.parse(String(notes.items)) : [],
      coupon: notes.coupon ? JSON.parse(String(notes.coupon)) : null,
    };

    // 💰 Record Sale in Database
    const insertSale = db.prepare(`
      INSERT INTO sales (product_id, qty, total_price, customer_email, payment_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of orderData.items) {
      insertSale.run(item.id, item.qty, item.price * item.qty, orderData.shipping.email, orderData.paymentId);

      // Update inventory (optional but good)
      db.prepare("UPDATE products SET qty = qty - ? WHERE id = ?").run(item.qty, item.id);
    }

    sendOrderEmails(orderData).then(() => console.log("📧 [WEBHOOK] Emails sent."))
      .catch(err => console.error("❌ [WEBHOOK] Email send error:", err));

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Global BigInt serializer fix
BigInt.prototype.toJSON = function () { return Number(this); };

// Fetch products (public)
app.get("/api/products", (req, res) => {
  const { seller_id } = req.query;
  try {
    let query = `
      SELECT p.*, u.business_name 
      FROM products p 
      JOIN users u ON p.seller_id = u.id
    `;
    let params = [];

    if (seller_id) {
      query += " WHERE p.seller_id = ?";
      params.push(seller_id);
    }

    const products = db.prepare(query).all(...params);
    res.json({ success: true, products });
  } catch (err) {
    console.error("❌ [FETCH PRODUCTS] Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch products" });
  }
});

// Fetch all sellers (Admin gets all, Public gets only those with products)
app.get("/api/sellers", (req, res) => {
  try {
    const { all } = req.query;
    let sellers;
    if (all === "true" && req.session.user && req.session.user.role === "admin") {
      sellers = db.prepare("SELECT id, username, email, role, business_name FROM users WHERE role = 'seller'").all();
    } else {
      // Public view: only sellers with products
      sellers = db.prepare(`
        SELECT DISTINCT u.id, u.business_name 
        FROM users u
        JOIN products p ON u.id = p.seller_id
        WHERE u.role = 'seller' OR u.role = 'admin'
      `).all();
    }
    res.json({ success: true, sellers });
  } catch (err) {
    console.error("❌ [FETCH SELLERS] Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch sellers" });
  }
});

// Admin: Create New Seller
app.post("/api/admin/sellers", isAdmin, async (req, res) => {
  const { username, password, email, business_name } = req.body;

  if (!username || !password || !business_name) {
    return res.status(400).json({ success: false, error: "Username, Password, and Business Name are required." });
  }

  try {
    // Check if user exists
    const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (existing) return res.status(400).json({ success: false, error: "Username already exists" });

    const hashedPassword = bcrypt.hashSync(password, 10);
    const stmt = db.prepare("INSERT INTO users (username, password, email, role, business_name) VALUES (?, ?, ?, ?, ?)");
    const info = stmt.run(username, hashedPassword, email || "", "seller", business_name);

    res.json({ success: true, sellerId: Number(info.lastInsertRowid), message: "Seller account created!" });
  } catch (err) {
    console.error("❌ [CREATE SELLER] Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create seller: " + err.message });
  }
});

// Admin: Update Seller
app.put("/api/admin/sellers/:id", isAdmin, async (req, res) => {
  const { username, password, email, business_name } = req.body;
  const sellerId = req.params.id;

  try {
    let query = "UPDATE users SET username = ?, email = ?, business_name = ?";
    let params = [username, email || "", business_name];

    if (password) {
      query += ", password = ?";
      params.push(bcrypt.hashSync(password, 10));
    }

    query += " WHERE id = ? AND role = 'seller'";
    params.push(sellerId);

    const info = db.prepare(query).run(...params);
    if (info.changes === 0) return res.status(404).json({ success: false, error: "Seller not found" });

    res.json({ success: true, message: "Seller updated successfully" });
  } catch (err) {
    console.error("❌ [UPDATE SELLER] Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update seller" });
  }
});

// Admin: Delete Seller
app.delete("/api/admin/sellers/:id", isAdmin, (req, res) => {
  const sellerId = req.params.id;
  try {
    // Delete their products first as per plan
    db.prepare("DELETE FROM products WHERE seller_id = ?").run(sellerId);
    const info = db.prepare("DELETE FROM users WHERE id = ? AND role = 'seller'").run(sellerId);

    if (info.changes === 0) return res.status(404).json({ success: false, error: "Seller not found" });
    res.json({ success: true, message: "Seller and their products deleted" });
  } catch (err) {
    console.error("❌ [DELETE SELLER] Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to delete seller" });
  }
});

// Add Product (Authenticated)
app.post("/api/products", isAuthenticated, upload.single("image"), (req, res) => {
  console.log("📦 [ADD PRODUCT] Initiated...");
  const { name, description, price, qty } = req.body;

  if (!name || !price || !qty) {
    console.log("⚠️ [ADD PRODUCT] Validation failed:", { name, price, qty });
    return res.status(400).json({ success: false, error: "Missing required fields: Name, Price, and Quantity are required." });
  }

  const image = req.file ? `images/${req.file.filename}` : "images/placeholder.jpg";
  const seller_id = req.session.user.id;

  try {
    const stmt = db.prepare("INSERT INTO products (name, description, price, qty, image, seller_id) VALUES (?, ?, ?, ?, ?, ?)");
    const info = stmt.run(name, description || "", parseFloat(price), parseFloat(qty), image, seller_id);

    console.log("✅ [ADD PRODUCT] Success:", info);
    res.json({
      success: true,
      productId: Number(info.lastInsertRowid),
      message: "Product added successfully!"
    });
  } catch (err) {
    console.error("❌ [ADD PRODUCT] Database Error:", err.message);
    res.status(500).json({ success: false, error: "Database error: " + err.message });
  }
});

// Update Product (Authenticated)
app.put("/api/products/:id", isAuthenticated, upload.single("image"), (req, res) => {
  const { name, description, price, qty } = req.body;
  const productId = req.params.id;
  const seller_id = req.session.user.id;

  try {
    // Check if user owns the product OR is admin
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!product) return res.status(404).json({ success: false, error: "Product not found" });
    if (req.session.user.role !== "admin" && product.seller_id !== seller_id) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    let query = "UPDATE products SET name = ?, description = ?, price = ?, qty = ?";
    let params = [name, description, parseFloat(price), parseFloat(qty)];

    if (req.file) {
      query += ", image = ?";
      params.push(`images/${req.file.filename}`);
    }

    query += " WHERE id = ?";
    params.push(productId);

    db.prepare(query).run(...params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to update product" });
  }
});

// Delete Product (Authenticated)
app.delete("/api/products/:id", isAuthenticated, (req, res) => {
  const productId = req.params.id;
  const seller_id = req.session.user.id;

  try {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!product) return res.status(404).json({ success: false, error: "Product not found" });
    if (req.session.user.role !== "admin" && product.seller_id !== seller_id) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    db.prepare("DELETE FROM products WHERE id = ?").run(productId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to delete product" });
  }
});

// ========================
// Dashboard Stats
// ========================

// Admin Stats
app.get("/api/admin/dashboard", isAdmin, (req, res) => {
  try {
    const totalSales = db.prepare("SELECT SUM(total_price) as total FROM sales").get();
    const totalProducts = db.prepare("SELECT COUNT(*) as count FROM products").get();
    const totalSellers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'seller'").get();
    const recentSales = db.prepare(`
      SELECT s.*, p.name as product_name 
      FROM sales s 
      JOIN products p ON s.product_id = p.id 
      ORDER BY s.sale_date DESC LIMIT 10
    `).all();

    res.json({
      success: true,
      stats: {
        revenue: totalSales.total || 0,
        products: totalProducts.count,
        sellers: totalSellers.count
      },
      recentSales
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch dashboard" });
  }
});

// Seller Stats
app.get("/api/seller/dashboard", isAuthenticated, (req, res) => {
  const seller_id = req.session.user.id;
  try {
    const totalSales = db.prepare(`
      SELECT SUM(s.total_price) as total 
      FROM sales s 
      JOIN products p ON s.product_id = p.id 
      WHERE p.seller_id = ?
    `).get(seller_id);
    const totalProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE seller_id = ?").get(seller_id);
    const recentSales = db.prepare(`
      SELECT s.*, p.name as product_name 
      FROM sales s 
      JOIN products p ON s.product_id = p.id 
      WHERE p.seller_id = ? 
      ORDER BY s.sale_date DESC LIMIT 10
    `).all(seller_id);

    res.json({
      success: true,
      stats: {
        revenue: totalSales.total || 0,
        products: totalProducts.count
      },
      recentSales
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch dashboard" });
  }
});

// Fetch coupons
app.get("/api/coupons", (req, res) => {
  try {
    const coupons = db.prepare("SELECT * FROM coupons WHERE expires > datetime('now')").all();
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: "Failed to load coupons" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", service: "Email + Razorpay" });
});

// 404 handler
app.use((req, res) => res.status(404).json({ success: false, error: "Not found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running in ${NODE_ENV} mode at http://localhost:${PORT}`);
});

// Graceful Shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    db.close();
    console.log("Process terminated.");
  });
});
