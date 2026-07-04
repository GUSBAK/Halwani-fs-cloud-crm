/* Halwani Cloud Bridge. Keeps the approved local-backup UI while using Supabase as the shared database. */
(() => {
  let sb = null;
  let cloudProfile = null;
  let cloudRows = { profiles: [], customers: [], products: [], journeys: [], targets: [], visits: [], receipts: [], actions: [], competition: [], visitProducts: [], locations: [] };
  let activeCloudVisit = null;
  let initialised = false;

  const roleLabel = (role) => ({
    salesperson: 'Salesman', supervisor: 'Supervisor', regional_manager: 'Regional Manager',
    national_manager: 'National Manager', head_of_food_service: 'Head of Food Service', admin: 'Head of Food Service'
  }[role] || 'Salesman');
  const leadership = () => ['admin','head_of_food_service','national_manager','regional_manager','supervisor'].includes(cloudProfile?.role);
  const idBy = (arr) => Object.fromEntries((arr || []).map(x => [x.id, x]));
  const byCode = (arr) => Object.fromEntries((arr || []).map(x => [x.customer_code, x]));
  const asNumber = (v) => Number(v || 0);
  const isoDate = (v) => String(v || '').slice(0,10);
  const cloudMonthDate = (month) => `${month || currentMonth()}-01`;
  const mapReceiptStatus = (v) => ({
    'Collected in full': 'received', 'Partial collection': 'partial', 'Promise to pay': 'promised',
    'Dispute / credit note': 'rejected', 'Customer unavailable': 'promised', 'No collection due': 'promised'
  }[v] || 'received');

  function notice(message, type='bad') {
    screen(`<section class="card login-card"><img src="assets/halwani-logo.png" class="login-logo" alt="Halwani Bros"><h2>Food Service CRM</h2><div class="gps-status ${type}">${esc(message)}</div><button class="primary submit-big" onclick="cloudRetry()">Try again</button></section>`);
  }

  async function getConfig() {
    const response = await fetch('/api/cloud-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load cloud configuration.');
    return response.json();
  }

  async function getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function hydrate(session) {
    if (!session?.user) { cloudLogin(); return; }
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (error || !profile) {
      notice('Your account exists, but its Food Service profile is not ready. Ask the administrator to add your profile.');
      return;
    }
    if (!profile.is_active) { notice('This account is inactive. Contact the Food Service administrator.'); return; }
    cloudProfile = profile;
    currentUser = {
      id: profile.id, name: profile.full_name || session.user.email.split('@')[0],
      role: roleLabel(profile.role), cloudRole: profile.role, branch: profile.region || 'KSA',
      region: profile.region || 'KSA', email: profile.email || session.user.email, loginAt: new Date().toISOString()
    };
    await refreshCloud();
    $('.bottom-nav').style.display = 'grid';
    $('#exportBtn').style.display = 'inline-flex';
    configureNavigation();
    if (location.search.includes('invite=1') || location.hash.includes('type=invite')) {
      invitationScreen();
    } else {
      route('dashboard');
    }
  }

  async function refreshCloud() {
    if (!sb || !cloudProfile) return;
    const results = await Promise.all([
      sb.from('profiles').select('*'),
      sb.from('customers').select('*').order('name'),
      sb.from('products').select('*').eq('active', true).order('name'),
      sb.from('journey_plans').select('*').order('visit_date').order('visit_time'),
      sb.from('collection_targets').select('*'),
      sb.from('visits').select('*').order('check_in_at', { ascending: false }),
      sb.from('collection_receipts').select('*').order('receipt_date', { ascending: false }),
      sb.from('actions').select('*').order('created_at', { ascending: false }),
      sb.from('competition_updates').select('*').order('created_at', { ascending: false }),
      sb.from('visit_products').select('*'),
      sb.from('visit_locations').select('*').order('recorded_at', { ascending: false })
    ]);
    const names = ['profiles','customers','products','journeys','targets','visits','receipts','actions','competition','visitProducts','locations'];
    results.forEach((r, i) => {
      if (r.error) console.warn(`Cloud load ${names[i]}:`, r.error.message);
      cloudRows[names[i]] = r.data || [];
    });
    syncLegacyState();
  }

  function syncLegacyState() {
    const people = idBy(cloudRows.profiles);
    const customerRaw = byCode(cloudRows.customers);
    const customers = cloudRows.customers.map(c => ({
      cloudId: c.id, id: c.id, code: c.customer_code, name: c.name, branch: c.branch || '', city: c.city || '', area: c.area || '',
      channel: c.channel || '', subChannel: c.sub_channel || '', sector: c.channel || '', contactPerson: c.contact_name || '', mobile: c.mobile || '',
      status: c.status || 'Active', grossSalesYTD: asNumber(c.gross_sales_ytd), monthlyAvgGrossSales: asNumber(c.monthly_average_gross_sales),
      ordersYTD: 0, qtyYTD: 0, productsPurchasedYTD: 0, lastMonthYTD: '',
      lat: c.gps_lat, lng: c.gps_lng, gps: c.gps_lat != null && c.gps_lng != null ? `${c.gps_lat},${c.gps_lng}` : '',
      gpsRadiusM: c.gps_radius_m || 20, notes: c.notes || '', source: 'Cloud CRM', topProducts: []
    }));
    importedCustomers = customers;
    manualCustomers = [];
    customerMasterMode = 'replace';
    accountGPS = Object.fromEntries(customers.filter(c => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))).map(c => [c.code, { lat: Number(c.lat), lng: Number(c.lng), registeredAt: 'Cloud database' }]));
    DATA.products = cloudRows.products.map(p => ({ id: p.id, code: p.sku || '', name: p.name, factory: p.brand || p.category || '', brand: p.brand || '', category: p.category || '' }));

    const customerById = idBy(cloudRows.customers);
    journeyPlan = cloudRows.journeys.map(j => {
      const c = customerById[j.customer_id] || {};
      const p = people[j.salesperson_id] || {};
      return { cloudId: j.id, month: String(j.plan_month || '').slice(0,7), salesman: p.full_name || '', date: j.visit_date, time: String(j.visit_time || '').slice(0,5),
        customerCode: c.customer_code || '', customerName: c.name || '', branch: j.branch || c.branch || '', city: j.city || c.city || '', area: j.area || c.area || '', visitObjective: 'Visit', notes: j.notes || '' };
    });
    manualPlanSlots = [];
    collectionTargets = cloudRows.targets.map(t => {
      const c = customerById[t.customer_id] || {}; const p = people[t.salesperson_id] || {};
      return { cloudId: t.id, month: String(t.target_month || '').slice(0,7), salesman: p.full_name || '', customerCode: c.customer_code || '', customerName: c.name || '',
        collectionTargetSAR: asNumber(t.collection_target_sar), salesTargetSAR: asNumber(t.sales_target_sar), dueDate: t.due_date || '', notes: t.notes || '' };
    });
    collectionReceipts = cloudRows.receipts.map(r => {
      const c = customerById[r.customer_id] || {}; const p = people[r.salesperson_id] || {};
      return { id: r.id, visitId: r.visit_id, date: r.receipt_date, salesman: p.full_name || '', customerCode: c.customer_code || '', customerName: c.name || '',
        amount: asNumber(r.amount_sar), status: r.payment_status, notes: r.notes || '' };
    });
    const receiptsByVisit = {};
    cloudRows.receipts.forEach(r => { if (r.visit_id) receiptsByVisit[r.visit_id] = r; });
    const actionByVisit = {};
    cloudRows.actions.forEach(a => { if (a.visit_id) (actionByVisit[a.visit_id] ||= []).push(a); });
    const compByVisit = {};
    cloudRows.competition.forEach(c => { (compByVisit[c.visit_id] ||= []).push(c); });
    const productsByVisit = {};
    const productMap = idBy(cloudRows.products);
    cloudRows.visitProducts.forEach(vp => { (productsByVisit[vp.visit_id] ||= []).push(productMap[vp.product_id]?.name || 'Product'); });
    visits = cloudRows.visits.map(v => {
      const c = customerById[v.customer_id] || {}; const p = people[v.salesperson_id] || {}; const receipt = receiptsByVisit[v.id]; const comp = (compByVisit[v.id] || [])[0] || {}; const acts = actionByVisit[v.id] || [];
      const secs = v.check_out_at ? Math.max(0, Math.round((new Date(v.check_out_at).getTime() - new Date(v.check_in_at).getTime())/1000)) : 0;
      return { id: v.id, cloudId: v.id, status: v.status, date: v.check_in_at, businessYear: 2026, customerCode: c.customer_code || '', customerName: c.name || '', branch: c.branch || '', city: c.city || '', area: c.area || '',
        salesman: p.full_name || '', salesmanRole: roleLabel(p.role), contactsMet: v.contact_met || '', objective: v.visit_objective || 'Visit', result: v.result || '', customerInterest: v.customer_interest || '', products: (productsByVisit[v.id] || []).join('|'),
        productsRequested: '', productsRejected: '', sample: 'No', sampleDetails: '', currentSupplier: '', competitor: comp.competitor_brand || '', competitorPrice: comp.competitor_price_sar || '', competitorPromotion: comp.promotion || '', competitorStrengths: comp.strengths || '', competitorWeaknesses: comp.weaknesses || '', competitorNews: comp.update_notes || '',
        collectionTarget: 0, collectionReceived: receipt ? asNumber(receipt.amount_sar) : 0, collectionStatus: receipt?.payment_status || 'No collection due', collectionNotes: receipt?.notes || '', expected: asNumber(v.expected_order_sar), annualPotential: '', probability: '', nextAction: v.next_action || '', followUp: v.follow_up_date || '', notes: v.notes || '',
        gps: `${v.check_in_lat || ''},${v.check_in_lng || ''}`, gpsMapLink: googleMapsLink(v.check_in_lat, v.check_in_lng), checkInGps: `${v.check_in_lat || ''},${v.check_in_lng || ''}`, checkInMapLink: googleMapsLink(v.check_in_lat, v.check_in_lng), checkInDistanceMeters: v.check_in_distance_m || '', checkInAccuracy: v.check_in_accuracy_m || '', checkInAt: v.check_in_at || '',
        checkOutGps: `${v.check_out_lat || ''},${v.check_out_lng || ''}`, checkOutMapLink: v.check_out_lat != null ? googleMapsLink(v.check_out_lat, v.check_out_lng) : '', checkOutDistanceMeters: v.check_out_distance_m || '', checkOutAccuracy: v.check_out_accuracy_m || '', checkOutAt: v.check_out_at || '',
        visitDurationSeconds: secs, visitDurationMinutes: secs ? (secs/60).toFixed(1) : '', shortVisitFlag: !!v.short_visit_flag, gpsVerified: true, gpsCheckOutVerified: !!v.check_out_at,
        actionCount: acts.length, actions: acts.map(a => ({ type: a.action_type, details: a.details || '', due: a.due_date || '', status: a.status === 'completed' ? 'Done' : a.status === 'cancelled' ? 'Cancelled' : 'Open', owner: people[a.owner_id]?.full_name || p.full_name || '', createdAt: a.created_at })) };
    });
    activeCloudVisit = cloudRows.visits.find(v => v.status === 'active' && v.salesperson_id === currentUser.id) || null;
    activePlanMonth = activePlanMonth || currentMonth();
  }

  function cloudLogin(message='') {
    currentUser = null; cloudProfile = null;
    $('.bottom-nav').style.display = 'none'; $('#exportBtn').style.display = 'none';
    screen(`<section class="login-card card">
      <img src="assets/halwani-logo.png" class="login-logo" alt="Halwani Bros">
      <h2>Food Service CRM</h2>
      <p class="muted">Sales execution, collections, GPS verified visits, and action tracking.</p>
      ${message ? `<div class="gps-status bad">${esc(message)}</div>` : ''}
      <label>Work email</label><input id="loginEmail" type="email" autocomplete="email" placeholder="name@halwani.com">
      <label>Password</label><input id="loginPassword" type="password" autocomplete="current-password" placeholder="••••••••">
      <button class="primary submit-big" onclick="doLogin()">Sign in</button>
      <p class="muted" style="margin-top:14px">Accounts are created by the Food Service administrator. New users set their password from the invitation email.</p>
    </section>`);
    $('#loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') cloudDoLogin(); });
  }

  async function cloudDoLogin() {
    const email = $('#loginEmail')?.value?.trim(); const password = $('#loginPassword')?.value || '';
    if (!email || !password) { toast('Enter your work email and password'); return; }
    const btn = $('.submit-big'); if (btn) { btn.disabled=true; btn.textContent='Signing in...'; }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { cloudLogin(error.message); return; }
    await hydrate(data.session);
  }

  async function cloudLogout() { await sb.auth.signOut(); currentUser = null; cloudProfile = null; activeCloudVisit = null; cloudLogin(); }

  function invitationScreen() {
    $('.bottom-nav').style.display = 'none'; $('#exportBtn').style.display = 'none';
    screen(`<section class="login-card card"><img src="assets/halwani-logo.png" class="login-logo" alt="Halwani Bros"><h2>Set your password</h2><p class="muted">Create a password for your Halwani Food Service account.</p>
      <label>New password</label><input id="invitePassword" type="password" autocomplete="new-password" placeholder="At least 8 characters">
      <label>Confirm password</label><input id="inviteConfirm" type="password" autocomplete="new-password" placeholder="Repeat password">
      <button class="primary submit-big" onclick="finishInvitation()">Activate account</button></section>`);
  }
  async function finishInvitation() {
    const p = $('#invitePassword').value; const c = $('#inviteConfirm').value;
    if (p.length < 8) { toast('Use at least 8 characters'); return; }
    if (p !== c) { toast('Passwords do not match'); return; }
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) { toast(error.message); return; }
    history.replaceState({}, '', '/');
    const session = await getSession(); await hydrate(session);
    toast('Password saved. Your account is ready.');
  }

  function configureNavigation() {
    const nav = $('.bottom-nav');
    let manage = nav.querySelector('[data-screen="manage"]');
    if (leadership() && !manage) {
      manage = document.createElement('button'); manage.dataset.screen='manage'; manage.textContent='Manage'; manage.onclick=()=>route('manage'); nav.appendChild(manage); nav.style.gridTemplateColumns='repeat(6,1fr)';
    }
    if (!leadership() && manage) { manage.remove(); nav.style.gridTemplateColumns='repeat(5,1fr)'; }
  }

  function manage() {
    setTitle('Manage'); navActive('manage');
    const todayRows = cloudRows.visits.filter(v => isoDate(v.check_in_at) === today());
    const active = cloudRows.visits.filter(v => v.status === 'active');
    const closed = todayRows.filter(v => v.status === 'closed');
    const people = idBy(cloudRows.profiles); const customers = idBy(cloudRows.customers);
    const currentTargets = cloudRows.targets.filter(t => String(t.target_month||'').slice(0,7) === currentMonth());
    const currentReceipts = cloudRows.receipts.filter(r => String(r.receipt_date||'').slice(0,7) === currentMonth());
    const team = cloudRows.profiles.filter(p => ['salesperson','supervisor','regional_manager','national_manager','head_of_food_service'].includes(p.role));
    screen(`<section class="card"><div class="section-head"><h3>Live Team Activity</h3><button onclick="route('dashboard')">Home</button></div><p class="muted">Last verified GPS is displayed only during active visits. This is not all-day tracking.</p>
      ${active.length?active.map(v=>{const p=people[v.salesperson_id]||{},c=customers[v.customer_id]||{};return `<div class="visit-card"><b>${esc(p.full_name||'Salesperson')}</b><div class="meta">${esc(c.name||'Customer')} · Checked in ${new Date(v.check_in_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div><a class="tag" target="_blank" href="${googleMapsLink(v.check_in_lat,v.check_in_lng)}">Open last verified GPS</a></div>`}).join(''):'<p class="muted">No active visits right now.</p>'}
    </section>
    <section class="home-kpis"><div class="home-kpi"><b>${active.length}</b><span>Active visits now</span></div><div class="home-kpi"><b>${closed.length}</b><span>Visits completed today</span></div><div class="home-kpi"><b>${money(currentReceipts.reduce((a,r)=>a+asNumber(r.amount_sar),0))}</b><span>Collections this month</span></div><div class="home-kpi"><b>${money(currentTargets.reduce((a,r)=>a+asNumber(r.collection_target_sar),0))}</b><span>Collection target MTD</span></div></section>
    <section class="card"><h3>Team Daily Performance</h3>${team.map(p=>{const planned=cloudRows.journeys.filter(j=>j.salesperson_id===p.id&&j.visit_date===today()).length;const completed=closed.filter(v=>v.salesperson_id===p.id).length;const isActive=active.some(v=>v.salesperson_id===p.id);const target=currentTargets.filter(t=>t.salesperson_id===p.id).reduce((a,t)=>a+asNumber(t.collection_target_sar),0);const received=currentReceipts.filter(r=>r.salesperson_id===p.id).reduce((a,r)=>a+asNumber(r.amount_sar),0);return `<div class="mini-item"><b>${esc(p.full_name||p.email)}</b><div class="meta">${esc(p.region||'KSA')} · Planned ${planned} · Completed ${completed}${isActive?' · Active now':''}</div><div class="journey-target">Collections ${money(received)} / ${money(target)}</div></div>`}).join('')||'<p class="muted">No active team profiles found.</p>'}</section>`);
  }

  function cloudGeo(success, failure) {
    if (!navigator.geolocation) { failure(new Error('GPS is not supported on this device.')); return; }
    navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async function cloudRegisterAccountGPS() {
    const c = customerFromInput();
    if (!c?.cloudId) { gpsBox('Customer not found. Select a customer first.','bad'); return; }
    if (!confirm('Register this phone location as the customer location? Do this only while standing at the account.')) return;
    gpsBox('Capturing account GPS...','warn');
    cloudGeo(async p => {
      const { error } = await sb.from('customers').update({ gps_lat: p.coords.latitude, gps_lng: p.coords.longitude, gps_radius_m: 20 }).eq('id', c.cloudId);
      if (error) { gpsBox(error.message, 'bad'); return; }
      c.lat=p.coords.latitude; c.lng=p.coords.longitude; c.gps=`${c.lat},${c.lng}`; accountGPS[c.code]={lat:c.lat,lng:c.lng,registeredAt:new Date().toISOString()};
      gpsBox('Account GPS registered in the shared database. Now press Check In.','ok');
    }, () => gpsBox('GPS permission is required to register the account.','bad'));
  }

  async function cloudCheckIn() {
    const c = customerFromInput();
    if (!c?.cloudId) { gpsBox('Customer not found. Select a customer from the list first.','bad'); return; }
    gpsBox('Checking location. Allow location permission.','warn');
    cloudGeo(async p => {
      const plan = journeyPlan.find(row => row.customerCode === c.code && row.date === today());
      const { data, error } = await sb.rpc('start_verified_visit', { p_customer_id: c.cloudId, p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_accuracy_m: p.coords.accuracy, p_journey_plan_id: plan?.cloudId || null });
      if (error) { gpsBox(error.message, 'bad'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      activeCloudVisit = { id: row.visit_id, check_in_at: row.checked_in_at };
      gpsCheck = { customerCode: c.code, lat:p.coords.latitude, lng:p.coords.longitude, distance:Number(row.distance_m||0), passed:true, checkedAt:row.checked_in_at||new Date().toISOString(), accuracy:p.coords.accuracy };
      visitStartedAt = new Date(row.checked_in_at || Date.now()); $('#submitVisitBtn').disabled=false; startVisitTimer();
      gpsBox(`Visit started. You are ${Math.round(Number(row.distance_m||0))} m from the account. Timer is running.`, 'ok');
    }, () => gpsBox('Location permission is required. Enable Location Services and try again.','bad'));
  }

  async function cloudSubmitVisit() {
    const c = customerFromInput();
    if (!c?.cloudId || !activeCloudVisit?.id) { toast('Check In is required before you can close this visit.'); return; }
    gpsBox('Checking location to close the visit. Stay within 20 meters.','warn');
    cloudGeo(async p => {
      const { data: closeData, error: closeError } = await sb.rpc('close_verified_visit', { p_visit_id: activeCloudVisit.id, p_lat:p.coords.latitude, p_lng:p.coords.longitude, p_accuracy_m:p.coords.accuracy });
      if (closeError) { gpsBox(closeError.message, 'bad'); return; }
      const received = toNum($('#vCollectionReceived').value);
      const update = { contact_met: checkedValues('contactsMet'), visit_objective: $('#vObjective').value, result: $('#vResult').value, customer_interest: Number($('#vInterest').value), notes: $('#vNotes').value, next_action: $('#vNextAction').value, follow_up_date: $('#vFollow').value || null, expected_order_sar: toNum($('#vExpected').value) };
      const { error: updateError } = await sb.from('visits').update(update).eq('id', activeCloudVisit.id);
      if (updateError) { toast(updateError.message); return; }
      const products = (DATA.products||[]).filter(pr => pickedProducts.includes(pr.name) && pr.id).map(pr => ({ visit_id:activeCloudVisit.id, product_id:pr.id, outcome:'discussed' }));
      if (products.length) await sb.from('visit_products').upsert(products, { onConflict:'visit_id,product_id,outcome' });
      const competitor = $('#vCompetitor').value || $('#vCompetitorNews').value.trim();
      if (competitor) await sb.from('competition_updates').insert({ visit_id:activeCloudVisit.id, competitor_brand: $('#vCompetitor').value || 'Other Brand', competitor_price_sar:toNum($('#vCompetitorPrice').value)||null, promotion:$('#vCompetitorPromotion').value||null, strengths:$('#vCompetitorStrengths').value||null, weaknesses:$('#vCompetitorWeaknesses').value||null, update_notes:$('#vCompetitorNews').value||null });
      if (visitActions.length) await sb.from('actions').insert(visitActions.map(a => ({ visit_id:activeCloudVisit.id, customer_id:c.cloudId, owner_id:currentUser.id, created_by:currentUser.id, action_type:a.type, details:a.details||null, due_date:a.due||null, status:'open' })));
      if (received > 0) await sb.from('collection_receipts').insert({ visit_id:activeCloudVisit.id, customer_id:c.cloudId, salesperson_id:currentUser.id, receipt_date:today(), amount_sar:received, payment_status:mapReceiptStatus($('#vCollectionStatus').value), notes:$('#vCollectionNotes').value||null });
      gpsCheckOut = {lat:p.coords.latitude,lng:p.coords.longitude,passed:true,checkedAt:new Date().toISOString(),accuracy:p.coords.accuracy,distance:Number(Array.isArray(closeData)?closeData[0]?.distance_m:closeData?.distance_m)||0};
      if (visitTimerInterval) { clearInterval(visitTimerInterval); visitTimerInterval=null; }
      activeCloudVisit = null; await refreshCloud(); toast('Visit closed and saved to the shared dashboard.'); route('dashboard');
    }, () => gpsBox('Location permission is required to close the visit.','bad'));
  }

  async function cloudSaveCustomer() {
    const code=$('#nCode').value.trim(), name=$('#nName').value.trim();
    if (!code || !name) { toast('Customer code and customer name are required'); return; }
    if (!$('#nApproved').checked) { toast('Confirm system approval before saving'); return; }
    const row = { customer_code:code, name, branch:$('#nBranch').value||null, city:$('#nCity').value.trim()||null, area:$('#nArea').value.trim()||null, channel:$('#nChannel').value.trim()||null, sub_channel:$('#nSubChannel').value.trim()||null, contact_name:$('#nContact').value.trim()||null, mobile:$('#nMobile').value.trim()||null, status:'approved', approval_code:'MANUAL-APPROVED', salesperson_id:currentUser.id };
    const { error } = await sb.from('customers').upsert(row, { onConflict:'customer_code' });
    if (error) { toast(error.message); return; }
    await refreshCloud(); toast('Approved customer saved to the shared database'); route('customers');
  }

  async function cloudSaveManualSlot() {
    const date=$('#mDate').value; if(!date){toast('Select a date');return;}
    const raw=$('#mCustomer').value||''; const code=(raw.match(/^([^ -]+)\s+-\s+/)||[])[1]||''; const c=getCustomerByCode(code)||allCustomers().find(x=>raw.includes(x.name));
    if (!c?.cloudId) { toast('For a cloud journey entry, choose an approved customer. Free spaces remain available as notes on the plan.'); return; }
    const { error } = await sb.from('journey_plans').upsert({ plan_month:cloudMonthDate(date.slice(0,7)), salesperson_id:currentUser.id, customer_id:c.cloudId, visit_date:date, visit_time:$('#mTime').value||null, branch:c.branch||null, city:c.city||null, area:c.area||null, notes:$('#mNotes').value.trim()||null, source:'manual' }, { onConflict:'plan_month,salesperson_id,customer_id,visit_date,visit_time' });
    if (error) { toast(error.message); return; }
    await refreshCloud(); activePlanMonth=date.slice(0,7); toast('Journey plan updated'); route('plan');
  }

  async function cloudImportMonthlyData() {
    if (!leadership()) { toast('Only the Food Service administrator can import shared data.'); return; }
    try {
      const customerRows=await readImportFile($('#customerImport'));
      const journeyRows=await readImportFile($('#journeyImport'));
      const collectionRows=await readImportFile($('#collectionImport'));
      if(!customerRows&&!journeyRows&&!collectionRows){toast('Choose at least one file');return;}
      const messages=[];
      const profiles=cloudRows.profiles;
      const profileFor = row => profiles.find(p => normalize(p.full_name)===normalize(row.salesman) || normalize(p.employee_code)===normalize(row.salesmanId)) || (row.salesman ? null : currentUser);
      if (customerRows) {
        const mapped=customerRows.map(mapCustomerRow).filter(r=>r.code&&r.name).map(r=>{
          const person=profileFor(r); const gps=String(r.gps||'').split(',').map(Number);
          return { customer_code:String(r.code), name:r.name, branch:r.branch||null, city:r.city||null, area:r.area||null, channel:r.channel||r.sector||null, sub_channel:r.subChannel||null, contact_name:r.contactPerson||null, mobile:r.mobile||null, status:String(r.status||'active').toLowerCase()==='active'?'active':'approved', salesperson_id:person?.id||null, gross_sales_ytd:toNum(r.grossSalesYTD), monthly_average_gross_sales:toNum(r.monthlyAvgGrossSales), gps_lat:Number.isFinite(gps[0])?gps[0]:null, gps_lng:Number.isFinite(gps[1])?gps[1]:null, notes:r.source||'Customer database import' };
        });
        if(mapped.length){const {error}=await sb.from('customers').upsert(mapped,{onConflict:'customer_code'}); if(error)throw error; messages.push(`${mapped.length} customers`);}
        await refreshCloud();
      }
      const customerMap=Object.fromEntries(allCustomers().map(c=>[c.code,c]));
      if (journeyRows) {
        const mapped=journeyRows.map(mapJourneyRow).filter(r=>r.date&&r.customerCode).map(r=>{const person=profileFor(r);const c=customerMap[r.customerCode];return person&&c?.cloudId?{plan_month:cloudMonthDate((r.month||r.date.slice(0,7))),salesperson_id:person.id,customer_id:c.cloudId,visit_date:r.date,visit_time:r.time||null,branch:r.branch||c.branch||null,city:r.city||c.city||null,area:r.area||c.area||null,notes:r.notes||null,source:'import'}:null;}).filter(Boolean);
        if(mapped.length){const {error}=await sb.from('journey_plans').upsert(mapped,{onConflict:'plan_month,salesperson_id,customer_id,visit_date,visit_time'}); if(error)throw error;messages.push(`${mapped.length} journey rows`);}
      }
      if (collectionRows) {
        const mapped=collectionRows.map(mapCollectionRow).filter(r=>r.customerCode&&r.collectionTargetSAR!=='').map(r=>{const person=profileFor(r);const c=customerMap[r.customerCode];return person&&c?.cloudId?{target_month:cloudMonthDate(r.month||String(r.dueDate||currentMonth()).slice(0,7)),salesperson_id:person.id,customer_id:c.cloudId,collection_target_sar:toNum(r.collectionTargetSAR),sales_target_sar:toNum(r.salesTargetSAR),due_date:r.dueDate||null,notes:r.notes||null}:null;}).filter(Boolean);
        if(mapped.length){const {error}=await sb.from('collection_targets').upsert(mapped,{onConflict:'target_month,salesperson_id,customer_id'});if(error)throw error;messages.push(`${mapped.length} collection targets`);}
      }
      await refreshCloud(); activePlanMonth=currentMonth();toast(`Imported ${messages.join(' · ')||'data'}`);route('dashboard');
    } catch (e) { console.error(e); toast(e.message || 'Could not import the file.'); }
  }

  async function start() {
    try {
      const cfg = await getConfig();
      if (!cfg.url || !cfg.key || !/^https:\/\//.test(cfg.url)) { notice('Cloud setup is incomplete. Add the Supabase URL and Publishable Key in Vercel.'); return; }
      sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
      window.HalwaniCloud = { sb, refreshCloud };
      window.cloudRetry = start;
      sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') { cloudLogin(); }
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && (location.search.includes('invite=1') || location.hash.includes('type=invite')))) { if (session) await hydrate(session); }
      });
      const session = await getSession();
      if (session) await hydrate(session); else cloudLogin();
      initialised=true;
    } catch (e) { console.error(e); notice(e.message || 'Could not connect to the cloud database.'); }
  }

  // Replace local-only behaviors with shared cloud behaviors while keeping the exact approved UI components.
  window.login = cloudLogin; login = cloudLogin;
  window.doLogin = cloudDoLogin; doLogin = cloudDoLogin;
  window.logout = cloudLogout; logout = cloudLogout;
  window.finishInvitation = finishInvitation;
  window.registerAccountGPS = cloudRegisterAccountGPS; registerAccountGPS = cloudRegisterAccountGPS;
  window.gpsCheckIn = cloudCheckIn; gpsCheckIn = cloudCheckIn;
  window.submitVisit = cloudSubmitVisit; submitVisit = cloudSubmitVisit;
  window.saveNewCustomer = cloudSaveCustomer; saveNewCustomer = cloudSaveCustomer;
  window.saveManualSlot = cloudSaveManualSlot; saveManualSlot = cloudSaveManualSlot;
  window.importMonthlyData = cloudImportMonthlyData; importMonthlyData = cloudImportMonthlyData;
  const legacyRoute = route;
  window.route = route = function(s,arg){ if(s==='manage'){ if(!leadership()){toast('Manager access is required.');return;} return manage(); } return legacyRoute(s,arg); };
  window.cloudRetry = start;
  start();
})();
