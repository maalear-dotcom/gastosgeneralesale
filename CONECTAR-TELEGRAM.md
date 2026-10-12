# 📱 Conectar tu Telegram paso a paso

Con esta guía tu celular le manda los comprobantes (texto, foto o PDF) a un
bot de Telegram y la app los clasifica y los guarda sola. Al final vas a tener
esto funcionando:

```
1. Mandás una foto del ticket de Coto
2. El bot contesta:  ✅ $38.560 · Supermercado · 🏪 Coto · 💳 Débito
3. Si superaste un límite:  ⛔ Límite superado: Supermercado lleva $315.000 sobre un límite de $300.000.
4. Entrás al dashboard y el gasto ya está ahí
```

**Se puede mandar sólo el nombre del comercio.** `Coto $38.560`,
`Farmacity $9.800` o `Zara $45.300` solos ya clasifican bien: la app conoce
Coto, Carrefour, Jumbo, Vea, Farmacity, Zara, Uber, Netflix, YPF, Shell,
Pedidos Ya, Mercado Libre y un largo etcétera. Si el comprobante trae más
detalle (por ejemplo "carrefour almacén"), agrega la subcategoría:
`✅ $52.400 · Supermercado → Alimentos`.

---

## Antes de empezar: lo que necesitás

- [ ] **Telegram** instalado en el celular (o la computadora).
- [ ] **Node.js 18 o superior** instalado (`node -v` en una terminal te debe
      decir algo como `v20.x` o superior).
- [ ] Una cuenta gratis en [render.com](https://render.com) (la vas a crear si
      no tenés) y una cuenta de [GitHub](https://github.com).
- [ ] Diez minutos.

---

## Paso 1 — Crear el bot (5 minutos)

1. En Telegram, buscá el usuario **@BotFather** y tocá *Empezar*.
2. Mandale este comando:

   ```
   /newbot
   ```
3. Te va a preguntar dos cosas:

   | Pregunta | Qué responder | Ejemplo |
   |---|---|---|
   | *What's the name of your bot?* | el nombre que quieras, con espacios | `Gastos Generales` |
   | *What username...* | el usuario del bot, **sin espacios** y terminando en `bot` | `misgastos_casa_bot` |

4. BotFather te responde con algo así:

   ```
   Done! Congratulations on your new bot.
   ...
   Use this token to access the HTTP API:
   7712345678:AAF3kQ9xZpQmN7rT2vW8yLcE4sD1fG6hJ0
   ```

   👉 **Copiá ese token**. Es la clave más importante: sin él el servidor no
   puede hablar con Telegram. (Si la perdés, BotFather → `/mybots` → tu bot →
   *API Token* → *Revoke*.)

**Probá que el bot exista:** buscá tu bot en Telegram (`@misgastos_casa_bot`),
tocá *Empezar* y mandale `hola`. **No te va a contestar todavía** — todavía no
hay servidor. Es normal.

---

## Paso 2 — Elegir dónde corre el servidor

El servidor es el que recibe los mensajes de Telegram, los clasifica y los
guarda. Hay dos caminos:

| | **A) En tu computadora** | **B) En Render (recomendado)** |
|---|---|---|
| Para qué | probar hoy mismo | uso normal, 24/7 |
| Costo | gratis | gratis (con la salvedad de los datos, abajo) |
| Funciona | mientras tu computadora está prendida y conectada | siempre |
| Tiempo | 2 minutos | 10 minutos |

Podés empezar por A y saltar a B cuando quieras. **Si ya sabés que lo quieres
publicado, andá directo al Paso 2B.**

### 2A — En tu computadora (para probar)

1. Abrí una terminal dentro de la carpeta del proyecto y arrancá:

   ```bash
   npm install
   npm start
   ```

   > **Opcional (pero recomendado): contraseña también en local.** Copiá
   > `.env.example` a `.env` y completá `APP_PASSWORD`:
   >
   > ```bash
   > cp .env.example .env
   > # abrí .env con cualquier editor y cambiá los valores
   > ```
   >
   > El servidor la lee solo. Sin ella, el dashboard local queda abierto.

   Vas a ver:

   ```
   · Dashboard protegido con APP_PASSWORD
   · Bot de Telegram: @misgastos_casa_bot
   · Sin PUBLIC_URL: se reciben mensajes en modo polling (sirve para probar en local)
   · Datos en data/estado.json
   · Escuchando en http://localhost:3000
   ```

   (Si no cargaste `.env`, la primera línea dice
   `⚠  APP_PASSWORD no definida: el dashboard queda abierto.`)

   ✅ Si aparece `· Bot de Telegram: @misgastos_casa_bot`, **el token está bien**.

2. Entrá a **http://localhost:3000** con el navegador. Ahí está tu dashboard,
   con los mismos datos que antes.

> **¿Cómo recibe los mensajes sin dirección pública?** En modo *polling* el
> servidor le pregunta a Telegram cada pocos segundos si hay mensajes nuevos.
> No necesitás túneles ni configurar nada más. (En el Paso 4B, con la URL
> pública, se cambia a *webhook*, que es el modo correcto para producción.)

### 2B — En Render (gratis, 24/7)

**1. Subí el proyecto a GitHub** (si no sabés cómo, la forma más corta):

```bash
cd "Gastos Generales"
git init
git add .
git commit -m "Gastos Generales"
```

Luego creá un repositorio vacío en github.com (botón *New repository*, sin
marcar README) y:

```bash
git remote add origin https://github.com/TU-USUARIO/gastos-generales.git
git push -u origin main
```

**2. Creá el servicio en Render:**

1. Entrá a [render.com](https://render.com) → **New +** → **Web Service**.
2. Conectá tu cuenta de GitHub y elegí el repositorio `gastos-generales`.
3. Render va a leer el archivo `render.yaml` que ya viene en el proyecto y va a
   prellenar casi todo. Verificá que quede:

   | Campo | Valor |
   |---|---|
   | Name | `gastos-generales` |
   | Runtime | Node |
   | Build Command | `npm install --omit=dev` |
   | Start Command | `npm start` |

4. Bajá a **Environment Variables** y agregá **tres**:

   | Variable | Valor |
   |---|---|
   | `APP_PASSWORD` | la contraseña con la que vas a entrar al dashboard (inventala y anotala) |
   | `BOT_CLAVE` | una clave para vincular tu celular (inventala y anotala) |
   | `TELEGRAM_BOT_TOKEN` | el token que te dio BotFather |

   (`PUBLIC_URL` **no** la cargues a mano: Render la pone sola con la dirección
   del servicio.)
5. **Create Web Service**. Esperá el deploy (unos 2 minutos). Cuando termine,
   Render te muestra una dirección del tipo:

   ```
   https://gastos-generales.onrender.com
   ```

**3. Probá el servidor:**

- Abrí esa dirección en el navegador → te pide la contraseña → ponés
  `APP_PASSWORD` → ves el dashboard. ✅
- Abrí los **Logs** del servicio en Render y buscá estas líneas:

  ```
  · Bot de Telegram: @misgastos_casa_bot
  · Webhook: https://gastos-generales.onrender.com/webhook/telegram
  · Escuchando en http://localhost:10000
  ```

  ✅ `· Bot de Telegram: @...` = el token está bien.
  ✅ `· Webhook: ...` = Telegram ya está avisando a tu servidor.

> ⚠️ **Ojo con los datos en el plan gratis:** Render borra el disco en cada
> reinicio o redeploy. Hacé *⬇︎ Descargar respaldo* (vista **Alertas** del
> dashboard) cada tanto. Si no querés pensar en eso, contratá el plan
> *starter* y activá el bloque `disk` que está comentado en `render.yaml`.

---

## Paso 3 — Vincular tu número

1. Mandale cualquier cosa a tu bot desde el celular, por ejemplo `hola`.
2. Te contesta:

   ```
   🔒 Aún no hay ningún número vinculado a esta app.

   Tu ID de chat es: 549115555555

   Para recibir y clasificar comprobantes:
   1) Definí la variable BOT_CLAVE en el servidor (o TELEGRAM_CHAT_ID=549115555555).
   2) Mandame /vincular mi-clave
   ```

   Esto es **normal y es a propósito**: si alguien más encuentra el bot, no
   guarda nada.

3. Mandale el comando con la clave que pusiste en `BOT_CLAVE`:

   ```
   /vincular la-clave-que-puse-en-BOT_CLAVE
   ```

4. Te contesta:

   ```
   ✅ ¡Listo! Tu número quedó vinculado.

   Mandame un comprobante (texto, foto o PDF) y lo clasifico.

   📱 Gastos Generales — comandos
   ...
   ```

**Atajo (opcional):** si preferís saltarte el `/vincular`, agregá la variable
`TELEGRAM_CHAT_ID` con el ID que te mostró el bot (en Render: *Environment* →
Add Variable → *Save* → el servicio se redespliega solo).

---

## Paso 4 — Probar con un comprobante real

Mandale al bot, en este orden:

| # | Mandale | Esperá que conteste |
|---|---|---|
| 1 | `Coto $38.560 con débito` | `✅ $38.560 · Supermercado · 🏪 Coto · 💳 Débito` |
| 2 | una **foto** de un ticket | `📷 Leyendo el comprobante…` y después lo mismo que arriba |
| 3 | un **PDF** de resumen bancario | `📄 Leyendo el PDF…` y después el gasto clasificado |

Después de cada uno, la última línea te dice cuánto va sumando el mes:

```
💰 Sumado: $38.560 · total del mes: $38.560
```

Y entrá al dashboard: el gasto ya está cargado, con su categoría, medio de pago
y comercio. 🎉

**Casos que también vas a ver:**

| Lo que mandás | Lo que contesta |
|---|---|
| algo repetido | `♻️ Ya estaba cargado: no lo guardé de nuevo.` |
| algo sin importe ("otra cosa del patio") | `🚫 No lo incluí: ...` |
| una foto de un PDF escaneado | `Ese PDF no tiene texto seleccionable 📄. Mandame una foto...` |
| un archivo que no es nada de eso | `Solo puedo recibir texto, fotos y PDF.` |

**Tip:** si la foto tiene epígrafe, escribilo antes de enviarla
(`Coto$38.560` y ahí sí la foto). El bot usa las dos cosas.

### Si el bot se equivoca de categoría, enseñale la palabra

La clasificación se basa en palabras clave que vos podés editar:

1. En el dashboard, andá a **Importar → ⚙️ Reglas de clasificación** para ver
   todas las reglas vigentes.
2. Andá a **Categorías**, abrí la categoría que quieras (o creá una) y ahí está
   el campo **Palabras clave**, separadas por coma. Ejemplo: en *Supermercado*
   sumá `tigre`.
3. Guardás y listo: a partir de ahí, `El Tigre $12.000` entra en Supermercado.

   > Escribí la palabra sola, sin el artículo: `tigre`, no `eltigre`. La app
   > busca la palabra dentro del mensaje tal como lo escribís.

Las categorías se agregan, modifican y eliminan desde esa misma vista, y lo
mismo vale para las subcategorías y los límites.

---

## Los comandos del bot

```
/total      gastos del mes, por categoría
/alertas    límites y presupuestos del período
/ultimos    últimos 5 comprobantes
/ayuda      esta lista
/vincular X vincular este número con la clave X
```

---

## Si algo falla

| Síntoma | Causa | Solución |
|---|---|---|
| El bot no contesta **nada** | el servidor no está corriendo, o el token es incorrecto | revisá los logs: debe decir `· Bot de Telegram: @tu_bot`. Si no, el token está mal → `/mybots` en BotFather → *Revoke* y volvé a cargar `TELEGRAM_BOT_TOKEN` |
| Contesta `🔒 Aún no hay ningún número vinculado` | es el primer paso | mandá `/vincular tu-clave` (Paso 3) |
| Contesta `❌ Clave incorrecta.` | la clave no coincide con `BOT_CLAVE` | revisá que sea la misma, sin espacios al final |
| Entra al dashboard y te pide la contraseña | es `APP_PASSWORD` | si la olvidaste, cambiala en Render → *Environment* → redeploy |
| Dice `No pude leer el archivo: ...` | el archivo es muy grande o está dañado | mandá una foto en JPG o PNG |
| Los mensajes tardan ~30 s en responder | Render gratis se duerme por inactividad | es normal: el primer mensaje lo despierta. Después responde normal |
| Desplegué y perdí los gastos | el plan gratis borra el disco | restaurá el respaldo (*⬆︎ Restaurar*) y activá el disco del `render.yaml` para que no vuelva a pasar |
| Tenía gastos en el navegador y no los veo en la nube | pasa la primera vez | entrá al dashboard con la contraseña estando en la computadora donde tenías los datos: la app los sube sola |
| Ya no quiero el bot | — | BotFather → `/mybots` → tu bot → *Delete Bot* |

**Para ver qué le pasa al servidor:** en Render, *Logs*; en tu computadora, la
terminal donde corriste `npm start`.

---

## Cómo quedó armado

```
Tu celular ──Telegram──▶ bot ──webhook/polling──▶ server.js
                                                    │  clasifica con el MISMO
                                                    │  motor que usa index.html
                                                    ▼
                                          data/estado.json  ◀── dashboard
```

| Archivo | Para qué |
|---|---|
| `index.html` | el dashboard (también funciona solo, con doble clic) |
| `server.js` | recibe Telegram, clasifica, guarda, responde alertas |
| `motor.js` | arranca el motor de `index.html` dentro del servidor |
| `render.yaml` | cómo desplegarlo en Render |
| `.env.example` | todas las variables explicadas |
| `README.md` | la vista general del proyecto |

Y si algún día querés el **WhatsApp oficial** (Meta Cloud API): el motor y el
servidor ya están listos, sólo habría que agregar otro canal de entrada —
Telegram se eligió porque no necesita un segundo número ni cuenta de empresa.
