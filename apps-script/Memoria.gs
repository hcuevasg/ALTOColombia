/**
 * Memoria.gs — dos memorias persistentes en Script Properties:
 *
 * 1) URLS_VISTAS — no repetir incidentes ya reportados (igual que Chile):
 *    hash de cada URL publicada con su fecha; filtra lo ya salido y poda lo viejo.
 *
 * 2) HISTORIAL_EDICIONES — las últimas ediciones en formato compacto. Se pasa al
 *    prompt para que el modelo calcule TENDENCIAS (día contra día) y marque
 *    SEGUIMIENTO ("Día 2 de seguimiento") de hechos que continúan. Sin esto las
 *    tendencias no tienen línea base.
 *
 * Limitación conocida del dedup: es por URL. Si el MISMO hecho sale otro día con
 * URL distinta (otro medio), lo maneja el modelo vía historial (seguimiento).
 */

var MEM_PROP = 'URLS_VISTAS';
var MEM_DIAS_RETENCION = 4;       // un poco más que la ventana de 48 h

var HIST_PROP = 'HISTORIAL_EDICIONES';
var HIST_MAX_EDICIONES = 3;       // ediciones que se conservan para tendencias

// ---------- 1) URLs ya publicadas ----------------------------------------

/** Filtra los artículos cuya URL ya fue publicada en una corrida anterior. */
function filtrarNoVistos_(articulos) {
  var vistas = leerVistas_();
  var fuera = 0;
  var nuevos = articulos.filter(function (a) {
    if (vistas[hashUrl_(a.url)]) { fuera++; return false; }
    return true;
  });
  Logger.log('Memoria: %s ya reportados descartados; quedan %s nuevos.', fuera, nuevos.length);
  return nuevos;
}

/** Registra las URLs que salieron en el boletín y poda viejas. */
function registrarPublicados_(edicion) {
  var vistas = leerVistas_();
  var ahora = new Date().getTime();
  urlsDeEdicion_(edicion).forEach(function (u) { vistas[hashUrl_(u)] = ahora; });
  guardarVistas_(podarVistas_(vistas, ahora));
}

/** Todas las URLs presentes en el boletín. */
function urlsDeEdicion_(edicion) {
  var urls = [];
  (edicion.incidentes || []).forEach(function (i) { if (i.url) urls.push(i.url); });
  return urls;
}

function leerVistas_() {
  var raw = PropertiesService.getScriptProperties().getProperty(MEM_PROP);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}
function guardarVistas_(vistas) {
  PropertiesService.getScriptProperties().setProperty(MEM_PROP, JSON.stringify(vistas));
}
function podarVistas_(vistas, ahora) {
  var corte = ahora - MEM_DIAS_RETENCION * 86400000;
  var limpio = {};
  Object.keys(vistas).forEach(function (h) { if (vistas[h] >= corte) limpio[h] = vistas[h]; });
  return limpio;
}

/** Hash corto y estable de la URL normalizada (MD5 → 16 hex). normalizarUrl_ está en Fuentes.gs. */
function hashUrl_(url) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, normalizarUrl_(url));
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 16);
}

// ---------- 2) Historial de ediciones (tendencias y seguimiento) ----------

/**
 * Historial para el prompt: [{fecha, incidentes: [{t: titular, s: severidad, d: depto}]}],
 * de la edición más vieja a la más nueva. [] los primeros días.
 */
function leerHistorial_() {
  var raw = PropertiesService.getScriptProperties().getProperty(HIST_PROP);
  if (!raw) return [];
  try {
    var h = JSON.parse(raw);
    return Array.isArray(h) ? h : [];
  } catch (e) { return []; }
}

/** Agrega la edición de hoy al historial en formato compacto y poda a HIST_MAX_EDICIONES. */
function registrarHistorial_(edicion) {
  var historial = leerHistorial_().filter(function (ed) {
    return ed && ed.fecha !== edicion.fecha;   // re-corridas del día: se reemplaza
  });
  historial.push({
    fecha: edicion.fecha,
    incidentes: (edicion.incidentes || []).map(function (i) {
      return { t: i.titular, s: i.severidad, d: i.departamento || '' };
    })
  });
  while (historial.length > HIST_MAX_EDICIONES) historial.shift();
  PropertiesService.getScriptProperties().setProperty(HIST_PROP, JSON.stringify(historial));
  Logger.log('Historial: %s ediciones conservadas.', historial.length);
}
