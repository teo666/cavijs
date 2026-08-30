# Cavijs — Architettura

## Struttura dei file

```
src/
├── main.ts        punto di ingresso della demo (usato da index.html)
├── cavi.ts         Cavi — classe facade
├── world.ts        World — avvolge WasmWorld
├── wire.ts          Wire — avvolge un cavo WASM + metadati
├── node.ts          Node — avvolge un nodo WASM
├── renderer.ts       Renderer — rendering Canvas 2D + loop di animazione
├── controls.ts        CaviControls — Web Component pannello di debug <cavi-controls>
├── jack.ts            Jack — Web Component <cavi-jack>
├── plug.ts            Plug — Web Component <cavi-plug>
├── types.ts           interfacce condivise (IRenderer, WireMeta) + re-export
├── example2.ts, wirewc.ts, style2.css   entry point sperimentale/alternativo (index2.html)
└── style.css          stile della demo principale
```

## Flusso dei dati

```
 index.html
     │
     ▼
 main.ts ── Cavi.initWasm() ─────────────► carica cavi.wasm, imposta Cavi.wasm
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
              ├── world.update() ──► WasmWorld.update()  (passo fisico, ricostruisce wire_data_buffer)
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

`Renderer.render()` guida l'intero loop: aggiorna la fisica (`world.update()`), pulisce il canvas, disegna e si ripianifica tramite `requestAnimationFrame`. Chi lo usa deve solo chiamare `renderer.render()` una volta per avviarlo.

### Interazione col mouse

Il costruttore di `Renderer` collega un listener `mousemove` sul contenitore. Se un estremo di un cavo viene trascinato (stato `draggedWire`/`draggedEndpoint`), chiama direttamente `set_wire_start`/`set_wire_end` sul world WASM; altrimenti inoltra semplicemente la posizione del puntatore tramite `set_mouse` per il comportamento di repulsione del mouse del motore fisico.

### Web Component per i connettori

`Jack` e `Plug` sono custom element nativi (`customElements.define`) che usano Shadow DOM, indipendenti dalla gerarchia di classi `Cavi`/`World`/`Wire` — interagiscono direttamente con un'istanza `Node` (`Plug.setNode`) invece di passare da `Cavi`. Vedi [Jack & Plug](./05-jack-plug.md).

## Strumenti di build

- **Vite** — dev server & bundler (`vite`, `vite build`, `vite preview`)
- **TypeScript** — `tsc` effettua il type-check prima di `vite build`
- **Prettier** — formattazione (script `format` / `format:check`)
- Dipende dal pacchetto npm `cavi` (l'output WASM compilato del progetto Rust gemello) — vedi [Guida introduttiva](./04-getting-started.md) per come questo si risolve in questo workspace.
