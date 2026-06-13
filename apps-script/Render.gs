/**
 * Render.gs — JSON → dos HTML con identidad ALTO (Editorial Bold).
 * Estructura del Tablero de Inteligencia (variante B del sketch 001):
 *   Banda → Balance regional + Tendencias 48 h → Incidentes filtrables por
 *   severidad → Descartados por filtro de relevancia (toggle) → Recomendaciones
 *   por sector → Pie.
 *
 * 1) renderBoletin(edicion) — página completa para Pages (plantilla-tablero).
 * 2) renderCorreo(edicion)  — digest topado con estilos inline (Outlook-safe).
 */

// --- Presupuesto del correo (control determinista del <5 min) -------------
var TOPE_CORREO_INCIDENTES = 8;    // críticos + altos primero; medios si queda cupo

var C_RED = '#E84244', C_BLUE = '#4174B9', C_GREY = '#B0B6B8';
var C_INK = '#15181D', C_INK2 = '#4A4F57', C_INK3 = '#7C828B', C_LINE = '#E1DDD4';
var F_DISP = "Archivo,'Helvetica Neue',Arial,sans-serif";
var F_MONO = "'IBM Plex Sans',Arial,sans-serif";
var F_BODY = "'IBM Plex Sans',Arial,sans-serif";

// Severidad → presentación (etiqueta visible, clase CSS de Pages, colores correo).
var SEV_META = {
  critico:  { etiqueta: 'Crítico',  clase: 'sev--critico', bg: C_RED,     fg: '#ffffff', borde: C_RED },
  alto:     { etiqueta: 'Alto',     clase: 'sev--alto',    bg: '#FBE0E0', fg: '#C92F31', borde: '#E89B44' },
  medio:    { etiqueta: 'Medio',    clase: 'sev--medio',   bg: '#F5ECD6', fg: '#9A7A16', borde: C_BLUE },
  contexto: { etiqueta: 'Contexto', clase: 'sev--info',    bg: '#E6EEF7', fg: C_BLUE,    borde: C_GREY }
};
var NIVEL_META = {
  'Crítico':   { clase: 'sev--critico', bg: C_RED,     fg: '#ffffff' },
  'Alto':      { clase: 'sev--alto',    bg: '#FBE0E0', fg: '#C92F31' },
  'Medio':     { clase: 'sev--medio',   bg: '#F5ECD6', fg: '#9A7A16' },
  'Monitoreo': { clase: 'sev--info',    bg: '#E6EEF7', fg: C_BLUE }
};
var DIR_META = {
  sube:    { simbolo: '▲', clase: 't-up',   color: C_RED },
  baja:    { simbolo: '▼', clase: 't-down', color: C_BLUE },
  estable: { simbolo: '▶', clase: 't-flat', color: C_INK3 }
};

// ======================================================================
//  TABLERO COMPLETO (Pages)
// ======================================================================

function renderBoletin(edicion) {
  var base = basePages_();
  var html = HtmlService.createTemplateFromFile('plantilla-tablero').getRawContent();
  html = reemplazar_(html, '{{BASE}}', base);
  html = reemplazar_(html, '{{FECHA}}', escaparHtml_(edicion.fecha));
  html = reemplazar_(html, '{{FECHA_LARGA}}', escaparHtml_(fechaLarga_(edicion.fecha)));
  html = reemplazar_(html, '{{NUMERO}}', escaparHtml_(String(edicion.numero)));
  html = reemplazar_(html, '{{BALANCE}}', renderBalance_(edicion.balance_regional));
  html = reemplazar_(html, '{{TENDENCIAS}}', renderTendencias_(edicion.tendencias));
  html = reemplazar_(html, '{{FILTROS}}', renderFiltros_(edicion.incidentes));
  html = reemplazar_(html, '{{INCIDENTES}}', renderIncidentes_(edicion.incidentes));
  html = reemplazar_(html, '{{DESCARTADOS}}', renderDescartados_(edicion.descartados));
  html = reemplazar_(html, '{{RECOMENDACIONES}}', renderRecomendaciones_(edicion.recomendaciones));
  return html;
}

function renderBalance_(balance) {
  if (!balance || !balance.length) {
    return '<p class="vacio">Sin balance regional para este período.</p>';
  }
  return balance.map(function (r) {
    var m = NIVEL_META[r.nivel] || NIVEL_META['Monitoreo'];
    return '<div class="region">' +
      '<span class="sev ' + m.clase + '">' + escaparHtml_(r.nivel) + '</span>' +
      '<span class="nom">' + escaparHtml_(r.region) + '</span>' +
      '<span class="det">' + escaparHtml_(r.detalle) + '</span>' +
    '</div>';
  }).join('\n');
}

function renderTendencias_(tendencias) {
  if (!tendencias || !tendencias.length) {
    return '<p class="vacio">Sin línea base aún — las tendencias aparecen tras las primeras ediciones.</p>';
  }
  return tendencias.map(function (t) {
    var m = DIR_META[t.direccion] || DIR_META.estable;
    return '<div class="trend"><b class="' + m.clase + '">' + m.simbolo + ' ' +
      escaparHtml_(t.etiqueta) + '</b><span>' + escaparHtml_(t.detalle) + '</span></div>';
  }).join('\n');
}

function renderFiltros_(incidentes) {
  var conteo = { critico: 0, alto: 0, medio: 0, contexto: 0 };
  (incidentes || []).forEach(function (i) { conteo[i.severidad] = (conteo[i.severidad] || 0) + 1; });
  var total = (incidentes || []).length;

  var botones = ['<button class="fbtn active" data-sev="todos" onclick="filtrar(this)">Todos · ' + total + '</button>'];
  Object.keys(SEV_META).forEach(function (sev) {
    if (!conteo[sev]) return;
    botones.push('<button class="fbtn" data-sev="' + sev + '" onclick="filtrar(this)">' +
                 SEV_META[sev].etiqueta + ' · ' + conteo[sev] + '</button>');
  });
  return botones.join('\n');
}

function renderIncidentes_(incidentes) {
  if (!incidentes || !incidentes.length) {
    return '<p class="vacio">Sin incidentes relevantes en las últimas 48 h.</p>';
  }
  return incidentes.map(function (inc) {
    var m = SEV_META[inc.severidad] || SEV_META.medio;
    var loc = [inc.municipio, inc.departamento].filter(Boolean).map(escaparHtml_).join(', ');
    var meta = ['<a class="fuente" href="' + escaparHtml_(inc.url) + '">' + escaparHtml_(inc.fuente) + '</a>'];
    var locParts = [];
    if (inc.fecha) locParts.push(escaparHtml_(inc.fecha));
    if (loc) locParts.push(loc);
    if (inc.seguimiento) locParts.push(escaparHtml_(inc.seguimiento));
    if (locParts.length) meta.push('<span class="loc">' + locParts.join(' · ') + '</span>');

    return '<div class="inc inc--' + inc.severidad + '" data-sev="' + inc.severidad + '">' +
      '<div class="inc__cab">' +
        '<span class="sev ' + m.clase + '">' + m.etiqueta + '</span>' +
        '<span class="tagsec">' + escaparHtml_(inc.sector) + '</span>' +
      '</div>' +
      '<div class="inc__titular"><a href="' + escaparHtml_(inc.url) + '">' + escaparHtml_(inc.titular) + '</a></div>' +
      (inc.resumen ? '<p class="inc__resumen">' + escaparHtml_(inc.resumen) + '</p>' : '') +
      '<div class="inc__meta">' + meta.join('') + '</div>' +
    '</div>';
  }).join('\n');
}

function renderDescartados_(descartados) {
  if (!descartados || !descartados.length) return '';
  var items = descartados.map(function (d) {
    return '<div class="inc inc--off">' +
      '<div class="inc__cab"><span class="sev sev--off">Descartado</span></div>' +
      '<div class="inc__titular">' + escaparHtml_(d.titular) + '</div>' +
      '<div class="inc__meta"><span class="loc">' + escaparHtml_(d.motivo) + '</span></div>' +
    '</div>';
  }).join('\n');
  return '<button class="descartados-toggle" id="desc-btn" onclick="toggleDescartados()">▸ ' +
         descartados.length + ' hechos descartados por filtro de relevancia — ver</button>' +
         '<div id="descartados">' + items + '</div>';
}

function renderRecomendaciones_(recos) {
  if (!recos || !recos.length) {
    return '<p class="vacio">Sin recomendaciones específicas para este período.</p>';
  }
  return recos.map(function (r) {
    var cab = escaparHtml_(r.sector) + (r.region ? ' · ' + escaparHtml_(r.region) : '');
    return '<div class="reco"><b>' + cab + '</b>' + escaparHtml_(r.texto) + '</div>';
  }).join('\n');
}

// ======================================================================
//  CORREO (digest topado, estilos inline)
// ======================================================================

function renderCorreo(edicion) {
  var palabras = contarPalabras_(edicion.resumen_ejecutivo);

  // Incidentes del correo: críticos y altos primero; medios si queda cupo.
  var prioridad = (edicion.incidentes || []).filter(function (i) {
    return i.severidad === 'critico' || i.severidad === 'alto';
  });
  var resto = (edicion.incidentes || []).filter(function (i) {
    return i.severidad !== 'critico' && i.severidad !== 'alto';
  });
  var incidentesCorreo = prioridad.concat(resto).slice(0, TOPE_CORREO_INCIDENTES);

  incidentesCorreo.forEach(function (i) {
    palabras += contarPalabras_(i.titular) + contarPalabras_(i.resumen);
  });
  (edicion.recomendaciones || []).forEach(function (r) { palabras += contarPalabras_(r.texto); });
  (edicion.tendencias || []).forEach(function (t) { palabras += contarPalabras_(t.detalle); });
  (edicion.balance_regional || []).forEach(function (r) { palabras += contarPalabras_(r.detalle); });

  var minutos = Math.max(1, Math.round(palabras / 200));
  var edicionUrl = basePages_() + '/ediciones/' + encodeURIComponent(edicion.fecha) + '.html';
  return { html: construirHtmlCorreo_(edicion, incidentesCorreo, minutos, edicionUrl),
           minutos: minutos, palabras: palabras };
}

function construirHtmlCorreo_(edicion, incidentes, minutos, edicionUrl) {
  var cuerpo = [];

  // Resumen ejecutivo.
  if (edicion.resumen_ejecutivo) {
    cuerpo.push(
      '<div style="background:#F4F1EB;padding:15px 17px;margin-bottom:6px;">' +
        '<div style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:' + C_RED + ';font-weight:bold;margin-bottom:7px;">Resumen ejecutivo</div>' +
        '<div style="font-family:' + F_BODY + ';font-size:14px;line-height:1.5;color:' + C_INK + ';">' + escaparHtml_(edicion.resumen_ejecutivo) + '</div>' +
      '</div>'
    );
  }

  // Balance regional (chips).
  if ((edicion.balance_regional || []).length) {
    cuerpo.push(seclblCorreo_('Balance regional'));
    var filas = edicion.balance_regional.map(function (r) {
      var m = NIVEL_META[r.nivel] || NIVEL_META['Monitoreo'];
      return '<div style="margin-bottom:8px;">' +
        '<span style="display:inline-block;background:' + m.bg + ';color:' + m.fg + ';font-family:' + F_MONO + ';font-size:9.5px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;">' + escaparHtml_(r.nivel) + '</span> ' +
        '<b style="font-family:' + F_DISP + ';font-size:13.5px;">' + escaparHtml_(r.region) + '</b> ' +
        '<span style="font-family:' + F_BODY + ';font-size:12.5px;color:' + C_INK2 + ';">· ' + escaparHtml_(r.detalle) + '</span>' +
      '</div>';
    });
    cuerpo.push(filas.join('\n'));
  }

  // Tendencias.
  if ((edicion.tendencias || []).length) {
    cuerpo.push(seclblCorreo_('Tendencias · 48 h'));
    var ts = edicion.tendencias.map(function (t) {
      var m = DIR_META[t.direccion] || DIR_META.estable;
      return '<div style="margin-bottom:6px;font-family:' + F_BODY + ';font-size:13px;line-height:1.4;">' +
        '<b style="color:' + m.color + ';font-family:' + F_MONO + ';font-size:11px;text-transform:uppercase;letter-spacing:.06em;">' + m.simbolo + ' ' + escaparHtml_(t.etiqueta) + '</b> ' +
        '<span style="color:' + C_INK2 + ';">— ' + escaparHtml_(t.detalle) + '</span>' +
      '</div>';
    });
    cuerpo.push(ts.join('\n'));
  }

  // Incidentes priorizados.
  cuerpo.push(seclblCorreo_('Incidentes · ordenados por severidad'));
  incidentes.forEach(function (inc) {
    var m = SEV_META[inc.severidad] || SEV_META.medio;
    var loc = [inc.municipio, inc.departamento].filter(Boolean).join(', ');
    var pie = [escaparHtml_(inc.fuente)];
    if (loc) pie.push(escaparHtml_(loc));
    if (inc.seguimiento) pie.push(escaparHtml_(inc.seguimiento));
    cuerpo.push(
      '<div style="border-left:3px solid ' + m.borde + ';padding-left:13px;margin-bottom:16px;">' +
        '<div>' +
          '<span style="display:inline-block;background:' + m.bg + ';color:' + m.fg + ';font-family:' + F_MONO + ';font-size:9.5px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;">' + m.etiqueta + '</span> ' +
          '<span style="display:inline-block;border:1px solid ' + C_LINE + ';color:' + C_INK2 + ';font-family:' + F_MONO + ';font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;">' + escaparHtml_(inc.sector) + '</span>' +
        '</div>' +
        '<a href="' + escaparHtml_(inc.url) + '" style="color:' + C_INK + ';text-decoration:none;">' +
          '<div style="font-family:' + F_DISP + ';font-size:16px;font-weight:700;line-height:1.22;margin-top:5px;">' + escaparHtml_(inc.titular) + '</div>' +
        '</a>' +
        (inc.resumen ? '<div style="font-family:' + F_BODY + ';font-size:13px;color:' + C_INK2 + ';margin-top:4px;line-height:1.42;">' + escaparHtml_(inc.resumen) + '</div>' : '') +
        '<div style="font-family:' + F_MONO + ';font-size:10px;color:' + C_BLUE + ';margin-top:6px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">' + pie.join(' <span style="color:' + C_INK3 + ';">·</span> ') + '</div>' +
      '</div>'
    );
  });
  var omitidos = (edicion.incidentes || []).length - incidentes.length;
  if (omitidos > 0) {
    cuerpo.push('<div style="font-family:' + F_BODY + ';font-size:12.5px;color:' + C_INK3 + ';font-style:italic;margin-bottom:6px;">+ ' + omitidos + ' incidentes más en el tablero completo.</div>');
  }

  // Recomendaciones para clientes.
  if ((edicion.recomendaciones || []).length) {
    cuerpo.push(seclblCorreo_('Recomendaciones para clientes'));
    edicion.recomendaciones.forEach(function (r) {
      var cab = escaparHtml_(r.sector) + (r.region ? ' · ' + escaparHtml_(r.region) : '');
      cuerpo.push(
        '<div style="background:#EEF3FB;border-left:2px solid ' + C_BLUE + ';padding:10px 13px;margin-bottom:10px;font-family:' + F_BODY + ';font-size:13px;color:' + C_INK + ';line-height:1.45;">' +
          '<b style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:' + C_BLUE + ';display:block;margin-bottom:3px;">' + cab + '</b>' +
          escaparHtml_(r.texto) +
        '</div>'
      );
    });
  }

  var base = basePages_();
  return [
    '<div style="background:#E7E3DB;padding:26px 0;margin:0;">',
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">',
    '<table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;background:#ffffff;">',
    '<tr><td style="background:' + C_INK + ';padding:22px 30px;">',
    '  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>',
    '    <td align="left" style="vertical-align:middle;"><span style="background:#fff;border-radius:4px;padding:9px 13px;display:inline-block;"><img src="' + base + '/assets/alto-logo.png" alt="ALTO" height="24" style="height:24px;width:auto;display:block;"></span></td>',
    '    <td align="right" style="vertical-align:middle;font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;line-height:1.7;">Boletín de Seguridad · Colombia<br><b style="font-weight:600;">Boletín ' + escaparHtml_(String(edicion.numero)) + ' · ' + escaparHtml_(edicion.fecha) + '</b><br>⏱ Lectura ~' + minutos + ' min</td>',
    '  </tr></table>',
    '</td></tr>',
    '<tr><td style="padding:28px 30px 8px;">',
    cuerpo.join('\n'),
    '</td></tr>',
    '<tr><td style="padding:14px 30px 30px;">',
    '  <a href="' + escaparHtml_(edicionUrl) + '" style="display:inline-block;background:' + C_RED + ';color:#ffffff;font-family:' + F_MONO + ';font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;padding:13px 22px;">Ver tablero completo y archivo →</a>',
    '</td></tr>',
    '<tr><td style="background:' + C_INK + ';padding:16px 30px;">',
    '  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>',
    '    <td align="left" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;"><b style="color:' + C_RED + ';">ALTO</b> · Boletín de Seguridad Colombia</td>',
    '    <td align="right" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:' + C_GREY + ';">Uso interno</td>',
    '  </tr></table>',
    '</td></tr>',
    '</table></td></tr></table></div>'
  ].join('\n');
}

function seclblCorreo_(texto) {
  return '<div style="font-family:' + F_MONO + ';font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + C_RED +
    ';font-weight:bold;margin:26px 0 14px;border-top:1.5px solid ' + C_INK + ';padding-top:13px;">' +
    '<span style="display:inline-block;width:16px;height:2px;background:' + C_RED + ';vertical-align:middle;margin-right:8px;"></span>' +
    escaparHtml_(texto) + '</div>';
}

// ======================================================================
//  Verificación
// ======================================================================

function testRender() {
  Logger.log('=== Prueba de render ===');
  var articulos = recolectarTitulares();
  var edicion = generarBoletin(articulos);
  if (!edicion) { Logger.log('✗ Sin boletín.'); return; }

  var htmlBoletin = renderBoletin(edicion);
  Logger.log('— Tablero: %s caracteres', htmlBoletin.length);
  afirmar_('banda presente', htmlBoletin.indexOf('class="band"') !== -1);
  afirmar_('balance regional presente', htmlBoletin.indexOf('Balance regional') !== -1);
  afirmar_('filtros presentes', htmlBoletin.indexOf('class="fbtn') !== -1);
  afirmar_('recomendaciones presentes', htmlBoletin.indexOf('Recomendaciones') !== -1);
  afirmar_('sin placeholders', htmlBoletin.indexOf('{{') === -1);

  var correo = renderCorreo(edicion);
  Logger.log('— Correo: %s caracteres · %s palabras · ⏱ ~%s min', correo.html.length, correo.palabras, correo.minutos);
  Logger.log('----- INICIO HTML CORREO -----');
  Logger.log(correo.html);
  Logger.log('----- FIN HTML CORREO -----');
}
function afirmar_(nombre, cond) { Logger.log('   %s %s', cond ? '✓' : '✗', nombre); }

// ======================================================================
//  Utilidades de render
// ======================================================================

function reemplazar_(str, token, valor) { return str.split(token).join(valor); }

function escaparHtml_(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function contarPalabras_(texto) {
  var t = String(texto || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function fechaLarga_(iso) {
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  return DIAS_ES[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES_ES[d.getMonth()] + ' de ' + d.getFullYear();
}
