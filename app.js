import { db } from './firebase-config.js';
import {
  doc, getDoc, getDocs, collection, query, where,
  runTransaction, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DAYS_LONG = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmtDate = (s) => {
  const [y,m,d] = s.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return `${DAYS_LONG[dt.getDay()]} ${d} de ${MONTHS[m-1]}`;
};
const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let doctor = null;
let currentMonth = new Date();
let selectedDate = null;
let selectedHora = null;
let monthData = { horarios: {}, agendas: {} };
let unsubAgenda = null;

init();

async function init() {
  try {
    const snap = await getDoc(doc(db, 'config', 'doctor'));
    if (!snap.exists()) {
      $('main').innerHTML = '<div class="error"><p>Esta agenda aún no está configurada.</p></div>';
      return;
    }
    doctor = snap.data();
    $('#doctor-name').textContent = doctor.nombre || 'Cita';
    $('#doctor-specialty').textContent = doctor.especialidad || '';
    document.title = `Agendar · ${doctor.nombre}`;
    renderDateStep();
  } catch (e) {
    console.error(e);
    $('main').innerHTML = '<div class="error"><p>Error al cargar. Intenta de nuevo.</p></div>';
  }
}

async function renderDateStep() {
  $('#step-date').classList.remove('hidden');
  $('#step-time').classList.add('hidden');
  $('#step-form').classList.add('hidden');
  $('#step-done').classList.add('hidden');

  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const isCurrentMonth = y === today.getFullYear() && m === today.getMonth();

  $('#step-date').innerHTML = `
    <div class="month-nav">
      <button class="nav-btn" id="prev-month" ${isCurrentMonth ? 'disabled' : ''}>←</button>
      <div class="month-title">${MONTHS[m]} ${y}</div>
      <button class="nav-btn" id="next-month">→</button>
    </div>
    <div class="weekdays"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div>
    <div class="days-grid" id="days-grid"></div>
  `;

  const grid = $('#days-grid');
  for (let i = 0; i < firstWeekday; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const el = document.createElement('button');
    el.className = 'day';
    el.textContent = d;
    el.dataset.date = ymd(new Date(y, m, d));
    if (new Date(y, m, d) < today) { el.classList.add('day-past'); el.disabled = true; }
    grid.appendChild(el);
  }

  $('#prev-month').onclick = () => { currentMonth.setMonth(m-1); renderDateStep(); };
  $('#next-month').onclick = () => { currentMonth.setMonth(m+1); renderDateStep(); };

  // Cargar datos del mes y estado del mes
  const start = ymd(new Date(y, m, 1));
  const end = ymd(new Date(y, m+1, 0));
  const mesId = `${y}-${pad(m+1)}`;

  try {
    const [mesSnap, horSnap, agSnap] = await Promise.all([
      getDoc(doc(db, 'meses', mesId)),
      getDocs(query(collection(db, 'horarios'), where('__name__', '>=', start), where('__name__', '<=', end))),
      getDocs(query(collection(db, 'agenda'), where('__name__', '>=', start), where('__name__', '<=', end)))
    ]);
    
    const mesAbierto = mesSnap.exists() ? mesSnap.data().abierto : true;
    monthData = { horarios: {}, agendas: {}, mesAbierto };
    
    horSnap.forEach(d => monthData.horarios[d.id] = d.data());
    agSnap.forEach(d => monthData.agendas[d.id] = d.data());
  } catch (e) { console.error(e); }

  const now = new Date();
  const todayStr = ymd(now);
  const currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  grid.querySelectorAll('.day').forEach(el => {
    if (el.disabled) return;
    
    // Si el mes está cerrado, bloqueamos todos los días
    if (!monthData.mesAbierto) { el.classList.add('day-closed'); el.disabled = true; return; }

    const dateStr = el.dataset.date;
    const hor = monthData.horarios[dateStr];
    if (!hor || !hor.abierto) { el.classList.add('day-closed'); el.disabled = true; return; }
    
    const slots = hor.slots || [];
    const inactivos = hor.inactivos || [];
    const ocupados = monthData.agendas[dateStr]?.ocupados || [];
    
    // Filtramos las horas ocupadas Y las que tú desactivaste
    const available = slots.filter(s => !ocupados.includes(s) && !inactivos.includes(s) && !(dateStr === todayStr && s <= currentTime));
    
    if (available.length === 0) { el.classList.add('day-full'); el.disabled = true; return; }
    el.classList.add('day-available');
    el.onclick = () => selectDate(dateStr);
  });
}

function selectDate(dateStr) {
  selectedDate = dateStr;
  selectedHora = null;
  renderTimeStep();
}

async function renderTimeStep() {
  $('#step-date').classList.add('hidden');
  $('#step-time').classList.remove('hidden');
  $('#step-form').classList.add('hidden');
  $('#step-done').classList.add('hidden');

  const hor = monthData.horarios[selectedDate];

  $('#step-time').innerHTML = `
    <button class="back-btn" id="back-date">← ${fmtDate(selectedDate)}</button>
    <div id="slots-container"><p class="muted">Cargando…</p></div>
  `;
  $('#back-date').onclick = () => renderDateStep();

  if (unsubAgenda) { unsubAgenda(); unsubAgenda = null; }

  if (!hor || !hor.slots?.length) {
    $('#slots-container').innerHTML = '<p class="muted">Sin horarios este día.</p>';
    return;
  }

  unsubAgenda = onSnapshot(doc(db, 'agenda', selectedDate), (snap) => {
    const ocupados = snap.exists() ? (snap.data().ocupados || []) : [];
    const inactivos = hor.inactivos || [];
    const ubiMap = hor.ubicacionesPorHora || {};
    renderSlots(hor.slots, ocupados, inactivos, ubiMap);
  });
}

function renderSlots(slots, ocupados, inactivos, ubiMap = {}) {
  const container = $('#slots-container');
  const now = new Date();
  const todayStr = ymd(now);
  const currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const grouped = {};
  slots.forEach(s => {
    const loc = ubiMap[s] || 'Consultorio';
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc].push(s);
  });

  let html = '';
  for (const [loc, sList] of Object.entries(grouped)) {
    html += `<div style="margin-top:16px; margin-bottom:8px; font-size:14px; font-weight:500;">📍 ${esc(loc)}</div>`;
    html += `<div class="slots" style="margin-bottom:20px;">`;
    html += sList.map(s => {
      const taken = ocupados.includes(s);
      const off = inactivos.includes(s);
      const past = selectedDate === todayStr && s <= currentTime;
      const dis = taken || past || off;
      return `<button class="slot ${taken ? 'slot-taken' : ''} ${(past || off) ? 'slot-past' : ''}" data-hora="${s}" ${dis ? 'disabled' : ''}>${s} hrs</button>`;
    }).join('');
    html += `</div>`;
  }
  
  container.innerHTML = html;
  container.querySelectorAll('.slot:not([disabled])').forEach(btn => {
    btn.onclick = () => { selectedHora = btn.dataset.hora; renderFormStep(); };
  });
}

// ===== STEP 3: FORMULARIO =====
function renderFormStep() {
  if (unsubAgenda) { unsubAgenda(); unsubAgenda = null; }
  $('#step-time').classList.add('hidden');
  $('#step-form').classList.remove('hidden');

  const saved = JSON.parse(localStorage.getItem('cita_data') || '{}');

  $('#step-form').innerHTML = `
    <button class="back-btn" id="back-time">← ${fmtDate(selectedDate)} · ${selectedHora} hrs</button>
    <div class="form">
      <div class="field">
        <label>Tu nombre *</label>
        <input type="text" id="inp-nombre" autocomplete="name" value="${esc(saved.nombre)}">
      </div>
      <div class="field">
        <label>Teléfono *</label>
        <input type="tel" id="inp-tel" inputmode="tel" autocomplete="tel" value="${esc(saved.telefono || '')}">
      </div>
      <div class="field">
        <label class="muted-label">Edad (opcional)</label>
        <input type="number" id="inp-edad" inputmode="numeric" min="0" max="120" value="${saved.edad || ''}">
      </div>
      <div class="field">
        <label class="muted-label">Motivo (opcional)</label>
        <input type="text" id="inp-motivo" value="${esc(saved.motivo)}">
      </div>
      <button class="primary-btn" id="btn-confirm">Reservar cita</button>
    </div>
  `;
  $('#back-time').onclick = () => renderTimeStep();
  $('#inp-nombre').focus();

  const order = { 'inp-nombre': 'inp-tel', 'inp-tel': 'inp-edad', 'inp-edad': 'inp-motivo', 'inp-motivo': 'btn-confirm' };
  Object.keys(order).forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById(order[id])?.focus(); }
    });
  });

  $('#btn-confirm').onclick = async () => {
    const nombre = $('#inp-nombre').value.trim();
    const telefono = $('#inp-tel').value.trim();
    
    if (!nombre) { showToast('Escribe tu nombre'); $('#inp-nombre').focus(); return; }
    if (!telefono) { showToast('Escribe tu teléfono'); $('#inp-tel').focus(); return; }

    const edad = $('#inp-edad').value ? parseInt($('#inp-edad').value) : null;
    const motivo = $('#inp-motivo').value.trim() || null;
    
    localStorage.setItem('cita_data', JSON.stringify({ nombre, telefono, edad, motivo }));
    await bookAppointment({ nombre, telefono, edad, motivo });
  };
}

async function bookAppointment({ nombre, telefono, edad, motivo }) {
  const btn = $('#btn-confirm');
  btn.disabled = true; btn.textContent = 'Reservando…';

  const citaId = `${selectedDate}_${selectedHora.replace(':', '')}`;
  const citaRef = doc(db, 'citas', citaId);
  const agendaRef = doc(db, 'agenda', selectedDate);
  
  const ubiMap = monthData.horarios[selectedDate]?.ubicacionesPorHora || {};
  const ubi = ubiMap[selectedHora] || '';

  try {
    await runTransaction(db, async (tx) => {
      const agSnap = await tx.get(agendaRef);
      const ocupados = agSnap.exists() ? (agSnap.data().ocupados || []) : [];
      if (ocupados.includes(selectedHora)) throw new Error('SLOT_TAKEN');
      tx.set(agendaRef, { ocupados: [...ocupados, selectedHora] }, { merge: true });
      
      tx.set(citaRef, { nombre, telefono, edad, motivo, fecha: selectedDate, hora: selectedHora, ubicacion: ubi, creadoEn: serverTimestamp() });
    });
    showConfirmation({ id: citaId, nombre, telefono, edad, motivo, fecha: selectedDate, hora: selectedHora, ubicacion: ubi });
  } catch (e) {
    console.error(e);
    if (e.message === 'SLOT_TAKEN') {
      showToast('Ese horario acaba de ser tomado');
      renderTimeStep();
    } else {
      showToast('Error al reservar. Intenta de nuevo.');
      btn.disabled = false; btn.textContent = 'Reservar cita';
    }
  }
}

function showConfirmation(cita) {
  $('#step-form').classList.add('hidden');
  $('#step-done').classList.remove('hidden');
  localStorage.removeItem('cita_data');

  const gcalUrl = googleCalendarUrl(cita, doctor);
  const waUrl = whatsappUrl(cita, doctor);

  $('#step-done').innerHTML = `
    <div class="done">
      <div class="check">✓</div>
      <h2>Cita reservada</h2>
      <div class="summary">
        <div>${esc(cita.nombre)}</div>
        <div class="muted">${fmtDate(cita.fecha)} · ${cita.hora} hrs</div>
        <div class="muted">${esc(doctor.nombre)}</div>
        ${cita.ubicacion ? `<div class="muted" style="margin-top:4px;">📍 ${esc(cita.ubicacion)}</div>` : ''}
      </div>
      <a href="${waUrl}" target="_blank" rel="noopener" class="primary-btn">Enviar por WhatsApp</a>
      <a href="${gcalUrl}" target="_blank" rel="noopener" class="secondary-btn">Agregar al calendario →</a>
    </div>
  `;
}

// ===== HELPERS =====
function whatsappUrl(cita, doc) {
  let msg = `CITA RESERVADA\n\n`;
  msg += `Paciente: ${cita.nombre}\n`;
  msg += `Telefono: ${cita.telefono}\n`;
  msg += `Fecha: ${fmtDate(cita.fecha)}\n`;
  msg += `Hora: ${cita.hora} hrs\n`;
  if (cita.ubicacion) msg += `Ubicacion: ${cita.ubicacion}\n`;
  msg += `Doctor: ${doc.nombre}\n`;
  msg += `ID: ${cita.id.replace('_', '-')}\n\n`;
  msg += `Enviado desde la agenda virtual.`;
  return `https://wa.me/${doc.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
}
function googleCalendarUrl(cita, doc) {
  const [y,m,d] = cita.fecha.split('-').map(Number);
  const [h,min] = cita.hora.split(':').map(Number);
  const start = new Date(y, m-1, d, h, min);
  
  const duracion = doc.duracion || 30;
  const end = new Date(start.getTime() + duracion * 60000);
  
  const f = (dt) => `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Cita con ${doc.nombre}`,
    dates: `${f(start)}/${f(end)}`,
    details: `Reservada vía agenda. Motivo: ${cita.motivo || 'Consulta'}\n(Horario en formato 24h)`,
    location: cita.ubicacion || ''
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}