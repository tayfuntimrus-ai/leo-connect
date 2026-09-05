/*
  Test yardimcilari.

  Testler GERCEK VERITABANI GEREKTIRMEZ. pg modulu sahtelenir ve
  server.js gercek bir Express uygulamasi olarak ayaga kaldirilip
  uzerine gercek HTTP istekleri atilir.
*/
const path = require('path');
const http = require('http');

const REPO = path.join(__dirname, '..');
const SERVER = path.join(REPO, 'server.js');

/* pg modulunu verilen sorgu isleyicisiyle sahtele */
function stubPg(handler) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (request) {
    if (request === 'pg') {
      return {
        Pool: class {
          async query(text, params) { return handler(text, params); }
          async end() {}
        }
      };
    }
    return orig.apply(this, arguments);
  };
}

/* varsayilan ortam degiskenleri */
function setEnv(port, extra = {}) {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    JWT_SECRET: 't'.repeat(64),
    ADMIN_EMAIL: 'admin@test.local',
    ADMIN_PASSWORD: 'test-admin-parola',
    PUBLIC_URL: `http://localhost:${port}`,
    PORT: String(port),
    NODE_ENV: 'development'
  }, extra);
}

function request(port, method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: p, method,
      headers: {
        ...headers,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

const get = (port, p, headers) => request(port, 'GET', p, { headers });
const post = (port, p, body, headers) => request(port, 'POST', p, { body, headers });

/* basit iddia toplayici */
function makeChecker() {
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log(`  ${pass ? 'GECTI' : 'KALDI'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  const finish = () => {
    const failed = results.filter(r => !r.pass).length;
    console.log(`  ${results.length - failed}/${results.length} kontrol gecti\n`);
    return failed;
  };
  return { check, finish };
}

function token(role, extra = {}) {
  const jwt = require(path.join(REPO, 'node_modules', 'jsonwebtoken'));
  return jwt.sign({ role, ...extra }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

module.exports = { REPO, SERVER, stubPg, setEnv, request, get, post, makeChecker, token };
