# Cavijs — Architettura

## Struttura dei file

```
src/
├── index.ts                  punto di ingresso pubblico: esporta, registra i custom element
├── core/
│   ├── cavi.ts               Cavi — facade (init WASM, cavi, renderer, Cavi.for)
│   ├── world.ts              World — avvolge WasmWorld, passi a frequenza fissa, frame task
│   ├── wire.ts, node.ts      handle di Wire / Node
│   ├── coords.ts             coordinate viewport <-> mondo, CoordinateTransform
│   ├── events.ts             eventi di dominio (cavi-wire-add, cavi-plug-attach, ...)
│   ├── frame.ts              FrameTask (lavoro per frame, letture e scritture)
│   └── types.ts              IRenderer, IInteractionController, IResizeController, ...
├── renderer/
│   ├── renderer.ts           Renderer — Canvas 2D
│   ├── renderer-svg.ts       SvgRenderer — SVG
│   ├── pointer.ts            PointerTracker — alimenta il mouse della fisica
│   └── resize.ts             StandardResizeController
├── component/                custom element
│   ├── worldwc.ts            <cavi-world>
│   ├── wirewc.ts             <cavi-wire>
│   ├── jack.ts, plug.ts      <cavi-jack>, <cavi-plug>
│   └── interactionwc.ts      <cavi-interaction>
├── interaction/
│   ├── interaction.ts        StandardInteractionController — puntatore
│   └── keyboard.ts           KeyboardInteractionController — tastiera
├── debug/                    <cavi-debug>, statistiche, formattazione degli eventi
└── tests/                    test unitari (vitest, jsdom, WASM vero)

examples/                     pagine demo e i loro script (root di Vite)
e2e/                          test end-to-end (Playwright, Chrome)
```

## Flusso dei dati

```
 examples/demo-basic.html
     │
     ▼
 examples/main.ts ── Cavi.initWasm() ─────────────► carica cavi.wasm, imposta Cavi.wasm
     │
     ├── new Cavi() ──► new World() ──► new WasmWorld()   (istanza WASM)
     │
     ├── new Renderer(canvas, cavi.getWorld())
     │        └── legge canvas#wireCanvas dal DOM, ottiene il contesto 2D
     │
     ├── cavi.addWire(...) ──► World.addWire ──► WasmWorld.add_wire_with_count
     │        └── ritorna un Wire (TS) che avvolge l'indice del cavo WASM
     │
     ├── wire.setColor(...) / wire.setMetaData(...)  (solo-rendering, in TS, non in WASM)
     │
     └── renderer.render()
              │  (si auto-pianifica tramite requestAnimationFrame)
              ├── world.advance(elapsed) ──► WasmWorld.update() × N  (passi fisici a frequenza fissa, ricostruiscono wire_data_buffer)
              ├── drawAllWires()
              │     ├── legge WasmWorld.wire_data_ptr()/wire_data_len()
              │     ├── costruisce una VISTA Float32Array direttamente sulla memoria WASM (copia zero)
              │     ├── per ogni cavo: cerca il suo Wire (per i metadati colore) e disegna
              │     │     usando ctx.lineTo (segmenti) o ctx.bezierCurveTo (bezier)
              └── drawInteractionRadii() — disegna gli indicatori del raggio di interazione mouse
```

## Punti chiave del design

### Facade (`Cavi`)

`Cavi` è il punto di ingresso unico previsto per i consumatori: il metodo statico `Cavi.initWasm()` carica il modulo WASM una sola volta (`Cavi.wasm` contiene l'`InitOutput`, incluso `.memory` usato dal renderer per le viste a copia zero del buffer), poi ogni istanza `Cavi` possiede un `World`.

### I metadati vivono in TypeScript, non in WASM

`Wire` mantiene un semplice oggetto `meta: WireMeta` (es. `color`) interamente lato JS. Il livello WASM non ha alcun concetto di colore o etichette — è un confine deliberato (vedi la [panoramica di `cavi`](../../../cavi/doc/it/01-overview.md)) affinché le preoccupazioni di rendering non trapelino mai nel motore fisico.

### Rendering a copia zero

`Renderer.drawAllWires()` **non** chiama getter WASM per singolo nodo. Legge invece il buffer piatto `f32` che `WasmWorld::update()` ricostruisce ad ogni frame, tramite una vista `Float32Array` su `Cavi.wasm.memory.buffer`. Questo rispecchia il layout del buffer documentato nell'architettura di `cavi` (`[node_count, radius, render_type, path_length, ...path_data]` per cavo) ed evita una chiamata JS↔WASM per ogni nodo.

### Gestione del loop di rendering

`Renderer.render()` guida l'intero loop: fa avanzare la fisica (`world.advance(elapsed)`), pulisce il canvas, disegna e si ripianifica tramite `requestAnimationFrame`. Chi lo usa deve solo chiamare `renderer.render()` una volta per avviarlo.

Il passo del motore ha un delta di tempo fisso, quindi `World.advance` trasforma il tempo reale trascorso dal frame precedente in un numero fisso di passi al secondo (`setStepRate`, default 60) con un accumulatore: un passo per frame a 60 Hz, uno ogni due frame a 120 Hz, due per frame a 30 Hz. Poi, a ogni frame, `build_render_data(alpha)` ricostruisce il buffer di rendering con i cavi disegnati ad `alpha` del tragitto tra gli ultimi due passi (`alpha` = tempo rimasto nell'accumulatore / durata di un passo). Uno schermo più veloce della frequenza dei passi disegna così una posizione nuova a ogni frame invece di ripetere quella dell'ultimo passo, e il buffer corrisponde sempre ai cavi attuali. Il disegno resta indietro al massimo di un passo; i nodi fissi (capi collegati o trascinati) sono disegnati dove sono. Anche i plug seguono la posizione disegnata (`Node.getRenderPosition`), così restano sul cavo.

### Interazione col mouse

Mentre è attivo, il `PointerTracker` di ogni renderer (`src/renderer/pointer.ts`) inoltra la posizione del puntatore sopra la superficie di disegno tramite `set_mouse`, per la repulsione del mouse del motore fisico. Il motore applica il mouse a ogni cavo a ogni passo, quindi quando nessun puntatore è sopra la superficie (è uscito dalla superficie o dalla finestra, o un tocco è finito) il mouse viene parcheggiato lontano, fuori portata (`World.releaseMouse`); lo stesso succede all'avvio, perché altrimenti il mouse del motore parte da (0, 0). Il trascinamento è gestito dal controller di interazione, non dal renderer.

### Web Component per i connettori

`Jack` e `Plug` sono custom element nativi (`customElements.define`) che usano Shadow DOM, indipendenti dalla gerarchia di classi `Cavi`/`World`/`Wire` — interagiscono direttamente con un'istanza `Node` (`Plug.setNode`) invece di passare da `Cavi`. Vedi [Jack & Plug](./05-jack-plug.md).

## Strumenti di build

- **Vite** — dev server & bundler (`vite`, `vite build`, `vite preview`)
- **TypeScript** — `tsc` effettua il type-check prima di `vite build`
- **Prettier** — formattazione (script `format` / `format:check`)
- Dipende dal pacchetto npm `cavi` (l'output WASM compilato del progetto Rust gemello) — vedi [Guida introduttiva](./04-getting-started.md) per come questo si risolve in questo workspace.
