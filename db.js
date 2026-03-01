const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'sessions.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; }
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  saveSession: (session) => {
    const db = load();
    db[session.id] = {
      id: session.id,
      shop: session.shop,
      state: session.state || null,
      isOnline: session.isOnline || false,
      scope: session.scope || null,
      expires: session.expires ? session.expires.toISOString() : null,
      accessToken: session.accessToken || null,
      updatedAt: new Date().toISOString(),
    };
    save(db);
  },
  loadSession: (id) => {
    return load()[id] || null;
  },
  deleteSession: (id) => {
    const db = load();
    delete db[id];
    save(db);
  },
  findSessionByShop: (shop) => {
    const db = load();
    return Object.values(db)
      .filter(s => s.shop === shop && s.accessToken)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null;
  }
};
