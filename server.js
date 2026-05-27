// ========================
// server.js - The Local Basket
// Production-Ready | MySQL + SQLite(pure JS) | Session Auth | Razorpay
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
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ========================
// Database Layer
// ========================
let dbPool = null;   // For MySQL
let dbWrapper = null; // Unified interface

async function getDb() {
  if (dbWrapper) return dbWrapper;

  const isMySQL = !!process.env.DB_HOST;

  if (isMySQL) {
    console.log("🛢️  Connecting to MySQL...");
    dbPool = mysql.createPool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000,
    });

    dbWrapper = {
      prepare: (sql) => ({
        run: async (...params) => {
          const [result] = await dbPool.execute(sql, params);
          return { lastInsertRowid: result.insertId, changes: result.affectedRows };
        },
        get: async (...params) => {
          const [rows] = await dbPool.execute(sql, params);
          return rows[0] || null;
        },
        all: async (...params) => {
          const [rows] = await dbPool.execute(sql, params);
          return rows;
        },
      }),
      raw: dbPool,
    };

    // Test connection
    try {
      const conn = await dbPool.getConnection();
      console.log("✅ MySQL connection test: SUCCESS");
      conn.release();
    } catch (err) {
      console.error("❌ MySQL connection test FAILED:", err.message);
      dbWrapper = null; // allow retry
      throw err;
    }

  } else {
    // Use pure-JS sqlite3 (works everywhere without native build)
    console.log("📂 Connecting to SQLite (pure JS)...");
    const sqlite3 = require("sqlite3").verbose();
    const { open } = require("sqlite");

    const sqliteDb = await open({
      filename: path.join(__dirname, "products.db"),
      driver: sqlite3.Database,
    });
    await sqliteDb.run("PRAGMA journal_mode=WAL");

    dbWrapper = {
      prepare: (sql) => ({
        run: async (...params) => {
          const result = await sqliteDb.run(sql, params);
          return { lastInsertRowid: result.lastID, changes: result.changes };
        },
        get: async (...params) => sqliteDb.get(sql, params),
        all: async (...params) => sqliteDb.all(sql, params),
      }),
      raw: sqliteDb,
    };
  }

  return dbWrapper;
}

// ========================
// Database Bootstrapping
// ========================
async function bootstrapDatabase() {
  console.log("🛠️  Bootstrapping database...");
  try {
    const db = await getDb();
    const isMySQL = !!process.env.DB_HOST;
    const PK = isMySQL ? "INTEGER PRIMARY KEY AUTO_INCREMENT" : "INTEGER PRIMARY KEY AUTOINCREMENT";

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id ${PK},
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'seller',
        email VARCHAR(255),
        business_name VARCHAR(255)
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS products (
        id ${PK},
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        qty DECIMAL(10,2) NOT NULL DEFAULT 0,
        image VARCHAR(255),
        seller_id INTEGER,
        FOREIGN KEY(seller_id) REFERENCES users(id)
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS sales (
        id ${PK},
        product_id INTEGER,
        qty INTEGER NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        customer_email VARCHAR(255),
        payment_id VARCHAR(255),
        shipping_info TEXT,
        items_json TEXT,
        coupon_json TEXT,
        grand_total DECIMAL(10,2),
        FOREIGN KEY(product_id) REFERENCES products(id)
      )
    `).run();

    // Add columns if they don't exist (safe for existing DBs)
    const alterCols = [
      { col: 'shipping_info', type: 'TEXT' },
      { col: 'items_json',    type: 'TEXT' },
      { col: 'coupon_json',   type: 'TEXT' },
      { col: 'grand_total',   type: 'DECIMAL(10,2)' },
    ];
    for (const { col, type } of alterCols) {
      try {
        await db.prepare(`ALTER TABLE sales ADD COLUMN ${col} ${type}`).run();
      } catch (_) { /* column already exists — ignore */ }
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS coupons (
        id ${PK},
        code VARCHAR(50) NOT NULL UNIQUE,
        type VARCHAR(50) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        min_purchase DECIMAL(10,2) DEFAULT 0,
        max_discount DECIMAL(10,2),
        expires DATETIME,
        message TEXT
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS customers (
        id ${PK},
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        phone VARCHAR(20)
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS wishlists (
        id ${PK},
        customer_id INTEGER,
        product_id INTEGER,
        FOREIGN KEY(customer_id) REFERENCES customers(id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        UNIQUE(customer_id, product_id)
      )
    `).run();

    // Seed default admin if none exists
    const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    if (!admin) {
      const hashed = bcrypt.hashSync("admin123", 10);
      await db.prepare("INSERT INTO users (username, password, role, email, business_name) VALUES (?, ?, ?, ?, ?)")
        .run("admin", hashed, "admin", "admin@thelocalbasket.in", "The Local Basket");
      console.log("✅ Default admin created — username: admin, password: admin123");
    }

    console.log("✅ Database ready.");
  } catch (err) {
    console.error("❌ Database bootstrap error:", err.message);
    // Non-fatal: server still starts, but DB-dependent routes will fail
  }
}

// Ensure sessions directory exists
try { fs.mkdirSync(path.join(__dirname, "sessions"), { recursive: true }); } catch (_) { }

// ========================
// Express App Setup
// ========================
if (NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(cors({
  origin: NODE_ENV === "production"
    ? ["https://thelocalbasket.in", "https://www.thelocalbasket.in"]
    : true,
  credentials: true,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://apis.google.com", "https://cdn.jsdelivr.net"],
      "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
      "frame-src": ["'self'", "https://api.razorpay.com", "https://tds.razorpay.com", "https://checkout.razorpay.com"],
      "img-src": ["'self'", "data:", "https://*.razorpay.com", "https://thelocalbasket.in", "https://www.thelocalbasket.in"],
      "connect-src": ["'self'", "https://api.razorpay.com", "https://lumberjack.razorpay.com", "https://thelocalbasket.in", "https://www.thelocalbasket.in", "https://cdn.jsdelivr.net"],
    },
  },
}));
app.disable("x-powered-by");

// Body parsing — raw body saved for webhook verification
app.use(express.json({
  limit: "200kb",
  verify: (req, _res, buf) => {
    if (req.originalUrl === "/razorpay-webhook") req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

// ========================
// Session
// ========================
const sessionSecret = process.env.SESSION_SECRET || "tlb-dev-secret-change-me";
app.use(session({
  store: new FileStore({
    path: path.join(__dirname, "sessions"),
    retries: 0,
    ttl: 86400,           // 24 hours
    reapInterval: 3600,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  name: "tlb.sid",
  cookie: {
    secure: NODE_ENV === "production",   // HTTPS only in prod
    httpOnly: true,
    sameSite: NODE_ENV === "production" ? "none" : "lax",
    maxAge: 86400 * 1000,
  },
}));

// ========================
// Rate Limiters
// ========================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: "Too many login attempts. Try again in 15 minutes." },
});
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: "Too many requests. Slow down." },
});
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { success: false, error: "Too many order attempts." },
});

app.use("/api/", generalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/create-razorpay-order", orderLimiter);

// ========================
// Auth Middlewares
// ========================
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ success: false, error: "Unauthorized. Please log in." });
}

function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === "admin") return next();
  return res.status(403).json({ success: false, error: "Forbidden. Admin access required." });
}

// ========================
// Static Files & Page Routes
// ========================
// Must come AFTER session middleware so admin/seller routes have access to req.session

// Root — explicit so Hostinger Nginx doesn't intercept
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Clean URLs for convenience
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/admin", isAdmin, (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/seller", isAuthenticated, (_req, res) => res.sendFile(path.join(__dirname, "public", "seller.html")));

// Static assets
app.use("/images", express.static(path.join(__dirname, "public", "images")));
app.use(express.static(path.join(__dirname, "public")));  // serves index.html for / as fallback

// Suppress favicon 404
app.get("/favicon.ico", (_req, res) => res.sendFile(path.join(__dirname, "public", "images", "logo.PNG"), { headers: { "Content-Type": "image/png" } }, () => res.status(204).end()));

// ========================
// Multer (Image Uploads)
// ========================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, "public", "images")),
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ========================
// Razorpay
// ========================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ========================
// Gmail API
// ========================
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  NODE_ENV === "production"
    ? process.env.GMAIL_REDIRECT_URI
    : "http://localhost:3000/oauth2callback"
);
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

async function sendGmail(to, subject, html) {
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const encodedSubject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const raw = Buffer.from(
    `From: "The Local Basket" <${process.env.EMAIL_USER}>\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${encodedSubject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    Buffer.from(html).toString("base64")
  ).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const result = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  console.log(`✅ Email sent to ${to}: messageId=${result.data.id}`);
  return result.data.id;
}

// ========================
// Helpers
// ========================
const sanitize = (str = "") => String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const safeNum = (v) => Number(v) || 0;

function wrapEmail(title, body) {
  return `
  <div style="max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif;">
    <div style="background:#198754;color:white;padding:15px;text-align:center;">
      <h2 style="margin:0;">The Local Basket</h2>
    </div>
    <div style="padding:20px;color:#333;line-height:1.6;">
      <h3 style="color:#198754;">${title}</h3>
      ${body}
      <p style="margin-top:20px;font-size:12px;color:#777;">This is an automated message. Do not reply.</p>
    </div>
    <div style="background:#f5f5f5;padding:10px;text-align:center;font-size:12px;color:#666;">
      © ${new Date().getFullYear()} The Local Basket
    </div>
  </div>`;
}

async function sendOrderEmails(orderData) {
  try {
    const s = {
      ...orderData,
      shipping: {
        name: sanitize(orderData.shipping?.name || ""),
        email: sanitize(orderData.shipping?.email || ""),
        address: sanitize(orderData.shipping?.address || ""),
        phone: sanitize(orderData.shipping?.phone || ""),
        pincode: sanitize(orderData.shipping?.pincode || ""),
      },
      items: (orderData.items || []).map(i => ({ ...i, name: sanitize(i.name || "") })),
      couponCode: sanitize(orderData.coupon?.code || "NONE"),
      couponName: sanitize(orderData.coupon?.name || ""),
      discount: safeNum(orderData.coupon?.discount),
      grandTotal: safeNum(orderData.grandTotal),
      paymentId: sanitize(orderData.paymentId || ""),
    };

    const itemsTable = `
      <table style="width:100%;border-collapse:collapse;margin-top:15px;font-size:14px;">
        <thead>
          <tr style="background:#198754;color:#fff;">
            <th style="text-align:left;padding:10px;">Item</th>
            <th style="text-align:right;padding:10px;">Rate (₹)</th>
            <th style="text-align:right;padding:10px;">Qty</th>
            <th style="text-align:right;padding:10px;">Total (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${s.items.map(item => `
            <tr style="border-bottom:1px solid #e0e0e0;">
              <td style="padding:8px;">${item.name}</td>
              <td style="padding:8px;text-align:right;">₹${safeNum(item.price).toFixed(2)}</td>
              <td style="padding:8px;text-align:right;">${item.qty}</td>
              <td style="padding:8px;text-align:right;">₹${(safeNum(item.price) * safeNum(item.qty)).toFixed(2)}</td>
            </tr>`).join("")}
          ${s.couponCode !== "NONE" ? `
            <tr style="background:#fff8e1;">
              <td colspan="3" style="padding:10px;text-align:right;font-weight:600;color:#856404;">
                Coupon: ${s.couponName} (${s.couponCode})
              </td>
              <td style="padding:10px;text-align:right;font-weight:600;color:#d9534f;">- ₹${s.discount.toFixed(2)}</td>
            </tr>` : ""}
          <tr style="background:#f8f9fa;">
            <td colspan="3" style="padding:10px;text-align:right;font-weight:700;">Total (incl. shipping)</td>
            <td style="padding:10px;text-align:right;font-weight:700;color:#198754;">₹${s.grandTotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>`;

    // Admin email
    await sendGmail(
      process.env.RECEIVER_EMAIL,
      `🛒 New Order - ₹${s.grandTotal.toFixed(2)}`,
      wrapEmail("New Order Received", `
        <h2>Customer Details</h2>
        <p><strong>Name:</strong> ${s.shipping.name}</p>
        <p><strong>Email:</strong> ${s.shipping.email}</p>
        <p><strong>Phone:</strong> ${s.shipping.phone}</p>
        <p><strong>Address:</strong> ${s.shipping.address}, ${s.shipping.pincode}</p>
        <p><strong>Payment ID:</strong> ${s.paymentId}</p>
        ${itemsTable}
      `)
    );

    // Customer email
    await sendGmail(
      s.shipping.email,
      `✅ Order Confirmed - ₹${s.grandTotal.toFixed(2)}`,
      wrapEmail("Order Confirmation", `
        <p>Hi <strong>${s.shipping.name}</strong>,</p>
        <p>Thank you for your order! Here's your summary:</p>
        <p><strong>Payment ID:</strong> ${s.paymentId}</p>
        ${itemsTable}
        <p style="margin-top:20px;">We'll process your order soon. Thank you for shopping with us! 🎁</p>
      `)
    );
  } catch (err) {
    console.error("❌ [EMAIL ERROR]:", err.message);
  }
}

// ========================
// Routes
// ========================

// OAuth2 callback
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    console.log("✅ Gmail tokens:", tokens);
    res.send("Gmail authorized! Copy the refresh_token to your .env");
  } catch (err) {
    console.error("❌ OAuth2 error:", err);
    res.status(500).send("OAuth2 error: " + err.message);
  }
});

// ========================
// Customer Endpoints
// ========================

app.post("/api/customer/register", async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  const cleanEmail = sanitize(email);
  if (!cleanEmail || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM customers WHERE email = ?").get(cleanEmail);
    if (existing) return res.status(400).json({ error: "Email already registered" });
    const hashed = bcrypt.hashSync(password, 10);
    const result = await db.prepare("INSERT INTO customers (email, password, full_name, phone) VALUES (?, ?, ?, ?)").run(cleanEmail, hashed, sanitize(full_name), sanitize(phone));
    req.session.customer_id = result.lastInsertRowid;
    req.session.customer_email = cleanEmail;
    res.json({ success: true, message: "Registered successfully" });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/customer/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT * FROM customers WHERE email = ?").get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    req.session.customer_id = user.id;
    req.session.customer_email = user.email;
    res.json({ success: true });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/customer/session", (req, res) => {
  if (req.session.customer_id) {
    res.json({ loggedIn: true, email: req.session.customer_email });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post("/api/customer/logout", (req, res) => {
  req.session.customer_id = null;
  req.session.customer_email = null;
  res.json({ success: true });
});

function isCustomer(req, res, next) {
  if (!req.session.customer_id) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/api/customer/orders", isCustomer, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT s.*, p.name as product_name, p.image as product_image 
      FROM sales s 
      JOIN products p ON s.product_id = p.id 
      WHERE s.customer_email = ? 
      ORDER BY s.sale_date DESC
    `).all(req.session.customer_email);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

app.get("/api/customer/orders/:id", isCustomer, async (req, res) => {
  try {
    const db = await getDb();
    // 1. Get the specific sale to find its payment_id
    const targetSale = await db.prepare("SELECT payment_id, sale_date FROM sales WHERE id = ? AND customer_email = ?").get(req.params.id, req.session.customer_email);
    
    if (!targetSale || !targetSale.payment_id) {
      return res.status(404).json({ error: "Invoice not found or unauthorized" });
    }

    // 2. Fetch all sales that belong to this exact checkout session (payment_id)
    const invoiceItems = await db.prepare(`
      SELECT s.*, p.name as product_name, p.price as unit_price
      FROM sales s
      JOIN products p ON s.product_id = p.id
      WHERE s.payment_id = ? AND s.customer_email = ?
    `).all(targetSale.payment_id, req.session.customer_email);

    // 3. Fetch customer details for the billing address
    const customer = await db.prepare("SELECT full_name, email, phone FROM customers WHERE email = ?").get(req.session.customer_email);

    res.json({
      invoice_id: targetSale.payment_id,
      date: targetSale.sale_date,
      customer: customer,
      items: invoiceItems
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load invoice details" });
  }
});

app.get("/api/customer/wishlist", isCustomer, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT w.id as wishlist_id, p.* 
      FROM wishlists w
      JOIN products p ON w.product_id = p.id
      WHERE w.customer_id = ?
    `).all(req.session.customer_id);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load wishlist" });
  }
});

app.post("/api/customer/wishlist", isCustomer, async (req, res) => {
  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: "Product required" });
  try {
    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM wishlists WHERE customer_id = ? AND product_id = ?").get(req.session.customer_id, product_id);
    if (existing) {
      await db.prepare("DELETE FROM wishlists WHERE id = ?").run(existing.id);
      res.json({ success: true, action: "removed" });
    } else {
      await db.prepare("INSERT INTO wishlists (customer_id, product_id) VALUES (?, ?)").run(req.session.customer_id, product_id);
      res.json({ success: true, action: "added" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update wishlist" });
  }
});

// ========================
// Auth Routes
// ========================

// Login
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  try {
    const db = await getDb();
    const user = await db.prepare("SELECT * FROM users WHERE username = ?").get(username);

    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid username or password." });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: "Invalid username or password." });
    }

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error("❌ Session regenerate error:", err);
        return res.status(500).json({ success: false, error: "Session error. Please try again." });
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        business_name: user.business_name || "",
      };

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("❌ Session save error:", saveErr);
          return res.status(500).json({ success: false, error: "Could not persist session. Please try again." });
        }

        console.log(`✅ Login: ${user.username} (${user.role})`);
        return res.json({
          success: true,
          user: req.session.user,
          redirect: user.role === "admin" ? "/admin" : "/seller",
        });
      });
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ success: false, error: "Server error during login. Please try again." });
  }
});

// Update Password
app.post("/api/auth/update-password", async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;
  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ success: false, error: "All fields are required" });
  }
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT * FROM users WHERE username = ?").get(sanitize(username));
    if (!user || !bcrypt.compareSync(oldPassword, user.password)) {
      return res.status(401).json({ success: false, error: "Invalid username or current password." });
    }
    const hashed = bcrypt.hashSync(newPassword, 10);
    await db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, user.id);
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("❌ Update password error:", err);
    res.status(500).json({ success: false, error: "Server error. Please try again." });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error("❌ Logout error:", err);
    res.clearCookie("tlb.sid");
    res.json({ success: true, message: "Logged out." });
  });
});

// Current user
app.get("/api/auth/me", (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ success: true, user: req.session.user });
  }
  res.json({ success: false, user: null });
});

// Test email
app.post("/test-email", async (req, res) => {
  try {
    await sendGmail(
      process.env.RECEIVER_EMAIL,
      "Test Email — The Local Basket",
      wrapEmail("Test", "<p>If you see this, Gmail API is working! ✅</p>")
    );
    res.json({ success: true, message: "Test email sent!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================
// Razorpay Routes (UNTOUCHED)
// ========================
app.post("/create-razorpay-order", async (req, res) => {
  try {
    const { amount, currency, notes } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Invalid amount" });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: currency || "INR",
      receipt: "rcpt_" + Date.now(),
      notes: notes || {},
    });

    res.json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (err) {
    console.error("❌ Razorpay order error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/razorpay-webhook", async (req, res) => {
  try {
    const incomingSig = req.headers["x-razorpay-signature"] || "";
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Detect DEV-mode simulated payments (payment ID starts with "DEV-")
    const rawPayment = req.body.payload?.payment?.entity || req.body.payment?.entity || req.body;
    const isDevMode  = String(rawPayment?.id || "").startsWith("DEV-");

    if (!isDevMode && webhookSecret) {
      // Production: enforce HMAC signature verification
      const digest = crypto.createHmac("sha256", webhookSecret).update(req.rawBody).digest("hex");
      if (digest !== incomingSig) {
        console.warn("❌ Webhook signature mismatch — ignoring.");
        return res.status(400).json({ status: "invalid signature" });
      }
    } else if (isDevMode) {
      console.log("🧪 DEV-mode webhook — skipping signature check.");
    }

    const payment = rawPayment;
    if (!payment) return res.status(400).json({ status: "invalid payload" });

    const notes = payment.notes || {};
    const orderData = {
      paymentId: payment.id,
      grandTotal: isDevMode ? safeNum(payment.amount) / 100 : (payment.amount || 0) / 100,
      shipping: notes.shipping ? JSON.parse(String(notes.shipping)) : {},
      items:    notes.items    ? JSON.parse(String(notes.items))    : [],
      coupon:   notes.coupon   ? JSON.parse(String(notes.coupon))   : null,
    };

    const db = await getDb();
    const shippingJson = JSON.stringify(orderData.shipping || {});
    const itemsJson    = JSON.stringify(orderData.items   || []);
    const couponJson   = JSON.stringify(orderData.coupon  || {});
    const grandTotal   = safeNum(orderData.grandTotal);

    const insertSale = db.prepare(
      "INSERT INTO sales (product_id, qty, total_price, customer_email, payment_id, shipping_info, items_json, coupon_json, grand_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    for (const item of orderData.items) {
      await insertSale.run(
        item.id, item.qty,
        safeNum(item.price) * safeNum(item.qty),
        orderData.shipping.email, orderData.paymentId,
        shippingJson, itemsJson, couponJson, grandTotal
      );
      await db.prepare("UPDATE products SET qty = qty - ? WHERE id = ?").run(item.qty, item.id);
    }

    sendOrderEmails(orderData)
      .then(() => console.log("📧 Webhook emails sent."))
      .catch(err => console.error("❌ Webhook email error:", err.message));

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// BigInt serialisation fix
BigInt.prototype.toJSON = function () { return Number(this); };

// ========================
// Public Receipt Endpoint (called by thankyou.html)
// ========================
app.get("/api/receipt/:paymentId", async (req, res) => {
  try {
    const db = await getDb();
    const paymentId = req.params.paymentId;

    // Fetch one row (they all share the same snapshot JSON columns)
    const row = await db.prepare(
      "SELECT shipping_info, items_json, coupon_json, grand_total, sale_date, customer_email FROM sales WHERE payment_id = ? LIMIT 1"
    ).get(paymentId);

    if (!row) {
      // Order might have been DEV-simulated before columns existed — return 404 gracefully
      return res.status(404).json({ success: false, error: "Receipt not found" });
    }

    const shipping = (() => { try { return JSON.parse(row.shipping_info || '{}'); } catch(_) { return {}; } })();
    const items    = (() => { try { return JSON.parse(row.items_json    || '[]'); } catch(_) { return []; } })();
    const coupon   = (() => { try { return JSON.parse(row.coupon_json   || '{}'); } catch(_) { return {}; } })();

    res.json({
      success: true,
      payment_id: paymentId,
      date: row.sale_date,
      grand_total: safeNum(row.grand_total),
      customer_email: row.customer_email,
      shipping,
      items,
      coupon,
    });
  } catch (err) {
    console.error("❌ Receipt error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================
// Product Routes
// ========================
app.get("/api/products", async (req, res) => {
  const { seller_id } = req.query;
  try {
    const db = await getDb();
    let query = `
      SELECT p.*, CAST(p.price AS DECIMAL(10,2)) as price, CAST(p.qty AS DECIMAL(10,2)) as qty,
             u.business_name
      FROM products p
      LEFT JOIN users u ON p.seller_id = u.id
    `;
    const params = [];
    if (seller_id) {
      query += " WHERE p.seller_id = ?";
      params.push(seller_id);
    }

    const products = await db.prepare(query).all(...params);
    // Ensure numeric types for frontend safety
    const normalized = products.map(p => ({
      ...p,
      price: safeNum(p.price),
      qty: safeNum(p.qty),
    }));
    console.log(`🔍 [Products] Returned ${normalized.length} products.`);
    res.json({ success: true, products: normalized });
  } catch (err) {
    console.error("❌ [Products] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/products", isAuthenticated, upload.single("image"), async (req, res) => {
  const { name, description, price, qty } = req.body;
  if (!name || !price || !qty) {
    return res.status(400).json({ success: false, error: "Name, Price and Quantity are required." });
  }
  const image = req.file ? `images/${req.file.filename}` : "images/placeholder.jpg";
  const seller_id = req.session.user.id;

  try {
    const db = await getDb();
    const info = await db.prepare(
      "INSERT INTO products (name, description, price, qty, image, seller_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(sanitize(name), sanitize(description || ""), safeNum(price), safeNum(qty), image, seller_id);

    res.json({ success: true, productId: Number(info.lastInsertRowid), message: "Product added!" });
  } catch (err) {
    console.error("❌ [Add Product] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/products/:id", isAuthenticated, upload.single("image"), async (req, res) => {
  const { name, description, price, qty } = req.body;
  const productId = req.params.id;

  try {
    const db = await getDb();
    const product = await db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!product) return res.status(404).json({ success: false, error: "Product not found." });
    if (req.session.user.role !== "admin" && product.seller_id !== req.session.user.id) {
      return res.status(403).json({ success: false, error: "Forbidden." });
    }

    let query = "UPDATE products SET name = ?, description = ?, price = ?, qty = ?";
    const params = [sanitize(name), sanitize(description || ""), safeNum(price), safeNum(qty)];

    if (req.file) {
      query += ", image = ?";
      params.push(`images/${req.file.filename}`);
    }
    query += " WHERE id = ?";
    params.push(productId);

    await db.prepare(query).run(...params);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Update Product] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/products/:id", isAuthenticated, async (req, res) => {
  const productId = req.params.id;
  try {
    const db = await getDb();
    const product = await db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!product) return res.status(404).json({ success: false, error: "Product not found." });
    if (req.session.user.role !== "admin" && product.seller_id !== req.session.user.id) {
      return res.status(403).json({ success: false, error: "Forbidden." });
    }
    await db.prepare("DELETE FROM products WHERE id = ?").run(productId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================
// Seller Routes
// ========================
app.get("/api/sellers", async (req, res) => {
  try {
    const db = await getDb();
    let sellers;
    if (req.query.all === "true" && req.session.user?.role === "admin") {
      sellers = await db.prepare(
        "SELECT id, username, email, role, business_name FROM users WHERE role = 'seller'"
      ).all();
    } else {
      sellers = await db.prepare(`
        SELECT DISTINCT u.id, u.business_name
        FROM users u
        LEFT JOIN products p ON u.id = p.seller_id
        WHERE u.role = 'seller' OR u.role = 'admin'
      `).all();
    }
    res.json({ success: true, sellers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/admin/sellers", isAdmin, async (req, res) => {
  const { username, password, email, business_name } = req.body;
  if (!username || !password || !business_name) {
    return res.status(400).json({ success: false, error: "Username, password and business name are required." });
  }
  try {
    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) return res.status(400).json({ success: false, error: "Username already exists." });

    const hashed = bcrypt.hashSync(password, 10);
    const info = await db.prepare(
      "INSERT INTO users (username, password, email, role, business_name) VALUES (?, ?, ?, 'seller', ?)"
    ).run(sanitize(username), hashed, sanitize(email || ""), sanitize(business_name));

    res.json({ success: true, sellerId: Number(info.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/admin/sellers/:id", isAdmin, async (req, res) => {
  const { username, password, email, business_name } = req.body;
  const id = req.params.id;
  try {
    const db = await getDb();
    let query = "UPDATE users SET username = ?, email = ?, business_name = ?";
    const params = [sanitize(username), sanitize(email || ""), sanitize(business_name)];
    if (password) { query += ", password = ?"; params.push(bcrypt.hashSync(password, 10)); }
    query += " WHERE id = ? AND role = 'seller'";
    params.push(id);
    const info = await db.prepare(query).run(...params);
    if (info.changes === 0) return res.status(404).json({ success: false, error: "Seller not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/admin/sellers/:id", isAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const db = await getDb();
    await db.prepare("DELETE FROM products WHERE seller_id = ?").run(id);
    const info = await db.prepare("DELETE FROM users WHERE id = ? AND role = 'seller'").run(id);
    if (info.changes === 0) return res.status(404).json({ success: false, error: "Seller not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================
// Dashboard Routes
// ========================
app.get("/api/admin/dashboard", isAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const totalSales = await db.prepare("SELECT COALESCE(SUM(total_price), 0) as total FROM sales").get();
    const totalProducts = await db.prepare("SELECT COUNT(*) as count FROM products").get();
    const totalSellers = await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'seller'").get();
    const recentSales = await db.prepare(`
      SELECT s.*, p.name as product_name
      FROM sales s
      LEFT JOIN products p ON s.product_id = p.id
      ORDER BY s.sale_date DESC LIMIT 10
    `).all();

    res.json({
      success: true,
      stats: {
        revenue: safeNum(totalSales.total),
        products: safeNum(totalProducts.count),
        sellers: safeNum(totalSellers.count),
      },
      recentSales: recentSales.map(s => ({
        ...s,
        total_price: safeNum(s.total_price),
      })),
    });
  } catch (err) {
    console.error("❌ [Admin Dashboard] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Full sales list grouped by payment_id with all receipt data
app.get("/api/admin/sales", isAdmin, async (req, res) => {
  try {
    const db = await getDb();
    // Get one representative row per payment_id (latest sale in that checkout)
    const rows = await db.prepare(`
      SELECT
        s.payment_id,
        MAX(s.sale_date)  AS sale_date,
        s.customer_email,
        s.shipping_info,
        s.items_json,
        s.coupon_json,
        MAX(s.grand_total) AS grand_total,
        SUM(s.total_price) AS items_total,
        COUNT(*) AS item_count
      FROM sales s
      GROUP BY s.payment_id
      ORDER BY MAX(s.sale_date) DESC
    `).all();

    res.json({
      success: true,
      orders: rows.map(r => ({
        payment_id:    r.payment_id,
        sale_date:     r.sale_date,
        customer_email: r.customer_email,
        grand_total:   safeNum(r.grand_total || r.items_total),
        item_count:    safeNum(r.item_count),
        shipping: (() => { try { return JSON.parse(r.shipping_info || '{}'); } catch(_) { return {}; } })(),
        items:    (() => { try { return JSON.parse(r.items_json    || '[]'); } catch(_) { return []; } })(),
        coupon:   (() => { try { return JSON.parse(r.coupon_json   || '{}'); } catch(_) { return {}; } })(),
      })),
    });
  } catch (err) {
    console.error("❌ [Admin Sales] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/seller/dashboard", isAuthenticated, async (req, res) => {
  const seller_id = req.session.user.id;
  try {
    const db = await getDb();
    const totalSales = await db.prepare(`
      SELECT COALESCE(SUM(s.total_price), 0) as total
      FROM sales s
      JOIN products p ON s.product_id = p.id
      WHERE p.seller_id = ?
    `).get(seller_id);
    const totalProducts = await db.prepare("SELECT COUNT(*) as count FROM products WHERE seller_id = ?").get(seller_id);
    const recentSales = await db.prepare(`
      SELECT s.*, p.name as product_name
      FROM sales s
      JOIN products p ON s.product_id = p.id
      WHERE p.seller_id = ?
      ORDER BY s.sale_date DESC LIMIT 10
    `).all(seller_id);

    res.json({
      success: true,
      stats: {
        revenue: safeNum(totalSales.total),
        products: safeNum(totalProducts.count),
      },
      recentSales: recentSales.map(s => ({
        ...s,
        total_price: safeNum(s.total_price),
      })),
    });
  } catch (err) {
    console.error("❌ [Seller Dashboard] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================
// Coupons
// ========================
app.get("/api/coupons", async (req, res) => {
  try {
    const db = await getDb();
    const isMySQL = !!process.env.DB_HOST;
    const now = isMySQL ? "NOW()" : "datetime('now')";
    const coupons = await db.prepare(`SELECT * FROM coupons WHERE expires > ${now}`).all();
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: "Failed to load coupons" });
  }
});

// ========================
// Diagnostics
// ========================
app.get("/health", (_req, res) => {
  res.json({ status: "OK", env: NODE_ENV, time: new Date().toISOString() });
});

app.get("/api/db-test", async (req, res) => {
  const dbType = process.env.DB_HOST ? "mysql" : "sqlite";
  const startTime = Date.now();

  console.log(`\n🔬 [DB-TEST] Starting database diagnostic (${dbType})...`);
  console.log(`   DB_HOST:     ${process.env.DB_HOST || "(not set — using SQLite)"}`);
  console.log(`   DB_USER:     ${process.env.DB_USER || "(not set)"}`);
  console.log(`   DB_NAME:     ${process.env.DB_NAME || "(not set)"}`);
  console.log(`   DB_PORT:     ${process.env.DB_PORT || "3306 (default)"}`);
  console.log(`   NODE_ENV:    ${NODE_ENV}`);

  try {
    const db = await getDb();

    // 1. Basic connectivity
    const pingResult = await db.prepare("SELECT 1 as ping").get();
    console.log("   ✅ SELECT 1:", pingResult);

    // 2. Tables
    let tables = [];
    if (dbType === "mysql") {
      tables = await db.prepare("SHOW TABLES").all();
    } else {
      tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    }
    console.log("   ✅ Tables found:", tables);

    // 3. Row counts
    const userCount = await db.prepare("SELECT COUNT(*) as c FROM users").get();
    const productCount = await db.prepare("SELECT COUNT(*) as c FROM products").get();
    const salesCount = await db.prepare("SELECT COUNT(*) as c FROM sales").get();
    console.log(`   ✅ Users: ${userCount.c}, Products: ${productCount.c}, Sales: ${salesCount.c}`);

    const elapsed = Date.now() - startTime;
    console.log(`🔬 [DB-TEST] Complete in ${elapsed}ms\n`);

    res.json({
      success: true,
      database: dbType,
      connection: "READY",
      elapsed_ms: elapsed,
      tables: tables,
      counts: {
        users: safeNum(userCount.c),
        products: safeNum(productCount.c),
        sales: safeNum(salesCount.c),
      },
      config: {
        host: process.env.DB_HOST || "localhost (SQLite)",
        user: process.env.DB_USER || "n/a",
        db: process.env.DB_NAME || "products.db",
        port: process.env.DB_PORT || "3306",
      },
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [DB-TEST] FAILED after ${elapsed}ms:`, err.message);
    res.status(500).json({
      success: false,
      database: dbType,
      connection: "FAILED",
      elapsed_ms: elapsed,
      error: err.message,
      error_code: err.code,
      config: {
        host: process.env.DB_HOST || "(not set — sqlite fallback)",
        user: process.env.DB_USER || "(not set)",
        db: process.env.DB_NAME || "(not set)",
        port: process.env.DB_PORT || "3306",
      },
      hints: [
        "If error is ECONNREFUSED: MySQL is not running or wrong host/port.",
        "If error is ER_ACCESS_DENIED: Wrong username or password.",
        "If error is ENOTFOUND: DB_HOST is wrong or not resolvable.",
        "If you see 'no such module: better-sqlite3': install sqlite3 package (npm i sqlite3 sqlite).",
      ],
    });
  }
});

// ========================
// 404 & Error Handlers
// ========================
app.use((_req, res) => res.status(404).json({ success: false, error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("💥 Unhandled error:", err.stack);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// ========================
// Start
// ========================
bootstrapDatabase().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`\n🚀 The Local Basket running in ${NODE_ENV} mode on port ${PORT}\n`);
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM: shutting down...");
    server.close(async () => {
      if (dbPool && typeof dbPool.end === "function") await dbPool.end();
      console.log("Goodbye.");
    });
  });
}).catch(err => {
  console.error("❌ Fatal startup error:", err);
  process.exit(1);
});
