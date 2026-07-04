'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, hasSupabaseConfig } from '../lib/supabase';
import { getCurrentPosition, mapsLink } from '../lib/geo';
import { formatDate, formatDuration, formatSar, formatTime, monthEnd, monthStart, normalizeHeader, todayIso, toNumber } from '../lib/format';

const ROLE_LABELS = {
  admin: 'Admin',
  head_of_food_service: 'Head of Food Service',
  national_manager: 'National Manager',
  regional_manager: 'Regional Manager',
  supervisor: 'Supervisor',
  salesperson: 'Salesperson'
};

const EMPTY_DATA = {
  customers: [], products: [], journeys: [], collectionTargets: [], receipts: [], visits: [], locations: [], actions: [], profiles: [], competition: []
};

const today = () => todayIso();
const isManagerRole = (role) => ['admin', 'head_of_food_service', 'national_manager', 'regional_manager', 'supervisor'].includes(role);
const isImportAdminRole = (role) => ['admin', 'head_of_food_service'].includes(role);
const money = (v) => formatSar(Number(v || 0));
const sum = (rows, key) => rows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0);
const idMap = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));

function datePart(timestamp) {
  return timestamp ? String(timestamp).slice(0, 10) : null;
}

function monthLabel(value) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function safeMessage(error) {
  return error?.message || String(error || 'Something went wrong.');
}

function arrayChunk(items, size = 250) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function excelDateToIso(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function excelTimeToDb(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(11, 19);
  if (typeof value === 'number') {
    const seconds = Math.round((value % 1) * 86400);
    const h = Math.floor(seconds / 3600) % 24;
    const m = Math.floor((seconds % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  }
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}:00` : null;
}

function textCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value.text) return value.text;
  return String(value).trim();
}

function isInvitationHash() {
  if (typeof window === 'undefined') return false;
  const query = new URLSearchParams(window.location.search || '');
  const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  return (hash.get('type') || query.get('type')) === 'invite';
}

async function readExcelRows(file) {
  const XLSXModule = await import('xlsx');
  const XLSX = XLSXModule.default || XLSXModule;
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames?.[0];
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
  if (!worksheet) throw new Error('No worksheet found in this file.');
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: true });
  return rows.map((source) => {
    const item = {};
    Object.entries(source || {}).forEach(([key, value]) => {
      const normalized = normalizeHeader(key);
      if (normalized) item[normalized] = value;
    });
    return item;
  }).filter((item) => Object.values(item).some((value) => value !== null && value !== undefined && value !== ''));
}

function getRowValue(row, ...keys) {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (Object.prototype.hasOwnProperty.call(row, normalized)) return row[normalized];
  }
  return null;
}

function AppHeader({ onExport }) {
  return (
    <header className="topbar legacy-topbar">
      <div className="brand legacy-brand">
        <img src="/assets/halwani-logo.png" alt="Halwani Bros" />
        <div className="brand-copy">
          <h1><span>Halwani</span><span>Food Service</span></h1>
        </div>
      </div>
      <button className="outline-btn legacy-export" onClick={onExport}>Export</button>
    </header>
  );
}
function Login({ onLogin, busy, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <img className="login-logo" src="/assets/halwani-logo.png" alt="Halwani Bros" />
        <h1>Halwani Food Service</h1>
        <p>Live sales execution, collections and management visibility.</p>
        {error && <div className="notice error">{error}</div>}
        <label className="label">Work email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@halwani.com" />
        <label className="label">Password</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && onLogin(email, password)} />
        <button className="button" style={{ width: '100%', marginTop: 18, minHeight: 54 }} disabled={busy || !email || !password} onClick={() => onLogin(email, password)}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>Accounts are created by the Food Service administrator. New users set their password from the invitation email.</p>
      </div>
    </div>
  );
}

function ConfigurationRequired() {
  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ textAlign: 'left' }}>
        <img className="login-logo" src="/assets/halwani-logo.png" alt="Halwani Bros" />
        <h1 style={{ textAlign: 'center' }}>Cloud setup required</h1>
        <p style={{ textAlign: 'center' }}>The app package is ready. Add the Supabase environment variables in Vercel, then redeploy.</p>
        <div className="notice info">
          Add <strong>NEXT_PUBLIC_SUPABASE_URL</strong> and <strong>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</strong> in Vercel → Project Settings → Environment Variables.
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>Run <code>supabase/schema.sql</code> first in Supabase SQL Editor. The setup guide is in README.md.</p>
      </div>
    </div>
  );
}

function Dashboard({ profile, data, onStart, onTab, activeVisit }) {
  const currentMonth = monthStart();
  const todayPlans = data.journeys.filter((row) => row.visit_date === today());
  const currentTargets = data.collectionTargets.filter((row) => row.target_month === currentMonth);
  const currentReceipts = data.receipts.filter((row) => row.receipt_date >= currentMonth && row.receipt_date < monthEnd());
  const todayClosed = data.visits.filter((row) => row.status === 'closed' && datePart(row.check_in_at) === today());
  const dueActions = data.actions.filter((row) => row.status === 'open' && row.due_date && row.due_date <= today());
  const customersById = idMap(data.customers);
  const peopleById = idMap(data.profiles);
  const visitsById = idMap(data.visits);
  const targetTotal = sum(currentTargets, 'collection_target_sar');
  const receiptTotal = sum(currentReceipts, 'amount_sar');
  const recentVisits = [...data.visits]
    .filter((row) => row.status === 'closed')
    .sort((a, b) => new Date(b.check_in_at) - new Date(a.check_in_at))
    .slice(0, 5);
  const competitorAlerts = [...(data.competition || [])]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 4);

  return (
    <div className="page grid legacy-home">
      <section className="card welcome-card">
        <div className="kicker">Good morning</div>
        <h2>{profile.full_name}</h2>
        <p className="muted">{ROLE_LABELS[profile.role]} · {profile.region || 'KSA'}</p>
      </section>

      {activeVisit ? (
        <section className="card active-visit-card">
          <div className="section-head">
            <div>
              <div className="live-line"><span className="live-dot" /> Visit in progress</div>
              <h3 style={{ marginTop: 8 }}>{customersById[activeVisit.customer_id]?.name || 'Customer'}</h3>
              <p className="muted">Your last verified location is updating while the app stays open.</p>
            </div>
            <button className="button" onClick={() => onTab('visit')}>Open Visit</button>
          </div>
        </section>
      ) : (
        <button className="hero-action" onClick={onStart}>START VISIT</button>
      )}

      <section className="card collection-card">
        <div className="section-head">
          <div>
            <h3>Collections · {monthLabel(currentMonth)}</h3>
            <p className="muted">Your live target and collection progress.</p>
          </div>
          <button className="ghost-btn legacy-plan-btn" onClick={() => onTab('plan')}>Plan</button>
        </div>
        <div className="grid three collection-grid">
          <div className="item"><div className="kicker">Target</div><div className="value">{money(targetTotal)}</div></div>
          <div className="item"><div className="kicker">Collected</div><div className="value">{money(receiptTotal)}</div></div>
          <div className="item"><div className="kicker">Remaining</div><div className="value">{money(Math.max(0, targetTotal - receiptTotal))}</div></div>
        </div>
      </section>

      <section className="card journey-card">
        <div className="section-head">
          <div><h3>Today&apos;s Journey</h3><p className="muted">{formatDate(today())}</p></div>
          <span className="badge">{todayPlans.length} stores</span>
        </div>
        {todayPlans.length ? todayPlans.sort((a, b) => String(a.visit_time || '').localeCompare(String(b.visit_time || ''))).map((plan) => {
          const customer = customersById[plan.customer_id];
          const target = currentTargets.find((row) => row.customer_id === plan.customer_id);
          const complete = todayClosed.some((visit) => visit.customer_id === plan.customer_id);
          return <div className="journey-row" key={plan.id}>
            <div className="journey-time">{formatTime(plan.visit_time) || '—'}</div>
            <div className="journey-copy"><div className="item-title">{customer?.name || 'Customer'}</div><div className="item-sub">{customer?.city || plan.city || '—'} · {customer?.area || plan.area || '—'}</div>{target && <div className="journey-target">Collection target {money(target.collection_target_sar)}</div>}</div>
            <div className="journey-status"><span className={`badge ${complete ? 'success' : 'warning'}`}>{complete ? 'Completed' : 'Planned'}</span><button className="secondary-btn small" onClick={() => onStart(customer, plan)}>Start</button></div>
          </div>;
        }) : <div className="empty">No stores are planned today. Use This Month Plan to add a free space or an approved customer visit.</div>}
      </section>

      <section className="card competitor-card">
        <div className="section-head"><div><h3>Competitor Alerts</h3><p className="muted">Latest reports from your permitted accounts.</p></div><button className="ghost-btn" onClick={() => onTab('records')}>Records</button></div>
        {competitorAlerts.length ? competitorAlerts.map((alert) => {
          const visit = visitsById[alert.visit_id]; const customer = visit ? customersById[visit.customer_id] : null;
          return <div className="alert-row" key={alert.id}><div><div className="item-title">{alert.competitor_brand || 'Competitor update'}</div><div className="item-sub">{customer?.name || 'Customer'}{alert.promotion ? ` · ${alert.promotion}` : ''}</div></div><span className="badge warning">Alert</span></div>;
        }) : <div className="empty">No competitor updates recorded yet.</div>}
      </section>

      <section className="card latest-card">
        <div className="section-head"><div><h3>Latest Visits</h3><p className="muted">Live records from the shared database.</p></div><button className="ghost-btn" onClick={() => onTab('records')}>View all</button></div>
        {recentVisits.length ? recentVisits.map((visit) => {
          const customer = customersById[visit.customer_id]; const person = peopleById[visit.salesperson_id];
          const seconds = visit.check_out_at ? Math.max(0, Math.round((new Date(visit.check_out_at) - new Date(visit.check_in_at)) / 1000)) : 0;
          const receipt = data.receipts.find((row) => row.visit_id === visit.id);
          return <div className="latest-row" key={visit.id}>
            <div className="item-title">{customer?.name || 'Customer'}</div>
            <div className="item-sub">{person?.full_name || 'Salesperson'} · {formatDate(datePart(visit.check_in_at))} · {seconds ? formatDuration(seconds) : 'Closed'}</div>
            <div className="item-sub">{visit.visit_objective || 'Visit'}{visit.result ? ` · ${visit.result}` : ''}</div>
            {receipt && <span className="collection-chip">Collected {money(receipt.amount_sar)}</span>}
          </div>;
        }) : <div className="empty">No completed visits in the current view yet.</div>}
      </section>

      <section className="grid two compact-kpis">
        <div className="card kpi"><div className="value">{todayClosed.length}</div><div className="meta">Visits today</div></div>
        <div className="card kpi"><div className="value">{dueActions.length}</div><div className="meta">Follow ups due</div></div>
      </section>
    </div>
  );
}
function StartVisit({ data, onStart, activeVisit, onOpenActive, onRegisterGps, canEditGps }) {
  const [query, setQuery] = useState('');
  const customers = data.customers.filter((customer) => `${customer.name} ${customer.customer_code} ${customer.city || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40);
  const todayPlans = data.journeys.filter((plan) => plan.visit_date === today());
  const customersById = idMap(data.customers);
  if (activeVisit) {
    const customer = customersById[activeVisit.customer_id];
    return <div className="page"><section className="card active-visit-card"><div className="section-head"><div><div className="live-line"><span className="live-dot" /> Visit in progress</div><h2 style={{ marginTop: 8 }}>{customer?.name || 'Customer'}</h2><p className="muted">Checked in at {new Date(activeVisit.check_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div><span className="badge active">Live</span></div><button className="button" onClick={onOpenActive}>Open visit form</button></section></div>;
  }

  return <div className="page grid legacy-visit-start">
    <section className="card">
      <div className="section-head"><div><h2>1. Select Customer</h2><p className="muted">Search an account, then check in only when you are within its approved GPS radius.</p></div></div>
      <input className="input" placeholder="Search account, code or city" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="account-picker">
        {customers.map((customer) => <div className="item account-row" key={customer.id}><div className="item-row"><div><div className="item-title">{customer.name}</div><div className="item-sub">{customer.customer_code} · {customer.city || 'City not set'} · {customer.area || 'Area not set'}</div></div><span className={`badge ${customer.gps_lat ? 'success' : 'warning'}`}>{customer.gps_lat ? `${customer.gps_radius_m || 20}m GPS` : 'GPS missing'}</span></div>
          <div className="item-actions"><button className="button small" disabled={!customer.gps_lat} onClick={() => onStart(customer)}>Check In</button>{canEditGps && <button className="secondary-btn small" onClick={() => onRegisterGps(customer)}>Set Account GPS</button>}</div>
        </div>)}
      </div>
    </section>

    <section className="card">
      <div className="section-head"><div><h3>2. Today&apos;s Journey</h3><p className="muted">Use your planned route or select another approved account above.</p></div></div>
      {todayPlans.length ? todayPlans.map((plan) => { const customer = customersById[plan.customer_id]; return customer ? <div className="journey-row" key={plan.id}><div className="journey-time">{formatTime(plan.visit_time) || '—'}</div><div className="journey-copy"><div className="item-title">{customer.name}</div><div className="item-sub">{customer.city || plan.city || '—'} · {customer.area || plan.area || '—'}</div></div><div className="journey-status"><button className="secondary-btn small" disabled={!customer.gps_lat} onClick={() => onStart(customer, plan)}>Check In</button></div></div> : null; }) : <div className="empty">No planned visits today.</div>}
    </section>
  </div>;
}
function VisitCapture({ activeVisit, customer, products, profile, onClose, onSaveDraft }) {
  const [form, setForm] = useState({
    contact_met: '', visit_objective: '', customer_interest: '3', result: '', notes: '', next_action: '', follow_up_date: '', expected_order_sar: '',
    collection_amount: '', payment_status: 'received', collection_notes: '', competitor_brand: '', competitor_price_sar: '', competitor_promotion: '', competitor_notes: '',
    action_type: 'Follow up', action_details: '', action_due_date: '', product_ids: []
  });
  const [seconds, setSeconds] = useState(Math.max(0, Math.floor((Date.now() - new Date(activeVisit.check_in_at).getTime()) / 1000)));

  useEffect(() => {
    const id = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - new Date(activeVisit.check_in_at).getTime()) / 1000))), 1000);
    return () => clearInterval(id);
  }, [activeVisit.check_in_at]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleProduct = (id) => setForm((current) => ({ ...current, product_ids: current.product_ids.includes(id) ? current.product_ids.filter((item) => item !== id) : [...current.product_ids, id] }));

  return <div className="page grid visit-flow">
    <section className="card soft"><div className="section-head"><div><span className="live-dot" /> <span style={{ marginLeft: 8, fontWeight: 900 }}>Visit in progress</span><h2 style={{ marginTop: 10 }}>{customer?.name}</h2><p className="muted">{customer?.customer_code} · {customer?.city || '—'} · GPS verified at check-in</p></div><div className="value">{formatDuration(seconds)}</div></div>
      <div className="grid three"><div className="item"><div className="kicker">Gross Sales YTD</div><strong>{money(customer?.gross_sales_ytd)}</strong></div><div className="item"><div className="kicker">Monthly Average</div><strong>{money(customer?.monthly_average_gross_sales)}</strong></div><div className="item"><div className="kicker">GPS Radius</div><strong>{customer?.gps_radius_m || 20} m</strong></div></div>
    </section>

    <section className="card"><h3>1. Meeting and outcome</h3><div className="form-grid">
      <div><label className="label">Contact met</label><input className="input" value={form.contact_met} onChange={(e) => update('contact_met', e.target.value)} placeholder="Owner, buyer, chef…" /></div>
      <div><label className="label">Visit objective</label><select className="select" value={form.visit_objective} onChange={(e) => update('visit_objective', e.target.value)}><option value="">Select</option><option>Regular visit</option><option>New product presentation</option><option>Collection</option><option>Sample follow-up</option><option>Complaint</option><option>Chef demo</option></select></div>
      <div><label className="label">Customer interest</label><select className="select" value={form.customer_interest} onChange={(e) => update('customer_interest', e.target.value)}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></div>
      <div><label className="label">Result</label><select className="select" value={form.result} onChange={(e) => update('result', e.target.value)}><option value="">Select</option><option>Interested</option><option>Sample requested</option><option>Trial requested</option><option>Quotation requested</option><option>PO expected</option><option>Closed</option><option>Lost</option></select></div>
      <div><label className="label">Expected order, SAR</label><input className="input" inputMode="decimal" value={form.expected_order_sar} onChange={(e) => update('expected_order_sar', e.target.value)} placeholder="0" /></div>
      <div><label className="label">Follow-up date</label><input className="input" type="date" value={form.follow_up_date} onChange={(e) => update('follow_up_date', e.target.value)} /></div>
      <div className="full"><label className="label">Visit notes</label><textarea className="textarea" value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="What happened, decisions, objections and next steps." /></div>
    </div></section>

    <section className="card"><h3>2. Products discussed</h3><div className="chips">{products.slice(0, 80).map((product) => <button key={product.id} className={`chip ${form.product_ids.includes(product.id) ? 'selected' : ''}`} onClick={() => toggleProduct(product.id)}>{product.name}</button>)}</div></section>

    <section className="card"><h3>3. Collection</h3><div className="form-grid"><div><label className="label">Collection received, SAR</label><input className="input" inputMode="decimal" value={form.collection_amount} onChange={(e) => update('collection_amount', e.target.value)} placeholder="0" /></div><div><label className="label">Payment status</label><select className="select" value={form.payment_status} onChange={(e) => update('payment_status', e.target.value)}><option value="received">Received</option><option value="partial">Partial</option><option value="promised">Promised</option><option value="rejected">Rejected</option></select></div><div className="full"><label className="label">Collection notes</label><textarea className="textarea" value={form.collection_notes} onChange={(e) => update('collection_notes', e.target.value)} placeholder="Cheque, transfer reference, promise date or issue." /></div></div></section>

    <section className="card"><h3>4. Competition Update</h3><div className="form-grid"><div><label className="label">Competitor brand</label><input className="input" value={form.competitor_brand} onChange={(e) => update('competitor_brand', e.target.value)} placeholder="Brand name" /></div><div><label className="label">Competitor price, SAR</label><input className="input" inputMode="decimal" value={form.competitor_price_sar} onChange={(e) => update('competitor_price_sar', e.target.value)} placeholder="0" /></div><div><label className="label">Promotion</label><input className="input" value={form.competitor_promotion} onChange={(e) => update('competitor_promotion', e.target.value)} placeholder="Discount, bundle, menu deal…" /></div><div className="full"><label className="label">Competition notes</label><textarea className="textarea" value={form.competitor_notes} onChange={(e) => update('competitor_notes', e.target.value)} placeholder="Strength, weakness, customer feedback or any relevant update." /></div></div></section>

    <section className="card"><h3>5. Action List</h3><div className="form-grid"><div><label className="label">Action type</label><select className="select" value={form.action_type} onChange={(e) => update('action_type', e.target.value)}><option>Follow up</option><option>Send quotation</option><option>Deliver sample</option><option>Chef demo</option><option>Price review</option><option>Collection follow-up</option><option>Technical support</option></select></div><div><label className="label">Due date</label><input className="input" type="date" value={form.action_due_date} onChange={(e) => update('action_due_date', e.target.value)} /></div><div className="full"><label className="label">Action details</label><textarea className="textarea" value={form.action_details} onChange={(e) => update('action_details', e.target.value)} placeholder="Clear action that should be tracked after this visit." /></div></div>
      <button className="secondary-btn" onClick={() => onSaveDraft(form)}>Save draft locally</button>
    </section>

    <button className="hero-action" onClick={() => onClose(form)}>CLOSE VISIT</button>
    <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>Closing the visit requires a second GPS verification within the account radius.</p>
  </div>;
}

function MonthPlan({ data, profile, onAddManual, onStart }) {
  const [month, setMonth] = useState(monthStart());
  const customersById = idMap(data.customers);
  const plans = data.journeys.filter((plan) => plan.plan_month === month).sort((a,b) => `${a.visit_date}${a.visit_time || ''}`.localeCompare(`${b.visit_date}${b.visit_time || ''}`));
  const targets = data.collectionTargets.filter((row) => row.target_month === month);
  const receipts = data.receipts.filter((row) => row.receipt_date >= month && row.receipt_date < monthEnd(new Date(`${month}T12:00:00`)));
  const daily = Object.groupBy ? Object.groupBy(plans, (plan) => plan.visit_date) : plans.reduce((acc, plan) => ({ ...acc, [plan.visit_date]: [...(acc[plan.visit_date] || []), plan] }), {});

  return <div className="page grid"><section className="card"><div className="section-head"><div><h2>This Month Journey Plan</h2><p className="muted">Full monthly route, account collection targets and manual free spaces.</p></div><button className="button" onClick={onAddManual}>+ Add</button></div>
    <div className="form-grid"><div><label className="label">Month</label><input className="input" type="month" value={month.slice(0,7)} onChange={(e) => setMonth(`${e.target.value}-01`)} /></div><div><label className="label">Collection Target</label><div className="input" style={{ color: 'var(--halwani)', fontWeight: 900 }}>{money(sum(targets, 'collection_target_sar'))}</div></div></div>
    <div className="grid three" style={{ marginTop: 14 }}><div className="item"><div className="kicker">Stores planned</div><div className="value">{plans.length}</div></div><div className="item"><div className="kicker">Free spaces</div><div className="value">{plans.filter((plan) => plan.source === 'manual').length}</div></div><div className="item"><div className="kicker">Collected</div><div className="value">{money(sum(receipts, 'amount_sar'))}</div></div></div>
  </section>
  {Object.keys(daily).sort().map((date) => <section className="card" key={date}><div className="section-head"><div><h3>{formatDate(date)}</h3><p className="muted">{daily[date].length} stores</p></div></div>{daily[date].map((plan) => { const c=customersById[plan.customer_id]; const target=targets.find((t) => t.customer_id === plan.customer_id); return <div className="item" key={plan.id}><div className="item-row"><div><div className="item-title">{c?.name || 'Customer'}</div><div className="item-sub">{formatTime(plan.visit_time)} · {c?.city || plan.city || '—'} · {c?.area || plan.area || '—'}</div></div><span className={`badge ${plan.source === 'manual' ? 'warning' : ''}`}>{plan.source === 'manual' ? 'Manual' : 'Planned'}</span></div>{target && <div className="item-sub" style={{ marginTop: 8 }}>Collection target: <strong style={{ color: 'var(--halwani)' }}>{money(target.collection_target_sar)}</strong></div>}<div className="item-actions"><button className="secondary-btn small" onClick={() => onStart(c, plan)}>Start Visit</button></div></div>; })}</section>)}
  {!plans.length && <section className="card"><div className="empty">No stores are planned for {monthLabel(month)}. Import the monthly plan or add a free space manually.</div></section>}
  </div>;
}

function Customers({ data, profile, onAddCustomer, onRegisterGps }) {
  const [query, setQuery] = useState('');
  const isManager = isManagerRole(profile.role);
  const records = data.customers.filter((customer) => `${customer.name} ${customer.customer_code} ${customer.city || ''} ${customer.area || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 120);
  return <div className="page grid"><section className="card"><div className="section-head"><div><h2>Customers</h2><p className="muted">Central customer master. Changes appear for the assigned team immediately.</p></div><button className="button" onClick={onAddCustomer}>Add Approved Customer</button></div><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer, code, city or area" /></section>
  <section className="card">{records.map((c) => <div className="item" key={c.id}><div className="item-row"><div><div className="item-title">{c.name}</div><div className="item-sub">{c.customer_code} · {c.city || 'City not set'} · {c.area || 'Area not set'}</div></div><span className={`badge ${c.gps_lat ? 'success' : 'warning'}`}>{c.gps_lat ? `${c.gps_radius_m || 20}m GPS` : 'GPS missing'}</span></div><div className="item-sub" style={{ marginTop: 7 }}>Gross Sales YTD: <strong style={{ color: 'var(--halwani)' }}>{money(c.gross_sales_ytd)}</strong> · Monthly Avg: <strong style={{ color: 'var(--halwani)' }}>{money(c.monthly_average_gross_sales)}</strong></div><div className="item-actions">{(isManager || c.salesperson_id === profile.id) && <button className="secondary-btn small" onClick={() => onRegisterGps(c)}>Set Account GPS</button>}</div></div>)}{!records.length && <div className="empty">No customers found.</div>}</section></div>;
}

function Records({ data, profile, onExport, onSignOut }) {
  const customersById = idMap(data.customers);
  const peopleById = idMap(data.profiles);
  const closedVisits = [...data.visits].filter((visit) => visit.status === 'closed').sort((a, b) => new Date(b.check_in_at) - new Date(a.check_in_at));
  const openActions = data.actions.filter((action) => action.status === 'open').sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  const recentAlerts = [...(data.competition || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
  const visitsById = idMap(data.visits);

  return <div className="page grid records-page">
    <section className="card"><div className="section-head"><div><h2>Records</h2><p className="muted">Your shared visit history, follow ups and competitor reports.</p></div></div>
      <div className="records-controls"><button className="button" onClick={onExport}>Export visits</button><button className="secondary-btn" onClick={onSignOut}>Sign out</button></div>
    </section>

    <section className="card"><div className="section-head"><div><h3>Latest Visits</h3><p className="muted">Records loaded from the live cloud database.</p></div><span className="badge">{closedVisits.length}</span></div>
      {closedVisits.length ? closedVisits.map((visit) => { const customer = customersById[visit.customer_id]; const person = peopleById[visit.salesperson_id]; const receipt = data.receipts.find((row) => row.visit_id === visit.id); return <div className="latest-row" key={visit.id}><div className="item-title">{customer?.name || 'Customer'}</div><div className="item-sub">{person?.full_name || 'Salesperson'} · {formatDate(datePart(visit.check_in_at))}</div><div className="item-sub">{visit.visit_objective || 'Visit'}{visit.result ? ` · ${visit.result}` : ''}</div>{receipt && <span className="collection-chip">Collected {money(receipt.amount_sar)}</span>}</div>; }) : <div className="empty">No completed visits in the current view.</div>}
    </section>

    <section className="card"><div className="section-head"><div><h3>Open Actions</h3><p className="muted">Follow ups that still need attention.</p></div><span className="badge warning">{openActions.length} open</span></div>
      {openActions.length ? openActions.map((action) => <div className="item" key={action.id}><div className="item-row"><div><div className="item-title">{action.action_type}</div><div className="item-sub">{action.details || 'No details added'}</div></div><span className="badge">{action.due_date ? formatDate(action.due_date) : 'No due date'}</span></div></div>) : <div className="empty">No open actions.</div>}
    </section>

    <section className="card"><div className="section-head"><div><h3>Competitor Alerts</h3><p className="muted">Latest competition updates from customer visits.</p></div></div>
      {recentAlerts.length ? recentAlerts.map((alert) => { const visit = visitsById[alert.visit_id]; const customer = visit ? customersById[visit.customer_id] : null; return <div className="alert-row" key={alert.id}><div><div className="item-title">{alert.competitor_brand}</div><div className="item-sub">{customer?.name || 'Customer'}{alert.update_notes ? ` · ${alert.update_notes}` : ''}</div></div></div>; }) : <div className="empty">No competitor updates yet.</div>}
    </section>
  </div>;
}
function ManagerDashboard({ data, profile }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  const todayValue = today();
  const currentMonth = monthStart();
  const profileById = idMap(data.profiles);
  const customerById = idMap(data.customers);
  const activeVisits = data.visits.filter((visit) => visit.status === 'active');
  const completedToday = data.visits.filter((visit) => visit.status === 'closed' && datePart(visit.check_in_at) === todayValue);
  const plannedToday = data.journeys.filter((plan) => plan.visit_date === todayValue);
  const targets = data.collectionTargets.filter((row) => row.target_month === currentMonth);
  const receipts = data.receipts.filter((row) => row.receipt_date >= currentMonth && row.receipt_date < monthEnd());
  const latestLocationByVisit = {};
  [...data.locations].sort((a,b) => new Date(b.recorded_at) - new Date(a.recorded_at)).forEach((location) => { if (!latestLocationByVisit[location.visit_id]) latestLocationByVisit[location.visit_id] = location; });
  const teamIds = [...new Set([...data.profiles.map((p) => p.id), ...plannedToday.map((p) => p.salesperson_id), ...data.visits.map((v) => v.salesperson_id)])];
  const overallCompletion = plannedToday.length ? Math.round((completedToday.length / plannedToday.length) * 100) : 0;

  return <div className="page grid"><section className="card"><div className="section-head"><div><h2>Management Dashboard</h2><p className="muted">Live operational view. Updated {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} and refreshed when visits change.</p></div><span className="badge active"><span className="live-dot" /> Live</span></div>
    <div className="grid four"><div className="kpi item"><div className="value">{activeVisits.length}</div><div className="meta">Active visits now</div></div><div className="kpi item"><div className="value">{completedToday.length} / {plannedToday.length}</div><div className="meta">Visits completed today</div></div><div className="kpi item"><div className="value">{overallCompletion}%</div><div className="meta">Journey completion</div></div><div className="kpi item"><div className="value">{money(sum(receipts, 'amount_sar'))}</div><div className="meta">Collections this month</div></div></div>
  </section>

  <section className="card"><div className="section-head"><div><h3>Live team activity</h3><p className="muted">Last verified GPS is shown only for active visits. It is not continuous all-day tracking.</p></div></div>
    {activeVisits.length ? activeVisits.map((visit) => { const person = profileById[visit.salesperson_id]; const customer = customerById[visit.customer_id]; const location = latestLocationByVisit[visit.id]; return <div className="item" key={visit.id}><div className="item-row"><div><div className="item-title"><span className="live-dot" /> <span style={{ marginLeft: 8 }}>{person?.full_name || 'Salesperson'}</span></div><div className="item-sub">At {customer?.name || 'Customer'} · Checked in {new Date(visit.check_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {Math.floor((Date.now() - new Date(visit.check_in_at).getTime()) / 60000)} min</div></div><span className="badge active">Active</span></div><div className="item-actions">{location && <a className="secondary-btn small map-link" target="_blank" rel="noreferrer" href={mapsLink(location.latitude, location.longitude)}>Open last verified location</a>}</div></div>; }) : <div className="empty">No active visits right now.</div>}
  </section>

  <section className="card"><div className="section-head"><div><h3>Team daily performance</h3><p className="muted">Planned, completed, active and collection performance by salesperson.</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>Salesperson</th><th>Region</th><th>Planned</th><th>Completed</th><th>Active</th><th>Collections MTD</th><th>Plan completion</th></tr></thead><tbody>{teamIds.map((id) => { const member = profileById[id] || {}; const planned = plannedToday.filter((plan) => plan.salesperson_id === id).length; const complete = completedToday.filter((visit) => visit.salesperson_id === id).length; const active = activeVisits.filter((visit) => visit.salesperson_id === id).length; const collected = sum(receipts.filter((row) => row.salesperson_id === id), 'amount_sar'); const pct = planned ? Math.round((complete / planned) * 100) : 0; return <tr key={id}><td><strong>{member.full_name || 'Unassigned'}</strong><br/><span className="muted">{member.employee_code || '—'}</span></td><td>{member.region || '—'}</td><td>{planned}</td><td>{complete}</td><td>{active ? <span className="badge active">{active} live</span> : '—'}</td><td>{money(collected)}</td><td style={{ minWidth: 150 }}><div className="progress"><span style={{ width: `${pct}%` }} /></div><span className="muted">{pct}%</span></td></tr>; })}</tbody></table></div>
  </section>

  <section className="grid three"><div className="card kpi"><div className="value">{money(sum(targets, 'collection_target_sar'))}</div><div className="meta">Collection target MTD</div></div><div className="card kpi"><div className="value">{data.actions.filter((a) => a.status === 'open' && a.due_date && a.due_date <= todayValue).length}</div><div className="meta">Open actions due</div></div><div className="card kpi"><div className="value">{data.visits.filter((v) => v.short_visit_flag).length}</div><div className="meta">Short visits flagged this month</div></div></section>
  </div>;
}

function ImportHub({ data, profile, onRefresh, onNotice }) {
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState('customers');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const supabase = getSupabase();

  const profileLookups = useMemo(() => {
    const byCode = new Map(); const byName = new Map();
    data.profiles.forEach((p) => { if (p.employee_code) byCode.set(String(p.employee_code).trim().toLowerCase(), p); if (p.full_name) byName.set(p.full_name.trim().toLowerCase(), p); });
    return { byCode, byName };
  }, [data.profiles]);

  const resolveProfile = (row) => {
    const code = textCell(getRowValue(row, 'Salesman ID', 'Employee ID', 'employee_code')).toLowerCase();
    const name = textCell(getRowValue(row, 'Salesman Name', 'Salesperson', 'Salesperson Name')).toLowerCase();
    return profileLookups.byCode.get(code) || profileLookups.byName.get(name) || null;
  };

  const customerLookup = useMemo(() => new Map(data.customers.map((c) => [String(c.customer_code).trim(), c])), [data.customers]);

  const importRows = async () => {
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      const rows = await readExcelRows(file);
      if (!rows.length) throw new Error('No usable rows found in the uploaded workbook.');
      let payload = []; let skipped = [];
      if (kind === 'customers') {
        payload = rows.map((row) => {
          const customerCode = textCell(getRowValue(row, 'Customer Code', 'Customder Code', 'Account Code', 'Code'));
          const name = textCell(getRowValue(row, 'Customer Name', 'customerName', 'Name'));
          const salesperson = resolveProfile(row);
          if (!customerCode || !name) { skipped.push('Customer row missing Customer Code or Customer Name'); return null; }
          return {
            customer_code: customerCode, name,
            branch: textCell(getRowValue(row, 'Branch')) || null,
            city: textCell(getRowValue(row, 'City')) || null,
            area: textCell(getRowValue(row, 'Area')) || null,
            channel: textCell(getRowValue(row, 'Channel')) || null,
            sub_channel: textCell(getRowValue(row, 'Sub Channel', 'SubChannel')) || null,
            contact_name: textCell(getRowValue(row, 'Contact', 'Contact Name')) || null,
            mobile: textCell(getRowValue(row, 'Mobile', 'Phone')) || null,
            salesperson_id: salesperson?.id || null,
            status: textCell(getRowValue(row, 'Status')) || 'active',
            approval_code: textCell(getRowValue(row, 'Approval Code', 'Approval')) || null,
            gross_sales_ytd: toNumber(getRowValue(row, 'Gross Sales YTD', 'Gross Sales')),
            monthly_average_gross_sales: toNumber(getRowValue(row, 'Monthly Average Gross Sales', 'Monthly Average')),
            gps_lat: Number(getRowValue(row, 'GPS Latitude', 'Latitude')) || null,
            gps_lng: Number(getRowValue(row, 'GPS Longitude', 'Longitude')) || null,
            gps_radius_m: toNumber(getRowValue(row, 'GPS Radius', 'GPS Radius M', 'Radius')) || 20,
            notes: textCell(getRowValue(row, 'Notes')) || null
          };
        }).filter(Boolean);
        for (const batch of arrayChunk(payload)) { const { error } = await supabase.from('customers').upsert(batch, { onConflict: 'customer_code' }); if (error) throw error; }
      }
      if (kind === 'journeys') {
        payload = rows.map((row) => {
          const customerCode = textCell(getRowValue(row, 'Customder Code', 'Customer Code'));
          const customer = customerLookup.get(customerCode); const salesperson = resolveProfile(row);
          const visitDate = excelDateToIso(getRowValue(row, 'Visit Date'));
          const month = excelDateToIso(getRowValue(row, 'Month')) || (visitDate ? `${visitDate.slice(0,7)}-01` : null);
          if (!customer || !salesperson || !visitDate || !month) { skipped.push(`Journey row skipped: ${customerCode || 'missing customer code'}`); return null; }
          return { plan_month: month, salesperson_id: salesperson.id, customer_id: customer.id, visit_date: visitDate, visit_time: excelTimeToDb(getRowValue(row, 'Visit Time')), branch: textCell(getRowValue(row, 'Branch')) || null, city: textCell(getRowValue(row, 'City')) || null, area: textCell(getRowValue(row, 'Area')) || null, notes: textCell(getRowValue(row, 'Notes')) || null, source: 'import' };
        }).filter(Boolean);
        for (const batch of arrayChunk(payload)) { const { error } = await supabase.from('journey_plans').upsert(batch, { onConflict: 'plan_month,salesperson_id,customer_id,visit_date,visit_time' }); if (error) throw error; }
      }
      if (kind === 'collections') {
        payload = rows.map((row) => {
          const customerCode = textCell(getRowValue(row, 'Customer Code', 'Customder Code'));
          const customer = customerLookup.get(customerCode); const salesperson = resolveProfile(row);
          const month = excelDateToIso(getRowValue(row, 'Month'));
          if (!customer || !salesperson || !month) { skipped.push(`Collection row skipped: ${customerCode || 'missing customer code'}`); return null; }
          return { target_month: month, salesperson_id: salesperson.id, customer_id: customer.id, collection_target_sar: toNumber(getRowValue(row, 'Collection Target ( SAR)', 'Collection Target SAR', 'Collection Target')), sales_target_sar: toNumber(getRowValue(row, 'Sales Target (SAR)', 'Sales Target SAR', 'Sales Target')), due_date: excelDateToIso(getRowValue(row, 'dueDate', 'Due Date')), notes: textCell(getRowValue(row, 'notes', 'Notes')) || null };
        }).filter(Boolean);
        for (const batch of arrayChunk(payload)) { const { error } = await supabase.from('collection_targets').upsert(batch, { onConflict: 'target_month,salesperson_id,customer_id' }); if (error) throw error; }
      }
      if (kind === 'products') {
        payload = rows.map((row) => {
          const name = textCell(getRowValue(row, 'Product Name', 'Description', 'Name'));
          if (!name) { skipped.push('Product row missing Product Name'); return null; }
          return { sku: textCell(getRowValue(row, 'SKU', 'Product Code', 'Code')) || null, brand: textCell(getRowValue(row, 'Brand')) || null, category: textCell(getRowValue(row, 'Category')) || null, name, pack_size: textCell(getRowValue(row, 'Pack Size', 'Pack')) || null, active: true };
        }).filter(Boolean);
        for (const batch of arrayChunk(payload)) { const { error } = await supabase.from('products').upsert(batch, { onConflict: 'sku' }); if (error) throw error; }
      }
      setResult({ message: `${payload.length} ${kind} records imported to the live database.`, skipped });
      onNotice(`${payload.length} ${kind} records imported.` , 'success');
      await onRefresh();
    } catch (error) {
      setResult({ error: safeMessage(error) });
    } finally { setBusy(false); }
  };

  const backup = async () => {
    setBusy(true);
    try {
      const tables = ['profiles','customers','products','journey_plans','collection_targets','visits','visit_locations','visit_products','competition_updates','actions','collection_receipts'];
      const exportData = {};
      for (const table of tables) {
        const { data: rows, error } = await supabase.from(table).select('*');
        if (error) throw error;
        exportData[table] = rows;
      }
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), source: 'Halwani FS Cloud CRM', data: exportData }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `halwani-fs-cloud-backup-${today()}.json`; anchor.click(); URL.revokeObjectURL(url);
      onNotice('Cloud backup downloaded.', 'success');
    } catch (error) { onNotice(safeMessage(error), 'error'); } finally { setBusy(false); }
  };

  return <div className="page grid"><section className="card"><div className="section-head"><div><h2>Admin Import Centre</h2><p className="muted">Imports write to the shared cloud database. Every salesperson sees the approved data after refresh.</p></div><span className="badge success">Head Office</span></div>
    <div className="notice info">Use the supplied Journey Plan and Collection Target templates. The exact attached columns are supported, including <strong>Customder Code</strong>, <strong>dueDate</strong> and <strong>customerName</strong>.</div>
    <div className="form-grid"><div><label className="label">Data type</label><select className="select" value={kind} onChange={(e) => setKind(e.target.value)}><option value="customers">Customer database update</option><option value="journeys">Monthly journey plan</option><option value="collections">Monthly collection targets</option><option value="products">Product master</option></select></div><div><label className="label">Excel file</label><input className="input" type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div></div>
    <div className="item-actions" style={{ marginTop: 16 }}><button className="button" disabled={!file || busy} onClick={importRows}>{busy ? 'Importing…' : 'Import to live database'}</button><a className="secondary-btn" href="/templates/monthly_journey_plan_template.xlsx" download>Journey Plan template</a><a className="secondary-btn" href="/templates/monthly_collection_targets_template.xlsx" download>Collection template</a><button className="ghost-btn" disabled={busy} onClick={backup}>Download cloud backup</button></div>
    {result?.message && <div className="notice success" style={{ marginTop: 16 }}>{result.message}{result.skipped?.length ? <><br/><small>{result.skipped.length} row(s) skipped. First example: {result.skipped[0]}</small></> : null}</div>}
    {result?.error && <div className="notice error" style={{ marginTop: 16 }}>{result.error}</div>}
  </section>
  <section className="card warning"><h3>Important controls</h3><p className="muted">Only Head of Food Service and Admin accounts can import shared masters or download a whole-database backup. Salespeople can add approved customers only when they have an approved customer code.</p></section>
  </div>;
}

function NewCustomerModal({ profile, onClose, onCreate }) {
  const [form, setForm] = useState({ customer_code: '', name: '', city: '', area: '', branch: '', channel: '', sub_channel: '', contact_name: '', mobile: '', approval_code: '' });
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => { setBusy(true); try { await onCreate(form); onClose(); } finally { setBusy(false); } };
  return <Modal title="Add Approved Customer" onClose={onClose}><div className="notice info">Enter the customer code issued by the approved company system. This account will be assigned to you and visible in the live database.</div><div className="form-grid"><div><label className="label">Approved customer code *</label><input className="input" value={form.customer_code} onChange={(e) => update('customer_code', e.target.value)} /></div><div><label className="label">Approval reference *</label><input className="input" value={form.approval_code} onChange={(e) => update('approval_code', e.target.value)} /></div><div className="full"><label className="label">Customer name *</label><input className="input" value={form.name} onChange={(e) => update('name', e.target.value)} /></div><div><label className="label">City</label><input className="input" value={form.city} onChange={(e) => update('city', e.target.value)} /></div><div><label className="label">Area</label><input className="input" value={form.area} onChange={(e) => update('area', e.target.value)} /></div><div><label className="label">Channel</label><input className="input" value={form.channel} onChange={(e) => update('channel', e.target.value)} /></div><div><label className="label">Sub-channel</label><input className="input" value={form.sub_channel} onChange={(e) => update('sub_channel', e.target.value)} /></div><div><label className="label">Contact person</label><input className="input" value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} /></div><div><label className="label">Mobile</label><input className="input" value={form.mobile} onChange={(e) => update('mobile', e.target.value)} /></div></div><button className="button" disabled={busy || !form.customer_code || !form.approval_code || !form.name} style={{ marginTop: 18, width: '100%' }} onClick={submit}>{busy ? 'Saving…' : 'Save approved customer'}</button></Modal>;
}

function ManualPlanModal({ customers, profile, onClose, onCreate }) {
  const [form, setForm] = useState({ customer_id: '', visit_date: today(), visit_time: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => { setBusy(true); try { await onCreate(form); onClose(); } finally { setBusy(false); } };
  return <Modal title="Add Free Space / Manual Visit" onClose={onClose}><p className="muted">Use this when you need to add an approved customer to the monthly journey plan outside the imported route.</p><label className="label">Customer</label><select className="select" value={form.customer_id} onChange={(e) => update('customer_id', e.target.value)}><option value="">Select customer</option>{customers.map((c) => <option value={c.id} key={c.id}>{c.name} · {c.customer_code}</option>)}</select><div className="form-grid"><div><label className="label">Visit date</label><input className="input" type="date" value={form.visit_date} onChange={(e) => update('visit_date', e.target.value)} /></div><div><label className="label">Visit time</label><input className="input" type="time" value={form.visit_time} onChange={(e) => update('visit_time', e.target.value)} /></div><div className="full"><label className="label">Notes</label><textarea className="textarea" value={form.notes} onChange={(e) => update('notes', e.target.value)} /></div></div><button className="button" disabled={busy || !form.customer_id || !form.visit_date} style={{ marginTop: 18, width: '100%' }} onClick={submit}>{busy ? 'Saving…' : 'Add to journey plan'}</button></Modal>;
}

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header"><h2>{title}</h2><button className="ghost-btn" onClick={onClose}>Close</button></div>{children}</div></div>;
}

function ExportButton({ data, profile, onNotice }) {
  const exportVisits = () => {
    const customerById = idMap(data.customers);
    const rows = data.visits.map((visit) => ({
      visit_id: visit.id,
      salesperson: profile.full_name,
      customer_code: customerById[visit.customer_id]?.customer_code || '',
      customer_name: customerById[visit.customer_id]?.name || '',
      status: visit.status,
      check_in_at: visit.check_in_at,
      check_in_gps: mapsLink(visit.check_in_lat, visit.check_in_lng) || '',
      check_in_distance_m: visit.check_in_distance_m,
      check_out_at: visit.check_out_at || '',
      check_out_gps: mapsLink(visit.check_out_lat, visit.check_out_lng) || '',
      check_out_distance_m: visit.check_out_distance_m || '',
      result: visit.result || '',
      expected_order_sar: visit.expected_order_sar || 0,
      notes: visit.notes || ''
    }));
    const headers = Object.keys(rows[0] || { no_data: '' });
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `halwani-visits-${today()}.csv`; anchor.click(); URL.revokeObjectURL(url);
    onNotice('Visits export downloaded.', 'success');
  };
  return exportVisits;
}

export default function Page() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [data, setData] = useState(EMPTY_DATA);
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [notice, setNotice] = useState(null);
  const [activeVisit, setActiveVisit] = useState(null);
  const [modal, setModal] = useState(null);
  const [selectedForStart, setSelectedForStart] = useState(null);
  const watchRef = useRef(null);
  const supabase = getSupabase();

  const showNotice = useCallback((message, type = 'info') => {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const refreshData = useCallback(async () => {
    if (!supabase || !session?.user) return;
    const from = monthStart(); const to = monthEnd(); const todayStart = `${today()}T00:00:00.000Z`;
    const visitWindowStart = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
    const queries = await Promise.all([
      supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      supabase.from('customers').select('*').order('name').limit(5000),
      supabase.from('products').select('*').eq('active', true).order('name').limit(3000),
      supabase.from('journey_plans').select('*').gte('visit_date', from).lt('visit_date', to).order('visit_date').order('visit_time'),
      supabase.from('collection_targets').select('*').eq('target_month', from),
      supabase.from('collection_receipts').select('*').gte('receipt_date', from).lt('receipt_date', to),
      supabase.from('visits').select('*').gte('check_in_at', visitWindowStart).order('check_in_at', { ascending: false }),
      supabase.from('visit_locations').select('*').gte('recorded_at', todayStart).order('recorded_at', { ascending: false }).limit(1000),
      supabase.from('actions').select('*').eq('status', 'open').order('due_date'),
      supabase.from('competition_updates').select('*').order('created_at', { ascending: false }).limit(100)
    ]);
    const names = ['profiles','customers','products','journeys','collectionTargets','receipts','visits','locations','actions','competition'];
    const next = {};
    for (let index = 0; index < queries.length; index += 1) {
      const response = queries[index];
      if (response.error) {
        console.error(names[index], response.error);
        if (names[index] === 'customers' || names[index] === 'visits') showNotice(response.error.message, 'error');
      }
      next[names[index]] = response.data || [];
    }
    setData(next);
    const currentActive = (next.visits || []).find((visit) => visit.status === 'active' && visit.salesperson_id === session.user.id) || null;
    setActiveVisit(currentActive);
  }, [session?.user, showNotice, supabase]);

  const loadProfile = useCallback(async (user) => {
    if (!supabase || !user) return;
    const { data: profileRow, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error) { setLoginError('Your user account exists but the CRM profile is not ready yet. Ask the administrator to run the schema and set your role.'); return; }
    setProfile(profileRow);
    setTab('dashboard');
  }, [supabase]);

  useEffect(() => {
    if (typeof window !== 'undefined' && isInvitationHash()) {
      const invitePath = `/accept-invitation${window.location.search || ''}${window.location.hash || ''}`;
      window.location.replace(invitePath);
      return undefined;
    }
    if (!supabase) { setLoading(false); return undefined; }
    let mounted = true;
    const boot = async () => {
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(existing);
      if (existing?.user) await loadProfile(existing.user);
      setLoading(false);
    };
    boot();
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) await loadProfile(nextSession.user);
      else { setProfile(null); setData(EMPTY_DATA); setActiveVisit(null); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [loadProfile, supabase]);

  useEffect(() => { if (profile) refreshData(); }, [profile, refreshData]);

  useEffect(() => {
    if (!supabase || !profile || !isManagerRole(profile.role)) return undefined;
    const channel = supabase.channel('halwani-live-operations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, refreshData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visit_locations' }, refreshData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_receipts' }, refreshData)
      .subscribe();
    const interval = window.setInterval(refreshData, 30000);
    return () => { supabase.removeChannel(channel); window.clearInterval(interval); };
  }, [profile, refreshData, supabase]);

  useEffect(() => {
    if (!supabase || !activeVisit || !session?.user || !navigator.geolocation) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        await supabase.rpc('record_visit_location', {
          p_visit_id: activeVisit.id,
          p_lat: position.coords.latitude,
          p_lng: position.coords.longitude,
          p_accuracy_m: position.coords.accuracy
        });
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 20000 }
    );
    watchRef.current = watchId;
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeVisit, session?.user, supabase]);

  const login = async (email, password) => {
    setBusy(true); setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError(error.message);
    setBusy(false);
  };

  const signOut = async () => { await supabase.auth.signOut(); setTab('dashboard'); };

  const startVisit = async (customer, plan = null) => {
    if (!customer) return;
    setBusy(true);
    try {
      const position = await getCurrentPosition();
      const { data: result, error } = await supabase.rpc('start_verified_visit', {
        p_customer_id: customer.id,
        p_lat: position.coords.latitude,
        p_lng: position.coords.longitude,
        p_accuracy_m: position.coords.accuracy,
        p_journey_plan_id: plan?.id || null
      });
      if (error) throw error;
      const row = Array.isArray(result) ? result[0] : result;
      showNotice(`Checked in successfully. You are ${Math.round(row?.distance_m || 0)} metres from the account.`, 'success');
      setSelectedForStart(customer);
      setTab('visit');
      await refreshData();
    } catch (error) { showNotice(safeMessage(error), 'error'); } finally { setBusy(false); }
  };

  const closeVisit = async (form) => {
    if (!activeVisit) return;
    setBusy(true);
    try {
      const position = await getCurrentPosition();
      const { error: closeError } = await supabase.rpc('close_verified_visit', {
        p_visit_id: activeVisit.id,
        p_lat: position.coords.latitude,
        p_lng: position.coords.longitude,
        p_accuracy_m: position.coords.accuracy
      });
      if (closeError) throw closeError;

      const { error: updateError } = await supabase.from('visits').update({
        contact_met: form.contact_met || null,
        visit_objective: form.visit_objective || null,
        customer_interest: Number(form.customer_interest) || null,
        result: form.result || null,
        notes: form.notes || null,
        next_action: form.next_action || null,
        follow_up_date: form.follow_up_date || null,
        expected_order_sar: toNumber(form.expected_order_sar)
      }).eq('id', activeVisit.id);
      if (updateError) throw updateError;

      if (form.product_ids.length) {
        const { error } = await supabase.from('visit_products').upsert(form.product_ids.map((product_id) => ({ visit_id: activeVisit.id, product_id, outcome: 'discussed' })), { onConflict: 'visit_id,product_id,outcome' });
        if (error) throw error;
      }
      if (form.competitor_brand || form.competitor_notes || form.competitor_promotion) {
        const { error } = await supabase.from('competition_updates').insert({ visit_id: activeVisit.id, competitor_brand: form.competitor_brand || 'Not specified', competitor_price_sar: toNumber(form.competitor_price_sar) || null, promotion: form.competitor_promotion || null, update_notes: form.competitor_notes || null });
        if (error) throw error;
      }
      if (toNumber(form.collection_amount) > 0) {
        const { error } = await supabase.from('collection_receipts').insert({ visit_id: activeVisit.id, customer_id: activeVisit.customer_id, salesperson_id: profile.id, receipt_date: today(), amount_sar: toNumber(form.collection_amount), payment_status: form.payment_status, notes: form.collection_notes || null });
        if (error) throw error;
      }
      if (form.action_details || form.next_action) {
        const { error } = await supabase.from('actions').insert({ visit_id: activeVisit.id, customer_id: activeVisit.customer_id, owner_id: profile.id, created_by: profile.id, action_type: form.action_type || 'Follow up', details: form.action_details || form.next_action, due_date: form.action_due_date || form.follow_up_date || null });
        if (error) throw error;
      }
      showNotice('Visit closed and synced to the live database.', 'success');
      setActiveVisit(null); setSelectedForStart(null); setTab('dashboard');
      await refreshData();
    } catch (error) { showNotice(safeMessage(error), 'error'); } finally { setBusy(false); }
  };

  const saveDraft = (form) => { localStorage.setItem(`halwani-visit-draft-${activeVisit?.id || 'new'}`, JSON.stringify(form)); showNotice('Draft saved locally on this device.', 'success'); };

  const registerGps = async (customer) => {
    setBusy(true);
    try {
      const position = await getCurrentPosition();
      const { error } = await supabase.from('customers').update({ gps_lat: position.coords.latitude, gps_lng: position.coords.longitude, gps_radius_m: customer.gps_radius_m || 20 }).eq('id', customer.id);
      if (error) throw error;
      showNotice(`Account GPS registered for ${customer.name}.`, 'success'); await refreshData();
    } catch (error) { showNotice(safeMessage(error), 'error'); } finally { setBusy(false); }
  };

  const createApprovedCustomer = async (form) => {
    try {
      const { error } = await supabase.from('customers').insert({ ...form, salesperson_id: profile.id, status: 'approved' });
      if (error) throw error;
      showNotice('Approved customer added to the live database.', 'success'); await refreshData();
    } catch (error) { showNotice(safeMessage(error), 'error'); throw error; }
  };

  const createManualPlan = async (form) => {
    try {
      const customer = data.customers.find((c) => c.id === form.customer_id);
      const { error } = await supabase.from('journey_plans').insert({ plan_month: `${form.visit_date.slice(0,7)}-01`, salesperson_id: profile.id, customer_id: form.customer_id, visit_date: form.visit_date, visit_time: form.visit_time || null, branch: customer?.branch || null, city: customer?.city || null, area: customer?.area || null, notes: form.notes || null, source: 'manual' });
      if (error) throw error;
      showNotice('Manual visit added to the live journey plan.', 'success'); await refreshData();
    } catch (error) { showNotice(safeMessage(error), 'error'); throw error; }
  };

  const exportVisits = ExportButton({ data, profile: profile || {}, onNotice: showNotice });

  if (!hasSupabaseConfig()) return <ConfigurationRequired />;
  if (loading) return <div className="loading">Loading Halwani Food Service…</div>;
  if (!session) return <Login onLogin={login} busy={busy} error={loginError} />;
  if (!profile) return <div className="loading">Loading your profile…</div>;

  const currentCustomer = activeVisit ? data.customers.find((customer) => customer.id === activeVisit.customer_id) || selectedForStart : null;
  const canManage = isManagerRole(profile.role);
  const canImport = isImportAdminRole(profile.role);

  return <div className={`shell ${canManage ? 'leadership-shell' : 'sales-shell'}`}><div className="app-frame"><AppHeader profile={profile} onExport={exportVisits} onSignOut={signOut} />
    {notice && <div className={`notice ${notice.type}`} style={{ marginTop: 16 }}>{notice.message}</div>}
    {busy && <div className="notice info" style={{ marginTop: 12 }}>Working with the live database…</div>}
    {tab === 'dashboard' && <Dashboard profile={profile} data={data} onStart={() => setTab('visit')} onTab={setTab} activeVisit={activeVisit} />}
    {tab === 'visit' && (activeVisit ? <VisitCapture activeVisit={activeVisit} customer={currentCustomer} products={data.products} profile={profile} onClose={closeVisit} onSaveDraft={saveDraft} /> : <StartVisit data={data} activeVisit={activeVisit} onStart={startVisit} onOpenActive={() => setTab('visit')} onRegisterGps={registerGps} canEditGps={canManage} />)}
    {tab === 'plan' && <MonthPlan data={data} profile={profile} onAddManual={() => setModal('manualPlan')} onStart={startVisit} />}
    {tab === 'customers' && <Customers data={data} profile={profile} onAddCustomer={() => setModal('customer')} onRegisterGps={registerGps} />}
    {tab === 'records' && <Records data={data} profile={profile} onExport={exportVisits} onSignOut={signOut} />}
    {tab === 'manage' && canManage && <ManagerDashboard data={data} profile={profile} />}
    {tab === 'admin' && canImport && <ImportHub data={data} profile={profile} onRefresh={refreshData} onNotice={showNotice} />}
  </div>
  <nav className="tabbar"><button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Home</button><button className={tab === 'visit' ? 'active' : ''} onClick={() => setTab('visit')}>Visit</button><button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>Plan</button><button className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')}>Customers</button><button className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>Records</button>{canManage && <button className={tab === 'manage' ? 'active' : ''} onClick={() => setTab('manage')}>Manage</button>}{canImport && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Admin</button>}</nav>
  {modal === 'customer' && <NewCustomerModal profile={profile} onClose={() => setModal(null)} onCreate={createApprovedCustomer} />}
  {modal === 'manualPlan' && <ManualPlanModal customers={data.customers} profile={profile} onClose={() => setModal(null)} onCreate={createManualPlan} />}
  </div>;
}
