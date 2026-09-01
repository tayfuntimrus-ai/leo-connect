require('dotenv').config();
const express=require('express'), cors=require('cors'), bcrypt=require('bcryptjs'),
 jwt=require('jsonwebtoken'), QRCode=require('qrcode'), Database=require('better-sqlite3'),
 path=require('path'), crypto=require('crypto');

const app=express(), PORT=process.env.PORT||3000;
const SECRET=process.env.JWT_SECRET||'CHANGE_ME_NOW';
const BASE=process.env.BASE_URL||`http://localhost:${PORT}`;
const db=new Database(process.env.DB_FILE||'leo-connect.db');
app.use(cors()); app.use(express.json({limit:'1mb'})); app.use(express.static(path.join(__dirname,'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS businesses(
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
 category TEXT DEFAULT '', description TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '',
 email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, logo_url TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS links(
 id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,type TEXT NOT NULL,
 label TEXT NOT NULL,url TEXT NOT NULL,enabled INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 0,
 FOREIGN KEY(business_id) REFERENCES businesses(id)
);
CREATE TABLE IF NOT EXISTS events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,event_type TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, user_agent TEXT DEFAULT '',
 FOREIGN KEY(business_id) REFERENCES businesses(id)
);
CREATE TABLE IF NOT EXISTS subscriptions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER UNIQUE NOT NULL,plan TEXT DEFAULT 'free',
 status TEXT DEFAULT 'active',renewal_date TEXT,FOREIGN KEY(business_id) REFERENCES businesses(id)
);`);

function slugify(s){return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'isletme'}
function tokenFor(b){return jwt.sign({id:b.id,slug:b.slug},SECRET,{expiresIn:'7d'})}
function auth(req,res,next){try{req.user=jwt.verify((req.headers.authorization||'').replace(/^Bearer\s+/i,''),SECRET);next()}catch(e){res.status(401).json({error:'Oturum gerekli'})}}
function publicBiz(id){
 const b=db.prepare('SELECT id,name,slug,category,description,phone,address,logo_url,email FROM businesses WHERE id=?').get(id);
 if(!b)return null;
 b.links=db.prepare('SELECT id,type,label,url,enabled,sort_order FROM links WHERE business_id=? AND enabled=1 ORDER BY sort_order,id').all(id);
 return b;
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'LEO CONNECT'}));

app.post('/api/register',async(req,res)=>{
 const {name,email,password,category}=req.body||{};
 if(!name||!email||!password||password.length<8)return res.status(400).json({error:'İşletme adı, e-posta ve en az 8 karakterli şifre gerekli'});
 if(db.prepare('SELECT id FROM businesses WHERE email=?').get(email))return res.status(409).json({error:'Bu e-posta zaten kayıtlı'});
 let slug=slugify(name), base=slug, n=1; while(db.prepare('SELECT id FROM businesses WHERE slug=?').get(slug))slug=`${base}-${++n}`;
 const info=db.prepare('INSERT INTO businesses(name,slug,email,password_hash,category) VALUES(?,?,?,?,?)')
 .run(name,slug,email,await bcrypt.hash(password,12),category||'');
 const id=info.lastInsertRowid;
 const ins=db.prepare('INSERT INTO links(business_id,type,label,url,sort_order) VALUES(?,?,?,?,?)');
 [['location','Konum','#',1],['whatsapp','WhatsApp','#',2],['review','Google Yorum','#',3],['iban','IBAN','#',4],['instagram','Instagram','#',5]]
 .forEach(x=>ins.run(id,x[0],x[1],x[2],x[3]));
 db.prepare('INSERT INTO subscriptions(business_id,plan,status) VALUES(?,?,?)').run(id,'free','active');
 const b=db.prepare('SELECT * FROM businesses WHERE id=?').get(id);
 res.json({token:tokenFor(b),business:{...publicBiz(id),url:`${BASE}/p/${slug}`}});
});

app.post('/api/login',async(req,res)=>{
 const b=db.prepare('SELECT * FROM businesses WHERE email=?').get(req.body.email||'');
 if(!b||!(await bcrypt.compare(req.body.password||'',b.password_hash)))return res.status(401).json({error:'Giriş bilgileri hatalı'});
 res.json({token:tokenFor(b),business:publicBiz(b.id)});
});

app.get('/api/me',auth,(req,res)=>{const b=publicBiz(req.user.id); if(!b)return res.status(404).json({error:'İşletme bulunamadı'});res.json(b)});
app.put('/api/me',auth,(req,res)=>{
 const allowed=['name','category','description','phone','address','logo_url'];
 const vals=allowed.map(k=>req.body[k]??'');
 db.prepare(`UPDATE businesses SET ${allowed.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...vals,req.user.id);
 res.json(publicBiz(req.user.id));
});
app.put('/api/links',auth,(req,res)=>{
 const links=Array.isArray(req.body.links)?req.body.links:[];
 const tx=db.transaction(()=>{db.prepare('DELETE FROM links WHERE business_id=?').run(req.user.id);
 const ins=db.prepare('INSERT INTO links(business_id,type,label,url,enabled,sort_order) VALUES(?,?,?,?,?,?)');
 links.forEach((x,i)=>ins.run(req.user.id,x.type||'custom',x.label||'Bağlantı',x.url||'#',x.enabled===false?0:1,i));});
 tx();res.json(publicBiz(req.user.id).links);
});

app.get('/api/qr',auth,async(req,res)=>{
 const b=publicBiz(req.user.id), url=`${BASE}/p/${b.slug}`;
 res.json({url,dataUrl:await QRCode.toDataURL(url,{width:1000,margin:2,errorCorrectionLevel:'H'})});
});
app.get('/api/qr/:slug',async(req,res)=>{
 const b=db.prepare('SELECT id,slug FROM businesses WHERE slug=?').get(req.params.slug);
 if(!b)return res.status(404).json({error:'Profil bulunamadı'});
 const url=`${BASE}/p/${b.slug}`;res.type('png').send(Buffer.from((await QRCode.toDataURL(url)).split(',')[1],'base64'));
});

app.get('/api/stats',auth,(req,res)=>{
 const totals=db.prepare(`SELECT event_type,COUNT(*) c FROM events WHERE business_id=? GROUP BY event_type`).all(req.user.id);
 const days=db.prepare(`SELECT substr(created_at,1,10) day,event_type,COUNT(*) c FROM events WHERE business_id=? AND created_at>=datetime('now','-30 day') GROUP BY day,event_type ORDER BY day`).all(req.user.id);
 res.json({totals,days});
});

app.get('/p/:slug',(req,res)=>{
 const b=db.prepare('SELECT id FROM businesses WHERE slug=?').get(req.params.slug);
 if(!b)return res.status(404).send('İşletme bulunamadı');
 db.prepare('INSERT INTO events(business_id,event_type,user_agent) VALUES(?,?,?)').run(b.id,'profile_view',req.headers['user-agent']||'');
 res.sendFile(path.join(__dirname,'public','profile.html'));
});

app.post('/api/event/:slug',express.json(),(req,res)=>{
 const b=db.prepare('SELECT id FROM businesses WHERE slug=?').get(req.params.slug);
 if(b&&['profile_view','nfc','qr','click'].includes(req.body.type))
 db.prepare('INSERT INTO events(business_id,event_type,user_agent) VALUES(?,?,?)').run(b.id,req.body.type,req.headers['user-agent']||'');
 res.json({ok:true});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`LEO CONNECT çalışıyor: ${BASE}`));
