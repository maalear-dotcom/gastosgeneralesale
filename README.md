# 🧾 Gastos Generales

App de gastos del hogar: dashboard con categorías, límites y alertas, más
**recepción y clasificación automática de comprobantes desde el celular**.

```
                          ┌──────────────────────────────┐
  Tu celular (Telegram)──▶│  Servidor Node (server.js)    │
   texto · foto · PDF     │   clasifica con el motor de   │
                          │   la propia app y guarda      │
                          └───────────────┬──────────────┘
                                          │  /api/estado
                                          ▼
                          ┌──────────────────────────────┐
                          │  Dashboard (index.html)       │
                          │  mismos datos que el celular  │
                          └──────────────────────────────┘
```

Lo importante: **la clasificadora es una sola**. `server.js` ejecuta el motor
de `index.html` (`motor.js` lo carga tal cual, en un entorno controlado), así
que el celular y la pantalla ven exactamente las mismas reglas, categorías y
límites.

> 📲 **¿Querés sólo conectar el celular?** Andá directo a
> **[CONECTAR-TELEGRAM.md](CONECTAR-TELEGRAM.md)**: la guía paso a paso, desde
> crear el bot hasta mandar el primer comprobante, con qué escribir y qué
> respuesta esperar en cada momento.

---

## 1. Usarla solo en el navegador (como siempre)

Abrí `index.html` con doble clic. Todo funciona igual que antes: los datos se
guardan en el navegador (`localStorage`) y no hace falta instalar nada.

Para agregar el canal del celular hay que levantar el servidor:

```bash
npm install
npm start          # http://localhost:3000
```

## 2. Crear el bot de Telegram

La guía completa, con capturas de qué escribir y qué esperar, está en
**[CONECTAR-TELEGRAM.md](CONECTAR-TELEGRAM.md)**. En resumen:

1. En Telegram, buscá **@BotFather** y mandá `/newbot`.
2. Poné un nombre (ej. *Gastos Generales*) y un usuario (ej. `misgastos_ar_bot`).
3. BotFather te devuelve un **token**. Guardalo: es `TELEGRAM_BOT_TOKEN`.

En tu celular, buscá ese bot y mandale `/start` (por ahora no va a contestar:
todavía no hay servidor).

## 3. Publicar el servidor en Render (gratis)

1. Subí esta carpeta a un repositorio de GitHub.
2. En [render.com](https://render.com): **New → Web Service** → elegí el
   repositorio. Render lee el `render.yaml` y crea el servicio solo.
3. En **Environment**, completá tres variables:

   | Variable | Qué es |
   |---|---|
   | `APP_PASSWORD` | contraseña para entrar al dashboard |
   | `BOT_CLAVE` | clave con la que vas a vincular tu número |
   | `TELEGRAM_BOT_TOKEN` | el token de BotFather |

   (`PUBLIC_URL` se completa sola, apunta a la URL del servicio.)
4. **Deploy**. Al terminar, entrá a la URL con `APP_PASSWORD`.

> **Importante sobre los datos:** el plan gratis de Render **borra el disco en
> cada reinicio**. Dos salidas:
> - **Gratis:** usá el botón *⬇︎ Descargar respaldo* de la vista **Alertas**
>   de vez en cuando, y *⬆︎ Restaurar* si hace falta.
> - **Persistente:** contratá el plan *starter* y agregá el bloque `disk` que
>   está comentado en `render.yaml`.

## 4. Vincular tu número

Desde el bot, mandá:

```
/vincular la-clave-que-pusiste-en-BOT_CLAVE
```

Te contesta **✅ ¡Listo!** y a partir de ahí todo lo que le mandes se guarda
en la app. Si no querés usar `/vincular`, podés fijar directamente
`TELEGRAM_CHAT_ID` con tu ID de chat (te lo muestra el bot en el mensaje de
vinculación).

Si alguien más le manda algo al bot, no se guarda nada: solo responde cómo
vincularse.

## 5. Mandar comprobantes

Cualquiera de estos tres formatos funciona:

| Cómo lo mandás | Qué hace el servidor |
|---|---|
| **Texto**: `Coto $38.560 con débito` | clasifica directo |
| **Foto** del ticket | lo lee con OCR (Tesseract, en español e inglés) |
| **PDF** del resumen | extrae el texto y clasifica |

Se puede mandar con el texto como epígrafe (*caption*) de la foto: se usan
ambos, el epígrafe manda.

El bot contesta con lo que hizo:

```
✅ $38.560 · Supermercado → Alimentos
📅 2026-10-12 · 🏪 Coto · 💳 Débito
💰 Sumado: $38.560 · total del mes: $152.300
```

Y si un límite se toca, avisa en el momento:

```
⚠️ Alerta: llevás consumido el 83,3% del presupuesto de Paseos y salidas.
⛔ Límite superado: Supermercado lleva $315.000 sobre un límite de $300.000.
```

**Comandos**

```
/total     gastos del mes, por categoría
/alertas   límites y presupuestos
/ultimos   últimos 5 comprobantes
/ayuda     esta lista
```

**Clasificación:** si el mensaje trae solo el nombre del comercio (Coto,
Carrefour, Jumbo, Farmacity, Zara, Uber, Netflix, YPF, Pedidos Ya, Mercado
Libre…) la app lo reconoce y lo clasifica igual. Si no tiene importe o habla de
otra cosa, no se guarda y el bot lo dice. Si es igual a uno ya cargado, lo
detecta y no duplica. Y si se equivoca, le podés enseñar palabras nuevas desde
**Categorías → Palabras clave** (ver [CONECTAR-TELEGRAM.md](CONECTAR-TELEGRAM.md)).

## 6. Variables de entorno

Todas están explicadas en [`.env.example`](.env.example). Las que importan:

| Variable | Obligatoria | Para qué |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | sí | recibir comprobantes |
| `BOT_CLAVE` | sí | vincular tu número |
| `APP_PASSWORD` | sí (en la nube) | proteger el dashboard |
| `PUBLIC_URL` | en Render | webhook de Telegram (si no, usa polling) |
| `TELEGRAM_CHAT_ID` | no | vincular directo, sin `/vincular` |
| `DATA_FILE` | no | dónde guardar los datos |
| `TELEGRAM_API_BASE` | no | para tests con un mock |

Sin `APP_PASSWORD` el dashboard queda **abierto**: nunca publiques así.

## 7. Cómo quedó organizado

| Archivo | Qué hace |
|---|---|
| `index.html` | la app completa: dashboard, importación, categorías, límites, alertas |
| `motor.js` | arranca el motor de `index.html` dentro del servidor (una sola clasificadora) |
| `server.js` | API con contraseña, webhook/polling de Telegram, OCR y PDF |
| `test/run.js` | pruebas del servidor: API, fusión de datos, webhook, polling, alertas al celular |
| `test/dashboard-remoto.js` | pruebas del dashboard en modo nube (usa `jsdom`) |
| `render.yaml`, `.env.example` | despliegue y configuración |

**Sincronización:** el navegador manda su estado con un contador (`_rev`).
Si el celular agrega un gasto mientras tenés la pantalla abierta, el servidor
lo mezcla en vez de perderlo; si borrás algo en la pantalla, tampoco vuelve.
Cada 30 segundos (y al volver a la pestaña) la pantalla se refresca sola.

## 8. Pruebas

```bash
npm test
```

- **37** aserciones del servidor (motor, clasificación por comercio, contraseña,
  fusión de estados, webhook, polling, alertas al celular, PDF y foto con OCR,
  y el aprendizaje de palabras nuevas).
- **16** aserciones del dashboard en modo nube, local y de contraseña.

## 9. Limitaciones conocidas

- **Telegram, no WhatsApp.** Elegimos Telegram porque no hace falta un segundo
  número ni cuenta de empresa, y no tiene costo por mensaje. Si algún día
  querés WhatsApp oficial (Meta Cloud API), el motor y el servidor ya están
  listos: sólo habría que agregar otro canal de entrada.
- **OCR:** la primera foto tarda unos segundos más (descarga los modelos de
  idioma, ~8 MB, y los cachea). Los PDF escaneados como imagen no tienen texto
  selectable: el bot pide que mandes una foto.
- **Álbumes de varias fotos:** cada foto se procesa por separado.
- En Render gratis el servidor se duerme tras un rato sin uso: el primer
  mensaje puede tardar ~30 s en despertarlo.
