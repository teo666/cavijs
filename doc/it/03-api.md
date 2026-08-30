# Cavijs — Riferimento API

Wrapper TypeScript attorno al motore WASM [`cavi`](../../../cavi/doc/it/03-api.md). Import da `cavijs` (`src/types.ts` ri-esporta `Node`, `Wire`, `World`, `Cavi`).

## `Cavi` (`src/cavi.ts`)

Classe facade principale — il punto di ingresso consigliato.

```typescript
static initWasm(): Promise<void>          // carica il modulo WASM (imposta Cavi.wasm)
init(): Promise<void>
getWorld(): World
setRenderer(renderer: IRenderer): void
getRenderer(): IRenderer | null
addWire(x1, y1, x2, y2, nodes, tension, radius, type): Wire
deleteWire(index: number): void
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
getWireByIndex(index: number): Wire | null
getWires(): Wire[]
update(): void
setMouse(x: number, y: number): void
render(): void
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement | null
```

`Cavi.wasm: InitOutput` (statico) contiene il modulo WASM caricato, incluso `.memory`, usato da `Renderer` per l'accesso a copia zero al buffer. `Cavi.shared` è uno slot statico per un'istanza condivisa (attualmente non usato dalla demo — verificare prima di farci affidamento).

## `World` (`src/world.ts`)

Avvolge `WasmWorld`; espone la gestione dei cavi e i parametri globali.

```typescript
getWasmWorld(): WasmWorld
addWire(x1, y1, x2, y2, nodes, tension, radius, renderType): Wire
deleteWire(index: number): void
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
setRenderer(renderer: IRenderer): void
getRenderer(): IRenderer | null
getWireByIndex(index: number): Wire | null
getWires(): Wire[]
getWireCount(): number
update(): void
setMouse(x: number, y: number): void
getWireDataPtr(): number
getWireDataLen(): number
setMouseRadius(radius: number): void
getMouseRadius(): number
setFriction(friction: number): void
getFriction(): number
```

Il costruttore di `World` imposta `response_coef` a `0.0` di default (risposta alla self-collision dei cavi disabilitata a meno di attivazione esplicita). Mantiene un proprio array `Wire[]` sincronizzato con gli indici dei cavi WASM — `deleteWire` ricrea i wrapper `Wire` per ogni cavo successivo a quello eliminato, poiché gli indici si spostano, riportando anche sul nuovo wrapper i metadati (`meta`, es. `color`) del vecchio — dato che vivono solo lato JS e non in WASM, andrebbero altrimenti persi silenziosamente (bug corretto qui, non nel livello `CaviWireElement`/DOM, dato che è un problema puramente di `World`/`Wire`).

> **Attenzione**: `deleteWire`/`Cavi.deleteWire` ricreano solo i wrapper `Wire` interni di `World`. Qualunque `Wire`/`Node` ottenuto **prima** della cancellazione e tenuto altrove (una cache, una chiusura, ecc.) mantiene il vecchio indice e continua silenziosamente a leggere/scrivere il cavo sbagliato dopo che gli indici si sono spostati. `CaviWireElement` (`src/wirewc.ts`) gestisce già questo caso per i cavi dichiarativi/creati da `Jack` tramite un proprio registro statico e un ri-aggancio (`_rebindAfterIndexShift`) eseguito subito dopo ogni `deleteWire` — vedi la sezione auto-cleanup in [`Jack`/`Plug`](./05-jack-plug.md). Chi chiama `deleteWire` al di fuori di `CaviWireElement` (es. direttamente su `World`/`Cavi`) deve gestire da sé il ri-aggancio di eventuali riferimenti già in cache.

## `Wire` (`src/wire.ts`)

Controparte TypeScript di un cavo WASM. Aggiunge un dizionario `meta: WireMeta` che vive puramente in JS (mai inviato a WASM) per dati di rendering/estensione come il colore.

```typescript
addNode(x: number, y: number, fixed?: boolean): void
addNodeAt(index: number, x: number, y: number, fixed?: boolean): void
removeNode(index: number): void
getNodeCount(): number
setNodeCount(count: number): void
getNode(index: number): Node | null
setMetaData(key: string, value: any): void
getMetaData(key: string): any
getAllMetaData(): WireMeta
setColor(color: string): void
getColor(): string | undefined
setRadius(radius: number): void
getRadius(): number
getIndex(): number
```

**Esempio di metadati:**
```typescript
const wire = world.addWire(100, 100, 500, 100, 20, 10, 5, 1);
wire.setColor('#ff0000');
wire.setMetaData('thickness', 2);
wire.setMetaData('pattern', 'dashed');
```

Un `Wire` costruito senza argomenti `(world, wireIndex)` è "scollegato" — tutti i suoi metodi che comunicano con WASM diventano no-op / ritornano valori di default, ciò che accade se si fa `new Wire()` direttamente invece che tramite `World.addWire`.

`setNodeCount(count)` ridimensiona il cavo a runtime: ricostruisce l'intero vettore di nodi, preservando posizione e stato `fixed` dei due nodi terminali e ridistribuendo linearmente i nodi intermedi tra di essi (lo stato di eventuali nodi intermedi preesistenti viene perso). Usato da [`Jack`](./05-jack-plug.md) per far crescere il cavo mentre lo si trascina fuori da una presa — dato che l'indice dell'ultimo nodo cambia dopo il resize, chi tiene un riferimento al nodo terminale (es. un `Plug`) deve ri-agganciarsi con `wire.getNode(wire.getNodeCount() - 1)`.

## `Node` (`src/node.ts`)

Controparte TypeScript di un nodo WASM — un singolo punto di un cavo (posizione, velocità, stato fisso).

```typescript
get x(): number      // sola lettura, letto live da WASM se collegato a un world/indice cavo
get y(): number
get fixed(): boolean
set fixed(value: boolean)
setPosition(x: number, y: number): void
setMousePosition(x: number, y: number): void   // inoltra a World.setMouse
```

Un `Node` può essere "live" (costruito con `world`/`wireIndex`/`nodeIndex`, es. tramite `Wire.getNode()`) — nel qual caso `x`/`y` sono sempre letti direttamente da WASM — oppure un semplice contenitore di dati (costruito solo con `x`/`y`/`fixed`/una copia opzionale di `wasmNode`), usato ad esempio da `Plug` per collegarsi a un nodo specifico.

## `Renderer` (`src/renderer.ts`)

Renderer Canvas 2D che implementa `IRenderer`.

```typescript
constructor(container: HTMLElement, world: World)
// cerca '#wireCanvas' dentro `container` e ne ottiene il contesto 2D

render(): void            // metodo principale di rendering; include il loop di animazione auto-pianificato
clear(): void
getFPS(): number
drawInteractionRadii(x: number, y: number): void
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement   // l'elemento passato al costruttore
```

**Caratteristiche:**
- Accesso diretto alla memoria WASM per un rendering efficiente (vista `Float32Array` a copia zero su `Cavi.wasm.memory.buffer`)
- Legge i colori dei cavi dai metadati di `Wire`, ricadendo su una palette di default (`['#00ff88', '#ff00ff', '#ffaa00']`) in base all'indice del cavo
- Supporta sia il rendering a segmenti (`ctx.lineTo`) sia Bezier (`ctx.bezierCurveTo`), in base al `render_type` codificato nel buffer dati dei cavi
- Loop `requestAnimationFrame` integrato con tracciamento FPS (aggiornato una volta al secondo)
- Disegna indicatori del raggio di interazione mouse/puntatore (cerchi tratteggiati) alla posizione corrente del mouse
- Collega un proprio listener `mousemove` su `container`; gestisce anche il trascinamento degli estremi dei cavi (`set_wire_start`/`set_wire_end`) quando `draggedWire`/`draggedEndpoint` sono impostati (il collegamento inizio/fine drag per questo non è presente in `Renderer` stesso — vedi `Plug` per il modello di interazione drag usato dai componenti Jack/Plug)
- Chiama internamente `world.update()` ad ogni frame — chi usa il loop di `Renderer.render()` **non** dovrebbe chiamare anche `Cavi.update()`/`World.update()` ad ogni frame
- `setDebugDrawNodes(true)` (opzione globale, default `false`) attiva un overlay di debug che disegna la circonferenza di ogni nodo di ogni cavo (via `Wire.getNode()`, non parsing del buffer path) alla sua posizione fisica reale, con raggio pari a `Wire.getRadius()` — utile per verificare la posizione dei nodi indipendentemente dal path renderizzato (segmenti/Bezier)

## `IRenderer` (`src/types.ts`)

```typescript
interface IRenderer {
    render: () => void;
    setDebugDrawNodes: (enabled: boolean) => void;
    getDebugDrawNodes: () => boolean;
    getContainer: () => HTMLElement;
}
```

Implementarla per costruire un renderer personalizzato (es. WebGL, SVG) — `Cavi.setRenderer()` / `World.setRenderer()` accettano qualsiasi cosa la soddisfi.

## `IInteractionController` (`src/types.ts`)

```typescript
interface IInteractionController {
    attach: (cavi: Cavi) => void;
    detach: () => void;
}
```

Contratto per qualunque cosa gestisca l'interazione utente (drag, click, touch...) con `Jack`/`Plug` — pluggabile allo stesso modo di `IRenderer`. Vedi [Componenti Jack & Plug](./05-jack-plug.md#interazione-standardinteractioncontroller-e-cavi-interaction) per l'implementazione standard (`StandardInteractionController`) e come sostituirla.

## `CaviControls` (`src/controls.ts`)

Un Web Component `<cavi-controls>` che fornisce un pannello GUI di debug/tuning (Shadow DOM), stilizzato come una card scura e scrollabile.

```typescript
setCavi(cavi: Cavi): void   // collega il pannello a un'istanza Cavi e avvia il polling delle statistiche
```

**Mostra (auto-aggiornato ogni 100ms):** FPS, numero di cavi, punti totali su tutti i cavi, dimensione del buffer WASM (KB), X/Y del mouse, accelerazione X/Y.

**Fornisce controlli per:** raggio del mouse, raggio del puntatore, coefficiente di risposta, attrito, accelerazione X/Y, numero di nodi per cavo, oltre ad azioni (aggiungi cavo casuale, cancella tutti i cavi, aggiungi nodi a un cavo) — vedi `src/controls.ts` per gli ID/collegamenti esatti dei controlli.

```typescript
import { CaviControls } from 'cavijs';

const controls = document.createElement('cavi-controls') as CaviControls;
document.body.appendChild(controls);
controls.setCavi(cavi);
```

## Esempio d'uso completo

```typescript
import { Cavi, Renderer } from 'cavijs';

await Cavi.initWasm();

const cavi = new Cavi();
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas, cavi.getWorld());
cavi.setRenderer(renderer);

const wire1 = cavi.addWire(100, 100, 500, 100, 20, 10, 5, 1);
wire1.setColor('#ff0000');
wire1.setMetaData('label', 'Cable A');

const wire2 = cavi.addWire(100, 200, 500, 200, 25, 15, 8, 1);
wire2.setColor('#00ff00');

cavi.setAcceleration(0, 9.8);

renderer.render(); // avvia il loop di animazione interno
```

## `Jack` / `Plug`

Vedi [Componenti Jack & Plug](./05-jack-plug.md).
