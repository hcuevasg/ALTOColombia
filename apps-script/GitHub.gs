/**
 * GitHub.gs — Publicación en GitHub Pages vía la API de contenidos.
 * Escribe 3 archivos (cada PUT es un commit):
 *   1. docs/index.html               → el boletín de HOY (se sobreescribe)
 *   2. docs/ediciones/FECHA.html     → el boletín fechado, permanente
 *   3. docs/ediciones/indice.json    → append del manifiesto (dedup por fecha)
 *
 * Secrets en Propiedades del Script: GITHUB_PAT, GITHUB_REPO (ej. "hcuevasg/ALTOColombia").
 * La URL base de Pages se DERIVA de GITHUB_REPO (no hay URL hardcodeada).
 *
 * Verificación: ejecutar testPublicar(). Deben aparecer los 3 archivos en el repo
 * y el boletín renderizado en https://<usuario>.github.io/<repo>/.
 */

var GITHUB_API    = 'https://api.github.com';
var GITHUB_BRANCH = 'main';
var DOCS_DIR      = 'docs';

/** URL base del sitio de Pages, derivada de GITHUB_REPO. '' si falta el secret. */
function basePages_() {
  var repo = PropertiesService.getScriptProperties().getProperty('GITHUB_REPO');
  if (!repo || repo.indexOf('/') === -1) return '';
  var partes = repo.split('/');
  return 'https://' + partes[0] + '.github.io/' + partes[1];
}

/**
 * Publica un boletín completo. Escribe index.html, la edición fechada y
 * actualiza indice.json. Devuelve un resumen o null si algo falla.
 * @param {Object} edicion      objeto del contrato (para fecha/título/índice).
 * @param {string} htmlEdicion  HTML completo (de renderBoletin()).
 */
function publicarEdicion(edicion, htmlEdicion) {
  var props = PropertiesService.getScriptProperties();
  var pat  = props.getProperty('GITHUB_PAT');
  var repo = props.getProperty('GITHUB_REPO');
  if (!pat || !repo) {
    Logger.log('✗ Faltan GITHUB_PAT y/o GITHUB_REPO en Propiedades del Script.');
    return null;
  }

  var fecha = edicion.fecha;
  var rutaEdicion = DOCS_DIR + '/ediciones/' + fecha + '.html';
  var rutaIndex   = DOCS_DIR + '/index.html';
  var rutaIndice  = DOCS_DIR + '/ediciones/indice.json';

  // 1) Edición fechada (permanente).
  if (!escribirArchivo_(repo, pat, rutaEdicion, htmlEdicion,
                        'Boletín ' + fecha)) return null;
  Logger.log('✓ %s', rutaEdicion);

  // 2) index.html = boletín de hoy (sobreescribe).
  if (!escribirArchivo_(repo, pat, rutaIndex, htmlEdicion,
                        'Boletín de hoy: ' + fecha)) return null;
  Logger.log('✓ %s', rutaIndex);

  // 3) Append al manifiesto (read-modify-write, dedup por fecha).
  if (!actualizarIndice_(repo, pat, rutaIndice, fecha, tituloIndice_(edicion))) return null;
  Logger.log('✓ %s (append)', rutaIndice);

  var base = basePages_();
  return {
    hoy:     base + '/',
    edicion: base + '/ediciones/' + fecha + '.html',
    archivo: base + '/archivo.html'
  };
}

/** Título de la entrada del archivo: el incidente más grave del día. */
function tituloIndice_(edicion) {
  var inc = (edicion.incidentes || [])[0];
  var n = 'Boletín ' + edicion.numero;
  return inc ? (n + ' · ' + inc.titular) : (n + ' · ' + edicion.fecha);
}

/**
 * Lee indice.json, agrega/actualiza la entrada de la fecha y lo reescribe.
 */
function actualizarIndice_(repo, pat, ruta, fecha, titulo) {
  var actual = obtenerArchivo_(repo, pat, ruta);
  var lista = [];
  var sha = null;

  if (actual) {
    sha = actual.sha;
    try {
      lista = JSON.parse(actual.texto) || [];
      if (!Array.isArray(lista)) lista = [];
    } catch (e) {
      Logger.log('  ⚠ indice.json ilegible, se reinicia: %s', e.message);
      lista = [];
    }
  }

  // Dedup por fecha: si ya existe, se actualiza el título; si no, se agrega.
  var entrada = { fecha: fecha, titulo: titulo, archivo: 'ediciones/' + fecha + '.html' };
  var encontrada = false;
  for (var i = 0; i < lista.length; i++) {
    if (lista[i] && lista[i].fecha === fecha) { lista[i] = entrada; encontrada = true; break; }
  }
  if (!encontrada) lista.push(entrada);

  var json = JSON.stringify(lista, null, 2) + '\n';
  return escribirArchivo_(repo, pat, ruta, json, 'Índice: ' + fecha, sha);
}

// ---------- API de GitHub (contenidos) -----------------------------------

/**
 * GET de un archivo. Devuelve {sha, texto} o null si no existe (404).
 */
function obtenerArchivo_(repo, pat, ruta) {
  var url = GITHUB_API + '/repos/' + repo + '/contents/' + codificarRuta_(ruta) +
            '?ref=' + GITHUB_BRANCH;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: cabecerasGitHub_(pat)
  });

  var codigo = resp.getResponseCode();
  if (codigo === 404) return null;
  if (codigo !== 200) {
    Logger.log('✗ GET %s → HTTP %s: %s', ruta, codigo, resp.getContentText().slice(0, 300));
    return null;
  }

  var data = JSON.parse(resp.getContentText());
  var base64 = String(data.content || '').replace(/\n/g, '');
  var texto = '';
  if (base64) {
    texto = Utilities.newBlob(Utilities.base64Decode(base64)).getDataAsString('UTF-8');
  }
  return { sha: data.sha, texto: texto };
}

/**
 * PUT (crea o actualiza) un archivo. Si no se pasa sha, lo resuelve solo.
 * @return {boolean} true si HTTP 200/201.
 */
function escribirArchivo_(repo, pat, ruta, contenido, mensaje, sha) {
  // Si no nos dieron sha, averiguar si el archivo ya existe (para actualizar).
  if (sha === undefined) {
    var existente = obtenerArchivo_(repo, pat, ruta);
    sha = existente ? existente.sha : null;
  }

  var payload = {
    message: mensaje,
    content: Utilities.base64Encode(contenido, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH
  };
  if (sha) payload.sha = sha;

  var url = GITHUB_API + '/repos/' + repo + '/contents/' + codificarRuta_(ruta);
  var resp = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: cabecerasGitHub_(pat),
    payload: JSON.stringify(payload)
  });

  var codigo = resp.getResponseCode();
  if (codigo === 200 || codigo === 201) return true;
  Logger.log('✗ PUT %s → HTTP %s: %s', ruta, codigo, resp.getContentText().slice(0, 400));
  return false;
}

/** Cabeceras estándar de la API de GitHub (User-Agent es obligatorio). */
function cabecerasGitHub_(pat) {
  return {
    'Authorization': 'Bearer ' + pat,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ALTO-Boletin-Colombia'
  };
}

/** Codifica cada segmento de la ruta (deja las barras). */
function codificarRuta_(ruta) {
  return ruta.split('/').map(encodeURIComponent).join('/');
}

// ---------- Verificación -------------------------------------------------

/**
 * Corre el pipeline completo y publica en Pages.
 */
function testPublicar() {
  Logger.log('=== Prueba de publicación ===');

  var articulos = recolectarTitulares();
  var edicion = generarBoletin(articulos);
  if (!edicion) { Logger.log('✗ Sin boletín; revisá fuentes y Claude.'); return; }

  var html = renderBoletin(edicion);
  var res = publicarEdicion(edicion, html);
  if (!res) { Logger.log('✗ No se pudo publicar.'); return; }

  Logger.log('✓ Publicado. Esperá ~1 min a que Pages reconstruya y abrí:');
  Logger.log('   Hoy:     %s', res.hoy);
  Logger.log('   Edición: %s', res.edicion);
  Logger.log('   Archivo: %s', res.archivo);
}
