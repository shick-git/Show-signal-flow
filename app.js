'use strict';
// ═══════════════════════════════════════════════════════════
// VERSION — единственный источник правды: package.json
// В Electron: preload передаёт appVersion через contextBridge
// ═══════════════════════════════════════════════════════════

// ── Drag helper: чистит mousemove даже если отпустить мышь вне окна ──
function startDrag(onMove, onEnd){
  const end = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', end);
    window.removeEventListener('blur', end);
    if(onEnd) onEnd(ev);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', end);
  window.addEventListener('blur', end);
}
const APP_VERSION = (window.electronAPI && window.electronAPI.appVersion)
  ? 'v' + window.electronAPI.appVersion
  : 'v?';

// Проставляем версию в DOM сразу при загрузке скрипта
(function applyVersion(){
  const welcome = document.getElementById('ver-welcome');
  const bar     = document.getElementById('ver-bar');
  if(welcome) welcome.textContent = APP_VERSION;
  if(bar)     bar.textContent = '© Concept Store 2026 \u00a0·\u00a0 ' + APP_VERSION;
  document.title = 'Show Signal Flow — ' + APP_VERSION;
})();

// ═══════════════════════════════════════════════════════════
// DEFAULT DATA
// ═══════════════════════════════════════════════════════════
// UUID-based ID generation: нет счётчика — нет коллизий при merge/ручном редактировании
// Формат: n + первые 8 hex-символов UUID → достаточно уникален, читаем в .ssfp
const uid = () => 'n' + crypto.randomUUID().split('-')[0];

// ─── DOM кеши: listeners создаются один раз, не при каждом rNodes/rEdges ──
const _ngCache = new Map(); // nodeId  → <g> элемент
const _egCache = new Map(); // edgeId  → {g, hit}
const _ntCache = new Map(); // noteId  → <g> элемент (P4)
const _zcCache = new Map(); // zoneId  → <g> элемент (P4)

const DN = [
  {id:'notebook', x:60,   y:230, w:155,h:50, title:'NOTEBOOK',          sub1:'Reaper · Timecode Source', sub2:'',                      style:'normal',   deviceType:'timecode',      tcSource:'Reaper',  tcOut:true,  tc:false},
  {id:'broadcast',x:380,  y:100, w:180,h:50, title:'Online Broadcast',  sub1:'Карта захвата HDMI/SDI',   sub2:'',                      style:'output',   deviceType:'broadcast',     broadcastType:'Захват',tc:false},
  {id:'td_led',   x:60,   y:420, w:175,h:58, title:'TouchDesigner',     sub1:'LED Controller',           sub2:'Пресеты → ленты',       style:'highlight',deviceType:'touchdesigner', tc:true },
  {id:'res1',     x:380,  y:310, w:175,h:58, title:'Resolume #1',       sub1:'VJ Server',                sub2:'Clip Playback',          style:'normal',   deviceType:'video-server',  videoSoftware:'Resolume Arena', tc:true },
  {id:'gma2',     x:720,  y:310, w:175,h:58, title:'grandMA2',          sub1:'Lighting Console',         sub2:'Автономно по TC ▶',     style:'highlight',deviceType:'light-console', tc:true },
  {id:'res2',     x:1060, y:310, w:175,h:58, title:'Resolume #2',       sub1:'VJ Server',                sub2:'LED Wall Output',        style:'normal',   deviceType:'video-server',  videoSoftware:'Resolume Arena', tc:true },
  {id:'td_osc',   x:1400, y:190, w:195,h:66, title:'TouchDesigner OSC', sub1:'Main Show Controller',     sub2:'Клипы + пресеты по TC',  style:'highlight',deviceType:'touchdesigner', tc:true },
  {id:'proc1',    x:380,  y:510, w:175,h:50, title:'LED Processor #1',  sub1:'Scaling / Mapping',        sub2:'',                      style:'normal',   deviceType:'led-processor', novaModel:'MCTRL4K', outputs:4, tc:false},
  {id:'proc2',    x:1060, y:510, w:175,h:50, title:'LED Processor #2',  sub1:'Scaling / Mapping',        sub2:'',                      style:'normal',   deviceType:'led-processor', novaModel:'MCTRL4K', outputs:4, tc:false},
  {id:'out_led',  x:60,   y:630, w:175,h:50, title:'LED Strips',        sub1:'Ленты, кастомные объекты', sub2:'',                      style:'output',   tc:false},
  {id:'out_scr1', x:380,  y:700, w:175,h:50, title:'LED Screens #1',    sub1:'Основные экраны сцены',    sub2:'',                      style:'output',   tc:false},
  {id:'out_light',x:720,  y:630, w:175,h:50, title:'LIGHT',             sub1:'Все световые приборы',     sub2:'',                      style:'output',   tc:false},
  {id:'out_scr2', x:1060, y:700, w:175,h:50, title:'Many LED Screens',  sub1:'Зал, периметр, LED-фермы', sub2:'',                      style:'output',   tc:false},
];

const DE = [
  {id:'e_bc',  from:'broadcast',to:'res1',     label:'HDMI/SDI',        style:'solid',  wp:[]},
  {id:'e_o1',  from:'td_osc',   to:'res1',     label:'OSC clip',        style:'dashed', wp:[]},
  {id:'e_o2',  from:'td_osc',   to:'res2',     label:'OSC clip',        style:'dashed', wp:[]},
  {id:'e_o3',  from:'td_osc',   to:'td_led',   label:'OSC preset',      style:'dashed', wp:[]},
  {id:'e_m1',  from:'td_led',   to:'out_led',  label:'DMX / SPI',       style:'solid',  wp:[]},
  {id:'e_m2',  from:'res1',     to:'proc1',    label:'Fiber / SFP',     style:'solid',  wp:[]},
  {id:'e_m3',  from:'gma2',     to:'out_light',label:'DMX512',          style:'solid',  wp:[]},
  {id:'e_m4',  from:'res2',     to:'proc2',    label:'Fiber / SFP',     style:'solid',  wp:[]},
  {id:'e_m5',  from:'proc1',    to:'out_scr1', label:'Cat6 / Ethernet', style:'solid',  wp:[]},
  {id:'e_m6',  from:'proc2',    to:'out_scr2', label:'Cat6 / Ethernet', style:'solid',  wp:[]},
];

const DTC_BUS = {id:'tc1', y:148, x1:30, x2:1900, label:'LTC / MTC', color:'#555', visible:true};

let nodes = deep(DN);
let edges = deep(DE);
let tcBuses = [{...DTC_BUS}];
let customDeviceTypes = []; // [{id:'cdt-xxx', label:'Мой тип', color:'#aabbcc'}]
let _dropEdge = null; // edge under dragged node (для вставки в разрыв)
let _dropTC    = null; // bus.id | null — нода над TC шиной (для авто-подключения)
let _dropTCTap = null;  // нода над вертикальным TC tap (вставка в разрыв TC)

// clipboard
let clipboard = [], pasteOffset = 0;

// search
let searchMatches = [], searchIdx = -1;

// sticky notes
let notes = [];

// visual zones
let zones = [];

// snap to grid
let snapToGrid = false;
const GRID = 24;

// ── HINT BAR ─────────────────────────────────────────────
function updateHintBar(){
  const info = document.getElementById('hb-info');
  if(!info) return;
  const selCount = selectedIds ? selectedIds.size : 0;
  const zoomPct = vb ? Math.round(vb.z * 100) : 100;
  const parts = [];
  if(selCount > 0){
    const label = selCount === 1 ? 'нода' : selCount < 5 ? 'ноды' : 'нод';
    parts.push(`Выбрано: ${selCount} ${label}`);
  }
  parts.push(`Зум: ${zoomPct}%`);
  info.textContent = parts.join(' · ');
}

// undo/redo stacks
const undoStack = [], redoStack = [];
const undoLabels = [], redoLabels = [];
const MAX_UNDO = 40;

function snapshot(label='') {
  undoStack.push(JSON.stringify({nodes,edges,tcBuses,notes,zones,customDeviceTypes}));
  undoLabels.push(label || 'Изменение');
  if (undoStack.length > MAX_UNDO) { undoStack.shift(); undoLabels.shift(); }
  redoStack.length = 0; redoLabels.length = 0;
  rHistory();
}
function _restoreTCBuses(s){
  if(s.tcBuses) tcBuses=s.tcBuses;
  else if(s.tc){
    // backward compat: old format had single tc + tcVisible
    tcBuses=[{...DTC_BUS,...s.tc,visible:s.tcVisible!==false}];
  }
  const btn=document.getElementById('btn-tc');
  if(btn) btn.classList.toggle('active', tcBuses.some(b=>b.visible));
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify({nodes,edges,tcBuses,notes,zones,customDeviceTypes}));
  redoLabels.push(undoLabels[undoLabels.length-1]);
  const s = JSON.parse(undoStack.pop()); undoLabels.pop();
  nodes=s.nodes; edges=s.edges; _restoreTCBuses(s);
  if(s.notes) notes=s.notes; else notes=[];
  if(s.zones) zones=s.zones; else zones=[];
  if(s.customDeviceTypes) customDeviceTypes=s.customDeviceTypes; else customDeviceTypes=[];
  rebuildDevTypeSelects();
  rAll(); rHistory();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify({nodes,edges,tcBuses,notes,zones,customDeviceTypes}));
  undoLabels.push(redoLabels[redoLabels.length-1]);
  const s = JSON.parse(redoStack.pop()); redoLabels.pop();
  nodes=s.nodes; edges=s.edges; _restoreTCBuses(s);
  if(s.notes) notes=s.notes; else notes=[];
  if(s.zones) zones=s.zones; else zones=[];
  if(s.customDeviceTypes) customDeviceTypes=s.customDeviceTypes; else customDeviceTypes=[];
  rebuildDevTypeSelects();
  rAll(); rHistory();
}

function deep(x){ return JSON.parse(JSON.stringify(x)); }
function nb(id){ return nodes.find(n=>n.id===id); }
function cx(n){ return n.x+n.w/2; }
function cy(n){ return n.y+n.h/2; }

// ═══════════════════════════════════════════════════════════
// PAN + ZOOM STATE — объявляем ДО всех функций
// ═══════════════════════════════════════════════════════════
const vb = { x:0, y:0, z:1 };
const ZOOM_MIN=0.1, ZOOM_MAX=4, ZOOM_STEP=0.12;

// ═══════════════════════════════════════════════════════════
// SVG HELPERS
// ═══════════════════════════════════════════════════════════
const SVG_NS = 'http://www.w3.org/2000/svg';
const mk  = t => document.createElementNS(SVG_NS,t);
const sa  = (el,a) => { Object.entries(a).forEach(([k,v])=>el.setAttribute(k,v)); return el; };
const svg = document.getElementById('diagram');
const ZL  = document.getElementById('zl');
const EL  = document.getElementById('el');
const TL  = document.getElementById('tl');
const XL  = document.getElementById('xl');
const NL  = document.getElementById('nl');
const GL  = document.getElementById('gl');
const snap = v => snapToGrid ? Math.round(v/GRID)*GRID : v;

// ═══════════════════════════════════════════════════════════
// BORDER POINT (finds edge-of-rect toward target)
// ═══════════════════════════════════════════════════════════
function bpt(n,tx,ty){
  const h=nodeH(n);
  const ox=n.x+n.w/2, oy=n.y+h/2, hw=n.w/2, hh=h/2;
  const dx=tx-ox,dy=ty-oy;
  if(!dx&&!dy) return {x:ox,y:oy};
  const s=Math.min(dx?hw/Math.abs(dx):1e9, dy?hh/Math.abs(dy):1e9);
  return {x:ox+dx*s,y:oy+dy*s};
}
// Returns absolute SVG point from stored relative anchor {rx,ry} in [0..1]
function getAnchorPt(n, anchor){
  if(!anchor) return null;
  const h=nodeH(n);
  return {x:n.x+anchor.rx*n.w, y:n.y+anchor.ry*h};
}
// Projects anchor click direction to node BOUNDARY (so arrowhead stays visible)
// fallbackTx/Ty = coords of other node center (used if anchor is exactly center)
function anchorBoundaryPt(n, anchor, fallbackTx, fallbackTy){
  if(!anchor) return bpt(n, fallbackTx, fallbackTy);
  const h=nodeH(n);
  const ocx=n.x+n.w/2, ocy=n.y+h/2;
  const ax=n.x+anchor.rx*n.w, ay=n.y+anchor.ry*h;
  const dx=ax-ocx, dy=ay-ocy;
  // if clicked near center — fall back to direction toward other node
  if(Math.abs(dx)<1 && Math.abs(dy)<1) return bpt(n, fallbackTx, fallbackTy);
  // extend direction beyond anchor to find boundary exit point
  return bpt(n, ocx+dx*10000, ocy+dy*10000);
}

// ═══════════════════════════════════════════════════════════
// TC BUS TOGGLE
// ═══════════════════════════════════════════════════════════
function toggleTC(){
  snapshot('TC Bus');
  // toggles ALL buses visibility at once (show all / hide all)
  const anyVisible = tcBuses.some(b=>b.visible);
  tcBuses.forEach(b=>{ b.visible = !anyVisible; });
  const btn = document.getElementById('btn-tc');
  if(btn) btn.classList.toggle('active', !anyVisible);
  rTC();
}

function addTCBus(){
  snapshot('Добавить TC шину');
  const colors=['#555','#4a9eff','#ff9900','#cc4444','#22aa66','#aa66cc'];
  tcBuses.push({
    id:'tc'+uid(),
    y: tcBuses[tcBuses.length-1].y + 120,
    x1:30, x2:1900,
    label:'TC Bus '+(tcBuses.length+1),
    color: colors[tcBuses.length % colors.length],
    visible:true
  });
  rTC();
}

let EN_tcBus = null;
function openTCBusEditor(bus, ev){
  EN_tcBus = bus;
  document.getElementById('tcb-label').value = bus.label||'';
  const colSel = document.getElementById('tcb-color');
  colSel.value = bus.color||'#555';
  if([...colSel.options].every(o=>o.value!==bus.color)) colSel.value='#555';
  sp('tcbed', ev||{clientX:400,clientY:200});
  setTimeout(()=>document.getElementById('tcb-label').focus(),30);
}
function saveTCBus(){
  if(!EN_tcBus) return;
  snapshot('Изменить TC шину');
  EN_tcBus.label = document.getElementById('tcb-label').value;
  EN_tcBus.color = document.getElementById('tcb-color').value;
  cp('tcbed'); EN_tcBus=null; rTC();
}
function deleteTCBus(){
  if(!EN_tcBus) return;
  if(tcBuses.length<=1){ alert('Нельзя удалить единственную шину'); return; }
  snapshot('Удалить TC шину');
  tcBuses = tcBuses.filter(b=>b.id!==EN_tcBus.id);
  cp('tcbed'); EN_tcBus=null; rTC();
}

// ── CUSTOM DEVICE TYPES ───────────────────────────────────
let _editingCDT = null; // id being edited, or null for new

function openCustomTypes(){
  _editingCDT = null;
  document.getElementById('cdt-id').value = '';
  document.getElementById('cdt-label').value = '';
  document.getElementById('cdt-color').value = '#4a9eff';
  _renderCDTList();
  sp('ctyed');
}

function _renderCDTList(){
  const ul = document.getElementById('cdt-list');
  if(!ul) return;
  ul.innerHTML = '';
  customDeviceTypes.forEach(c=>{
    const li = document.createElement('li');
    li.className = 'cdt-item';
    li.innerHTML = `<span class="cdt-swatch" style="background:${c.color}"></span>
      <span class="cdt-name">${c.label}</span>
      <button onclick="editCDT('${c.id}')" title="Изменить">✏</button>
      <button onclick="deleteCDT('${c.id}')" title="Удалить">✕</button>`;
    ul.appendChild(li);
  });
  if(!customDeviceTypes.length){
    ul.innerHTML = '<li class="cdt-empty">Нет кастомных типов</li>';
  }
}

function editCDT(id){
  const c = customDeviceTypes.find(x=>x.id===id);
  if(!c) return;
  _editingCDT = id;
  document.getElementById('cdt-id').value = id;
  document.getElementById('cdt-label').value = c.label;
  document.getElementById('cdt-color').value = c.color;
}

function saveCDT(){
  const label = document.getElementById('cdt-label').value.trim();
  if(!label){ alert('Введите название типа'); return; }
  const color = document.getElementById('cdt-color').value || '#888888';
  snapshot('Кастомный тип');
  if(_editingCDT){
    const c = customDeviceTypes.find(x=>x.id===_editingCDT);
    if(c){ c.label=label; c.color=color; }
  } else {
    const id = 'cdt-'+uid();
    customDeviceTypes.push({id, label, color});
  }
  _editingCDT = null;
  document.getElementById('cdt-id').value = '';
  document.getElementById('cdt-label').value = '';
  document.getElementById('cdt-color').value = '#4a9eff';
  rebuildDevTypeSelects();
  _renderCDTList();
  rAll();
}

function deleteCDT(id){
  snapshot('Удалить тип');
  customDeviceTypes = customDeviceTypes.filter(c=>c.id!==id);
  if(_editingCDT===id){
    _editingCDT=null;
    document.getElementById('cdt-id').value='';
    document.getElementById('cdt-label').value='';
    document.getElementById('cdt-color').value='#4a9eff';
  }
  rebuildDevTypeSelects();
  _renderCDTList();
  rAll();
}

function rebuildDevTypeSelects(){
  ['ne-devtype','ae-devtype'].forEach(selId=>{
    const sel = document.getElementById(selId);
    if(!sel) return;
    // remove previously injected custom options
    sel.querySelectorAll('option[data-custom]').forEach(o=>o.remove());
    // also remove divider if present
    const divider = sel.querySelector('option[data-custom-divider]');
    if(divider) divider.remove();
    if(customDeviceTypes.length){
      const div = document.createElement('option');
      div.disabled = true;
      div.dataset.customDivider = '1';
      div.textContent = '── Кастомные ──';
      sel.appendChild(div);
      customDeviceTypes.forEach(c=>{
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.label;
        opt.dataset.custom = '1';
        sel.appendChild(opt);
      });
    }
  });
}

// ── DARK THEME ────────────────────────────────────────────
let darkTheme = false;
function toggleDarkTheme(){
  darkTheme = !darkTheme;
  document.body.classList.toggle('dark-theme', darkTheme);
  const btn=document.getElementById('btn-theme');
  if(btn) btn.classList.toggle('active', darkTheme);
  try{ localStorage.setItem('ssf_dark', darkTheme?'1':'0'); }catch(e){}
}
// Restore theme on load
try{ if(localStorage.getItem('ssf_dark')==='1'){ darkTheme=true; document.body.classList.add('dark-theme'); const b=document.getElementById('btn-theme'); if(b) b.classList.add('active'); } }catch(e){}

function toggleSnap(){
  snapToGrid = !snapToGrid;
  const btn=document.getElementById('btn-snap');
  if(btn) btn.classList.toggle('active', snapToGrid);
}

// ═══════════════════════════════════════════════════════════
// TEXT WRAP — splits text into lines fitting maxW
// ═══════════════════════════════════════════════════════════
function wrapText(text, maxW, fontSize) {
  if (!text) return [];
  const approxCharW = fontSize * 0.6;
  const charsPerLine = Math.floor(maxW / approxCharW);
  if (text.length <= charsPerLine) return [text];
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  words.forEach(w => {
    const test = cur ? cur+' '+w : w;
    if (test.length <= charsPerLine) { cur = test; }
    else { if(cur) lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  return lines;
}

// ═══════════════════════════════════════════════════════════
// RENDER TC BUS
// ═══════════════════════════════════════════════════════════
function rTC(){
  TL.innerHTML='';
  tcBuses.forEach(bus=>{
    if(!bus.visible) return;
    const isDropBus = _dropTC && _dropTC===bus.id;
    const col = bus.color||'#555';

    const rail=sa(mk('line'),{x1:bus.x1,y1:bus.y,x2:bus.x2,y2:bus.y,
      class:'tc-rail'+(isDropBus?' tc-drop':''),
      stroke:col,'stroke-width':'2','stroke-dasharray':'10,5'});
    TL.appendChild(rail);

    const lbl=sa(mk('text'),{x:bus.x1+10,y:bus.y-10,class:'tc-rail-lbl',fill:col});
    lbl.textContent=isDropBus
      ? '⬇ ОТПУСТИ — подключить к TC BUS ⬇'
      : '— — — '+(bus.label||'TIMECODE BUS')+' — — —';
    TL.appendChild(lbl);

    // dblclick label to edit this bus
    lbl.style.cursor='pointer';
    lbl.addEventListener('dblclick',ev=>{ ev.stopPropagation(); openTCBusEditor(bus,ev); });

    // drag strip
    const dh=sa(mk('rect'),{x:bus.x1,y:bus.y-9,width:bus.x2-bus.x1,height:18,fill:'transparent',class:'tc-drag'});
    dh.addEventListener('mousedown',ev=>{
      ev.stopPropagation();
      const sy0=ev.clientY, sty=bus.y; let tcM=false;
      const mm=e=>{
        if(!tcM){ snapshot('TC Bus'); tcM=true; }
        bus.y=Math.max(20, sty+(e.clientY-sy0)/vb.z); rTC();
      };
      startDrag(mm);
    });
    TL.appendChild(dh);

    // TC OUT nodes: arrow FROM node (or zone bar) TOP up to bus
    const tcOutSeen=new Set();
    nodes.filter(n=>n.tcOut&&(n.tcBusId===bus.id||(bus===tcBuses[0]&&!n.tcBusId))).forEach(n=>{
      const z=collapsedZoneOf(n);
      const nx = z ? z.x+z.w/2 : cx(n);
      const ny = z ? z.y : n.y;
      if(z){ if(tcOutSeen.has(z)) return; tcOutSeen.add(z); }
      if(bus.y>=ny-3) return;
      TL.appendChild(sa(mk('line'),{x1:nx,y1:ny,x2:nx,y2:bus.y,stroke:'#333','stroke-width':'1.5','stroke-dasharray':'4,3'}));
      TL.appendChild(sa(mk('polygon'),{points:`${nx-4},${bus.y+7} ${nx+4},${bus.y+7} ${nx},${bus.y}`,fill:col}));
      const sl=sa(mk('text'),{x:nx+5,y:(ny+bus.y)/2,class:'tc-lbl',fill:col}); sl.textContent='TC out'; TL.appendChild(sl);
    });

    // TC IN nodes: arrow FROM bus DOWN to node (or zone bar)
    const tcInSeen=new Set();
    nodes.filter(n=>n.tc&&(n.tcBusId===bus.id||(bus===tcBuses[0]&&!n.tcBusId))).forEach(n=>{
      const z=collapsedZoneOf(n);
      const nx = z ? z.x+z.w/2 : cx(n);
      const ny = z ? z.y : n.y;
      if(z){ if(tcInSeen.has(z)) return; tcInSeen.add(z); }
      if(bus.y>=ny-3) return;
      const isTarget = !z && _dropTCTap && _dropTCTap.id===n.id;
      TL.appendChild(sa(mk('line'),{x1:nx,y1:bus.y,x2:nx,y2:ny,
        class:'tc-tap'+(isTarget?' tc-drop':''),'marker-end':'url(#arr-sm)'}));
      const tl=sa(mk('text'),{x:nx+5,y:(bus.y+ny)/2,class:'tc-lbl',fill:col});
      tl.textContent=isTarget?'⬅ вставить':'TC'; TL.appendChild(tl);
    });
  });
}

// ═══════════════════════════════════════════════════════════
// RENDER EDGES
// ═══════════════════════════════════════════════════════════
// возвращает свёрнутую зону в которой находится нода, или null
function collapsedZoneOf(n){
  return zones.find(z=>z.collapsed&&nodeInZone(n,z))||null;
}
// «виртуальная нода» для центра полосы свёрнутой зоны
function zoneBar(z){ return {x:z.x,y:z.y,w:z.w,h:26}; }

// Быстрое обновление одного ребра во время drag waypoint — не перестраивает весь EL
function rEdgeFast(e){
  const cached=_egCache.get(e.id); if(!cached) return;
  const fn=nb(e.from),tn=nb(e.to); if(!fn||!tn) return;
  const fz=collapsedZoneOf(fn),tz=collapsedZoneOf(tn);
  const effFn=fz?zoneBar(fz):fn, effTn=tz?zoneBar(tz):tn;
  const useWP=!fz&&!tz?e.wp:[];
  const tnCx=effTn.x+effTn.w/2,tnCy=effTn.y+effTn.h/2;
  const fnCx=effFn.x+effFn.w/2,fnCy=effFn.y+effFn.h/2;
  const p1=useWP.length?bpt(effFn,useWP[0].x,useWP[0].y):bpt(effFn,tnCx,tnCy);
  const p2=useWP.length?bpt(effTn,useWP[useWP.length-1].x,useWP[useWP.length-1].y):bpt(effTn,fnCx,fnCy);
  const chain=[p1,...useWP.map(p=>({...p})),p2];
  const pts=chain.map(p=>p.x+','+p.y).join(' ');
  const {g,hit}=cached;
  const poly=g.querySelector('polyline:not(.edge-hit)');
  if(poly) sa(poly,{points:pts});
  sa(hit,{points:pts});
  const circles=g.querySelectorAll('.waypoint');
  e.wp.forEach((wp,i)=>{ if(circles[i]) sa(circles[i],{cx:wp.x,cy:wp.y}); });
}

function rEdges(){
  const seen=new Set();
  edges.forEach(e=>{
    const fn=nb(e.from),tn=nb(e.to); if(!fn||!tn) return;
    if(!e.wp) e.wp=[];
    seen.add(e.id);

    const fz=collapsedZoneOf(fn);
    const tz=collapsedZoneOf(tn);

    // оба конца в одной свёрнутой зоне — скрываем
    if(fz&&tz&&fz===tz){ seen.delete(e.id); return; }

    // подменяем ноду на зону-бар если нода свёрнута
    const effFn = fz ? zoneBar(fz) : fn;
    const effTn = tz ? zoneBar(tz) : tn;

    // build point chain (waypoints игнорируем если концы перенаправлены на зону)
    const useWP = !fz && !tz ? e.wp : [];
    const tnCx=effTn.x+effTn.w/2, tnCy=effTn.y+effTn.h/2;
    const fnCx=effFn.x+effFn.w/2, fnCy=effFn.y+effFn.h/2;
    const p1 = useWP.length ? bpt(effFn,useWP[0].x,useWP[0].y) : bpt(effFn,tnCx,tnCy);
    const p2 = useWP.length ? bpt(effTn,useWP[useWP.length-1].x,useWP[useWP.length-1].y) : bpt(effTn,fnCx,fnCy);
    const chain=[p1,...useWP.map(p=>({...p})),p2];
    const pts=chain.map(p=>p.x+','+p.y).join(' ');

    // ── кеш: g и hit создаются один раз, listeners не пересоздаются ──
    let cached=_egCache.get(e.id);
    if(!cached){
      const g=mk('g');
      const hit=sa(mk('polyline'),{class:'edge-hit'});
      hit.addEventListener('click',ev=>{ev.stopPropagation(); openEE(e,ev);});
      hit.addEventListener('dblclick',ev=>{
        ev.stopPropagation(); snapshot('Точка маршрута');
        const pt=svgCoords(ev); e.wp.push({x:pt.x,y:pt.y}); rEdges();
      });
      cached={g,hit};
      hit.dataset.eid=e.id;
      _egCache.set(e.id,cached);
    }
    const {g,hit}=cached;

    // пересобираем визуальные дочерние элементы (listeners на g/hit сохранены)
    g.innerHTML='';

    g.appendChild(sa(mk('polyline'),{
      points:pts, class:'edge'+(e.style==='dashed'?' dashed':'')+(e===_dropEdge?' edge-drop':''),
      'marker-end':'url(#arr)', fill:'none'
    }));

    // label
    const mid=chain[Math.floor(chain.length/2)];
    const prev=chain[Math.floor(chain.length/2)-1]||chain[0];
    const lx=(mid.x+prev.x)/2, ly=(mid.y+prev.y)/2;
    if(e.label){
      const lw=e.label.length*5.5+10;
      g.appendChild(sa(mk('rect'),{x:lx-lw/2,y:ly-7,width:lw,height:13,class:'edge-lbl-bg'}));
      const lt=sa(mk('text'),{x:lx,y:ly,class:'edge-lbl'}); lt.textContent=e.label; g.appendChild(lt);
    }

    // hit area — обновляем points и добавляем обратно (listeners сохранены)
    sa(hit,{points:pts}); g.appendChild(hit);

    // waypoint handles (пересоздаются — их количество может меняться)
    e.wp.forEach((wp,wi)=>{
      const wh=sa(mk('circle'),{cx:wp.x,cy:wp.y,r:5,class:'waypoint'});
      wh.addEventListener('mousedown',ev=>{
        ev.stopPropagation();
        const sx=ev.clientX,sy=ev.clientY,ox=wp.x,oy=wp.y;
        let wpMoved=false;
        const mm=e2=>{
          const d=svgDelta(e2.clientX-sx,e2.clientY-sy);
          if(!wpMoved){ snapshot('Точка маршрута'); wpMoved=true; }
          wp.x=ox+d.dx; wp.y=oy+d.dy; rEdgeFast(e);
        };
        startDrag(mm, ()=>rEdges());
      });
      wh.addEventListener('dblclick',ev=>{
        ev.stopPropagation(); snapshot('Удалить точку');
        e.wp.splice(wi,1); rEdges();
      });
      g.appendChild(wh);
    });

    EL.appendChild(g);
  });

  // удаляем группы удалённых рёбер
  for(const [id,{g}] of _egCache){
    if(!seen.has(id)){ g.remove(); _egCache.delete(id); }
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER NODES
// ═══════════════════════════════════════════════════════════
function rNodes(){
  const seen=new Set();
  nodes.forEach(n=>{
    seen.add(n.id);
    // P2: берём из кеша — wrapText не пересчитывается если текст/ширина не изменились
    const {t:titleLines, s1:sub1Lines, s2:sub2Lines} = getCachedWrap(n);
    const LH=14, PAD=10;
    const totalLines = titleLines.length + sub1Lines.length + sub2Lines.length;
    const autoH = Math.max(n.h, totalLines*LH + PAD*2);

    // ── кеш: g создаётся один раз, listeners не пересоздаются ──
    let g=_ngCache.get(n.id);
    if(!g){
      g=mk('g'); g.setAttribute('class','node-group'); g.dataset.id=n.id;
      // persistent listeners — навешиваются ОДИН раз
      dragNode(g); // ищет ноду по g.dataset.id внутри mousedown
      g.addEventListener('dblclick',ev=>{
        ev.stopPropagation();
        const cur=nb(g.dataset.id); if(cur&&mode!=='connect') openQE(cur,ev);
      });
      g.addEventListener('click',ev=>{
        if(mode==='connect'){ ev.stopPropagation(); return; }
        ev.stopPropagation();
        selectNode(g.dataset.id, ev.shiftKey||ev.ctrlKey||ev.metaKey);
      });
      _ngCache.set(n.id,g);
    }

    // пересобираем визуальные дочерние элементы (listeners на g сохранены)
    g.innerHTML='';

    g.appendChild(sa(mk('rect'),{
      x:n.x,y:n.y,width:n.w,height:autoH,rx:3,
      class:'node-rect'+(n.style==='output'?' output':n.style==='highlight'?' highlight':n.style==='audio'?' audio':'')
    }));

    // цветная полоса типа устройства (3px сверху)
    const dtColor = getDevtypeColor(n.deviceType);
    if(dtColor){
      g.appendChild(sa(mk('rect'),{x:n.x,y:n.y,width:n.w,height:3,rx:2,fill:dtColor,'pointer-events':'none'}));
    }
    // бейдж количества выходов
    if(n.outputs){
      const bx=n.x+n.w-10, by=n.y+10, br=9;
      g.appendChild(sa(mk('circle'),{cx:bx,cy:by,r:br,fill:dtColor||'#666','pointer-events':'none'}));
      const bt=sa(mk('text'),{x:bx,y:by,'font-family':'Arial,sans-serif','font-size':'8','font-weight':'bold',fill:'#fff','text-anchor':'middle','dominant-baseline':'middle','pointer-events':'none'});
      bt.textContent=n.outputs; g.appendChild(bt);
    }

    // render text lines
    let curY = n.y + PAD + LH/2;
    const renderLines = (lines, cls) => {
      lines.forEach(l=>{
        const t=sa(mk('text'),{x:n.x+n.w/2,y:curY,class:cls}); t.textContent=l; g.appendChild(t);
        curY+=LH;
      });
    };
    renderLines(titleLines,'node-title');
    renderLines(sub1Lines,'node-sub');
    renderLines(sub2Lines,'node-sub');

    // resize handle — пересоздаётся (autoH может меняться), listener на новом элементе
    const rh=sa(mk('rect'),{
      x:n.x+n.w-8,y:n.y+autoH-8,width:8,height:8,rx:1,class:'resize-handle'
    });
    rh.addEventListener('mousedown',ev=>{
      ev.stopPropagation();
      const sx=ev.clientX,sy=ev.clientY,ow=n.w,oh=autoH;
      let rhMoved=false;
      const mm=e2=>{
        const d=svgDelta(e2.clientX-sx,e2.clientY-sy);
        if(!rhMoved){ snapshot('Размер ноды'); rhMoved=true; }
        n.w=Math.max(100,ow+d.dx);
        n.h=Math.max(40,oh+d.dy);
        rAll();
      };
      startDrag(mm, ()=>{ if(rhMoved) rAll(); });
    });
    g.appendChild(rh);

    // скрываем ноду если она внутри свёрнутой зоны
    const inCollapsed = zones.some(z => z.collapsed && nodeInZone(n, z));
    if(inCollapsed){
      g.remove(); // убираем из DOM если была видна
    } else {
      NL.appendChild(g);
    }
  });

  // удаляем группы удалённых нод
  for(const [id,g] of _ngCache){
    if(!seen.has(id)){ g.remove(); _ngCache.delete(id); }
  }
  updateHintBar();
}

// ═══════════════════════════════════════════════════════════
// RENDER NOTES
// ═══════════════════════════════════════════════════════════
function rNotes(){
  // P4: удаляем <g> удалённых заметок
  for(const [id,g] of _ntCache){
    if(!notes.find(n=>n.id===id)){ _ntCache.delete(id); g.remove(); }
  }
  notes.forEach(note=>{
    let g=_ntCache.get(note.id);
    if(!g){
      // Создаём <g> и привязываем listeners ОДИН РАЗ
      g=mk('g'); g.setAttribute('class','note-group'); g.dataset.xid=note.id;
      let moved=false;
      g.addEventListener('mousedown',ev=>{
        if(ev.button||mode==='connect') return;
        ev.stopPropagation(); ev.preventDefault();
        const sx=ev.clientX,sy=ev.clientY,ox=note.x,oy=note.y; moved=false;
        const mm=e=>{
          const d=svgDelta(e.clientX-sx,e.clientY-sy);
          if(Math.abs(d.dx)>2||Math.abs(d.dy)>2){
            if(!moved){snapshot('Переместить заметку');moved=true;}
            note.x=snap(Math.max(0,ox+d.dx));
            note.y=snap(Math.max(0,oy+d.dy));
            rNotes();
          }
        };
        startDrag(mm);
      });
      g.addEventListener('dblclick',ev=>{ev.stopPropagation(); openNoteEditor(note,ev);});
      _ntCache.set(note.id, g);
    }
    // Перестраиваем визуальные дочерние элементы
    while(g.firstChild) g.removeChild(g.firstChild);
    const PAD=8, LH=15;
    const lines=wrapText(note.text||'', note.w-PAD*2, 11);
    const minH=Math.max(note.h, lines.length*LH+PAD*2+4);
    g.appendChild(sa(mk('rect'),{
      x:note.x, y:note.y, width:note.w, height:minH, rx:4,
      fill:note.color||'#fffbe6', class:'note-rect'
    }));
    let curY=note.y+PAD+LH/2;
    lines.forEach(l=>{
      const t=sa(mk('text'),{x:note.x+PAD, y:curY, class:'note-text', 'dominant-baseline':'middle'});
      t.textContent=l; g.appendChild(t); curY+=LH;
    });
    // resize handle (listener пересоздаётся, т.к. захватывает minH)
    const rh=sa(mk('rect'),{
      x:note.x+note.w-8, y:note.y+minH-8, width:8, height:8, rx:1,
      class:'note-resize'
    });
    rh.addEventListener('mousedown',ev=>{
      ev.stopPropagation();
      const sx=ev.clientX,sy=ev.clientY,ow=note.w,oh=minH;
      let nrMoved=false;
      const mm=e=>{
        const d=svgDelta(e.clientX-sx,e.clientY-sy);
        if(!nrMoved){ snapshot('Размер заметки'); nrMoved=true; }
        note.w=Math.max(80,ow+d.dx);
        note.h=Math.max(40,oh+d.dy);
        rNotes();
      };
      startDrag(mm, ()=>{ if(nrMoved) rNotes(); });
    });
    g.appendChild(rh);
    XL.appendChild(g); // re-append для корректного DOM-порядка
  });
}

function rAll(){ rZones(); rEdges(); rTC(); rNotes(); rNodes(); if(searchMatches.length) applySearchHL(); rMinimap(); rHistory(); }

// ═══════════════════════════════════════════════════════════
// VISUAL ZONES
// ═══════════════════════════════════════════════════════════
let EN_zone = null;

function rZones(){
  // P4: удаляем <g> удалённых зон
  for(const [id,g] of _zcCache){
    if(!zones.find(z=>z.id===id)){ _zcCache.delete(id); g.remove(); }
  }
  zones.forEach(z=>{
    let g=_zcCache.get(z.id);
    if(!g){
      // Создаём <g> и привязываем listeners ОДИН РАЗ
      g=mk('g'); g.setAttribute('class','zone-group');
      let zmoved=false;
      g.addEventListener('mousedown',ev=>{
        if(ev.button||mode==='connect') return;
        ev.stopPropagation();
        const sx=ev.clientX,sy=ev.clientY,ox=z.x,oy=z.y; zmoved=false;
        const innerNodes=nodes
          .filter(n=>!z.collapsed&&cx(n)>=z.x&&cx(n)<=z.x+z.w&&cy(n)>=z.y&&cy(n)<=z.y+z.h)
          .map(n=>({n,ox:n.x,oy:n.y}));
        const mm=e=>{
          const d=svgDelta(e.clientX-sx,e.clientY-sy);
          if(Math.abs(d.dx)>2||Math.abs(d.dy)>2){
            if(!zmoved){ snapshot('Переместить зону'); zmoved=true; }
            z.x=snap(Math.max(0,ox+d.dx));
            z.y=snap(Math.max(0,oy+d.dy));
            innerNodes.forEach(({n,ox:nx,oy:ny})=>{
              n.x=snap(Math.max(0,nx+d.dx));
              n.y=snap(Math.max(0,ny+d.dy));
            });
            rZones(); rEdges(); rTC(); rNodes();
          }
        };
        startDrag(mm);
      });
      g.addEventListener('dblclick',ev=>{ev.stopPropagation(); openZoneEditor(z,ev);});
      _zcCache.set(z.id, g);
    }
    // Перестраиваем визуальные дочерние элементы
    while(g.firstChild) g.removeChild(g.firstChild);
    const col=z.color||'#4a9eff';
    const collH=26;
    if(z.collapsed){
      // ── Свёрнута: только заголовочная полоса ──
      g.appendChild(sa(mk('rect'),{
        x:z.x, y:z.y, width:z.w, height:collH, rx:4,
        fill:col, 'fill-opacity':'0.18',
        stroke:col, 'stroke-width':'1.5', class:'zone-rect'
      }));
      const lbl=sa(mk('text'),{
        x:z.x+10, y:z.y+collH/2,
        fill:col, 'font-family':'Arial,sans-serif',
        'font-size':'11', 'font-weight':'bold',
        'dominant-baseline':'middle',
        'pointer-events':'none', class:'zone-lbl-text'
      });
      lbl.textContent=(z.label||'')+'  ▶';
      g.appendChild(lbl);
      // кнопка раскрытия
      const ebtn=sa(mk('text'),{
        x:z.x+z.w-12, y:z.y+collH/2,
        fill:col, 'font-family':'Arial,sans-serif', 'font-size':'10',
        'dominant-baseline':'middle', 'text-anchor':'middle',
        cursor:'pointer', opacity:'0.6'
      });
      ebtn.textContent='▼';
      ebtn.addEventListener('click',ev=>{
        ev.stopPropagation(); snapshot('Развернуть зону');
        z.collapsed=false; rAll();
      });
      g.appendChild(ebtn);
    } else {
      // ── Развёрнута: полный прямоугольник ──
      g.appendChild(sa(mk('rect'),{
        x:z.x, y:z.y, width:z.w, height:z.h, rx:8,
        fill:col, 'fill-opacity':'0.07',
        stroke:col, 'stroke-width':'1.5', 'stroke-dasharray':'7,4',
        class:'zone-rect'
      }));
      const lbl=sa(mk('text'),{
        x:z.x+10, y:z.y+16,
        fill:col, 'font-family':'Arial,sans-serif',
        'font-size':'11', 'font-weight':'bold',
        'pointer-events':'none', class:'zone-lbl-text'
      });
      lbl.textContent=z.label||'';
      g.appendChild(lbl);
      // кнопка сворачивания
      const cbtn=sa(mk('text'),{
        x:z.x+z.w-12, y:z.y+16,
        fill:col, 'font-family':'Arial,sans-serif', 'font-size':'10',
        'dominant-baseline':'middle', 'text-anchor':'middle',
        cursor:'pointer', opacity:'0.6'
      });
      cbtn.textContent='▲';
      cbtn.addEventListener('click',ev=>{
        ev.stopPropagation(); snapshot('Свернуть зону');
        z.collapsed=true; rAll();
      });
      g.appendChild(cbtn);
      // resize handle (listener пересоздаётся: захватывает ow/oh)
      const rh=sa(mk('rect'),{
        x:z.x+z.w-9, y:z.y+z.h-9, width:9, height:9, rx:2,
        fill:col, class:'zone-resize'
      });
      rh.addEventListener('mousedown',ev=>{
        ev.stopPropagation();
        const sx=ev.clientX,sy=ev.clientY,ow=z.w,oh=z.h;
        let zrMoved=false;
        const mm=e=>{
          const d=svgDelta(e.clientX-sx,e.clientY-sy);
          if(!zrMoved){ snapshot('Размер зоны'); zrMoved=true; }
          z.w=Math.max(100,ow+d.dx); z.h=Math.max(60,oh+d.dy);
          rZones();
        };
        startDrag(mm);
      });
      g.appendChild(rh);
    }
    ZL.appendChild(g); // re-append для корректного DOM-порядка
  });
}

function addZone(){
  snapshot('Добавить зону');
  const PAD=28;
  let zx,zy,zw,zh;
  const sel=nodes.filter(n=>selectedIds.has(n.id));
  if(sel.length){
    // wrap around selected nodes
    let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
    sel.forEach(n=>{
      const nh=nodeH(n);
      mnX=Math.min(mnX,n.x); mnY=Math.min(mnY,n.y);
      mxX=Math.max(mxX,n.x+n.w); mxY=Math.max(mxY,n.y+nh);
    });
    zx=snap(mnX-PAD); zy=snap(mnY-PAD);
    zw=snap(mxX-mnX+PAD*2); zh=snap(mxY-mnY+PAD*2);
  } else {
    // fallback — centre of viewport
    const cw=document.getElementById('cw');
    zx=snap(vb.x+cw.clientWidth/2/vb.z-150);
    zy=snap(vb.y+cw.clientHeight/2/vb.z-100);
    zw=300; zh=200;
  }
  zones.push({id:'z'+uid(),x:zx,y:zy,w:zw,h:zh,label:'Зона',color:'#4a9eff'});
  rZones();
}

function openZoneEditor(z,ev){
  EN_zone=z;
  document.getElementById('ze-t').value=z.label||'';
  document.getElementById('ze-c').value=z.color||'#4a9eff';
  sp('zed',ev);
  setTimeout(()=>document.getElementById('ze-t').focus(),30);
}
function saveZone(){
  if(!EN_zone) return;
  snapshot('Изменить зону');
  EN_zone.label=document.getElementById('ze-t').value;
  EN_zone.color=document.getElementById('ze-c').value;
  cp('zed'); EN_zone=null; rZones();
}
function deleteZone(){
  if(!EN_zone) return;
  snapshot('Удалить зону');
  zones=zones.filter(z=>z.id!==EN_zone.id);
  cp('zed'); EN_zone=null; rZones();
}
function fitZoneToNodes(){
  if(!EN_zone) return;
  const PAD=28;
  // find nodes whose center is inside zone
  let candidates = nodes.filter(n=>cx(n)>=EN_zone.x&&cx(n)<=EN_zone.x+EN_zone.w&&cy(n)>=EN_zone.y&&cy(n)<=EN_zone.y+EN_zone.h);
  // if none inside, use all nodes
  if(!candidates.length) candidates = nodes;
  if(!candidates.length) return;
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  candidates.forEach(n=>{
    const nh=nodeH(n);
    mnX=Math.min(mnX,n.x); mnY=Math.min(mnY,n.y);
    mxX=Math.max(mxX,n.x+n.w); mxY=Math.max(mxY,n.y+nh);
  });
  snapshot('Подогнать зону');
  EN_zone.x=Math.round(mnX-PAD); EN_zone.y=Math.round(mnY-PAD);
  EN_zone.w=Math.round(mxX-mnX+PAD*2); EN_zone.h=Math.round(mxY-mnY+PAD*2);
  cp('zed'); EN_zone=null; rZones();
}

// ═══════════════════════════════════════════════════════════
// ALIGNMENT GUIDES
// ═══════════════════════════════════════════════════════════
const ALIGN_THRESH = 8; // screen pixels → пересчитывается в мировые через vb.z

// Реальная высота ноды (с учётом переноса текста)
// Мемоизация: ключ = id+w+h+title+sub1+sub2 — инвалидируется при любом изменении
const _nodeHCache = new Map();
// P2: кеш результатов wrapText для визуального рендеринга нод
// ключ тот же что у _nodeHCache — инвалидируется при изменении текста/размера
const _wrapCache = new Map();
function getCachedWrap(n){
  const key = n.id+'|'+n.w+'|'+(n.title||'')+'|'+(n.sub1||'')+'|'+(n.sub2||'');
  let cached = _wrapCache.get(key);
  if(cached) return cached;
  cached = {
    t: wrapText(n.title||'', n.w-16, 12),
    s1: wrapText(n.sub1||'',  n.w-16, 10),
    s2: wrapText(n.sub2||'',  n.w-16, 10),
  };
  _wrapCache.set(key, cached);
  if(_wrapCache.size > 600) _wrapCache.clear();
  return cached;
}
function nodeH(n){
  const key = n.id+'|'+n.w+'|'+n.h+'|'+(n.title||'')+'|'+(n.sub1||'')+'|'+(n.sub2||'');
  const cached = _nodeHCache.get(key);
  if(cached !== undefined) return cached;
  const tl=wrapText(n.title||'',n.w-16,12);
  const s1=wrapText(n.sub1||'',n.w-16,10);
  const s2=wrapText(n.sub2||'',n.w-16,10);
  const h=Math.max(n.h,(tl.length+s1.length+s2.length)*14+20);
  _nodeHCache.set(key,h);
  // Ограничиваем размер кеша
  if(_nodeHCache.size>500) _nodeHCache.clear();
  return h;
}

function clearGuides(){ GL.innerHTML=''; }

function showGuides(gx, gy){
  GL.innerHTML='';
  if(gx!==null) GL.appendChild(sa(mk('line'),{x1:gx,y1:-99999,x2:gx,y2:99999,class:'guide'}));
  if(gy!==null) GL.appendChild(sa(mk('line'),{x1:-99999,y1:gy,x2:99999,y2:gy,class:'guide'}));
}

// Вычисляет snap-позицию с выравниванием по другим нодам.
// Проверяет 3 точки X (лев/центр/прав) и 3 точки Y (верх/центр/низ).
// Приоритет: node-to-node snap → grid snap → free.
function calcSnap(node, nx, ny){
  const thresh = ALIGN_THRESH / vb.z;
  const nh = nodeH(node);

  // 3 контрольные точки перетаскиваемой ноды
  const nxPts = [nx, nx+node.w/2, nx+node.w];
  const nyPts = [ny, ny+nh/2,     ny+nh    ];

  let bestX=null, bestY=null;
  let snapX=nx,   snapY=ny;
  let minDX=thresh, minDY=thresh;

  // P1: viewport culling — сравниваем только с нодами в радиусе SNAP_RADIUS
  // избегаем O(N²) при drag на больших схемах
  const SNAP_RADIUS = Math.max(200, thresh * 4);
  const ncx = nx + node.w/2, ncy = ny + nh/2;

  nodes.forEach(other=>{
    if(other.id===node.id) return;
    const oh=nodeH(other);
    const ocx=other.x+other.w/2, ocy=other.y+oh/2;
    // быстрая проверка по bbox перед точными вычислениями
    if(Math.abs(ocx-ncx)>SNAP_RADIUS+other.w || Math.abs(ocy-ncy)>SNAP_RADIUS+oh) return;

    const oxPts=[other.x, other.x+other.w/2, other.x+other.w];
    const oyPts=[other.y, other.y+oh/2,       other.y+oh     ];

    for(const nxp of nxPts){
      for(const oxc of oxPts){
        const d=Math.abs(nxp-oxc);
        if(d<minDX){ minDX=d; bestX=oxc; snapX=nx+(oxc-nxp); }
      }
    }
    for(const nyp of nyPts){
      for(const oyc of oyPts){
        const d=Math.abs(nyp-oyc);
        if(d<minDY){ minDY=d; bestY=oyc; snapY=ny+(oyc-nyp); }
      }
    }
  });

  // Запасной вариант — привязка к сетке
  if(bestX===null && snapToGrid) snapX=snap(nx);
  if(bestY===null && snapToGrid) snapY=snap(ny);

  return { x:Math.max(0,snapX), y:Math.max(0,snapY), gx:bestX, gy:bestY };
}

// ═══════════════════════════════════════════════════════════
// EDGE INSERT (вставить ноду в разрыв связи)
// ═══════════════════════════════════════════════════════════
function ptSegDist(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay;
  if(!dx&&!dy) return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function findEdgeUnderNode(node){
  // используем реальный визуальный центр ноды (с учётом autoH)
  const LH=14,PAD=10;
  const titleLines=wrapText(node.title||'',node.w-16,12);
  const sub1Lines=wrapText(node.sub1||'',node.w-16,10);
  const sub2Lines=wrapText(node.sub2||'',node.w-16,10);
  const totalLines=titleLines.length+sub1Lines.length+sub2Lines.length;
  const autoH=Math.max(node.h, totalLines*LH+PAD*2);
  const ncx=node.x+node.w/2, ncy=node.y+autoH/2;
  const THRESH=32;
  return edges.find(e=>{
    if(e.from===node.id||e.to===node.id) return false;
    const fn=nb(e.from),tn=nb(e.to); if(!fn||!tn) return false;
    const chain=e.wp&&e.wp.length
      ? [bpt(fn,e.wp[0].x,e.wp[0].y),...e.wp,bpt(tn,e.wp[e.wp.length-1].x,e.wp[e.wp.length-1].y)]
      : [bpt(fn,cx(tn),cy(tn)),bpt(tn,cx(fn),cy(fn))];
    for(let i=0;i<chain.length-1;i++){
      if(ptSegDist(ncx,ncy,chain[i].x,chain[i].y,chain[i+1].x,chain[i+1].y)<THRESH) return true;
    }
    return false;
  })||null;
}
// ─── TC BUS SNAP ───────────────────────────────────────────
function isNodeNearTCBus(node){
  for(const bus of tcBuses){
    if(!bus.visible) continue;
    if(Math.abs(node.y-bus.y)<35||Math.abs((node.y+node.h)-bus.y)<35) return bus;
  }
  return null;
}
function applyTCSnap(node){
  const busId = _dropTC;
  _dropTC = null; _dropTCTap = null;
  node.tc = true;
  if(busId && busId!==tcBuses[0].id) node.tcBusId=busId;
  else delete node.tcBusId;
  rAll();
}

// ─── TC TAP INSERT (вертикальная линия от шины к ноде) ─────
function findTCTapUnderNode(node){
  if(!tcBuses.some(b=>b.visible)) return null;
  // Проверяем пересечение bounding box ноды с вертикальной TC tap линией
  const nx1=node.x, nx2=node.x+node.w;
  const ny1=node.y, ny2=node.y+node.h;
  return nodes.find(n=>{
    if(n.id===node.id) return false;
    if(!n.tc) return false;
    const bus = tcBuses.find(b=>b.visible&&(b.id===(n.tcBusId||tcBuses[0].id)))||tcBuses[0];
    const tapX=cx(n), tapY1=bus.y, tapY2=n.y;
    if(tapY1>=tapY2-10) return false; // нет вертикальной линии
    // tap X попадает в горизонтальные границы ноды (с допуском 12px)
    const xHit = tapX >= nx1-12 && tapX <= nx2+12;
    // нода вертикально перекрывается с tap линией
    const yHit = ny1 <= tapY2 && ny2 >= tapY1;
    return xHit && yHit;
  })||null;
}
function applyTCTapInsert(node, target){
  _dropTC = null; _dropTCTap = null;
  // нода получает TC от шины
  node.tc = true;
  // создаём signal-flow edge: node → target (TC проходит через новую ноду)
  edges.push({id:uid(), from:node.id, to:target.id, label:'TC / Audio', style:'dashed', wp:[]});
  rAll();
}

function tryInsertIntoEdge(node){
  // используем _dropEdge, найденный во время перетаскивания (не пересчитываем — нода могла сдвинуться при snap)
  const e=_dropEdge;
  _dropEdge=null;
  if(!e){rEdges();return;}
  // разбить e → (from→node) + (node→to)
  edges=edges.filter(x=>x.id!==e.id);
  edges.push({id:uid(),from:e.from,to:node.id,label:e.label||'',style:e.style||'solid',wp:[]});
  edges.push({id:uid(),from:node.id,to:e.to,  label:e.label||'',style:e.style||'solid',wp:[]});
  rAll();
}

// ═══════════════════════════════════════════════════════════
// DRAG NODE
// ═══════════════════════════════════════════════════════════
// node не передаётся параметром — ищем по ID внутри mousedown,
// чтобы undo/redo (замена всего массива nodes) не ломало кешированные handlers
function dragNode(g){
  g.addEventListener('mousedown',ev=>{
    if(ev.button||mode==='connect') return;
    const node=nb(g.dataset.id); if(!node) return;
    ev.stopPropagation(); ev.preventDefault();
    const sx=ev.clientX, sy=ev.clientY;
    let moved=false;

    // snapshot start positions for all selected nodes
    const isGroup = selectedIds.has(node.id) && selectedIds.size>1;
    const groupSnap = isGroup
      ? nodes.filter(n=>selectedIds.has(n.id)).map(n=>({n,ox:n.x,oy:n.y}))
      : [{n:node, ox:node.x, oy:node.y}];

    const mm=e=>{
      const d=svgDelta(e.clientX-sx,e.clientY-sy);
      if(Math.abs(d.dx)>2||Math.abs(d.dy)>2){
        if(!moved){ snapshot('Переместить'); moved=true; }
        let dx=d.dx, dy=d.dy;
        if(e.shiftKey){
          if(Math.abs(dx)>=Math.abs(dy)) dy=0; else dx=0;
        }
        if(groupSnap.length===1){
          // Одна нода — умное выравнивание + guide lines
          const {x,y,gx,gy}=calcSnap(node, groupSnap[0].ox+dx, groupSnap[0].oy+dy);
          node.x=x; node.y=y;
          showGuides(gx,gy);
          // подсветить ребро под нодой
          _dropEdge=findEdgeUnderNode(node);
          document.body.classList.toggle('drop-edge-mode', !!_dropEdge);
          // проверить вертикальный TC tap (приоритет над шиной)
          const tapTarget = findTCTapUnderNode(node);
          const nearBusObj = !tapTarget && isNodeNearTCBus(node);
          const nearBusId  = nearBusObj ? nearBusObj.id : null;
          if(tapTarget !== _dropTCTap || nearBusId !== _dropTC){
            _dropTCTap = tapTarget;
            _dropTC    = nearBusId;
            rTC();
          }
        } else {
          // Группа — grid snap, без guides
          clearGuides();
          _dropEdge=null;
          groupSnap.forEach(({n,ox,oy})=>{
            n.x=snap(Math.max(0,ox+dx));
            n.y=snap(Math.max(0,oy+dy));
          });
        }
        rEdges(); rTC(); rNodes();
      }
    };
    startDrag(mm, ()=>{
      clearGuides();
      document.body.classList.remove('drop-edge-mode');
      if(moved && groupSnap.length===1){
        if(_dropTCTap){
          applyTCTapInsert(node, _dropTCTap);
        } else if(_dropTC){
          applyTCSnap(node);
        } else {
          tryInsertIntoEdge(node);
        }
      } else {
        _dropEdge=null; _dropTC=null; _dropTCTap=null;
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════
// MODE (select / connect)
// ═══════════════════════════════════════════════════════════
let mode='select';
let connectFrom=null;
let _conMM=null; // mousemove listener для анимации preview-линии
const preview=document.getElementById('con-preview');

function setMode(m){
  mode=m;
  if(_conMM){ document.removeEventListener('mousemove',_conMM); _conMM=null; }
  NL&&NL.querySelectorAll&&NL.querySelectorAll('.connect-source').forEach(r=>r.classList.remove('connect-source'));
  connectFrom=null;
  preview.style.display='none';
  document.body.classList.toggle('connect-mode', m==='connect');
  const btnCon=document.getElementById('btn-con');
  if(btnCon) btnCon.classList.toggle('active', m==='connect');
  const hb=document.getElementById('hb-mode');
  if(hb) hb.textContent='Режим: '+(m==='connect'?'Связь — клик на порт → порт':'Выбор');
}

function toggleConnect(){
  setMode(mode==='connect'?'select':'connect');
}

// startConnect: preview стартует от ЦЕНТРА ноды — независимо от точки клика
function startConnect(node){
  if(_conMM){ document.removeEventListener('mousemove',_conMM); _conMM=null; }
  connectFrom={node};
  const _csg=_ngCache.get(node.id);
  if(_csg){const _csr=_csg.querySelector('.node-rect');if(_csr)_csr.classList.add('connect-source');}
  const cx=node.x+node.w/2, cy=node.y+nodeH(node)/2;
  sa(preview,{x1:cx,y1:cy,x2:cx,y2:cy});
  preview.style.display='';
  _conMM=e=>{ const p=svgCoords(e); sa(preview,{x2:p.x,y2:p.y}); };
  document.addEventListener('mousemove',_conMM);
}

function cancelConnect(){
  if(_conMM){ document.removeEventListener('mousemove',_conMM); _conMM=null; }
  if(connectFrom){const _csg=_ngCache.get(connectFrom.node.id);if(_csg){const _csr=_csg.querySelector('.node-rect');if(_csr)_csr.classList.remove('connect-source');}}
  connectFrom=null;
  preview.style.display='none';
}

// finishConnect: создать связь, не открывать редактор
function finishConnect(toNodeId){
  if(!connectFrom || connectFrom.node.id===toNodeId) return;
  const fromId = connectFrom.node.id;
  // Проверяем дублирование: уже есть связь A→B или B→A
  if(edges.some(e=>(e.from===fromId&&e.to===toNodeId)||(e.from===toNodeId&&e.to===fromId))){
    cancelConnect();
    return;
  }
  snapshot('Добавить связь');
  edges.push({id:'e'+crypto.randomUUID().split('-')[0], from:fromId, to:toNodeId, label:'', style:'solid', wp:[]});
  cancelConnect();
  rEdges(); rNodes();
}

// ── CONNECT РЕЖИМ: единый mousedown-обработчик в capture-фазе ──────────────
// Capture (true) = срабатывает ПЕРВЫМ, раньше dragNode и всех остальных.
// closest('.node-group') гарантированно находит нужную ноду через DOM.
// Preview стартует от центра ноды — никаких проблем с координатами клика.
document.getElementById('cw').addEventListener('mousedown', ev=>{
  if(mode!=='connect' || ev.button!==0) return;
  const grp = ev.target.closest('.node-group');
  if(!grp){
    if(connectFrom) cancelConnect();
    return;
  }
  const hit = nodes.find(n=>n.id===grp.dataset.id);
  if(!hit) return;
  ev.stopPropagation();
  if(!connectFrom){
    startConnect(hit);
  } else if(connectFrom.node.id!==hit.id){
    finishConnect(hit.id);
  }
}, true); // capture = true

// ═══════════════════════════════════════════════════════════
// SELECTION — rubber-band + multi-select
// ═══════════════════════════════════════════════════════════
let selected=null;
let selectedIds=new Set();
const selRect=document.getElementById('sel-rect');
let rubberActive=false;

function clearSelection(){
  selectedIds.clear();
  selected=null;
  // C4: используем _ngCache вместо querySelectorAll по всему DOM
  for(const [,g] of _ngCache){ const r=g.querySelector('.node-rect'); if(r) r.classList.remove('selected'); }
}

function applySelection(){
  // C4: _ngCache вместо O(N) querySelector на каждую выбранную ноду
  for(const [,g] of _ngCache){ const r=g.querySelector('.node-rect'); if(r) r.classList.remove('selected'); }
  selectedIds.forEach(sid=>{
    const g=_ngCache.get(sid);
    if(g){ const r=g.querySelector('.node-rect'); if(r) r.classList.add('selected'); }
  });
}

function selectNode(id, additive){
  if(!additive) clearSelection();
  if(additive && selectedIds.has(id)){
    selectedIds.delete(id); // toggle off
  } else {
    selectedIds.add(id);
    selected=id;
  }
  applySelection();
  updateHintBar(); // C5: счётчик «Выбрано: N нод» обновляется сразу
}

function selectAll(){
  nodes.forEach(n=>selectedIds.add(n.id));
  selected=nodes.length?nodes[nodes.length-1].id:null;
  applySelection();
}

// ── RUBBER-BAND on canvas background ─────────────────────
let rbStart={x:0,y:0};

document.getElementById('cw').addEventListener('mousedown',ev=>{
  // only in select mode, left button, not on node/popup/pan
  if(mode!=='select') return;
  if(ev.button!==0) return;
  if(spaceHeld) return;
  if(ev.target.closest('.node-group,.note-group,.popup,.resize-handle,.waypoint,.tc-drag')) return;

  // start rubber-band
  const p=svgCoords(ev);
  rbStart={x:p.x,y:p.y};
  rubberActive=true;
  sa(selRect,{x:p.x,y:p.y,width:0,height:0});
  selRect.style.display='block';

  const mm=e=>{
    if(!rubberActive) return;
    const cp2=svgCoords(e);
    const rx=Math.min(rbStart.x,cp2.x), ry=Math.min(rbStart.y,cp2.y);
    const rw=Math.abs(cp2.x-rbStart.x), rh=Math.abs(cp2.y-rbStart.y);
    sa(selRect,{x:rx,y:ry,width:rw,height:rh});
  };

  startDrag(mm, e=>{
    if(!rubberActive) return;
    rubberActive=false;
    selRect.style.display='none';
    // select nodes inside rect
    const rx=parseFloat(selRect.getAttribute('x')),ry=parseFloat(selRect.getAttribute('y'));
    const rw=parseFloat(selRect.getAttribute('width')),rh=parseFloat(selRect.getAttribute('height'));
    if(rw>4||rh>4){
      if(!e.shiftKey&&!e.ctrlKey) clearSelection();
      nodes.forEach(n=>{
        const autoH=nodeH(n); // same formula as rNodes() — accounts for text wrapping
        // check if node overlaps with rubber rect
        if(n.x+n.w>rx && n.x<rx+rw && n.y+autoH>ry && n.y<ry+rh){
          selectedIds.add(n.id);
        }
      });
      selected=selectedIds.size?[...selectedIds][selectedIds.size-1]:null;
      applySelection();
    } else {
      // click on empty area = deselect
      if(!e.shiftKey&&!e.ctrlKey) clearSelection();
    }
  });
},{capture:false});



function removeNode(id){
  nodes=nodes.filter(n=>n.id!==id);
  edges=edges.filter(e=>e.from!==id&&e.to!==id);
  selectedIds.delete(id);
  // U1: поиск мог содержать удалённую ноду — обновляем результаты
  if(searchMatches.length) doSearch();
}

// ═══════════════════════════════════════════════════════════
// COPY / PASTE
// ═══════════════════════════════════════════════════════════
function copyNodes(){
  if(!selectedIds.size) return;
  clipboard = nodes.filter(n=>selectedIds.has(n.id)).map(n=>({...n}));
  pasteOffset = 0;
}

function pasteNodes(){
  if(!clipboard.length) return;
  snapshot('Вставить ноды');
  pasteOffset += 30;
  clearSelection();
  clipboard.forEach(n=>{
    const newId = uid();
    nodes.push({...n, id:newId, x:n.x+pasteOffset, y:n.y+pasteOffset});
    selectedIds.add(newId);
  });
  selected = [...selectedIds][selectedIds.size-1];
  applySelection();
  rAll();
}

// ═══════════════════════════════════════════════════════════
// STICKY NOTES CRUD
// ═══════════════════════════════════════════════════════════
function addNote(){
  snapshot('Добавить заметку');
  const cw=document.getElementById('cw');
  notes.push({
    id:'x'+uid(),
    x: snap(vb.x + cw.clientWidth/2/vb.z - 100),
    y: snap(vb.y + cw.clientHeight/2/vb.z - 40),
    w:200, h:80,
    text:'Заметка',
    color:'#fffbe6'
  });
  rNotes();
}

let EN_note=null;
function openNoteEditor(note,ev){
  EN_note=note;
  document.getElementById('xe-t').value=note.text||'';
  document.getElementById('xe-c').value=note.color||'#fffbe6';
  sp('xed',ev);
  setTimeout(()=>document.getElementById('xe-t').focus(),30);
}
function saveNote(){
  if(!EN_note) return;
  snapshot('Изменить заметку');
  EN_note.text=document.getElementById('xe-t').value;
  EN_note.color=document.getElementById('xe-c').value;
  cp('xed'); EN_note=null; rNotes();
}
function deleteNote(){
  if(!EN_note) return;
  snapshot('Удалить заметку');
  notes=notes.filter(n=>n.id!==EN_note.id);
  cp('xed'); EN_note=null; rNotes();
}

// ═══════════════════════════════════════════════════════════
// DEVICE TYPES
// ═══════════════════════════════════════════════════════════
const DEVTYPE_DEFAULTS = {
  'video-server':   {style:'normal',    sub1:''},
  'touchdesigner':  {style:'highlight', sub1:''},
  'audio-console':  {style:'audio',     sub1:''},
  'audio-interface':{style:'audio',     sub1:''},
  'broadcast':      {style:'output',    sub1:''},
  'timecode':       {style:'normal',    sub1:'Timecode Source'},
  'led-processor':  {style:'normal',    sub1:''},
  'light-console':  {style:'highlight', sub1:''},
  'video-capture':  {style:'normal',    sub1:'Capture Card'},
  '':               {style:'normal',    sub1:''},
};
const DEVTYPE_LABELS = {
  'video-server':'Видеосервер','touchdesigner':'TouchDesigner',
  'audio-console':'Звуковой пульт','audio-interface':'Звуковой интерфейс',
  'broadcast':'Сервер трансляции','timecode':'Timecode Notebook',
  'led-processor':'Видеопроцессор','light-console':'Световой пульт',
  'video-capture':'Видео захват',
  '':'Обычный',
};
const DEVTYPE_COLORS = {
  'video-server':'#4a9eff','touchdesigner':'#aa66cc',
  'audio-console':'#1a6aaa','audio-interface':'#1a9aaa',
  'broadcast':'#cc4444','timecode':'#ff9900',
  'led-processor':'#22aa66','light-console':'#ffbb33',
  'video-capture':'#e67e22',
  '':null,
};
function getDevtypeColor(dt){
  if(!dt) return null;
  const custom = customDeviceTypes.find(c=>c.id===dt);
  if(custom) return custom.color;
  return DEVTYPE_COLORS[dt]||null;
}
function getDevtypeLabel(dt){
  if(!dt) return DEVTYPE_LABELS[''];
  const custom = customDeviceTypes.find(c=>c.id===dt);
  if(custom) return custom.label;
  return DEVTYPE_LABELS[dt]||dt;
}
const DEVTYPE_PLACEHOLDERS = {
  'video-server':   {t:'Resolume Arena',   s1:'VJ Server'},
  'touchdesigner':  {t:'TouchDesigner',    s1:'Main Show Controller'},
  'audio-console':  {t:'FOH Console',      s1:''},
  'audio-interface':{t:'Audio Interface',  s1:'Timecode Input'},
  'broadcast':      {t:'Broadcast Server', s1:''},
  'timecode':       {t:'Timecode Laptop',  s1:'Timecode Source'},
  'led-processor':  {t:'LED Processor',    s1:'Scaling / Mapping'},
  'light-console':  {t:'grandMA3',         s1:'Lighting Console'},
  'video-capture':  {t:'Capture Card',     s1:'Захват сигнала'},
  '':               {t:'Название ноды',    s1:'Подзаголовок'},
};

function onDevTypeChange(prefix){
  const dt = document.getElementById(prefix+'-devtype').value;
  const novaRow      = document.getElementById(prefix+'-nova-row');
  const audioRow     = document.getElementById(prefix+'-audio-row');
  const lightRow     = document.getElementById(prefix+'-light-row');
  const broadcastRow = document.getElementById(prefix+'-broadcast-row');
  const videoRow     = document.getElementById(prefix+'-video-row');
  const tcRow        = document.getElementById(prefix+'-tc-row');
  const aiRow        = document.getElementById(prefix+'-ai-row');
  const vcRow        = document.getElementById(prefix+'-vc-row');
  novaRow.style.display      = dt==='led-processor'    ? 'block' : 'none';
  audioRow.style.display     = dt==='audio-console'    ? 'block' : 'none';
  if(lightRow) lightRow.style.display = dt==='light-console' ? 'block' : 'none';
  broadcastRow.style.display = dt==='broadcast'        ? 'block' : 'none';
  videoRow.style.display     = dt==='video-server'     ? 'block' : 'none';
  tcRow.style.display        = dt==='timecode'         ? 'block' : 'none';
  aiRow.style.display        = dt==='audio-interface'  ? 'block' : 'none';
  if(vcRow) vcRow.style.display = dt==='video-capture' ? 'block' : 'none';
  if(dt!=='led-processor')    document.getElementById(prefix+'-nova').value='';
  if(dt!=='audio-console')    document.getElementById(prefix+'-audio').value='';
  if(dt!=='light-console'){ const lEl=document.getElementById(prefix+'-light'); if(lEl) lEl.value=''; }
  if(dt!=='broadcast')        document.getElementById(prefix+'-broadcast').value='';
  if(dt!=='video-server')     document.getElementById(prefix+'-video').value='';
  if(dt!=='timecode')         document.getElementById(prefix+'-tc-src').value='';
  if(dt!=='audio-interface')  document.getElementById(prefix+'-ai').value='';
  if(dt!=='video-capture'){ const el=document.getElementById(prefix+'-vc'); if(el) el.value=''; const ec=document.getElementById(prefix+'-vc-custom'); if(ec) ec.style.display='none'; }
  // авто-галка TC out для Timecode Notebook
  const tcOutEl = document.getElementById(prefix+'-tcout');
  if(tcOutEl) tcOutEl.checked = dt==='timecode';
  const d = DEVTYPE_DEFAULTS[dt]||DEVTYPE_DEFAULTS[''];
  if(document.getElementById(prefix+'-style')) document.getElementById(prefix+'-style').value=d.style;
  // обновить placeholders
  const ph = DEVTYPE_PLACEHOLDERS[dt]||DEVTYPE_PLACEHOLDERS[''];
  const tEl=document.getElementById(prefix+'-t');
  const s1El=document.getElementById(prefix+'-s1');
  if(tEl)  tEl.placeholder  = ph.t;
  if(s1El) s1El.placeholder = ph.s1;
}

function _autoTitle(prefix, val){
  const tEl = document.getElementById(prefix+'-t');
  if(!tEl || !val) return;
  tEl.placeholder = val;
  // Авто-заполнить поле если пустое или совпадает с предыдущей авто-подсказкой
  if(!tEl.value || tEl.value === tEl.dataset.autoTitle){
    tEl.value = val;
    tEl.dataset.autoTitle = val;
  }
}
function onAudioInterfaceChange(prefix){
  const val = document.getElementById(prefix+'-ai').value;
  document.getElementById(prefix+'-s1').value = val;
  _autoTitle(prefix, val);
}

function onTCSourceChange(prefix){
  const val = document.getElementById(prefix+'-tc-src').value;
  document.getElementById(prefix+'-s1').value = val;
  _autoTitle(prefix, val);
}

function onVCChange(prefix){
  const sel = document.getElementById(prefix+'-vc');
  const customRow = document.getElementById(prefix+'-vc-custom');
  if(sel.value === '__custom__'){
    if(customRow) customRow.style.display='block';
    return;
  }
  if(customRow) customRow.style.display='none';
  const val = sel.value;
  if(val){ _autoTitle(prefix, val); document.getElementById(prefix+'-s1').value='Capture Card'; }
}

function onVideoServerChange(prefix){
  const val = document.getElementById(prefix+'-video').value;
  document.getElementById(prefix+'-s1').value = val;
  _autoTitle(prefix, val);
}

function onBroadcastChange(prefix){
  const val = document.getElementById(prefix+'-broadcast').value;
  document.getElementById(prefix+'-s1').value = val;
  _autoTitle(prefix, val);
}

function onAudioConsoleChange(prefix){
  const val = document.getElementById(prefix+'-audio').value;
  document.getElementById(prefix+'-s1').value = val;
  _autoTitle(prefix, val);
}

const NOVA_OUTPUTS = {
  'MCTRL4K':4,'MCTRL660':2,'MCTRL R5':2,'MCTRL300':1,
  'VX4S-N':4,'VX6S':6,
  'H2':2,'H4':4,'H9':9,'H15':15,
  'NovaPro HD':2,
};

function onNovaChange(prefix){
  const model = document.getElementById(prefix+'-nova').value;
  if(model){
    document.getElementById(prefix+'-s1').value = 'Novastar '+model;
    _autoTitle(prefix, 'Novastar '+model);
  }
  const outEl = document.getElementById(prefix+'-outputs');
  if(outEl && NOVA_OUTPUTS[model]) outEl.value = NOVA_OUTPUTS[model];
}

function onLightConsoleChange(prefix){
  const val = document.getElementById(prefix+'-light').value;
  if(val){
    document.getElementById(prefix+'-s1').value = 'Световой пульт';
    _autoTitle(prefix, val);
  }
}

// ═══════════════════════════════════════════════════════════
// ADD NODE
// ═══════════════════════════════════════════════════════════
function addNode(){
  _neMode = 'add';
  _nePendingX = snap(vb.x + document.getElementById('cw').clientWidth/2/vb.z - 87);
  _nePendingY = snap(vb.y + 120/vb.z);
  // Clear all fields
  document.getElementById('ne-t').value='';
  document.getElementById('ne-s1').value='';
  document.getElementById('ne-s2').value='';
  document.getElementById('ne-s2').value='';
  document.getElementById('ne-devtype').value='';
  document.getElementById('ne-nova-row').style.display='none';
  document.getElementById('ne-nova').value='';
  document.getElementById('ne-outputs').value='';
  document.getElementById('ne-light-row').style.display='none';
  document.getElementById('ne-light').value='';
  document.getElementById('ne-audio-row').style.display='none';
  document.getElementById('ne-audio').value='';
  document.getElementById('ne-broadcast-row').style.display='none';
  document.getElementById('ne-broadcast').value='';
  document.getElementById('ne-video-row').style.display='none';
  document.getElementById('ne-video').value='';
  document.getElementById('ne-tc-row').style.display='none';
  document.getElementById('ne-tc-src').value='';
  document.getElementById('ne-ai-row').style.display='none';
  document.getElementById('ne-ai').value='';
  document.getElementById('ne-vc-row').style.display='none';
  document.getElementById('ne-vc').value='';
  document.getElementById('ne-vc-custom').style.display='none';
  document.getElementById('ne-vc-custom-val').value='';
  document.getElementById('ne-tc').checked=false;
  document.getElementById('ne-tcout').checked=false;
  if(document.getElementById('ne-style')) document.getElementById('ne-style').value='normal';
  // Update popup UI for add mode
  const titleEl = document.getElementById('ne-popup-title');
  if(titleEl) titleEl.textContent='＋ Новая нода';
  const okBtn = document.getElementById('ne-ok-btn');
  if(okBtn) okBtn.textContent='Добавить';
  const delBtn = document.getElementById('ne-del-btn');
  if(delBtn) delBtn.style.display='none';
  sp('ned', {clientX: document.getElementById('cw').clientWidth/2, clientY: 80});
  setTimeout(()=>document.getElementById('ne-t').focus(), 30);
}

// confirmAdd() removed — merged into saveNode() via _neMode flag

function centerOnNode(n){
  if(!n) return;
  const {w,h}=getVPSize();
  vb.x = n.x + n.w/2 - w/2/vb.z;
  vb.y = n.y + n.h/2 - h/2/vb.z;
  applyVB();
}


// ═══════════════════════════════════════════════════════════
// ── QUICK EDIT (dblclick на ноде) ──────────────────────────
let _qeNode=null;

function openQE(node, ev){
  _qeNode=node;
  const d=document.getElementById('qed');
  document.getElementById('qe-t').value=node.title||'';
  document.getElementById('qe-s1').value=node.sub1||'';
  document.getElementById('qe-s2').value=node.sub2||'';
  // позиционируем рядом с нодой
  const x=Math.min(ev.clientX+10, window.innerWidth-260);
  const y=Math.min(ev.clientY-10, window.innerHeight-180);
  d.style.left=x+'px'; d.style.top=y+'px'; d.style.display='block';
  document.getElementById('qe-t').select();
}

function saveQE(){
  if(!_qeNode) return;
  snapshot('Переименовать ноду');
  _qeNode.title=document.getElementById('qe-t').value;
  _qeNode.sub1=document.getElementById('qe-s1').value;
  _qeNode.sub2=document.getElementById('qe-s2').value;
  closeQE(); rNodes();
}

function closeQE(){
  document.getElementById('qed').style.display='none';
  _qeNode=null;
}

function openQEProps(){
  const node=_qeNode;
  closeQE();
  if(node) openNE(node, {clientX:window.innerWidth/2, clientY:window.innerHeight/2});
}

// NODE EDITOR
// ═══════════════════════════════════════════════════════════
let EN=null;
let _neMode = 'edit'; // 'edit' | 'add'
let _nePendingX = 200, _nePendingY = 200; // position for new node
function openNE(n,ev){
  EN=n;
  _neMode = 'edit';
  const dt=n.deviceType||'';
  document.getElementById('ne-devtype').value=dt;
  document.getElementById('ne-nova-row').style.display=dt==='led-processor'?'block':'none';
  document.getElementById('ne-nova').value=n.novaModel||'';
  document.getElementById('ne-outputs').value=n.outputs||'';
  document.getElementById('ne-light-row').style.display=dt==='light-console'?'block':'none';
  document.getElementById('ne-light').value=n.lightConsoleModel||'';
  document.getElementById('ne-audio-row').style.display=dt==='audio-console'?'block':'none';
  document.getElementById('ne-audio').value=n.audioConsole||'';
  document.getElementById('ne-broadcast-row').style.display=dt==='broadcast'?'block':'none';
  document.getElementById('ne-broadcast').value=n.broadcastType||'';
  document.getElementById('ne-video-row').style.display=dt==='video-server'?'block':'none';
  document.getElementById('ne-video').value=n.videoSoftware||'';
  document.getElementById('ne-tc-row').style.display=dt==='timecode'?'block':'none';
  document.getElementById('ne-tc-src').value=n.tcSource||'';
  document.getElementById('ne-ai-row').style.display=dt==='audio-interface'?'block':'none';
  document.getElementById('ne-ai').value=n.audioInterface||'';
  document.getElementById('ne-vc-row').style.display=dt==='video-capture'?'block':'none';
  const vcVal=n.captureDevice||'';
  const vcSel=document.getElementById('ne-vc');
  const vcCustomRow=document.getElementById('ne-vc-custom');
  const vcCustomVal=document.getElementById('ne-vc-custom-val');
  const isCustomVC = vcVal && !['Magewell Pro Capture HDMI 4K','Magewell Pro Capture Dual HDMI','Magewell USB Capture HDMI 4K Plus','Blackmagic DeckLink 8K Pro','Blackmagic DeckLink Quad HDMI Recorder','Blackmagic UltraStudio 4K Mini','Blackmagic Video Assist 12G','AJA KONA 5','AJA KONA HDMI','AJA Io X4','AJA U-TAP HDMI','Elgato 4K X','Elgato 4K60 Pro MK.2','Epiphan Pearl-2','Epiphan AV.io 4K'].includes(vcVal);
  if(isCustomVC && vcVal){ vcSel.value='__custom__'; vcCustomVal.value=vcVal; vcCustomRow.style.display='block'; }
  else { vcSel.value=vcVal; vcCustomRow.style.display='none'; vcCustomVal.value=''; }
  document.getElementById('ne-t').value=n.title;
  document.getElementById('ne-s1').value=n.sub1||'';
  document.getElementById('ne-s2').value=n.sub2||'';
  if(document.getElementById('ne-style')) document.getElementById('ne-style').value=n.style||'normal';
  document.getElementById('ne-tc').checked=!!n.tc;
  document.getElementById('ne-tcout').checked=!!n.tcOut;
  // Update popup UI for edit mode
  const titleEl = document.getElementById('ne-popup-title');
  if(titleEl) titleEl.textContent='✏️ Редактировать ноду';
  const okBtn = document.getElementById('ne-ok-btn');
  if(okBtn) okBtn.textContent='OK';
  const delBtn = document.getElementById('ne-del-btn');
  if(delBtn) delBtn.style.display='';
  sp('ned',ev);
  setTimeout(()=>document.getElementById('ne-t').focus(),30);
}
function _readVC(prefix){
  const sel=document.getElementById(prefix+'-vc');
  if(!sel) return undefined;
  if(sel.value==='__custom__'){
    const cv=document.getElementById(prefix+'-vc-custom-val');
    return cv&&cv.value.trim()?cv.value.trim():undefined;
  }
  return sel.value||undefined;
}

function saveNode(){
  if(_neMode === 'add'){
    const tEl=document.getElementById('ne-t');
    const t=tEl.value.trim()||tEl.placeholder||'';
    if(!t) return;
    snapshot('Добавить ноду');
    const dt=document.getElementById('ne-devtype').value;
    const nova=document.getElementById('ne-nova').value;
    const d=DEVTYPE_DEFAULTS[dt]||DEVTYPE_DEFAULTS[''];
    const styleEl=document.getElementById('ne-style');
    nodes.push({
      id:uid(),
      x:snap(_nePendingX), y:snap(_nePendingY),
      w:175, h:58,
      title:t,
      sub1:document.getElementById('ne-s1').value,
      sub2:document.getElementById('ne-s2').value,
      style:styleEl?styleEl.value:d.style,
      deviceType:dt,
      novaModel:dt==='led-processor'&&nova?nova:undefined,
      outputs:dt==='led-processor'?parseInt(document.getElementById('ne-outputs').value)||undefined:undefined,
      lightConsoleModel:dt==='light-console'?document.getElementById('ne-light').value||undefined:undefined,
      audioConsole:dt==='audio-console'?document.getElementById('ne-audio').value||undefined:undefined,
      broadcastType:dt==='broadcast'?document.getElementById('ne-broadcast').value||undefined:undefined,
      videoSoftware:dt==='video-server'?document.getElementById('ne-video').value||undefined:undefined,
      tcSource:dt==='timecode'?document.getElementById('ne-tc-src').value||undefined:undefined,
      audioInterface:dt==='audio-interface'?document.getElementById('ne-ai').value||undefined:undefined,
      captureDevice:dt==='video-capture'?_readVC('ne'):undefined,
      tc:document.getElementById('ne-tc').checked,
      tcOut:document.getElementById('ne-tcout').checked,
    });
    const newNode=nodes[nodes.length-1];
    cp('ned'); EN=null; _neMode='edit'; rAll();
    centerOnNode(newNode);
  } else {
    if(!EN) return;
    snapshot('Изменить ноду');
    const dt=document.getElementById('ne-devtype').value;
    const nova=document.getElementById('ne-nova').value;
    EN.deviceType=dt;
    EN.novaModel=dt==='led-processor'&&nova?nova:undefined;
    EN.outputs=dt==='led-processor'?parseInt(document.getElementById('ne-outputs').value)||undefined:undefined;
    EN.lightConsoleModel=dt==='light-console'?document.getElementById('ne-light').value||undefined:undefined;
    EN.audioConsole=dt==='audio-console'?document.getElementById('ne-audio').value||undefined:undefined;
    EN.broadcastType=dt==='broadcast'?document.getElementById('ne-broadcast').value||undefined:undefined;
    EN.videoSoftware=dt==='video-server'?document.getElementById('ne-video').value||undefined:undefined;
    EN.tcSource=dt==='timecode'?document.getElementById('ne-tc-src').value||undefined:undefined;
    EN.audioInterface=dt==='audio-interface'?document.getElementById('ne-ai').value||undefined:undefined;
    EN.captureDevice=dt==='video-capture'?_readVC('ne'):undefined;
    EN.title=document.getElementById('ne-t').value;
    EN.sub1=document.getElementById('ne-s1').value;
    EN.sub2=document.getElementById('ne-s2').value;
    if(document.getElementById('ne-style')) EN.style=document.getElementById('ne-style').value;
    EN.tc=document.getElementById('ne-tc').checked;
    EN.tcOut=document.getElementById('ne-tcout').checked;
    cp('ned'); EN=null; _neMode='edit'; rAll();
  }
}
function deleteNode(){
  if(!EN) return;
  snapshot('Удалить ноду');
  removeNode(EN.id); cp('ned'); EN=null; rAll();
}
document.getElementById('ne-t').addEventListener('keydown',e=>{if(e.key==='Enter')saveNode();if(e.key==='Escape')cp('ned');});

// ═══════════════════════════════════════════════════════════
// EDGE EDITOR
// ═══════════════════════════════════════════════════════════
let EE=null;
function openEE(e,ev){
  EE=e;
  document.getElementById('ee-l').value=e.label||'';
  document.getElementById('ee-cable').value=e.cable||'';
  document.getElementById('ee-res').value=e.res||'';
  document.getElementById('ee-rate').value=e.rate||'';
  document.getElementById('ee-s').value=e.style||'solid';
  sp('eed',ev);
  setTimeout(()=>document.getElementById('ee-l').focus(),30);
}
function saveEdge(){
  if(!EE) return;
  snapshot('Изменить связь');
  EE.label=document.getElementById('ee-l').value;
  EE.cable=document.getElementById('ee-cable').value||undefined;
  EE.res  =document.getElementById('ee-res').value||undefined;
  EE.rate =document.getElementById('ee-rate').value||undefined;
  EE.style=document.getElementById('ee-s').value;
  cp('eed'); EE=null; rEdges();
}
function delEdge(){
  if(!EE) return;
  snapshot('Удалить связь');
  edges=edges.filter(e=>e.id!==EE.id);
  cp('eed'); EE=null; rEdges();
}
document.getElementById('ee-l').addEventListener('keydown',e=>{if(e.key==='Enter')saveEdge();if(e.key==='Escape')cp('eed');});

// ═══════════════════════════════════════════════════════════
// POPUP HELPERS
// ═══════════════════════════════════════════════════════════
function sp(id, ev){
  const el=document.getElementById(id);
  el.style.display='block';
  // restart CSS animation on each show
  el.style.animation='none';
  el.offsetHeight; // force reflow
  el.style.animation='';
  if(!el._dragged){
    // после display:block можно измерить размер
    const pw=el.offsetWidth||260, ph=el.offsetHeight||300;
    const winW=window.innerWidth, winH=window.innerHeight;
    const x=Math.max(4, Math.min((ev.clientX||winW/2)+8, winW-pw-4));
    const y=Math.max(46, Math.min((ev.clientY||100)+8, winH-ph-26));
    el.style.left=x+'px'; el.style.top=y+'px';
  }
}
function cp(id){
  const el=document.getElementById(id);
  el.style.display='none';
  el._dragged=false;
}
// Закрывает все попапы и обнуляет переменные редакторов.
// Вызывается при resetToWelcome / newProject / applyState (открытие файла / undo-redo).
function _closeEditors(){
  ['ned','eed','qed','tbe','std','xed'].forEach(id=>{
    const el=document.getElementById(id); if(el){ el.style.display='none'; el._dragged=false; }
  });
  EN=null; EN_zone=null; EN_note=null; EN_tcBus=null; _qeNode=null; EE=null;
}
document.getElementById('cw').addEventListener('click',ev=>{
  if(!ev.target.closest('.popup')){ cp('ned'); cp('eed'); cp('xed'); cp('std'); }
});

// ── DRAGGABLE POPUPS ─────────────────────────────────────
function startDragPopup(ev, id){
  // Only drag from the header itself, not from child inputs/buttons
  if(ev.target.tagName==='INPUT'||ev.target.tagName==='SELECT'||
     ev.target.tagName==='TEXTAREA'||ev.target.classList.contains('close-btn')) return;
  ev.preventDefault();
  const el=document.getElementById(id);
  const startX=ev.clientX, startY=ev.clientY;
  const startL=parseInt(el.style.left)||0, startT=parseInt(el.style.top)||0;
  el._dragged=true;
  const mm=e=>{
    const pw=el.offsetWidth, ph=el.offsetHeight;
    el.style.left=Math.max(0, Math.min(window.innerWidth-pw,  startL+(e.clientX-startX)))+'px';
    el.style.top =Math.max(42,Math.min(window.innerHeight-ph-22, startT+(e.clientY-startY)))+'px';
  };
  startDrag(mm);
}

// ═══════════════════════════════════════════════════════════
// SVG COORDS HELPERS
// ═══════════════════════════════════════════════════════════
function svgCoords(ev){
  const cw=document.getElementById('cw');
  const rect=cw.getBoundingClientRect();
  const mx=(ev.clientX-rect.left), my=(ev.clientY-rect.top);
  return {
    x: vb.x + mx / vb.z,
    y: vb.y + my / vb.z
  };
}
function svgDelta(dx,dy){
  return { dx: dx / vb.z, dy: dy / vb.z };
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
const IST=`
.node-rect{fill:#fff;stroke:#222;stroke-width:1.5;}
.node-rect.output{fill:#efefef;}.node-rect.highlight{fill:#fffbe6;stroke-width:2.5;}
.node-title{font-family:Arial,sans-serif;font-size:12px;font-weight:bold;fill:#000;text-anchor:middle;dominant-baseline:middle;}
.node-sub{font-family:Arial,sans-serif;font-size:10px;fill:#555;text-anchor:middle;dominant-baseline:middle;}
.edge{fill:none;stroke:#222;stroke-width:1.5;}.edge.dashed{stroke-dasharray:6,3;}
.tc-rail{fill:none;stroke:#333;stroke-width:2;stroke-dasharray:10,5;}
.tc-tap{fill:none;stroke:#888;stroke-width:1.2;stroke-dasharray:4,3;}
.tc-rail-lbl{font-family:Arial,sans-serif;font-size:10px;font-weight:bold;fill:#555;}
.tc-lbl{font-family:Arial,sans-serif;font-size:9px;fill:#888;text-anchor:middle;}
.edge-lbl-bg{fill:#fff;}.edge-lbl{font-family:Arial,sans-serif;font-size:9px;fill:#333;text-anchor:middle;dominant-baseline:middle;}
.waypoint{fill:#fff;stroke:#0066cc;stroke-width:1.5;}
.zone-lbl-text{font-family:Arial,sans-serif;font-size:11px;font-weight:bold;}
`;

function getBounds(){
  let mnX=9999,mnY=9999,mxX=0,mxY=0;
  nodes.forEach(n=>{
    mnX=Math.min(mnX,n.x); mnY=Math.min(mnY,n.y);
    mxX=Math.max(mxX,n.x+n.w); mxY=Math.max(mxY,n.y+nodeH(n)+20);
  });
  zones.forEach(z=>{
    mnX=Math.min(mnX,z.x); mnY=Math.min(mnY,z.y);
    mxX=Math.max(mxX,z.x+z.w); mxY=Math.max(mxY,z.y+z.h);
  });
  tcBuses.filter(b=>b.visible).forEach(b=>{ mnY=Math.min(mnY,b.y-20); });
  return {mnX,mnY,W:mxX-mnX,H:mxY-mnY};
}

function getExpSVG(){
  const {mnX,mnY,W,H}=getBounds(), p=40;
  const cl=svg.cloneNode(true);
  cl.querySelectorAll('.edge-hit,.tc-drag,.resize-handle,.connect-preview,.zone-resize').forEach(e=>e.remove());
  cl.querySelectorAll('#con-preview').forEach(e=>e.remove());
  const s=document.createElementNS('http://www.w3.org/2000/svg','style');
  s.textContent=IST; cl.insertBefore(s,cl.firstChild);
  sa(cl,{viewBox:`${mnX-p} ${mnY-p} ${W+p*2} ${H+p*2}`,width:W+p*2,height:H+p*2,xmlns:SVG_NS});
  return {str:new XMLSerializer().serializeToString(cl), W:W+p*2, H:H+p*2};
}

function exportSVG(){
  const {str}=getExpSVG();
  dl(URL.createObjectURL(new Blob(['<?xml version="1.0"?>'+str],{type:'image/svg+xml'})),'show-signal-flow.svg');
}
function exportPNG(){
  const {str,W,H}=getExpSVG(), sc=2, img=new Image();
  const blobUrl=URL.createObjectURL(new Blob([str],{type:'image/svg+xml'}));
  img.onload=()=>{
    const c=document.createElement('canvas'); c.width=W*sc; c.height=H*sc;
    const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,W*sc,H*sc);
    ctx.scale(sc,sc); ctx.drawImage(img,0,0);
    dl(c.toDataURL('image/png'),'show-signal-flow.png');
    URL.revokeObjectURL(blobUrl);
  };
  img.src=blobUrl;
}
function dl(url,name){ const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 10000); }

function printDiagram(){
  const {str}=getExpSVG();
  const win=window.open('','_blank');
  if(!win){ alert('Браузер заблокировал всплывающее окно. Разрешите popup для печати.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>Show Signal Flow</title>
    <style>body{margin:0;padding:20px;}@media print{body{margin:0;padding:0;}}</style></head>
    <body><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(str)}"
    style="max-width:100%;height:auto;display:block;"/></body></html>`);
  win.document.close();
  setTimeout(()=>{ win.focus(); win.print(); },400);
}

// ── EXPORT HTML (CLIENT VIEW) ─────────────────────────────
function exportClientHTML(){
  // экранируем </script> чтобы JSON внутри <script> тега не ломал HTML
  const state = JSON.stringify({nodes, edges, tcBuses, notes, zones})
    .replace(/<\/script>/gi, '<\\/script>');

  // Сериализуем общие функции чтобы не дублировать код
  const _sharedFns = [
    startDrag,
    wrapText,
    nodeH,
    bpt,
    nodeInZone,
    collapsedZoneOf,
    zoneBar,
  ].map(f => f.toString()).join('\n');

  const IST_CLIENT = `
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;background:#f8f8f8;overflow:hidden;
      background-image:radial-gradient(circle,#ccc 1px,transparent 1px);background-size:24px 24px;}
    #tb{position:fixed;top:0;left:0;right:0;height:38px;background:#1c1c1c;color:#fff;
      display:flex;align-items:center;padding:0 14px;gap:8px;z-index:50;font-size:12px;}
    #tb b{font-size:13px;}
    .tbtn{background:#2e2e2e;border:1px solid #555;color:#ddd;padding:3px 10px;
      border-radius:3px;cursor:pointer;font-size:11px;}
    .tbtn:hover{background:#3a3a3a;}
    #hint{position:fixed;bottom:0;left:0;right:0;height:22px;background:#111;
      color:#555;font-size:10px;display:flex;align-items:center;padding:0 12px;gap:16px;}
    #cw{position:fixed;top:38px;left:0;right:0;bottom:22px;overflow:hidden;background:#fff;
      background-image:radial-gradient(circle,#ddd 1px,transparent 1px);background-size:24px 24px;}
    #diagram{display:block;width:100%;height:100%;}
    .node-rect{fill:#fff;stroke:#222;stroke-width:1.5;}
    .node-rect.output{fill:#efefef;}
    .node-rect.highlight{fill:#fffbe6;stroke-width:2.5;}
    .node-rect.audio{fill:#e8f4ff;stroke:#1a6aaa;stroke-width:1.5;}
    .node-title{font-family:Arial,sans-serif;font-size:12px;font-weight:bold;
      fill:#000;text-anchor:middle;dominant-baseline:middle;pointer-events:none;}
    .node-sub{font-family:Arial,sans-serif;font-size:10px;fill:#555;
      text-anchor:middle;dominant-baseline:middle;pointer-events:none;}
    .node-group{cursor:grab;}.node-group:active{cursor:grabbing;}
    .edge{fill:none;stroke:#222;stroke-width:1.5;}.edge.dashed{stroke-dasharray:6,3;}
    .edge-lbl-bg{fill:#fff;}
    .edge-lbl{font-family:Arial,sans-serif;font-size:9px;fill:#333;text-anchor:middle;dominant-baseline:middle;}
    .tc-rail{fill:none;stroke:#333;stroke-width:2;stroke-dasharray:10,5;}
    .tc-tap{fill:none;stroke:#888;stroke-width:1.2;stroke-dasharray:4,3;}
    .tc-rail-lbl{font-family:Arial,sans-serif;font-size:10px;font-weight:bold;fill:#555;}
    .tc-lbl{font-family:Arial,sans-serif;font-size:9px;fill:#888;text-anchor:middle;}
    body.panning #diagram{cursor:grabbing;}
    body.space-held .node-group{cursor:grab;}
    .note-group{cursor:grab;}.note-group:active{cursor:grabbing;}
    .note-rect{stroke:#bbb;stroke-width:1;}
    .note-text{font-family:Arial,sans-serif;font-size:11px;fill:#444;}
    .note-resize{fill:#888;cursor:se-resize;opacity:0;transition:opacity .15s;}
    .note-group:hover .note-resize{opacity:0.6;}
    .zone-rect{pointer-events:none;}
    .zone-lbl-text{pointer-events:none;}
  `;

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Show Signal Flow — Просмотр</title>
<style>${IST_CLIENT}</style>
</head>
<body>
<div id="tb">
  <b>SHOW · SIGNAL FLOW</b>
  &nbsp;·&nbsp; <span style="color:#888;font-size:11px;">Только просмотр — перемещение нод доступно</span>
  <span style="margin-left:auto;color:#555;font-size:10px;">© Concept Store 2026</span>
</div>
<div id="cw">
  <svg id="diagram" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0,8 3,0 6" fill="#222"/>
      </marker>
      <marker id="arr-sm" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
        <polygon points="0 0,6 2.5,0 5" fill="#888"/>
      </marker>
    </defs>
    <g id="zl"></g>
    <g id="el"></g>
    <g id="tl"></g>
    <g id="xl"></g>
    <g id="nl"></g>
  </svg>
</div>
<div id="hint">
  <span>Перетащить ноду — переместить</span>
  <span>Space+drag или средняя кнопка — прокрутка холста</span>
  <span>Ctrl+колесо — зум</span>
</div>
<script>
'use strict';
const STATE = ${state};
${_sharedFns}
let nodes = STATE.nodes;
let edges = STATE.edges;
let tcBuses = STATE.tcBuses || (STATE.tc ? [{id:'tc1',y:STATE.tc.y,x1:STATE.tc.x1,x2:STATE.tc.x2,label:'LTC / MTC',color:'#555',visible:STATE.tcVisible!==false}] : [{id:'tc1',y:148,x1:30,x2:1900,label:'LTC / MTC',color:'#555',visible:true}]);
let notes = STATE.notes || [];
let zones = STATE.zones || [];
const customDeviceTypes = STATE.customDeviceTypes || [];
const DEVTYPE_COLORS = {
  'video-server':'#4a9eff','touchdesigner':'#aa66cc',
  'audio-console':'#1a6aaa','audio-interface':'#1a9aaa',
  'broadcast':'#cc4444','timecode':'#ff9900',
  'led-processor':'#22aa66','light-console':'#ffbb33',
  'video-capture':'#e67e22',
  '':null,
};
function getDevtypeColor(dt){
  if(!dt) return null;
  const c=customDeviceTypes.find(x=>x.id===dt);
  if(c) return c.color;
  return DEVTYPE_COLORS[dt]||null;
}

const SVG_NS='http://www.w3.org/2000/svg';
const mk=t=>document.createElementNS(SVG_NS,t);
const sa=(el,a)=>{Object.entries(a).forEach(([k,v])=>el.setAttribute(k,v));return el;};
const svg=document.getElementById('diagram');
const ZL=document.getElementById('zl');
const EL=document.getElementById('el');
const TL=document.getElementById('tl');
const XL=document.getElementById('xl');
const NL=document.getElementById('nl');
const nb=id=>nodes.find(n=>n.id===id);
const cx=n=>n.x+n.w/2;
const cy=n=>n.y+n.h/2;
const vb={x:0,y:0,z:1};

function getVPSize(){const cw=document.getElementById('cw');return{w:cw.clientWidth,h:cw.clientHeight};}
function applyVB(){
  const{w,h}=getVPSize();
  svg.setAttribute('viewBox',\`\${vb.x} \${vb.y} \${w/vb.z} \${h/vb.z}\`);
  svg.setAttribute('width',w);svg.setAttribute('height',h);
}
function zoomAt(mx,my,newZ){
  newZ=Math.min(4,Math.max(0.1,newZ));
  const wx=vb.x+mx/vb.z,wy=vb.y+my/vb.z;
  vb.z=newZ;vb.x=wx-mx/vb.z;vb.y=wy-my/vb.z;applyVB();
}

function rZones(){
  ZL.innerHTML='';
  zones.forEach(z=>{
    const g=mk('g');
    const col=z.color||'#4a9eff';
    const collH=26;
    if(z.collapsed){
      g.appendChild(sa(mk('rect'),{x:z.x,y:z.y,width:z.w,height:collH,rx:4,
        fill:col,'fill-opacity':'0.18',stroke:col,'stroke-width':'1.5',class:'zone-rect'}));
      const lbl=sa(mk('text'),{x:z.x+10,y:z.y+collH/2,fill:col,
        'font-family':'Arial,sans-serif','font-size':'11','font-weight':'bold',
        'dominant-baseline':'middle','pointer-events':'none',class:'zone-lbl-text'});
      lbl.textContent=(z.label||'')+'  ▶'; g.appendChild(lbl);
    } else {
      g.appendChild(sa(mk('rect'),{x:z.x,y:z.y,width:z.w,height:z.h,rx:8,
        fill:col,'fill-opacity':'0.07',stroke:col,'stroke-width':'1.5','stroke-dasharray':'7,4',class:'zone-rect'}));
      const lbl=sa(mk('text'),{x:z.x+10,y:z.y+16,fill:col,
        'font-family':'Arial,sans-serif','font-size':'11','font-weight':'bold',
        'pointer-events':'none',class:'zone-lbl-text'});
      lbl.textContent=z.label||''; g.appendChild(lbl);
    }
    ZL.appendChild(g);
  });
}
function rEdges(){
  EL.innerHTML='';
  edges.forEach(e=>{
    const fn=nb(e.from),tn=nb(e.to);if(!fn||!tn)return;
    if(!e.wp)e.wp=[];
    const fz=collapsedZoneOf(fn),tz=collapsedZoneOf(tn);
    if(fz&&tz&&fz===tz)return;
    const effFn=fz?zoneBar(fz):fn,effTn=tz?zoneBar(tz):tn;
    const useWP=!fz&&!tz?e.wp:[];
    const p1=useWP.length?bpt(effFn,useWP[0].x,useWP[0].y):bpt(effFn,effTn.x+effTn.w/2,effTn.y+effTn.h/2);
    const p2=useWP.length?bpt(effTn,useWP[useWP.length-1].x,useWP[useWP.length-1].y):bpt(effTn,effFn.x+effFn.w/2,effFn.y+effFn.h/2);
    const chain=[p1,...useWP.map(p=>({...p})),p2];
    const pts=chain.map(p=>p.x+','+p.y).join(' ');
    EL.appendChild(sa(mk('polyline'),{points:pts,class:'edge'+(e.style==='dashed'?' dashed':''),'marker-end':'url(#arr)',fill:'none'}));
    if(e.label){
      const mx=(chain[0].x+chain[chain.length-1].x)/2,my=(chain[0].y+chain[chain.length-1].y)/2;
      const lw=e.label.length*5.5+10;
      EL.appendChild(sa(mk('rect'),{x:mx-lw/2,y:my-7,width:lw,height:13,class:'edge-lbl-bg'}));
      const lt=sa(mk('text'),{x:mx,y:my,class:'edge-lbl'});lt.textContent=e.label;EL.appendChild(lt);
    }
  });
}
function rTC(){
  TL.innerHTML='';
  tcBuses.forEach(bus=>{
    if(!bus.visible)return;
    const col=bus.color||'#555';
    TL.appendChild(sa(mk('line'),{x1:bus.x1,y1:bus.y,x2:bus.x2,y2:bus.y,class:'tc-rail',stroke:col,'stroke-width':'2','stroke-dasharray':'10,5'}));
    const lbl=sa(mk('text'),{x:bus.x1+10,y:bus.y-10,class:'tc-rail-lbl',fill:col});
    lbl.textContent='— — — '+(bus.label||'TIMECODE BUS')+' — — —';TL.appendChild(lbl);
    nodes.filter(n=>n.tcOut&&!collapsedZoneOf(n)).forEach(n=>{
      const nx=cx(n);if(bus.y>=n.y-3)return;
      TL.appendChild(sa(mk('line'),{x1:nx,y1:n.y,x2:nx,y2:bus.y,stroke:'#333','stroke-width':'1.5','stroke-dasharray':'4,3'}));
      const sl=sa(mk('text'),{x:nx+5,y:(n.y+bus.y)/2,class:'tc-lbl',fill:col});sl.textContent='TC out';TL.appendChild(sl);
    });
    nodes.filter(n=>n.tc&&!collapsedZoneOf(n)).forEach(n=>{
      const nx=cx(n);if(bus.y>=n.y-3)return;
      TL.appendChild(sa(mk('line'),{x1:nx,y1:bus.y,x2:nx,y2:n.y,class:'tc-tap','marker-end':'url(#arr-sm)'}));
      const tl=sa(mk('text'),{x:nx+5,y:(bus.y+n.y)/2,class:'tc-lbl',fill:col});tl.textContent='TC';TL.appendChild(tl);
    });
  });
}
function rNodes(){
  NL.innerHTML='';
  nodes.forEach(n=>{
    if(collapsedZoneOf(n)) return;
    const g=mk('g');g.setAttribute('class','node-group');
    const titleLines=wrapText(n.title||'',n.w-16,12);
    const sub1Lines=wrapText(n.sub1||'',n.w-16,10);
    const sub2Lines=wrapText(n.sub2||'',n.w-16,10);
    const LH=14,PAD=10;
    const autoH=Math.max(n.h,(titleLines.length+sub1Lines.length+sub2Lines.length)*LH+PAD*2);
    g.appendChild(sa(mk('rect'),{x:n.x,y:n.y,width:n.w,height:autoH,rx:3,
      class:'node-rect'+(n.style==='output'?' output':n.style==='highlight'?' highlight':n.style==='audio'?' audio':'')}));
    const dtCol=getDevtypeColor(n.deviceType);
    if(dtCol) g.appendChild(sa(mk('rect'),{x:n.x,y:n.y,width:n.w,height:3,rx:2,fill:dtCol,'pointer-events':'none'}));
    let curY=n.y+PAD+LH/2;
    const rl=(lines,cls)=>lines.forEach(l=>{const t=sa(mk('text'),{x:n.x+n.w/2,y:curY,class:cls});t.textContent=l;g.appendChild(t);curY+=LH;});
    rl(titleLines,'node-title');rl(sub1Lines,'node-sub');rl(sub2Lines,'node-sub');
    let sx,sy,snx,sny,moved=false;
    g.addEventListener('mousedown',ev=>{
      if(ev.button)return;ev.stopPropagation();ev.preventDefault();
      sx=ev.clientX;sy=ev.clientY;snx=n.x;sny=n.y;moved=false;
      const mm=e=>{const dx=(e.clientX-sx)/vb.z,dy=(e.clientY-sy)/vb.z;
        if(Math.abs(dx)>2||Math.abs(dy)>2){moved=true;n.x=Math.max(0,snx+dx);n.y=Math.max(0,sny+dy);rEdges();rTC();rNodes();}};
      const up=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',up);};
      document.addEventListener('mousemove',mm);document.addEventListener('mouseup',up);
    });
    NL.appendChild(g);
  });
}
function rNotes(){
  XL.innerHTML='';
  notes.forEach(note=>{
    const g=mk('g');
    const PAD=8,LH=15;
    const words=(note.text||'').split(' '),lines=[];let cur='';
    const cpl=Math.floor((note.w-PAD*2)/(11*0.6));
    words.forEach(w=>{const t=cur?cur+' '+w:w;if(t.length<=cpl)cur=t;else{if(cur)lines.push(cur);cur=w;}});
    if(cur)lines.push(cur);if(!lines.length)lines.push('');
    const minH=Math.max(note.h,lines.length*LH+PAD*2+4);
    g.appendChild(sa(mk('rect'),{x:note.x,y:note.y,width:note.w,height:minH,rx:4,
      fill:note.color||'#fffbe6',stroke:'#bbb','stroke-width':'1'}));
    let curY=note.y+PAD+LH/2;
    lines.forEach(l=>{
      const t=sa(mk('text'),{x:note.x+PAD,y:curY,'font-family':'Arial,sans-serif',
        'font-size':'11',fill:'#444','dominant-baseline':'middle'});
      t.textContent=l;g.appendChild(t);curY+=LH;
    });
    XL.appendChild(g);
  });
}
function rAll(){rZones();rEdges();rTC();rNotes();rNodes();}

// pan
let spaceHeld=false,panning=false,panStart={x:0,y:0},vbStart={x:0,y:0};
document.addEventListener('keydown',ev=>{if(ev.code==='Space'&&!spaceHeld){spaceHeld=true;document.body.classList.add('space-held');ev.preventDefault();}});
document.addEventListener('keyup',ev=>{if(ev.code==='Space'){spaceHeld=false;document.body.classList.remove('space-held');}});
document.getElementById('cw').addEventListener('mousedown',ev=>{
  if(ev.button===1||(ev.button===0&&spaceHeld)){
    ev.preventDefault();panning=true;panStart={x:ev.clientX,y:ev.clientY};vbStart={x:vb.x,y:vb.y};
    document.body.classList.add('panning');
    const mm=e=>{vb.x=vbStart.x-(e.clientX-panStart.x)/vb.z;vb.y=vbStart.y-(e.clientY-panStart.y)/vb.z;applyVB();};
    startDrag(mm, ()=>{panning=false;document.body.classList.remove('panning');});
  }
});
document.getElementById('cw').addEventListener('wheel',ev=>{
  ev.preventDefault();
  const cw=document.getElementById('cw'),rect=cw.getBoundingClientRect();
  if(ev.ctrlKey||ev.metaKey){zoomAt(ev.clientX-rect.left,ev.clientY-rect.top,vb.z+(ev.deltaY>0?-0.12:0.12));}
  else{vb.x+=ev.deltaX/vb.z;vb.y+=ev.deltaY/vb.z;applyVB();}
},{passive:false});
window.addEventListener('resize',applyVB);

// fit on load
function fitAll(){
  let mnX=9999,mnY=9999,mxX=0,mxY=0;
  nodes.forEach(n=>{mnX=Math.min(mnX,n.x);mnY=Math.min(mnY,n.y);mxX=Math.max(mxX,n.x+n.w);mxY=Math.max(mxY,n.y+n.h);});
  const{w,h}=getVPSize(),pad=60,cw=mxX-mnX+pad*2,ch=mxY-mnY+pad*2;
  vb.z=Math.min(4,Math.max(0.1,Math.min(w/cw,h/ch)));
  vb.x=mnX-pad;vb.y=mnY-pad;applyVB();
}

applyVB();rAll();setTimeout(fitAll,80);
${'<'}/script>
</body>
</html>`;

  dl(URL.createObjectURL(new Blob([html],{type:'text/html'})), 'show-signal-flow-client.html');
}

function resetLayout(){
  // kept for compatibility but redirects to welcome
  resetToWelcome();
}

function resetToWelcome(){
  if(!confirm('Сбросить проект? Несохранённые изменения будут потеряны.')) return;
  _closeEditors();
  nodes=[]; edges=[]; tcBuses=[{...DTC_BUS}]; notes=[]; zones=[]; customDeviceTypes=[];
  _ngCache.clear(); _ntCache.clear(); _zcCache.clear(); _egCache.clear();
  rebuildDevTypeSelects();
  currentFilePath=null;
  undoStack.length=0; redoStack.length=0;
  const btn=document.getElementById('btn-tc');
  if(btn) btn.classList.add('active');
  document.title='Show Signal Flow — ' + APP_VERSION;
  showWelcome();
}

// ═══════════════════════════════════════════════════════════
// LOCALSTORAGE SAVE / LOAD
// ═══════════════════════════════════════════════════════════
// SAVE / LOAD  (Electron → файл, браузер → localStorage)
// ═══════════════════════════════════════════════════════════
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
const LS_KEY = 'show_flow_v2';
let currentFilePath = null;

function getStateJSON(){
  return JSON.stringify({nodes, edges, tcBuses, notes, zones, customDeviceTypes});
}

function validateAndSanitize(s){
  const warn=[];
  if(typeof s!=='object'||!s) throw new Error('Ожидается JSON-объект');

  // nodes
  if(!Array.isArray(s.nodes)) s.nodes=[];
  s.nodes=s.nodes.filter((n,i)=>{
    if(typeof n!=='object'||!n){ warn.push(`Нода [${i}]: не объект — пропущена`); return false; }
    if(!n.id){ n.id='n'+crypto.randomUUID().split('-')[0]; }
    if(typeof n.x!=='number') n.x=0;
    if(typeof n.y!=='number') n.y=0;
    if(typeof n.w!=='number'||n.w<10) n.w=175;
    if(typeof n.h!=='number'||n.h<10) n.h=58;
    // strip HTML-тегов чтобы исключить XSS при экспорте
    const st=v=>typeof v==='string'?v.replace(/<[^>]*>/g,''):v;
    n.title=st(n.title)||'Нода';
    n.sub1=st(n.sub1||''); n.sub2=st(n.sub2||'');
    if(n.label) n.label=st(n.label);
    n.style=n.style||'normal';
    n.tc=!!n.tc; // boolean
    if(!n.wp) n.wp=undefined;
    return true;
  });

  // Дедупликация ID нод — повторный ID переименовывается, чтобы не было «призраков»
  const _seenN=new Set();
  s.nodes.forEach(n=>{
    if(_seenN.has(n.id)){
      const old=n.id;
      n.id='n'+crypto.randomUUID().split('-')[0];
      warn.push(`Нода «${old}»: дублирующийся ID — переименована в «${n.id}»`);
    }
    _seenN.add(n.id);
  });

  // edges — удаляем ссылки на несуществующие ноды, петли, невалидные waypoints
  const nodeIds=new Set(s.nodes.map(n=>n.id));
  if(!Array.isArray(s.edges)) s.edges=[];
  s.edges=s.edges.filter((e,i)=>{
    if(typeof e!=='object'||!e){ warn.push(`Связь [${i}]: не объект — пропущена`); return false; }
    if(!e.id||!e.from||!e.to){ warn.push(`Связь [${i}]: нет id/from/to — пропущена`); return false; }
    if(e.from===e.to){ warn.push(`Связь ${e.id}: петля (from===to) — пропущена`); return false; }
    if(!nodeIds.has(e.from)){ warn.push(`Связь ${e.id}: нода «${e.from}» не найдена — пропущена`); return false; }
    if(!nodeIds.has(e.to)){ warn.push(`Связь ${e.id}: нода «${e.to}» не найдена — пропущена`); return false; }
    // waypoints: оставляем только валидные {x:number, y:number}
    if(!Array.isArray(e.wp)) e.wp=[];
    e.wp=e.wp.filter(p=>p&&typeof p.x==='number'&&typeof p.y==='number');
    e.style=e.style||'solid';
    // C1: санитизация label рёбра (как ноды)
    if(e.label) e.label=typeof e.label==='string'?e.label.replace(/<[^>]*>/g,''):'';
    return true;
  });

  // Дедупликация ID рёбер
  const _seenE=new Set();
  s.edges.forEach(e=>{
    if(_seenE.has(e.id)){
      const old=e.id;
      e.id='e'+crypto.randomUUID().split('-')[0];
      warn.push(`Связь «${old}»: дублирующийся ID — переименована в «${e.id}»`);
    }
    _seenE.add(e.id);
  });

  // tcBuses (backward compat with old tc/tcVisible format)
  if(!Array.isArray(s.tcBuses)||!s.tcBuses.length){
    const oldTc = (typeof s.tc==='object'&&s.tc) ? s.tc : {};
    s.tcBuses=[{...DTC_BUS, y:oldTc.y||DTC_BUS.y, x1:oldTc.x1||DTC_BUS.x1, x2:oldTc.x2||DTC_BUS.x2, visible:s.tcVisible!==false}];
  }
  s.tcBuses=s.tcBuses.map(b=>({...DTC_BUS,...b}));

  // notes
  if(!Array.isArray(s.notes)) s.notes=[];
  s.notes=s.notes.filter(n=>typeof n==='object'&&n&&n.id);

  // zones
  if(!Array.isArray(s.zones)) s.zones=[];
  s.zones=s.zones.filter(z=>{
    if(typeof z!=='object'||!z||!z.id) return false;
    if(typeof z.x!=='number') z.x=0;
    if(typeof z.y!=='number') z.y=0;
    if(typeof z.w!=='number'||z.w<10) z.w=200;
    if(typeof z.h!=='number'||z.h<10) z.h=100;
    return true;
  });

  // customDeviceTypes
  if(!Array.isArray(s.customDeviceTypes)) s.customDeviceTypes=[];
  s.customDeviceTypes=s.customDeviceTypes.filter(c=>{
    if(typeof c!=='object'||!c||!c.id||!c.label) return false;
    if(!c.color) c.color='#888888';
    return true;
  });

  return warn;
}

function applyState(s){
  _closeEditors(); // стейт изменился — все открытые редакторы невалидны
  if(s.nodes) nodes = s.nodes;
  if(s.edges) edges = s.edges;
  _restoreTCBuses(s);
  if(s.notes) notes = s.notes; else notes = [];
  if(s.zones) zones = s.zones; else zones = [];
  if(s.customDeviceTypes) customDeviceTypes = s.customDeviceTypes; else customDeviceTypes = [];
  rebuildDevTypeSelects();
}

function setSaveBtn(text, ok){
  const btn=document.getElementById('btn-save');
  if(!btn) return;
  btn.textContent = text;
  btn.style.color = ok ? '#6f6' : '';
  if(ok) setTimeout(()=>{ btn.textContent='💾 Сохранить'; btn.style.color=''; }, 1400);
}

// ── FILE SAVE ─────────────────────────────────────────────
async function fileSave(){
  const json = getStateJSON();
  if(IS_ELECTRON){
    const res = await window.electronAPI.saveProject(json);
    if(res.ok){
      currentFilePath = res.filePath;
      setSaveBtn('✓ Сохранено', true);
      // update title
      document.title = 'Show Signal Flow — ' + res.filePath.split(/[\\/]/).pop();
    } else {
      setSaveBtn('✗ Ошибка', false);
    }
  } else {
    // Browser fallback
    try {
      localStorage.setItem(LS_KEY, json);
      setSaveBtn('✓ Сохранено', true);
    } catch(e){ alert('Ошибка: '+e.message); }
  }
}

// ── FILE OPEN ─────────────────────────────────────────────
async function fileOpen(){
  if(IS_ELECTRON){
    const res = await window.electronAPI.loadProject();
    if(!res.ok) return;
    try {
      const raw = JSON.parse(res.data);
      const warnings = validateAndSanitize(raw);
      applyState(raw);
      currentFilePath = res.filePath;
      document.title = 'Show Signal Flow — ' + res.filePath.split(/[\\/]/).pop();
      undoStack.length=0; redoStack.length=0;
      applyVB(); rAll();
      setTimeout(zoomReset, 80);
      if(warnings.length){
        console.warn('⚠ Show Signal Flow: предупреждения при открытии файла:', warnings);
        setTimeout(()=>{
          alert(`Файл открыт с предупреждениями (${warnings.length}):\n${warnings.slice(0,5).join('\n')}${warnings.length>5?'\n…и ещё '+(warnings.length-5):''}`)
        }, 200);
      }
    } catch(e){ alert('Ошибка чтения файла:\n'+e.message); }
  } else {
    // Browser: не поддерживается
    alert('Открытие файлов доступно только в приложении.');
  }
}

// ── AUTOSAVE ─────────────────────────────────────────────
async function autoSave(){
  const json = getStateJSON();
  if(IS_ELECTRON && currentFilePath){
    await window.electronAPI.autosave(json, currentFilePath);
  } else if(!IS_ELECTRON){
    try { localStorage.setItem(LS_KEY, json); } catch(e){}
  }
}

// ── INITIAL LOAD ──────────────────────────────────────────
function initialLoad(){
  if(!IS_ELECTRON){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if(raw){
        const s=JSON.parse(raw);
        validateAndSanitize(s);
        applyState(s);
        return true;
      }
    } catch(e){ console.warn('initialLoad: ошибка чтения localStorage:', e); }
  }
  return false;
}

// patch snapshot for autosave
const _origSnapshot = snapshot;
window.snapshot = function(label=''){
  _origSnapshot(label);
  clearTimeout(window._asTimer);
  window._asTimer = setTimeout(autoSave, 800);
};

// Ctrl+S / Ctrl+O
document.addEventListener('keydown', ev=>{
  if((ev.ctrlKey||ev.metaKey) && ev.code==='KeyS'){ ev.preventDefault(); fileSave(); }
  if((ev.ctrlKey||ev.metaKey) && ev.code==='KeyO'){ ev.preventDefault(); fileOpen(); }
});

// Electron menu hooks
if(IS_ELECTRON){
  window.electronAPI.onMenuSave(() => fileSave());
  window.electronAPI.onMenuOpen(() => fileOpen());
}

// autosave before close
window.addEventListener('beforeunload', ()=>{ autoSave(); });

// ═══════════════════════════════════════════════════════════
// PAN + ZOOM (viewBox engine)
// ═══════════════════════════════════════════════════════════

function getVPSize(){
  const cw=document.getElementById('cw');
  return { w: cw.clientWidth, h: cw.clientHeight };
}

// P5: rAF-throttling для applyVB — scroll/resize не перегружают paint
let _applyVBPending=false;
function applyVB(){
  if(_applyVBPending) return;
  _applyVBPending=true;
  requestAnimationFrame(()=>{
    _applyVBPending=false;
    const {w,h}=getVPSize();
    const vbW=w/vb.z, vbH=h/vb.z;
    svg.setAttribute('viewBox',`${vb.x} ${vb.y} ${vbW} ${vbH}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    const bz=document.getElementById('btn-zoom');
    if(bz) bz.textContent=Math.round(vb.z*100)+'%';
    rMinimap();
    updateHintBar();
  });
}

function zoomAt(cx,cy,newZ){
  // cx,cy in screen coords — zoom toward that point
  newZ = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZ));
  const {w,h}=getVPSize();
  // world point under cursor before zoom
  const wx = vb.x + cx/vb.z;
  const wy = vb.y + cy/vb.z;
  vb.z = newZ;
  // shift so same world point stays under cursor
  vb.x = wx - cx/vb.z;
  vb.y = wy - cy/vb.z;
  applyVB();
}

function zoomIn() { const {w,h}=getVPSize(); zoomAt(w/2,h/2,+(vb.z+ZOOM_STEP).toFixed(3)); }
function zoomOut(){ const {w,h}=getVPSize(); zoomAt(w/2,h/2,+(vb.z-ZOOM_STEP).toFixed(3)); }
function zoomReset(){
  const {w,h}=getVPSize();
  if(!nodes.length){ vb.x=0; vb.y=0; vb.z=1; applyVB(); return; }
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  nodes.forEach(n=>{ mnX=Math.min(mnX,n.x); mnY=Math.min(mnY,n.y); mxX=Math.max(mxX,n.x+n.w); mxY=Math.max(mxY,n.y+n.h); });
  const pad=60, cw=mxX-mnX+pad*2, ch=mxY-mnY+pad*2;
  vb.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(w/cw, h/ch)));
  vb.x = mnX-pad; vb.y = mnY-pad;
  applyVB();
}

// Ctrl+wheel = zoom, plain wheel = pan
document.getElementById('cw').addEventListener('wheel', ev=>{
  ev.preventDefault();
  const cw=document.getElementById('cw');
  const rect=cw.getBoundingClientRect();
  const mx=ev.clientX-rect.left, my=ev.clientY-rect.top;
  if(ev.ctrlKey||ev.metaKey){
    const delta = ev.deltaY>0 ? -ZOOM_STEP : ZOOM_STEP;
    zoomAt(mx, my, +(vb.z+delta).toFixed(3));
  } else {
    // pan with wheel
    vb.x += ev.deltaX / vb.z;
    vb.y += ev.deltaY / vb.z;
    applyVB();
  }
},{passive:false});

// PAN: Space+drag OR middle mouse button
let spaceHeld=false, panning=false, panStart={x:0,y:0}, vbStart={x:0,y:0};

document.addEventListener('keydown', ev=>{
  // Ctrl+F: перехватываем до блокировки INPUT
  if(ev.code==='KeyF'&&(ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); openSearch(); return; }
  if(document.getElementById('qed').style.display==='block'){
    if(ev.key==='Escape'){ closeQE(); ev.preventDefault(); return; }
    if(ev.key==='Enter' && !ev.shiftKey){ saveQE(); ev.preventDefault(); return; }
  }
  if(ev.target.tagName==='INPUT'||ev.target.tagName==='TEXTAREA') return;
  if(ev.code==='Space' && !spaceHeld){ spaceHeld=true; document.body.classList.add('space-held'); ev.preventDefault(); }
  if(ev.code==='KeyV'&&!ev.ctrlKey&&!ev.metaKey) setMode('select');
  if(ev.code==='KeyE'&&!ev.ctrlKey&&!ev.metaKey) toggleConnect();
  if(ev.key==='Escape'){
    if(mode==='connect'){ setMode('select'); }
    else { clearSelection(); }
    cp('ned'); cp('eed');
  }
  if(ev.key==='Delete'||ev.key==='Backspace'){
    if(selectedIds.size>0){
      snapshot('Удалить ноды');
      [...selectedIds].forEach(id=>removeNode(id));
      selectedIds.clear(); selected=null; rAll();
    }
  }
  if(ev.code==='KeyA'&&(ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); selectAll(); }
  if(ev.code==='KeyC'&&(ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); copyNodes(); }
  if(ev.code==='KeyV'&&(ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); pasteNodes(); }
  if(ev.code==='KeyZ'&&(ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); undo(); }
  if(ev.code==='KeyY'&&(ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); redo(); }
  if((ev.ctrlKey||ev.metaKey)&&(ev.key==='='||ev.key==='+')){ ev.preventDefault(); zoomIn(); }
  if((ev.ctrlKey||ev.metaKey)&&ev.key==='-'){ ev.preventDefault(); zoomOut(); }
  if((ev.ctrlKey||ev.metaKey)&&ev.key==='0'){ ev.preventDefault(); zoomReset(); }
});

document.addEventListener('keyup', ev=>{
  if(ev.code==='Space'){ spaceHeld=false; document.body.classList.remove('space-held'); }
});

document.getElementById('cw').addEventListener('mousedown', ev=>{
  if(!ev.target.closest('#qed')) closeQE();
  // middle mouse or space+left = pan
  if(ev.button===1 || (ev.button===0 && spaceHeld)){
    ev.preventDefault();
    panning=true;
    panStart={x:ev.clientX, y:ev.clientY};
    vbStart={x:vb.x, y:vb.y};
    document.body.classList.add('panning');
    const mm=e=>{
      if(!panning) return;
      vb.x = vbStart.x - (e.clientX-panStart.x)/vb.z;
      vb.y = vbStart.y - (e.clientY-panStart.y)/vb.z;
      applyVB();
    };
    startDrag(mm, ()=>{
      panning=false;
      document.body.classList.remove('panning');
    });
  }
});

// ═══════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════
function showCtxMenu(items, x, y){
  const m=document.getElementById('ctx-menu');
  m.innerHTML='';
  items.forEach(it=>{
    if(it.sep){ m.appendChild(Object.assign(document.createElement('div'),{className:'ctx-sep'})); return; }
    if(it.group){ const d=document.createElement('div'); d.className='ctx-group-lbl'; d.textContent=it.group; m.appendChild(d); return; }
    const d=document.createElement('div');
    d.className='ctx-item'+(it.danger?' danger':'')+(it.disabled?' disabled':'');
    d.textContent=it.label;
    if(it.action) d.addEventListener('click',()=>{ hideCtxMenu(); it.action(); });
    m.appendChild(d);
  });
  // позиционирование с учётом границ экрана
  m.style.display='block';
  const mw=m.offsetWidth, mh=m.offsetHeight;
  m.style.left=Math.min(x, window.innerWidth-mw-8)+'px';
  m.style.top=Math.min(y, window.innerHeight-mh-8)+'px';
}
function hideCtxMenu(){ document.getElementById('ctx-menu').style.display='none'; }

function ctxNode(node, ev){
  showCtxMenu([
    {label:'📋  Свойства…', action:()=>openNE(node,ev)},
    {label:'✏️  Переименовать', action:()=>openQE(node,ev)},
    {label:'⧉  Дублировать', action:()=>{
      snapshot('Дублировать ноду');
      const n2={...JSON.parse(JSON.stringify(node)), id:uid(), x:node.x+20, y:node.y+20};
      nodes.push(n2); rAll();
    }},
    {sep:true},
    {label:'🗑  Удалить', danger:true, action:()=>{
      snapshot('Удалить ноду'); removeNode(node.id); rAll();
    }},
  ], ev.clientX, ev.clientY);
}
function ctxEdge(edge, ev){
  showCtxMenu([
    {label:'✏️  Изменить метку', action:()=>openEE(edge,ev)},
    {label:'✕  Удалить точки маршрута', disabled:!edge.wp||!edge.wp.length, action:()=>{
      snapshot('Сбросить маршрут'); edge.wp=[]; rEdges();
    }},
    {sep:true},
    {label:'🗑  Удалить связь', danger:true, action:()=>{
      snapshot('Удалить связь'); edges=edges.filter(e=>e.id!==edge.id); rEdges();
    }},
  ], ev.clientX, ev.clientY);
}
function ctxZone(zone, ev){
  showCtxMenu([
    {label:'✏️  Редактировать', action:()=>openZoneEditor(zone,ev)},
    {label: zone.collapsed?'▼  Развернуть':'▲  Свернуть', action:()=>{
      snapshot(zone.collapsed?'Развернуть зону':'Свернуть зону');
      zone.collapsed=!zone.collapsed; rAll();
    }},
    {sep:true},
    {label:'🗑  Удалить зону', danger:true, action:()=>{
      snapshot('Удалить зону'); zones=zones.filter(z=>z.id!==zone.id); rAll();
    }},
  ], ev.clientX, ev.clientY);
}
function ctxCanvas(ev){
  const items=[
    {group:'Добавить'},
    {label:'＋  Нода', action:()=>addNode()},
    {label:'☐  Зона', action:()=>addZone()},
    {label:'📝  Заметка', action:()=>addNote()},
  ];
  if(clipboard&&clipboard.length){
    items.push({sep:true});
    items.push({label:`📋  Вставить (${clipboard.length})`, action:()=>pasteNodes()});
  }
  showCtxMenu(items, ev.clientX, ev.clientY);
}

document.getElementById('cw').addEventListener('contextmenu',ev=>{
  ev.preventDefault();
  if(mode==='connect') return;
  const nodeGrp=ev.target.closest('.node-group');
  const zoneGrp=ev.target.closest('.zone-group');
  const edgeEl=ev.target.closest('.edge-hit');
  if(nodeGrp){
    const n=nb(nodeGrp.dataset.id); if(n) ctxNode(n,ev);
  } else if(edgeEl){
    const eid=edgeEl.dataset.eid;
    const e=edges.find(x=>x.id===eid); if(e) ctxEdge(e,ev);
  } else if(zoneGrp){
    const p=svgCoords(ev);
    const z=zones.find(z2=>p.x>=z2.x&&p.x<=z2.x+z2.w&&p.y>=z2.y&&p.y<=z2.y+(z2.collapsed?26:z2.h));
    if(z) ctxZone(z,ev); else ctxCanvas(ev);
  } else {
    ctxCanvas(ev);
  }
});

document.addEventListener('mousedown',ev=>{
  if(!ev.target.closest('#ctx-menu')) hideCtxMenu();
  if(!ev.target.closest('#more-menu,#btn-more')) hideMoreMenu();
  if(!ev.target.closest('#net-export-menu,#btn-net-export')) closeNetExportMenu();
},{capture:true});

// resize handler
window.addEventListener('resize', applyVB);

// ═══════════════════════════════════════════════════════════
// NETWORK STRUCTURE PANEL
// ═══════════════════════════════════════════════════════════
function nodeInZone(n, z){
  const ncx = n.x + n.w / 2;
  const ncy = n.y + nodeH(n) / 2;
  return ncx >= z.x && ncx <= z.x + z.w && ncy >= z.y && ncy <= z.y + z.h;
}

// ── NETWORK PANEL ──────────────────────────────────────────
let _netSearch = '';
let _netZoneFilter = '';
let _netShowTopo = true;
let _netExportMenuOpen = false;

// ══════════════════════════════════════════════════════════
// AUTO-NET: профили протоколов шоу-сетей
// ══════════════════════════════════════════════════════════
//
// Источники стандартов:
//  ArtNet   — 2.x.x.x/8 (исторически) или 10.x.x.x/8 (современно).
//             Art-Net 4 Spec §4: "Primary network: 10.x.x.x"
//             Вся световая сеть — одна большая /8, чтобы устройства
//             видели друг друга broadcast'ом (255.0.0.0).
//
//  sACN     — обычно сосуществует с ArtNet на той же подсети,
//             multicast 239.255.x.x задаётся автоматически контроллером.
//
//  NDI      — требует managed сети, рекомендованный диапазон 192.168.10.x/24
//             или выделенный VLAN. Multicast: 224.0.0.x (mDNS Bonjour).
//             Требует QoS и IGMP Snooping на коммутаторах.
//
//  Dante    — ВСЕГДА на отдельной подсети от остального трафика.
//             Primary: 192.168.20.x/24, Redundant: 192.168.21.x/24.
//             Dante Controller распределяет адреса автоматически через DHCP
//             или статика на 169.254.x.x (link-local).
//
//  OSC/Control — 192.168.1.x/24 — стандартный диапазон для управляющих ПК
//             (QLab, TouchDesigner, Medialon, Crestron, ETC Unison).
//
//  Intercom — 192.168.50.x/24 (Riedel, Clear-Com FreeSpeak II и др.).
//
//  Timecode/PTP — сосуществует с другими, требует PTPv2 (IEEE 1588).
//
const _NET_PROFILES = [
  {
    id: 'artnet',
    name: 'ArtNet / sACN — Свет, DMX',
    // Art-Net 4 Spec §4: modern standard 10.x.x.x/8 (legacy: 2.x.x.x/8, GrandMA2 default).
    // Вся световая сеть — одна /8 чтобы все видели друг друга broadcast'ом.
    // GrandMA2 дефолт: 2.x.x.x; GrandMA3 — оба; ETC Eos предпочитает sACN.
    // ArtNet НЕ требует шлюза — это flat broadcast сеть без маршрутизации.
    // sACN (E1.31) сосуществует в той же подсети, multicast 239.255.0.U.
    desc: 'GrandMA2 (2.x.x.x default), GrandMA3, Avolites, ChamSys MQ, Hog — ETC Eos/Ion предпочитают sACN в той же сети',
    subnet: '10.0.0',
    mask: '/8',
    maskDot: '255.0.0.0',
    gw: '',            // ArtNet не требует шлюза — broadcast /8, нет маршрутизации
    ipStart: 10,
    color: '#f59e0b',
    kw: ['artnet','arnet','dmx','свет','light','lighting','пульт света','световой',
         'grandma','grand ma','ma2','ma3','eos','ion','avolites','chamsys','hog','hog4',
         'cobra','enttec','dmx node','artnet node','dmxking','lumenradio','lmr',
         'led','pixel','пиксель','strobe','строб','laser','лазер','beam','wash',
         'follow spot','followspot','dimmer','диммер','driver','color','colour',
         'moving head','moving light','fixture','прибор']
  },
  {
    id: 'ndi',
    name: 'NDI / Video — Видео',
    // NDI требует выделенного Гигабит VLAN (mDNS/Bonjour для discovery).
    // ~125 Мбит/с на 1080p60 поток. Если несколько подсетей — нужен NDI Discovery Server.
    // Resolume Arena, Disguise gx/rx, Watchout 6+, Vizrt TriCaster — native NDI.
    desc: 'Resolume, Disguise, Watchout, Pandora\'s Box, NDI-камеры, видеосерверы, проекторы',
    subnet: '192.168.10',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '192.168.10.1',
    ipStart: 10,
    color: '#06b6d4',
    kw: ['ndi','видео','video','камера','camera','capture','захват','stream','стрим',
         'resolume','disguise','watchout','pandora','notch','vj','vjing',
         'pixelmapper','pixel mapper','media server','медиасервер',
         'projection','проектор','projector','screen','экран','led wall','led экран',
         'visual','visuals','hybe','arkaos','madmapper','smode','tricaster',
         'switcher','видеомикшер','vmix','obs','encoder','кодер']
  },
  {
    id: 'dante',
    name: 'Dante / AES67 — Аудио',
    // Audinate: первичная сеть — любая приватная /24, обычно DHCP.
    // Резервная сеть: 172.31.x.x/16 (официальный fallback Audinate при отсутствии DHCP).
    // Link-local fallback на первичной: 169.254.x.x. Требует managed switch с QoS.
    // Yamaha CL/QL — встроенный Dante; Allen&Heath dLive — Dante card; DiGiCo SD — Dante option.
    desc: 'Yamaha CL/QL, Allen&Heath dLive/SQ, DiGiCo SD, Midas PRO/M32, Avid S6L, QSC, BSS',
    subnet: '192.168.20',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '192.168.20.1',
    ipStart: 10,
    color: '#10b981',
    kw: ['dante','аудио','audio','звук','sound','звуковой','микшер','mixer',
         'yamaha','allen heath','allen & heath','a&h','dLive','dlive','sq','midas',
         'digico','behringer','avid','protools','pro tools','s6l','venue',
         'qsc','bss','crown','iem','monitor','мониторы','мониторы',
         'amplifier','усилитель','amp','speaker','sub','сабвуфер',
         'delay tower','sidefill','frontfill','pa','stage box','stagebox',
         'stagerak','interface','di box','rack','aes67','aes 67','ravenna',
         'wordclock','word clock','dante virtual soundcard']
  },
  {
    id: 'osc',
    name: 'OSC / Control — Управление',
    // OSC — application-layer UDP, нет стандартной подсети.
    // QLab: порт 53000 (входящий), 53001 (исходящий).
    // TouchDesigner OSC In CHOP: порт 7000 по умолчанию.
    // Рекомендация: делить VLAN с пультом или отдельная /24.
    desc: 'QLab, TouchDesigner, Medialon, Crestron, ETC Unison, Pharos, ПК режиссёра',
    subnet: '192.168.1',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '192.168.1.1',
    ipStart: 10,
    color: '#8b5cf6',
    kw: ['osc','qlab','touchdesigner','управление','control','controller',
         'автоматика','шоу-контроллер','show control','medialon','crestron','unison',
         'pharos','pathway','компьютер','pc','ноутбук','laptop','сервер','server',
         'tablet','планшет','ipad','app','приложение','robe rz','rz','timecode',
         'ltc','mtc','smpte','sync','синхро','stage manager','sm']
  },
  {
    id: 'intercom',
    name: 'Intercom — Интерком',
    // Riedel MediorNet, Clear-Com FreeSpeak II, Pliant CrewCom — IP intercom.
    // Нет стандартной подсети, 192.168.50.x/24 — распространённая практика.
    desc: 'Riedel, Clear-Com FreeSpeak II, Pliant CrewCom, матрицы интерком',
    subnet: '192.168.50',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '192.168.50.1',
    ipStart: 10,
    color: '#ec4899',
    kw: ['intercom','интерком','riedel','mediornet','clearcom','clear-com','freespeak',
         'pliant','crewcom','beltpack','пояс','headset','гарнитура','party line','matrix',
         'bolero','teatrix','связь']
  },
  {
    id: 'general',
    name: 'Прочие устройства',
    desc: 'Устройства без явного протокола',
    subnet: '192.168.100',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '192.168.100.1',
    ipStart: 10,
    color: '#6b7280',
    kw: [] // fallback — всё остальное
  }
];

// VLAN-режим (QLab Cookbook + Yamaha Dante Network Design Guide):
// VLAN 10 → ArtNet/sACN  10.10.0.0/16
// VLAN 20 → Dante primary 10.20.0.0/24
// VLAN 21 → Dante secondary 10.21.0.0/24 (настраивается вручную)
// VLAN 30 → NDI/Video      10.30.0.0/16
// VLAN 40 → Show Control   10.40.0.0/24
// VLAN 50 → Management/Intercom 10.50.0.0/24
const _NET_PROFILES_VLAN = [
  {
    id: 'artnet',
    name: 'VLAN 10 · ArtNet / sACN — Свет',
    desc: 'GrandMA2/3, ETC Eos/Ion, Avolites, ChamSys, Hog — VLAN 10 · 10.10.0.0/16',
    subnet: '10.10.0',
    mask: '/16',
    maskDot: '255.255.0.0',
    gw: '',            // ArtNet не требует шлюза — плоская /8 (или /16 в VLAN-режиме)
    ipStart: 10,
    color: '#f59e0b',
    kw: _NET_PROFILES.find(p=>p.id==='artnet').kw
  },
  {
    id: 'ndi',
    name: 'VLAN 30 · NDI / Video — Видео',
    desc: 'Resolume, Disguise, Watchout, NDI-камеры — VLAN 30 · 10.30.0.0/16',
    subnet: '10.30.0',
    mask: '/16',
    maskDot: '255.255.0.0',
    gw: '10.30.0.1',
    ipStart: 10,
    color: '#06b6d4',
    kw: _NET_PROFILES.find(p=>p.id==='ndi').kw
  },
  {
    id: 'dante',
    name: 'VLAN 20 · Dante / AES67 — Аудио',
    desc: 'Yamaha CL/QL, Allen&Heath dLive, DiGiCo, Midas — VLAN 20 · 10.20.0.0/24 · QoS DSCP EF(46)',
    subnet: '10.20.0',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '10.20.0.1',
    ipStart: 10,
    color: '#10b981',
    kw: _NET_PROFILES.find(p=>p.id==='dante').kw
  },
  {
    id: 'osc',
    name: 'VLAN 40 · OSC / Control — Управление',
    desc: 'QLab, TouchDesigner, Medialon, Crestron — VLAN 40 · 10.40.0.0/24',
    subnet: '10.40.0',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '10.40.0.1',
    ipStart: 10,
    color: '#8b5cf6',
    kw: _NET_PROFILES.find(p=>p.id==='osc').kw
  },
  {
    id: 'intercom',
    name: 'VLAN 50 · Intercom — Интерком',
    desc: 'Riedel, Clear-Com FreeSpeak, Pliant — VLAN 50 · 10.50.0.0/24',
    subnet: '10.50.0',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '10.50.0.1',
    ipStart: 10,
    color: '#ec4899',
    kw: _NET_PROFILES.find(p=>p.id==='intercom').kw
  },
  {
    id: 'general',
    name: 'VLAN 50 · Прочие устройства',
    desc: 'Устройства без явного протокола — Management VLAN 50',
    subnet: '10.50.1',
    mask: '/24',
    maskDot: '255.255.255.0',
    gw: '10.50.0.1',
    ipStart: 10,
    color: '#6b7280',
    kw: []
  }
];

// ══════════════════════════════════════════════════════════
// PORT REFERENCE — для отображения в диалоге и справке
// Источники: MA Lighting help, Audinate, NDI docs, TD docs
// ══════════════════════════════════════════════════════════
const _PORT_REFERENCE = [
  // ─── GrandMA2 ───
  { sys:'GrandMA2', proto:'MA-Net2 (сессия/ноды)', port:'ETH0 · 192.168.0.x/24', tp:'', note:'ETH1 отдельно для ArtNet 2.x.x.x' },
  { sys:'GrandMA2', proto:'Art-Net (DMX out)', port:'UDP 6454', tp:'UDP', note:'Только адаптер с 2.x.x.x — жёсткое ограничение' },
  { sys:'GrandMA2', proto:'sACN/E1.31', port:'UDP 5568', tp:'UDP', note:'На ETH0, multicast 239.255.0.U' },
  { sys:'GrandMA2', proto:'Telnet (управление)', port:'TCP 30000', tp:'TCP', note:'⚠ НЕ порт 23! Login "user pass"·MA2 НЕТ native OSC' },
  { sys:'GrandMA2', proto:'System Monitor (read-only)', port:'TCP 30001', tp:'TCP', note:'Только чтение' },
  // ─── GrandMA3 ───
  { sys:'GrandMA3', proto:'MA-Net3 (сессия)', port:'UDP 30020 Multicast', tp:'UDP MC', note:'236.4.1.x – 236.4.1.4 · ⚠ 192.168.33.x зарезервирован MA3!' },
  { sys:'GrandMA3', proto:'MA Worldserver', port:'TCP 30021', tp:'TCP', note:'' },
  { sys:'GrandMA3', proto:'MA-Net3 TCP backup', port:'TCP 30022+', tp:'TCP', note:'' },
  { sys:'GrandMA3', proto:'Art-Net (DMX out)', port:'UDP 6454', tp:'UDP', note:'Broadcast/Unicast/Auto — нужен статус Master' },
  { sys:'GrandMA3', proto:'sACN/E1.31 (DMX out)', port:'UDP 5568', tp:'UDP', note:'Multicast 239.255.x.y по номеру вселенной' },
  { sys:'GrandMA3', proto:'OSC (нативный!)', port:'UDP/TCP 8000', tp:'UDP', note:'Адрес: /cmd,s,"Go+ Exec 201" · настр.: In&Out→OSC' },
  { sys:'GrandMA3', proto:'Web Remote HTTP', port:'TCP 80', tp:'TCP', note:'' },
  { sys:'GrandMA3', proto:'Web Remote WebSocket', port:'TCP 8080', tp:'TCP', note:'' },
  { sys:'GrandMA3', proto:'SFTP', port:'TCP 22', tp:'TCP', note:'' },
  { sys:'GrandMA3', proto:'PSN/PosiStageNet', port:'UDP 65565', tp:'UDP MC', note:'Multicast 236.10.10.10' },
  { sys:'GrandMA3', proto:'MVR-xchange', port:'TCP 42424', tp:'TCP', note:'' },
  // ─── TouchDesigner ───
  { sys:'TouchDesigner', proto:'OSC In CHOP', port:'Настраивается', tp:'UDP', note:'Нет дефолта — ставь явно (8001/9000). Win Firewall часто блокирует молча!' },
  { sys:'TouchDesigner', proto:'OSC Out CHOP', port:'→ MA3: 8000', tp:'UDP', note:'Local Address: укажи NIC явно при нескольких адаптерах' },
  { sys:'TouchDesigner', proto:'Art-Net DMX Out CHOP', port:'UDP 6454 · 255.255.255.255', tp:'UDP', note:'Для MA2: NIC = 2.x.x.x/255.0.0.0 · loopback: KM-Test adapter' },
  { sys:'TouchDesigner', proto:'NDI (TOP)', port:'5353 mDNS · 5959 discovery · 5960+ video', tp:'TCP/UDP', note:'IGMP snooping нужен! Jumbo Frames MTU 9000 рекомендован' },
  { sys:'TouchDesigner', proto:'Dante (DVS)', port:'Отдельный NIC', tp:'UDP', note:'DVS = отдельный ASIO-адаптер. Не смешивать с NDI NIC' },
  // ─── Общие протоколы ───
  { sys:'Art-Net', proto:'Art-Net (все)', port:'UDP 6454', tp:'UDP', note:'2.x.x.x или 10.x.x.x / 255.0.0.0 · без шлюза' },
  { sys:'sACN/E1.31', proto:'Streaming ACN', port:'UDP 5568', tp:'UDP', note:'Multicast 239.255.0.U · IGMP snooping рекомендован' },
  { sys:'Dante/AES67', proto:'Audio (unicast)', port:'UDP разные', tp:'UDP', note:'QoS DSCP EF(46) для аудио · CS7(56) для PTP' },
  { sys:'Dante/AES67', proto:'PTP (IEEE 1588)', port:'UDP 319–320 Multicast', tp:'UDP MC', note:'Dante Redundant: 172.31.x.x/16 (Audinate auto-fallback)' },
  { sys:'NDI', proto:'mDNS discovery', port:'UDP 5353', tp:'UDP MC', note:'Не пересекает VLAN! Нужен NDI Discovery Server' },
  { sys:'NDI', proto:'Discovery Server', port:'TCP 5959', tp:'TCP', note:'Для cross-VLAN NDI' },
  { sys:'NDI', proto:'Video streams', port:'TCP/UDP 5960+', tp:'TCP', note:'~125-250 Мбит/с на поток · 10G рекомендован' },
  { sys:'QLab', proto:'OSC receive', port:'UDP 53000', tp:'UDP', note:'Send: 53001 · QLab 5 также поддерживает TCP' },
  { sys:'QLab', proto:'OSC send', port:'UDP 53001', tp:'UDP', note:'' },
  { sys:'rtpMIDI', proto:'Apple/rtpMIDI', port:'UDP 5004/5005', tp:'UDP', note:'Bonjour mDNS discovery — только в одной подсети' },
  { sys:'PSN', proto:'PosiStageNet (трекинг)', port:'UDP 65565', tp:'UDP MC', note:'Multicast 236.10.10.10' },
];

// Конфликты и предупреждения, выводимые в диалоге
const _NET_CONFLICTS = [
  { icon:'⚠', text:'GrandMA2 не имеет OSC. Используйте Telnet TCP:30000 или ArtNet DMX Remote для управления из TouchDesigner.' },
  { icon:'⚠', text:'GrandMA2 выводит ArtNet только с адаптера 2.x.x.x. Для MA-Net2 нужен отдельный NIC на 192.168.0.x.' },
  { icon:'⛔', text:'192.168.33.x зарезервирован GrandMA3 — никогда не назначайте этот диапазон устройствам на шоу-сети!' },
  { icon:'⚠', text:'ArtNet broadcast (x.255.255.255) + NDI на одном VLAN = конфликт полосы. Разносите на разные VLAN или переключайте ArtNet в Unicast.' },
  { icon:'⚠', text:'NDI mDNS не пересекает VLAN. Для cross-VLAN NDI нужен NDI Discovery Server (TCP 5959).' },
  { icon:'⚠', text:'Dante PTP + NDI multicast без IGMP Snooping → джиттер Dante и выпадения аудио. Включите IGMP Snooping на всех коммутаторах.' },
  { icon:'ℹ', text:'TouchDesigner с несколькими NIC: указывайте Local Address явно в каждом OSC/ArtNet CHOP, иначе Windows выберет адаптер сам.' },
  { icon:'ℹ', text:'Windows Firewall молча блокирует UDP-порты TD. Создайте inbound rule или отключите Firewall на шоу-машинах.' },
  { icon:'ℹ', text:'GrandMA3 OSC: /cmd,s,"Go+ Exec 201" — любая командная строка MA3. Настройка: In & Out → OSC, порт 8000, включить Echo для отладки.' },
  { icon:'ℹ', text:'Dante Redundant (резервная сеть): 172.31.x.x/16 — Audinate auto-fallback. Первичная и резервная сети никогда не маршрутизируются друг в друга.' },
];

function _activeProfiles(){
  return window._anNetMode === 'vlan' ? _NET_PROFILES_VLAN : _NET_PROFILES;
}

function _detectNodeProfile(n){
  const text = ((n.deviceType||'') + ' ' + (n.title||'') + ' ' + (n.sub1||'') + ' ' + (n.lightConsoleModel||'')).toLowerCase();
  const profiles = _activeProfiles();
  // приоритет: artnet > dante > ndi > osc > intercom > general
  for(const p of profiles){
    if(!p.kw.length) continue;
    if(p.kw.some(k => text.includes(k))) return p;
  }
  return profiles.find(p => p.id === 'general');
}

function _ipFromProfile(profile, idx){
  const oct = profile.ipStart + idx;
  // /8 — ArtNet flat network
  if(profile.mask === '/8'){
    const isVlan = window._anNetMode === 'vlan';
    if(isVlan){
      // VLAN режим: 10.10.0.x, overflow → 10.10.1.x
      const lo3 = Math.floor(oct / 254);
      const lo4 = (oct % 254) + 1;
      return `10.10.${lo3}.${lo4}`;
    }
    // Простой режим: 2.x.x.x или 10.x.x.x
    const base = (window._anArtnetBase === '2') ? '2' : '10';
    const hi   = Math.floor(oct / 254);
    const lo   = (oct % 254) + 1;
    return `${base}.${hi}.0.${lo}`;
  }
  // /16
  if(profile.mask === '/16'){
    const lo3 = Math.floor(oct / 254);
    const lo4 = (oct % 254) + 1;
    const parts = profile.subnet.split('.');
    return `${parts[0]}.${parts[1]}.${lo3}.${lo4}`;
  }
  // /24: subnet.xxx, overflow → следующий блок
  if(oct > 253){
    const parts = profile.subnet.split('.');
    const newThird = (parseInt(parts[2],10) + Math.floor(oct/254)) % 256;
    return `${parts[0]}.${parts[1]}.${newThird}.${(oct%254)+1}`;
  }
  return `${profile.subnet}.${oct}`;
}

// Главная функция анализа — строит план без применения
function _analyzeNet(){
  const counters = {};
  _NET_PROFILES.forEach(p => counters[p.id] = 0);

  const plan   = []; // {node, profile, ip, mask, gw, hasExisting}
  const skip   = []; // уже настроенные

  nodes.forEach(n => {
    const profile = _detectNodeProfile(n);
    const hasIp   = !!(n.ip && n.ip.trim());
    if(hasIp){
      skip.push({node: n, profile});
      return;
    }
    const idx = counters[profile.id]++;
    plan.push({
      node: n,
      profile,
      ip:   _ipFromProfile(profile, idx),
      mask: profile.mask,
      gw:   profile.gw,
      hasExisting: false
    });
  });

  return {plan, skip};
}

// Показать диалог авто-сети
function showAutoNetDialog(){
  window._anArtnetBase  = window._anArtnetBase  || '10';
  window._anNetMode     = window._anNetMode     || 'simple';
  const {plan, skip} = _analyzeNet();
  if(!nodes.length){
    alert('Нет устройств в схеме. Добавьте ноды и зоны сначала.');
    return;
  }

  // Группируем по профилю для отображения
  const byProfile = {};
  _NET_PROFILES.forEach(p => byProfile[p.id] = []);
  plan.forEach(item => byProfile[item.profile.id].push(item));

  let sectionsHTML = '';
  _NET_PROFILES.forEach(p => {
    const items = byProfile[p.id];
    if(!items.length) return;
    const rows = items.map((item,i) => {
      const z = zones.find(z => nodeInZone(item.node, z));
      const zoneName = z ? `<span style="color:#666;font-size:10px;"> · ${z.title||'Зона'}</span>` : '';
      return `<div class="an-row">
        <span class="an-dot" style="background:${p.color}"></span>
        <span class="an-name">${item.node.title||item.node.id}${zoneName}</span>
        <span class="an-ip">${item.ip}</span>
        <span class="an-mask">${item.mask}</span>
      </div>`;
    }).join('');
    sectionsHTML += `
      <div class="an-section">
        <div class="an-section-hdr" style="border-left:3px solid ${p.color}">
          <span style="color:${p.color};font-weight:600;">${p.name}</span>
          <span class="an-section-badge">${items.length} устр.</span>
          <span style="color:#555;font-size:10px;"> · подсеть ${p.subnet}.0${p.mask}</span>
        </div>
        <div class="an-section-desc">${p.desc}${
          p.id==='dante' ? `<span style="color:#10b981;opacity:.7;"> · Резервная сеть Dante (redundant): 172.31.x.x/16 — настраивается вручную</span>` :
          p.id==='artnet' ? `<span style="color:#f59e0b;opacity:.7;"> · sACN multicast (239.255.x.x) назначается контроллером автоматически</span>` : ''
        }</div>
        ${rows}
      </div>`;
  });

  if(!plan.length && skip.length){
    sectionsHTML = `<div style="text-align:center;padding:20px;color:#aaa;font-size:12px;">
      Все устройства (${skip.length}) уже имеют IP-адреса.<br>
      Используй «Переназначить всё», чтобы перестроить сеть с нуля.
    </div>`;
  }

  const skipNote = skip.length
    ? `<div class="an-skip-note">⚠ ${skip.length} устр. уже имеют IP и будут <b>пропущены</b>. Используй «Переназначить всё» для полного сброса.</div>`
    : '';

  // Конфликты
  const conflictsHTML = `
    <details class="an-details" style="margin-top:10px;">
      <summary class="an-det-sum">⚠ Конфликты и важные замечания (${_NET_CONFLICTS.length})</summary>
      <div class="an-conflicts">${_NET_CONFLICTS.map(c=>
        `<div class="an-conflict"><span class="an-ci">${c.icon}</span>${c.text}</div>`
      ).join('')}</div>
    </details>`;

  // Таблица портов (свёрнута по умолчанию)
  const portRows = _PORT_REFERENCE.map(r=>
    `<tr><td>${r.sys}</td><td>${r.proto}</td><td style="font-family:monospace;white-space:nowrap;">${r.port}</td><td style="color:#555;">${r.note}</td></tr>`
  ).join('');
  const portsHTML = `
    <details class="an-details">
      <summary class="an-det-sum">📋 Справочник портов и протоколов (${_PORT_REFERENCE.length} записей)</summary>
      <div style="overflow-x:auto;margin-top:6px;">
        <table class="an-port-table">
          <thead><tr><th>Система</th><th>Протокол</th><th>Порт</th><th>Примечание</th></tr></thead>
          <tbody>${portRows}</tbody>
        </table>
      </div>
    </details>`;

  document.getElementById('autonet-popup').style.display = 'flex';
  document.getElementById('autonet-body').innerHTML = `
    <div class="an-summary">
      Будет назначено: <b>${plan.length}</b> устройств &nbsp;·&nbsp;
      Пропущено (уже настроено): <b>${skip.length}</b>
    </div>
    ${skipNote}
    <div class="an-sections">${sectionsHTML}</div>
    ${conflictsHTML}
    ${portsHTML}`;

  // сохраняем план для кнопок
  window._autoNetPlan = {plan, skip};
}

function previewOverrideAll(){
  // Строим предварительный план для всех нод
  const profiles = _activeProfiles();
  const counters = {};
  profiles.forEach(p => counters[p.id] = 0);

  const fullPlan = nodes.map(n => {
    const profile = _detectNodeProfile(n);
    const idx = counters[profile.id]++;
    return {
      node: n,
      profile,
      ip:   _ipFromProfile(profile, idx),
      mask: profile.mask,
      gw:   profile.gw
    };
  });

  // Группируем по профилю и показываем в диалоге
  const byProfile = {};
  profiles.forEach(p => byProfile[p.id] = []);
  fullPlan.forEach(item => byProfile[item.profile.id].push(item));

  let sectionsHTML = '';
  profiles.forEach(p => {
    const items = byProfile[p.id];
    if(!items.length) return;
    const rows = items.map(item => {
      const changed = item.node.ip !== item.ip || item.node.mask !== item.mask;
      const z = zones.find(z => nodeInZone(item.node, z));
      const zn = z ? `<span style="color:#555;font-size:10px;"> · ${z.title||'Зона'}</span>` : '';
      const oldIP = item.node.ip ? `<span style="color:#555;text-decoration:line-through;font-size:10px;margin-right:4px;">${item.node.ip}</span>` : '';
      return `<div class="an-row">
        <span class="an-dot" style="background:${p.color}"></span>
        <span class="an-name">${item.node.title||item.node.id}${zn}</span>
        ${oldIP}<span class="an-ip" style="${changed?'color:#fbbf24':''}">${item.ip}</span>
        <span class="an-mask">${item.mask}</span>
      </div>`;
    }).join('');
    sectionsHTML += `<div class="an-section">
      <div class="an-section-hdr" style="border-left:3px solid ${p.color}">
        <span style="color:${p.color};font-weight:600;">${p.name}</span>
        <span class="an-section-badge">${items.length} устр.</span>
      </div>${rows}</div>`;
  });

  document.getElementById('autonet-body').innerHTML = `
    <div class="an-summary" style="background:#2a1a0a;border:1px solid #f59e0b44;">
      ↺ Переназначить всё: <b>${fullPlan.length}</b> устройств получат новые IP
      <div style="font-size:11px;color:#888;margin-top:3px;">Зачёркнутый = старый IP · Жёлтый = изменится</div>
    </div>
    <div class="an-sections">${sectionsHTML}</div>`;

  // Меняем кнопки — теперь "Подтвердить"
  document.querySelector('.an-footer').innerHTML = `
    <button class="an-btn-apply" style="background:#ef4444;" onclick="applyAutoNet(true)">⚠ Подтвердить переназначение</button>
    <button class="an-btn-all" onclick="showAutoNetDialog()">← Назад</button>
    <button class="an-btn-cancel" onclick="closeAutoNetDialog()">Отмена</button>`;

  // Сохраняем fullPlan для applyAutoNet
  window._autoNetOverridePlan = fullPlan;
}

function applyAutoNet(overrideAll){
  try {
    // Строим список того что нужно применить
    const profiles = _activeProfiles();
    const counters = {};
    profiles.forEach(p => counters[p.id] = 0);

    let toApply;
    if(overrideAll){
      // Берём готовый план из previewOverrideAll (или строим заново)
      const src = window._autoNetOverridePlan || nodes.map(n => {
        const profile = _detectNodeProfile(n);
        const idx     = counters[profile.id]++;
        return { node: n, ip: _ipFromProfile(profile, idx), mask: profile.mask, gw: profile.gw };
      });
      toApply = src.map(item => ({
        id:   item.node ? item.node.id : item.id,
        ip:   item.ip,
        mask: item.mask,
        gw:   item.gw
      }));
      window._autoNetOverridePlan = null;
    } else {
      // Только ноды без IP из сохранённого плана
      const {plan} = window._autoNetPlan || {};
      if(!plan || !plan.length){
        alert('Нет устройств для назначения. Все уже настроены — используй «Переназначить всё».');
        return;
      }
      toApply = plan.map(item => ({
        id:   item.node.id,
        ip:   item.ip,
        mask: item.mask,
        gw:   item.gw
      }));
    }

    if(!toApply.length){ closeAutoNetDialog(); return; }

    snapshot('Авто-сеть: назначить IP');

    // Применяем через nb() — гарантированно находим актуальный объект ноды
    let applied = 0;
    toApply.forEach(item => {
      const n = nb(item.id);
      if(!n) return;
      n.ip   = item.ip;
      n.mask = item.mask;
      n.gw   = item.gw;
      applied++;
    });

    closeAutoNetDialog();

    // Гарантируем что net-panel видна и перерисована
    if(document.getElementById('net-panel').style.display === 'none'){
      showNetPanel();
    } else {
      renderNetPanel();
    }

    console.log(`[AutoNet] Применено ${applied} IP-адресов (режим: ${window._anNetMode}, overrideAll=${overrideAll})`);
  } catch(e) {
    console.error('[AutoNet] Ошибка:', e);
    alert('Ошибка авто-сети: ' + e.message);
  }
}

function closeAutoNetDialog(){
  document.getElementById('autonet-popup').style.display = 'none';
}

function log(msg){
  console.log('[ShowFlow]', msg);
}

function showNetPanel(){
  document.getElementById('cw').style.display = 'none';
  document.getElementById('net-panel').style.display = 'block';
  _netSearch = ''; _netZoneFilter = '';
  renderNetPanel();
}

function closeNetPanel(){
  document.getElementById('net-panel').style.display = 'none';
  document.getElementById('cw').style.display = 'block';
}

// ── Валидация IP ──
function _isValidIP(v){
  if(!v) return true; // пустое — ок
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every(o=>+o<=255);
}
function _isValidMask(v){
  if(!v) return true;
  return /^\/\d{1,2}$/.test(v) || (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every(o=>+o<=255));
}
function _sameSubnet(ip, mask, gw){
  if(!ip||!mask||!gw) return true; // не валидировать неполные данные
  try{
    const toInt = a => a.split('.').reduce((r,o)=>((r<<8)+(+o))>>>0, 0);
    let m = 0;
    if(mask.startsWith('/')){
      const bits=+mask.slice(1); m=bits?((0xffffffff<<(32-bits))>>>0):0;
    } else { m=toInt(mask); }
    return (toInt(ip)&m)===(toInt(gw)&m);
  } catch(e){ return true; }
}
function _getAllIPs(){
  const map={}; nodes.forEach(n=>{ if(n.ip) map[n.ip]=(map[n.ip]||[]); map[n.ip].push(n); }); return map;
}

function netValidateInput(input, nodeId, field){
  const n = nb(nodeId); if(!n) return;
  const val = input.value.trim();
  n[field] = val;
  let ok = true;
  if(field==='ip'||field==='gw') ok = _isValidIP(val);
  if(field==='mask') ok = _isValidMask(val);
  // дублирование IP
  if(field==='ip' && val && ok){
    const ips = _getAllIPs();
    if(ips[val] && ips[val].length > 1) ok = false;
  }
  input.classList.toggle('ip-invalid', !ok);
  input.classList.toggle('ip-valid', ok && !!val);
  // несовместимость шлюза с подсетью
  if(ok && (field==='ip'||field==='mask'||field==='gw')){
    const subOk = _sameSubnet(n.ip, n.mask, n.gw);
    if(!subOk) input.classList.add('ip-invalid');
  }
}

function netSaveField(input, nodeId, field, label){
  const n=nb(nodeId); if(!n) return;
  n[field]=input.value.trim();
  snapshot(label);
  if(!input.classList.contains('ip-invalid')){
    input.classList.remove('ip-valid');
    input.classList.add('ip-saved');
    setTimeout(()=>input.classList.remove('ip-saved'), 500);
  }
}

// ── SVG топология ──
function _renderTopoSVG(sectionEdges, sectionIds){
  if(!sectionEdges.length) return '';
  const NODE_W=100, NODE_H=28, PAD=16, GAP_X=120, GAP_Y=44;
  // собираем уникальные ноды
  const nodeSet = new Map();
  sectionEdges.forEach(({fn,tn,internal})=>{
    if(!nodeSet.has(fn.id)) nodeSet.set(fn.id,{n:fn,internal:sectionIds.has(fn.id)});
    if(!nodeSet.has(tn.id)) nodeSet.set(tn.id,{n:tn,internal:sectionIds.has(tn.id)});
  });
  const nodeArr = [...nodeSet.values()];
  // простое размещение в ряд
  const cols = Math.min(nodeArr.length, 5);
  const rows = Math.ceil(nodeArr.length/cols);
  const W = cols*(NODE_W+GAP_X)+PAD*2;
  const H = rows*(NODE_H+GAP_Y)+PAD*2;
  const pos = {};
  nodeArr.forEach(({n},i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    pos[n.id]={x:PAD+col*(NODE_W+GAP_X)+NODE_W/2, y:PAD+row*(NODE_H+GAP_Y)+NODE_H/2};
  });
  // рисуем
  let svg=`<svg width="${W}" height="${H}" style="display:block;" xmlns="http://www.w3.org/2000/svg">`;
  // рёбра
  sectionEdges.forEach(({e,fn,tn,internal})=>{
    const p1=pos[fn.id],p2=pos[tn.id]; if(!p1||!p2) return;
    const mid_x=(p1.x+p2.x)/2;
    const stroke=internal?'#94a3b8':'#f97316';
    const dash=internal?'':'5,3';
    svg+=`<path d="M${p1.x},${p1.y} C${mid_x},${p1.y} ${mid_x},${p2.y} ${p2.x},${p2.y}"
      fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="${dash}" marker-end="url(#topoArr)"/>`;
    if(e.label){
      const lx=(p1.x+p2.x)/2, ly=(p1.y+p2.y)/2;
      svg+=`<rect x="${lx-20}" y="${ly-7}" width="40" height="13" rx="3" fill="#fff" stroke="#e0e0e0"/>`;
      svg+=`<text x="${lx}" y="${ly+1}" text-anchor="middle" font-size="8" fill="#666" font-family="Arial">${e.label}</text>`;
    }
  });
  // маркер стрелки
  svg+=`<defs><marker id="topoArr" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
    <polygon points="0 0,6 2.5,0 5" fill="#94a3b8"/>
  </marker></defs>`;
  // ноды
  nodeArr.forEach(({n,internal})=>{
    const p=pos[n.id]; if(!p) return;
    const dtCol=getDevtypeColor(n.deviceType)||'#94a3b8';
    const fill=internal?'#f8fafc':'#fff8f0';
    const stroke=internal?dtCol:'#f97316';
    const lbl=n.title.length>14?n.title.slice(0,13)+'…':n.title;
    svg+=`<rect x="${p.x-NODE_W/2}" y="${p.y-NODE_H/2}" width="${NODE_W}" height="${NODE_H}"
      rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    svg+=`<rect x="${p.x-NODE_W/2}" y="${p.y-NODE_H/2}" width="${NODE_W}" height="3" rx="2" fill="${dtCol}"/>`;
    svg+=`<text x="${p.x}" y="${p.y+1}" text-anchor="middle" dominant-baseline="middle"
      font-size="9" font-family="Arial" fill="#333" font-weight="600">${lbl}</text>`;
    if(!internal) svg+=`<text x="${p.x+NODE_W/2-3}" y="${p.y-NODE_H/2-3}" text-anchor="end"
      font-size="8" fill="#f97316">↗</text>`;
  });
  svg+='</svg>';
  return `<div class="net-topo-svg">
    <div class="net-topo-svg-title">Топология</div>${svg}</div>`;
}

// ── Строит только карточки устройств (горячий путь — поиск, фильтр) ──
function _buildNetCards(search, zFilter, allZoneGroups, unassigned){
  function renderCard(label, color, nodeList, zoneId){
    if(!nodeList.length) return '';
    if(zFilter && zoneId !== zFilter) return '';
    const filtered = search
      ? nodeList.filter(n=>(n.title||'').toLowerCase().includes(search)||(n.sub1||'').toLowerCase().includes(search)||(n.ip||'').includes(search))
      : nodeList;
    if(!filtered.length) return '';

    const sectionIds = new Set(nodeList.map(n => n.id));
    const sectionEdges = edges
      .filter(e => sectionIds.has(e.from) || sectionIds.has(e.to))
      .map(e => { const fn=nb(e.from),tn=nb(e.to); return (fn&&tn)?{e,fn,tn,internal:sectionIds.has(e.from)&&sectionIds.has(e.to)}:null; })
      .filter(Boolean);

    const reSearch = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi') : null;
    const hi = t => reSearch ? t.replace(reSearch, m=>`<mark style="background:#fff176">${m}</mark>`) : t;

    const rows = filtered.map(n => {
      const dtCol = getDevtypeColor(n.deviceType) || '#999';
      const id = n.id;
      return `<tr>
        <td>
          <div class="net-dev-cell">
            <div class="net-dev-dot" style="background:${dtCol};"></div>
            <div>
              <div class="net-dev-title">${hi(n.title)}</div>
              ${n.sub1 ? `<div class="net-dev-sub">${hi(n.sub1)}</div>` : ''}
            </div>
          </div>
        </td>
        <td><input class="net-input${!_isValidIP(n.ip)?' ip-invalid':''}" style="font-family:monospace;font-size:10px;" placeholder="192.168.x.x" value="${n.ip||''}"
          oninput="netValidateInput(this,'${id}','ip')" onblur="netSaveField(this,'${id}','ip','IP')"></td>
        <td><input class="net-input${!_isValidMask(n.mask)?' ip-invalid':''}" style="font-family:monospace;font-size:10px;" placeholder="/24" value="${n.mask||''}"
          oninput="netValidateInput(this,'${id}','mask')" onblur="netSaveField(this,'${id}','mask','Маска')"></td>
        <td><input class="net-input${!_isValidIP(n.gw)?' ip-invalid':''}" style="font-family:monospace;font-size:10px;" placeholder="192.168.x.1" value="${n.gw||''}"
          oninput="netValidateInput(this,'${id}','gw')" onblur="netSaveField(this,'${id}','gw','Шлюз')"></td>
        <td><input class="net-input" placeholder="Примечание" value="${n.netNote||''}"
          oninput="nb('${id}').netNote=this.value" onblur="snapshot('Примечание')"></td>
      </tr>`;
    }).join('');

    const topo = _netShowTopo && sectionEdges.length ? _renderTopoSVG(sectionEdges, sectionIds) : '';

    return `<div class="net-zone-card">
      <div class="net-zone-hdr" style="background:${color}12;border-left:3px solid ${color};">
        <div class="net-zone-dot" style="background:${color};"></div>
        <span>${label}</span>
        <span class="net-zone-count">${filtered.length}${filtered.length!==nodeList.length?'/'+nodeList.length:''} устр.</span>
      </div>
      <div class="net-zone-body">
        <table class="net-table">
          <thead><tr>
            <th>Устройство</th><th>IP</th><th>Маска</th><th>Шлюз</th><th>Примечание</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${topo}
      </div>
    </div>`;
  }

  let cards = allZoneGroups.map(({zone, nodes: zn}) =>
    renderCard(zone.label||'Зона', zone.color||'#4a9eff', zn, zone.id)
  ).join('');
  if(!zFilter && unassigned.length) cards += renderCard('Вне зон', '#888', unassigned, '__unassigned__');
  if(!cards.trim()) return `<div style="text-align:center;padding:60px 0;color:#aaa;font-size:13px;">
    ${search||zFilter ? 'Ничего не найдено. Измените поиск или фильтр.' : 'Нет устройств. Добавьте ноды и зоны на схему.'}
  </div>`;
  return cards;
}

// ── Обновляет только content-зону (поиск/фильтр не перестраивают chrome) ──
function _refreshNetContent(){
  const contentEl = document.getElementById('net-content');
  if(!contentEl) { renderNetPanel(); return; }
  const search = _netSearch.toLowerCase();
  const assigned = new Set();
  const allZoneGroups = zones.map(z => {
    const zn = nodes.filter(n => nodeInZone(n, z));
    zn.forEach(n => assigned.add(n.id));
    return {zone: z, nodes: zn};
  }).filter(g => g.nodes.length);
  const unassigned = nodes.filter(n => !assigned.has(n.id));
  contentEl.innerHTML = _buildNetCards(search, _netZoneFilter, allZoneGroups, unassigned);
}

function renderNetPanel(){
  const panel = document.getElementById('net-panel');
  const search = _netSearch.toLowerCase();

  const assigned = new Set();
  const allZoneGroups = zones.map(z => {
    const zn = nodes.filter(n => nodeInZone(n, z));
    zn.forEach(n => assigned.add(n.id));
    return {zone: z, nodes: zn};
  }).filter(g => g.nodes.length);
  const unassigned = nodes.filter(n => !assigned.has(n.id));

  // опции для select зон
  const zoneOptions = allZoneGroups.map(({zone})=>
    `<option value="${zone.id}"${_netZoneFilter===zone.id?' selected':''}>${zone.label||'Зона'}</option>`
  ).join('');

  // ошибки валидации
  const errCount = nodes.filter(n=>n.ip&&!_isValidIP(n.ip)||n.mask&&!_isValidMask(n.mask)||n.gw&&!_isValidIP(n.gw)).length;
  const errBadge = errCount ? `<span style="background:#ef4444;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:8px;">⚠ ${errCount}</span>` : '';

  const cards = _buildNetCards(search, _netZoneFilter, allZoneGroups, unassigned);

  panel.innerHTML = `
    <div class="net-topbar">
      <button class="net-back-btn" onclick="closeNetPanel()">← К схеме</button>
      <span class="net-topbar-title">Структура сети${errBadge}</span>
      <div class="net-export-wrap" style="margin-left:auto;">
        <button class="tbtn" onclick="toggleNetExportMenu()" id="btn-net-export">⬇ Экспорт ▾</button>
        <div id="net-export-menu">
          <div class="ctx-item" onclick="closeNetExportMenu();exportNetTable('html')">📄 HTML (просмотр)</div>
          <div class="ctx-item" onclick="closeNetExportMenu();exportNetTable('csv')">📊 CSV (Excel)</div>
          <div class="ctx-sep"></div>
          <div class="ctx-item" onclick="closeNetExportMenu();printNetTable()">🖨 Печать / PDF</div>
          <div class="ctx-sep"></div>
          <div class="ctx-item" onclick="exportNetPatch()">🔧 Патч сети .hta (Windows)</div>
          <div class="ctx-item" onclick="exportNetPing()">📡 Пинг карта .hta (Windows)</div>
          <div class="ctx-sep"></div>
          <div class="ctx-item" onclick="exportNetPatchMac()">🔧 Патч сети .command (macOS)</div>
          <div class="ctx-item" onclick="exportNetPingMac()">📡 Пинг карта .command (macOS)</div>
        </div>
      </div>
    </div>
    <div class="net-control-bar">
      <input class="net-search" type="text" placeholder="Найти устройство, IP…"
        value="${_netSearch}" id="net-search-input"
        oninput="_netSearch=this.value;_refreshNetContent()">
      <select class="net-zone-select" onchange="_netZoneFilter=this.value;_refreshNetContent()">
        <option value="">Все зоны</option>
        ${zoneOptions}
        ${unassigned.length?`<option value="__unassigned__"${_netZoneFilter==='__unassigned__'?' selected':''}>Вне зон</option>`:''}
      </select>
      <label class="net-topo-toggle">
        <input type="checkbox" ${_netShowTopo?'checked':''} onchange="_netShowTopo=this.checked;_refreshNetContent()">
        Топология
      </label>
      <span class="net-stats">${nodes.length} устр. · ${zones.length} зон</span>
      <button class="tbtn" onclick="showAutoNetDialog()" title="Автоматически назначить IP по типам устройств" style="margin-left:auto;background:#f59e0b22;border-color:#f59e0b66;color:#f59e0b;">🔧 Авто-сеть</button>
    </div>
    <div class="net-content" id="net-content">${cards}</div>`;
}

function toggleNetExportMenu(){
  const m=document.getElementById('net-export-menu');
  m.style.display = m.style.display==='block' ? 'none' : 'block';
}
function closeNetExportMenu(){
  const m=document.getElementById('net-export-menu');
  if(m) m.style.display='none';
}

function exportNetTable(format='html'){
  const date = new Date().toLocaleDateString('ru-RU');
  const title = document.title.replace(/\s*—.*$/,'');

  const assigned = new Set();
  const zoneGroups = zones.map(z => {
    const zn = nodes.filter(n => nodeInZone(n, z));
    zn.forEach(n => assigned.add(n.id));
    return {zone: z, nodes: zn};
  }).filter(g => g.nodes.length);
  const unassigned = nodes.filter(n => !assigned.has(n.id));

  if(format==='csv'){
    let csv='Зона,Устройство,Модель,IP,Маска,Шлюз,Примечание\n';
    function addRows(label, list){
      list.forEach(n=>{
        const esc=s=>`"${(s||'').replace(/"/g,'""')}"`;
        csv+=`${esc(label)},${esc(n.title)},${esc(n.sub1)},${esc(n.ip)},${esc(n.mask)},${esc(n.gw)},${esc(n.netNote)}\n`;
      });
    }
    zoneGroups.forEach(({zone,nodes:zn})=>addRows(zone.label||'Зона',zn));
    if(unassigned.length) addRows('Вне зон',unassigned);
    dl(URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),'network-structure.csv');
    return;
  }

  // HTML export
  const css=`body{font-family:Arial,sans-serif;margin:28px;color:#333;font-size:12px;}
h1{font-size:17px;margin-bottom:3px;}
.sub{color:#888;font-size:11px;margin-bottom:20px;}
.zone-card{margin-bottom:24px;border:1.5px solid #ddd;border-radius:6px;overflow:hidden;page-break-inside:avoid;}
.zone-hdr{padding:8px 14px;font-weight:bold;font-size:12px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:8px;}
.zone-body{padding:12px 14px;}
table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px;}
th{background:#f0f0f0;border:1px solid #ddd;padding:5px 10px;text-align:left;font-size:10px;color:#555;text-transform:uppercase;}
td{border:1px solid #eee;padding:5px 10px;vertical-align:top;}
tr:nth-child(even) td{background:#fafafa;}
.err{color:#ef4444;font-size:9px;}
.badge-ext{display:inline-block;background:#f97316;color:#fff;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;}
.footer{margin-top:28px;font-size:10px;color:#bbb;border-top:1px solid #eee;padding-top:8px;}
@media print{.zone-card{page-break-inside:avoid;}}`;

  function exportCard(label, color, nodeList){
    if(!nodeList.length) return '';
    const sectionIds = new Set(nodeList.map(n=>n.id));
    const sectionEdges = edges
      .filter(e=>sectionIds.has(e.from)||sectionIds.has(e.to))
      .map(e=>{const fn=nb(e.from),tn=nb(e.to);return fn&&tn?{e,fn,tn,internal:sectionIds.has(e.from)&&sectionIds.has(e.to)}:null;})
      .filter(Boolean);

    const rows = nodeList.map(n=>{
      const ipErr = n.ip&&!_isValidIP(n.ip) ? '<span class="err">⚠ невалидный IP</span>' : '';
      const gwErr = n.gw&&!_sameSubnet(n.ip,n.mask,n.gw) ? '<span class="err">⚠ шлюз вне подсети</span>' : '';
      return `<tr>
        <td><b>${n.title}</b>${n.sub1?`<br><small style="color:#888">${n.sub1}</small>`:''}</td>
        <td style="font-family:monospace">${n.ip||'—'} ${ipErr}</td>
        <td style="font-family:monospace">${n.mask||'—'}</td>
        <td style="font-family:monospace">${n.gw||'—'} ${gwErr}</td>
        <td>${n.netNote||'—'}</td>
      </tr>`;
    }).join('');

    const topoRows = sectionEdges.map(({e,fn,tn,internal})=>{
      const proto=[e.label,e.cable].filter(Boolean).join(' · ')||'—';
      return `<tr><td>${internal?'↔':'<span class="badge-ext">↗ внешнее</span>'}</td>
        <td>${fn.title}</td><td style="color:#999">${proto}</td><td>${tn.title}</td></tr>`;
    }).join('');

    return `<div class="zone-card">
      <div class="zone-hdr" style="background:${color}18;border-left:3px solid ${color};">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>
        ${label} <span style="color:#aaa;font-weight:normal;font-size:10px;margin-left:4px;">${nodeList.length} устр.</span>
      </div>
      <div class="zone-body">
        <table><thead><tr><th>Устройство</th><th>IP</th><th>Маска</th><th>Шлюз</th><th>Примечание</th></tr></thead>
        <tbody>${rows}</tbody></table>
        ${sectionEdges.length?`<table style="margin-top:8px;"><thead><tr><th>Тип</th><th>От</th><th>Протокол</th><th>К</th></tr></thead><tbody>${topoRows}</tbody></table>`:''}
      </div></div>`;
  }

  let cards=zoneGroups.map(({zone,nodes:zn})=>exportCard(zone.label||'Зона',zone.color||'#4a9eff',zn)).join('');
  if(unassigned.length) cards+=exportCard('Вне зон','#888',unassigned);
  const errCount=nodes.filter(n=>n.ip&&!_isValidIP(n.ip)).length;
  const errNote=errCount?`<p style="color:#ef4444;font-size:11px;">⚠ Обнаружено невалидных IP: ${errCount}</p>`:'';

  const html=`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>Структура сети — ${title}</title><style>${css}</style></head><body>
<h1>🌐 Структура сети</h1>
<p class="sub">${title} · ${date} · ${nodes.length} устройств, ${zones.length} зон</p>
${errNote}${cards}
<div class="footer">© Concept Store 2026 · Show Signal Flow ${APP_VERSION}</div>
</body></html>`;
  dl(URL.createObjectURL(new Blob([html],{type:'text/html'})),'network-structure.html');
}

function printNetTable(){
  exportNetTable('html');
}

function exportNetPatch(){
  closeNetExportMenu();
  const projectName = (document.title||'Show Signal Flow').replace(/\s*—.*$/,'').trim();
  const exportDate  = new Date().toLocaleString('ru-RU');

  // Collect devices with at least an IP
  const devs = nodes
    .filter(n => n.ip || n.gw)
    .map(n => {
      const z = zones.find(z => nodeInZone(n, z));
      return {
        name: n.title || n.id,
        sub:  n.sub1  || '',
        zone: z ? (z.title||z.label||'Зона') : '',
        ip:   n.ip   || '',
        mask: n.mask || '',
        gw:   n.gw   || ''
      };
    });

  if (!devs.length) {
    alert('Нет устройств с сетевыми настройками. Заполните IP-адреса в панели Сеть.');
    return;
  }

  const devsJson = JSON.stringify(devs);

  // Уникальные зоны для фильтра
  const zoneNames = [];
  const zoneSet = {};
  devs.forEach(function(d){ if(d.zone && !zoneSet[d.zone]){ zoneSet[d.zone]=1; zoneNames.push(d.zone); } });
  const zoneFilterOpts = '<option value="">Все зоны</option>' +
    zoneNames.map(function(z){ return '<option value="'+z+'">'+z+'</option>'; }).join('');

  const hta = `\uFEFF<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta http-equiv="x-ua-compatible" content="IE=edge">
<title>Network Patch &#8212; ${projectName}</title>
<HTA:APPLICATION
  APPLICATIONNAME="Network Patch"
  BORDER="thin" BORDERSTYLE="normal" CAPTION="yes"
  MAXIMIZEBUTTON="yes" MINIMIZEBUTTON="yes"
  SCROLL="no" SINGLEINSTANCE="yes" WINDOWSTATE="maximize"
/>
<style>
html,body{height:100%;margin:0;padding:0;overflow:hidden;}
body{background:#13131f;color:#dde;font-family:"Segoe UI",Arial,sans-serif;font-size:15px;}
*{box-sizing:border-box;}
/* Header */
#hdr{background:#1a1a2e;border-bottom:2px solid #f59e0b;padding:7px 16px;white-space:nowrap;}
.hh1{font-size:17px;color:#f59e0b;font-weight:700;}
.hmeta{font-size:12px;color:#556;margin-left:10px;}
/* Admin warn */
#admw{background:#2a0c0c;border-bottom:1px solid #c0392b;padding:7px 16px;color:#e74c3c;font-size:12px;display:none;}
/* Top table: controls left, console right */
#toptr{width:100%;border-collapse:collapse;border-bottom:2px solid #1a1a2e;}
.cc{width:260px;vertical-align:top;background:#0d0d1c;border-right:1px solid #1a1a2e;padding:10px 14px;}
.frow{margin-bottom:9px;}
.frow label{font-size:12px;color:#889;display:block;margin-bottom:3px;}
.frow select{background:#0f1a30;color:#ccd;border:1px solid #252545;border-radius:3px;padding:6px 8px;font-size:13px;width:100%;}
.rbtn{background:#181e38;color:#89b;border:1px solid #252545;border-radius:3px;padding:3px 8px;font-size:11px;cursor:pointer;margin-left:4px;}
.rbtn:hover{background:#22284a;}
.curip{font-size:10px;color:#3a9;font-family:Consolas,monospace;margin-top:3px;}
.kc{vertical-align:top;background:#08080f;}
.khdr{padding:6px 12px;border-bottom:1px solid #111820;background:#08080f;overflow:hidden;}
.kttl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#334;}
.kclr{float:right;background:none;border:none;color:#334;font-size:10px;cursor:pointer;padding:0 2px;}
.kclr:hover{color:#667;}
#log{overflow-y:auto;padding:6px 12px;font-family:Consolas,monospace;font-size:12px;line-height:1.6;}
.kinp{padding:4px 8px;border-top:1px solid #111820;background:#060609;}
#cmdIn{background:#090912;color:#99b;border:1px solid #141828;border-radius:2px;padding:3px 7px;font-family:Consolas,monospace;font-size:11px;width:85%;}
.krun{background:#111125;color:#445;border:1px solid #141828;border-radius:2px;padding:3px 8px;font-size:11px;cursor:pointer;}
.krun:hover{color:#778;}
/* Device area — full width, scrollable */
#devarea{overflow-y:auto;background:#13131f;}
#devList{padding:10px 16px;}
/* Zone groups */
.zgrp{margin-bottom:16px;}
.zhdr{padding:5px 0;border-bottom:1px solid #181828;margin-bottom:8px;overflow:hidden;}
.zname{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#99b;}
.zbtn{background:#161625;color:#778;border:1px solid #1e1e35;border-radius:3px;padding:4px 12px;font-size:12px;cursor:pointer;margin-left:6px;float:right;}
.zbtn:hover{background:#1e1e38;color:#9ab;}
.zbtn.za{border-color:#a07000;color:#e59000;}
.zbtn.za:hover{color:#f59e0b;}
/* Device boxes */
.dboxes{padding:2px 0 4px;overflow:hidden;}
.cf{clear:both;}
.dbox{float:left;background:#1a1a2e;border:1px solid #2a2a50;border-radius:5px;
  padding:10px 13px;cursor:pointer;width:152px;margin:0 10px 10px 0;}
.dbox:hover{border-color:#5a5aaa;background:#1e1e38;}
.dbox.sel{border-color:#f59e0b;background:#1c1800;}
.dbox.ok{border-color:#2e7d32;background:#0a160a;}
.dbox.err{border-color:#b71c1c;background:#160a0a;}
.dbox.pend{border-color:#e09000;}
.dn{font-size:13px;font-weight:600;color:#dde;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;}
.di{font-size:12px;color:#5a9aba;font-family:Consolas,monospace;}
.dot{width:6px;height:6px;border-radius:50%;background:#252545;display:inline-block;margin-right:4px;vertical-align:middle;}
.dot.ok{background:#4caf50;}.dot.err{background:#f44336;}.dot.pend{background:#f59e0b;}
/* Detail panel */
.ddetail{background:#111125;border:1px solid #252548;border-radius:4px;padding:10px 14px;margin-bottom:8px;display:none;}
.ddetail.vis{display:block;}
.dd-name{font-size:16px;font-weight:700;color:#eee;}
.dd-sub{font-size:12px;color:#778;margin-left:10px;}
.dd-ip{font-size:20px;font-weight:700;color:#6ab8f7;font-family:Consolas,monospace;display:block;margin:6px 0 4px;}
.dd-mask,.dd-gw{font-size:13px;font-family:Consolas,monospace;color:#4a5a7a;margin-right:12px;}
.dd-gw:before{content:"gw ";color:#334;}
.bp{background:#1a1e3a;color:#89b;border:1px solid #252a48;border-radius:3px;padding:6px 12px;font-size:12px;cursor:pointer;margin-right:6px;}
.bp:hover{background:#20264a;}
.ba{background:#f59e0b;color:#000;border:none;border-radius:3px;padding:6px 18px;font-size:12px;font-weight:700;cursor:pointer;}
.ba:hover{background:#fbbf24;}
.ba:disabled{background:#2a2a2a;color:#444;cursor:not-allowed;}
/* Bottom bar */
#bbar{background:#0e0e1e;border-top:2px solid #1a1a2e;padding:8px 16px;}
.ball{background:#f59e0b;color:#000;border:none;border-radius:4px;padding:8px 22px;font-size:14px;font-weight:700;cursor:pointer;}
.ball:hover{background:#fbbf24;}
.bcnt{color:#556;font-size:13px;margin-left:14px;font-family:Consolas,monospace;}
/* Log lines */
.li{display:block;}.li.ok{color:#4caf50;}.li.err{color:#f44336;}.li.inf{color:#2a3a50;}.li.warn{color:#f59e0b;}
/* Help panel */
#help{display:none;position:absolute;top:0;left:0;width:100%;height:100%;background:#0e0e1a;overflow-y:auto;z-index:10;padding:20px 28px;}
.hbtn{background:#1a1e38;color:#89b;border:1px solid #252a48;border-radius:3px;padding:3px 10px;font-size:12px;cursor:pointer;margin-left:10px;}
.hbtn:hover{background:#22284a;color:#acd;}
.hclose{float:right;background:#1a0e0e;color:#e74c3c;border:1px solid #5a1010;border-radius:3px;padding:4px 14px;font-size:12px;cursor:pointer;}
.hclose:hover{background:#2a1010;}
.htitle{font-size:18px;font-weight:700;color:#f59e0b;margin-bottom:16px;border-bottom:2px solid #f59e0b;padding-bottom:8px;}
.hsec{margin-bottom:20px;}
.hsec h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#778;margin-bottom:8px;border-left:3px solid #f59e0b;padding-left:8px;}
.hcmd{background:#08080f;border:1px solid #1a1a30;border-radius:3px;padding:8px 12px;margin-bottom:6px;font-family:Consolas,monospace;font-size:12px;}
.hcmd .cmd{color:#7ac3ff;display:block;}
.hcmd .desc{color:#556;font-size:11px;display:block;margin-top:2px;}
.htip{background:#0a1020;border-left:3px solid #2a4a8a;padding:8px 12px;font-size:12px;color:#667;border-radius:0 3px 3px 0;margin-top:8px;}
.htip b{color:#89b;}
/* Resize handles */
.col-rsz{width:4px;background:#1a1a2e;cursor:col-resize;padding:0;}
.col-rsz:hover,.col-rsz.active{background:#f59e0b;}
#row-rsz{height:4px;background:#1a1a2e;cursor:row-resize;}
#row-rsz:hover,#row-rsz.active{background:#f59e0b;}
</style>
</head>
<body>

<div id="hdr"><span class="hh1">&#128225; Network Patch</span><span class="hmeta">${projectName} &nbsp;&#183;&nbsp; ${exportDate}</span></div>

<div id="admw">&#9888; Требуются права Администратора.&nbsp;<button onclick="relaunchAdmin()" style="background:#b71c1c;color:#fff;border:none;border-radius:3px;padding:3px 10px;font-size:11px;cursor:pointer;">Запустить от Администратора</button></div>

<table id="toptr" cellspacing="0" cellpadding="0">
<tr>
<td class="cc" id="ctrlcell">
  <div class="frow">
    <label>Адаптер:</label>
    <select id="adSel" onchange="onAdChange()"><option value="">&#8212; загрузка... &#8212;</option></select>
    <button class="rbtn" onclick="loadAdapters()">&#8635;</button>
  </div>
  <div class="curip" id="curIP"></div>
  <div class="frow" style="margin-top:6px;">
    <label>Зона:</label>
    <select id="zoneSel" onchange="filterZone()">${zoneFilterOpts}</select>
  </div>
</td>
<td class="col-rsz" id="colrsz" onmousedown="startColResize(event)"></td>
<td class="kc">
  <div class="khdr" id="khdr"><button class="kclr" onclick="clearLog()">очистить</button><span class="kttl">&#9658; Встроенная консоль</span></div>
  <div id="log"><span class="li inf">Готов. Выберите адаптер.</span></div>
  <div class="kinp" id="kinp"><input type="text" id="cmdIn" placeholder="PowerShell..." onkeydown="if(event.keyCode===13)runCmd()"><button class="krun" onclick="runCmd()">&#9658;</button></div>
</td>
</tr>
</table>

<div style="position:relative;">
<div id="row-rsz" onmousedown="startRowResize(event)"></div>
<div id="devarea"><div id="devList"></div></div>

<div id="help">
  <button class="hclose" onclick="toggleHelp()">&#10005; Закрыть</button>
  <div class="htitle">&#128214; Справка — PowerShell команды</div>

  <div class="hsec">
    <h3>Просмотр адаптеров и IP</h3>
    <div class="hcmd"><span class="cmd">Get-NetAdapter</span><span class="desc">Список всех сетевых адаптеров и их статус</span></div>
    <div class="hcmd"><span class="cmd">Get-NetIPAddress -AddressFamily IPv4</span><span class="desc">Текущие IPv4-адреса всех адаптеров</span></div>
    <div class="hcmd"><span class="cmd">Get-NetIPConfiguration</span><span class="desc">Полная конфигурация: адаптер + IP + шлюз + DNS</span></div>
    <div class="hcmd"><span class="cmd">ipconfig /all</span><span class="desc">Классический вывод всех сетевых параметров</span></div>
  </div>

  <div class="hsec">
    <h3>Установка IP-адреса</h3>
    <div class="hcmd"><span class="cmd">New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.1.10 -PrefixLength 24 -DefaultGateway 192.168.1.1</span><span class="desc">Назначить статический IP со шлюзом</span></div>
    <div class="hcmd"><span class="cmd">New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.1.10 -PrefixLength 24</span><span class="desc">Назначить IP без шлюза</span></div>
  </div>

  <div class="hsec">
    <h3>Сброс / очистка</h3>
    <div class="hcmd"><span class="cmd">Remove-NetIPAddress -InterfaceAlias "Ethernet" -Confirm:&#36;false</span><span class="desc">Удалить все IP с адаптера</span></div>
    <div class="hcmd"><span class="cmd">Remove-NetRoute -InterfaceAlias "Ethernet" -Confirm:&#36;false</span><span class="desc">Удалить все маршруты адаптера</span></div>
    <div class="hcmd"><span class="cmd">Set-NetIPInterface -InterfaceAlias "Ethernet" -Dhcp Enabled</span><span class="desc">Переключить адаптер на DHCP</span></div>
  </div>

  <div class="hsec">
    <h3>Пинг и диагностика</h3>
    <div class="hcmd"><span class="cmd">Test-Connection 192.168.1.1 -Count 4</span><span class="desc">Пинг 4 пакета с результатом</span></div>
    <div class="hcmd"><span class="cmd">Test-Connection 192.168.1.1 -Count 3 | Select-Object -ExpandProperty ResponseTime | Measure-Object -Average</span><span class="desc">Средний RTT в мс</span></div>
    <div class="hcmd"><span class="cmd">Test-NetConnection 192.168.1.1 -Port 80</span><span class="desc">Проверка доступности TCP-порта</span></div>
    <div class="hcmd"><span class="cmd">tracert 192.168.1.1</span><span class="desc">Трассировка маршрута</span></div>
  </div>

  <div class="hsec">
    <h3>DNS</h3>
    <div class="hcmd"><span class="cmd">Get-DnsClientServerAddress -AddressFamily IPv4</span><span class="desc">Текущие DNS-серверы</span></div>
    <div class="hcmd"><span class="cmd">Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses 8.8.8.8,8.8.4.4</span><span class="desc">Установить DNS вручную</span></div>
    <div class="hcmd"><span class="cmd">Resolve-DnsName google.com</span><span class="desc">DNS-резолвинг домена</span></div>
  </div>

  <div class="hsec">
    <h3>Маршруты и ARP</h3>
    <div class="hcmd"><span class="cmd">Get-NetRoute -AddressFamily IPv4</span><span class="desc">Таблица маршрутизации IPv4</span></div>
    <div class="hcmd"><span class="cmd">New-NetRoute -InterfaceAlias "Ethernet" -DestinationPrefix 10.0.0.0/8 -NextHop 192.168.1.1</span><span class="desc">Добавить статический маршрут</span></div>
    <div class="hcmd"><span class="cmd">Get-NetNeighbor -AddressFamily IPv4</span><span class="desc">ARP-таблица (кэш соседей)</span></div>
  </div>

  <div class="hsec">
    <h3>Системная информация</h3>
    <div class="hcmd"><span class="cmd">&#36;env:COMPUTERNAME</span><span class="desc">Имя компьютера</span></div>
    <div class="hcmd"><span class="cmd">Get-WmiObject Win32_ComputerSystem | Select-Object Name,Domain</span><span class="desc">Имя компьютера и домен</span></div>
    <div class="hcmd"><span class="cmd">[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole("Administrator")</span><span class="desc">Проверка прав администратора (True/False)</span></div>
  </div>

  <div class="htip">&#9432; <b>Совет:</b> команды выполняются синхронно — длинные операции заморозят окно. Для Test-Connection используйте <b>-Count 2</b> или <b>-Count 3</b>. Переменные пишутся с <b>&#36;</b> (знак доллара).</div>
</div>
</div>

<div id="bbar">
  <button class="ball" onclick="applyAll()">&#10003; Применить все (${devs.length})</button>
  <span class="bcnt" id="applyCount">применено: 0</span>
  <span style="margin-left:auto;"><button class="hbtn" onclick="toggleHelp()">&#63; Справка</button></span>
</div>

<script language="JScript">
var devices=${devsJson};
var adapters=[];
var appliedCount=0;
var selectedDev=-1;
var zoneFilter='';

function runPS(cmd){
  try{
    var sh=new ActiveXObject("WScript.Shell");
    var ex=sh.Exec('powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "'+
      cmd.replace(/"/g,'\\\\"')+'"');
    var out='';
    while(!ex.StdOut.AtEndOfStream) out+=ex.StdOut.ReadLine()+'\\n';
    var err='';
    while(!ex.StdErr.AtEndOfStream) err+=ex.StdErr.ReadLine()+'\\n';
    return{ok:ex.ExitCode===0,out:out.trim(),err:err.trim()};
  }catch(e){return{ok:false,out:'',err:e.message};}
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function addLog(msg,cls){
  var el=document.getElementById('log');
  var sp=document.createElement('span');
  sp.className='li '+(cls||'inf');
  sp.innerHTML=msg; el.appendChild(sp);
  el.appendChild(document.createElement('br'));
  el.scrollTop=el.scrollHeight;
}
function clearLog(){
  document.getElementById('log').innerHTML='<span class="li inf">Очищено.</span><br>';
}

/* ── ADAPTERS ── */
function loadAdapters(){
  document.getElementById('adSel').innerHTML='<option value="">&#8212; загрузка... &#8212;</option>';
  document.getElementById('curIP').innerHTML='';
  var res=runPS("Get-NetAdapter|Where-Object{\\$_.Status -eq \\'Up\\'}|Select-Object Name,MacAddress|ConvertTo-Json -Compress");
  if(!res.ok||!res.out){
    var adm=runPS("[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)");
    if(adm.out.indexOf('False')>=0) document.getElementById('admw').style.display='block';
    addLog('Адаптеры не получены: '+(res.err||'нет прав Admin'),'err');
    return;
  }
  try{
    var raw=res.out; if(raw.charAt(0)!=='[') raw='['+raw+']';
    adapters=JSON.parse(raw);
    var sel=document.getElementById('adSel');
    sel.innerHTML='<option value="">&#8212; выберите адаптер &#8212;</option>';
    for(var i=0;i<adapters.length;i++){
      var a=adapters[i];
      sel.innerHTML+='<option value="'+esc(a.Name)+'">'+esc(a.Name)+(a.MacAddress?' &#8212; '+esc(a.MacAddress):'')+'</option>';
    }
    if(adapters.length===1){sel.selectedIndex=1;onAdChange();}
    addLog('Адаптеров: '+adapters.length,'ok');
  }catch(e){addLog('Ошибка: '+esc(e.message),'err');}
}

function onAdChange(){
  var name=document.getElementById('adSel').value;
  document.getElementById('curIP').innerHTML='';
  if(!name) return;
  var res=runPS("Get-NetIPAddress -InterfaceAlias \\'"+name+"\\' -AddressFamily IPv4 -ErrorAction SilentlyContinue|Select-Object IPAddress,PrefixLength|ConvertTo-Json -Compress");
  if(res.ok&&res.out){
    try{
      var info=JSON.parse(res.out); if(!Array.isArray(info)) info=[info];
      var ips=[];
      for(var i=0;i<info.length;i++) ips.push(info[i].IPAddress+'/'+info[i].PrefixLength);
      document.getElementById('curIP').innerHTML='&#8594; <b>'+esc(ips.join(', '))+'</b>';
      addLog('['+esc(name)+'] IP: '+esc(ips.join(', ')),'inf');
    }catch(e){}
  } else { addLog('['+esc(name)+'] текущий IP не определён','inf'); }
}

/* ── ZONE FILTER ── */
function filterZone(){
  zoneFilter=document.getElementById('zoneSel').value;
  renderDevices();
}

/* ── DEVICE SELECTION ── */
function selectDev(idx){
  if(selectedDev===idx){ selectedDev=-1; }
  else { selectedDev=idx; }
  renderDevices();
}

/* ── HELPERS ── */
function maskToPrefix(mask){
  if(!mask) return '24';
  if(/^\\/\\d+$/.test(mask)) return mask.slice(1);
  var parts=mask.split('.'); if(parts.length!==4) return '24';
  var bits=0;
  for(var i=0;i<4;i++){var n=parseInt(parts[i],10);while(n){bits+=(n&1);n>>=1;}}
  return String(bits);
}

function setBoxState(idx,state){
  var b=document.getElementById('dbox'+idx);
  var dot=document.getElementById('ddot'+idx);
  if(!b) return;
  // preserve sel class
  var isSel=(b.className.indexOf('sel')>=0);
  b.className='dbox'+(state?' '+state:'')+(isSel?' sel':'');
  if(dot) dot.className='dbox-dot'+(state?' '+state:'');
  // mirror state on device object for re-render
  devices[idx]._state=state||'';
}

/* ── APPLY / PING ── */
function applyDevice(idx){
  var adapter=document.getElementById('adSel').value;
  if(!adapter){addLog('Сначала выберите адаптер!','err');return;}
  var d=devices[idx];
  if(!d.ip){addLog('Нет IP: '+esc(d.name),'err');return;}
  var prefix=maskToPrefix(d.mask);
  setBoxState(idx,'pend');
  var btn=document.getElementById('abtn'+idx);
  if(btn) btn.disabled=true;
  addLog('&#9654; ['+esc(d.name)+']: '+esc(d.ip)+'/'+prefix+(d.gw?' gw '+esc(d.gw):''),'warn');
  var ps="\\$a=\\'"+adapter.replace(/'/g,"''")+"\\';"+
    "Remove-NetIPAddress -InterfaceAlias \\$a -AddressFamily IPv4 -Confirm:\\$false -ErrorAction SilentlyContinue;"+
    "Remove-NetRoute    -InterfaceAlias \\$a -AddressFamily IPv4 -Confirm:\\$false -ErrorAction SilentlyContinue;"+
    "New-NetIPAddress   -InterfaceAlias \\$a -AddressFamily IPv4 -IPAddress \\'"+d.ip+
    "\\' -PrefixLength "+prefix+
    (d.gw?" -DefaultGateway \\'"+d.gw+"\\'":" -ErrorAction Stop")+" -ErrorAction Stop";
  var res=runPS(ps);
  if(res.ok){
    setBoxState(idx,'ok');
    appliedCount++;
    document.getElementById('applyCount').innerHTML='применено: '+appliedCount;
    addLog('&#10003; '+esc(d.name)+' &#8592; '+esc(d.ip)+'/'+prefix,'ok');
    onAdChange();
  }else{
    setBoxState(idx,'err');
    if(btn) btn.disabled=false;
    var em=res.err||res.out||'Ошибка';
    addLog('&#10007; '+esc(d.name)+': '+esc(em),'err');
    if(em.indexOf('Access')>=0||em.indexOf('denied')>=0)
      document.getElementById('admw').style.display='block';
  }
}

function pingDevice(idx){
  var d=devices[idx];
  if(!d.ip){addLog('Нет IP: '+esc(d.name),'err');return;}
  addLog('&#128280; ping '+esc(d.ip)+'...','inf');
  var res=runPS("Test-Connection -ComputerName \\'"+d.ip+
    "\\' -Count 3 -ErrorAction SilentlyContinue|Select-Object -ExpandProperty ResponseTime|"+
    "Measure-Object -Average|Select-Object -ExpandProperty Average");
  if(res.ok&&res.out&&res.out!=='')
    addLog('&#10003; '+esc(d.ip)+' avg '+Math.round(parseFloat(res.out))+' ms','ok');
  else
    addLog('&#10007; '+esc(d.ip)+' &#8212; нет ответа','err');
}

function pingZone(idxs){
  addLog('--- ping зоны ('+idxs.length+' уст.) ---','inf');
  for(var i=0;i<idxs.length;i++) pingDevice(idxs[i]);
}

function applyAll(){
  var adapter=document.getElementById('adSel').value;
  if(!adapter){addLog('Сначала выберите адаптер!','err');return;}
  var active=[];
  for(var i=0;i<devices.length;i++){if(devices[i].ip) active.push(i);}
  if(!active.length){addLog('Нет устройств с IP.','err');return;}
  if(!confirm('Применить '+active.length+' устройств на ['+adapter+']?')) return;
  addLog('=== Применение: '+active.length+' уст. ===','warn');
  var j=0;
  function next(){
    if(j>=active.length){addLog('=== Готово ('+appliedCount+'/'+active.length+') ===','ok');return;}
    applyDevice(active[j++]);
    setTimeout(next,50);
  }
  setTimeout(next,50);
}

/* ── RENDER ── */
function renderDevices(){
  var list=document.getElementById('devList');
  if(!devices.length){
    list.innerHTML='<div style="text-align:center;padding:40px;color:#556;">Нет устройств с IP</div>';
    return;
  }
  var zones={}, zoneOrder=[];
  for(var i=0;i<devices.length;i++){
    var z=devices[i].zone||'';
    if(zoneFilter && z!==zoneFilter) continue;
    if(!zones[z]){zones[z]=[];zoneOrder.push(z);}
    zones[z].push(i);
  }
  if(!zoneOrder.length){
    list.innerHTML='<div style="text-align:center;padding:40px;color:#556;">Нет устройств в выбранной зоне</div>';
    return;
  }
  var html='';
  for(var zi=0;zi<zoneOrder.length;zi++){
    var zname=zoneOrder[zi];
    var idxs=zones[zname];
    var idxsStr=idxs.join(',');
    html+='<div class="zgrp">'+
      '<div class="zhdr">'+
        '<button class="zbtn za" onclick="applyZone(['+idxsStr+'])">&#10003; Применить</button>'+
        '<button class="zbtn" onclick="pingZone(['+idxsStr+'])">&#128280; Пинг</button>'+
        '<span class="zname">'+(zname?'&#9632; '+esc(zname):'&#9633; Без зоны')+'</span>'+
      '</div>'+
      '<div class="dboxes">';
    for(var k=0;k<idxs.length;k++){
      var idx=idxs[k];
      var d=devices[idx];
      var st=d._state||'';
      var isSel=(selectedDev===idx);
      html+='<div class="dbox'+(st?' '+st:'')+(isSel?' sel':'')+'" id="dbox'+idx+'" onclick="selectDev('+idx+')">'+
        '<span class="dn"><span class="dot'+(st?' '+st:'')+'" id="ddot'+idx+'"></span>'+esc(d.name)+'</span>'+
        '<span class="di">'+esc(d.ip||'&#8212;')+'</span>'+
      '</div>';
    }
    html+='<div class="cf"></div></div>';

    var selInZone=-1;
    for(var k2=0;k2<idxs.length;k2++){if(idxs[k2]===selectedDev){selInZone=selectedDev;break;}}
    if(selInZone>=0){
      var dd=devices[selInZone];
      html+='<div class="ddetail vis" id="ddetail'+selInZone+'">'+
        '<span class="dd-name">'+esc(dd.name)+'</span>'+(dd.sub?'<span class="dd-sub">'+esc(dd.sub)+'</span>':'')+
        '<span class="dd-ip">'+esc(dd.ip||'&#8212;')+'</span>'+
        '<span>'+(dd.mask?'<span class="dd-mask">'+esc(dd.mask)+'</span>':'')+
          (dd.gw?'<span class="dd-gw">'+esc(dd.gw)+'</span>':'')+'</span>'+
        '<div style="margin-top:8px;">'+
          '<button class="bp" onclick="pingDevice('+selInZone+')">&#128280; Пинг</button>'+
          '<button class="ba" id="abtn'+selInZone+'" onclick="applyDevice('+selInZone+')">&#10003; Применить</button>'+
        '</div>'+
      '</div>';
    }
    html+='</div>';
  }
  list.innerHTML=html;
}

function applyZone(idxs){
  var adapter=document.getElementById('adSel').value;
  if(!adapter){addLog('Сначала выберите адаптер!','err');return;}
  var active=[];
  for(var i=0;i<idxs.length;i++){if(devices[idxs[i]].ip) active.push(idxs[i]);}
  if(!active.length){addLog('В зоне нет устройств с IP.','err');return;}
  if(!confirm('Применить '+active.length+' уст. из зоны на ['+adapter+']?')) return;
  addLog('--- Применение зоны: '+active.length+' уст. ---','warn');
  var j=0;
  function next(){
    if(j>=active.length){addLog('--- Зона готова ---','ok');return;}
    applyDevice(active[j++]); setTimeout(next,50);
  }
  setTimeout(next,50);
}

/* ── INTERACTIVE CONSOLE ── */
function runCmd(){
  var inp=document.getElementById('cmdIn');
  var cmd=inp?(inp.value||'').trim():'';
  if(!cmd) return;
  addLog('PS&gt; '+esc(cmd),'warn');
  var res=runPS(cmd);
  if(res.out){
    var lines=res.out.split('\\n');
    for(var i=0;i<lines.length;i++){
      var l=lines[i].trim(); if(l) addLog(esc(l), res.ok?'ok':'err');
    }
  }
  if(!res.ok && res.err){
    var elines=res.err.split('\\n');
    for(var j=0;j<elines.length;j++){
      var el=elines[j].trim(); if(el) addLog(esc(el),'err');
    }
  }
  if(inp) inp.value='';
}

/* ── LAYOUT ── */
var _topH=175, _ctrlW=260;
function resizeLayout(){
  var H=document.documentElement.clientHeight||document.body.clientHeight;
  var hdr=document.getElementById('hdr'); var hdrH=hdr?hdr.offsetHeight:32;
  var admw=document.getElementById('admw'); var admwH=(admw&&admw.style.display!='none')?admw.offsetHeight:0;
  var bbar=document.getElementById('bbar'); var bbarH=bbar?bbar.offsetHeight:42;

  // 1. Shrink log FIRST so table can shrink
  var khdrH=28,kinpH=28;
  var kh=document.getElementById('khdr'); if(kh) khdrH=kh.offsetHeight;
  var ki=document.getElementById('kinp'); if(ki) kinpH=ki.offsetHeight;
  var logH=_topH-khdrH-kinpH; if(logH<20) logH=20;
  var log=document.getElementById('log'); if(log) log.style.height=logH+'px';

  // 2. Set table height
  var t=document.getElementById('toptr'); if(t) t.style.height=_topH+'px';

  // 3. Set ctrl cell width
  var c=document.getElementById('ctrlcell'); if(c) c.style.width=_ctrlW+'px';

  // 4. devarea
  var devH=H-hdrH-admwH-_topH-4-bbarH; if(devH<60) devH=60;
  var dev=document.getElementById('devarea'); if(dev) dev.style.height=devH+'px';
  var help=document.getElementById('help'); if(help) help.style.height=devH+'px';
}
window.onresize=resizeLayout;

/* ── COLUMN RESIZE ── */
var _cRsz=false,_cX=0;
function startColResize(e){
  e=e||window.event; _cRsz=true; _cX=e.clientX;
  document.getElementById('colrsz').className='col-rsz active';
  document.onmousemove=doColResize; document.onmouseup=stopColResize;
  e.returnValue=false;
}
function doColResize(e){
  if(!_cRsz) return; e=e||window.event;
  _ctrlW=_ctrlW+(e.clientX-_cX); _cX=e.clientX;
  if(_ctrlW<120) _ctrlW=120; if(_ctrlW>700) _ctrlW=700;
  var c=document.getElementById('ctrlcell'); if(c) c.style.width=_ctrlW+'px';
}
function stopColResize(){
  _cRsz=false;
  var r=document.getElementById('colrsz'); if(r) r.className='col-rsz';
  document.onmousemove=null; document.onmouseup=null;
}

/* ── ROW RESIZE ── */
var _rRsz=false,_rY=0;
function startRowResize(e){
  e=e||window.event; _rRsz=true; _rY=e.clientY;
  document.getElementById('row-rsz').className='active';
  document.onmousemove=doRowResize; document.onmouseup=stopRowResize;
  e.returnValue=false;
}
function doRowResize(e){
  if(!_rRsz) return; e=e||window.event;
  _topH=_topH+(e.clientY-_rY); _rY=e.clientY;
  if(_topH<80) _topH=80; if(_topH>700) _topH=700;
  resizeLayout();
}
function stopRowResize(){
  _rRsz=false;
  var r=document.getElementById('row-rsz'); if(r) r.className='';
  document.onmousemove=null; document.onmouseup=null;
}

/* ── HELP ── */
function toggleHelp(){
  var h=document.getElementById('help');
  if(!h) return;
  h.style.display=(h.style.display==='block'?'none':'block');
}

/* ── ADMIN RELAUNCH ── */
function relaunchAdmin(){
  try{
    var loc=window.location.pathname.replace(/\\//g,'\\\\');
    if(loc.charAt(0)==='\\\\') loc=loc.slice(1);
    var sh=new ActiveXObject('Shell.Application');
    sh.ShellExecute('mshta.exe','"'+loc+'"','','runas',1);
    window.setTimeout(function(){window.close();},500);
  }catch(e){
    addLog('Ошибка перезапуска: '+esc(e.message),'err');
  }
}

window.onload=function(){
  resizeLayout();
  renderDevices();
  loadAdapters();
  var adm=runPS("[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)");
  if(adm.out.indexOf('True')>=0){
    addLog('&#128737; Режим администратора','ok');
  } else {
    addLog('&#9888; Без прав Admin','err');
    document.getElementById('admw').style.display='block';
    resizeLayout();
  }
};
</script>
</body>
</html>`;

  dl(URL.createObjectURL(new Blob([hta],{type:'text/html;charset=utf-8'})), 'network-patch.hta');
  log('Экспортирован network-patch.hta ('+devs.length+' устройств)');
}

// ═══════════════════════════════════════════════════════════
// PING MAP HTA EXPORT
// ═══════════════════════════════════════════════════════════
function exportNetPing(){
  closeNetExportMenu();
  const projectName = (document.title||'Show Signal Flow').replace(/\s*—.*$/,'').trim();
  const exportDate  = new Date().toLocaleString('ru-RU');

  // Collect devices with IP only
  const devs = nodes
    .filter(n => n.ip)
    .map(n => {
      const z = zones.find(z => nodeInZone(n, z));
      return {
        name: n.title || n.id,
        sub:  n.sub1  || '',
        zone: z ? (z.title||z.label||'Зона') : '',
        ip:   n.ip   || ''
      };
    });

  if (!devs.length) {
    alert('Нет устройств с IP-адресами. Заполните IP в панели Сеть.');
    return;
  }

  const devsJson = JSON.stringify(devs);

  const zoneNames = [];
  const zoneSet = {};
  devs.forEach(function(d){ if(d.zone && !zoneSet[d.zone]){ zoneSet[d.zone]=1; zoneNames.push(d.zone); } });
  const zoneFilterOpts = '<option value="">Все зоны</option>' +
    zoneNames.map(function(z){ return '<option value="'+z+'">'+z+'</option>'; }).join('');

  const hta = `\uFEFF<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta http-equiv="x-ua-compatible" content="IE=edge">
<title>Ping Map &#8212; ${projectName}</title>
<HTA:APPLICATION
  APPLICATIONNAME="Ping Map"
  BORDER="thin" BORDERSTYLE="normal" CAPTION="yes"
  MAXIMIZEBUTTON="yes" MINIMIZEBUTTON="yes"
  SCROLL="no" SINGLEINSTANCE="yes" WINDOWSTATE="maximize"
/>
<style>
html,body{height:100%;margin:0;padding:0;overflow:hidden;}
body{background:#0d1117;color:#c9d1d9;font-family:"Segoe UI",Arial,sans-serif;font-size:15px;}
*{box-sizing:border-box;}
/* Header */
#hdr{background:#0f1923;border-bottom:2px solid #0ea5e9;padding:7px 16px;overflow:hidden;}
.hh1{font-size:17px;color:#0ea5e9;font-weight:700;float:left;}
.hmeta{font-size:12px;color:#4a6080;margin-left:10px;float:left;line-height:1.7;}
/* Stats bar */
#sbar{background:#0c1520;border-bottom:1px solid #0c2a40;padding:6px 16px;overflow:hidden;white-space:nowrap;}
.sstat{display:inline-block;margin-right:24px;font-size:13px;}
.sstat .sv{font-size:18px;font-weight:700;font-family:Consolas,monospace;margin-right:4px;}
.sv.ok{color:#22c55e;}.sv.err{color:#ef4444;}.sv.neu{color:#94a3b8;}
.sstat .sl{font-size:11px;color:#4a6080;}
.spct{display:inline-block;background:#0e2030;border:1px solid #0c2a40;border-radius:10px;
  width:110px;height:14px;vertical-align:middle;overflow:hidden;margin-left:2px;}
.spct-fill{height:100%;background:#22c55e;border-radius:10px;transition:width .3s;}
/* Controls */
#ctrlbar{background:#0c1520;border-bottom:1px solid #0c2a40;padding:6px 16px;overflow:hidden;}
.cbtn{background:#0c2a40;color:#0ea5e9;border:1px solid #0c3a58;border-radius:4px;
  padding:6px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px;}
.cbtn:hover{background:#0e3a58;}.cbtn.stop{background:#2a0c0c;color:#ef4444;border-color:#5a1010;}
.cbtn.stop:hover{background:#3a1010;}
.zfsel{background:#0c1a28;color:#7ab;border:1px solid #0c2a40;border-radius:3px;
  padding:5px 8px;font-size:13px;margin-left:10px;}
/* Device area */
#devarea{overflow-y:auto;background:#0d1117;}
#devList{padding:10px 16px;}
/* Zone groups */
.zgrp{margin-bottom:20px;}
.zhdr{padding:5px 0;border-bottom:1px solid #0c2030;margin-bottom:10px;overflow:hidden;}
.zname{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4a8aaa;}
.zbtn{background:#0c1e30;color:#4a8aaa;border:1px solid #0c2a40;border-radius:3px;
  padding:4px 12px;font-size:12px;cursor:pointer;margin-left:6px;float:right;}
.zbtn:hover{background:#0e2a44;color:#6ab;}
.zsum{float:right;font-size:11px;color:#2a4a5a;font-family:Consolas,monospace;margin-left:10px;line-height:2.2;}
/* Device ping cards */
.dboxes{padding:2px 0 4px;overflow:hidden;}
.cf{clear:both;}
.pbox{float:left;background:#0f1923;border:1px solid #1a3040;border-radius:6px;
  padding:12px 10px 10px;cursor:pointer;width:136px;margin:0 10px 10px 0;text-align:center;}
.pbox:hover{border-color:#0ea5e9;background:#111c28;}
.pbox.alive{border-color:#22c55e;background:#071410;}
.pbox.dead{border-color:#ef4444;background:#140707;}
.pbox.pinging{border-color:#f59e0b;background:#140f00;}
/* Big status circle */
.pcircle{width:36px;height:36px;border-radius:50%;margin:0 auto 8px;border:3px solid #1a3040;
  background:#0c1520;transition:background .3s,border-color .3s,box-shadow .3s;}
.pbox.alive .pcircle{background:#22c55e;border-color:#22c55e;box-shadow:0 0 10px #22c55e88;}
.pbox.dead  .pcircle{background:#ef4444;border-color:#ef4444;box-shadow:0 0 8px #ef444466;}
.pbox.pinging .pcircle{background:#f59e0b;border-color:#f59e0b;}
.pn{font-size:12px;font-weight:600;color:#c9d1d9;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;margin-bottom:2px;}
.pip{font-size:11px;color:#2a7aaa;font-family:Consolas,monospace;margin-bottom:3px;}
.prtt{font-size:11px;font-family:Consolas,monospace;color:#4a6080;min-height:14px;}
.pbox.alive .prtt{color:#22c55e;}.pbox.dead .prtt{color:#ef4444;}
/* Log panel at bottom */
#logwrap{border-top:1px solid #0c2a40;background:#080d12;overflow:hidden;}
#loghdr{padding:5px 12px;background:#0c1520;overflow:hidden;border-bottom:1px solid #0c2030;}
.lttl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#1a3a50;}
.lclr{float:right;background:none;border:none;color:#1a3a50;font-size:10px;cursor:pointer;padding:0;}
.lclr:hover{color:#4a6080;}
#log{overflow-y:auto;padding:5px 12px;font-family:Consolas,monospace;font-size:11px;line-height:1.6;}
.li{display:block;}.li.ok{color:#22c55e;}.li.err{color:#ef4444;}
.li.inf{color:#1a3a50;}.li.warn{color:#f59e0b;}
/* Row resize handle */
#row-rsz{height:4px;background:#0c2a40;cursor:row-resize;}
#row-rsz:hover,#row-rsz.active{background:#0ea5e9;}
</style>
</head>
<body>

<div id="hdr">
  <span class="hh1">&#128225; Ping Map</span>
  <span class="hmeta">${projectName} &nbsp;&#183;&nbsp; ${exportDate}</span>
</div>

<div id="sbar">
  <span class="sstat"><span class="sv ok" id="sCntOk">0</span><span class="sl">онлайн</span></span>
  <span class="sstat"><span class="sv err" id="sCntErr">0</span><span class="sl">нет ответа</span></span>
  <span class="sstat"><span class="sv neu" id="sCntTot">${devs.length}</span><span class="sl">всего</span></span>
  <span class="sstat"><span class="sv neu" id="sAvg">&#8212;</span><span class="sl">avg RTT</span></span>
  <span class="sstat">
    <span class="sv neu" id="sPct">0%</span>
    <span class="spct"><span class="spct-fill" id="sPctBar" style="width:0%"></span></span>
  </span>
</div>

<div id="ctrlbar">
  <button class="cbtn" id="btnAll" onclick="pingAll()">&#9654; Пинг всех</button>
  <button class="cbtn stop" id="btnStop" onclick="stopAll()" style="display:none">&#9646;&#9646; Стоп</button>
  <select class="zfsel" id="zoneSel" onchange="filterZone()">${zoneFilterOpts}</select>
</div>

<div id="devarea"><div id="devList"></div></div>

<div id="row-rsz" onmousedown="startRowResize(event)"></div>

<div id="logwrap">
  <div id="loghdr">
    <button class="lclr" onclick="clearLog()">очистить</button>
    <span class="lttl">&#9658; Лог пингов</span>
  </div>
  <div id="log"><span class="li inf">Готов. Нажмите "Пинг всех".</span></div>
</div>

<script language="JScript">
var devices=${devsJson};
var zoneFilter='';
var _pingQ=[];
var _pinging=false;
var _stopReq=false;
var _rttOk=[], _cntOk=0, _cntErr=0;

function runPS(cmd){
  try{
    var sh=new ActiveXObject("WScript.Shell");
    var ex=sh.Exec('powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "'+
      cmd.replace(/"/g,'\\\\"')+'"');
    var out='';
    while(!ex.StdOut.AtEndOfStream) out+=ex.StdOut.ReadLine()+'\\n';
    var err='';
    while(!ex.StdErr.AtEndOfStream) err+=ex.StdErr.ReadLine()+'\\n';
    return{ok:ex.ExitCode===0,out:out.trim(),err:err.trim()};
  }catch(e){return{ok:false,out:'',err:e.message};}
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function addLog(msg,cls){
  var el=document.getElementById('log');
  var sp=document.createElement('span');
  sp.className='li '+(cls||'inf');
  sp.innerHTML=msg; el.appendChild(sp);
  el.appendChild(document.createElement('br'));
  el.scrollTop=el.scrollHeight;
}
function clearLog(){
  document.getElementById('log').innerHTML='<span class="li inf">Очищено.</span><br>';
}

function setBoxState(idx,state,rtt){
  var b=document.getElementById('pb'+idx);
  if(!b) return;
  b.className='pbox'+(state?' '+state:'');
  var rttEl=document.getElementById('prtt'+idx);
  if(rttEl){
    if(state==='alive' && rtt!=null) rttEl.innerHTML=Math.round(rtt)+' ms';
    else if(state==='dead') rttEl.innerHTML='timeout';
    else if(state==='pinging') rttEl.innerHTML='&#8943;';
    else rttEl.innerHTML='';
  }
  devices[idx]._state=state||'';
  if(rtt!=null) devices[idx]._rtt=rtt;
}

function updateStats(){
  _cntOk=0; _cntErr=0; _rttOk=[];
  for(var i=0;i<devices.length;i++){
    if(devices[i]._state==='alive'){ _cntOk++; if(devices[i]._rtt) _rttOk.push(devices[i]._rtt); }
    else if(devices[i]._state==='dead'){ _cntErr++; }
  }
  var tot=devices.length;
  var pct=tot>0?Math.round(_cntOk/tot*100):0;
  var avgRtt=_rttOk.length?Math.round(_rttOk.reduce(function(a,b){return a+b;},0)/_rttOk.length):null;
  document.getElementById('sCntOk').innerHTML=_cntOk;
  document.getElementById('sCntErr').innerHTML=_cntErr;
  document.getElementById('sPct').innerHTML=pct+'%';
  document.getElementById('sPctBar').style.width=pct+'%';
  document.getElementById('sAvg').innerHTML=avgRtt!=null?avgRtt+' ms':'&#8212;';
}

/* ── ZONE FILTER ── */
function filterZone(){
  zoneFilter=document.getElementById('zoneSel').value;
  renderDevices();
}

/* ── PING ONE DEVICE ── */
function pingOne(idx){
  var d=devices[idx];
  if(!d||!d.ip) return;
  setBoxState(idx,'pinging',null);
  addLog('&#128280; '+esc(d.name)+' ('+esc(d.ip)+')...','inf');
  var res=runPS("Test-Connection -ComputerName \\'"+d.ip+
    "\\' -Count 2 -ErrorAction SilentlyContinue|Select-Object -ExpandProperty ResponseTime|"+
    "Measure-Object -Average|Select-Object -ExpandProperty Average");
  if(res.ok && res.out && res.out!=''){
    var rtt=parseFloat(res.out);
    setBoxState(idx,'alive',rtt);
    addLog('&#10003; '+esc(d.name)+' &#8592; '+Math.round(rtt)+' ms','ok');
  } else {
    setBoxState(idx,'dead',null);
    addLog('&#10007; '+esc(d.name)+' &#8212; нет ответа','err');
  }
  updateStats();
}

/* ── QUEUE-BASED SEQUENTIAL PING ALL ── */
function pingAll(){
  if(_pinging) return;
  _stopReq=false;
  _pingQ=[];
  for(var i=0;i<devices.length;i++){
    if(devices[i].ip){
      setBoxState(i,'',null);
      _pingQ.push(i);
    }
  }
  for(var i=0;i<devices.length;i++){
    devices[i]._state=''; devices[i]._rtt=null;
  }
  updateStats();
  if(!_pingQ.length){addLog('Нет устройств с IP.','err');return;}
  _pinging=true;
  document.getElementById('btnAll').style.display='none';
  document.getElementById('btnStop').style.display='';
  addLog('=== Пинг '+_pingQ.length+' устройств ===','warn');
  renderDevices();
  pingNext();
}

function pingNext(){
  if(_stopReq||!_pingQ.length){
    _pinging=false; _stopReq=false;
    document.getElementById('btnAll').style.display='';
    document.getElementById('btnStop').style.display='none';
    addLog('=== Готово (онлайн: '+_cntOk+'/'+devices.length+') ===','ok');
    return;
  }
  var idx=_pingQ.shift();
  pingOne(idx);
  window.setTimeout(pingNext,50);
}

function stopAll(){
  _stopReq=true;
  addLog('--- Остановлено ---','warn');
}

/* ── PING ZONE ── */
function pingZone(idxs){
  addLog('--- ping зоны ('+idxs.length+') ---','warn');
  for(var i=0;i<idxs.length;i++){
    setBoxState(idxs[i],'pinging',null);
  }
  for(var i=0;i<idxs.length;i++){
    pingOne(idxs[i]);
  }
  updateStats();
}

/* ── RENDER ── */
function renderDevices(){
  var list=document.getElementById('devList');
  if(!devices.length){
    list.innerHTML='<div style="text-align:center;padding:40px;color:#1a3a50;">Нет устройств с IP</div>';
    return;
  }
  var zonesMap={}, zoneOrder=[];
  for(var i=0;i<devices.length;i++){
    var z=devices[i].zone||'';
    if(zoneFilter && z!==zoneFilter) continue;
    if(!zonesMap[z]){zonesMap[z]=[];zoneOrder.push(z);}
    zonesMap[z].push(i);
  }
  if(!zoneOrder.length){
    list.innerHTML='<div style="text-align:center;padding:40px;color:#1a3a50;">Нет устройств в выбранной зоне</div>';
    return;
  }
  var html='';
  for(var zi=0;zi<zoneOrder.length;zi++){
    var zname=zoneOrder[zi];
    var idxs=zonesMap[zname];
    var idxsStr=idxs.join(',');
    var zOk=0,zTot=idxs.length;
    for(var k=0;k<idxs.length;k++){if(devices[idxs[k]]._state==='alive') zOk++;}
    html+='<div class="zgrp">'+
      '<div class="zhdr">'+
        '<button class="zbtn" onclick="pingZone(['+idxsStr+'])">&#9654; Пинг зоны</button>'+
        '<span class="zsum">'+zOk+'/'+zTot+'</span>'+
        '<span class="zname">'+(zname?'&#9632; '+esc(zname):'&#9633; Без зоны')+'</span>'+
      '</div>'+
      '<div class="dboxes">';
    for(var k=0;k<idxs.length;k++){
      var idx=idxs[k];
      var d=devices[idx];
      var st=d._state||'';
      var rttTxt='';
      if(st==='alive'&&d._rtt) rttTxt=Math.round(d._rtt)+' ms';
      else if(st==='dead') rttTxt='timeout';
      else if(st==='pinging') rttTxt='&#8943;';
      html+='<div class="pbox'+(st?' '+st:'')+'" id="pb'+idx+'" onclick="pingOne('+idx+')">'+
        '<div class="pcircle"></div>'+
        '<div class="pn">'+esc(d.name)+'</div>'+
        '<div class="pip">'+esc(d.ip)+'</div>'+
        '<div class="prtt" id="prtt'+idx+'">'+rttTxt+'</div>'+
      '</div>';
    }
    html+='<div class="cf"></div></div></div>';
  }
  list.innerHTML=html;
}

/* ── LAYOUT ── */
var _logH=140;
function resizeLayout(){
  var H=document.documentElement.clientHeight||document.body.clientHeight;
  var hdr=document.getElementById('hdr');   var hdrH=hdr?hdr.offsetHeight:34;
  var sbar=document.getElementById('sbar'); var sbarH=sbar?sbar.offsetHeight:38;
  var cbar=document.getElementById('ctrlbar'); var cbarH=cbar?cbar.offsetHeight:38;
  var rsz=document.getElementById('row-rsz'); var rszH=rsz?rsz.offsetHeight:4;
  var lhdr=document.getElementById('loghdr'); var lhdrH=lhdr?lhdr.offsetHeight:24;

  // Shrink log to _logH, then set devarea
  var logEl=document.getElementById('log');
  if(logEl) logEl.style.height=(_logH-lhdrH-4)+'px';

  var devH=H-hdrH-sbarH-cbarH-rszH-_logH;
  if(devH<100) devH=100;
  var dev=document.getElementById('devarea');
  if(dev) dev.style.height=devH+'px';
}
window.onresize=resizeLayout;

/* ── ROW RESIZE ── */
var _rRsz=false,_rY=0;
function startRowResize(e){
  e=e||window.event; _rRsz=true; _rY=e.clientY;
  document.getElementById('row-rsz').className='active';
  document.onmousemove=doRowResize; document.onmouseup=stopRowResize;
  e.returnValue=false;
}
function doRowResize(e){
  if(!_rRsz) return; e=e||window.event;
  _logH=_logH-(e.clientY-_rY); _rY=e.clientY;
  if(_logH<60) _logH=60; if(_logH>500) _logH=500;
  resizeLayout();
}
function stopRowResize(){
  _rRsz=false;
  var r=document.getElementById('row-rsz'); if(r) r.className='';
  document.onmousemove=null; document.onmouseup=null;
}

window.onload=function(){
  resizeLayout();
  renderDevices();
};
</script>
</body>
</html>`;

  dl(URL.createObjectURL(new Blob([hta],{type:'text/html;charset=utf-8'})), 'network-ping.hta');
  log('Экспортирован network-ping.hta ('+devs.length+' устройств)');
}

// ═══════════════════════════════════════════════════════════
// MAC NETWORK PATCH .command
// ═══════════════════════════════════════════════════════════
function exportNetPatchMac(){
  closeNetExportMenu();
  const projectName = (document.title||'Show Signal Flow').replace(/\s*—.*$/,'').trim();
  const exportDate  = new Date().toLocaleString('ru-RU');

  const devs = nodes
    .filter(n => n.ip || n.gw)
    .map(n => {
      const z = zones.find(z => nodeInZone(n, z));
      return {
        name: n.title || n.id,
        zone: z ? (z.title||z.label||'') : '',
        ip:   n.ip   || '',
        mask: n.mask || '255.255.255.0',
        gw:   n.gw   || ''
      };
    });

  if (!devs.length) {
    alert('Нет устройств с сетевыми настройками.');
    return;
  }

  // Build bash arrays
  const esc = s => (s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/`/g,'\\`').replace(/\$/g,'\\$');
  const namesArr = devs.map(d=>`"${esc(d.name)}"`).join(' ');
  const zonesArr = devs.map(d=>`"${esc(d.zone)}"`).join(' ');
  const ipsArr   = devs.map(d=>`"${esc(d.ip)}"`).join(' ');
  const masksArr = devs.map(d=>`"${esc(d.mask||'255.255.255.0')}"`).join(' ');
  const gwsArr   = devs.map(d=>`"${esc(d.gw)}"`).join(' ');

  const bash = `#!/bin/bash
# Network Patch — ${projectName}
# Сгенерировано Show Signal Flow · ${exportDate}
# Запуск: chmod +x network-patch.command && ./network-patch.command

R='\\033[0;31m'; G='\\033[0;32m'; Y='\\033[1;33m'
C='\\033[0;36m'; B='\\033[1m'; N='\\033[0m'

DEVNAMES=(${namesArr})
DEVZONES=(${zonesArr})
DEVIPS=(${ipsArr})
DEVMASKS=(${masksArr})
DEVGWS=(${gwsArr})

echo ""
echo -e "\${C}\${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\${N}"
echo -e "\${C}\${B}  🔧 Network Patch — ${projectName}\${N}"
echo -e "\${C}  \${N}${exportDate}"
echo -e "\${C}\${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\${N}"
echo ""

# Требуются права sudo для изменения IP
if [ "\\$EUID" -ne 0 ]; then
  echo -e "\${Y}⚠  Для изменения IP требуются права администратора\${N}"
  echo -e "   Перезапуск с sudo..."
  echo ""
  exec sudo bash "\\$0" "\\$@"
fi

# Список сетевых интерфейсов
SERVICES=()
while IFS= read -r line; do
  [[ "\\$line" == "An asterisk"* ]] && continue
  [[ -z "\\$line" ]] && continue
  SERVICES+=("\\$line")
done < <(networksetup -listallnetworkservices 2>/dev/null)

echo -e "\${B}Сетевые интерфейсы:\${N}"
for i in "\${!SERVICES[@]}"; do
  CUR_IP=\$(networksetup -getinfo "\${SERVICES[\\$i]}" 2>/dev/null | awk -F': ' '/^IP address:/{print \\$2}')
  echo -e "  \$((i+1)). \${SERVICES[\\$i]}\${CUR_IP:+  \${C}→ \\$CUR_IP\${N}}"
done
echo ""
read -rp "Выберите номер интерфейса: " IFACE_NUM
IFACE_NUM=\\$((IFACE_NUM-1))
ADAPTER="\${SERVICES[\\$IFACE_NUM]}"
if [ -z "\\$ADAPTER" ]; then echo -e "\${R}Неверный выбор\${N}"; exit 1; fi
echo -e "Адаптер: \${C}\\$ADAPTER\${N}"
echo ""

# Показ устройств
echo -e "\${B}Устройства (всего: \${#DEVNAMES[@]}):\${N}"
LAST_ZONE=""
for i in "\${!DEVNAMES[@]}"; do
  Z="\${DEVZONES[\\$i]}"
  if [ "\\$Z" != "\\$LAST_ZONE" ]; then
    LAST_ZONE="\\$Z"
    echo -e "  \${Y}■ \${Z:-Без зоны}\${N}"
  fi
  echo -e "    \$((i+1)). \${B}\${DEVNAMES[\\$i]}\${N}  \${C}\${DEVIPS[\\$i]}\${N}\${DEVMASKS[\\$i]:+/\${DEVMASKS[\\$i]}}\${DEVGWS[\\$i]:+  gw \${DEVGWS[\\$i]}}"
done

echo ""
echo -e "  \${Y}a\${N} — Применить все"
echo -e "  \${Y}q\${N} — Выход"
echo ""
read -rp "Номер устройства или команда: " CHOICE
echo ""

apply_dev() {
  local idx=\\$1
  local NAME="\${DEVNAMES[\\$idx]}"
  local IP="\${DEVIPS[\\$idx]}"
  local MASK="\${DEVMASKS[\\$idx]:-255.255.255.0}"
  local GW="\${DEVGWS[\\$idx]}"
  [ -z "\\$IP" ] && { echo -e "  \${R}✗ \${NAME}: нет IP\${N}"; return; }
  echo -ne "  ▶ \${NAME} (\${IP})... "
  if [ -n "\\$GW" ]; then
    networksetup -setmanual "\\$ADAPTER" "\\$IP" "\\$MASK" "\\$GW" 2>&1 >/dev/null
  else
    networksetup -setmanual "\\$ADAPTER" "\\$IP" "\\$MASK" 2>&1 >/dev/null
  fi
  if [ \\$? -eq 0 ]; then
    echo -e "\${G}✓ OK\${N}"
  else
    echo -e "\${R}✗ Ошибка\${N}"
  fi
}

if [ "\\$CHOICE" = "a" ]; then
  echo -e "\${Y}Применение всех устройств...\${N}"
  for i in "\${!DEVNAMES[@]}"; do apply_dev \\$i; done
  echo ""
  echo -e "\${G}✓ Готово!\${N}"
elif [[ "\\$CHOICE" =~ ^[0-9]+\\$ ]] && [ "\\$CHOICE" -ge 1 ] && [ "\\$CHOICE" -le "\${#DEVNAMES[@]}" ]; then
  apply_dev \\$((CHOICE-1))
  echo -e "\${G}✓ Готово!\${N}"
elif [ "\\$CHOICE" = "q" ]; then
  exit 0
else
  echo -e "\${R}Неверный ввод\${N}"
fi

echo ""
# Показать итоговый IP
FINAL_IP=\$(networksetup -getinfo "\\$ADAPTER" 2>/dev/null | awk -F': ' '/^IP address:/{print \\$2}')
echo -e "IP адаптера сейчас: \${C}\\$FINAL_IP\${N}"
echo ""
read -rp "Нажмите Enter для выхода..."
`;

  dl(URL.createObjectURL(new Blob([bash],{type:'text/x-sh;charset=utf-8'})), 'network-patch.command');
  log('Экспортирован network-patch.command (macOS, '+devs.length+' устройств)');
}

// ═══════════════════════════════════════════════════════════
// MAC PING MAP .command
// ═══════════════════════════════════════════════════════════
function exportNetPingMac(){
  closeNetExportMenu();
  const projectName = (document.title||'Show Signal Flow').replace(/\s*—.*$/,'').trim();
  const exportDate  = new Date().toLocaleString('ru-RU');

  const devs = nodes
    .filter(n => n.ip)
    .map(n => {
      const z = zones.find(z => nodeInZone(n, z));
      return {
        name: n.title || n.id,
        zone: z ? (z.title||z.label||'') : '',
        ip:   n.ip || ''
      };
    });

  if (!devs.length) {
    alert('Нет устройств с IP-адресами.');
    return;
  }

  const esc = s => (s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/`/g,'\\`').replace(/\$/g,'\\$');
  const namesArr = devs.map(d=>`"${esc(d.name)}"`).join(' ');
  const zonesArr = devs.map(d=>`"${esc(d.zone)}"`).join(' ');
  const ipsArr   = devs.map(d=>`"${esc(d.ip)}"`).join(' ');

  const bash = `#!/bin/bash
# Ping Map — ${projectName}
# Сгенерировано Show Signal Flow · ${exportDate}
# Запуск: chmod +x network-ping.command && ./network-ping.command

R='\\033[0;31m'; G='\\033[0;32m'; Y='\\033[1;33m'
C='\\033[0;36m'; B='\\033[1m'; DIM='\\033[2m'; N='\\033[0m'
GREEN_DOT="\\$(printf '\\033[0;32m●\\033[0m')"
RED_DOT="\\$(printf '\\033[0;31m●\\033[0m')"
GREY_DOT="\\$(printf '\\033[2m○\\033[0m')"

DEVNAMES=(${namesArr})
DEVZONES=(${zonesArr})
DEVIPS=(${ipsArr})
TOTAL="\${#DEVNAMES[@]}"

CNT_OK=0; CNT_ERR=0
declare -a RTTS
for i in "\${!DEVNAMES[@]}"; do RTTS[\\$i]=""; done

echo ""
echo -e "\${C}\${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\${N}"
echo -e "\${C}\${B}  📡 Ping Map — ${projectName}\${N}"
echo -e "\${C}  \${DIM}${exportDate}  ·  Устройств: \${TOTAL}\${N}"
echo -e "\${C}\${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\${N}"
echo ""

ping_one() {
  local ip="\\$1"
  # macOS ping: -c count, -W timeout ms (macOS uses ms unlike Linux)
  local raw
  raw=\$(ping -c 2 -W 500 "\\$ip" 2>/dev/null | grep -E "round-trip|rtt" | grep -oE "[0-9]+\\.[0-9]+/[0-9]+\\.[0-9]+" | awk -F'/' '{printf "%.0f", \\$2}')
  echo "\\$raw"
}

LAST_ZONE=""
for i in "\${!DEVNAMES[@]}"; do
  Z="\${DEVZONES[\\$i]}"
  IP="\${DEVIPS[\\$i]}"
  NAME="\${DEVNAMES[\\$i]}"
  [ -z "\\$IP" ] && continue

  if [ "\\$Z" != "\\$LAST_ZONE" ]; then
    [ -n "\\$LAST_ZONE" ] && echo ""
    LAST_ZONE="\\$Z"
    echo -e "  \${Y}■ \${Z:-Без зоны}\${N}"
  fi

  printf "  \${GREY_DOT} \${B}%s\${N} \${DIM}%s\${N}... " "\\$NAME" "\\$IP"

  RTT=\$(ping_one "\\$IP")

  if [ -n "\\$RTT" ] && [ "\\$RTT" -gt 0 ] 2>/dev/null; then
    printf "\\r  \${GREEN_DOT} \${B}%-30s\${N} \${C}%-18s\${N} \${G}%s ms\${N}\\n" "\\$NAME" "\\$IP" "\\$RTT"
    RTTS[\\$i]="\\$RTT"
    CNT_OK=\\$((CNT_OK+1))
  else
    printf "\\r  \${RED_DOT}  \${B}%-30s\${N} \${C}%-18s\${N} \${R}timeout\${N}\\n" "\\$NAME" "\\$IP"
    CNT_ERR=\\$((CNT_ERR+1))
  fi
done

echo ""
echo -e "\${C}\${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\${N}"

# Средний RTT
SUM=0; CNT_RTT=0
for r in "\${RTTS[@]}"; do
  [ -n "\\$r" ] && [ "\\$r" -gt 0 ] 2>/dev/null && { SUM=\\$((SUM+r)); CNT_RTT=\\$((CNT_RTT+1)); }
done
if [ "\\$CNT_RTT" -gt 0 ]; then
  AVG=\\$((SUM/CNT_RTT))
  echo -e "  Онлайн: \${G}\\$CNT_OK\${N}  Нет ответа: \${R}\\$CNT_ERR\${N}  Avg RTT: \${C}\\${AVG} ms\${N}  (\$((CNT_OK*100/TOTAL))%)"
else
  echo -e "  Онлайн: \${G}\\$CNT_OK\${N}  Нет ответа: \${R}\\$CNT_ERR\${N}"
fi
echo ""

read -rp "Нажмите Enter для выхода..."
`;

  dl(URL.createObjectURL(new Blob([bash],{type:'text/x-sh;charset=utf-8'})), 'network-ping.command');
  log('Экспортирован network-ping.command (macOS, '+devs.length+' устройств)');
}

// ═══════════════════════════════════════════════════════════
// SIGNAL TABLE
// ═══════════════════════════════════════════════════════════
function showSignalTable(){
  // Connections
  let eRows='';
  edges.forEach(e=>{
    const fn=nb(e.from), tn=nb(e.to); if(!fn||!tn) return;
    const fromLbl=fn.title+(fn.sub1?'<br><small style="color:#888">'+fn.sub1+'</small>':'');
    const toLbl  =tn.title+(tn.sub1?'<br><small style="color:#888">'+tn.sub1+'</small>':'');
    const type   =e.style==='dashed'?'OSC / упр.':'Медиасигнал';
    const extra  =[e.res,e.rate].filter(Boolean).join(' · ');
    eRows+=`<tr><td>${fromLbl}</td><td>${toLbl}</td><td>${e.label||'—'}</td><td>${e.cable||'—'}</td><td>${extra||'—'}</td><td>${type}</td></tr>`;
  });
  document.getElementById('st-connections').innerHTML=
    `<table class="sig-table"><thead><tr><th>От</th><th>К</th><th>Протокол</th><th>Кабель</th><th>Разр./Сэмпл.</th><th>Тип</th></tr></thead><tbody>${eRows||'<tr><td colspan="6" style="color:#aaa;text-align:center">Нет связей</td></tr>'}</tbody></table>`;

  // Devices
  let nRows='';
  nodes.forEach(n=>{
    const dtLbl = getDevtypeLabel(n.deviceType) || '—';
    const modelStr = n.novaModel ? ' '+n.novaModel
      : n.lightConsoleModel ? ' '+n.lightConsoleModel
      : n.audioConsole ? ' '+n.audioConsole
      : n.audioInterface ? ' '+n.audioInterface
      : n.broadcastType ? ' · '+n.broadcastType
      : n.videoSoftware ? ' · '+n.videoSoftware
      : n.captureDevice ? ' · '+n.captureDevice : '';
    const outStr = n.outputs ? ', '+n.outputs+' out' : '';
    const tc_str=n.tcOut?'↑ out':n.tc?'↓ in':'—';
    const sub=[n.sub1,n.sub2].filter(Boolean).join('<br>');
    nRows+=`<tr><td><b>${n.title}</b></td><td>${sub||'—'}</td><td>${dtLbl}${modelStr}${outStr}</td><td>${tc_str}</td></tr>`;
  });
  document.getElementById('st-devices').innerHTML=
    `<table class="sig-table"><thead><tr><th>Устройство</th><th>Описание</th><th>Тип</th><th>TC</th></tr></thead><tbody>${nRows||'<tr><td colspan="4" style="color:#aaa;text-align:center">Нет устройств</td></tr>'}</tbody></table>`;

  document.getElementById('st-cnt-e').textContent=edges.length;
  document.getElementById('st-cnt-n').textContent=nodes.length;

  const el=document.getElementById('std');
  el.style.display='block';
  if(!el._dragged){
    el.style.left=Math.max(8,(window.innerWidth-600)/2)+'px';
    el.style.top='56px';
  }
}

function exportSignalTable(){
  const date=new Date().toLocaleDateString('ru-RU');
  const css=`body{font-family:Arial,sans-serif;margin:28px;color:#333;}
h1{font-size:17px;margin-bottom:3px;}p.sub{color:#888;font-size:11px;margin-bottom:18px;}
h2{font-size:12px;margin:18px 0 6px;color:#555;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #eee;padding-bottom:4px;}
table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;}
th{background:#f0f0f0;border:1px solid #ddd;padding:5px 10px;text-align:left;font-size:10px;color:#555;text-transform:uppercase;}
td{border:1px solid #eee;padding:5px 10px;vertical-align:top;}
tr:nth-child(even) td{background:#fafafa;}small{color:#888;font-size:9px;}
.footer{margin-top:28px;font-size:10px;color:#bbb;border-top:1px solid #eee;padding-top:8px;}`;
  const title=document.title.replace(/\s*—.*$/,'');
  const html=`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>Таблица сигналов — ${title}</title><style>${css}</style></head><body>
<h1>Show Signal Flow — Таблица сигналов</h1>
<p class="sub">${title} &nbsp;·&nbsp; ${date}</p>
<h2>Связи (${edges.length})</h2>
${document.getElementById('st-connections').innerHTML}
<h2>Устройства (${nodes.length})</h2>
${document.getElementById('st-devices').innerHTML}
<div class="footer">© Concept Store 2026 &nbsp;·&nbsp; Show Signal Flow ${APP_VERSION}</div>
</body></html>`;
  dl(URL.createObjectURL(new Blob([html],{type:'text/html'})),'signal-table.html');
}

function exportCSV(){
  const BOM='\uFEFF'; // BOM для корректного открытия в Excel
  let csv=BOM+'"От";"К";"Протокол";"Кабель / разъём";"Разрешение";"Сэмплрейт";"Тип"\n';
  edges.forEach(e=>{
    const fn=nb(e.from),tn=nb(e.to); if(!fn||!tn) return;
    const type=e.style==='dashed'?'OSC/управление':'Медиасигнал';
    const q=s=>'"'+(s||'').replace(/"/g,'""')+'"';
    csv+=`${q(fn.title)};${q(tn.title)};${q(e.label)};${q(e.cable)};${q(e.res)};${q(e.rate)};${q(type)}\n`;
  });
  csv+='\n"Устройство";"Подзаголовок";"Тип";"Модель";"TC"\n';
  nodes.forEach(n=>{
    const dtLbl=getDevtypeLabel(n.deviceType)||'';
    const model=n.novaModel||n.lightConsoleModel||n.audioConsole||n.audioInterface||n.videoSoftware||n.tcSource||n.captureDevice||'';
    const tcStr=n.tcOut?'TC out':n.tc?'TC in':'';
    const q=s=>'"'+(s||'').replace(/"/g,'""')+'"';
    csv+=`${q(n.title)};${q([n.sub1,n.sub2].filter(Boolean).join(', '))};${q(dtLbl)};${q(model)};${q(tcStr)}\n`;
  });
  dl(URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),'signal-table.csv');
}

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
function openSearch(){
  const el=document.getElementById('sed');
  if(!el._dragged){
    el.style.left=Math.max(8,(window.innerWidth-300)/2)+'px';
    el.style.top='56px';
  }
  el.style.display='block';
  const inp=document.getElementById('se-q');
  inp.select();
  setTimeout(()=>inp.focus(),30);
  doSearch();
}

function closeSearch(){
  cp('sed');
  clearSearchHL();
  searchMatches=[]; searchIdx=-1;
}

function clearSearchHL(){
  NL.querySelectorAll('.search-match,.search-current').forEach(r=>{
    r.classList.remove('search-match','search-current');
  });
}

function doSearch(){
  const q=(document.getElementById('se-q').value||'').trim().toLowerCase();
  clearSearchHL();
  if(!q){ searchMatches=[]; searchIdx=-1; updateSearchInfo(); return; }
  searchMatches=nodes.filter(n=>
    (n.title||'').toLowerCase().includes(q)||
    (n.sub1||'').toLowerCase().includes(q)||
    (n.sub2||'').toLowerCase().includes(q)||
    (n.lightConsoleModel||'').toLowerCase().includes(q)||
    (n.audioConsole||'').toLowerCase().includes(q)||
    (n.novaModel||'').toLowerCase().includes(q)||
    getDevtypeLabel(n.deviceType).toLowerCase().includes(q) // U1: поиск по модели и типу
  );
  searchIdx=searchMatches.length?0:-1;
  applySearchHL();
  jumpToSearch();
  updateSearchInfo();
}

function applySearchHL(){
  searchMatches.forEach((n,i)=>{
    const g=NL.querySelector(`[data-id="${n.id}"]`);
    if(!g) return;
    const rect=g.querySelector('.node-rect');
    if(!rect) return;
    rect.classList.add('search-match');
    if(i===searchIdx) rect.classList.add('search-current');
  });
}

function jumpToSearch(){
  if(searchIdx<0||!searchMatches.length) return;
  const n=searchMatches[searchIdx];
  const {w,h}=getVPSize();
  vb.x=cx(n)-w/2/vb.z;
  vb.y=cy(n)-h/2/vb.z;
  applyVB();
}

function searchNext(){
  if(!searchMatches.length) return;
  searchIdx=(searchIdx+1)%searchMatches.length;
  clearSearchHL(); applySearchHL(); jumpToSearch(); updateSearchInfo();
}

function searchPrev(){
  if(!searchMatches.length) return;
  searchIdx=(searchIdx-1+searchMatches.length)%searchMatches.length;
  clearSearchHL(); applySearchHL(); jumpToSearch(); updateSearchInfo();
}

function updateSearchInfo(){
  const el=document.getElementById('se-info');
  if(!el) return;
  const q=(document.getElementById('se-q').value||'').trim();
  if(!q){ el.textContent=''; return; }
  if(!searchMatches.length){ el.textContent='не найдено'; el.style.color='#c00'; return; }
  el.textContent=(searchIdx+1)+' / '+searchMatches.length;
  el.style.color='#888';
}
document.getElementById('se-q').addEventListener('input', doSearch);
document.getElementById('se-q').addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.shiftKey?searchPrev():searchNext(); }
  if(e.key==='Escape'){ e.stopPropagation(); closeSearch(); }
});

// ═══════════════════════════════════════════════════════════
// MINIMAP
// ═══════════════════════════════════════════════════════════
const MM_W=180, MM_H=120;
let mmVisible=true;

// ═══════════════════════════════════════════════════════════
// HISTORY SIDEBAR
// ═══════════════════════════════════════════════════════════
let histOpen = false;

function toggleHistory(){
  histOpen = !histOpen;
  document.getElementById('hist-panel').classList.toggle('open', histOpen);
  document.getElementById('btn-hist').classList.toggle('active', histOpen);
  if(histOpen) rHistory();
}

function rHistory(){
  if(!histOpen) return;
  const list = document.getElementById('hist-list');
  if(!list) return;

  // Build display: past (old→new) + current + future (most recent undo first)
  const entries = [];
  undoLabels.forEach((lbl, i) => {
    entries.push({lbl, cls:'hist-entry', undoN: undoLabels.length - i, redoN: 0});
  });
  // Current state label with context
  let nowLbl;
  if(undoStack.length===0 && redoStack.length===0){
    nowLbl = nodes.length===0 ? '● Пустой проект' : `● Начало · ${nodes.length} нод`;
  } else {
    const ctx = nodes.length ? `${nodes.length} нод` : 'пусто';
    nowLbl = `● Сейчас (${ctx})`;
  }
  entries.push({lbl:nowLbl, cls:'hist-entry current', undoN:0, redoN:0});
  for(let i = redoLabels.length-1; i >= 0; i--){
    entries.push({lbl: redoLabels[i], cls:'hist-entry future', undoN:0, redoN: redoLabels.length - i});
  }

  // Newest at top → reverse
  list.innerHTML = entries.slice().reverse().map(e => {
    const onclick = e.undoN || e.redoN ? ` onclick="histJump(${e.undoN},${e.redoN})"` : '';
    return `<div class="${e.cls}"${onclick} title="${e.lbl}">${e.lbl}</div>`;
  }).join('');

  // Update undo/redo button disabled state
  const undoBtn = document.getElementById('btn-undo') || document.querySelector('.tbtn[onclick="undo()"]');
  const redoBtn = document.getElementById('btn-redo') || document.querySelector('.tbtn[onclick="redo()"]');
  if(undoBtn) undoBtn.disabled = undoStack.length === 0;
  if(redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function histJump(undoN, redoN){
  for(let i=0; i<undoN; i++){
    if(!undoStack.length) break;
    redoStack.push(JSON.stringify({nodes,edges,tcBuses,notes,zones,customDeviceTypes}));
    redoLabels.push(undoLabels[undoLabels.length-1]);
    const s=JSON.parse(undoStack.pop()); undoLabels.pop();
    nodes=s.nodes; edges=s.edges; _restoreTCBuses(s);
    notes=s.notes||[]; zones=s.zones||[];
    customDeviceTypes=s.customDeviceTypes||[];
    rebuildDevTypeSelects();
  }
  for(let i=0; i<redoN; i++){
    if(!redoStack.length) break;
    undoStack.push(JSON.stringify({nodes,edges,tcBuses,notes,zones,customDeviceTypes}));
    undoLabels.push(redoLabels[redoLabels.length-1]);
    const s=JSON.parse(redoStack.pop()); redoLabels.pop();
    nodes=s.nodes; edges=s.edges; _restoreTCBuses(s);
    notes=s.notes||[]; zones=s.zones||[];
    customDeviceTypes=s.customDeviceTypes||[];
    rebuildDevTypeSelects();
  }
  rAll();
}

function toggleMinimap(){
  mmVisible=!mmVisible;
  document.getElementById('mm').style.display=mmVisible?'block':'none';
  const btn=document.getElementById('btn-mm');
  if(btn) btn.classList.toggle('active',mmVisible);
  if(mmVisible) rMinimap();
}

function toggleMoreMenu(){
  const m=document.getElementById('more-menu');
  const btn=document.getElementById('btn-more');
  if(m.style.display==='block'){ m.style.display='none'; return; }
  const r=btn.getBoundingClientRect();
  m.style.left=r.left+'px';
  m.style.top=(r.bottom+4)+'px';
  m.style.display='block';
}
function hideMoreMenu(){ document.getElementById('more-menu').style.display='none'; }

// P3: rAF-throttle — миникарта перерисовывается не чаще 1 раза в кадр
let _mmPending=false;
function rMinimap(){
  if(!mmVisible) return;
  if(_mmPending) return;
  _mmPending=true;
  requestAnimationFrame(()=>{
    _mmPending=false;
    _rMinimapImmediate();
  });
}
function _rMinimapImmediate(){
  if(!mmVisible) return;
  const mmsvg=document.getElementById('mm-svg');
  if(!mmsvg) return;

  // Bounding box всего контента
  let mnX=99999,mnY=99999,mxX=-99999,mxY=-99999;
  nodes.forEach(n=>{
    const nh=nodeH(n);
    mnX=Math.min(mnX,n.x); mnY=Math.min(mnY,n.y);
    mxX=Math.max(mxX,n.x+n.w); mxY=Math.max(mxY,n.y+nh);
  });
  notes.forEach(n=>{
    mnX=Math.min(mnX,n.x); mnY=Math.min(mnY,n.y);
    mxX=Math.max(mxX,n.x+n.w); mxY=Math.max(mxY,n.y+n.h);
  });
  tcBuses.filter(b=>b.visible).forEach(b=>{ mnY=Math.min(mnY,b.y-10); mxX=Math.max(mxX,b.x2); });

  if(nodes.length===0&&notes.length===0){ mmsvg.innerHTML=''; return; }

  const PAD=16;
  mnX-=PAD; mnY-=PAD; mxX+=PAD; mxY+=PAD;
  const cW=mxX-mnX, cH=mxY-mnY;
  const scale=Math.min(MM_W/cW, MM_H/cH);
  const offX=(MM_W-cW*scale)/2;
  const offY=(MM_H-cH*scale)/2;
  const tx=wx=>(wx-mnX)*scale+offX;
  const ty=wy=>(wy-mnY)*scale+offY;

  let html='';

  // TC Buses
  tcBuses.filter(b=>b.visible).forEach(b=>{
    html+=`<line x1="${tx(b.x1)}" y1="${ty(b.y)}" x2="${tx(b.x2)}" y2="${ty(b.y)}"
      stroke="${b.color||'#aaa'}" stroke-width="1" stroke-dasharray="3,2"/>`;
  });

  // Edges (упрощённые — прямые линии между центрами)
  edges.forEach(e=>{
    const fn=nb(e.from),tn=nb(e.to); if(!fn||!tn) return;
    const col=e.style==='dashed'?'#bbb':'#999';
    const dash=e.style==='dashed'?'stroke-dasharray="2,1"':'';
    html+=`<line x1="${tx(cx(fn))}" y1="${ty(cy(fn))}" x2="${tx(cx(tn))}" y2="${ty(cy(tn))}"
      stroke="${col}" stroke-width="0.5" ${dash}/>`;
  });

  // Sticky notes
  notes.forEach(n=>{
    html+=`<rect x="${tx(n.x)}" y="${ty(n.y)}"
      width="${n.w*scale}" height="${n.h*scale}"
      rx="1" fill="${n.color||'#fffbe6'}" stroke="#bbb" stroke-width="0.5"/>`;
  });

  // Nodes
  const fillMap={highlight:'#ffe066',output:'#d8d8d8',audio:'#7cc5ff',normal:'#fff'};
  nodes.forEach(n=>{
    const nh=nodeH(n);
    const f=fillMap[n.style]||'#fff';
    html+=`<rect x="${tx(n.x)}" y="${ty(n.y)}"
      width="${n.w*scale}" height="${nh*scale}"
      rx="1" fill="${f}" stroke="#888" stroke-width="0.5"/>`;
  });

  // Viewport indicator
  const {w:vpW,h:vpH}=getVPSize();
  const vx=tx(vb.x), vy=ty(vb.y);
  const vw=(vpW/vb.z)*scale, vh=(vpH/vb.z)*scale;
  html+=`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}"
    fill="rgba(0,102,204,0.10)" stroke="#0066cc" stroke-width="1.5" rx="1"/>`;

  mmsvg.innerHTML=html;

  // Сохраняем параметры трансформации для навигации
  mmsvg._s=scale; mmsvg._mx=mnX; mmsvg._my=mnY; mmsvg._ox=offX; mmsvg._oy=offY;
}

// Клик/drag по миникарте → навигация
(function(){
  const mmsvg=document.getElementById('mm-svg');
  const navigate=ev=>{
    if(!mmsvg._s) return;
    const r=mmsvg.getBoundingClientRect();
    const wx=(ev.clientX-r.left-mmsvg._ox)/mmsvg._s+mmsvg._mx;
    const wy=(ev.clientY-r.top -mmsvg._oy)/mmsvg._s+mmsvg._my;
    const{w,h}=getVPSize();
    vb.x=wx-w/2/vb.z; vb.y=wy-h/2/vb.z;
    applyVB(); rMinimap();
  };
  mmsvg.addEventListener('mousedown',ev=>{
    ev.stopPropagation();
    navigate(ev);
    const mm=e=>navigate(e);
    startDrag(mm);
  });
})();

// ═══════════════════════════════════════════════════════════
// WELCOME SCREEN
// ═══════════════════════════════════════════════════════════
function showWelcome(){ document.getElementById('welcome').style.display='flex'; }
function hideWelcome(){ document.getElementById('welcome').style.display='none'; }

function newProject(){
  hideWelcome();
  _closeEditors();
  nodes=[]; edges=[]; tcBuses=[{...DTC_BUS}]; notes=[]; zones=[]; customDeviceTypes=[];
  _ngCache.clear(); _ntCache.clear(); _zcCache.clear(); _egCache.clear();
  rebuildDevTypeSelects();
  currentFilePath=null;
  undoStack.length=0; redoStack.length=0;
  document.title='Show Signal Flow — Новый проект';
  const btn=document.getElementById('btn-tc'); if(btn) btn.classList.add('active');
  applyVB(); rAll();
}

// ═══════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════
function _applyTemplate(tpl){
  hideWelcome();
  _closeEditors();
  _ngCache.clear(); _ntCache.clear(); _zcCache.clear(); _egCache.clear();
  nodes=tpl.nodes; edges=tpl.edges;
  _restoreTCBuses(tpl);
  notes=tpl.notes||[]; zones=tpl.zones||[];
  currentFilePath=null;
  undoStack.length=0; redoStack.length=0;
  document.title='Show Signal Flow — Новый проект';
  applyVB(); rAll(); setTimeout(fitAll,80);
}

function loadTemplateStandard(){
  const id=uid;
  const ms=id(),td=id(),lc=id(),nb=id(),pr=id(),sc=id();
  _applyTemplate({
    nodes:[
      {id:ms,x:300,y:200,w:175,h:58,title:'Resolume Arena',sub1:'Медиасервер',sub2:'VJ / Video Playback',style:'normal',deviceType:'video-server',videoSoftware:'Resolume Arena',tc:true},
      {id:td,x:620,y:200,w:175,h:58,title:'TouchDesigner',sub1:'Генерация эффектов',sub2:'',style:'highlight',deviceType:'touchdesigner',tc:true},
      {id:lc,x:620,y:380,w:175,h:58,title:'grandMA3',sub1:'Световой пульт',sub2:'Световое управление',style:'highlight',deviceType:'light-console',tc:true},
      {id:nb,x:300,y:380,w:175,h:58,title:'TC Laptop',sub1:'Timecode Source',sub2:'Reaper · LTC',style:'normal',deviceType:'timecode',tcSource:'Reaper (LTC)',tcOut:true,tc:false},
      {id:pr,x:940,y:200,w:175,h:50,title:'Novastar MCTRL4K',sub1:'Видеопроцессор',sub2:'',style:'normal',deviceType:'led-processor',novaModel:'MCTRL4K',outputs:4},
      {id:sc,x:940,y:380,w:175,h:50,title:'LED Screen',sub1:'Основной экран',sub2:'',style:'output'},
    ],
    edges:[
      {id:'e1',from:ms,to:pr,label:'DP / HDMI',style:'solid',wp:[]},
      {id:'e2',from:td,to:pr,label:'NDI / HDMI',style:'solid',wp:[]},
      {id:'e3',from:lc,to:sc,label:'DMX512',style:'solid',wp:[]},
      {id:'e4',from:pr,to:sc,label:'Cat6 / Ethernet',style:'solid',wp:[]},
      {id:'e5',from:td,to:ms,label:'OSC',style:'dashed',wp:[]},
    ],
    tcBuses:[{...DTC_BUS,y:100,x1:200,x2:1200}],
    zones:[
      {id:'z1',x:260,y:160,w:540,h:140,label:'Видео система',color:'#4a9eff'},
      {id:'z2',x:260,y:340,w:540,h:140,label:'Управление / Свет',color:'#ffbb33'},
    ]
  });
}

function loadTemplateVideo(){
  const id=uid;
  const ms=id(),sw=id(),pr=id(),sc=id(),prj=id();
  _applyTemplate({
    nodes:[
      {id:ms,x:200,y:200,w:175,h:58,title:'Resolume Arena',sub1:'Медиасервер',sub2:'Video Playback',style:'normal',deviceType:'video-server',videoSoftware:'Resolume Arena',tc:false},
      {id:sw,x:480,y:200,w:175,h:50,title:'ATEM Mini Pro',sub1:'Видеомикшер',sub2:'',style:'normal'},
      {id:pr,x:760,y:150,w:175,h:50,title:'Novastar MCTRL4K',sub1:'Видеопроцессор',sub2:'',style:'normal',deviceType:'led-processor',novaModel:'MCTRL4K',outputs:4},
      {id:sc,x:760,y:290,w:175,h:50,title:'LED Screen',sub1:'Основной экран',sub2:'',style:'output'},
      {id:prj,x:480,y:340,w:175,h:50,title:'Проектор',sub1:'Экран / задник',sub2:'',style:'output'},
    ],
    edges:[
      {id:'e1',from:ms,to:sw,label:'HDMI 2.0',style:'solid',wp:[]},
      {id:'e2',from:sw,to:pr,label:'DP / HDMI',style:'solid',wp:[]},
      {id:'e3',from:sw,to:prj,label:'HDMI',style:'solid',wp:[]},
      {id:'e4',from:pr,to:sc,label:'Cat6',style:'solid',wp:[]},
    ],
    tcBuses:[{...DTC_BUS,visible:false}],
    zones:[
      {id:'z1',x:160,y:150,w:680,h:240,label:'Видео система',color:'#4a9eff'},
    ]
  });
}

function loadTemplateAudio(){
  const id=uid;
  const foh=id(),mon=id(),ai=id(),pa=id(),nb=id();
  _applyTemplate({
    nodes:[
      {id:foh,x:280,y:200,w:175,h:58,title:'Yamaha CL5',sub1:'FOH Пульт',sub2:'Front of House',style:'audio',deviceType:'audio-console',audioConsole:'Yamaha CL5',tc:true},
      {id:mon,x:560,y:200,w:175,h:58,title:'Yamaha QL5',sub1:'Monitor Пульт',sub2:'Stage Monitor',style:'audio',deviceType:'audio-console',audioConsole:'Yamaha QL5',tc:true},
      {id:ai,x:280,y:380,w:175,h:58,title:'RME Fireface UFX III',sub1:'Аудиоинтерфейс',sub2:'TC / Запись',style:'audio',deviceType:'audio-interface',audioInterface:'RME Fireface UFX III',tc:true},
      {id:pa,x:560,y:380,w:175,h:50,title:'PA System',sub1:'Акустика зала',sub2:'',style:'output'},
      {id:nb,x:840,y:200,w:175,h:58,title:'TC Laptop',sub1:'Timecode Source',sub2:'LTC out',style:'normal',deviceType:'timecode',tcSource:'Reaper (LTC)',tcOut:true,tc:false},
    ],
    edges:[
      {id:'e1',from:foh,to:pa,label:'Dante / AES67',style:'solid',wp:[]},
      {id:'e2',from:mon,to:pa,label:'Dante',style:'solid',wp:[]},
      {id:'e3',from:ai,to:foh,label:'MADI / Dante',style:'solid',wp:[]},
      {id:'e4',from:ai,to:mon,label:'MADI / Dante',style:'solid',wp:[]},
    ],
    tcBuses:[{...DTC_BUS,y:120,x1:200,x2:1100}],
    zones:[
      {id:'z1',x:240,y:160,w:500,h:300,label:'Звуковая система',color:'#1a6aaa'},
    ]
  });
}

function openHelp(){
  sp('help-popup',{clientX:window.innerWidth/2-200, clientY:80});
}

// patch fileOpen to hide welcome on success
const _origFileOpen = fileOpen;
fileOpen = async function(){
  await _origFileOpen();
  // if nodes loaded, hide welcome
  if(nodes.length) hideWelcome();
};
try { localStorage.removeItem('show_flow_v1'); } catch(e){}

applyVB();
nodes=[]; edges=[]; tcBuses=[{...DTC_BUS}];
rAll();
// Always show welcome on start
showWelcome();