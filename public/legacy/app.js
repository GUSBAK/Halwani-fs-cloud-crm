const DATA = window.FS_DATA || {customers:[],products:[],branches:[],factories:[],competitors:[],visitObjectives:[],visitResults:[]};
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const fmt = new Intl.NumberFormat('en-US');
const money = (v) => 'SAR ' + fmt.format(Math.round(Number(v) || 0));
const VISIT_RADIUS_M = 20;
const BUSINESS_YEAR = 2026;

function readStore(key, fallback){
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}
function writeStore(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

let visits = readStore('halwaniVisitsV5', readStore('halwaniVisitsV4', readStore('halwaniVisitsV3', [])));
let accountGPS = readStore('halwaniAccountGPSV5', readStore('halwaniAccountGPSV4', readStore('halwaniAccountGPSV3', {})));
let currentUser = readStore('halwaniCurrentUserV1', null);
let manualCustomers = readStore('halwaniManualCustomersV1', []);
let importedCustomers = readStore('halwaniImportedCustomersV2', []);
let customerMasterMode = readStore('halwaniCustomerMasterModeV1', 'merge');
let journeyPlan = readStore('halwaniJourneyPlanV1', []);
let collectionTargets = readStore('halwaniCollectionTargetsV1', []);
let manualPlanSlots = readStore('halwaniManualPlanSlotsV1', []);
let collectionReceipts = readStore('halwaniCollectionReceiptsV1', []);
let gpsCheck = null;
let gpsCheckOut = null;
let visitStartedAt = null;
let visitTimerInterval = null;
let visitActions = [];
let pickedProducts = [];
let activePlanMonth = readStore('halwaniActivePlanMonthV1', currentMonth());

function saveAll(){
  writeStore('halwaniVisitsV5', visits);
  writeStore('halwaniAccountGPSV5', accountGPS);
  writeStore('halwaniCurrentUserV1', currentUser);
  writeStore('halwaniManualCustomersV1', manualCustomers);
  writeStore('halwaniImportedCustomersV2', importedCustomers);
  writeStore('halwaniCustomerMasterModeV1', customerMasterMode);
  writeStore('halwaniJourneyPlanV1', journeyPlan);
  writeStore('halwaniCollectionTargetsV1', collectionTargets);
  writeStore('halwaniManualPlanSlotsV1', manualPlanSlots);
  writeStore('halwaniCollectionReceiptsV1', collectionReceipts);
  writeStore('halwaniActivePlanMonthV1', activePlanMonth);
}
function setTitle(t){ document.title = `Halwani Food Service | ${t}`; }
function screen(html){ $('#app').innerHTML = html; window.scrollTo(0, 0); }
function toast(t){ const d=document.createElement('div'); d.className='toast'; d.textContent=t; document.body.appendChild(d); setTimeout(()=>d.remove(),2400); }
function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function js(s){ return String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function localDate(d = new Date()){ const off=d.getTimezoneOffset()*60000; return new Date(d.getTime()-off).toISOString().slice(0,10); }
function today(){ return localDate(); }
function currentMonth(){ return today().slice(0,7); }
function monthText(month){ const [y,m]=(month||currentMonth()).split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}); }
function dateText(date){ if(!date) return ''; return new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'short',day:'numeric',month:'short'}); }
function kv(k,v){ return `<div class="kv"><span>${k}</span><b>${v ?? ''}</b></div>`; }
function navActive(s){ $$('.bottom-nav button').forEach(b=>b.classList.toggle('active', b.dataset.screen===s)); }
function requireLogin(){ return !!currentUser; }
function normalize(v){ return String(v||'').trim().toLowerCase().replace(/\s+/g,' '); }
function isManager(){ return ['Supervisor','Regional Manager','Head of Food Service'].includes(currentUser?.role); }
function isSalesman(){ return currentUser?.role === 'Salesman'; }
function customerKey(c){ return String(c?.code || '').trim(); }
function allCustomers(){
  const map = new Map();
  const base = customerMasterMode==='replace' && importedCustomers.length
    ? importedCustomers
    : [...(DATA.customers||[]), ...importedCustomers];
  [...base, ...manualCustomers].forEach(c=>{ if(c && customerKey(c)) map.set(customerKey(c), c); });
  return Array.from(map.values());
}
function getCustomerByCode(code){ return allCustomers().find(c=>String(c.code)===String(code)); }
function getCustomerByName(name){ return allCustomers().find(c=>normalize(c.name)===normalize(name)); }
function customerFromInput(){
  const value=$('#vCustomer')?.value || '';
  const code=(value.match(/^([^ -]+)\s+-\s+/)||[])[1] || value.trim();
  return getCustomerByCode(code) || allCustomers().find(c=>value.includes(c.name));
}
function userOwnsRow(row){
  if(!isSalesman()) return true;
  const salesman=normalize(row.salesman);
  return !salesman || salesman===normalize(currentUser?.name);
}
function sameMonth(value, month){ return String(value||'').slice(0,7)===month; }
function toNum(value){ const n=Number(String(value??'').replace(/,/g,'')); return Number.isFinite(n)?n:0; }

function dateFromExcelValue(value){
  const raw=String(value??'').trim();
  if(!raw) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if(/^\d+(\.\d+)?$/.test(raw)){
    const serial=Number(raw);
    if(serial>20000 && serial<70000){
      const d=new Date(Date.UTC(1899,11,30)+Math.floor(serial)*86400000);
      return d.toISOString().slice(0,10);
    }
  }
  const parsed=new Date(raw);
  if(!Number.isNaN(parsed.getTime())){
    const y=parsed.getFullYear(); const m=String(parsed.getMonth()+1).padStart(2,'0'); const d=String(parsed.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  return raw;
}
function timeFromExcelValue(value){
  const raw=String(value??'').trim();
  if(!raw) return '';
  if(/^\d+(\.\d+)?$/.test(raw)){
    const n=Number(raw);
    if(n>=0 && n<1){
      const mins=Math.round(n*24*60); const h=String(Math.floor(mins/60)%24).padStart(2,'0'); const m=String(mins%60).padStart(2,'0');
      return `${h}:${m}`;
    }
  }
  const match=raw.match(/(\d{1,2}):(\d{2})/);
  if(match) return `${match[1].padStart(2,'0')}:${match[2]}`;
  return raw;
}
function backupCounts(){return {customers:allCustomers().length,visits:visits.length,journey:journeyPlan.length+manualPlanSlots.length,collections:collectionTargets.length,receipts:collectionReceipts.length};}
function backupPayload(){
  return {
    app:'Halwani Food Service', backupVersion:1, exportedAt:new Date().toISOString(),
    note:'Local device backup. Restoring this file replaces local customer, visit, journey, collection, GPS, and action data on the device.',
    counts:backupCounts(),
    fullCustomerDatabase:allCustomers(),
    importedCustomers, customerMasterMode, manualCustomers, visits, accountGPS,
    journeyPlan, collectionTargets, manualPlanSlots, collectionReceipts, activePlanMonth
  };
}
function downloadLocalBackup(){
  saveAll();
  const stamp=today().replaceAll('-','');
  downloadFile(`halwani_fs_local_backup_${stamp}.json`,JSON.stringify(backupPayload(),null,2),'application/json');
  toast('Local database backup saved to your device');
}
function restoreLocalBackup(){
  const input=$('#localBackupImport'); const file=input?.files?.[0];
  if(!file){toast('Choose a backup file first');return;}
  const reader=new FileReader();
  reader.onerror=()=>toast('Could not read the backup file');
  reader.onload=e=>{
    try{
      const data=JSON.parse(String(e.target.result||''));
      if(!data || data.app!=='Halwani Food Service' || !Array.isArray(data.visits)) throw new Error('This is not a valid Halwani Food Service backup.');
      if(!confirm(`Restore this backup from ${new Date(data.exportedAt).toLocaleString()}? This replaces all local visits, customer updates, journey plans, collections, GPS locations, and actions on this device.`)) return;
      visits=Array.isArray(data.visits)?data.visits:[];
      accountGPS=data.accountGPS&&typeof data.accountGPS==='object'?data.accountGPS:{};
      manualCustomers=Array.isArray(data.manualCustomers)?data.manualCustomers:[];
      if(Array.isArray(data.fullCustomerDatabase)&&data.fullCustomerDatabase.length){
        importedCustomers=data.fullCustomerDatabase; customerMasterMode='replace';
      }else{
        importedCustomers=Array.isArray(data.importedCustomers)?data.importedCustomers:[];
        customerMasterMode=data.customerMasterMode==='replace'?'replace':'merge';
      }
      journeyPlan=Array.isArray(data.journeyPlan)?data.journeyPlan:[];
      collectionTargets=Array.isArray(data.collectionTargets)?data.collectionTargets:[];
      manualPlanSlots=Array.isArray(data.manualPlanSlots)?data.manualPlanSlots:[];
      collectionReceipts=Array.isArray(data.collectionReceipts)?data.collectionReceipts:[];
      activePlanMonth=String(data.activePlanMonth||currentMonth()).slice(0,7);
      saveAll();
      toast('Local database restored');
      route('dashboard');
    }catch(err){console.error(err);toast(err?.message||'Could not restore this backup.');}
  };
  reader.readAsText(file);
}
function downloadStaticTemplate(path, filename){
  const a=document.createElement('a'); a.href=path; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
}

function login(){
  setTitle('Login');
  $('.bottom-nav').style.display='none';
  $('#exportBtn').style.display='none';
  screen(`<section class="login-card card">
    <img src="assets/halwani-logo.png" class="login-logo" alt="Halwani Bros">
    <h2>Food Service CRM</h2>
    <p class="muted">Sales execution, collections, GPS verified visits, and action tracking.</p>
    <label>Name</label><input id="loginName" value="Ghassan Baker" placeholder="Salesman name">
    <label>Role</label><select id="loginRole"><option>Salesman</option><option>Supervisor</option><option>Regional Manager</option><option>Head of Food Service</option></select>
    <label>Branch</label><select id="loginBranch"><option></option>${(DATA.branches||[]).map(b=>`<option>${esc(b)}</option>`).join('')}</select>
    <button class="primary submit-big" onclick="doLogin()">Login</button>
  </section>`);
}
function doLogin(){
  const name=$('#loginName').value.trim();
  if(!name){ toast('Enter name'); return; }
  currentUser={name,role:$('#loginRole').value,branch:$('#loginBranch').value,loginAt:new Date().toISOString()};
  saveAll();
  $('.bottom-nav').style.display='grid';
  $('#exportBtn').style.display='inline-flex';
  route('dashboard');
}
function logout(){ currentUser=null; saveAll(); login(); }

function targetRowsForUser(month=activePlanMonth){
  const direct=collectionTargets.filter(r=>sameMonth(r.month||r.date,month)&&userOwnsRow(r));
  if(direct.length) return direct;
  const plan=journeyPlan.filter(r=>sameMonth(r.month||r.date,month)&&userOwnsRow(r)&&toNum(r.collectionTargetSAR)>0);
  const seen=new Set();
  return plan.filter(r=>{ const key=`${r.salesman}|${r.customerCode}`; if(seen.has(key)) return false; seen.add(key); return true; });
}
function collectionTargetForAccount(customerCode, month=activePlanMonth, salesman=currentUser?.name){
  const matching=targetRowsForUser(month).filter(r=>String(r.customerCode||'')===String(customerCode||'') && (!salesman || !r.salesman || normalize(r.salesman)===normalize(salesman)));
  return matching.reduce((sum,r)=>sum+toNum(r.collectionTargetSAR),0);
}
function collectionCollectedForAccount(customerCode, month=activePlanMonth, salesman=currentUser?.name){
  return collectionReceipts.filter(r=>sameMonth(r.date,month)&&String(r.customerCode||'')===String(customerCode||'')&&(!salesman||normalize(r.salesman)===normalize(salesman))).reduce((sum,r)=>sum+toNum(r.amount),0);
}
function collectionSummary(month=activePlanMonth){
  const target=targetRowsForUser(month).reduce((sum,r)=>sum+toNum(r.collectionTargetSAR),0);
  const collected=collectionReceipts.filter(r=>sameMonth(r.date,month)&&userOwnsRow(r)).reduce((sum,r)=>sum+toNum(r.amount),0);
  return {target,collected,remaining:Math.max(0,target-collected)};
}

function planRowsForUser(month=activePlanMonth){
  const imported=journeyPlan.filter(r=>sameMonth(r.month||r.date,month)&&userOwnsRow(r)).map(r=>({...r,manual:false}));
  const manual=manualPlanSlots.filter(r=>sameMonth(r.month||r.date,month)&&userOwnsRow(r)).map(r=>({...r,manual:true}));
  return [...imported,...manual].sort((a,b)=>`${a.date||''}${a.time||''}`.localeCompare(`${b.date||''}${b.time||''}`));
}
function visitDoneForRow(row){ return visits.some(v=>String(v.customerCode||'')===String(row.customerCode||'')&&String(v.date||'').slice(0,10)===String(row.date||'')); }
function collectionTargetForRow(row){ return toNum(row.collectionTargetSAR) || collectionTargetForAccount(row.customerCode, activePlanMonth, row.salesman||currentUser?.name); }
function todayJourney(){ return planRowsForUser(activePlanMonth).filter(r=>(r.date||'')===today()); }
function journeyItemHtml(row){
  const customer=getCustomerByCode(row.customerCode)||getCustomerByName(row.customerName);
  const title=customer?.name || row.customerName || 'Free space';
  const target=collectionTargetForRow(row);
  const done=visitDoneForRow(row);
  const status=done?'Completed':((row.date||'')===today()?'Due Now':'Planned');
  const action=row.customerCode ? `onclick="route('visit','${js(row.customerCode)}')"` : `onclick="route('manualSlot','${js(row.date||today())}')"`;
  return `<div class="journey-item" ${action}>
    <div class="journey-time">${esc(row.time||'—')}</div>
    <div><b>${esc(title)}</b><div class="meta">${esc(row.branch||customer?.branch||'')} ${row.area||customer?.area ? '· '+esc(row.area||customer?.area||'') : ''}</div></div>
    <span class="status ${status==='Completed'?'done':status==='Due Now'?'due':'planned'}">${status}</span>
    ${target>0?`<div class="journey-target">Collection target: ${money(target)}</div>`:''}
    ${row.manual&&!row.customerCode?`<div class="journey-target">Free space · ${esc(row.notes||'Manual entry')}</div>`:''}
  </div>`;
}

function dashboard(){
  setTitle('Home');
  const todayVisits=visits.filter(v=>String(v.date||'').slice(0,10)===today()&&(!isSalesman()||normalize(v.salesman)===normalize(currentUser.name))).length;
  const followUps=visits.filter(v=>v.followUp&&v.followUp>=today()&&(!isSalesman()||normalize(v.salesman)===normalize(currentUser.name))).length;
  const pipe=visits.filter(v=>!isSalesman()||normalize(v.salesman)===normalize(currentUser.name)).reduce((a,v)=>a+toNum(v.expected),0);
  const openActions=visits.filter(v=>!isSalesman()||normalize(v.salesman)===normalize(currentUser.name)).flatMap(v=>v.actions||[]).filter(a=>a.status!=='Done').length;
  const latest=visits.filter(v=>!isSalesman()||normalize(v.salesman)===normalize(currentUser.name)).slice(-3).reverse();
  const alerts=visits.filter(v=>(v.competitor||v.competitorNews)&&(!isSalesman()||normalize(v.salesman)===normalize(currentUser.name))).slice(-3).reverse();
  const journey=todayJourney();
  const collections=collectionSummary();
  screen(`<section class="welcome card">
    <div class="muted big">Good morning</div>
    <h2>${esc(currentUser?.name||'Salesman')}</h2>
    <div class="meta">${esc(currentUser?.role||'Salesman')}${currentUser?.branch?' · '+esc(currentUser.branch):''}</div>
  </section>
  <button class="start-hero" onclick="route('visit')">START VISIT</button>
  <section class="card collection-summary"><div class="section-head"><h3>Collections · ${monthText(activePlanMonth)}</h3><button onclick="route('plan')">Plan</button></div>
    <div class="summary-grid"><div><span>Target</span><b>${money(collections.target)}</b></div><div><span>Collected</span><b>${money(collections.collected)}</b></div><div><span>Remaining</span><b>${money(collections.remaining)}</b></div></div>
  </section>
  <section class="card"><div class="section-head"><h3>Today's Journey</h3><span class="pill">${today()}</span></div>
    ${journey.length?journey.map(journeyItemHtml).join(''):`<div class="plan-empty">No stores planned today. Use This Month Plan to add a free space or an approved customer visit.</div>`}
  </section>
  <section class="home-kpis">
    <div class="home-kpi"><b>${fmt.format(todayVisits)}</b><span>Visits Today</span></div>
    <div class="home-kpi"><b>${fmt.format(followUps)}</b><span>Follow Ups</span></div>
    <div class="home-kpi"><b>${fmt.format(openActions)}</b><span>Open Actions</span></div>
    <div class="home-kpi"><b>${money(pipe)}</b><span>Pipeline</span></div>
  </section>
  <section class="actions" style="margin-bottom:16px"><button class="primary" onclick="route('plan')">This Month Plan</button><button onclick="route('newCustomer')">Add Approved Customer</button></section>
  <section class="card"><h3>Competitor Alerts</h3>${alerts.length?alerts.map(v=>`<div class="mini-item"><b>${esc(v.competitor||'Competitor update')}</b><div class="meta">${esc(v.customerName)} · ${esc(v.competitorNews||'')}</div></div>`).join(''):'<p class="muted">No competitor updates yet.</p>'}</section>
  <section class="card"><h3>Latest Visits</h3>${latest.length?latest.map(v=>`<div class="visit-card"><b>${esc(v.customerName||v.customer)}</b><div class="meta">${esc(v.salesman||'Salesman')} · ${(v.date||'').slice(0,10)} · ${esc(v.visitDurationMinutes||'')} min</div><div class="meta">${esc(v.objective)} · ${esc(v.result)}</div>${toNum(v.collectionReceived)>0?`<span class="pill">Collected ${money(v.collectionReceived)}</span>`:''}</div>`).join(''):'<p class="muted">No visits recorded yet.</p>'}</section>`);
}

function getCustomerGPS(c){
  if(!c) return null;
  const saved=accountGPS[c.code];
  const fromGps=String(c.gps||'').split(',');
  const lat=Number(c.lat||c.latitude||(saved&&saved.lat)||fromGps[0]);
  const lng=Number(c.lng||c.longitude||(saved&&saved.lng)||fromGps[1]);
  return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng,source:saved?'registered':'database'}:null;
}
function distanceMeters(a,b){ const R=6371000,toRad=d=>d*Math.PI/180; const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng),lat1=toRad(a.lat),lat2=toRad(b.lat); const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2; return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); }
function gpsBox(html,cls='warn'){ const el=$('#gpsStatus'); if(el){ el.className='gps-status '+cls; el.innerHTML=html; } }
function resetGPSCheck(){
  gpsCheck=null; gpsCheckOut=null; visitStartedAt=null;
  if(visitTimerInterval){ clearInterval(visitTimerInterval); visitTimerInterval=null; }
  const btn=$('#submitVisitBtn'); if(btn) btn.disabled=true;
  const timer=$('#visitTimer'); if(timer){ timer.className='gps-status warn'; timer.textContent='Visit not started'; }
  gpsBox(`Check In is required. You must be within ${VISIT_RADIUS_M} meters of the selected account.`, 'warn');
  updateCustomerContext();
}
function productCategoryStatus(c){
  const text=(c?.topProducts||[]).map(p=>p.productName).join(' ').toLowerCase();
  const categories=[['Fries','fries بطاطس'],['Tahina','طحين tahina'],['Mozzarella','موزاريلا mozzarella cheese'],['Jammy','مربي مربى jam'],['Mini Glass','لا بيل زجاج glass'],['Turkey','حبش turkey'],['Mortadella','مرتديلا mortadella'],['Salt','ملح salt']];
  return categories.map(([name,words])=>({name,yes:words.split(' ').some(w=>w&&text.includes(w.toLowerCase()))}));
}
function nextBestProduct(c){ const missing=productCategoryStatus(c).filter(x=>!x.yes).map(x=>x.name); if(!missing.length) return 'Protect account and expand pack sizes'; if((c.sector||'').toLowerCase().includes('catering')&&missing.includes('Mini Glass')) return 'La Belle Mini Glass Jars'; return missing[0]; }
function customerContextHtml(c){
  if(!c) return '<p class="muted">Select a customer to see customer history and this month’s collection target.</p>';
  const status=productCategoryStatus(c);
  const lastVisit=visits.filter(v=>String(v.customerCode)===String(c.code)).slice(-1)[0];
  const target=collectionTargetForAccount(c.code);
  const collected=collectionCollectedForAccount(c.code);
  return `<div class="customer-snapshot">
    <h3>${esc(c.name)}</h3><div class="meta">${esc(c.code)} · ${esc(c.branch||'')} · ${esc(c.sector||'')}</div>
    <div class="snapshot-grid">
      <div><span>Gross Sales YTD</span><b>${money(c.grossSalesYTD)}</b></div>
      <div><span>Monthly Average</span><b>${money(c.monthlyAvgGrossSales)}</b></div>
      <div><span>Orders YTD</span><b>${fmt.format(c.ordersYTD||0)}</b></div>
      <div><span>Last Visit</span><b>${lastVisit?(lastVisit.date||'').slice(0,10):'No visit yet'}</b></div>
      <div><span>Collection Target</span><b>${money(target)}</b></div>
      <div><span>Collection Received</span><b>${money(collected)}</b></div>
      <div><span>Last Order</span><b>${esc(c.lastMonthYTD||'')}</b></div>
      <div><span>Next Best Product</span><b>${esc(nextBestProduct(c))}</b></div>
    </div>
    <h4>Products Buying</h4><div class="penetration">${status.map(x=>`<span class="${x.yes?'yes':'no'}">${x.yes?'✓':'✗'} ${x.name}</span>`).join('')}</div>
    <h4>Top Products YTD</h4>${(c.topProducts||[]).slice(0,4).map(p=>`<div class="product-chip"><b>${esc(p.productName)}</b><div class="meta">${esc(p.productCode)} · ${money(p.grossSales)}</div></div>`).join('')||'<p class="muted">No product history.</p>'}
  </div>`;
}
function updateCustomerContext(){ const c=customerFromInput(); const el=$('#customerContext'); if(el) el.innerHTML=customerContextHtml(c); const target=$('#collectionTargetDisplay'); if(target) target.textContent=money(c?collectionTargetForAccount(c.code):0); }

function visit(prefill=''){
  setTitle('Visit');
  const c=getCustomerByCode(prefill);
  gpsCheck=null; gpsCheckOut=null; visitStartedAt=null; visitActions=[]; pickedProducts=[];
  if(visitTimerInterval){ clearInterval(visitTimerInterval); visitTimerInterval=null; }
  screen(`<section class="card visit-step"><h3>1. Select Customer</h3>
    <label>Customer</label><input id="vCustomer" list="customerOptions" value="${c?esc(c.code+' - '+c.name):''}" placeholder="Search customer or code">
    <datalist id="customerOptions">${allCustomers().slice(0,2000).map(x=>`<option value="${esc(x.code+' - '+x.name)}"></option>`).join('')}</datalist>
  </section>
  <section class="card" id="customerContext">${customerContextHtml(c)}</section>
  <section class="card visit-step"><h3>2. Check In</h3><p class="muted">Check In is blocked unless you are within ${VISIT_RADIUS_M} meters of the account.</p>
    <div id="gpsStatus" class="gps-status warn">Select customer, then Check In.</div>
    <div id="visitTimer" class="gps-status warn">Visit not started</div>
    <div class="actions"><button class="primary" onclick="gpsCheckIn()">Check In</button><button onclick="registerAccountGPS()">Register Account GPS</button></div>
  </section>
  <section class="card visit-step"><h3>3. Meeting Details</h3>
    <label>Who did you meet?</label><div class="checkbox-grid" id="contactsMet">${['Owner','Buyer','Executive Chef','Kitchen Manager','F&B Manager','Purchasing','Other'].map(x=>`<label><input type="checkbox" value="${x}"> ${x}</label>`).join('')}</div>
    <label>Visit Objective</label><select id="vObjective">${(DATA.visitObjectives||[]).map(x=>`<option>${esc(x)}</option>`).join('')}</select>
    <label>Visit Result</label><select id="vResult">${(DATA.visitResults||[]).map(x=>`<option>${esc(x)}</option>`).join('')}</select>
    <label>Customer Interest</label><select id="vInterest"><option value="1">1 Low</option><option value="2">2</option><option value="3">3 Medium</option><option value="4">4</option><option value="5">5 High</option></select>
    <label>Products Discussed</label><input id="productSearchVisit" placeholder="Search products to add"><div id="productPickList" class="pick-list"></div><div id="selectedProducts" class="selected-list"></div>
    <label>Products Sampled</label><select id="vSample"><option>No</option><option>Yes</option></select>
    <label>Sample Details</label><input id="vSampleDetails" placeholder="SKU and quantity">
    <label>Products Requested</label><input id="vRequested" placeholder="Products the customer requested">
    <label>Products Rejected</label><input id="vRejected" placeholder="Products rejected and why">
  </section>
  <section class="card visit-step"><h3>4. Competition</h3>
    <label>Current Supplier</label><input id="vCurrentSupplier" placeholder="Who is supplying now?">
    <label>Competitor Brand</label><select id="vCompetitor"><option></option>${(DATA.competitors||[]).map(x=>`<option>${esc(x)}</option>`).join('')}<option>Other Brand</option></select>
    <label>Competitor Price</label><input id="vCompetitorPrice" placeholder="Price or deal seen">
    <label>Competitor Promotion</label><input id="vCompetitorPromotion" placeholder="Promotion, rebate, bundle, free goods">
    <label>Competitor Strengths</label><textarea id="vCompetitorStrengths" placeholder="Why does the customer like them?"></textarea>
    <label>Competitor Weaknesses</label><textarea id="vCompetitorWeaknesses" placeholder="Quality, service, price, availability issues"></textarea>
    <label>Competitor News</label><textarea id="vCompetitorNews" placeholder="Any new update about competitor brands"></textarea>
  </section>
  <section class="card visit-step"><h3>5. Collections & Commercial Outcome</h3>
    <div class="collection-callout"><b>Collection target this month: <span id="collectionTargetDisplay">${money(c?collectionTargetForAccount(c.code):0)}</span></b><div class="meta">Record cash, cheque, transfer, or a payment commitment from this account.</div></div>
    <label>Collection Received Today</label><input id="vCollectionReceived" type="number" min="0" step="0.01" placeholder="SAR">
    <label>Collection Status</label><select id="vCollectionStatus"><option>No collection due</option><option>Collected in full</option><option>Partial collection</option><option>Promise to pay</option><option>Dispute / credit note</option><option>Customer unavailable</option></select>
    <label>Collection Update</label><textarea id="vCollectionNotes" placeholder="Payment method, promise date, reason for delay, or issue"></textarea>
    <label>Expected Order Value</label><input id="vExpected" type="number" placeholder="SAR">
    <label>Estimated Annual Potential</label><input id="vAnnualPotential" type="number" placeholder="SAR">
    <label>Probability of Winning</label><select id="vProbability"><option>10%</option><option>25%</option><option>50%</option><option>75%</option><option>90%</option></select>
    <label>Next Action</label><select id="vNextAction"><option>Call</option><option>Follow-up Visit</option><option>Quotation</option><option>Sample Delivery</option><option>Chef Demo</option><option>Collection</option><option>Training</option><option>Close Opportunity</option></select>
    <label>Follow-up Date</label><input id="vFollow" type="date">
    <label>Visit Notes</label><textarea id="vNotes" placeholder="What happened? What should happen next?"></textarea>
  </section>
  <section class="card visit-step"><h3>6. Action List</h3><p class="muted">Every visit should end with clear actions.</p>
    <label>Action Type</label><select id="actionType"><option>Send quotation</option><option>Arrange chef demo</option><option>Deliver sample</option><option>Follow up with buyer</option><option>Collect payment</option><option>Check competitor price</option><option>Resolve complaint</option><option>Share technical document</option><option>Other</option></select>
    <label>Action Details</label><input id="actionDetails" placeholder="Example: Send MEZ 9x9 quotation">
    <label>Action Owner</label><input id="actionOwner" value="${esc(currentUser?.name||'')}" placeholder="Responsible person">
    <label>Due Date</label><input id="actionDue" type="date">
    <button type="button" onclick="addVisitAction()">Add Action</button><div id="visitActionList" class="action-list"></div>
    <button onclick="document.getElementById('vPhoto').click()" style="width:100%;margin-top:10px">Add Photo</button><input id="vPhoto" type="file" accept="image/*" capture="environment" style="display:none">
    <button id="submitVisitBtn" class="primary submit-big" disabled onclick="submitVisit()">Close Visit</button>
  </section>`);
  $('#vCustomer').oninput=resetGPSCheck;
  setupProductPicker(); renderVisitActions(); resetGPSCheck(); updateCustomerContext();
}
function setupProductPicker(){
  const input=$('#productSearchVisit'), box=$('#productPickList'), selected=$('#selectedProducts');
  function render(){
    selected.innerHTML=pickedProducts.length?pickedProducts.map((p,i)=>`<span class="sel-chip">${esc(p)}<button onclick="pickedProducts.splice(${i},1);setupProductPickerRender()">×</button></span>`).join(''):'<span class="muted">No products selected.</span>';
    const q=(input.value||'').toLowerCase();
    const arr=(DATA.products||[]).filter(p=>!pickedProducts.includes(p.name)&&(!q||[p.name,p.code,p.factory].join(' ').toLowerCase().includes(q))).slice(0,8);
    box.innerHTML=arr.map(p=>`<button type="button" onclick="pickedProducts.push('${js(p.name)}');document.getElementById('productSearchVisit').value='';setupProductPickerRender()">${esc(p.name)}<small>${esc(p.factory)}</small></button>`).join('');
  }
  window.setupProductPickerRender=render; input.oninput=render; render();
}
function renderVisitActions(){ const el=$('#visitActionList'); if(!el) return; el.innerHTML=visitActions.length?visitActions.map((a,i)=>`<div class="action-item"><b>${esc(a.type)}</b><div class="meta">${esc(a.details||'No details')} · Due ${esc(a.due||'Not set')} · Owner ${esc(a.owner||'')}</div><button onclick="visitActions.splice(${i},1);renderVisitActions()">Remove</button></div>`).join(''):'<p class="muted">No actions added yet.</p>'; }
function addVisitAction(){ const type=$('#actionType').value,details=$('#actionDetails').value.trim(),due=$('#actionDue').value,owner=$('#actionOwner').value.trim()||currentUser?.name||'Salesman'; if(!details&&type==='Other'){toast('Add action details');return;} visitActions.push({type,details,due,status:'Open',owner,createdAt:new Date().toISOString()}); $('#actionDetails').value='';$('#actionDue').value='';renderVisitActions(); }
function gpsCheckIn(){
  const c=customerFromInput(); if(!c){ gpsBox('Customer not found. Select a customer from the list first.','bad'); return; }
  const target=getCustomerGPS(c); if(!target){ gpsBox('This account has no GPS registered. Stand at the account and press Register Account GPS once.','bad'); return; }
  if(!navigator.geolocation){ gpsBox('GPS is not supported on this device.','bad'); return; }
  gpsBox('Checking location. Allow location permission.','warn');
  navigator.geolocation.getCurrentPosition(p=>{
    const here={lat:p.coords.latitude,lng:p.coords.longitude}; const d=distanceMeters(here,target);
    gpsCheck={customerCode:c.code,lat:here.lat,lng:here.lng,distance:d,passed:d<=VISIT_RADIUS_M,checkedAt:new Date().toISOString(),accuracy:p.coords.accuracy};
    if(gpsCheck.passed){ visitStartedAt=new Date(); $('#submitVisitBtn').disabled=false; startVisitTimer(); gpsBox(`Visit started. You are ${Math.round(d)} m from the account. Timer is running.`, 'ok'); }
    else { $('#submitVisitBtn').disabled=true; gpsBox(`Blocked. You are ${Math.round(d)} m away. Required: ${VISIT_RADIUS_M} m or less.`, 'bad'); }
  },()=>gpsBox('Location permission is required. Enable Location Services and try again.','bad'),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
function startVisitTimer(){ const el=$('#visitTimer'); if(!el||!visitStartedAt)return; if(visitTimerInterval)clearInterval(visitTimerInterval); const tick=()=>{ const sec=Math.floor((Date.now()-visitStartedAt.getTime())/1000); const m=Math.floor(sec/60),s=sec%60; el.className='gps-status ok';el.textContent=`Visit running: ${m}m ${String(s).padStart(2,'0')}s`; }; tick(); visitTimerInterval=setInterval(tick,1000); }
function registerAccountGPS(){
  const c=customerFromInput(); if(!c){gpsBox('Customer not found. Select a customer first.','bad');return;} if(!navigator.geolocation){gpsBox('GPS is not supported on this device.','bad');return;}
  if(!confirm('Register this phone location as the customer location? Do this only while standing at the account.'))return;
  gpsBox('Capturing account GPS...','warn');
  navigator.geolocation.getCurrentPosition(p=>{accountGPS[c.code]={lat:p.coords.latitude,lng:p.coords.longitude,registeredAt:new Date().toISOString()};saveAll();gpsBox('Account GPS registered. Now press Check In.','ok');},()=>gpsBox('GPS permission is required to register the account.','bad'),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
function checkedValues(id){ return Array.from(document.querySelectorAll(`#${id} input:checked`)).map(x=>x.value).join('|'); }
function submitVisit(){
  const c=customerFromInput(); if(!c){toast('Select a valid customer');return;}
  if(!gpsCheck||!gpsCheck.passed||gpsCheck.customerCode!==c.code){gpsBox('Close Visit is blocked. Check In must be completed within 20 meters of this account.','bad');return;}
  const target=getCustomerGPS(c); if(!navigator.geolocation){gpsBox('GPS is not supported on this device.','bad');return;}
  gpsBox('Checking location to close the visit. Stay within 20 meters.','warn');
  navigator.geolocation.getCurrentPosition(p=>{
    const here={lat:p.coords.latitude,lng:p.coords.longitude}; const d=distanceMeters(here,target);
    gpsCheckOut={lat:here.lat,lng:here.lng,distance:d,passed:d<=VISIT_RADIUS_M,checkedAt:new Date().toISOString(),accuracy:p.coords.accuracy};
    if(!gpsCheckOut.passed){gpsBox(`Close Visit blocked. You are ${Math.round(d)} m away. Return within ${VISIT_RADIUS_M} m of the account.`, 'bad');return;}
    const durationSeconds=visitStartedAt?Math.max(0,Math.floor((Date.now()-visitStartedAt.getTime())/1000)):0;
    if(visitTimerInterval){clearInterval(visitTimerInterval);visitTimerInterval=null;}
    const received=toNum($('#vCollectionReceived').value);
    const v={
      id:crypto?.randomUUID?crypto.randomUUID():String(Date.now()), date:new Date().toISOString(),businessYear:BUSINESS_YEAR,
      customerCode:c.code,customerName:c.name,branch:c.branch||'',city:c.city||'',area:c.area||'',salesman:currentUser?.name||'',salesmanRole:currentUser?.role||'',
      contactsMet:checkedValues('contactsMet'),objective:$('#vObjective').value,result:$('#vResult').value,customerInterest:$('#vInterest').value,
      products:pickedProducts.join('|'),productsRequested:$('#vRequested').value,productsRejected:$('#vRejected').value,sample:$('#vSample').value,sampleDetails:$('#vSampleDetails').value,
      currentSupplier:$('#vCurrentSupplier').value,competitor:$('#vCompetitor').value,competitorPrice:$('#vCompetitorPrice').value,competitorPromotion:$('#vCompetitorPromotion').value,competitorStrengths:$('#vCompetitorStrengths').value,competitorWeaknesses:$('#vCompetitorWeaknesses').value,competitorNews:$('#vCompetitorNews').value,
      collectionTarget:collectionTargetForAccount(c.code),collectionReceived:received,collectionStatus:$('#vCollectionStatus').value,collectionNotes:$('#vCollectionNotes').value,
      expected:$('#vExpected').value,annualPotential:$('#vAnnualPotential').value,probability:$('#vProbability').value,nextAction:$('#vNextAction').value,followUp:$('#vFollow').value,notes:$('#vNotes').value,
      gps:`${gpsCheck.lat},${gpsCheck.lng}`,gpsMapLink:googleMapsLink(gpsCheck.lat,gpsCheck.lng),checkInGps:`${gpsCheck.lat},${gpsCheck.lng}`,checkInMapLink:googleMapsLink(gpsCheck.lat,gpsCheck.lng),checkInDistanceMeters:Math.round(gpsCheck.distance),checkInAccuracy:Math.round(gpsCheck.accuracy||0),checkInAt:gpsCheck.checkedAt,
      checkOutGps:`${gpsCheckOut.lat},${gpsCheckOut.lng}`,checkOutMapLink:googleMapsLink(gpsCheckOut.lat,gpsCheckOut.lng),checkOutDistanceMeters:Math.round(gpsCheckOut.distance),checkOutAccuracy:Math.round(gpsCheckOut.accuracy||0),checkOutAt:gpsCheckOut.checkedAt,
      visitDurationSeconds:durationSeconds,visitDurationMinutes:(durationSeconds/60).toFixed(1),shortVisitFlag:durationSeconds<120?'YES':'NO',gpsVerified:'YES',gpsCheckOutVerified:'YES',
      actions:visitActions.map(a=>({...a,customerCode:c.code,customerName:c.name,visitDate:new Date().toISOString()})),actionCount:visitActions.length
    };
    visits.push(v);
    if(received>0){ collectionReceipts.push({id:v.id,date:today(),salesman:v.salesman,customerCode:c.code,customerName:c.name,amount:received,status:v.collectionStatus,notes:v.collectionNotes,visitId:v.id}); }
    saveAll();toast('Visit closed and saved');route('dashboard');
  },()=>gpsBox('Location permission is required to close the visit.','bad'),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
}

function plan(){
  setTitle('This Month Plan');
  const available=Array.from(new Set([currentMonth(),...journeyPlan.map(r=>String(r.month||r.date||'').slice(0,7)),...manualPlanSlots.map(r=>String(r.month||r.date||'').slice(0,7))].filter(Boolean))).sort();
  if(!available.includes(activePlanMonth)) activePlanMonth=currentMonth();
  const rows=planRowsForUser(activePlanMonth);
  const summary=collectionSummary(activePlanMonth);
  const days=daysInMonth(activePlanMonth);
  screen(`<section class="card"><div class="section-head"><h3>This Month Journey Plan</h3><span class="pill">${monthText(activePlanMonth)}</span></div>
    <div class="plan-toolbar"><select id="planMonthSelect">${available.map(m=>`<option value="${m}" ${m===activePlanMonth?'selected':''}>${monthText(m)}</option>`).join('')}</select><button class="primary" onclick="route('manualSlot')">+ Add</button></div>
    <div class="summary-grid"><div><span>Stores Planned</span><b>${rows.filter(r=>r.customerCode).length}</b></div><div><span>Free Spaces</span><b>${rows.filter(r=>!r.customerCode).length}</b></div><div><span>Collection Target</span><b>${money(summary.target)}</b></div></div>
  </section>
  ${days.map(date=>{
    const dayRows=rows.filter(r=>r.date===date); const count=dayRows.filter(r=>r.customerCode).length;
    return `<section class="plan-day"><div class="plan-day-head"><b>${dateText(date)}</b><span>${count} store${count===1?'':'s'}</span></div>
      ${dayRows.length?dayRows.map(r=>planSlotHtml(r)).join(''):`<div class="plan-empty">No stores planned.</div>`}
      <button class="free-space" onclick="route('manualSlot','${date}')">+ Add free space / manual visit</button>
    </section>`;
  }).join('')}`);
  $('#planMonthSelect').onchange=e=>{activePlanMonth=e.target.value;plan();};
}
function daysInMonth(month){ const [y,m]=month.split('-').map(Number); const total=new Date(y,m,0).getDate(); return Array.from({length:total},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`); }
function planSlotHtml(row){
  const c=getCustomerByCode(row.customerCode)||getCustomerByName(row.customerName);
  const target=collectionTargetForRow(row);
  const title=c?.name||row.customerName||'Free space'; const done=visitDoneForRow(row);
  const action=row.customerCode?`onclick="route('visit','${js(row.customerCode)}')"`:`onclick="route('manualSlot','${js(row.date)}')"`;
  return `<div class="plan-slot ${row.manual?'manual':''}" ${action}><div class="slot-grid"><div class="slot-time">${esc(row.time||'—')}</div><div><b>${esc(title)}</b><div class="meta">${row.customerCode?esc(row.branch||c?.branch||'')+' · '+esc(row.visitObjective||'Visit'):esc(row.notes||'Free space')}</div>${target>0?`<div class="journey-target">Collection target: ${money(target)}</div>`:''}${done?'<span class="pill">Visit completed</span>':''}</div></div></div>`;
}
function manualSlot(prefillDate=''){
  setTitle('Add to Plan');
  const date=prefillDate||today();
  screen(`<section class="card"><h3>Add Free Space or Manual Visit</h3><p class="muted">Use this for a flexible slot, an approved account not yet included in the monthly plan, or a priority follow-up.</p>
    <label>Date</label><input id="mDate" type="date" value="${esc(date)}">
    <label>Time</label><input id="mTime" type="time">
    <label>Slot Type</label><select id="mType"><option value="Free space">Free space</option><option value="Customer visit">Customer visit</option></select>
    <label>Customer, optional for free space</label><input id="mCustomer" list="manualCustomerOptions" placeholder="Search customer or code"><datalist id="manualCustomerOptions">${allCustomers().slice(0,2000).map(c=>`<option value="${esc(c.code+' - '+c.name)}"></option>`).join('')}</datalist>
    <label>Collection Target, optional</label><input id="mCollectionTarget" type="number" min="0" placeholder="SAR">
    <label>Notes</label><textarea id="mNotes" placeholder="Reason for the space or visit"></textarea>
    <button class="primary submit-big" onclick="saveManualSlot()">Save to Journey Plan</button>
  </section>`);
}
function saveManualSlot(){
  const date=$('#mDate').value; if(!date){toast('Select a date');return;}
  const raw=$('#mCustomer').value||''; const code=(raw.match(/^([^ -]+)\s+-\s+/)||[])[1]||''; const c=getCustomerByCode(code)||allCustomers().find(x=>raw.includes(x.name));
  const type=$('#mType').value; if(type==='Customer visit'&&!c){toast('Select an approved customer for a customer visit');return;}
  manualPlanSlots.push({id:String(Date.now()),month:date.slice(0,7),salesman:currentUser?.name||'',date,time:$('#mTime').value,customerCode:c?.code||'',customerName:c?.name||'',branch:c?.branch||currentUser?.branch||'',city:c?.city||'',area:c?.area||'',collectionTargetSAR:toNum($('#mCollectionTarget').value),visitObjective:type,notes:$('#mNotes').value.trim(),createdAt:new Date().toISOString()});
  saveAll();activePlanMonth=date.slice(0,7);toast('Journey plan updated');route('plan');
}

function customers(){
  setTitle('Customers');
  screen(`<section class="top-actions"><button class="primary" onclick="route('newCustomer')">+ Add Approved Customer</button><button onclick="route('plan')">Journey Plan</button></section>
  <section class="search-wrap sticky"><input id="customerSearch" placeholder="Search customer, code, branch"><select id="branchFilter"><option value="">All branches</option>${(DATA.branches||[]).map(b=>`<option>${esc(b)}</option>`).join('')}</select></section><section id="customerList"></section>`);
  const render=()=>{ const q=$('#customerSearch').value.toLowerCase(),b=$('#branchFilter').value; const arr=allCustomers().filter(c=>(!b||c.branch===b)&&(!q||[c.name,c.code,c.branch,c.sector,c.city,c.area].join(' ').toLowerCase().includes(q))).slice(0,100); $('#customerList').innerHTML=arr.map(c=>`<article class="row-card" onclick="customerDetail('${js(c.code)}')"><div class="row-title">${esc(c.name)}</div><div class="meta">${esc(c.code)} · ${esc(c.branch||'')} · ${esc(c.sector||'')}</div><div class="amount">${money(c.monthlyAvgGrossSales)}</div><div class="tagline"><span class="tag">Gross YTD ${money(c.grossSalesYTD)}</span><span class="tag">Orders YTD ${fmt.format(c.ordersYTD||0)}</span>${c.source==='Manual approved entry'?'<span class="tag">Approved entry</span>':''}</div></article>`).join('')||'<div class="card">No customers found.</div>'; };
  $('#customerSearch').oninput=render;$('#branchFilter').onchange=render;render();
}
function customerDetail(code){ const c=getCustomerByCode(code)||allCustomers()[0]; setTitle('Customer'); screen(`<section class="card detail-card">${customerContextHtml(c)}<div class="actions" style="margin-top:14px"><button onclick="route('customers')">Back</button><button class="primary" onclick="route('visit','${js(c.code)}')">Start Visit</button></div></section>`); }
function newCustomer(){
  setTitle('Add Approved Customer');
  screen(`<section class="card"><h3>Add Approved Customer</h3><p class="muted">Add the customer only after it has been approved in the Halwani system. The customer will then be available in search and the journey plan on this phone.</p>
    <label>Approved Customer Code</label><input id="nCode" placeholder="Customer code from Halwani system">
    <label>Customer Name</label><input id="nName">
    <label>Branch</label><select id="nBranch"><option value="${esc(currentUser?.branch||'')}">${esc(currentUser?.branch||'Select branch')}</option>${(DATA.branches||[]).filter(b=>b!==currentUser?.branch).map(b=>`<option>${esc(b)}</option>`).join('')}</select>
    <label>City</label><input id="nCity"><label>Area</label><input id="nArea"><label>Channel</label><input id="nChannel"><label>Sub Channel</label><input id="nSubChannel"><label>Contact Person</label><input id="nContact"><label>Mobile</label><input id="nMobile">
    <label class="checkbox-grid"><input type="checkbox" id="nApproved"> Confirmed: this account is approved in the Halwani system</label>
    <button class="primary submit-big" onclick="saveNewCustomer()">Save Approved Customer</button>
  </section>`);
}
function saveNewCustomer(){
  const code=$('#nCode').value.trim(),name=$('#nName').value.trim(); if(!code||!name){toast('Customer code and customer name are required');return;} if(!$('#nApproved').checked){toast('Confirm system approval before saving');return;} if(getCustomerByCode(code)){toast('This customer code already exists');return;}
  manualCustomers.push({code,name,branch:$('#nBranch').value,city:$('#nCity').value.trim(),area:$('#nArea').value.trim(),channel:$('#nChannel').value.trim(),subChannel:$('#nSubChannel').value.trim(),sector:$('#nChannel').value.trim(),contactPerson:$('#nContact').value.trim(),mobile:$('#nMobile').value.trim(),status:'Active',grossSalesYTD:0,monthlyAvgGrossSales:0,ordersYTD:0,qtyYTD:0,productsPurchasedYTD:0,lastMonthYTD:'',topProducts:[],source:'Manual approved entry',addedBy:currentUser?.name||'',addedAt:new Date().toISOString()});
  saveAll();toast('Approved customer saved');route('customers');
}

function lists(){ setTitle('Master Lists'); screen(`<section class="card"><h3>Master Lists</h3><div class="actions"><button onclick="route('customers')">Customers</button><button onclick="products()">Products</button><button onclick="competitorList()">Competitors</button><button onclick="objectivesList()">Visit Setup</button></div></section>`); }
function products(){ setTitle('Products'); screen(`<section class="search-wrap sticky"><input id="productSearch" placeholder="Search product or code"><select id="factoryFilter"><option value="">All factories</option>${(DATA.factories||[]).map(f=>`<option>${esc(f)}</option>`).join('')}</select></section><section id="productList"></section>`); const render=()=>{const q=$('#productSearch').value.toLowerCase(),f=$('#factoryFilter').value; const arr=(DATA.products||[]).filter(p=>(!f||p.factory===f)&&(!q||[p.name,p.code,p.factory].join(' ').toLowerCase().includes(q))).slice(0,80); $('#productList').innerHTML=arr.map(p=>`<article class="row-card"><div class="row-title">${esc(p.name)}</div><div class="meta">${esc(p.code)} · ${esc(p.factory)}</div><div class="amount">${money(p.monthlyAvgGrossSales)}</div><div class="tagline"><span class="tag">Gross YTD ${money(p.grossSalesYTD)}</span><span class="tag">Customers YTD ${fmt.format(p.customersYTD)}</span></div></article>`).join('')||'<div class="card">No products found.</div>';};$('#productSearch').oninput=render;$('#factoryFilter').onchange=render;render(); }
function competitorList(){setTitle('Competitors');screen(`<section class="card"><h3>Competitor Brands</h3>${(DATA.competitors||[]).map(x=>`<div class="mini-item"><b>${esc(x)}</b><div class="meta">Used in visit competition update</div></div>`).join('')}</section>`);}
function objectivesList(){setTitle('Visit Setup');screen(`<section class="card"><h3>Visit Objectives</h3>${(DATA.visitObjectives||[]).map(x=>`<div class="mini-item"><b>${esc(x)}</b></div>`).join('')}</section><section class="card"><h3>Visit Results</h3>${(DATA.visitResults||[]).map(x=>`<div class="mini-item"><b>${esc(x)}</b></div>`).join('')}</section>`);}

function reports(){
  setTitle('Records');
  const summary=collectionSummary();
  const mine=isSalesman()?visits.filter(v=>normalize(v.salesman)===normalize(currentUser.name)):visits;
  screen(`<section class="card"><h3>Saved Visits</h3>${kv('Visits on this phone',mine.length)}${kv('GPS Rule',VISIT_RADIUS_M+' meters')}${kv('Gross Sales Mode','YTD from Jan 2026')}<button class="primary" style="width:100%;margin-top:12px" onclick="exportVisitsCSV()">Export Visits CSV</button><button style="width:100%;margin-top:10px" onclick="exportActionsCSV()">Export Actions CSV</button></section>
  <section class="card collection-summary"><h3>Collections · ${monthText(activePlanMonth)}</h3>${kv('Monthly target',money(summary.target))}${kv('Collected',money(summary.collected))}${kv('Remaining',money(summary.remaining))}<button class="primary" style="width:100%;margin-top:12px" onclick="exportCollectionsCSV()">Export Collections CSV</button></section>
  <section class="card"><h3>Latest Visits</h3>${mine.slice(-20).reverse().map(v=>`<div class="mini-item"><b>${esc(v.customerName||v.customer)}</b><div class="meta">${(v.date||'').slice(0,10)} · ${esc(v.objective)} · ${esc(v.result)}</div><div class="meta">Collection ${money(v.collectionReceived)} · ${esc(v.collectionStatus||'')}</div><div class="meta">Next: ${esc(v.nextAction||'')} · ${esc(v.followUp||'No date')} · GPS ${esc(v.checkInDistanceMeters||'')} m · ${esc(v.visitDurationMinutes||'')} min</div></div>`).join('')||'<p class="muted">No visits saved yet.</p>'}</section>
  ${isManager()?`<section class="card"><h3>Admin Tools</h3><p class="muted">Load monthly journey plans, collection targets, and customer database updates for pilot testing.</p><div class="actions"><button class="primary" onclick="route('importHub')">Import & Update Data</button><button onclick="route('lists')">Master Lists</button></div></section>`:''}`);
}
function importHub(){
  setTitle('Import & Update Data');
  const importedCount=importedCustomers.length;
  const sourceLabel=customerMasterMode==='replace'&&importedCount?'Imported customer master':'Base customer master + imported updates';
  const counts=backupCounts();
  screen(`<section class="card"><h3>Import & Update Data</h3><p class="admin-note">Imports are stored locally on this device. Save a Local Database Backup after every monthly update, then keep the backup in Files, OneDrive, or company storage.</p>
    <section class="database-status"><span class="meta">Local Database Backup</span><b>${fmt.format(counts.customers)} customers · ${fmt.format(counts.visits)} visits</b><div class="meta">${fmt.format(counts.journey)} plan slots · ${fmt.format(counts.collections)} collection targets · ${fmt.format(counts.receipts)} receipts</div>
      <div class="backup-actions"><button class="primary" onclick="downloadLocalBackup()">Save Local Backup</button><label class="restore-label">Restore Backup<input class="file-input" id="localBackupImport" type="file" accept=".json,application/json"></label><button class="secondary" onclick="restoreLocalBackup()">Restore Local Backup</button></div>
    </section>
    <div class="database-status"><span class="meta">Customer database</span><b>${fmt.format(allCustomers().length)} active accounts</b><div class="meta">${esc(sourceLabel)} · ${fmt.format(importedCount)} imported rows</div></div>
    <div class="import-stack">
      <label>Customer Database Update</label><input class="file-input" id="customerImport" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
      <label>Update Mode</label><select id="customerImportMode"><option value="merge" ${customerMasterMode==='merge'?'selected':''}>Merge updates and add new customers</option><option value="replace" ${customerMasterMode==='replace'?'selected':''}>Replace customer master on this device</option></select>
      <button onclick="downloadCustomerTemplate()">Download Customer Database Template</button>
      <div class="soft-divider"></div>
      <label>Journey Plan File</label><input class="file-input" id="journeyImport" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
      <button onclick="downloadJourneyTemplate()">Download Journey Plan Template</button>
      <div class="soft-divider"></div>
      <label>Collection Targets File</label><input class="file-input" id="collectionImport" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
      <button onclick="downloadCollectionTemplate()">Download Collection Targets Template</button>
      <div class="soft-divider"></div>
      <button class="primary submit-big" onclick="importMonthlyData()">Import Selected Files</button>
      <button class="danger" onclick="clearImportedData()">Clear Journey and Collections Data</button>
      <button class="secondary" onclick="clearCustomerDatabaseUpdate()">Reset Customer Database Update</button>
    </div>
  </section>`);
}
function headerKey(value){
  return String(value??'').trim().toLowerCase().replace(/[\s_\-\/\\().]+/g,'').replace(/[^\da-z\u0600-\u06FF]/gi,'');
}
function rowsToObjects(rows){
  if(!rows?.length) return [];
  const headers=(rows.shift()||[]).map(headerKey);
  return rows.filter(row=>row.some(v=>String(v??'').trim()!==''))
    .map(row=>Object.fromEntries(headers.map((h,i)=>[h,String(row[i]??'').trim()])));
}
function parseCSV(text){
  const rows=[]; let row=[],cell='',quote=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(ch==='"'&&quote&&next==='"'){cell+='"';i++;continue;}
    if(ch==='"'){quote=!quote;continue;}
    if(ch===','&&!quote){row.push(cell);cell='';continue;}
    if((ch==='\n'||ch==='\r')&&!quote){if(ch==='\r'&&next==='\n')i++;row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);row=[];cell='';continue;}
    cell+=ch;
  }
  row.push(cell); if(row.some(v=>String(v).trim()!==''))rows.push(row);
  return rowsToObjects(rows);
}
function field(r,...names){
  for(const name of names){const value=r[headerKey(name)]; if(value!==undefined && String(value).trim()!=='') return String(value).trim();}
  return '';
}
function mapJourneyRow(r){
  const rawDate=field(r,'visit date','date','planned date','تاريخ الزيارة','التاريخ');
  const date=dateFromExcelValue(rawDate);
  const suppliedMonth=field(r,'month','period','الشهر');
  return {
    month:suppliedMonth||String(date||'').slice(0,7),
    salesmanId:field(r,'salesman id','salesmanid','employee id','employeeid','رقم المندوب'),
    salesman:field(r,'salesman name','salesman','salesperson','sales rep','مندوب','مندوب المبيعات'),
    date,
    time:timeFromExcelValue(field(r,'visit time','time','planned time','وقت الزيارة','الوقت')),
    customerCode:field(r,'customer code','customder code','customerCode','account code','code','رمز العميل','كود العميل'),
    customerName:field(r,'customer name','customerName','customer','account name','اسم العميل','العميل'),
    branch:field(r,'branch','branch name','الفرع'),city:field(r,'city','المدينة'),area:field(r,'area','district','المنطقة','الحي'),
    notes:field(r,'notes','note','remarks','ملاحظات')
  };
}
function mapCollectionRow(r){
  const dueDate=dateFromExcelValue(field(r,'due date','duedate','date','تاريخ الاستحقاق','التاريخ'));
  const suppliedMonth=field(r,'month','period','الشهر');
  return {
    month:suppliedMonth||String(dueDate||'').slice(0,7),
    salesmanId:field(r,'salesman id','salesmanid','employee id','employeeid','رقم المندوب'),
    salesman:field(r,'salesman name','salesman','salesperson','sales rep','مندوب','مندوب المبيعات'),
    customerCode:field(r,'customer code','customerCode','account code','code','رمز العميل','كود العميل'),
    customerName:field(r,'customername','customer name','customerName','customer','account name','اسم العميل','العميل'),
    collectionTargetSAR:field(r,'collection target sar','collection target( sar)','collectiontargetsar','collection target','target','مستهدف التحصيل'),
    dueDate,
    salesTargetSAR:field(r,'sales target sar','sales target( sar)','salestargetsar','sales target','مستهدف المبيعات'),
    notes:field(r,'notes','note','remarks','ملاحظات')
  };
}
function mapCustomerRow(r){
  return {code:field(r,'customerCode','customer code','account code','code','customer id','رمز العميل','كود العميل','رقم العميل'),name:field(r,'customerName','customer name','customer','account name','name','اسم العميل','العميل'),branch:field(r,'branch','branch name','الفرع'),city:field(r,'city','المدينة'),area:field(r,'area','district','المنطقة','الحي'),channel:field(r,'channel','القناة'),subChannel:field(r,'subChannel','sub channel','subchannel','التصنيف الفرعي'),sector:field(r,'sector','القطاع'),salesman:field(r,'salesman','salesperson','sales rep','مندوب','مندوب المبيعات'),manager:field(r,'manager','المدير'),route:field(r,'route','المسار'),status:field(r,'status','الحالة')||'Active',contactPerson:field(r,'contactPerson','contact person','contact','buyer','جهة الاتصال','الشخص المسؤول'),mobile:field(r,'mobile','phone','mobile number','الجوال'),gps:field(r,'gps','coordinates','location','الموقع','إحداثيات'),grossSalesYTD:toNum(field(r,'grossSalesYTD','gross sales ytd','gross sales','إجمالي المبيعات')),monthlyAvgGrossSales:toNum(field(r,'monthlyAvgGrossSales','monthly average gross sales','monthly average','متوسط المبيعات الشهرية')),ordersYTD:toNum(field(r,'ordersYTD','orders ytd','orders','عدد الطلبات')),qtyYTD:toNum(field(r,'qtyYTD','cases ytd','quantity ytd','cases','الكمية')),productsPurchasedYTD:toNum(field(r,'productsPurchasedYTD','products purchased ytd','products purchased','عدد المنتجات')),lastMonthYTD:field(r,'lastMonthYTD','last purchase month','last month','آخر شهر شراء'),source:'Customer database import',updatedAt:new Date().toISOString()};
}
function readImportFile(input){
  return new Promise((resolve,reject)=>{
    const file=input?.files?.[0]; if(!file){resolve(null);return;}
    const isExcel=/\.(xlsx|xls)$/i.test(file.name);
    const reader=new FileReader();
    reader.onerror=reject;
    reader.onload=e=>{
      try{
        if(isExcel){
          if(!window.XLSX) throw new Error('Excel reader is still loading. Wait a few seconds and try again.');
          const wb=window.XLSX.read(e.target.result,{type:'array',cellDates:true});
          const ws=wb.Sheets[wb.SheetNames[0]];
          const rows=window.XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
          resolve(rowsToObjects(rows));
        }else resolve(parseCSV(String(e.target.result||'')));
      }catch(err){reject(err);}
    };
    if(isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  });
}
function applyCustomerImport(rows, mode){
  const mapped=rows.map(mapCustomerRow).filter(r=>r.code&&r.name);
  if(!mapped.length) throw new Error('No valid customer rows found');
  customerMasterMode=mode;
  if(mode==='replace') importedCustomers=mapped;
  else {
    const map=new Map(importedCustomers.map(c=>[customerKey(c),c]));
    mapped.forEach(c=>{const current=getCustomerByCode(c.code)||{};map.set(customerKey(c),{...current,...c});});
    importedCustomers=Array.from(map.values());
  }
  return mapped.length;
}
async function importMonthlyData(){
  try{
    const customerRows=await readImportFile($('#customerImport'));
    const journeyRows=await readImportFile($('#journeyImport'));
    const collectionRows=await readImportFile($('#collectionImport'));
    if(!customerRows&&!journeyRows&&!collectionRows){toast('Choose at least one file');return;}
    const messages=[];
    if(customerRows){messages.push(`${applyCustomerImport(customerRows,$('#customerImportMode').value)} customers`);}
    if(journeyRows){journeyPlan=journeyRows.map(mapJourneyRow).filter(r=>r.date&&r.customerCode);messages.push(`${journeyPlan.length} journey rows`);}
    if(collectionRows){collectionTargets=collectionRows.map(mapCollectionRow).filter(r=>r.customerCode&&r.collectionTargetSAR!=='');messages.push(`${collectionTargets.length} collection targets`);}
    const selectedMonth=(journeyPlan[0]?.month||collectionTargets[0]?.month||currentMonth()); activePlanMonth=selectedMonth; saveAll();toast(`Imported ${messages.join(' · ')}`);route(customerRows?'customers':'plan');
  }catch(e){console.error(e);toast(e?.message||'Could not read the file. Check the template and try again.');}
}
function clearImportedData(){ if(!confirm('Clear imported journey plan and collection targets from this browser?'))return; journeyPlan=[];collectionTargets=[];saveAll();toast('Journey and collection data cleared');route('reports'); }
function clearCustomerDatabaseUpdate(){ if(!confirm('Reset imported customer database updates on this browser?'))return; importedCustomers=[];customerMasterMode='merge';saveAll();toast('Customer database update reset');route('importHub'); }
function downloadFile(name, content, type='text/csv'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);} 
function downloadJourneyTemplate(){ downloadStaticTemplate('templates/monthly_journey_plan_template.xlsx','monthly_journey_plan_template.xlsx'); }
function downloadCollectionTemplate(){ downloadStaticTemplate('templates/monthly_collection_targets_template.xlsx','monthly_collection_targets_template.xlsx'); }
function downloadCustomerTemplate(){ downloadFile('customer_database_update_template.csv','customerCode,customerName,branch,city,area,channel,subChannel,sector,salesman,manager,status,contactPerson,mobile,gps,grossSalesYTD,monthlyAvgGrossSales,ordersYTD,qtyYTD,productsPurchasedYTD,lastMonthYTD\n142407,شركة المأكولات السريعة,Jeddah,Jeddah,Prince Sultan,Catering,QSR,Catering,Ahmed Nabil,Regional Manager,Active,Ahmed,0500000000,21.5433,39.1728,3532193,588699,31,24293,9,202606\n'); }

function googleMapsLink(lat,lng){return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;}
function exportVisitsCSV(){
  const cols=['date','businessYear','customerCode','customerName','branch','city','area','salesman','salesmanRole','contactsMet','objective','result','customerInterest','products','productsRequested','productsRejected','sample','sampleDetails','currentSupplier','competitor','competitorPrice','competitorPromotion','competitorStrengths','competitorWeaknesses','competitorNews','collectionTarget','collectionReceived','collectionStatus','collectionNotes','expected','annualPotential','probability','nextAction','followUp','notes','gps','gpsMapLink','checkInGps','checkInMapLink','checkInDistanceMeters','checkInAccuracy','checkInAt','checkOutGps','checkOutMapLink','checkOutDistanceMeters','checkOutAccuracy','checkOutAt','visitDurationSeconds','visitDurationMinutes','shortVisitFlag','gpsVerified','gpsCheckOutVerified','actionCount','actions'];
  const mine=isSalesman()?visits.filter(v=>normalize(v.salesman)===normalize(currentUser.name)):visits;
  const rows=[cols,...mine.map(v=>cols.map(c=>c==='actions'?JSON.stringify(v.actions||[]):(v[c]??'')))];
  downloadFile('halwani_visit_export.csv',rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n'));
}
function exportActionsCSV(){ const mine=isSalesman()?visits.filter(v=>normalize(v.salesman)===normalize(currentUser.name)):visits; const actions=mine.flatMap(v=>(v.actions||[]).map(a=>({...a,visitDate:v.date,customerCode:v.customerCode,customerName:v.customerName,salesman:v.salesman,visitResult:v.result})));const cols=['visitDate','customerCode','customerName','salesman','type','details','due','status','owner','createdAt','visitResult'];const rows=[cols,...actions.map(a=>cols.map(c=>a[c]||''))];downloadFile('halwani_visit_actions_export.csv',rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n')); }
function exportCollectionsCSV(){ const receipts=isSalesman()?collectionReceipts.filter(r=>normalize(r.salesman)===normalize(currentUser.name)):collectionReceipts;const cols=['date','salesman','customerCode','customerName','amount','status','notes','visitId','gpsMapLink'];const byVisit=new Map(visits.map(v=>[v.id,v]));const rows=[cols,...receipts.map(r=>cols.map(c=>c==='gpsMapLink'?(byVisit.get(r.visitId)?.gpsMapLink||''):(r[c]||'')))];downloadFile('halwani_collections_export.csv',rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n')); }

function route(s,arg){
  if(!requireLogin()){login();return;}
  $('.bottom-nav').style.display='grid';$('#exportBtn').style.display='inline-flex';navActive(s);
  const routes={dashboard,visit,plan,customers,reports,lists,newCustomer,manualSlot,importHub};
  (routes[s]||dashboard)(arg);
}
$$('.bottom-nav button').forEach(b=>b.onclick=()=>route(b.dataset.screen));
$('#exportBtn').onclick=exportVisitsCSV;
if(currentUser){route('dashboard');}else{login();}
