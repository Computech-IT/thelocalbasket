-- Local Basket Database Export
-- Generated on: 2026-03-03T07:11:46.830Z

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin', 'seller') NOT NULL,
  email VARCHAR(255) UNIQUE,
  business_name VARCHAR(255)
);

INSERT INTO users (`id`, `username`, `password`, `role`, `email`, `business_name`) VALUES
(1, 'admin', '$2b$10$B/PR..GiYaYWN/3ZS9qDreHWp2TUB1c/BSCEnbB4yLD7Ih7Zi9b/.', 'admin', 'admin@thelocalbasket.in', 'Local Basket Main'),
(2, 'seller', '$2b$10$vAA1P6dX4QW7CRdYUqAO6exr7j2eGMuONMCOmLDBIKsAvTih.Azuy', 'seller', 'seller@thelocalbasket.in', 'Pooja Gautam');

DROP TABLE IF EXISTS products;
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  qty DECIMAL(10, 2) NOT NULL,
  image VARCHAR(255),
  seller_id INT,
  FOREIGN KEY(seller_id) REFERENCES users(id)
);

INSERT INTO products (`id`, `name`, `description`, `price`, `qty`, `image`, `seller_id`) VALUES
(1, 'Crochet Earrings ✨', 'Handmade earrings, just for you!', 150, 10, 'images/crochet earrings 05.jpg', 1),
(2, 'Elegant Crochet Earrings ✨', 'Handmade earrings that charm any outfit.', 160, 10, 'images/crochet_earrings.jpg', 1),
(3, 'Mr. Bean\'s Teddy Keychain', 'Little bundle of joy 🧸', 250, 10, 'images/Mr. Bean\'s Teddy.jpg', 1),
(4, 'Handmade Crochet Sunflower & Rose Bouquet 🌼', 'Vibrant handcrafted bouquet, perfect to gift or decorate.', 600, 10, 'images/crochet boquet 01.jpg', 1),
(5, 'Crochet Sunflower Bag Charm 🌻', 'Bright sunflower charm to jazz up your bag.', 199, 10, 'images/Sunflower bag charm.jpg', 1),
(6, 'Handmade Crochet Bouquet 🌸', 'Everlasting handcrafted bouquet for gifting or decor.', 700, 10, 'images/crochet boquet 02.jpg', 1),
(7, 'Mini Crochet Bouquet 🌸', 'Pocket-sized handcrafted bouquet, perfect to gift.', 300, 10, 'images/crochet boquet 03.jpg', 1),
(8, 'Silicon Anti-Slip Phone Suction Pad', 'Strong and stylish anti-slip pad for phones.', 110, 10, 'images/phone silicon suction.jpg', 1),
(9, 'Red Heart Crochet Earrings ❤️', 'Handmade red heart earrings, cute & playful for any outfit.', 130, 10, 'images/heart earrings.jpg', 1),
(10, 'Cute Mini Bunny Plushie Crochet Keychain 🧸', 'Snuggles in bunny form.', 250, 10, 'images/crochet keychain.jpg', 1),
(11, 'Mini Bunny Plushie Crochet Keychain 🧸', 'Snuggles in bunny form.', 250, 10, 'images/bunP1.jpg', 1),
(12, 'Mini-Bunny Plushie Crochet Keychain 🧸', 'Snuggles in bunny form.', 250, 10, 'images/bunP2.jpg', 1),
(13, 'Mini-Bunny Plushie-Crochet Keychain 🧸', 'Snuggles in bunny form.', 250, 10, 'images/bunP3.jpg', 1),
(14, 'Flower Crochet Earring - Purple 🌸', 'A little bit of handcrafted happiness for your ears.', 130, 10, 'images/crochet purple earring.jpg', 1),
(16, 'Sunflower Bag Charm / keychain 🌻', 'Light weight, stylish crochet earrings.', 130, 10, 'images/sunflower1.jpg', 1),
(18, 'Handmade Crochet Bouquet - Large 🌸', 'Large Size handcrafted bouquet for gifting or decor.', 1000, 10, 'images/large bouquet.jpg', 1),
(19, 'Themed - Handmade Crochet Bouquet  🌸', 'Sesonal themed handcrafted bouquet, ideal for gifting or decor.', 1200, 10, 'images/themed bouquet.jpg', 1),
(20, 'Cookie Bear Keychain single  ', 'Sesonal cookie bear keychain, ideal for gifting or decor.', 250, 10, 'images/bkk.jpg', 1),
(21, 'Cookie Bear Keychain White', 'Sesonal cookie bear keychain, ideal for gifting or decor.', 250, 10, 'images/bk2.jpg', 1),
(22, 'Cookie Bear Keychain Handmade.  ', 'Sesonal cookie bear keychain, ideal for gifting or decor.', 250, 10, 'images/bk1.jpg', 1),
(23, 'Cookie Bear Keychain Combo', 'Sesonal cookie bear keychain, ideal for gifting or decor.', 600, 10, 'images/bkc.jpg', 1),
(24, 'Crochet Hand-Bag Large', 'White Hand Bag Crochet, Ideal for gifting.', 1000, 10, 'images/Hand Bag White Crochet.jpg', 1),
(25, 'Rose-crochet Keychain', 'Ideal for gifting or daily wear.', 100, 10, 'images/rose_keychain.jpg', 1),
(26, 'Tulip Keychain', 'Ideal for gifting or daily wear.', 200, 10, 'images/tulipBagCharm.jpg', 1),
(27, 'Tode Bag Large', 'Ideal for gifting or daily wear.', 2000, 4, 'images/todeBag.jpg', 1),
(28, 'TodeBag Large', 'Ideal for gifting or daily wear.', 2000, 4, 'images/todeBag1.jpg', 1),
(29, 'Tode-Bag Large', 'Ideal for gifting or daily wear.', 2000, 4, 'images/todeBag2.jpg', 1),
(30, 'Keychain Bag', 'Ideal for gifting or daily wear.', 200, 4, 'images/Keychain-Bag.jpg', 1),
(31, 'Crochet Sweater Large', 'Ideal for office / party wear', 1200, 4, 'images/sweater.jpg', 1),
(32, 'Sun Flower Earring', 'Ideal for casual/daily wear', 130, 10, 'images/sunEarring.jpg', 1),
(33, 'Crochet Earrings ✨ II', 'Ideal for daily use and fancy parties', 250, 10, 'images/1772440735629-136738025.png', 1),
(34, 'Test Product', 'Test Desc', 10.5, 5, 'images/placeholder.jpg', 2),
(35, 'Debug Product', 'Description', 99, 10, 'images/placeholder.jpg', 2),
(36, 'Debug Product 2', 'Description', 99, 10, 'images/placeholder.jpg', 2);

DROP TABLE IF EXISTS sales;
CREATE TABLE sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT,
  qty INT NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  customer_email VARCHAR(255),
  payment_id VARCHAR(255),
  FOREIGN KEY(product_id) REFERENCES products(id)
);

DROP TABLE IF EXISTS coupons;
CREATE TABLE coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  type ENUM('percent', 'flat') NOT NULL,
  value DECIMAL(10, 2) NOT NULL,
  min_purchase DECIMAL(10, 2) DEFAULT 0,
  max_discount DECIMAL(10, 2),
  expires DATETIME,
  message TEXT
);

INSERT INTO coupons (`id`, `code`, `type`, `value`, `min_purchase`, `max_discount`, `expires`, `message`) VALUES
(1, 'XMAS25', 'percent', 20, 300, 500, '2025-12-26', '🎄 Christmas Special! 25% off on all orders above ₹300 (max ₹500).'),
(2, 'HALLOWEEN30', 'flat', 100, 400, 100, '2025-11-02', '🎃 Trick or Treat! Get ₹100 off on orders above ₹400.'),
(3, 'NY2026', 'percent', 20, 250, 300, '2026-01-10', '✨ Welcome 2026! Enjoy 20% off on orders above ₹250.');

SET FOREIGN_KEY_CHECKS = 1;