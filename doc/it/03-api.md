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
getSurface(): HTMLElement | null        // la superficie di disegno del renderer (il container, se non è stata data una `surface`)
setCoordinateTransformProvider(fn: (() => CoordinateTransform) | null): void
getCoordinateTransform(): CoordinateTransform
notifyCoordinateTransformChanged(): void
static for(el: Element): Cavi | null   // il Cavi a cui appartiene `el`
static whenReady(el: Element, fn: (cavi: Cavi) => void): void
```

`Cavi.wasm: InitOutput` (statico) contiene il modulo WASM caricato, incluso `.memory`, usato da `Renderer` per l'accesso a copia zero al buffer. `Cavi.for(el)` restituisce il `Cavi` a cui appartiene un elemento — quello il cui container del renderer (registrato da `setRenderer`) è `el` o il suo antenato più vicino — così più mondi possono coesistere nella stessa pagina; restituisce `null` dentro un `<cavi-world>` ancora in inizializzazione, e ripiega su `Cavi.shared` (l'ultimo mondo inizializzato, mantenuto per compatibilità) fuori da qualunque container registrato. `Cavi.whenReady(el, fn)` esegue `fn` appena quell'istanza esiste. Vedi [Zoom, pan e più mondi](./06-zoom-multiworld.md).

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

Il costruttore di `World` imposta `response_coef` a `0.0` di default (risposta alla self-collision dei cavi disabilitata a meno di attivazione esplicita). Mantiene un proprio array `Wire[]` sincronizzato con gli indici dei cavi WASM: `deleteWire` scala **sul posto** l'indice di ogni handle `Wire` successivo (`Wire._setIndex`) e imposta a `-1` quello cancellato, che diventa un no-op. Ogni riferimento `Wire`/`Node` tenuto altrove (un `CaviWireElement`, una `CableSession`, il `Node` di un `Plug`) resta quindi valido dopo una cancellazione — nessun ri-aggancio necessario. `World` contiene anche il provider della trasformazione di coordinate (`setCoordinateTransformProvider`/`getCoordinateTransform`), così un renderer legge sempre lo zoom del proprio mondo.

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

Un `Node` è "live" (costruito con `world`/`wire`/`nodeIndex`, come fa `Wire.getNode()`) — `x`/`y`/`fixed` sono allora sempre letti da WASM attraverso il suo `Wire`, quindi segue l'indice del cavo se un cavo precedente viene cancellato — oppure un semplice contenitore di dati (costruito solo con `x`/`y`/`fixed`), usato ad esempio nei test. `Wire.getNode(index)` restituisce `null` per un indice fuori range.

## `Renderer` (`src/renderer.ts`)

Renderer Canvas 2D che implementa `IRenderer`.

```typescript
constructor(container: HTMLElement, world: World, options?: RendererOptions & { canvas?: HTMLCanvasElement })
// usa options.canvas (qualsiasi canvas, ovunque: la sua posizione a schermo viene misurata
// a ogni frame), altrimenti '#wireCanvas' nell'host (options.surface, altrimenti container),
// creandolo se manca

render(): void            // metodo principale di rendering; include il loop di animazione auto-pianificato
clear(): void
getFPS(): number
drawInteractionRadii(x: number, y: number): void
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement   // l'elemento passato al costruttore (origine del mondo)
getSurface(): HTMLElement     // options.surface, altrimenti il container
stop(): void                  // ferma il loop, rimuove il listener del puntatore, pulisce il canvas
```

**Caratteristiche:**

- Accesso diretto alla memoria WASM per un rendering efficiente (vista `Float32Array` a copia zero su `Cavi.wasm.memory.buffer`)
- Legge i colori dei cavi dai metadati di `Wire`, ricadendo su una palette di default (`['#00ff88', '#ff00ff', '#ffaa00']`) in base all'indice del cavo
- Supporta sia il rendering a segmenti (`ctx.lineTo`) sia Bezier (`ctx.bezierCurveTo`), in base al `render_type` codificato nel buffer dati dei cavi
- Loop `requestAnimationFrame` integrato con tracciamento FPS (aggiornato una volta al secondo)
- Disegna indicatori del raggio di interazione mouse/puntatore (cerchi tratteggiati) alla posizione corrente del mouse
- Mentre è attivo ascolta `pointermove` sul document (rimosso da `stop()`) e passa alla fisica la posizione del mouse in coordinate del mondo, tramite lo stesso `clientToWorld` consapevole dello zoom usato ovunque
- `render()` è idempotente (una seconda chiamata non avvia un secondo loop) e può essere richiamato dopo `stop()`
- HiDPI: il backing store del canvas è `devicePixelRatio` volte la sua dimensione CSS (vedi `sizeCanvasToHost`), e il renderer scala il disegno di conseguenza
- `options.surface`: vedi [Zoom, pan e più mondi](./06-zoom-multiworld.md) — il canvas vive su un elemento non trasformato e il renderer applica da sé lo zoom registrato, così i cavi non vengono mai tagliati al box del container
- Chiama internamente `world.update()` ad ogni frame — chi usa il loop di `Renderer.render()` **non** dovrebbe chiamare anche `Cavi.update()`/`World.update()` ad ogni frame
- `setDebugDrawNodes(true)` (opzione globale, default `false`) attiva un overlay di debug che disegna la circonferenza di ogni nodo di ogni cavo (letta direttamente da WASM, non dal parsing del buffer path) alla sua posizione fisica reale, con raggio pari a `Wire.getRadius()` — utile per verificare la posizione dei nodi indipendentemente dal path renderizzato (segmenti/Bezier)

## `IRenderer` (`src/types.ts`)

```typescript
interface IRenderer {
  render: () => void;
  setDebugDrawNodes: (enabled: boolean) => void;
  getDebugDrawNodes: () => boolean;
  getContainer: () => HTMLElement;
  getSurface?: () => HTMLElement; // opzionale: default getContainer()
  stop: () => void;
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
const container = document.getElementById('container') as HTMLElement;
const renderer = new Renderer(container, cavi.getWorld()); // crea #wireCanvas se manca
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
