import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction,
  collection, query, where, orderBy,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const $ = (s) => document.querySelector(s);
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DAYS_LONG = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));


const fmtDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);return `${DAYS_LONG[new Date(y, m - 1, d).getDay()]} ${d} de ${MONTHS[m - 1]}`;
};

const views = ['loading','login','setup','dashboard'];
const show = (v) => views.forEach(x => $(`#view-${x}`).classList.toggle('hidden', x !== v));
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); };

let doctor = null;
let currentTab = 'hoy';
let currentMonth = new Date();
let editingDate = null;
let reschedulingCita = null;
let rescheduleDate = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { renderLogin(); show('login'); return; }
  try {
    const snap = await getDoc(doc(db, 'config', 'doctor'));
    if (!snap.exists()) {
      renderSetup();          // ← ESTA era la línea que faltaba
      show('setup');
      return;
    }
    doctor = snap.data();
    show('dashboard');
    renderDashboard();
  } catch (err) {
    console.error('Error al cargar configuración:', err);
    alert(
      'No se pudo cargar la configuración.\n\n' +
      'Código: ' + (err.code || err.message) + '\n\n' +
      'Verifica:\n' +
      '1. Que publicaste las reglas de Firestore (Paso 3)\n' +
      '2. Que el usuario existe en Authentication → Users\n' +
      '3. Recarga con Ctrl+Shift+R'
    );
    renderLogin();
    show('login');
  }
});

// ===== LOGIN =====
function renderLogin() {
  $('#view-login').innerHTML = `
    <h1 style="font-size:22px;font-weight:600;margin-bottom:24px">Panel del doctor</h1>
    <form class="form" id="login-form">
      <div class="field"><label>Correo</label><input type="email" id="in-email" required></div>
      <div class="field"><label>Contraseña</label><input type="password" id="in-pass" required></div>
      <button class="primary-btn" type="submit">Entrar</button>
    </form>
  `;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $('#in-email').value, $('#in-pass').value);
    } catch (err) { toast('Credenciales incorrectas'); }
  };
}

// ===== SETUP (primera vez) =====
function renderSetup() {
  const dayLabels = ['D','L','M','M','J','V','S'];
  const hours = Array.from({length:24},(_,i)=>pad(i));
  const mins = Array.from({length:12},(_,i)=>pad(i*5));

  $('#view-setup').innerHTML = `
    <h1 style="font-size:22px;font-weight:600;margin-bottom:6px">Configurar agenda</h1>
    <p class="muted" style="margin-bottom:24px;font-size:14px">Solo una vez. Después podrás editar todo.</p>
    <form class="form" id="setup-form">
      <div class="field"><label>Nombre</label><input id="s-nombre" required></div>
      <div class="field"><label>Especialidad</label><input id="s-esp"></div>
      <div class="field"><label>WhatsApp (con código de país, ej: 5215512345678)</label><input id="s-wa" required inputmode="tel"></div>
      
      <div class="field"><label>Hora de inicio (24h)</label>
        <div style="display:flex; gap:4px; align-items:center;">
          <select id="s-ini-h" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${hours.map(h=>`<option value="${h}" ${h==='09'?'selected':''}>${h}</option>`).join('')}
          </select>
          <span>:</span>
          <select id="s-ini-m" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${mins.map(m=>`<option value="${m}" ${m==='00'?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field"><label>Hora de fin (24h)</label>
        <div style="display:flex; gap:4px; align-items:center;">
          <select id="s-fin-h" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${hours.map(h=>`<option value="${h}" ${h==='18'?'selected':''}>${h}</option>`).join('')}
          </select>
          <span>:</span>
          <select id="s-fin-m" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${mins.map(m=>`<option value="${m}" ${m==='00'?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field"><label>Duración de cita (min)</label><input type="number" id="s-dur" value="30" min="15" step="5" required></div>
      <div class="field"><label>Días laborables</label>
        <div id="days-checks" style="display:flex;gap:6px">
          ${dayLabels.map((l,i) => `<button type="button" class="slot" data-day="${i}" style="padding:12px;flex:1">${l}</button>`).join('')}
        </div>
      </div>
      <button class="primary-btn" type="submit">Crear agenda</button>
    </form>
  `;
  const selectedDays = new Set([1,2,3,4,5]);
  $('#days-checks').querySelectorAll('button').forEach(b => {
    const d = parseInt(b.dataset.day);
    const updateStyle = () => {
      b.style.background = selectedDays.has(d) ? 'var(--accent)' : '';
      b.style.color = selectedDays.has(d) ? 'var(--accent-fg)' : '';
    };
    updateStyle();
    b.onclick = (e) => {
      e.preventDefault();
      if (selectedDays.has(d)) selectedDays.delete(d); else selectedDays.add(d);
      updateStyle();
    };
  });

  $('#setup-form').onsubmit = async (e) => {
    e.preventDefault();
    const nombre = $('#s-nombre').value.trim();
    const whatsapp = $('#s-wa').value.replace(/\D/g, '');
    if (!nombre || !whatsapp) { toast('Completa nombre y WhatsApp'); return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creando…';

    const config = {
      nombre,
      especialidad: $('#s-esp').value.trim(),
      whatsapp,
      inicio: `${$('#s-ini-h').value}:${$('#s-ini-m').value}`,
      fin: `${$('#s-fin-h').value}:${$('#s-fin-m').value}`,
      duracion: parseInt($('#s-dur').value),
      diasLaborables: [...selectedDays]
    };
    try {
      await setDoc(doc(db, 'config', 'doctor'), config);
      await generateAgenda(config);
      doctor = config;
      show('dashboard');
      renderDashboard();
    } catch (err) { console.error(err); toast('Error al crear'); btn.disabled = false; btn.textContent = 'Crear agenda'; }
  };
}

function generateSlots(config) {
  const [sh, sm] = config.inicio.split(':').map(Number);
  const [eh, em] = config.fin.split(':').map(Number);
  let curr = sh * 60 + sm; const end = eh * 60 + em;
  const slots = [];
  while (curr < end) { slots.push(`${pad(Math.floor(curr/60))}:${pad(curr%60)}`); curr += config.duracion; }
  return slots;
}

async function generateAgenda(config) {
  const slots = generateSlots(config);
  const today = new Date(); today.setHours(0,0,0,0);
  const batch = writeBatch(db);
  
  // Generar 90 días
  for (let i = 0; i < 90; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const open = config.diasLaborables.includes(d.getDay());
    batch.set(doc(db, 'horarios', ymd(d)), { abierto: open, slots: open ? slots : [], inactivos: [] });
  }
  
  // Generar los 3 meses abiertos por defecto
  for (let i = 0; i < 3; i++) {
    const m = new Date(today.getFullYear(), today.getMonth() + i, 1);
    batch.set(doc(db, 'meses', `${m.getFullYear()}-${pad(m.getMonth()+1)}`), { abierto: true });
  }
  
  await batch.commit();
}

function renderDashboard() {
  // Si estamos reprogramando, mostramos esa vista
  if (reschedulingCita) return renderRescheduleDate();

  $('#view-dashboard').innerHTML = `
    <div class="header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h1 style="font-size:20px">${esc(doctor.nombre)}</h1>
        <p class="muted" style="font-size:13px">${esc(doctor.especialidad || '')}</p>
      </div>
      <button class="back-btn" id="btn-logout" style="margin:0">Salir</button>
    </div>
    <div class="tabs">
      <button class="tab ${currentTab==='hoy'?'active':''}" data-tab="hoy">Próximas</button>
      <button class="tab ${currentTab==='cal'?'active':''}" data-tab="cal">Calendario</button>
      <button class="tab ${currentTab==='cfg'?'active':''}" data-tab="cfg">Ajustes</button>
    </div>
    <div id="tab-content"></div>
  `;
  $('#btn-logout').onclick = () => signOut(auth);
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => { currentTab = t.dataset.tab; renderDashboard(); };
  });
  if (currentTab === 'hoy') renderProximas();
  else if (currentTab === 'cal') renderCalendar();
  else renderSettings();
}

// --- PRÓXIMAS CITAS Y REPROGRAMACIÓN ---
async function renderProximas() {
  const content = $('#tab-content');
  content.innerHTML = '<p class="muted">Cargando…</p>';
  
  try {
    const snap = await getDocs(collection(db, 'citas'));
    const todayStr = ymd(new Date());
    
    let citas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.fecha >= todayStr)
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

    if (citas.length === 0) { 
      content.innerHTML = '<p class="muted">No hay citas próximas.</p>'; 
      return; 
    }

    let html = '';
    let lastDate = '';

    citas.forEach(c => {
      if (c.fecha !== lastDate) {
        const [y, m, d] = c.fecha.split('-').map(Number);
        const dateObj = new Date(y, m-1, d);
        let label = `${DAYS_LONG[dateObj.getDay()]} ${d} de ${MONTHS[m-1]}`;
        if (c.fecha === todayStr) label = 'HOY · ' + label;
        
        html += `<h4 style="font-size:13px; margin:24px 0 12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">${label}</h4>`;
        lastDate = c.fecha;
      }
      html += citaCard(c.id, c);
    });

    content.innerHTML = html;
    bindCitaActions();
  } catch (e) { 
    console.error(e); 
    content.innerHTML = '<p class="muted">Error al cargar.</p>'; 
  }
}

function citaCard(id, c) {
  const horaFormatted = (c.hora || id.split('_')[1].replace(/(\d{2})(\d{2})/, '$1:$2')) + ' hrs';
  return `
    <div class="cita-card" data-id="${esc(id)}">
      <h4>${esc(c.nombre)}${c.edad ? ` · ${c.edad} años` : ''}</h4>
      <div class="time">${horaFormatted}</div>
      ${c.telefono ? `<div class="motivo" style="color:var(--fg); margin-top:4px; font-weight:500;">📞 ${esc(c.telefono)}</div>` : ''}
      ${c.ubicacion ? `<div class="motivo" style="color:var(--fg); margin-top:4px;">📍 ${esc(c.ubicacion)}</div>` : ''}
      ${c.motivo ? `<div class="motivo">${esc(c.motivo)}</div>` : ''}
      <div class="actions">
        <button data-action="reschedule" style="border-color:var(--accent); color:var(--accent);">Reprogramar</button>
        <button data-action="del">Eliminar</button>
        <a href="https://wa.me/${esc(c.telefono ? c.telefono.replace(/\D/g, '') : doctor.whatsapp)}" target="_blank">WhatsApp</a>
      </div>
    </div>
  `;
}

function bindCitaActions() {
  document.querySelectorAll('.cita-card [data-action="del"]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('¿Eliminar esta cita definitivamente?')) return;
      const id = btn.closest('.cita-card').dataset.id;
      try {
        const [fecha, horaRaw] = id.split('_');
        const hora = horaRaw.replace(/(\d{2})(\d{2})/, '$1:$2');
        const agRef = doc(db, 'agenda', fecha);
        const agSnap = await getDoc(agRef);
        if (agSnap.exists()) {
          const ocupados = (agSnap.data().ocupados || []).filter(x => x !== hora);
          await updateDoc(agRef, { ocupados });
        }
        await deleteDoc(doc(db, 'citas', id));
        toast('Cita eliminada');
        renderProximas();
      } catch (e) { console.error(e); toast('Error al eliminar'); }
    };
  });

  document.querySelectorAll('.cita-card [data-action="reschedule"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.closest('.cita-card').dataset.id;
      reschedulingCita = { id, fecha: id.split('_')[0], hora: id.split('_')[1].replace(/(\d{2})(\d{2})/, '$1:$2') };
      renderRescheduleDate();
    };
  });
}

// --- VISTAS DE REPROGRAMACIÓN ---
async function renderRescheduleDate() {
  const content = $('#tab-content');
  const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m+1, 0).getDate();

  content.innerHTML = `
    <button class="back-btn" id="cancel-resched">✖ Cancelar</button>
    <div style="margin-bottom:20px">
      <h3 style="font-size:16px;">Reprogramar Cita</h3>
      <p class="muted" style="font-size:13px">Selecciona el nuevo día</p>
    </div>
    <div class="month-nav">
      <button class="nav-btn" id="prev" ${m === today.getMonth() && y === today.getFullYear() ? 'disabled' : ''}>←</button>
      <div class="month-title">${MONTHS[m]} ${y}</div>
      <button class="nav-btn" id="next">→</button>
    </div>
    <div class="weekdays"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div>
    <div class="days-grid" id="grid"></div>
  `;

  $('#cancel-resched').onclick = () => { reschedulingCita = null; rescheduleDate = null; renderDashboard(); };
  $('#prev').onclick = () => { currentMonth.setMonth(m-1); renderRescheduleDate(); };
  $('#next').onclick = () => { currentMonth.setMonth(m+1); renderRescheduleDate(); };

  const grid = $('#grid');
  for (let i = 0; i < firstWeekday; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const el = document.createElement('button');
    el.className = 'day'; el.textContent = d; el.dataset.date = ymd(new Date(y, m, d));
    if (new Date(y, m, d) < today) { el.classList.add('day-past'); el.disabled = true; }
    grid.appendChild(el);
  }

  const start = ymd(new Date(y, m, 1)), end = ymd(new Date(y, m+1, 0));
  const [horSnap, agSnap] = await Promise.all([
    getDocs(query(collection(db, 'horarios'), where('__name__', '>=', start), where('__name__', '<=', end))),
    getDocs(query(collection(db, 'agenda'), where('__name__', '>=', start), where('__name__', '<=', end)))
  ]);
  const horarios = {}, agendas = {};
  horSnap.forEach(d => horarios[d.id] = d.data());
  agSnap.forEach(d => agendas[d.id] = d.data());

  grid.querySelectorAll('.day').forEach(el => {
    if (el.disabled) return;
    const dateStr = el.dataset.date;
    const hor = horarios[dateStr];
    const occ = agendas[dateStr]?.ocupados || [];
    const inactivos = hor?.inactivos || [];
    
    const available = (hor?.slots || []).filter(s => !occ.includes(s) && !inactivos.includes(s));

    if (!hor?.abierto || available.length === 0) { 
      el.classList.add('day-closed'); el.disabled = true; return; 
    }
    el.classList.add('day-available');
    el.onclick = () => { rescheduleDate = dateStr; renderRescheduleTime(); };
  });
}

async function renderRescheduleTime() {
  const content = $('#tab-content');
  const [horSnap, agSnap] = await Promise.all([
    getDoc(doc(db, 'horarios', rescheduleDate)),
    getDoc(doc(db, 'agenda', rescheduleDate))
  ]);
  
  if (!horSnap.exists()) {
    content.innerHTML = `<button class="back-btn" id="back-resched-date">← Cambiar día</button><p class="muted">No hay horarios configurados para este día.</p>`;
    $('#back-resched-date').onclick = () => renderRescheduleDate();
    return;
  }

  const hor = horSnap.data();
  const ocupados = agSnap.exists() ? (agSnap.data().ocupados || []) : [];
  const inactivos = hor.inactivos || [];

  content.innerHTML = `
    <button class="back-btn" id="back-resched-date">← Cambiar día</button>
    <div style="margin-bottom:20px">
      <h3 style="font-size:16px;">${fmtDate(rescheduleDate)}</h3>
      <p class="muted" style="font-size:13px">Selecciona la nueva hora</p>
    </div>
    <div class="slots">
      ${(hor.slots || []).map(s => {
        const taken = ocupados.includes(s);
        const off = inactivos.includes(s);
        const dis = taken || off;
        return `<button class="slot ${taken ? 'slot-taken' : ''} ${off ? 'slot-past' : ''}" data-hora="${s}" ${dis ? 'disabled' : ''}>${s} hrs</button>`;
      }).join('')}
    </div>
  `;

  $('#back-resched-date').onclick = () => renderRescheduleDate();
  content.querySelectorAll('.slot:not([disabled])').forEach(btn => {
    btn.onclick = () => executeReschedule(btn.dataset.hora);
  });
}

async function executeReschedule(newHora) {
  const oldFecha = reschedulingCita.fecha;
  const oldHora = reschedulingCita.hora;
  const oldId = reschedulingCita.id;
  const newId = `${rescheduleDate}_${newHora.replace(':', '')}`;

  // Guarda: evita borrar+recrear el mismo documento en una sola transacción
  if (newId === oldId) {
    toast('La cita ya está en ese horario');
    reschedulingCita = null;
    rescheduleDate = null;
    renderDashboard();
    return;
  }

  const content = $('#tab-content');
  content.innerHTML = '<p class="muted">Reprogramando…</p>';

  try {
    await runTransaction(db, async (tx) => {
      const newAgendaRef = doc(db, 'agenda', rescheduleDate);
      const newAgendaSnap = await tx.get(newAgendaRef);
      const newOcupados = newAgendaSnap.exists() ? (newAgendaSnap.data().ocupados || []) : [];
      if (newOcupados.includes(newHora)) throw new Error('SLOT_TAKEN');

      const oldCitaRef = doc(db, 'citas', oldId);
      const citaSnap = await tx.get(oldCitaRef);
      if (!citaSnap.exists()) throw new Error('NOT_FOUND');
      const data = citaSnap.data();

      // Traemos el nuevo horario para saber la nueva ubicación
      const newHorRef = doc(db, 'horarios', rescheduleDate);
      const newHorSnap = await tx.get(newHorRef);
      const newUbi = newHorSnap.exists() ? (newHorSnap.data().ubicacionesPorHora?.[newHora] || '') : '';

      const oldAgendaRef = doc(db, 'agenda', oldFecha);
      const oldAgendaSnap = await tx.get(oldAgendaRef);
      if (oldAgendaSnap.exists()) {
        const oldOcupados = (oldAgendaSnap.data().ocupados || []).filter(h => h !== oldHora);
        tx.update(oldAgendaRef, { ocupados: oldOcupados });
      }

      tx.set(newAgendaRef, { ocupados: [...newOcupados, newHora] }, { merge: true });

      tx.delete(oldCitaRef);
      data.fecha = rescheduleDate;
      data.hora = newHora;
      data.ubicacion = newUbi;
      tx.set(doc(db, 'citas', newId), data);
    });

    toast(`✓ Reprogramada al ${fmtDate(rescheduleDate)} a las ${newHora}`);
    reschedulingCita = null;
    rescheduleDate = null;
    renderDashboard();
  } catch (err) {
    console.error(err);
    if (err.message === 'SLOT_TAKEN') {
      toast('Esa hora acaba de ser ocupada');
      renderRescheduleTime();
    } else {
      toast('Error al reprogramar');
      renderDashboard();
    }
  }
}

async function renderCalendar() {
  const content = $('#tab-content');
  if (editingDate) return renderDayEditor(editingDate);
  
  const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
  const mesId = `${y}-${pad(m+1)}`;
  
  // Consultar si el mes está abierto
  const mesSnap = await getDoc(doc(db, 'meses', mesId));
  const mesAbierto = mesSnap.exists() ? mesSnap.data().abierto : true;

  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const isCurrentMonth = y === new Date().getFullYear() && m === new Date().getMonth();

  content.innerHTML = `
    <div style="margin-bottom: 20px; display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:14px;font-weight:500">Estado del mes:</span>
      <button class="slot-toggle ${mesAbierto ? '' : 'off'}" id="toggle-mes" style="width:auto; margin:0; padding:8px 16px;">
        ${mesAbierto ? 'Abierto (Clic para cerrar)' : 'Cerrado (Clic para abrir)'}
      </button>
    </div>
    <div class="month-nav">
      <button class="nav-btn" id="prev" ${isCurrentMonth ? 'disabled' : ''}>←</button>
      <div class="month-title">${MONTHS[m]} ${y}</div>
      <button class="nav-btn" id="next">→</button>
    </div>
    <div class="weekdays"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div>
    <div class="days-grid" id="grid"></div>
  `;

  $('#toggle-mes').onclick = async () => {
    await setDoc(doc(db, 'meses', mesId), { abierto: !mesAbierto }, { merge: true });
    toast(mesAbierto ? 'Mes bloqueado' : 'Mes desbloqueado');
    renderCalendar();
  };

  const grid = $('#grid');
  for (let i = 0; i < firstWeekday; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const el = document.createElement('button');
    el.className = 'day'; el.textContent = d; el.dataset.date = ymd(new Date(y, m, d));
    grid.appendChild(el);
  }

  $('#prev').onclick = () => { currentMonth.setMonth(m-1); renderCalendar(); };
  $('#next').onclick = () => { currentMonth.setMonth(m+1); renderCalendar(); };

  const start = ymd(new Date(y, m, 1)), end = ymd(new Date(y, m+1, 0));
  const [horSnap, agSnap] = await Promise.all([
    getDocs(query(collection(db, 'horarios'), where('__name__', '>=', start), where('__name__', '<=', end))),
    getDocs(query(collection(db, 'agenda'), where('__name__', '>=', start), where('__name__', '<=', end)))
  ]);
  const horarios = {}, agendas = {};
  horSnap.forEach(d => horarios[d.id] = d.data());
  agSnap.forEach(d => agendas[d.id] = d.data());

  grid.querySelectorAll('.day').forEach(el => {
    const dateStr = el.dataset.date;
    const hor = horarios[dateStr];
    const occ = agendas[dateStr]?.ocupados || [];
    
    if (!mesAbierto || !hor?.abierto) el.classList.add('day-closed');
    else if (occ.length > 0) { el.style.background = 'var(--success)'; el.style.color = 'white'; }
    else el.classList.add('day-available');
    
    el.onclick = () => { editingDate = dateStr; renderDayEditor(dateStr); };
  });
}

async function renderDayEditor(dateStr) {
  const content = $('#tab-content');
  const [horSnap, agSnap, citasSnap] = await Promise.all([
    getDoc(doc(db, 'horarios', dateStr)),
    getDoc(doc(db, 'agenda', dateStr)),
    getDocs(query(collection(db, 'citas'), where('fecha', '==', dateStr), orderBy('hora')))
  ]);
  const hor = horSnap.exists() ? horSnap.data() : { abierto: false, slots: [], inactivos: [], ubicacionesPorHora: {} };
  const ocupados = agSnap.exists() ? (agSnap.data().ocupados || []) : [];
  const inactivos = hor.inactivos || [];
  const ubiMap = hor.ubicacionesPorHora || {};
  const citas = citasSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const [y, m, d] = dateStr.split('-').map(Number);
  const fechaLabel = `${DAYS_LONG[new Date(y, m-1, d).getDay()]} ${d} de ${MONTHS[m-1]}`;

  const grouped = {};
  (hor.slots || []).forEach(s => {
    const loc = ubiMap[s] || 'Consultorio';
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc].push(s);
  });

  let slotsHtml = '';
  for (const [loc, sList] of Object.entries(grouped)) {
    slotsHtml += `<div style="margin-top:16px; margin-bottom:8px; font-size:13px; font-weight:500; color:var(--muted); text-transform:uppercase;">📍 ${esc(loc)}</div>`;
    slotsHtml += sList.map(s => {
      const taken = ocupados.includes(s);
      const isOff = inactivos.includes(s);
      return `<button class="slot-toggle ${taken ? 'ocupado' : (isOff ? 'off' : '')}" data-slot="${s}" ${taken ? 'disabled' : ''}>
        <span>${s} hrs</span><span>${taken ? 'Cita' : (isOff ? 'Desactivado' : 'Activo')}</span>
      </button>`;
    }).join('');
  }

  content.innerHTML = `
    <button class="back-btn" id="back-cal">← Volver al calendario</button>
    <h3 style="font-size:16px;margin-bottom:16px">${fechaLabel}</h3>
    
    <button class="slot-toggle ${hor.abierto ? '' : 'off'}" id="toggle-open">
      <span>${hor.abierto ? 'Día Abierto' : 'Día Cerrado'}</span>
      <span>${hor.abierto ? '●' : '○'}</span>
    </button>
    
    ${citas.length ? `
      <h4 style="font-size:14px;margin:24px 0 12px;color:var(--muted);text-transform:uppercase">Citas (${citas.length})</h4>
      ${citas.map(c => `
        <div class="cita-card">
          <h4>${esc(c.nombre)} ${c.edad ? '· ' + c.edad + ' años' : ''}</h4>
          <div class="time">${c.hora} hrs</div>
          ${c.telefono ? `<div class="motivo" style="color:var(--fg); margin-top:4px; font-weight:500;">📞 ${esc(c.telefono)}</div>` : ''}
          ${c.ubicacion ? `<div class="motivo" style="color:var(--fg); margin-top:4px;">📍 ${esc(c.ubicacion)}</div>` : ''}
          ${c.motivo ? `<div class="motivo">${esc(c.motivo)}</div>` : ''}
        </div>
      `).join('')}
    ` : ''}

    ${slotsHtml ? `
      <h4 style="font-size:14px;margin:24px 0 12px;color:var(--muted);text-transform:uppercase">Horarios</h4>
      <div id="slot-list">${slotsHtml}</div>
    ` : ''}
  `;
  
  $('#back-cal').onclick = () => { editingDate = null; renderCalendar(); };

  document.querySelectorAll('#slot-list button:not([disabled])').forEach(btn => {
    btn.onclick = async () => {
      const s = btn.dataset.slot;
      let newInactivos = [...inactivos];
      if (newInactivos.includes(s)) {
        newInactivos = newInactivos.filter(x => x !== s);
        toast('Hora activada');
      } else {
        newInactivos.push(s);
        toast('Hora desactivada');
      }
      await updateDoc(doc(db, 'horarios', dateStr), { inactivos: newInactivos });
      renderDayEditor(dateStr);
    };
  });

  $('#toggle-open').onclick = async () => {
    await updateDoc(doc(db, 'horarios', dateStr), { abierto: !hor.abierto });
    toast(hor.abierto ? 'Día cerrado' : 'Día abierto');
    renderDayEditor(dateStr);
  };
}

function renderSettings() {
  const content = $('#tab-content');
  const dayLabels = ['D','L','M','M','J','V','S'];
  const hours = Array.from({length:24},(_,i)=>pad(i));
  const mins = Array.from({length:12},(_,i)=>pad(i*5));
  
  const duraciones = [15, 30, 45, 60, 90, 120, 180, 240];
  if (doctor.duracion && !duraciones.includes(doctor.duracion)) duraciones.push(doctor.duracion);
  duraciones.sort((a, b) => a - b);

  const blockRowHtml = (ini, fin, loc) => {
    const [ih, im] = (ini || '09:00').split(':');
    const [fh, fm] = (fin || '13:00').split(':');
    return `
      <div class="block-row" style="display:flex; gap:4px; margin-bottom:8px; align-items:center; flex-wrap:wrap;">
        <div style="display:flex; gap:2px; align-items:center;">
          <select class="b-ini-h" style="padding:6px; font-size:13px; border-radius:4px; border:1px solid var(--border); background:var(--bg); color:var(--fg);">
            ${hours.map(x => `<option value="${x}" ${x===ih?'selected':''}>${x}</option>`).join('')}
          </select>
          <span>:</span>
          <select class="b-ini-m" style="padding:6px; font-size:13px; border-radius:4px; border:1px solid var(--border); background:var(--bg); color:var(--fg);">
            ${mins.map(x => `<option value="${x}" ${x===im?'selected':''}>${x}</option>`).join('')}
          </select>
        </div>
        <span style="font-size:12px; color:var(--muted);">a</span>
        <div style="display:flex; gap:2px; align-items:center;">
          <select class="b-fin-h" style="padding:6px; font-size:13px; border-radius:4px; border:1px solid var(--border); background:var(--bg); color:var(--fg);">
            ${hours.map(x => `<option value="${x}" ${x===fh?'selected':''}>${x}</option>`).join('')}
          </select>
          <span>:</span>
          <select class="b-fin-m" style="padding:6px; font-size:13px; border-radius:4px; border:1px solid var(--border); background:var(--bg); color:var(--fg);">
            ${mins.map(x => `<option value="${x}" ${x===fm?'selected':''}>${x}</option>`).join('')}
          </select>
        </div>
        <input type="text" class="b-loc" value="${esc(loc || '')}" placeholder="Consultorio" style="flex:1; min-width:100px; padding:6px; font-size:13px; background:var(--bg); border:1px solid var(--border); border-radius:4px; color:var(--fg);">
        <button type="button" class="del-block" style="background:none; border:none; color:var(--muted); cursor:pointer; font-size:16px; padding:4px;">✖</button>
      </div>
    `;
  };

  const [iniH, iniM] = (doctor.inicio || '09:00').split(':');
  const [finH, finM] = (doctor.fin || '18:00').split(':');

  content.innerHTML = `
    <form class="form" id="settings-form">
      <div class="field"><label>Nombre</label><input id="set-nombre" value="${esc(doctor.nombre)}"></div>
      <div class="field"><label>Especialidad</label><input id="set-esp" value="${esc(doctor.especialidad || '')}"></div>
      <div class="field"><label>WhatsApp</label><input id="set-wa" inputmode="tel" value="${esc(doctor.whatsapp)}"></div>
      
      <hr style="border:0; border-top:1px solid var(--border); margin: 10px 0;">
      <p style="font-size:13px; color:var(--muted); margin-bottom:8px;">Ajustes de horario (24h)</p>
      
      <div class="field"><label>Hora de inicio</label>
        <div style="display:flex; gap:4px; align-items:center;">
          <select id="set-ini-h" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${hours.map(h=>`<option value="${h}" ${h===iniH?'selected':''}>${h}</option>`).join('')}
          </select>
          <span>:</span>
          <select id="set-ini-m" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${mins.map(m=>`<option value="${m}" ${m===iniM?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label>Hora de fin</label>
        <div style="display:flex; gap:4px; align-items:center;">
          <select id="set-fin-h" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${hours.map(h=>`<option value="${h}" ${h===finH?'selected':''}>${h}</option>`).join('')}
          </select>
          <span>:</span>
          <select id="set-fin-m" style="padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--fg); font-size:16px;">
            ${mins.map(m=>`<option value="${m}" ${m===finM?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
      
      <div class="field">
        <label>Duración de la cita</label>
        <select id="set-dur" required style="padding:14px 16px; background:var(--surface); border-radius:var(--radius); border:1px solid transparent; color:var(--fg); font-size:16px;">
          ${duraciones.map(d => {
            let label = `${d} minutos`;
            if (d === 60) label = `1 hora`;
            if (d > 60) label = `${d/60} horas`;
            return `<option value="${d}" ${doctor.duracion === d ? 'selected' : ''}>${label}</option>`;
          }).join('')}
        </select>
      </div>

      <div class="field"><label>Días laborables</label>
        <div id="days-checks" style="display:flex;gap:6px; margin-bottom: 16px;">
          ${dayLabels.map((l,i) => `<button type="button" class="slot" data-day="${i}" style="padding:12px;flex:1">${l}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>Bloques y Ubicaciones por día</label>
        <p class="muted" style="font-size:12px; margin-bottom:12px;">Si agregas bloques, las horas se adaptarán a estos rangos.</p>
        ${dayLabels.map((l, i) => `
          <div style="margin-bottom:16px; padding:12px; background:var(--surface); border-radius:var(--radius);" data-day="${i}">
            <div style="font-weight:500; margin-bottom:12px;">${DAYS_LONG[i]}</div>
            <div class="blocks-list" id="blocks-${i}">
              ${(doctor.bloques?.[i] || []).map(b => blockRowHtml(b.inicio, b.fin, b.ubicacion)).join('')}
            </div>
            <button type="button" class="secondary-btn add-block" data-day="${i}" style="padding:8px; font-size:13px; margin-top:4px;">+ Agregar bloque</button>
          </div>
        `).join('')}
      </div>

      <button class="primary-btn" type="submit" id="btn-save-settings">Guardar y actualizar agenda</button>
    </form>
  `;

  const selectedDays = new Set(doctor.diasLaborables || [1,2,3,4,5]);
  $('#days-checks').querySelectorAll('button').forEach(b => {
    const d = parseInt(b.dataset.day);
    const updateStyle = () => {
      b.style.background = selectedDays.has(d) ? 'var(--accent)' : '';
      b.style.color = selectedDays.has(d) ? 'var(--accent-fg)' : '';
    };
    updateStyle();
    b.onclick = (e) => {
      e.preventDefault();
      if (selectedDays.has(d)) selectedDays.delete(d); else selectedDays.add(d);
      updateStyle();
    };
  });

  const bindRemoveBtns = (container) => {
    container.querySelectorAll('.del-block').forEach(btn => {
      btn.onclick = () => btn.closest('.block-row').remove();
    });
  };
  document.querySelectorAll('.blocks-list').forEach(bindRemoveBtns);

  content.querySelectorAll('.add-block').forEach(btn => {
    btn.onclick = () => {
      const day = btn.dataset.day;
      const list = document.getElementById(`blocks-${day}`);
      list.insertAdjacentHTML('beforeend', blockRowHtml());
      bindRemoveBtns(list);
    };
  });

  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#btn-save-settings');
    btn.disabled = true; btn.textContent = 'Actualizando agenda…';

    const newBloques = {};
    for (let i=0; i<7; i++) {
      const rows = document.getElementById(`blocks-${i}`).querySelectorAll('.block-row');
      const dayBlocks = [];
      rows.forEach(row => {
        const start = `${row.querySelector('.b-ini-h').value}:${row.querySelector('.b-ini-m').value}`;
        const end = `${row.querySelector('.b-fin-h').value}:${row.querySelector('.b-fin-m').value}`;
        let loc = row.querySelector('.b-loc').value.trim();
        if (start && end) dayBlocks.push({ inicio: start, fin: end, ubicacion: loc || 'Consultorio' });
      });
      if (dayBlocks.length) newBloques[i] = dayBlocks;
    }

    const newConfig = {
      nombre: $('#set-nombre').value.trim(),
      especialidad: $('#set-esp').value.trim(),
      whatsapp: $('#set-wa').value.replace(/\D/g, ''),
      inicio: `${$('#set-ini-h').value}:${$('#set-ini-m').value}`,
      fin: `${$('#set-fin-h').value}:${$('#set-fin-m').value}`,
      duracion: parseInt($('#set-dur').value),
      diasLaborables: [...selectedDays],
      bloques: newBloques
    };

    try {
      await updateDoc(doc(db, 'config', 'doctor'), newConfig);
      doctor = newConfig;
      await updateFutureSchedule(newConfig);
      toast('Ajustes guardados. Agenda actualizada.');
    } catch (err) {
      console.error(err);
      toast('Error al guardar');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar y actualizar agenda';
    }
  };
}

async function updateFutureSchedule(config) {
  const baseSlots = generateSlots(config);
  const today = new Date(); today.setHours(0,0,0,0);
  
  const start = ymd(today);
  const end = new Date(today); end.setDate(end.getDate() + 90);
  const agSnap = await getDocs(query(collection(db, 'agenda'), where('__name__', '>=', start), where('__name__', '<=', ymd(end))));
  
  const diasConCitas = new Set();
  agSnap.forEach(d => {
    if ((d.data().ocupados || []).length > 0) diasConCitas.add(d.id);
  });

  const batch = writeBatch(db);
  
  for (let i = 0; i < 90; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const dateStr = ymd(d);
    
    if (diasConCitas.has(dateStr)) continue;

    const isOpen = config.diasLaborables.includes(d.getDay());
    const dayBlocks = config.bloques && config.bloques[d.getDay()] ? config.bloques[d.getDay()] : [];
    
    let validSlots = [];
    let ubicacionesPorHora = {};

    if (isOpen) {
      if (dayBlocks.length > 0) {
        // Si hay bloques, filtramos las horas y asignamos ubicación
        baseSlots.forEach(s => {
          for (const b of dayBlocks) {
            if (s >= b.inicio && s < b.fin) {
              validSlots.push(s);
              ubicacionesPorHora[s] = b.ubicacion;
              break;
            }
          }
        });
      } else {
        // Si no hay bloques, se muestran todas las horas sin ubicación específica
        validSlots = [...baseSlots];
      }
    }
    
    batch.set(doc(db, 'horarios', dateStr), { 
      abierto: isOpen && validSlots.length > 0, 
      slots: validSlots,
      inactivos: [],
      ubicacionesPorHora: ubicacionesPorHora
    }, { merge: true });
  }
  
  await batch.commit();
}
