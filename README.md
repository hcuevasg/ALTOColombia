# ALTO · Boletín de Seguridad Colombia

Boletín diario automatizado de seguridad nacional para Colombia, con identidad ALTO.
Reemplaza al boletín de la agencia externa ARES con un **Tablero de Inteligencia**:
balance regional con semáforo, tendencias 48 h, incidentes priorizados por severidad
y filtrables, fuentes citadas con link, filtro de relevancia (descartados visibles) y
recomendaciones por sector dirigidas al cliente privado.

Proyecto **hermano e independiente** del Barrido de Prensa de Chile
([`hcuevasg/ALTONoticias`](https://github.com/hcuevasg/ALTONoticias)): mismo patrón
de pipeline, otro Apps Script, otro repo, otros secrets. **Nada de este proyecto toca
el sistema de Chile.**

## Pipeline

```
Trigger diario (6–7 am Bogotá, antes de que llegue el ARES de ~8:40)
  └─ boletinDiario()                       Codigo.gs
       ├─ recolectarTitulares()            Fuentes.gs   — Google News RSS (CO), 9 temas de seguridad
       ├─ filtrarNoVistos_()               Memoria.gs   — no repetir lo ya publicado
       ├─ generarBoletin()                 Claude.gs    — 1 llamada: severidad + sector + región
       │                                                  + balance + tendencias (vs. historial)
       │                                                  + descartados + recomendaciones
       ├─ renderBoletin() / renderCorreo() Render.gs    — tablero Pages + digest correo
       ├─ publicarEdicion()                GitHub.gs    — docs/index.html + ediciones/FECHA.html + indice.json
       ├─ enviarCorreo()                   Correo.gs
       └─ registrarPublicados_() + registrarHistorial_()  Memoria.gs
```

Anti-alucinación por **id-indirection**: el modelo recibe titulares numerados sin URL,
referencia por id, y el código resuelve titular/fuente/URL/fecha reales. El modelo no
puede inventar notas.

## Puesta en marcha (una vez)

### 1. Repo de GitHub + Pages
1. Crear el repo `hcuevasg/ALTOColombia` (privado o público) y subir este contenido:
   ```bash
   git remote add origin https://github.com/hcuevasg/ALTOColombia.git
   git push -u origin main
   ```
2. En GitHub → Settings → Pages → Source: branch `main`, carpeta `/docs`.
3. Verificar que `https://hcuevasg.github.io/ALTOColombia/` muestre la portada
   "Primera edición pendiente".

### 2. Proyecto de Apps Script
> ⚠ `grupoalto.com` bloquea la Apps Script API: **no usar clasp**. Los archivos se
> pegan a mano en el editor web (igual que en Chile).

1. Crear un proyecto nuevo en [script.new](https://script.new), nombre
   "ALTO Boletín Colombia".
2. Pegar cada archivo de `apps-script/` en el editor (mismo nombre, sin la extensión
   `.gs`). `plantilla-tablero.html` se crea como **archivo HTML** (＋ → HTML).
3. En Configuración del proyecto → mostrar `appsscript.json` → reemplazarlo por el de
   este repo (zona horaria `America/Bogota` y scopes).

### 3. Secrets (Configuración → Propiedades del script)
| Propiedad | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | clave de Anthropic (puede ser la misma de Chile) |
| `GITHUB_PAT` | token con permiso de contenidos sobre el repo nuevo. Si el PAT de Chile es *fine-grained*, hay que agregarle este repo; si es clásico con scope `repo`, sirve tal cual |
| `GITHUB_REPO` | `hcuevasg/ALTOColombia` |
| `CORREO_DESTINO` | destinatarios, separados por coma |
| `SHEET_ID` | *(opcional)* Sheet para ampliar temas/fuentes — ver abajo |

### 4. Verificación por etapas (en orden)
| Función | Qué valida |
|---|---|
| `test()` | fuentes: lista lo capturado por tema — **compararlo a ojo contra el PDF de ARES del mismo día** |
| `testClaude()` | clasificación: severidades, sectores, balance, tendencias, recomendaciones |
| `testRender()` | tablero y correo sin placeholders |
| `testPublicar()` | publica de verdad en Pages |
| `testCorreo()` | envía el digest |
| `instalarTriggerDiario()` | deja el trigger 6–7 am Bogotá |

## Sheet opcional

Sin Sheet, el sistema usa los 9 temas embebidos en `Fuentes.gs` (`TEMAS_POR_DEFECTO`).
Para ajustar sin tocar código, crear un Sheet con estas pestañas y setear `SHEET_ID`:

| Pestaña | Columnas | Efecto |
|---|---|---|
| `TemasSeguridad` | A=tema, B=términos (coma-separados) | **reemplaza** los temas por defecto |
| `FuentesGenerales` | A=etiqueta, B=url RSS | se **agrega** a los temas |

## Benchmark contra ARES

Mientras Colombia siga recibiendo el PDF de ARES, cada boletín de ellos es *ground
truth* gratis. Rutina sugerida durante 1–2 semanas:

1. Correr `test()` (o esperar la edición del día).
2. Marcar qué incidentes del ARES aparecen en nuestro tablero (recall) y cuáles
   capturamos nosotros que ellos no.
3. Con el % de cobertura en mano, decidir el reemplazo de la suscripción.

## Hoja de ruta (fase 2)

- **Mapa georreferenciado**: el clasificador ya extrae municipio/departamento; falta
  generar el mapa (Google My Maps o Leaflet estático en Pages).
- **Pestaña `Clientes` Colombia**: monitoreo de clientes con roster + validación,
  portando las 3 capas de precisión probadas en Chile.
- **Oportunidades comerciales**: volcado a Sheet como en Chile.

## Decisiones de diseño

- El layout es la **variante B "Tablero de Inteligencia"** del sketch
  `NoticiasALTO/.planning/sketches/001-boletin-seguridad-colombia/`.
- Numeración del boletín = día del año (mismo esquema que usa ARES: 12 jun = 163).
- El correo es un digest topado (~8 incidentes, críticos y altos primero); el tablero
  completo con filtros vive en Pages.
- Las tendencias usan el historial de las últimas 3 ediciones (Script Properties);
  los primeros días salen vacías ("sin línea base").
- CSS embebido en la plantilla: cada edición publicada es autocontenida (solo
  depende del logo en `docs/assets/`).
