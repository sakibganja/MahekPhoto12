const express = require("express");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const multer = require("multer");
let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  console.warn("sharp not available in this runtime:", e && e.message ? e.message : e);
}
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const app = express();
const db = new DatabaseSync(path.join(DATA_DIR, "mahek.sqlite"));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "mahek.sqlite"));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, must_change_password INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
    location TEXT DEFAULT '', image_url TEXT NOT NULL, alt_text TEXT DEFAULT '',
    featured INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL, price TEXT NOT NULL, featured INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL,
    service TEXT NOT NULL, event_date TEXT DEFAULT '', message TEXT DEFAULT '',
    status TEXT DEFAULT 'new', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY, visitor_id TEXT NOT NULL, session_id TEXT NOT NULL,
    path TEXT NOT NULL, referrer TEXT DEFAULT '', device TEXT DEFAULT '',
    browser TEXT DEFAULT '', country TEXT DEFAULT '', city TEXT DEFAULT '',
    ip_hash TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
  CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor_id);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL, features TEXT DEFAULT '[]', price TEXT NOT NULL,
    active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '', password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customer_sessions (
    token_hash TEXT PRIMARY KEY, customer_id INTEGER NOT NULL, csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS favorites (
    customer_id INTEGER NOT NULL, gallery_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(customer_id,gallery_id),
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY(gallery_id) REFERENCES gallery(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY, customer_id INTEGER, name TEXT NOT NULL, contact TEXT NOT NULL,
    service TEXT NOT NULL, event_date TEXT NOT NULL, event_time TEXT DEFAULT '',
    duration TEXT DEFAULT '', location TEXT DEFAULT '', budget TEXT DEFAULT '',
    message TEXT DEFAULT '', status TEXT DEFAULT 'pending', admin_note TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(event_date);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
  CREATE TABLE IF NOT EXISTS blocked_dates (
    date TEXT PRIMARY KEY, reason TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY, actor TEXT DEFAULT '', type TEXT NOT NULL, detail TEXT DEFAULT '',
    ip_hash TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);
try { db.exec("ALTER TABLE enquiries ADD COLUMN customer_id INTEGER REFERENCES customers(id)"); } catch {}
try { db.exec("ALTER TABLE enquiries ADD COLUMN booking_id INTEGER REFERENCES bookings(id)"); } catch {}
try { db.exec("ALTER TABLE customers ADD COLUMN google_sub TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE customers ADD COLUMN avatar_url TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE customers ADD COLUMN auth_provider TEXT DEFAULT 'password'"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_google_sub ON customers(google_sub) WHERE google_sub <> ''"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at)"); } catch {}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  const saved = Buffer.from(hash, "hex");
  return saved.length === candidate.length && crypto.timingSafeEqual(candidate, saved);
}
function seed() {
  if (!db.prepare("SELECT id FROM admins LIMIT 1").get()) {
    db.prepare("INSERT INTO admins(email,name,password_hash) VALUES(?,?,?)")
      .run("admin@mahekphoto.in", "Mahek Admin", passwordHash("Mahek@2026"));
  }
  if (!db.prepare("SELECT id FROM gallery LIMIT 1").get()) {
    const add = db.prepare("INSERT INTO gallery(title,category,location,image_url,alt_text,featured,sort_order) VALUES(?,?,?,?,?,?,?)");
    add.run("The Quiet Before", "portraits", "Ahmedabad · 2025", "/assets/images/bride-portrait.png", "Bride in quiet window light", 1, 1);
    add.run("An Evening in Udaipur", "weddings", "Wedding · 2025", "/assets/images/hero-wedding.png", "Couple in a palace courtyard", 1, 2);
    add.run("The Night Sings", "films", "Wedding Film · 2024", "/assets/images/baraat-night.png", "Joyful wedding celebration at night", 1, 3);
    add.run("Held in Time", "portraits", "Portraits · 2025", "/assets/images/hero-wedding.png", "An intimate wedding portrait", 0, 4);
  }
  if (!db.prepare("SELECT id FROM packages LIMIT 1").get()) {
    const add = db.prepare("INSERT INTO packages(label,name,description,price,featured,sort_order) VALUES(?,?,?,?,?,?)");
    add.run("INTIMATE", "Essence", "For ceremonies and celebrations shared with your closest people.", "From ₹45,000", 0, 1);
    add.run("FULL STORY", "Signature", "Complete photography and cinematic film coverage across your wedding days.", "From ₹1,25,000", 1, 2);
    add.run("BESPOKE", "Legacy", "Our most complete, destination-ready experience with albums and films.", "By consultation", 0, 3);
  }
  if (!db.prepare("SELECT id FROM services LIMIT 1").get()) {
    const catalog = [
      ["Photography","Wedding Photography","Full-day cinematic coverage of your most important hours.",["Two lead photographers","500+ edited stills","Heirloom album","Online private gallery"],"From ₹1,80,000"],
      ["Photography","Pre-Wedding Shoots","Romantic, story-led shoots on location or in studio.",["Half-day coverage","Outfit changes","100+ edited images","Highlight reel"],"From ₹35,000"],
      ["Photography","Engagement Photography","Capture the ring moment and everything around it.",["3-hour coverage","Couple + family portraits","60+ edited images"],"From ₹25,000"],
      ["Photography","Birthday Photography","Candid celebrations—from first birthdays to milestone parties.",["Up to 4 hours","Décor + cake stills","80+ edited images"],"From ₹18,000"],
      ["Photography","Family Photography","Timeless family portraits, indoors or outdoors.",["Studio or outdoor","Multiple setups","40+ edited images","Print-ready files"],"From ₹12,000"],
      ["Photography","Event Photography","Galas, corporate launches and intimate dinners—covered with discretion.",["On-site lighting","Same-day previews","Branded backdrop coverage"],"From ₹45,000"],
      ["Films","Wedding Films","Cinematic 4K films scored to your story.",["4K capture","8–12 min film + teaser","Drone coverage","Color graded"],"From ₹2,40,000"],
      ["Films","Cinematic Video Shoots","Director-led cinematic videos for any occasion.",["Cinema lenses","Storyboarded shots","Music & sound design"],"From ₹85,000"],
      ["Films","Event Videography","Multi-camera coverage of events, conferences and parties.",["Multicam","Lavalier audio","Full edit + highlights"],"From ₹55,000"],
      ["Films","Social Media Reels","Scroll-stopping reels for Instagram, TikTok and YouTube Shorts.",["Concept pack","Cinema look","Captions + delivery"],"From ₹15,000"],
      ["Films","Promotional Videos","Brand and product films that convert viewers to customers.",["Script + storyboard","Studio or location","Edit + sound design"],"From ₹65,000"],
      ["Editing","Professional Photo Editing","Color, tone and detail work that elevates every frame.",["RAW processing","Skin retouching","Color matching"],"From ₹50 / image"],
      ["Editing","Wedding Album Design","Hand-laid album spreads with heirloom-quality storytelling.",["Custom layouts","Up to 40 spreads","Print-ready files"],"From ₹8,000"],
      ["Editing","Video Editing","Narrative-driven edits with music, transitions and titles.",["Multicam sync","Music licensing","2 revision rounds"],"From ₹3,500 / min"],
      ["Editing","Color Grading","Cinematic color treatment for film and brand work.",["DaVinci Resolve","LUT creation","HDR delivery"],"From ₹2,500 / min"],
      ["Editing","Retouching","High-end skin, product and editorial retouching.",["Frequency separation","Dodge & burn","Magazine-grade finish"],"From ₹300 / image"],
      ["Editing","Reel Creation","Turn raw clips into share-ready vertical reels.",["Beat-matched cuts","Captions & SFX","3 versions"],"From ₹2,000 / reel"],
      ["Photo Printing","Passport Size Photos","Instant passport, visa and ID photos to international specifications.",["8 copies per set","Digital + print","Print in 5 minutes"],"₹100 / set"],
      ["Photo Printing","Instant Photo Printing","High-quality glossy and matte prints while you wait.",["4×6, 5×7, 6×8","Premium photo paper","Bulk pricing"],"From ₹10 / print"],
      ["Photo Printing","Photo Frames","Custom frames in wood, metal and acrylic finishes.",["Multiple sizes","Matte & gloss","Wall-ready"],"From ₹350"],
      ["Photo Printing","Large Size Prints","Canvas, poster and gallery-quality large-format prints.",["Up to 36×48 in","Canvas / fine-art","Lamination available"],"From ₹900"],
      ["Photo Printing","Album Printing","Premium photo books and wedding albums.",["Hardcover & leather","Lay-flat binding","Up to 60 pages"],"From ₹3,500"],
      ["Photo Printing","Photo Restoration","Bring damaged, faded or old photographs back to life.",["Scratch & tear repair","Color restoration","Reprint included"],"From ₹500"],
      ["Documents","Xerox / Photocopy","Black and white photocopies for documents and study material.",["A4 & A3","Single & double-sided","Bulk discounts"],"₹1 / page"],
      ["Documents","Color Printing","High-resolution color printing on premium paper.",["Up to A3","Glossy & matte","Same-day delivery"],"From ₹10 / page"],
      ["Documents","Document Scanning","Crisp digital scans of documents, photos and certificates.",["Up to 600 DPI","PDF / JPG export","Email / pen drive"],"From ₹5 / page"],
      ["Documents","Lamination","Protect your certificates, IDs and documents.",["ID, A4, A3 sizes","Glossy & matte","Instant service"],"From ₹20"],
      ["Documents","ID Card Printing","Custom PVC ID cards for schools, offices and events.",["Front & back print","Lanyard included","Bulk pricing"],"From ₹80 / card"],
      ["Documents","Resume Printing","Professional resume printing on quality paper.",["Bond / ivory paper","Single or batch","PDF email accepted"],"From ₹15 / page"]
    ];
    const addService = db.prepare("INSERT INTO services(category,name,description,features,price,sort_order) VALUES(?,?,?,?,?,?)");
    catalog.forEach((item,index) => addService.run(item[0],item[1],item[2],JSON.stringify(item[3]),item[4],index+1));
  }
  const settings = {
    studio_name: "Mahek Photo", email: "farukganja1981@gmail.com", phone: "+91 99044 88899",
    address: "52, Snehmilan SCO, Hadanagar, Bhavnagar, Gujarat",
    hero_title: "Every moment has a story.", hero_subtitle: "We preserve the glances, the laughter, and everything between—through honest photographs and cinematic films."
  };
  const put = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
  Object.entries(settings).forEach(([key, value]) => put.run(key, value));
}
seed();

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"], scriptSrc: ["'self'"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-site" }
}));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "200kb" }));

const isLocalRequest = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip) || String(req.headers.host || "").startsWith("127.0.0.1");
const limiterKey = req => {
  const value = String(req.ip || req.headers["x-nf-client-connection-ip"] || req.headers["x-forwarded-for"] || req.headers["client-ip"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  return value === "unknown" ? value : ipKeyGenerator(value);
};
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, keyGenerator: limiterKey, validate: { ip: false }, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: req => isLocalRequest(req) ? 100 : 12,
  keyGenerator: limiterKey,
  validate: { ip: false },
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a few minutes, then try again." }
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: req => isLocalRequest(req) ? 60 : 8,
  keyGenerator: limiterKey,
  validate: { ip: false },
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Please wait a few minutes, then try again." }
});
app.use("/api", apiLimiter);

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(x => {
    const index = x.indexOf("="); return [x.slice(0, index).trim(), decodeURIComponent(x.slice(index + 1))];
  }));
}
function secureCookie(name, value, options = {}) {
  const maxAge = Number(options.maxAge || 0);
  const sameSite = options.sameSite || "Lax";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
function ipHash(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  return crypto.createHash("sha256").update(foredSafe(forwarded) + (process.env.ANALYTICS_SALT || "mahek-local")).digest("hex").slice(0, 16);
}
function foredSafe(value) { return String(value || "").slice(0, 120); }
function logSecurity(req, type, actor = "", detail = "") {
  try {
    db.prepare("INSERT INTO security_events(type,actor,detail,ip_hash) VALUES(?,?,?,?)")
      .run(clean(type, 80), clean(actor, 150), clean(detail, 500), ipHash(req));
  } catch {}
}
function sessionToken(req) { return cookies(req).mahek_admin || ""; }
function customerToken(req) { return cookies(req).mahek_customer || ""; }
function getCustomer(req) {
  const token = customerToken(req);
  if (!token) return null;
  return db.prepare(`
    SELECT s.csrf_token,s.expires_at,c.id,c.name,c.email,c.phone,c.avatar_url,c.auth_provider
    FROM customer_sessions s JOIN customers c ON c.id=s.customer_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')
  `).get(crypto.createHash("sha256").update(token).digest("hex")) || null;
}
function customerAuth(req, res, next) {
  req.customer = getCustomer(req);
  if (!req.customer) return res.status(401).json({ error: "Please sign in to continue." });
  next();
}
function customerCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.headers["x-csrf-token"] !== req.customer.csrf_token) return res.status(403).json({ error: "Security token invalid" });
  next();
}
function auth(req, res, next) {
  const token = sessionToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const session = db.prepare(`
    SELECT s.csrf_token,s.expires_at,a.id,a.email,a.name,a.must_change_password
    FROM sessions s JOIN admins a ON a.id=s.admin_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')
  `).get(crypto.createHash("sha256").update(token).digest("hex"));
  if (!session) return res.status(401).json({ error: "Session expired" });
  req.admin = session;
  next();
}
function csrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.headers["x-csrf-token"] !== req.admin.csrf_token) return res.status(403).json({ error: "Security token invalid" });
  next();
}
function clean(value, max = 500) { return String(value || "").trim().slice(0, max); }
function safeUrl(value) {
  const url = clean(value, 500);
  return url.startsWith("/uploads/") || url.startsWith("/assets/") ? url : "";
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function validTime(value) { return value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")); }
function ymd(date) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function dateRange(req) {
  const from = validDate(req.query.from) ? req.query.from : ymd(new Date());
  const toDate = new Date(`${from}T00:00:00`);
  toDate.setDate(toDate.getDate() + 90);
  const to = validDate(req.query.to) ? req.query.to : ymd(toDate);
  return { from, to };
}

app.get("/api/content", (req, res) => {
  const gallery = db.prepare("SELECT * FROM gallery ORDER BY sort_order,id").all();
  const services = db.prepare("SELECT * FROM services WHERE active=1 ORDER BY sort_order,id").all()
    .map(item => ({ ...item, features: JSON.parse(item.features || "[]") }));
  const customer = getCustomer(req);
  const packages = db.prepare("SELECT * FROM packages WHERE active=1 ORDER BY sort_order,id").all()
    .map(item => ({ ...item, price: customer ? item.price : null, price_locked: !customer }));
  const settings = Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(x => [x.key, x.value]));
  res.json({ gallery, packages, services, settings, authenticated: !!customer });
});

app.post("/api/enquiries", rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, keyGenerator: limiterKey, validate: { ip: false } }), (req, res) => {
  const customer = getCustomer(req);
  if (!customer) return res.status(401).json({ error: "Please sign in or create a profile to contact the studio." });
  const name = clean(req.body.name, 100), contact = clean(req.body.contact, 150), service = clean(req.body.service, 120);
  const eventDate = clean(req.body.date || req.body.event_date, 20), eventTime = clean(req.body.time || req.body.event_time, 10);
  if (name.length < 2 || contact.length < 5 || !service || !validDate(eventDate) || !validTime(eventTime)) return res.status(400).json({ error: "Please complete your name, contact, service, date and time." });
  const blocked = db.prepare("SELECT reason FROM blocked_dates WHERE date=?").get(eventDate);
  if (blocked) return res.status(409).json({ error: `This date is blocked${blocked.reason ? `: ${blocked.reason}` : "."}` });
  const taken = db.prepare("SELECT id FROM bookings WHERE event_date=? AND event_time=? AND status IN ('pending','confirmed')").get(eventDate, eventTime);
  if (taken) return res.status(409).json({ error: "That time is already requested. Please choose another slot." });
  const result = db.prepare("INSERT INTO bookings(customer_id,name,contact,service,event_date,event_time,duration,location,budget,message) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(customer.id, name, contact, service, eventDate, eventTime, clean(req.body.duration, 40), clean(req.body.location, 180), clean(req.body.budget, 80), clean(req.body.message, 2000));
  db.prepare("INSERT INTO enquiries(name,contact,service,event_date,message,customer_id,booking_id) VALUES(?,?,?,?,?,?,?)")
    .run(name, contact, service, eventDate, clean(req.body.message, 2000), customer.id, result.lastInsertRowid);
  res.status(201).json({ success: true, bookingId: result.lastInsertRowid });
});

app.get("/api/availability", (req, res) => {
  const { from, to } = dateRange(req);
  const bookings = db.prepare("SELECT event_date,event_time,status,service FROM bookings WHERE event_date BETWEEN ? AND ? AND status IN ('pending','confirmed') ORDER BY event_date,event_time").all(from, to);
  const blocked = db.prepare("SELECT date,reason FROM blocked_dates WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to);
  res.json({ from, to, bookings, blocked });
});

app.post("/api/account/register", signupLimiter, (req, res) => {
  const name = clean(req.body.name, 100), email = clean(req.body.email, 150).toLowerCase();
  const phone = clean(req.body.phone, 30), password = String(req.body.password || "");
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter your name and a valid email." });
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: "Use at least 8 characters with letters and a number." });
  try {
    const result = db.prepare("INSERT INTO customers(name,email,phone,password_hash,auth_provider) VALUES(?,?,?,?,?)").run(name, email, phone, passwordHash(password), "password");
    logSecurity(req, "customer_register", email, "Password profile created");
    createCustomerSession(result.lastInsertRowid, res);
  } catch { return res.status(409).json({ error: "An account with this email already exists." }); }
});
app.post("/api/account/login", authLimiter, (req, res) => {
  const email = clean(req.body.email, 150).toLowerCase(), password = String(req.body.password || "");
  const customer = db.prepare("SELECT * FROM customers WHERE email=?").get(email);
  if (!customer || !verifyPassword(password, customer.password_hash)) {
    logSecurity(req, "customer_login_failed", email, "Invalid password");
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  logSecurity(req, "customer_login_success", email, "Password sign-in");
  createCustomerSession(customer.id, res);
});
function createCustomerSession(customerId, res) {
  const token = crypto.randomBytes(32).toString("base64url"), csrfToken = crypto.randomBytes(24).toString("base64url");
  db.prepare("DELETE FROM customer_sessions WHERE expires_at <= datetime('now')").run();
  db.prepare("INSERT INTO customer_sessions(token_hash,customer_id,csrf_token,expires_at) VALUES(?,?,?,datetime('now','+30 days'))")
    .run(crypto.createHash("sha256").update(token).digest("hex"), customerId, csrfToken);
  const customer = db.prepare("SELECT id,name,email,phone,avatar_url,auth_provider FROM customers WHERE id=?").get(customerId);
  res.setHeader("Set-Cookie", secureCookie("mahek_customer", token, { sameSite: "Lax", maxAge: 2592000 }));
  res.json({ customer, csrfToken });
}

function googleConfig(req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`
  };
}
function googleConfigured(config) { return !!(config.clientId && config.clientSecret && config.redirectUri); }
app.get("/api/auth/google", (req, res) => {
  const config = googleConfig(req);
  if (!googleConfigured(config)) {
    logSecurity(req, "google_login_not_configured", "", "Google OAuth env vars missing");
    return res.status(503).send(`<!doctype html><title>Google sign-in setup needed</title><style>body{font-family:Arial;background:#f4efe5;color:#171714;display:grid;place-items:center;min-height:100vh}.card{max-width:620px;background:white;padding:36px;border:1px solid #ddd}code{background:#f2eadc;padding:2px 5px}</style><div class="card"><h1>Google sign-in is ready, but keys are missing.</h1><p>Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>, then set the Google redirect URL to:</p><p><code>${clean(config.redirectUri, 250)}</code></p><p><a href="/">Return to Mahek Photo</a></p></div>`);
  }
  const state = crypto.randomBytes(24).toString("base64url"), nonce = crypto.randomBytes(20).toString("base64url");
  db.prepare("DELETE FROM oauth_states WHERE expires_at <= datetime('now')").run();
  db.prepare("INSERT INTO oauth_states(state_hash,nonce,expires_at) VALUES(?,?,datetime('now','+10 minutes'))")
    .run(crypto.createHash("sha256").update(state).digest("hex"), nonce);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});
app.get("/api/auth/google/callback", async (req, res) => {
  const config = googleConfig(req), code = clean(req.query.code, 2000), state = clean(req.query.state, 200);
  const stateHash = crypto.createHash("sha256").update(state).digest("hex");
  const savedState = db.prepare("SELECT nonce FROM oauth_states WHERE state_hash=? AND expires_at > datetime('now')").get(stateHash);
  db.prepare("DELETE FROM oauth_states WHERE state_hash=? OR expires_at <= datetime('now')").run(stateHash);
  if (!googleConfigured(config) || !code || !savedState) {
    logSecurity(req, "google_login_failed", "", "Missing code, config or valid state");
    return res.redirect("/?signin=google_failed");
  }
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.id_token) throw new Error("Token exchange failed");
    const infoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
    const profile = await infoResponse.json();
    if (!infoResponse.ok || profile.aud !== config.clientId || profile.nonce !== savedState.nonce || profile.email_verified !== "true") throw new Error("Google profile verification failed");
    const email = clean(profile.email, 150).toLowerCase(), name = clean(profile.name || email.split("@")[0], 100);
    const avatar = clean(profile.picture, 500), sub = clean(profile.sub, 180);
    let customer = db.prepare("SELECT id FROM customers WHERE google_sub=? OR email=?").get(sub, email);
    if (customer) {
      db.prepare("UPDATE customers SET google_sub=?,name=COALESCE(NULLIF(name,''),?),avatar_url=?,auth_provider=CASE WHEN auth_provider='password' THEN 'password+google' ELSE 'google' END WHERE id=?")
        .run(sub, name, avatar, customer.id);
    } else {
      const result = db.prepare("INSERT INTO customers(name,email,phone,password_hash,google_sub,avatar_url,auth_provider) VALUES(?,?,?,?,?,?,?)")
        .run(name, email, "", passwordHash(crypto.randomBytes(32).toString("hex")), sub, avatar, "google");
      customer = { id: result.lastInsertRowid };
    }
    logSecurity(req, "customer_google_login_success", email, "Google sign-in");
    const token = crypto.randomBytes(32).toString("base64url"), csrfToken = crypto.randomBytes(24).toString("base64url");
    db.prepare("INSERT INTO customer_sessions(token_hash,customer_id,csrf_token,expires_at) VALUES(?,?,?,datetime('now','+30 days'))")
      .run(crypto.createHash("sha256").update(token).digest("hex"), customer.id, csrfToken);
    res.setHeader("Set-Cookie", secureCookie("mahek_customer", token, { sameSite: "Lax", maxAge: 2592000 }));
    res.redirect("/?signin=google#booking");
  } catch (error) {
    logSecurity(req, "google_login_failed", "", error.message);
    res.redirect("/?signin=google_failed");
  }
});
app.get("/api/account/me", customerAuth, (req, res) => {
  const favorites = db.prepare("SELECT gallery_id FROM favorites WHERE customer_id=?").all(req.customer.id).map(x => x.gallery_id);
  const enquiries = db.prepare("SELECT id,service,event_date,status,created_at FROM enquiries WHERE customer_id=? ORDER BY id DESC").all(req.customer.id);
  const bookings = db.prepare("SELECT id,service,event_date,event_time,status,created_at FROM bookings WHERE customer_id=? ORDER BY event_date DESC,id DESC").all(req.customer.id);
  res.json({ customer: req.customer, csrfToken: req.customer.csrf_token, favorites, enquiries, bookings });
});
app.post("/api/account/logout", customerAuth, customerCsrf, (req, res) => {
  db.prepare("DELETE FROM customer_sessions WHERE token_hash=?").run(crypto.createHash("sha256").update(customerToken(req)).digest("hex"));
  logSecurity(req, "customer_logout", req.customer.email, "Customer signed out");
  res.setHeader("Set-Cookie", secureCookie("mahek_customer", "", { sameSite: "Lax", maxAge: 0 }));
  res.json({ success: true });
});
app.post("/api/account/favorites/:galleryId", customerAuth, customerCsrf, (req, res) => {
  const exists = db.prepare("SELECT 1 FROM favorites WHERE customer_id=? AND gallery_id=?").get(req.customer.id, req.params.galleryId);
  if (exists) db.prepare("DELETE FROM favorites WHERE customer_id=? AND gallery_id=?").run(req.customer.id, req.params.galleryId);
  else db.prepare("INSERT INTO favorites(customer_id,gallery_id) VALUES(?,?)").run(req.customer.id, req.params.galleryId);
  res.json({ favorite: !exists });
});

app.post("/api/subscribe", rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, keyGenerator: limiterKey, validate: { ip: false } }), (req, res) => {
  const email = clean(req.body.email, 150).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  db.prepare("INSERT OR IGNORE INTO subscribers(email) VALUES(?)").run(email);
  res.json({ success: true });
});

app.post("/api/track", (req, res) => {
  const visitorId = clean(req.body.visitorId, 80), sessionId = clean(req.body.sessionId, 80);
  if (!/^[a-zA-Z0-9-]{12,80}$/.test(visitorId) || !/^[a-zA-Z0-9-]{12,80}$/.test(sessionId)) return res.status(204).end();
  const ua = req.headers["user-agent"] || "";
  const device = /mobile|android|iphone/i.test(ua) ? "Mobile" : /tablet|ipad/i.test(ua) ? "Tablet" : "Desktop";
  const browser = /edg/i.test(ua) ? "Edge" : /chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : /firefox/i.test(ua) ? "Firefox" : "Other";
  const forwarded = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  const ipHash = crypto.createHash("sha256").update(forwarded + (process.env.ANALYTICS_SALT || "mahek-local")).digest("hex").slice(0, 16);
  db.prepare("INSERT INTO visits(visitor_id,session_id,path,referrer,device,browser,country,city,ip_hash) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(visitorId, sessionId, clean(req.body.path, 300), clean(req.body.referrer, 300), device, browser,
      clean(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || "Local/Unknown", 80),
      clean(req.headers["x-vercel-ip-city"] || "", 80), ipHash);
  res.status(204).end();
});

app.post("/api/admin/login", authLimiter, (req, res) => {
  const email = clean(req.body.email, 150).toLowerCase(), password = String(req.body.password || "");
  const admin = db.prepare("SELECT * FROM admins WHERE email=?").get(email);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    logSecurity(req, "admin_login_failed", email, "Invalid password");
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  const token = crypto.randomBytes(32).toString("base64url"), csrfToken = crypto.randomBytes(24).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  db.prepare("DELETE FROM sessions WHERE admin_id=?").run(admin.id);
  db.prepare("INSERT INTO sessions(token_hash,admin_id,csrf_token,expires_at) VALUES(?,?,?,datetime('now','+12 hours'))")
    .run(crypto.createHash("sha256").update(token).digest("hex"), admin.id, csrfToken);
  logSecurity(req, "admin_login_success", email, "New secure admin session");
  res.setHeader("Set-Cookie", secureCookie("mahek_admin", token, { sameSite: "Strict", maxAge: 43200 }));
  res.json({ csrfToken, admin: { name: admin.name, email: admin.email, mustChangePassword: !!admin.must_change_password } });
});

app.get("/api/admin/me", auth, (req, res) => res.json({ csrfToken: req.admin.csrf_token, admin: req.admin }));
app.post("/api/admin/logout", auth, csrf, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(crypto.createHash("sha256").update(sessionToken(req)).digest("hex"));
  logSecurity(req, "admin_logout", req.admin.email, "Admin signed out");
  res.setHeader("Set-Cookie", secureCookie("mahek_admin", "", { sameSite: "Strict", maxAge: 0 }));
  res.json({ success: true });
});
app.post("/api/admin/password", auth, csrf, (req, res) => {
  const current = String(req.body.currentPassword || ""), next = String(req.body.newPassword || "");
  const admin = db.prepare("SELECT password_hash FROM admins WHERE id=?").get(req.admin.id);
  if (!verifyPassword(current, admin.password_hash)) return res.status(400).json({ error: "Current password is incorrect." });
  if (next.length < 10 || !/[A-Z]/.test(next) || !/[a-z]/.test(next) || !/\d/.test(next)) return res.status(400).json({ error: "Use at least 10 characters with uppercase, lowercase and a number." });
  db.prepare("UPDATE admins SET password_hash=?,must_change_password=0 WHERE id=?").run(passwordHash(next), req.admin.id);
  db.prepare("DELETE FROM sessions WHERE admin_id=? AND token_hash<>?").run(req.admin.id, crypto.createHash("sha256").update(sessionToken(req)).digest("hex"));
  logSecurity(req, "admin_password_changed", req.admin.email, "Password updated");
  res.json({ success: true });
});

app.get("/api/admin/security", auth, (req, res) => {
  const events = db.prepare("SELECT actor,type,detail,created_at FROM security_events ORDER BY id DESC LIMIT 40").all();
  const sessions = db.prepare("SELECT created_at,expires_at FROM sessions WHERE admin_id=? ORDER BY created_at DESC").all(req.admin.id);
  res.json({ events, sessions });
});

app.get("/api/admin/overview", auth, (req, res) => {
  const stats = {
    views30: db.prepare("SELECT COUNT(*) count FROM visits WHERE created_at >= datetime('now','-30 days')").get().count,
    uniques30: db.prepare("SELECT COUNT(DISTINCT visitor_id) count FROM visits WHERE created_at >= datetime('now','-30 days')").get().count,
    viewsToday: db.prepare("SELECT COUNT(*) count FROM visits WHERE date(created_at)=date('now')").get().count,
    enquiriesNew: db.prepare("SELECT COUNT(*) count FROM enquiries WHERE status='new'").get().count,
    bookingsPending: db.prepare("SELECT COUNT(*) count FROM bookings WHERE status='pending'").get().count,
    bookingsUpcoming: db.prepare("SELECT COUNT(*) count FROM bookings WHERE event_date >= date('now') AND status IN ('pending','confirmed')").get().count
  };
  const trend = db.prepare(`
    WITH RECURSIVE days(day) AS (SELECT date('now','-13 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('now'))
    SELECT day,COUNT(v.id) views,COUNT(DISTINCT v.visitor_id) visitors FROM days LEFT JOIN visits v ON date(v.created_at)=day GROUP BY day ORDER BY day
  `).all();
  const recent = db.prepare("SELECT path,referrer,device,browser,country,city,created_at,substr(visitor_id,1,8) visitor FROM visits ORDER BY id DESC LIMIT 20").all();
  const sources = db.prepare("SELECT CASE WHEN referrer='' THEN 'Direct' ELSE referrer END source,COUNT(*) count FROM visits WHERE created_at >= datetime('now','-30 days') GROUP BY source ORDER BY count DESC LIMIT 5").all();
  const pages = db.prepare("SELECT path,COUNT(*) views FROM visits WHERE created_at >= datetime('now','-30 days') GROUP BY path ORDER BY views DESC LIMIT 5").all();
  const devices = db.prepare("SELECT device,COUNT(*) count FROM visits WHERE created_at >= datetime('now','-30 days') GROUP BY device").all();
  res.json({ stats, trend, recent, sources, pages, devices });
});

app.get("/api/admin/gallery", auth, (req, res) => res.json(db.prepare("SELECT * FROM gallery ORDER BY sort_order,id").all()));
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
});
app.post("/api/admin/gallery", auth, csrf, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a JPG, PNG or WebP image." });
    if (!sharp) return res.status(503).json({ error: "Image processing not available on this platform." });
    const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}.webp`;
    await sharp(req.file.buffer).rotate().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toFile(path.join(UPLOAD_DIR, filename));
    const info = {
      title: clean(req.body.title, 120) || "Untitled Story", category: clean(req.body.category, 40) || "weddings",
      location: clean(req.body.location, 120), alt: clean(req.body.altText, 180),
      featured: req.body.featured === "true" ? 1 : 0, order: Number(req.body.sortOrder) || 0
    };
    const result = db.prepare("INSERT INTO gallery(title,category,location,image_url,alt_text,featured,sort_order) VALUES(?,?,?,?,?,?,?)")
      .run(info.title, info.category, info.location, `/uploads/${filename}`, info.alt, info.featured, info.order);
    res.status(201).json(db.prepare("SELECT * FROM gallery WHERE id=?").get(result.lastInsertRowid));
  } catch (error) { res.status(500).json({ error: "Image could not be processed." }); }
});
app.put("/api/admin/gallery/:id", auth, csrf, (req, res) => {
  const current = db.prepare("SELECT * FROM gallery WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Gallery item not found." });
  db.prepare("UPDATE gallery SET title=?,category=?,location=?,alt_text=?,featured=?,sort_order=? WHERE id=?").run(
    clean(req.body.title, 120), clean(req.body.category, 40), clean(req.body.location, 120),
    clean(req.body.altText, 180), req.body.featured ? 1 : 0, Number(req.body.sortOrder) || 0, req.params.id
  );
  res.json({ success: true });
});
app.delete("/api/admin/gallery/:id", auth, csrf, (req, res) => {
  const item = db.prepare("SELECT * FROM gallery WHERE id=?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Gallery item not found." });
  db.prepare("DELETE FROM gallery WHERE id=?").run(req.params.id);
  if (item.image_url.startsWith("/uploads/")) fs.rm(path.join(ROOT, item.image_url), { force: true }, () => {});
  res.json({ success: true });
});

app.get("/api/admin/packages", auth, (req, res) => res.json(db.prepare("SELECT * FROM packages ORDER BY sort_order,id").all()));
app.put("/api/admin/packages/:id", auth, csrf, (req, res) => {
  db.prepare("UPDATE packages SET label=?,name=?,description=?,price=?,featured=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(
    clean(req.body.label, 50), clean(req.body.name, 80), clean(req.body.description, 500), clean(req.body.price, 80),
    req.body.featured ? 1 : 0, req.body.active === false ? 0 : 1, Number(req.body.sortOrder) || 0, req.params.id
  );
  res.json({ success: true });
});
app.get("/api/admin/services", auth, (req, res) => res.json(db.prepare("SELECT * FROM services ORDER BY sort_order,id").all().map(x => ({ ...x, features: JSON.parse(x.features || "[]") }))));
app.put("/api/admin/services/:id", auth, csrf, (req, res) => {
  const features = Array.isArray(req.body.features) ? req.body.features.map(x => clean(x, 120)).filter(Boolean).slice(0, 8) : [];
  db.prepare("UPDATE services SET category=?,name=?,description=?,features=?,price=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(
    clean(req.body.category, 60), clean(req.body.name, 100), clean(req.body.description, 500), JSON.stringify(features),
    clean(req.body.price, 80), req.body.active === false ? 0 : 1, Number(req.body.sortOrder) || 0, req.params.id
  );
  res.json({ success: true });
});

app.get("/api/admin/enquiries", auth, (req, res) => res.json(db.prepare("SELECT * FROM enquiries ORDER BY id DESC").all()));
app.put("/api/admin/enquiries/:id/status", auth, csrf, (req, res) => {
  const status = ["new", "contacted", "booked", "closed"].includes(req.body.status) ? req.body.status : "new";
  db.prepare("UPDATE enquiries SET status=? WHERE id=?").run(status, req.params.id);
  res.json({ success: true });
});

app.get("/api/admin/bookings", auth, (req, res) => {
  const { from, to } = dateRange(req);
  const bookings = db.prepare("SELECT * FROM bookings WHERE event_date BETWEEN ? AND ? ORDER BY event_date,event_time,id").all(from, to);
  const blocked = db.prepare("SELECT * FROM blocked_dates WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to);
  res.json({ from, to, bookings, blocked });
});
app.put("/api/admin/bookings/:id", auth, csrf, (req, res) => {
  const current = db.prepare("SELECT id FROM bookings WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Booking not found." });
  const status = ["pending", "confirmed", "completed", "cancelled"].includes(req.body.status) ? req.body.status : "pending";
  const eventDate = validDate(req.body.eventDate) ? req.body.eventDate : clean(req.body.eventDate, 20);
  const eventTime = clean(req.body.eventTime, 10);
  if (!validDate(eventDate) || !validTime(eventTime)) return res.status(400).json({ error: "Use a valid date and time." });
  db.prepare("UPDATE bookings SET event_date=?,event_time=?,duration=?,location=?,budget=?,status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(eventDate, eventTime, clean(req.body.duration, 40), clean(req.body.location, 180), clean(req.body.budget, 80), status, clean(req.body.adminNote, 1000), req.params.id);
  res.json({ success: true });
});
app.post("/api/admin/blocked-dates", auth, csrf, (req, res) => {
  const date = clean(req.body.date, 20), reason = clean(req.body.reason, 160);
  if (!validDate(date)) return res.status(400).json({ error: "Choose a valid date." });
  db.prepare("INSERT INTO blocked_dates(date,reason) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET reason=excluded.reason").run(date, reason);
  res.status(201).json({ success: true });
});
app.delete("/api/admin/blocked-dates/:date", auth, csrf, (req, res) => {
  if (!validDate(req.params.date)) return res.status(400).json({ error: "Invalid date." });
  db.prepare("DELETE FROM blocked_dates WHERE date=?").run(req.params.date);
  res.json({ success: true });
});

app.get("/api/admin/settings", auth, (req, res) => res.json(Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(x => [x.key, x.value]))));
app.put("/api/admin/settings", auth, csrf, (req, res) => {
  const put = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  ["studio_name", "email", "phone", "address", "hero_title", "hero_subtitle"].forEach(key => {
    if (key in req.body) put.run(key, clean(req.body[key], key === "hero_subtitle" ? 500 : 200));
  });
  res.json({ success: true });
});

app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));
app.use(express.static(ROOT, { extensions: ["html"], index: "index.html" }));
app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Image must be under 15MB." : "Upload failed." });
  console.error(err); res.status(500).json({ error: "Something went wrong." });
});

const PORT = Number(process.env.PORT) || 4173;
if (require.main === module) {
  app.listen(PORT, "127.0.0.1", () => console.log(`Mahek Photo running at http://127.0.0.1:${PORT}`));
}
module.exports = app;
