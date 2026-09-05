/*
  Alt surec on-yukleyicisi (node --require ile kullanilir).

  server.js'i ayri bir surecte baslatan testler icin pg'yi sahteler.
  Davranis TEST_SCENARIO ortam degiskeniyle secilir.
*/
const Module = require('module');
const orig = Module._load;
const SC = process.env.TEST_SCENARIO || 'temiz';

Module._load = function (request) {
  if (request === 'pg') {
    return {
      Pool: class {
        async query(text) {
          const q = String(text).replace(/\s+/g, ' ').trim();

          if (/FROM pg_constraint/i.test(q)) {
            return { rows: SC === 'kisit-zaten-var' ? [{}] : [] };
          }
          if (/SELECT COUNT\(\*\)::int AS n FROM events e WHERE NOT EXISTS/i.test(q)) {
            return { rows: [{ n: SC === 'oksuz-var' ? 137 : 0 }] };
          }
          if (/^DELETE FROM events e/i.test(q)) {
            if (SC === 'delete-patlar') throw new Error('deadlock detected');
            return { rows: [] };
          }
          if (/ADD CONSTRAINT fk_events_business/i.test(q)) {
            if (SC === 'alter-patlar') throw new Error('permission denied for table events');
            return { rows: [] };
          }
          if (/^SELECT 1$/i.test(q)) return { rows: [{}] };
          return { rows: [] };
        }
        async end() {}
      }
    };
  }
  return orig.apply(this, arguments);
};
