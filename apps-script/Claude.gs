/**
 * Claude.gs — Clasificador del Tablero de Inteligencia (Colombia)
 * UNA llamada a Anthropic que transforma el corpus detectado en el boletín:
 *   incidentes con severidad/sector/región + balance regional + tendencias
 *   (contra el historial de ediciones) + descartados + recomendaciones para
 *   clientes privados.
 *
 * Anti-alucinación por id-indirection: al modelo se le pasan titulares numerados
 * SIN url; referencia por id y nosotros resolvemos url/fuente/fecha reales.
 *
 * Verificación: setear ANTHROPIC_API_KEY y ejecutar testClaude().
 */

var CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODELO   = 'claude-sonnet-4-6';
var CLAUDE_VERSION  = '2023-06-01';
var CLAUDE_MAX_TOKENS = 12000;

// Sectores válidos para el etiquetado (el modelo debe elegir de esta lista).
var SECTORES = ['Retail y comercio', 'Banca', 'Agro y exportación',
                'Logística y transporte', 'Minería y energía', 'Salud',
                'Seguridad privada', 'General'];

// Topes del boletín (críticos y altos pasan todos; el resto se acota).
var TOPE_MEDIO = 6;
var TOPE_CONTEXTO = 3;
var TOPE_DESCARTADOS = 8;
var TOPE_TENDENCIAS = 6;
var TOPE_BALANCE = 7;
var TOPE_RECOMENDACIONES = 6;

var ORDEN_SEVERIDAD = { critico: 0, alto: 1, medio: 2, contexto: 3 };

/** Punto de entrada de verificación. */
function testClaude() {
  Logger.log('=== Prueba del clasificador (Claude) ===');

  var articulos = recolectarTitulares();
  if (!articulos.length) { Logger.log('✗ Sin titulares.'); return; }
  Logger.log('Titulares de entrada: %s', articulos.length);

  var edicion = generarBoletin(articulos);
  if (!edicion) { Logger.log('✗ No se pudo generar un boletín válido.'); return; }

  Logger.log('✓ JSON válido. Fecha: %s · Boletín N° %s', edicion.fecha, edicion.numero);
  Logger.log('Resumen: %s', edicion.resumen_ejecutivo);
  Logger.log('▣ INCIDENTES: %s', edicion.incidentes.length);
  for (var i = 0; i < edicion.incidentes.length; i++) {
    var inc = edicion.incidentes[i];
    Logger.log('  • [%s/%s] %s — %s, %s%s', inc.severidad, inc.sector, inc.titular,
               inc.municipio || '—', inc.departamento || '—',
               inc.seguimiento ? (' · ' + inc.seguimiento) : '');
  }
  Logger.log('▣ BALANCE REGIONAL: %s', edicion.balance_regional.length);
  edicion.balance_regional.forEach(function (r) {
    Logger.log('  • %s: %s (%s)', r.region, r.nivel, r.detalle);
  });
  Logger.log('▣ TENDENCIAS: %s', edicion.tendencias.length);
  edicion.tendencias.forEach(function (t) {
    Logger.log('  • [%s] %s — %s', t.direccion, t.etiqueta, t.detalle);
  });
  Logger.log('▣ DESCARTADOS: %s', edicion.descartados.length);
  Logger.log('▣ RECOMENDACIONES: %s', edicion.recomendaciones.length);
  edicion.recomendaciones.forEach(function (r) {
    Logger.log('  • [%s · %s] %s', r.sector, r.region, r.texto);
  });
}

/**
 * Genera el contrato completo del boletín a partir del corpus.
 * @param {Array<Object>} articulos  salida de recolectarTitulares().
 * @return {Object|null}
 */
function generarBoletin(articulos) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) { Logger.log('✗ Falta ANTHROPIC_API_KEY.'); return null; }

  var historial = leerHistorial_();
  var promptUsuario = construirPromptUsuario_(articulos, historial);

  var texto = llamarClaude_(apiKey, PROMPT_SISTEMA, promptUsuario);
  if (!texto) return null;

  var seleccion = parsearJsonDefensivo_(texto);
  if (!seleccion) { Logger.log('✗ Respuesta del modelo no parseable.'); return null; }

  return expandirAContrato_(seleccion, articulos);
}

// ---------- Prompt -------------------------------------------------------

var PROMPT_SISTEMA = [
  'Sos analista de inteligencia de ALTO Colombia, empresa de prevención de pérdidas y',
  'seguridad corporativa. Producís el "Boletín Diario de Seguridad" para clientes',
  'PRIVADOS (retail, banca, agro, logística, minería, salud, seguridad privada).',
  '',
  'Recibís: (1) una lista NUMERADA de titulares reales de las últimas 48 h, cada uno',
  'etiquetado con el tema de búsqueda que lo capturó; y (2) un HISTORIAL con los',
  'incidentes de las ediciones anteriores (puede venir vacío los primeros días).',
  '',
  'Producí UN solo JSON con estas salidas:',
  '',
  'A) incidentes — los hechos de seguridad relevantes del período:',
  '   - UN ítem por HECHO: si varios titulares cubren el mismo hecho, elegí SOLO el id',
  '     más informativo (medio más serio o titular más completo). No repitas el hecho.',
  '   - severidad, calibrada con TODO el rango (no marques todo "critico"):',
  '       "critico"  = afectación grave en curso o inminente con impacto en operaciones',
  '                    privadas o seguridad de personas: paro armado anunciado, secuestro',
  '                    activo, bloqueo de servicios esenciales, ataque a infraestructura,',
  '                    combates con confinamiento o restricción de movilidad.',
  '       "alto"     = escalada o amenaza seria sectorial/regional: extorsión en escalada',
  '                    a un gremio, masacre o atentado consumado, desplazamiento forzado,',
  '                    operación mayor contra estructura armada.',
  '       "medio"    = hechos relevantes de seguimiento: capturas, operativos, incidentes',
  '                    urbanos significativos (fleteo, sicariato, agresiones en transporte).',
  '       "contexto" = declaraciones, balances oficiales, análisis políticos del conflicto.',
  '   - sector: el MÁS afectado, EXACTAMENTE uno de: ' + SECTORES.join(' | ') + '.',
  '     Usá "General" cuando el hecho es de orden público sin sector dominante.',
  '   - departamento y municipio del hecho (si el titular no lo dice, inferilo solo si es',
  '     inequívoco; si no, dejá "" — NO inventes ubicaciones).',
  '   - resumen: 1-2 frases sobrias. LENGUAJE PRUDENTE OBLIGATORIO: "presunto", "habría",',
  '     "atribuido a"; si una versión no está confirmada, decilo ("versión no verificada").',
  '   - seguimiento: si el hecho continúa uno del HISTORIAL (misma situación, día',
  '     siguiente), poné una nota breve tipo "Día 2 de seguimiento"; si no, "".',
  '',
  'B) descartados — hasta ' + TOPE_DESCARTADOS + ' EJEMPLOS de titulares capturados que descartás por ser',
  '   ruido sin valor para clientes (hecho policial menor, microtráfico local, deportes,',
  '   farándula, nota duplicada de menor calidad). motivo: breve (≤10 palabras). Esto',
  '   demuestra el filtro de relevancia; no listes todo lo descartado.',
  '',
  'C) balance_regional — 4 a ' + TOPE_BALANCE + ' regiones/departamentos con actividad en el período:',
  '   nivel "Crítico" | "Alto" | "Medio" | "Monitoreo" + detalle de 1 línea. Calibrá:',
  '   "Crítico" solo si hay afectación grave EN CURSO en esa región.',
  '',
  'D) tendencias — hasta ' + TOPE_TENDENCIAS + ' comparaciones del período contra el HISTORIAL:',
  '   direccion "sube" | "baja" | "estable", etiqueta corta (ej. "Secuestro") y detalle',
  '   con números concretos cuando los haya (víctimas, heridos, casos). Si el HISTORIAL',
  '   está vacío, devolvé [] — NO inventes líneas base.',
  '',
  'E) recomendaciones — hasta ' + TOPE_RECOMENDACIONES + ' acciones ligadas a incidentes de HOY, dirigidas a',
  '   EMPRESAS PRIVADAS (los clientes de ALTO), NUNCA al Estado o la fuerza pública.',
  '   MAL: "intensificar controles militares en el Caribe" (eso es de la Armada).',
  '   BIEN: "evaluar cierre preventivo 24-48 h en puntos de venta de Fundación ante el',
  '   paro armado anunciado; coordinar reapertura con la Policía local".',
  '   Cada una con sector (de la lista) y region.',
  '',
  'F) resumen_ejecutivo — 2-3 frases con el panorama del período, cerrando con la alerta',
  '   más accionable para clientes.',
  '',
  'Reglas: referenciá cada artículo SOLO por su id. NO inventes ids ni artículos. NO',
  'copies el titular ni la fuente (los completamos por id).',
  '',
  'Devolvé EXCLUSIVAMENTE este JSON, sin texto adicional y SIN fences de markdown:',
  '{',
  '  "resumen_ejecutivo": "<2-3 frases>",',
  '  "incidentes": [',
  '    { "id": <n>, "severidad": "critico|alto|medio|contexto", "sector": "<lista>",',
  '      "departamento": "<...>", "municipio": "<...>", "resumen": "<1-2 frases>",',
  '      "seguimiento": "<vacio o nota breve>" }',
  '  ],',
  '  "descartados": [ { "id": <n>, "motivo": "<breve>" } ],',
  '  "balance_regional": [ { "region": "<...>", "nivel": "Crítico|Alto|Medio|Monitoreo", "detalle": "<1 línea>" } ],',
  '  "tendencias": [ { "etiqueta": "<corta>", "direccion": "sube|baja|estable", "detalle": "<breve>" } ],',
  '  "recomendaciones": [ { "sector": "<lista>", "region": "<...>", "texto": "<accionable>" } ]',
  '}',
  'Ordená "incidentes" por severidad (critico → contexto) y dentro de cada nivel por',
  'gravedad. Si no hay nada para una lista, devolvela como [].'
].join('\n');

/** Mensaje de usuario: fecha + historial + lista numerada (sin urls). */
function construirPromptUsuario_(articulos, historial) {
  var hoy = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  var lineas = ['Fecha de la edición: ' + hoy, ''];

  lineas.push('HISTORIAL (ediciones anteriores, para tendencias y seguimiento):');
  if (!historial.length) {
    lineas.push('  (vacío — primeras ediciones; devolvé tendencias: [])');
  } else {
    historial.forEach(function (ed) {
      lineas.push('  Edición ' + ed.fecha + ':');
      (ed.incidentes || []).forEach(function (inc) {
        lineas.push('    - [' + inc.s + '] ' + inc.t + (inc.d ? (' (' + inc.d + ')') : ''));
      });
    });
  }
  lineas.push('');

  lineas.push('TITULARES:');
  for (var i = 0; i < articulos.length; i++) {
    var art = articulos[i];
    lineas.push('[' + (i + 1) + '] (' + art.fuente + ' · ' + art.etiqueta + ') ' + art.titular);
  }
  return lineas.join('\n');
}

// ---------- Llamada a la API --------------------------------------------

function llamarClaude_(apiKey, sistema, usuario) {
  var payload = {
    model: CLAUDE_MODELO,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: sistema,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: usuario }]
  };

  var resp;
  try {
    resp = UrlFetchApp.fetch(CLAUDE_ENDPOINT, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': CLAUDE_VERSION },
      payload: JSON.stringify(payload)
    });
  } catch (e) {
    Logger.log('✗ Falló el fetch a Anthropic: %s', e.message);
    return null;
  }

  var codigo = resp.getResponseCode();
  var cuerpo = resp.getContentText();
  if (codigo !== 200) { Logger.log('✗ Anthropic HTTP %s: %s', codigo, cuerpo.slice(0, 500)); return null; }

  var data;
  try { data = JSON.parse(cuerpo); }
  catch (e) { Logger.log('✗ Respuesta no es JSON: %s', e.message); return null; }

  if (!data.content || !data.content.length) {
    Logger.log('✗ Sin content. stop_reason: %s', data.stop_reason); return null;
  }
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') return data.content[i].text;
  }
  Logger.log('✗ Sin bloque de texto. stop_reason: %s', data.stop_reason);
  return null;
}

// ---------- Parseo y expansión ------------------------------------------

function parsearJsonDefensivo_(texto) {
  var t = String(texto).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  var ini = t.indexOf('{'), fin = t.lastIndexOf('}');
  if (ini === -1 || fin === -1 || fin < ini) return null;
  try { return JSON.parse(t.slice(ini, fin + 1)); }
  catch (e) { Logger.log('  (parse) %s', e.message); return null; }
}

/** Expande la selección (ids + clasificación) al contrato completo del boletín. */
function expandirAContrato_(seleccion, articulos) {
  var hoy = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');

  function base(id) {
    var idx = parseInt(id, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= articulos.length) return null;
    var f = articulos[idx];
    if (!f.url) return null;   // regla dura
    return { titular: f.titular, fuente: f.fuente, url: f.url, fecha: fechaIso_(f.fecha) || hoy };
  }

  // Incidentes: resolver ids, validar severidad/sector, ordenar y acotar.
  var porSeveridad = { critico: [], alto: [], medio: [], contexto: [] };
  (seleccion.incidentes || []).forEach(function (it) {
    var b = base(it.id);
    if (!b) return;
    var sev = String(it.severidad || '').toLowerCase();
    if (!(sev in porSeveridad)) sev = 'medio';
    b.severidad = sev;
    b.sector = sectorValido_(it.sector);
    b.departamento = limpiar_(it.departamento || '');
    b.municipio = limpiar_(it.municipio || '');
    b.resumen = limpiar_(it.resumen || '');
    b.seguimiento = limpiar_(it.seguimiento || '');
    porSeveridad[sev].push(b);
  });
  var incidentes = porSeveridad.critico
    .concat(porSeveridad.alto)
    .concat(porSeveridad.medio.slice(0, TOPE_MEDIO))
    .concat(porSeveridad.contexto.slice(0, TOPE_CONTEXTO));

  // Descartados (solo titular + motivo; sin link, son ejemplos del filtro).
  var descartados = (seleccion.descartados || []).map(function (it) {
    var b = base(it.id);
    if (!b) return null;
    return { titular: b.titular, motivo: limpiar_(it.motivo || '') };
  }).filter(Boolean).slice(0, TOPE_DESCARTADOS);

  var balance = (seleccion.balance_regional || []).map(function (r) {
    return { region: limpiar_(r.region || ''), nivel: nivelValido_(r.nivel),
             detalle: limpiar_(r.detalle || '') };
  }).filter(function (r) { return r.region; }).slice(0, TOPE_BALANCE);

  var tendencias = (seleccion.tendencias || []).map(function (t) {
    var dir = String(t.direccion || '').toLowerCase();
    if (dir !== 'sube' && dir !== 'baja' && dir !== 'estable') dir = 'estable';
    return { etiqueta: limpiar_(t.etiqueta || ''), direccion: dir,
             detalle: limpiar_(t.detalle || '') };
  }).filter(function (t) { return t.etiqueta; }).slice(0, TOPE_TENDENCIAS);

  var recomendaciones = (seleccion.recomendaciones || []).map(function (r) {
    return { sector: sectorValido_(r.sector), region: limpiar_(r.region || ''),
             texto: limpiar_(r.texto || '') };
  }).filter(function (r) { return r.texto; }).slice(0, TOPE_RECOMENDACIONES);

  return {
    fecha: hoy,
    numero: diaDelAnio_(hoy),
    resumen_ejecutivo: limpiar_(seleccion.resumen_ejecutivo || ''),
    incidentes: incidentes,
    descartados: descartados,
    balance_regional: balance,
    tendencias: tendencias,
    recomendaciones: recomendaciones
  };
}

// ---------- Utilidades ---------------------------------------------------

/** Canoniza el sector contra la lista SECTORES (match laxo); default "General". */
function sectorValido_(s) {
  var n = normalizarTexto_(s);
  if (!n) return 'General';
  for (var i = 0; i < SECTORES.length; i++) {
    var sec = normalizarTexto_(SECTORES[i]);
    if (sec === n || sec.indexOf(n) === 0 || n.indexOf(sec.split(' ')[0]) !== -1) return SECTORES[i];
  }
  return 'General';
}

function nivelValido_(n) {
  var s = normalizarTexto_(n);
  if (s.indexOf('critic') !== -1) return 'Crítico';
  if (s.indexOf('alto') !== -1) return 'Alto';
  if (s.indexOf('medio') !== -1) return 'Medio';
  return 'Monitoreo';
}

/** Número de boletín = día del año (mismo esquema que usa ARES). */
function diaDelAnio_(iso) {
  var p = String(iso).split('-');
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  var inicio = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - inicio) / 86400000);
}

function fechaIso_(texto) {
  if (!texto) return '';
  var d = new Date(texto);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'America/Bogota', 'yyyy-MM-dd');
}

// limpiar_() y normalizarTexto_() se definen en Fuentes.gs (scope global compartido).
