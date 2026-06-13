/**
 * Codigo.gs — Boletín de Seguridad ALTO · Colombia
 * Orquestador del boletín diario y gestión del trigger temporal.
 *
 * boletinDiario() es la función que dispara el trigger cada mañana:
 *   Fuentes → Claude (1 llamada) → Render (Tablero) → GitHub Pages → Correo.
 *
 * Proyecto HERMANO del Barrido de Prensa de Chile (mismo patrón de pipeline),
 * pero independiente: otro Apps Script, otro repo de Pages, otros secrets.
 *
 * Puesta en marcha (una vez): ejecutar instalarTriggerDiario().
 * Verificación: ejecutar boletinDiario() a mano (debe actualizar Pages y llegar
 * el correo) y revisar que el trigger quede listado (ícono de reloj).
 */

/**
 * Punto de entrada del trigger: arma y publica el boletín del día y manda el correo.
 * Diseñado para fallar de forma segura: si Claude o la publicación fallan, NO se
 * envía el correo (que enlaza a Pages), y se avisa por mail del fallo.
 */
function boletinDiario() {
  var inicio = new Date();
  Logger.log('=== Boletín de Seguridad Colombia · %s ===',
             Utilities.formatDate(inicio, 'America/Bogota', 'yyyy-MM-dd HH:mm'));

  try {
    var articulos = recolectarTitulares();                 // Detección
    if (!articulos.length) throw new Error('No se recolectaron titulares.');
    Logger.log('Titulares recolectados: %s', articulos.length);

    articulos = filtrarNoVistos_(articulos);               // No repetir lo ya publicado

    var edicion = generarBoletin(articulos);               // Clasificación (Claude)
    if (!edicion) throw new Error('No se pudo generar el boletín (Claude).');

    var html = renderBoletin(edicion);                     // Tablero (Variante B)
    var res = publicarEdicion(edicion, html);              // GitHub Pages
    if (!res) throw new Error('No se pudo publicar en GitHub Pages.');
    Logger.log('Publicado: %s', res.edicion);

    if (!enviarCorreo(edicion)) throw new Error('No se pudo enviar el correo.');

    registrarPublicados_(edicion);   // memoria de URLs ya reportadas
    registrarHistorial_(edicion);    // historial p/ tendencias y seguimiento

    var seg = Math.round((new Date() - inicio) / 1000);
    Logger.log('✓ Boletín completado en %s s.', seg);
  } catch (e) {
    Logger.log('✗ Boletín falló: %s', e.message);
    alertarFallo_(e.message);
  }
}

/** Avisa por correo si el boletín falla (best-effort). */
function alertarFallo_(motivo) {
  var destino = PropertiesService.getScriptProperties().getProperty('CORREO_DESTINO');
  if (!destino) return;
  try {
    MailApp.sendEmail({
      to: destino,
      subject: 'ALTO · Boletín de Seguridad Colombia — FALLÓ la edición de hoy',
      body: 'El boletín diario no pudo completarse.\n\nMotivo: ' + motivo +
            '\n\nRevisá el registro de ejecución en Apps Script.',
      name: 'ALTO · Boletín de Seguridad Colombia'
    });
  } catch (e) {
    Logger.log('  (no se pudo enviar el aviso de fallo: %s)', e.message);
  }
}

// ---------- Trigger temporal --------------------------------------------

/**
 * Instala (o reinstala) el trigger diario entre las 6 y 7 am de Bogotá.
 * (El boletín de ARES llega ~8:40; el nuestro debe estar antes en la bandeja.)
 * Ejecutar UNA vez a mano. Idempotente: borra triggers previos del boletín.
 */
function instalarTriggerDiario() {
  borrarTriggersBoletin_();
  ScriptApp.newTrigger('boletinDiario')
    .timeBased()
    .everyDays(1)
    .atHour(6)                       // ventana 6:00–6:59
    .inTimezone('America/Bogota')
    .create();
  Logger.log('✓ Trigger diario instalado: boletinDiario, 6–7 am America/Bogota.');
}

/** Quita el trigger diario (por si querés pausar el sistema). */
function desinstalarTriggerDiario() {
  var n = borrarTriggersBoletin_();
  Logger.log('✓ Triggers del boletín eliminados: %s.', n);
}

/** Borra todos los triggers que apunten a boletinDiario. Devuelve cuántos. */
function borrarTriggersBoletin_() {
  var triggers = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'boletinDiario') {
      ScriptApp.deleteTrigger(triggers[i]);
      n++;
    }
  }
  return n;
}
