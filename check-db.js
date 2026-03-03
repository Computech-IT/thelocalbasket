/**
 * Database Diagnostic Script for Hostinger
 * Run this with: node check-db.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function check() {
    console.log("🔍 Starting Database Diagnostics...");
    console.log("------------------------------------");

    const config = {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    };

    console.log(`📡 Attempting to connect to: ${config.host}:${config.port}`);
    console.log(`👤 User: ${config.user}`);
    console.log(`📂 DB Name: ${config.database}`);
    console.log("------------------------------------");

    if (!config.host) {
        console.error("❌ ERROR: DB_HOST is missing in .env!");
        return;
    }

    try {
        // Step 1: Raw Connection
        console.log("⏳ Step 1: Testing basic connection...");
        const connection = await mysql.createConnection({
            host: config.host,
            user: config.user,
            password: config.password,
            port: config.port
        });
        console.log("✅ Step 1 SUCCESS: Connection established.");

        // Step 2: Database Access
        console.log(`⏳ Step 2: Testing access to database '${config.database}'...`);
        try {
            await connection.query(`USE \`${config.database}\``);
            console.log(`✅ Step 2 SUCCESS: Database '${config.database}' found and accessible.`);
        } catch (dbErr) {
            if (dbErr.code === 'ER_BAD_DB_ERROR') {
                console.error(`❌ ERROR: Database '${config.database}' DOES NOT EXIST! Check DB_NAME.`);
            } else {
                console.error(`❌ ERROR: Could not access database: ${dbErr.message}`);
            }
            return;
        }

        // Step 3: Table Check
        console.log("⏳ Step 3: Checking for tables...");
        const [tables] = await connection.query("SHOW TABLES");
        console.log(`✅ Found ${tables.length} tables.`);
        if (tables.length === 0) {
            console.log("💡 HINT: Your database is empty. Don't forget to import localbasket_backup.sql!");
        }

        await connection.end();
        console.log("------------------------------------");
        console.log("🎉 DIAGNOSTICS COMPLETE: Everything looks good!");

    } catch (err) {
        console.log("------------------------------------");
        console.error("❌ CRITICAL DATABASE ERROR DETECTED:");

        if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error("👉 ISSUE: Access Denied. Your DB_USER or DB_PASSWORD is incorrect.");
        } else if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
            console.error("👉 ISSUE: Host not found or Timeout. Your DB_HOST is wrong or firewalled.");
        } else if (err.code === 'ECONNREFUSED') {
            console.error("👉 ISSUE: Connection Refused. Check DB_HOST and DB_PORT (usually 3306).");
        } else {
            console.error(`👉 MSG: ${err.message}`);
            console.error(`👉 CODE: ${err.code}`);
        }
    }
}

check();
