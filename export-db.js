/**
 * export-db.js
 * Utility to export SQLite products.db to a MySQL-compatible .sql file.
 * Usage: node export-db.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('./products.db');
const outputFile = './localbasket_backup.sql';

console.log('📦 Starting Database Export...');

let sqlDump = `-- Local Basket Database Export
-- Generated on: ${new Date().toISOString()}

SET FOREIGN_KEY_CHECKS = 0;

`;

const tables = ['users', 'products', 'sales', 'coupons'];

tables.forEach(table => {
    console.log(`  - Exporting table: ${table}`);

    if (table === 'users') {
        sqlDump += `DROP TABLE IF EXISTS users;\n` +
            `CREATE TABLE users (\n` +
            `  id INT AUTO_INCREMENT PRIMARY KEY,\n` +
            `  username VARCHAR(255) NOT NULL UNIQUE,\n` +
            `  password VARCHAR(255) NOT NULL,\n` +
            `  role ENUM('admin', 'seller') NOT NULL,\n` +
            `  email VARCHAR(255) UNIQUE,\n` +
            `  business_name VARCHAR(255)\n` +
            `);\n\n`;
    } else if (table === 'products') {
        sqlDump += `DROP TABLE IF EXISTS products;\n` +
            `CREATE TABLE products (\n` +
            `  id INT AUTO_INCREMENT PRIMARY KEY,\n` +
            `  name VARCHAR(255) NOT NULL UNIQUE,\n` +
            `  description TEXT,\n` +
            `  price DECIMAL(10, 2) NOT NULL,\n` +
            `  qty DECIMAL(10, 2) NOT NULL,\n` +
            `  image VARCHAR(255),\n` +
            `  seller_id INT,\n` +
            `  FOREIGN KEY(seller_id) REFERENCES users(id)\n` +
            `);\n\n`;
    } else if (table === 'sales') {
        sqlDump += `DROP TABLE IF EXISTS sales;\n` +
            `CREATE TABLE sales (\n` +
            `  id INT AUTO_INCREMENT PRIMARY KEY,\n` +
            `  product_id INT,\n` +
            `  qty INT NOT NULL,\n` +
            `  total_price DECIMAL(10, 2) NOT NULL,\n` +
            `  sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n` +
            `  customer_email VARCHAR(255),\n` +
            `  payment_id VARCHAR(255),\n` +
            `  FOREIGN KEY(product_id) REFERENCES products(id)\n` +
            `);\n\n`;
    } else if (table === 'coupons') {
        sqlDump += `DROP TABLE IF EXISTS coupons;\n` +
            `CREATE TABLE coupons (\n` +
            `  id INT AUTO_INCREMENT PRIMARY KEY,\n` +
            `  code VARCHAR(50) NOT NULL UNIQUE,\n` +
            `  type ENUM('percent', 'flat') NOT NULL,\n` +
            `  value DECIMAL(10, 2) NOT NULL,\n` +
            `  min_purchase DECIMAL(10, 2) DEFAULT 0,\n` +
            `  max_discount DECIMAL(10, 2),\n` +
            `  expires DATETIME,\n` +
            `  message TEXT\n` +
            `);\n\n`;
    }

    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length > 0) {
        sqlDump += `INSERT INTO ${table} (\`${Object.keys(rows[0]).join('`, `')}\`) VALUES\n`;
        const valueRows = rows.map(row => {
            const values = Object.values(row).map(val => {
                if (val === null) return 'NULL';
                if (typeof val === 'string') {
                    // MySQL escape
                    return `'${val.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
                }
                return val;
            });
            return `(${values.join(', ')})`;
        });
        sqlDump += valueRows.join(',\n') + ';\n\n';
    }
});

sqlDump += `SET FOREIGN_KEY_CHECKS = 1;`;

fs.writeFileSync(outputFile, sqlDump);
console.log(`✅ Export complete! File saved to: ${outputFile}`);
console.log(`⚠️  Note: If you switch to MySQL on Hostinger, you must update server.js to use a MySQL driver (like mysql2) instead of better-sqlite3.`);
db.close();
