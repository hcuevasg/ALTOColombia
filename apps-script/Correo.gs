/**
 * Correo.gs — Envío del digest diario con MailApp. El cuerpo es el correo TOPADO
 * de Render.gs (renderCorreo): resumen ejecutivo, balance regional, tendencias,
 * incidentes priorizados y recomendaciones, con sello de tiempo de lectura y
 * botón al tablero completo. HTML con estilos inline (compatibilidad Outlook).
 *
 * Secret en Propiedades del Script: CORREO_DESTINO (uno o varios, separados por coma).
 *
 * Verificación: ejecutar testCorreo(). Debe llegar el correo con el digest y el link.
 */

/**
 * Envía el digest de un boletín a CORREO_DESTINO.
 * @param {Object} edicion  objeto del contrato.
 * @return {boolean} true si se envió.
 */
function enviarCorreo(edicion) {
  var destino = PropertiesService.getScriptProperties().getProperty('CORREO_DESTINO');
  if (!destino) {
    Logger.log('✗ Falta CORREO_DESTINO en Propiedades del Script.');
    return false;
  }

  var correo = renderCorreo(edicion);   // {html, minutos, palabras}
  var asunto = 'ALTO · Boletín de Seguridad Colombia — ' + fechaLarga_(edicion.fecha) +
               '  (⏱ ~' + correo.minutos + ' min)';

  try {
    MailApp.sendEmail({
      to: destino,
      subject: asunto,
      htmlBody: correo.html,
      body: cuerpoTextoPlano_(edicion),   // fallback para clientes sin HTML
      name: 'ALTO · Boletín de Seguridad Colombia'
    });
  } catch (e) {
    Logger.log('✗ Falló el envío: %s', e.message);
    return false;
  }

  Logger.log('✓ Correo enviado a %s (⏱ ~%s min, %s palabras).',
             destino, correo.minutos, correo.palabras);
  return true;
}

/** Fallback de texto plano (clientes que no renderizan HTML). */
function cuerpoTextoPlano_(edicion) {
  var url = basePages_() + '/ediciones/' + edicion.fecha + '.html';
  return [
    'ALTO · Boletín de Seguridad Colombia — ' + fechaLarga_(edicion.fecha),
    'Boletín ' + edicion.numero,
    '',
    edicion.resumen_ejecutivo,
    '',
    'Ver el tablero completo y el archivo:',
    url
  ].join('\n');
}

/**
 * Corre el pipeline completo y envía el correo.
 */
function testCorreo() {
  Logger.log('=== Prueba de correo ===');

  var articulos = recolectarTitulares();
  var edicion = generarBoletin(articulos);
  if (!edicion) { Logger.log('✗ Sin boletín; revisá fuentes y Claude.'); return; }

  var ok = enviarCorreo(edicion);
  if (ok) Logger.log('Revisá tu bandeja de entrada.');
}
