(function(){
  "use strict";

  // ---------- State ----------
  var map, boundaryLayer = null, boundaryPoints = null;
  var approvedPins = [], pendingPins = [];
  var isAdmin = false;
  var mode = null; // 'addpin' | 'draw' | null
  var drawVertices = [], drawPolyline = null, drawVertexMarkers = [];
  var approvedMarkers = {}, pendingMarkers = {};
  var pendingPinLatLng = null;

  // ---------- Icons ----------
  // Set de iconos SVG (estilo Heroicons) para usar en HTML generado por JS.
  var ICONS = {
    pin: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>',
    phone: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a1.5 1.5 0 0 0 1.5-1.5v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"/></svg>',
    mail: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>',
    clock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>'
  };

  // ---------- Supabase ----------
  // La URL y la clave publicable son seguras de exponer en el cliente: la
  // proteccion real de los datos vive en las politicas RLS de Supabase, no
  // en ocultar estas credenciales.
  var SUPABASE_URL = 'https://izezmuhdkcnandsauldu.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_it9t8S7Bg5Xsfc0hXQ6SaQ_32G__E3Q';
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  async function fetchPins(){
    var r = await sb.from('mapa_pins').select('*').order('created_at', { ascending: true });
    if(r.error){ showToast('No se pudo cargar la información (sin conexión).'); return []; }
    return r.data;
  }
  async function fetchBoundary(){
    var r = await sb.from('mapa_boundary').select('points').eq('id', 'main').maybeSingle();
    if(r.error || !r.data || !r.data.points || r.data.points.length < 3) return null;
    return r.data.points;
  }
  async function saveBoundaryRemote(points){
    var r = await sb.from('mapa_boundary').upsert({ id: 'main', points: points, updated_at: new Date().toISOString() });
    if(r.error){ showToast('No se pudo guardar el límite.'); return false; }
    return true;
  }
  async function insertPinRemote(pin, status){
    var r = await sb.from('mapa_pins').insert({
      lat: pin.lat, lng: pin.lng, nombre: pin.nombre,
      telefono: pin.telefono || null, email: pin.email || null,
      notas: pin.notas || null, direccion: pin.direccion || null,
      status: status
    }).select().single();
    if(r.error){ showToast('No se pudo guardar la ubicación.'); return null; }
    return r.data;
  }
  async function updatePinStatusRemote(id, status){
    var r = await sb.from('mapa_pins').update({ status: status }).eq('id', id);
    return !r.error;
  }
  async function deletePinRemote(id){
    var r = await sb.from('mapa_pins').delete().eq('id', id);
    return !r.error;
  }
  async function adminExists(){
    var r = await sb.rpc('mapa_admin_exists');
    return !!r.data;
  }
  async function adminSetup(pin){
    var r = await sb.rpc('mapa_admin_setup', { p_pin: pin });
    return !r.error && !!r.data;
  }
  async function adminVerify(pin){
    var r = await sb.rpc('mapa_admin_verify', { p_pin: pin });
    return !r.error && !!r.data;
  }

  function showToast(msg){
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function(){ t.classList.remove('show'); }, 2400);
  }

  // ---------- Map init ----------
  function initMap(){
    map = L.map('map', { zoomControl: true, minZoom: 3 }).setView([27.4761, -99.5164], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 20
    }).addTo(map);

    map.on('click', onMapClick);
  }

  function makeDivIcon(color, faded){
    return L.divIcon({
      className: '',
      html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);'
          + 'background:'+color+';border:2px solid rgba(255,255,255,0.85);'
          + 'box-shadow:0 2px 6px rgba(0,0,0,0.5);'+(faded?'opacity:0.85;':'')+'"></div>',
      iconSize: [18,18],
      iconAnchor: [9,17]
    });
  }

  function renderApprovedPin(pin){
    var marker = L.marker([pin.lat, pin.lng], { icon: makeDivIcon('#3ecf8e') }).addTo(map);
    marker.bindPopup(popupHtml(pin, 'approved'));
    approvedMarkers[pin.id] = marker;
  }
  function renderPendingPin(pin){
    var marker = L.marker([pin.lat, pin.lng], { icon: makeDivIcon('#f2a541', true) }).addTo(map);
    marker.bindPopup(popupHtml(pin, 'pending'));
    pendingMarkers[pin.id] = marker;
  }
  function popupHtml(pin, status){
    var statusHtml = status === 'approved'
      ? '<span class="popup-status status-approved">Aprobado</span>'
      : '<span class="popup-status status-pending">Pendiente de aprobación</span>';
    return '<div class="popup-title">'+escapeHtml(pin.nombre||'Sin nombre')+'</div>'
      + (pin.direccion ? '<div class="popup-line">'+ICONS.pin+' '+escapeHtml(pin.direccion)+'</div>' : '')
      + (pin.telefono ? '<div class="popup-line">'+ICONS.phone+' '+escapeHtml(pin.telefono)+'</div>' : '')
      + (pin.email ? '<div class="popup-line">'+ICONS.mail+' '+escapeHtml(pin.email)+'</div>' : '')
      + (pin.notas ? '<div class="popup-line">'+escapeHtml(pin.notas)+'</div>' : '')
      + statusHtml;
  }
  function escapeHtml(s){
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  var maskLayer = null;
  var WORLD_RING = [[-89,-179],[89,-179],[89,179],[-89,179]];

  function ringSignedArea(ring){
    var sum = 0;
    for(var i=0;i<ring.length;i++){
      var a = ring[i], b = ring[(i+1)%ring.length];
      sum += (a[1]*b[0] - b[1]*a[0]);
    }
    return sum;
  }

  function renderMask(points){
    if(maskLayer){ map.removeLayer(maskLayer); maskLayer = null; }
    if(!points || points.length < 3) return;
    var hole = points.slice();
    if((ringSignedArea(WORLD_RING) > 0) === (ringSignedArea(hole) > 0)) hole = hole.slice().reverse();
    maskLayer = L.polygon([WORLD_RING, hole], {
      stroke: false, fillColor: '#eef1f6', fillOpacity: 0.72, interactive: false
    }).addTo(map);
  }

  function applyBoundaryRestriction(points){
    if(points && points.length >= 3){
      var bounds = L.polygon(points).getBounds().pad(0.15);
      map.setMaxBounds(bounds);
      map.fitBounds(bounds);
    } else {
      map.setMaxBounds(null);
    }
  }

  function renderBoundary(points){
    if(boundaryLayer){ map.removeLayer(boundaryLayer); boundaryLayer = null; }
    boundaryPoints = (points && points.length >= 3) ? points : null;
    renderMask(boundaryPoints);
    applyBoundaryRestriction(boundaryPoints);
    if(!boundaryPoints) return;
    boundaryLayer = L.polygon(points, {
      color: '#3fd0c9', weight: 2, fillColor: '#3fd0c9', fillOpacity: 0.12
    }).addTo(map);
  }

  // ---------- Loading data ----------
  async function loadAll(){
    var boundary = await fetchBoundary();
    renderBoundary(boundary);

    var pins = await fetchPins();
    approvedPins = pins.filter(function(p){ return p.status === 'approved'; });
    pendingPins = pins.filter(function(p){ return p.status === 'pending'; });
    approvedPins.forEach(renderApprovedPin);
    pendingPins.forEach(renderPendingPin);

    updatePendingButton();
    document.getElementById('mapLoading').classList.add('hide');
  }

  function clearAllMarkers(){
    Object.keys(approvedMarkers).forEach(function(id){ map.removeLayer(approvedMarkers[id]); delete approvedMarkers[id]; });
    Object.keys(pendingMarkers).forEach(function(id){ map.removeLayer(pendingMarkers[id]); delete pendingMarkers[id]; });
  }

  async function refreshPins(){
    clearAllMarkers();
    var pins = await fetchPins();
    approvedPins = pins.filter(function(p){ return p.status === 'approved'; });
    pendingPins = pins.filter(function(p){ return p.status === 'pending'; });
    approvedPins.forEach(renderApprovedPin);
    pendingPins.forEach(renderPendingPin);
    updatePendingButton();
    if(document.getElementById('pendingOverlay').classList.contains('show')) renderPendingList();
    if(document.getElementById('peopleOverlay').classList.contains('show')) renderPeopleList();
  }

  async function refreshBoundary(){
    renderBoundary(await fetchBoundary());
  }

  function subscribeRealtime(){
    sb.channel('mapa-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mapa_pins' }, function(){ refreshPins(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mapa_boundary' }, function(){ refreshBoundary(); })
      .subscribe();
  }

  // ---------- Admin UI ----------
  function refreshAdminArea(){
    var el = document.getElementById('adminArea');
    if(isAdmin){
      el.innerHTML = '<span class="badge">Administrador</span>'
        + '<button class="small" id="btnLogout">Salir</button>';
      document.getElementById('btnLogout').onclick = function(){
        isAdmin = false;
        refreshAdminArea();
        document.getElementById('btnDrawBoundary').style.display = 'none';
        document.getElementById('btnDeleteBoundary').style.display = boundaryPoints ? 'none' : 'none';
        document.getElementById('btnPending').style.display = 'none';
        showToast('Sesión de administrador cerrada.');
      };
    } else {
      el.innerHTML = '<button class="small" id="btnAdminMode">'+ICONS.lock+' Modo administrador</button>';
      document.getElementById('btnAdminMode').onclick = openAdminModal;
    }
    document.getElementById('btnAddPin').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('btnDrawBoundary').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('btnDeleteBoundary').style.display = (isAdmin && boundaryPoints) ? 'inline-block' : 'none';
    document.getElementById('btnPending').style.display = isAdmin ? 'inline-block' : 'none';
    updatePendingButton();
  }

  function updatePendingButton(){
    var btn = document.getElementById('btnPending');
    btn.innerHTML = ICONS.clock + 'Pendientes (' + pendingPins.length + ')';
  }

  async function openAdminModal(){
    var exists = await adminExists();
    var overlay = document.getElementById('adminOverlay');
    var confirmWrap = document.getElementById('pinConfirmWrap');
    var sub = document.getElementById('adminModalSub');
    var title = document.getElementById('adminModalTitle');
    document.getElementById('fieldPin1').value = '';
    document.getElementById('fieldPin2').value = '';

    if(!exists){
      title.textContent = 'Crear PIN de administrador';
      sub.textContent = 'Nadie ha configurado un administrador todavía. Crea un PIN (solo debe hacerlo la persona encargada).';
      confirmWrap.style.display = 'block';
      overlay.dataset.setup = 'true';
    } else {
      title.textContent = 'Modo administrador';
      sub.textContent = 'Ingresa el PIN de administrador para autorizar cambios.';
      confirmWrap.style.display = 'none';
      overlay.dataset.setup = 'false';
    }
    overlay.classList.add('show');
  }

  document.getElementById('btnAdminSubmit').addEventListener('click', async function(){
    var overlay = document.getElementById('adminOverlay');
    var pin1 = document.getElementById('fieldPin1').value.trim();
    if(!pin1){ showToast('Ingresa un PIN.'); return; }

    if(overlay.dataset.setup === 'true'){
      var pin2 = document.getElementById('fieldPin2').value.trim();
      if(pin1.length < 4){ showToast('Usa al menos 4 caracteres.'); return; }
      if(pin1 !== pin2){ showToast('Los PIN no coinciden.'); return; }
      var created = await adminSetup(pin1);
      if(created){
        isAdmin = true;
        overlay.classList.remove('show');
        refreshAdminArea();
        showToast('PIN de administrador creado. Ahora tienes acceso.');
      } else {
        showToast('Ya existe un PIN configurado. Cierra y vuelve a intentar con el PIN existente.');
      }
    } else {
      var valid = await adminVerify(pin1);
      if(valid){
        isAdmin = true;
        overlay.classList.remove('show');
        refreshAdminArea();
        showToast('Bienvenido, administrador.');
      } else {
        showToast('PIN incorrecto.');
      }
    }
  });

  // ---------- Add pin flow ----------
  document.getElementById('btnAddPin').addEventListener('click', function(){
    if(mode === 'addpin'){ exitMode(); return; }
    exitMode();
    mode = 'addpin';
    document.getElementById('btnAddPin').classList.add('primary');
    setHelper('Toca un punto en el mapa para colocar la ubicación.');
  });

  function setHelper(text){
    var h = document.getElementById('helperText');
    if(text){ h.textContent = text; h.classList.add('show'); }
    else { h.classList.remove('show'); }
  }

  function exitMode(){
    var wasDrawing = mode === 'draw';
    mode = null;
    setHelper(null);
    document.getElementById('btnAddPin').classList.remove('primary');
    document.getElementById('drawControls').classList.remove('show');
    clearDrawing();
    if(wasDrawing) applyBoundaryRestriction(boundaryPoints);
  }

  async function onMapClick(e){
    if(mode === 'addpin'){
      pendingPinLatLng = e.latlng;
      openPinModal(e.latlng);
    } else if(mode === 'draw'){
      drawVertices.push([e.latlng.lat, e.latlng.lng]);
      addVertexMarker(e.latlng, drawVertices.length - 1);
      redrawTempPolyline();
    }
  }

  function makeVertexIcon(){
    return L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#3fd0c9;'
          + 'border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.5);cursor:grab;"></div>',
      iconSize: [14,14],
      iconAnchor: [7,7]
    });
  }

  function addVertexMarker(latlng, idx){
    var vm = L.marker(latlng, { icon: makeVertexIcon(), draggable: true }).addTo(map);
    vm.on('drag', function(){
      var ll = vm.getLatLng();
      drawVertices[idx] = [ll.lat, ll.lng];
      redrawTempPolyline();
    });
    drawVertexMarkers.push(vm);
  }

  function redrawTempPolyline(){
    if(drawPolyline){ map.removeLayer(drawPolyline); }
    if(drawVertices.length > 1){
      drawPolyline = L.polygon(drawVertices, { color:'#3fd0c9', weight:2, fillOpacity:0.08, dashArray:'6,6' }).addTo(map);
    }
  }

  async function openPinModal(latlng){
    var overlay = document.getElementById('pinOverlay');
    document.getElementById('fieldNombre').value = '';
    document.getElementById('fieldTelefono').value = '';
    document.getElementById('fieldEmail').value = '';
    document.getElementById('fieldNotas').value = '';
    document.getElementById('fieldDireccion').value = '';
    document.getElementById('pinAddressLabel').textContent = 'Buscando dirección...';
    overlay.classList.add('show');

    try{
      var res = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+latlng.lat+'&lon='+latlng.lng+'&zoom=18&addressdetails=1');
      var data = await res.json();
      var addr = data && data.display_name ? data.display_name : '';
      document.getElementById('pinAddressLabel').textContent = addr ? addr : 'No se detectó una dirección exacta, puedes escribirla manualmente.';
      document.getElementById('fieldDireccion').value = addr;
    }catch(err){
      document.getElementById('pinAddressLabel').textContent = 'No se pudo obtener la dirección automáticamente.';
    }
  }

  document.getElementById('btnSavePin').addEventListener('click', async function(){
    var nombre = document.getElementById('fieldNombre').value.trim();
    if(!nombre){ showToast('Escribe el nombre del encargado.'); return; }
    if(!pendingPinLatLng){ showToast('No se detectó la ubicación.'); return; }

    var pinInput = {
      lat: pendingPinLatLng.lat,
      lng: pendingPinLatLng.lng,
      nombre: nombre,
      telefono: document.getElementById('fieldTelefono').value.trim(),
      email: document.getElementById('fieldEmail').value.trim(),
      notas: document.getElementById('fieldNotas').value.trim(),
      direccion: document.getElementById('fieldDireccion').value.trim()
    };

    var status = isAdmin ? 'approved' : 'pending';
    var saved = await insertPinRemote(pinInput, status);
    if(saved){
      if(status === 'approved'){
        approvedPins.push(saved);
        renderApprovedPin(saved);
        showToast('Ubicación guardada.');
      } else {
        pendingPins.push(saved);
        renderPendingPin(saved);
        updatePendingButton();
        showToast('Enviado. Un administrador debe aprobarlo.');
      }
    }

    document.getElementById('pinOverlay').classList.remove('show');
    pendingPinLatLng = null;
    exitMode();
  });

  // ---------- Draw boundary ----------
  document.getElementById('btnDrawBoundary').addEventListener('click', function(){
    if(mode === 'draw'){ exitMode(); return; }
    exitMode();
    mode = 'draw';
    map.setMaxBounds(null);
    document.getElementById('drawControls').classList.add('show');
    if(boundaryPoints){
      drawVertices = boundaryPoints.map(function(p){ return [p[0], p[1]]; });
      drawVertices.forEach(function(p, i){ addVertexMarker(L.latLng(p[0], p[1]), i); });
      redrawTempPolyline();
      setHelper('Arrastra los puntos para moverlos, toca el mapa para agregar más, o usa "Deshacer". Presiona "Finalizar área" para guardar los cambios.');
    } else {
      setHelper('Toca varios puntos en el mapa para trazar el límite de la colonia. Cuando termines, presiona "Finalizar área".');
    }
  });

  function clearDrawing(){
    drawVertices = [];
    drawVertexMarkers.forEach(function(m){ map.removeLayer(m); });
    drawVertexMarkers = [];
    if(drawPolyline){ map.removeLayer(drawPolyline); drawPolyline = null; }
  }

  document.getElementById('btnUndoPoint').addEventListener('click', function(){
    if(drawVertices.length === 0) return;
    drawVertices.pop();
    var vm = drawVertexMarkers.pop();
    if(vm) map.removeLayer(vm);
    redrawTempPolyline();
  });

  document.getElementById('btnCancelDraw').addEventListener('click', function(){ exitMode(); });

  document.getElementById('btnFinishDraw').addEventListener('click', async function(){
    if(drawVertices.length < 3){ showToast('Marca al menos 3 puntos para formar un área.'); return; }
    var ok = await saveBoundaryRemote(drawVertices);
    if(ok){
      renderBoundary(drawVertices);
      showToast('Límite de la colonia guardado.');
      refreshAdminArea();
    }
    exitMode();
  });

  document.getElementById('btnDeleteBoundary').addEventListener('click', async function(){
    if(!confirm('¿Eliminar el límite de la colonia?')) return;
    var ok = await saveBoundaryRemote([]);
    if(ok){
      renderBoundary(null);
      showToast('Límite eliminado.');
      refreshAdminArea();
    }
  });

  // ---------- Pending panel ----------
  document.getElementById('btnPending').addEventListener('click', function(){
    renderPendingList();
    document.getElementById('pendingOverlay').classList.add('show');
  });

  function renderPendingList(){
    var container = document.getElementById('pendingList');
    if(pendingPins.length === 0){
      container.innerHTML = '<div class="empty-note">No hay ubicaciones pendientes.</div>';
      return;
    }
    container.innerHTML = '';
    pendingPins.forEach(function(pin){
      var item = document.createElement('div');
      item.className = 'pending-item';
      item.innerHTML = '<div class="name">'+escapeHtml(pin.nombre)+'</div>'
        + '<div class="meta">'
        + (pin.telefono ? ICONS.phone+' '+escapeHtml(pin.telefono)+'<br>' : '')
        + (pin.direccion ? ICONS.pin+' '+escapeHtml(pin.direccion)+'<br>' : '')
        + (pin.notas ? escapeHtml(pin.notas) : '')
        + '</div>'
        + '<div class="pending-actions">'
        + '<button class="primary small" data-approve="'+pin.id+'">Aprobar</button>'
        + '<button class="danger small" data-reject="'+pin.id+'">Rechazar</button>'
        + '</div>';
      container.appendChild(item);
    });
    container.querySelectorAll('[data-approve]').forEach(function(btn){
      btn.onclick = function(){ approvePin(btn.getAttribute('data-approve')); };
    });
    container.querySelectorAll('[data-reject]').forEach(function(btn){
      btn.onclick = function(){ rejectPin(btn.getAttribute('data-reject')); };
    });
  }

  async function approvePin(id){
    var idx = pendingPins.findIndex(function(p){ return p.id === id; });
    if(idx === -1) return;
    var pin = pendingPins[idx];
    var ok = await updatePinStatusRemote(id, 'approved');
    if(ok){
      pendingPins.splice(idx,1);
      pin.status = 'approved';
      approvedPins.push(pin);
      if(pendingMarkers[id]){ map.removeLayer(pendingMarkers[id]); delete pendingMarkers[id]; }
      renderApprovedPin(pin);
      updatePendingButton();
      renderPendingList();
      showToast('Ubicación aprobada.');
    }
  }

  async function rejectPin(id){
    var idx = pendingPins.findIndex(function(p){ return p.id === id; });
    if(idx === -1) return;
    var ok = await deletePinRemote(id);
    if(ok){
      pendingPins.splice(idx,1);
      if(pendingMarkers[id]){ map.removeLayer(pendingMarkers[id]); delete pendingMarkers[id]; }
      updatePendingButton();
      renderPendingList();
      showToast('Ubicación rechazada.');
    }
  }

  // ---------- People search ----------
  document.getElementById('btnPeopleSearch').addEventListener('click', function(){
    renderPeopleList();
    document.getElementById('peopleOverlay').classList.add('show');
  });

  function renderPeopleList(){
    var container = document.getElementById('peopleList');
    if(approvedPins.length === 0){
      container.innerHTML = '<div class="empty-note">Todavía no hay personas registradas.</div>';
      return;
    }
    var sorted = approvedPins.slice().sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es'); });
    container.innerHTML = '';
    sorted.forEach(function(pin){
      var item = document.createElement('div');
      item.className = 'pending-item clickable';
      item.innerHTML = '<div class="name">'+escapeHtml(pin.nombre)+'</div>'
        + '<div class="meta">'
        + (pin.direccion ? ICONS.pin+' '+escapeHtml(pin.direccion)+'<br>' : '')
        + (pin.telefono ? ICONS.phone+' '+escapeHtml(pin.telefono)+'<br>' : '')
        + (pin.email ? ICONS.mail+' '+escapeHtml(pin.email) : '')
        + '</div>';
      item.onclick = function(){
        document.getElementById('peopleOverlay').classList.remove('show');
        map.setView([pin.lat, pin.lng], 18);
        var marker = approvedMarkers[pin.id];
        if(marker) marker.openPopup();
      };
      container.appendChild(item);
    });
  }

  // ---------- Address search ----------
  var searchTimeout = null;
  document.getElementById('searchInput').addEventListener('input', function(e){
    var q = e.target.value.trim();
    clearTimeout(searchTimeout);
    var resultsBox = document.getElementById('searchResults');
    if(q.length < 3){ resultsBox.style.display = 'none'; return; }
    searchTimeout = setTimeout(async function(){
      try{
        // viewbox delimita Nuevo Laredo, Tamaulipas para priorizar resultados locales (calles y casas)
        var url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=12'
          + '&countrycodes=mx&viewbox=-99.62,27.60,-99.40,27.35&bounded=1&dedupe=1'
          + '&q=' + encodeURIComponent(q);
        var res = await fetch(url);
        var data = await res.json();
        if(!data || data.length === 0){ resultsBox.style.display = 'none'; return; }
        resultsBox.innerHTML = '';
        data.forEach(function(place){
          var addr = place.address || {};
          var casa = [addr.house_number, addr.road || addr.pedestrian].filter(Boolean).join(' ') || place.display_name.split(',')[0];
          var zona = [addr.neighbourhood || addr.suburb || addr.residential, addr.city || addr.town || 'Nuevo Laredo'].filter(Boolean).join(', ');
          var div = document.createElement('div');
          div.innerHTML = '<div style="font-weight:700;color:var(--text);">'+escapeHtml(casa)+'</div>'
            + '<div style="font-size:11px;margin-top:2px;">'+escapeHtml(zona)+'</div>';
          div.onclick = function(){
            map.setView([parseFloat(place.lat), parseFloat(place.lon)], 18);
            resultsBox.style.display = 'none';
            document.getElementById('searchInput').value = place.display_name;
          };
          resultsBox.appendChild(div);
        });
        resultsBox.style.display = 'block';
      }catch(err){ resultsBox.style.display = 'none'; }
    }, 450);
  });

  document.addEventListener('click', function(e){
    if(!e.target.closest('.search-wrap')){
      document.getElementById('searchResults').style.display = 'none';
    }
  });

  // ---------- Modal close helpers ----------
  document.querySelectorAll('[data-close]').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.getElementById(btn.getAttribute('data-close')).classList.remove('show');
    });
  });
  document.querySelectorAll('.overlay').forEach(function(ov){
    ov.addEventListener('click', function(e){
      if(e.target === ov) ov.classList.remove('show');
    });
  });

  // ---------- Boot ----------
  initMap();
  refreshAdminArea();
  loadAll();
  subscribeRealtime();

})();
