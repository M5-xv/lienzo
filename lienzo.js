/* Lienzo · utilidades compartidas por todas las apps.
   Escrito para Safari de iOS 12: sin ?., sin ??, sin Pointer Events. */
var LZ = (function(){
  // ---------- Almacenamiento chico (localStorage) ----------
  function get(k, d){ try{ var v = localStorage.getItem('lz_'+k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } }
  function set(k, v){ try{ localStorage.setItem('lz_'+k, JSON.stringify(v)); return true; }catch(e){ toast('Memoria llena'); return false; } }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function $(id){ return document.getElementById(id); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
  function pad(n){ return (n < 10 ? '0' : '') + n; }

  // ---------- Almacenamiento grande (IndexedDB: fotos y audio) ----------
  var dbp = null;
  function db(){
    if(dbp) return dbp;
    dbp = new Promise(function(ok, ko){
      if(!window.indexedDB) return ko(new Error('Sin IndexedDB'));
      var r = indexedDB.open('lienzo', 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore('kv'); };
      r.onsuccess = function(){ ok(r.result); };
      r.onerror = function(){ ko(r.error); };
    });
    return dbp;
  }
  function op(mode, fn){
    return db().then(function(d){
      return new Promise(function(ok, ko){
        var tx = d.transaction('kv', mode), req = fn(tx.objectStore('kv'));
        tx.oncomplete = function(){ ok(req ? req.result : undefined); };
        tx.onerror = tx.onabort = function(){ ko(tx.error); };
      });
    });
  }
  function iget(k){ return op('readonly', function(s){ return s.get(k); }); }
  function iset(k, v){ return op('readwrite', function(s){ return s.put(v, k); }); }
  function idel(k){ return op('readwrite', function(s){ return s.delete(k); }); }

  // ---------- Fotos: lee, corrige la rotación de iOS 12 y achica ----------
  function orientacion(buf){
    try{
      var v = new DataView(buf); if(v.getUint16(0) !== 0xFFD8) return 1;
      var len = v.byteLength, off = 2;
      while(off < len - 4){
        var m = v.getUint16(off); off += 2;
        if(m === 0xFFE1){
          if(v.getUint32(off + 2) !== 0x45786966) return 1;
          var t = off + 8, le = v.getUint16(t) === 0x4949;
          var ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
          for(var i = 0; i < n; i++){ var e = ifd + 2 + i*12; if(e + 12 > len) return 1; if(v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le); }
          return 1;
        } else if((m & 0xFF00) !== 0xFF00) break;
        else off += v.getUint16(off);
      }
    }catch(e){}
    return 1;
  }
  var autoRota = (function(){ try{ return window.CSS && CSS.supports && CSS.supports('image-orientation', 'from-image'); }catch(e){ return false; } })();
  function foto(file, max, q){
    return new Promise(function(ok, ko){
      var rb = new FileReader();
      rb.onload = function(){
        var o = autoRota ? 1 : orientacion(rb.result);
        var r = new FileReader();
        r.onload = function(){
          var img = new Image();
          img.onload = function(){
            var w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
            w = Math.round(w*k); h = Math.round(h*k);
            var c = document.createElement('canvas'), x = c.getContext('2d');
            if(o > 4){ c.width = h; c.height = w; } else { c.width = w; c.height = h; }
            switch(o){
              case 2: x.transform(-1,0,0,1,w,0); break;  case 3: x.transform(-1,0,0,-1,w,h); break;
              case 4: x.transform(1,0,0,-1,0,h); break;  case 5: x.transform(0,1,1,0,0,0); break;
              case 6: x.transform(0,1,-1,0,h,0); break;  case 7: x.transform(0,-1,-1,0,h,w); break;
              case 8: x.transform(0,-1,1,0,0,w); break;
            }
            x.drawImage(img, 0, 0, w, h);
            ok(c.toDataURL('image/jpeg', q || 0.85));
          };
          img.onerror = function(){ ko(new Error('No pude leer la imagen')); };
          img.src = r.result;
        };
        r.readAsDataURL(file);
      };
      rb.onerror = function(){ ko(rb.error); };
      rb.readAsArrayBuffer(file.slice(0, 131072));
    });
  }

  // ---------- Claude ----------
  function claude(body){
    var key = get('key', '');
    if(!key){ var e0 = new Error('sin-clave'); e0.status = 'key'; return Promise.reject(e0); }
    body.model = body.model || get('modelo', 'claude-haiku-5-5');
    body.max_tokens = body.max_tokens || 1024;
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body: JSON.stringify(body)
    }).then(function(r){
      return r.json().then(function(j){
        if(!r.ok){ var e = new Error((j.error && j.error.message) || ('Error ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function texto(j){ return j.content.filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('\n').trim(); }
  function json(j){ var t = texto(j), m = t.match(/\{[\s\S]*\}/); if(!m) throw new Error('Respuesta sin datos'); return JSON.parse(m[0]); }
  function error(e){
    if(e.status === 'key') return standalone ? 'Falta la clave de API: cargala en Ajustes de Lienzo.' : 'Falta la clave de API en esta pestaña de Safari.';
    if(e.status === 401) return 'La clave de API no es válida.';
    if(e.status === 429) return 'Demasiados pedidos o sin saldo. Probá en un rato.';
    if(e.status === 529 || e.status === 503) return 'Claude está saturado. Probá de nuevo.';
    if(e.message === 'Load failed' || e.message === 'Failed to fetch') return 'Sin conexión a internet.';
    return 'Error: ' + e.message;
  }
  function pedirClave(){
    var k = window.prompt('Pegá tu clave de API de Claude (sk-ant-…)', '');
    if(k && k.trim()){ set('key', k.trim()); return true; }
    return false;
  }

  // ---------- Audio (Web Audio con prefijo de iOS 12) ----------
  var actx = null;
  function audio(){
    if(!actx){ var A = window.AudioContext || window.webkitAudioContext; if(!A) return null; actx = new A(); }
    if(actx.state === 'suspended' && actx.resume) actx.resume();
    return actx;
  }
  function desbloquear(){
    var c = audio(); if(!c) return;
    var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
    s.buffer = b; s.connect(c.destination); if(s.start) s.start(0); else s.noteOn(0);
  }

  // ---------- Entorno ----------
  var standalone = window.navigator.standalone === true;
  var media = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  function enSafari(){ var a = document.createElement('a'); a.href = location.href.split('#')[0]; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.parentNode.removeChild(a); }

  // ---------- Avisos ----------
  var tt = null;
  function toast(msg){
    var el = $('lz-toast');
    if(!el){ el = document.createElement('div'); el.id = 'lz-toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('on'); clearTimeout(tt);
    tt = setTimeout(function(){ el.classList.remove('on'); }, 2600);
  }

  // ---------- Tiempo trabajado (lo usan Crono y Claude) ----------
  function sesiones(){ var c = get('crono', {run:null, ses:[]}); var s = c.ses.slice(); if(c.run) s.push({s:c.run.s, e:Date.now(), label:c.run.label}); return s; }
  function inicioDia(d){ var x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
  function hm(ms){ var m = Math.round(ms/60000), h = Math.floor(m/60); return h ? h + 'h ' + pad(m%60) + 'm' : m + 'm'; }

  return {get:get, set:set, esc:esc, $:$, uid:uid, pad:pad, iget:iget, iset:iset, idel:idel, foto:foto,
    claude:claude, texto:texto, json:json, error:error, pedirClave:pedirClave, audio:audio, desbloquear:desbloquear,
    standalone:standalone, media:media, enSafari:enSafari, toast:toast, sesiones:sesiones, inicioDia:inicioDia, hm:hm};
})();
