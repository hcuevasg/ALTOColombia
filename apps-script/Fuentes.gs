/**
 * Fuentes.gs — Detección Colombia
 * Arma consultas temáticas de seguridad nacional sobre Google News (CO) y trae
 * RSS en paralelo (fetchAll). A diferencia de Chile (centrado en clientes), el
 * boletín Colombia es un monitor de seguridad nacional: los temas son fijos y
 * vienen EMBEBIDOS por defecto — el sistema funciona sin Sheet.
 *
 * Sheet OPCIONAL (Propiedad SHEET_ID) para ampliar/reemplazar sin tocar código:
 *   TemasSeguridad:    A=tema      B=términos (coma-separados)  → reemplaza los defaults
 *   FuentesGenerales:  A=etiqueta  B=url (RSS directo)          → se agrega siempre
 *
 * Cada artículo sale etiquetado con su tema. La clasificación fina (severidad,
 * sector, departamento) la hace la IA en Claude.gs.
 *
 * Verificación: ejecutar test() — lista lo capturado por tema, para comparar a
 * ojo contra el boletín de ARES del mismo día (benchmark de cobertura).
 */

var TOPE_LOG_TEST = 60;
var LOTE_FETCH    = 40;     // tamaño de lote para fetchAll
var DIAS_BUSQUEDA = 2;      // when:2d en Google News
// Filtro de recencia duro: descarta toda nota cuya fecha de publicación sea más
// vieja que esto (el when: de Google News no es estricto y deja pasar antiguas).
var MAX_HORAS_ANTIGUEDAD = 48;

/**
 * Temas de seguridad por defecto (etiqueta, términos CSV — multipalabra se
 * auto-cita en la query). Cubren el espectro del boletín ARES: grupos armados,
 * secuestro/extorsión, ataques, desplazamiento, narcotráfico, seguridad urbana,
 * fuerza pública y afectación a sectores productivos.
 */
var TEMAS_POR_DEFECTO = [
  ['Grupos armados',        'ELN, disidencias, Clan del Golfo, paro armado, panfleto amenazante, grupo armado ilegal'],
  ['Secuestro',             'secuestro, secuestrados, secuestrado, rescate de secuestrados, retenidos por hombres armados'],
  ['Extorsión',             'extorsión, extorsiones, vacuna extorsiva, extorsionistas capturados'],
  ['Ataques y atentados',   'atentado, masacre, hostigamiento, emboscada, ataque con drones, artefacto explosivo, carro bomba'],
  ['Desplazamiento',        'desplazamiento forzado, confinamiento, familias desplazadas, toque de queda'],
  ['Narcotráfico',          'incautación de cocaína, laboratorio de cocaína, cargamento de droga, narcotráfico operación'],
  ['Seguridad urbana',      'fleteo, sicariato, paseo millonario, banda delincuencial desarticulada'],
  ['Fuerza pública',        'operación militar, militares heridos, soldados heridos, captura de cabecilla, neutralizados'],
  ['Sectores productivos',  'extorsión comerciantes, extorsión ganaderos, bloqueo de vía, minería ilegal, atentado oleoducto']
];

function test() {
  Logger.log('=== Prueba de fuentes Colombia (benchmark vs. ARES) ===');
  var articulos = recolectarTitulares();
  if (!articulos.length) return;

  var conteo = {};
  for (var i = 0; i < articulos.length; i++) {
    var et = articulos[i].etiqueta || '?';
    conteo[et] = (conteo[et] || 0) + 1;
  }
  Logger.log('Por tema: %s', JSON.stringify(conteo));

  var n = Math.min(articulos.length, TOPE_LOG_TEST);
  for (var k = 0; k < n; k++) {
    var a = articulos[k];
    Logger.log('%s. [%s] %s (%s)', (k + 1), a.etiqueta, a.titular, a.fuente);
  }
  if (articulos.length > n) Logger.log('… y %s más.', articulos.length - n);
}

/**
 * Arma las consultas (defaults o Sheet), hace fetch en lotes paralelos, parsea,
 * etiqueta y deduplica.
 * @return {Array<Object>} {titular,url,fuente,fecha,etiqueta}
 */
function recolectarTitulares() {
  var specs = armarConsultas_();
  Logger.log('Consultas a ejecutar: %s', specs.length);

  var todos = [];
  for (var i = 0; i < specs.length; i += LOTE_FETCH) {
    var lote = specs.slice(i, i + LOTE_FETCH);
    var requests = lote.map(function (s) {
      return {
        url: s.url, muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (ALTO Boletin Colombia)' }
      };
    });
    var respuestas;
    try { respuestas = UrlFetchApp.fetchAll(requests); }
    catch (e) { Logger.log('  ✗ fetchAll falló en lote %s: %s', i, e.message); continue; }
    for (var j = 0; j < respuestas.length; j++) {
      todos = todos.concat(parsearRespuesta_(respuestas[j], lote[j]));
    }
  }

  var unicos = deduplicar_(todos);
  Logger.log('Ítems %s → únicos %s (−%s dup)', todos.length, unicos.length, todos.length - unicos.length);
  return unicos;
}

// ---------- Armado de consultas -------------------------------------------

/** @return {Array<{url,etiqueta}>} */
function armarConsultas_() {
  var specs = [];

  // 1) Temas de seguridad: defaults embebidos, o la pestaña TemasSeguridad si existe.
  var temas = leerTemasDelSheet_();
  if (!temas.length) temas = TEMAS_POR_DEFECTO;
  temas.forEach(function (fila) {
    var etiqueta = String(fila[0] || 'Seguridad').trim();
    var terms = orTerminos_(fila[1]);
    if (terms) specs.push({ url: urlGoogleNews_(terms, DIAS_BUSQUEDA), etiqueta: etiqueta });
  });

  // 2) Fuentes RSS directas (opcional, pestaña FuentesGenerales): la URL va tal cual.
  var ss = abrirSheet_();
  if (ss) {
    recorrerHoja_(ss, 'FuentesGenerales', function (fila) {
      var url = String(fila[1] || '').trim();
      if (url) specs.push({ url: url, etiqueta: String(fila[0] || 'General').trim() });
    });
  }

  return specs;
}

/** Lee la pestaña TemasSeguridad. Devuelve [] si no hay Sheet o está vacía. */
function leerTemasDelSheet_() {
  var ss = abrirSheet_();
  if (!ss) return [];
  var temas = [];
  recorrerHoja_(ss, 'TemasSeguridad', function (fila) {
    if (String(fila[0] || '').trim() && String(fila[1] || '').trim()) temas.push(fila);
  });
  return temas;
}

/** El Sheet es OPCIONAL en Colombia: sin SHEET_ID se usan los defaults, sin log de error. */
function abrirSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) return null;
  try { return SpreadsheetApp.openById(id); }
  catch (e) { Logger.log('  ⚠ No se pudo abrir el Sheet (%s); se usan los temas por defecto.', e.message); return null; }
}

/** Recorre filas de datos (salta encabezado) llamando fn(fila). */
function recorrerHoja_(ss, nombreHoja, fn) {
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) return;
  var filas = hoja.getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) fn(filas[i]);
}

/** 'robo, paro armado' → 'robo OR "paro armado"' (cita multipalabra). */
function orTerminos_(csv) {
  var partes = String(csv || '').split(',').map(function (t) {
    t = t.trim();
    if (!t) return '';
    return /\s/.test(t) && !/^".*"$/.test(t) ? '"' + t + '"' : t;
  }).filter(Boolean);
  return partes.join(' OR ');
}

/** URL de búsqueda de Google News RSS (CO, español) con when:Nd. */
function urlGoogleNews_(query, dias) {
  return 'https://news.google.com/rss/search?q=' +
         encodeURIComponent(query + ' when:' + dias + 'd') +
         '&hl=es-419&gl=CO&ceid=CO:es';
}

// ---------- Parseo y dedup ----------------------------------------------

function parsearRespuesta_(resp, spec) {
  if (!resp || resp.getResponseCode() !== 200) return [];
  var raiz;
  try { raiz = XmlService.parse(resp.getContentText()).getRootElement(); }
  catch (e) { return []; }

  var canal = raiz.getChild('channel');
  var items = canal ? canal.getChildren('item') : raiz.getChildren('entry');

  var articulos = [];
  for (var i = 0; i < items.length; i++) {
    var art = parsearItem_(items[i], { etiqueta: spec.etiqueta });
    if (!art || !esReciente_(art.fecha)) continue;
    articulos.push(art);
  }
  return articulos;
}

/** true si la nota es reciente (≤ MAX_HORAS_ANTIGUEDAD). Sin fecha legible: se conserva. */
function esReciente_(fechaStr) {
  if (!fechaStr) return true;
  var d = new Date(fechaStr);
  if (isNaN(d.getTime())) return true;
  var horas = (new Date().getTime() - d.getTime()) / 3600000;
  return horas <= MAX_HORAS_ANTIGUEDAD;
}

/** <item>/<entry> → objeto base. REGLA DURA: sin titular o sin url → null. */
function parsearItem_(item, fuente) {
  var titular = textoHijo_(item, 'title');
  var url = textoHijo_(item, 'link');
  if (!url) {
    var link = item.getChild('link');
    var href = link ? link.getAttribute('href') : null;
    if (href) url = href.getValue();
  }
  if (!titular || !url) return null;

  var nombreFuente = '';
  var src = item.getChild('source');
  if (src) nombreFuente = src.getText();

  var fecha = textoHijo_(item, 'pubDate') || textoHijo_(item, 'published') ||
              textoHijo_(item, 'updated') || '';

  return {
    titular: limpiar_(titular),
    url: url.trim(),
    fuente: nombreFuente ? limpiar_(nombreFuente) : fuente.etiqueta,
    fecha: fecha.trim(),
    etiqueta: fuente.etiqueta
  };
}

/**
 * Deduplica por URL Y por titular normalizado. Necesario porque Google News
 * devuelve URLs de redirección distintas para el MISMO artículo según el feed
 * (los temas se solapan: un secuestro del ELN aparece en 2-3 queries).
 */
function deduplicar_(articulos) {
  var vistosUrl = {}, vistosTit = {}, unicos = [];
  for (var i = 0; i < articulos.length; i++) {
    var a = articulos[i];
    var claveUrl = normalizarUrl_(a.url);
    var claveTit = normalizarTitulo_(a.titular);
    if (vistosUrl[claveUrl] || (claveTit && vistosTit[claveTit])) continue;
    vistosUrl[claveUrl] = true;
    if (claveTit) vistosTit[claveTit] = true;
    unicos.push(a);
  }
  return unicos;
}

// ---------- Utilidades ---------------------------------------------------

function textoHijo_(elem, nombre) {
  var hijo = elem.getChild(nombre);
  return hijo ? hijo.getText() : '';
}

/** minúsculas + sin diacríticos (NFD); deja solo a-z0-9 como letras. */
function normalizarTexto_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function escaparRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizarUrl_(url) {
  return String(url).trim().toLowerCase().replace(/\/+$/, '');
}
/** Clave de dedup por titular: minúsculas, sin acentos, espacios colapsados. */
function normalizarTitulo_(s) {
  return normalizarTexto_(s).replace(/\s+/g, ' ').trim();
}
function limpiar_(texto) {
  return String(texto).replace(/\s+/g, ' ').trim();
}
