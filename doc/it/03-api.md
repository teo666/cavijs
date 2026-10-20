# Cavijs — Riferimento API

Wrapper TypeScript attorno al motore WASM [`cavi`](../../../cavi/doc/it/03-api.md). Import da `cavijs`: `src/index.ts` esporta tutte le classi qui sotto e registra i custom element.

## `Cavi` (`src/core/cavi.ts`)

Classe facade principale — il punto di ingresso consigliato.

```typescript
static initWasm(): Promise<void>          // carica il modulo WASM (imposta Cavi.wasm)
init(): Promise<void>
getWorld(): World
setRenderer(renderer: IRenderer | null): void  // ferma e deregistra il precedente
destroy(): void                         // smonta la simulazione per sempre (vedi sotto)
isDestroyed(): boolean
getRenderer(): IRenderer | null
addWire(x1, y1, x2, y2, nodes, tension, radius, type): Wire
deleteWire(wire: Wire | number): void  // per handle (preferibile) o indice attuale
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
getWireByIndex(index: number): Wire | null
getWires(): Wire[]
update(): void                          // un passo fisico — il loop di rendering avanza già da solo
setMouse(x: number, y: number): void
releaseMouse(): void
setStepRate(stepsPerSecond: number): void  // default 60
getStepRate(): number
setTimeStep(timeStep: number): void     // tempo simulato per sotto-passo del motore, default 0.3
setSubsteps(substeps: number): void     // sotto-passi del motore per passo, default 2 (cambia anche la velocità)
setConstraintIterations(iterations: number): void  // passate di rilassamento dei vincoli per sotto-passo, default 1 (solo rigidità)
setSleepEnabled(enabled: boolean): void  // vedi World.setSleepEnabled
render(): void
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement | null
getSurface(): HTMLElement | null        // la superficie di disegno del renderer (il container, se non è stata data una `surface`)
setCoordinateTransformProvider(fn: (() => CoordinateTransform) | null): void
getCoordinateTransform(): CoordinateTransform
notifyCoordinateTransformChanged(): void  // facoltativo: invia cavi-transform-change per il codice della pagina
static for(el: Element): Cavi | null   // il Cavi a cui appartiene `el`
static whenReady(el: Element, fn: (cavi: Cavi) => void): void
```

`Cavi.wasm: InitOutput` (statico) contiene il modulo WASM caricato, incluso `.memory`, usato da `Renderer` per l'accesso a copia zero al buffer. `Cavi.for(el)` restituisce il `Cavi` a cui appartiene un elemento — quello il cui container del renderer (registrato da `setRenderer`) è `el` o il suo antenato più vicino — così più mondi possono coesistere nella stessa pagina; restituisce `null` dentro un `<cavi-world>` ancora in inizializzazione, e ripiega su `Cavi.shared` (l'ultimo mondo inizializzato, mantenuto per compatibilità) fuori da qualunque container registrato. `Cavi.whenReady(el, fn)` esegue `fn` appena quell'istanza esiste. Vedi [Zoom, pan e più mondi](./06-zoom-multiworld.md).

## `World` (`src/core/world.ts`)

Avvolge `WasmWorld`; espone la gestione dei cavi e i parametri globali.

```typescript
getWasmWorld(): WasmWorld               // per renderer e parametri: aggiungere/togliere cavi e nodi solo tramite World/Wire
addWire(x1, y1, x2, y2, nodes, tension, radius, renderType): Wire
deleteWire(wire: Wire | number): void  // per handle (preferibile) o indice attuale
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
setRenderer(renderer: IRenderer | null): void  // ferma il precedente
destroy(): void
isDestroyed(): boolean
getRenderer(): IRenderer | null
getWireByIndex(index: number): Wire | null
getWires(): Wire[]                      // una copia
getWiresView(): readonly Wire[]         // la lista viva, senza copia: per chi legge a ogni frame (renderer)
getWireCount(): number
update(): void                          // esattamente un passo fisico
addFrameTask(task: FrameTask): () => void  // registra lavoro DOM per frame, ritorna una funzione per rimuoverlo
runFrameTasks(): void                   // esegue tutti i task: prima le letture, poi le scritture (lo chiama il renderer)
advance(elapsedMs: number): number      // passi a frequenza fissa, ritorna quanti ne ha eseguiti
setStepRate(stepsPerSecond: number): void
getStepRate(): number
setTimeStep(timeStep: number): void     // tempo simulato per sotto-passo del motore, default 0.3
setSubsteps(substeps: number): void     // sotto-passi del motore per passo, default 2 (cambia anche la velocità)
setConstraintIterations(iterations: number): void  // passate di rilassamento dei vincoli per sotto-passo, default 1 (solo rigidità)
holdWire(wire: Wire): void              // il cavo trascinato: il mouse non lo respinge
releaseHeldWire(wire?: Wire): void       // solo se `wire` è quello tenuto, quando indicato
getHeldWire(): Wire | null
setPointerRadius(radius: number): void   // portata del punto tenuto sugli altri cavi, default 20
setSleepEnabled(enabled: boolean): void  // sospensione dei cavi fermi, default true
setSleepThreshold(threshold: number): void  // default 0.01
setSleepSteps(steps: number): void       // default 30
getSleepingWireCount(): number
setMouse(x: number, y: number): void
releaseMouse(): void                    // parcheggia il mouse del motore fuori portata
getWireDataPtr(): number
getWireDataLen(): number
setMouseRadius(radius: number): void
getMouseRadius(): number
setFriction(friction: number): void
getFriction(): number
```

Il costruttore di `World` imposta `response_coef` a `0.0` di default (risposta alla self-collision dei cavi disabilitata a meno di attivazione esplicita). Mantiene un proprio array `Wire[]` sincronizzato con gli indici dei cavi WASM: `deleteWire` scala **sul posto** l'indice di ogni handle `Wire` successivo (`Wire._setIndex`) e imposta a `-1` quello cancellato, che diventa un no-op. Ogni riferimento `Wire`/`Node` tenuto altrove (un `CaviWireElement`, una `CableSession`, il `Node` di un `Plug`) resta quindi valido dopo una cancellazione — nessun ri-aggancio necessario. `World` contiene anche il provider della trasformazione di coordinate (`setCoordinateTransformProvider`/`getCoordinateTransform`), così un renderer legge sempre lo zoom del proprio mondo.

## `Wire` (`src/core/wire.ts`)

Controparte TypeScript di un cavo WASM. Aggiunge un dizionario `meta: WireMeta` che vive puramente in JS (mai inviato a WASM) per dati di rendering/estensione come il colore.

```typescript
delete(): void                          // cancella questo cavo dal suo mondo, qualunque sia il suo indice
addNode(x: number, y: number, fixed?: boolean): void
addNodeAt(index: number, x: number, y: number, fixed?: boolean): void
removeNode(index: number): boolean        // false se lascerebbe meno di 2 nodi
getNodeCount(): number
setNodeCount(count: number): void
growTo(count: number, spawn?: 'interpolate' | 'stack'): void
shrinkTo(count: number): void
getNode(index: number): Node | null
setMetaData(key: string, value: any): void
getMetaData(key: string): any
getAllMetaData(): WireMeta
setColor(color: string): void
getColor(): string | undefined
setRadius(radius: number): void
getRadius(): number
setRenderType(renderType: number): void  // 0 = segmenti, 1 = bezier
getRenderType(): number
setLinkDistance(distance: number): void  // distanza a riposo tra i nodi (setRadius non la cambia più)
getLinkDistance(): number
setBendStiffness(stiffness: number): void   // da 0 (default, una catena) a 1
getBendStiffness(): number
setEndDirection(end: 0 | 1, direction: { x: number; y: number } | null): void
getEndDirection(end: 0 | 1): { x: number; y: number } | null
isSleeping(): boolean
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

`setNodeCount(count)` ridimensiona il cavo a runtime: ricostruisce l'intero vettore di nodi, preservando posizione e stato `fixed` dei due nodi terminali e ridistribuendo linearmente i nodi intermedi tra di essi (lo stato di eventuali nodi intermedi preesistenti viene perso).

`growTo(count, spawn?)` e `shrinkTo(count)` lo ridimensionano senza farlo: inseriscono o tolgono nodi uno alla volta subito prima dell'ultimo, così tutti gli altri nodi mantengono il loro stato fisico e il cavo non torna dritto di colpo — è così che cresce un cavo mentre lo tiri fuori da un jack. I nodi nuovi partono distribuiti sulla linea dal penultimo all'ultimo nodo (`'interpolate'`, il default), o sopra il penultimo (`'stack'`). `shrinkTo` non scende mai sotto 2 nodi; il cavo poi si ritira da solo nei passi successivi. Il numero di nodi si sceglie con `nodeCountForDistance` (vedi [`cavijs/core`](#cavijscore-srccoreindexts)).

`setBendStiffness(k)` fa resistere il cavo alla flessione. A 0 (il default) è una catena di maglie: appeso a un punto scende dritto come un filo a piombo e si piega dove la corda finisce. Più rigido, si curva lungo tutta la lunghezza, come un cavo vero. Il motore riduce di `k` la curvatura di ogni terna di nodi consecutivi una volta per iterazione dei vincoli, quindi l'effetto si somma con `World.setConstraintIterations` (circa `1 − (1 − k)^n`); i nodi fissi non si muovono mai. `setEndDirection(end, { x, y })` dà a un capo la direzione con cui esce dal suo aggancio — una spina dal jack, un edge dal suo handle — e, con una rigidità, il cavo esce da quel capo in quella direzione e poi curva gradualmente (nel motore, un nodo fisso virtuale dietro il capo). Entrambi svegliano il cavo.

`getNode(index)` restituisce un solo handle per nodo, e l'handle segue il suo nodo quando vengono inseriti o tolti nodi prima di lui tramite questo `Wire` (`addNodeAt`, `removeNode`, `setNodeCount`): un `Plug` legato al terminale resta sul terminale quando [`Jack`](./05-jack-plug.md) allunga un cavo inserendo nodi, o quando si aggiungono nodi da codice. L'handle di un nodo rimosso (o di un nodo intermedio scartato da `setNodeCount`) viene invalidato: i suoi metodi non fanno più niente. Le modifiche ai nodi fatte direttamente sul `WasmWorld` (`getWasmWorld()`) aggirano questo meccanismo.

### Smontare un mondo

`Cavi.destroy()` ferma il renderer, libera il mondo WASM, toglie il container del renderer da `Cavi.for` e azzera `Cavi.shared` se punta a questa istanza. Tutti gli handle `Wire` e `Node` del mondo vengono invalidati, così gli elementi che ne tengono ancora uno fanno pulizia senza toccare memoria liberata. L'istanza non va più usata (lo dice `isDestroyed()`). `<cavi-world>` lo fa da solo quando viene rimosso dalla pagina (non quando viene solo spostato) e, se viene inserito di nuovo più tardi, crea un mondo nuovo mantenendo la trasformazione di coordinate registrata con `setCoordinateTransform`.

## `cavijs/core` (`src/core/index.ts`)

La simulazione senza la pagina: `import { … } from 'cavijs/core'` non registra nessun custom element e non tocca il DOM, né all'import né dopo. Per il codice che porta un proprio disegno e una propria interazione — gli edge di una libreria di grafi (Vue Flow, React Flow), i componenti di un framework, un worker. Tutto ciò che contiene è esportato anche da `cavijs`.

| Export                                                                        | Cosa fa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initWasm(source?)`, `isWasmReady()`, `getWasm()`                             | Carica il modulo WASM di cavi una volta per pagina (le chiamate successive condividono lo stesso caricamento; uno fallito viene dimenticato, così la chiamata dopo riprova). `source` — un URL, una `Response`, i byte o un modulo compilato — dice da dove prendere il `.wasm` quando il bundler non lo serve accanto al JS di `cavi` (CDN, CSP, un bundler diverso da Vite). In una pagina con dei `<cavi-world>`, va chiamata prima che si connettano, e loro la condividono. `Cavi.initWasm()` è lo stesso caricamento. |
| `World`, `Wire`, `Node`, `DEFAULT_WIRE_COLORS`                                | Come sopra. Un `World` non ha bisogno di un renderer: si chiama `advance(elapsedMs)` dal proprio ciclo di frame.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `nodeCountForDistance(distance, { min, perUnit, max }?)`                      | Quanti nodi deve avere un cavo che arriva a `distance`: `min + floor(distance × perUnit)`, al massimo `max` (default 4, 1/30, 60: la regola con cui cresce un cavo tirato fuori da un jack). Va usata con `Wire.growTo`/`shrinkTo`.                                                                                                                                                                                                                                                                                         |
| `forEachWireRender(world, fn)`                                                | Chiama `fn` con i dati di disegno di ogni cavo come li ha costruiti l'ultimo `advance()`: `{ wire, index, radius, renderType, path, record }`, viste sulla memoria WASM, valide fino al prossimo `advance()`. Un `record` uguale a quello del frame prima vuol dire che il cavo è uguale: niente da ridisegnare.                                                                                                                                                                                                            |
| `svgPathData(path, renderType)`, `tracePath(target, path, renderType)`        | Un `path` come dati di path SVG (il `d` di un `<path>`, in coordinate del mondo), o tracciato con `moveTo`/`lineTo`/`bezierCurveTo` di un contesto canvas o di un `Path2D`. Entrambi i renderer disegnano con queste.                                                                                                                                                                                                                                                                                                       |
| `wirePath(world, wire)`                                                       | I dati di path SVG di un solo cavo. Scorre il buffer fino a lui: per molti cavi, meglio `forEachWireRender` una volta per frame.                                                                                                                                                                                                                                                                                                                                                                                            |
| `RENDER_SEGMENTS`, `RENDER_BEZIER`                                            | I due `renderType`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `IDENTITY_TRANSFORM`, `screenToWorld`, `worldToScreen`, `CoordinateTransform` | La matematica delle coordinate, senza DOM, per collegare il viewport di una libreria (`{ x, y, zoom }` è `{ translateX, translateY, scale }`).                                                                                                                                                                                                                                                                                                                                                                              |

```ts
import { World, initWasm, forEachWireRender, svgPathData } from 'cavijs/core';

await initWasm();
const world = new World();
const wire = world.addWire(0, 0, 200, 0, 8, 20, 5);
let last = performance.now();
requestAnimationFrame(function frame(now) {
  world.advance(now - last);
  last = now;
  forEachWireRender(world, ({ index, path, renderType }) => {
    pathEls[index].setAttribute('d', svgPathData(path, renderType));
  });
  requestAnimationFrame(frame);
});
```

`World` legge la pagina solo per misurare la vista per i suoi frame task (eliminazione dei cavi orfani), e solo quando ha un renderer: mai con `cavijs/core` da solo.

## `Node` (`src/core/node.ts`)

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

## `Renderer` (`src/renderer/renderer.ts`)

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
- Legge i colori dei cavi dai metadati di `Wire`. `World.addWire` assegna a ogni cavo nuovo un colore da `DEFAULT_WIRE_COLORS` (`['#00ff88', '#ff00ff', '#ffaa00']`, in ordine di creazione), così cancellare un cavo non cambia mai il colore degli altri
- Supporta sia il rendering a segmenti (`ctx.lineTo`) sia Bezier (`ctx.bezierCurveTo`), in base al `render_type` codificato nel buffer dati dei cavi
- Loop `requestAnimationFrame` integrato con tracciamento FPS (aggiornato una volta al secondo)
- Disegna indicatori del raggio di interazione mouse/puntatore (cerchi tratteggiati) alla posizione corrente del mouse
- Mentre è attivo ascolta gli eventi del puntatore sul document (rimossi da `stop()`) e passa alla fisica la posizione del mouse in coordinate del mondo, tramite lo stesso `clientToWorld` consapevole dello zoom usato ovunque (`PointerTracker`, `src/renderer/pointer.ts`). Quando nessun puntatore è sopra la superficie (è uscito dalla superficie o dalla finestra, o un tocco è finito) il mouse del motore viene parcheggiato fuori portata (`World.releaseMouse`), perché il motore lo applica a ogni cavo a ogni passo
- `render()` è idempotente (una seconda chiamata non avvia un secondo loop) e può essere richiamato dopo `stop()`
- HiDPI: il backing store del canvas è `devicePixelRatio` volte la sua dimensione CSS (vedi `sizeCanvasToHost`), e il renderer scala il disegno di conseguenza
- `options.surface`: vedi [Zoom, pan e più mondi](./06-zoom-multiworld.md) — il canvas vive su un elemento non trasformato e il renderer applica da sé lo zoom registrato, così i cavi non vengono mai tagliati al box del container
- Fa avanzare la fisica con `world.advance(elapsed)` ad ogni frame: un numero fisso di passi al secondo (`getStepRate()`, default 60) qualunque sia la frequenza dello schermo, così i cavi si muovono alla stessa velocità a 60, 120 o 144 Hz. Le pause lunghe (una scheda in background) non vengono recuperate. Chi usa il loop di `Renderer.render()` **non** dovrebbe chiamare anche `Cavi.update()`/`World.update()` ad ogni frame
- `setDebugDrawNodes(true)` (opzione globale, default `false`) attiva un overlay di debug che disegna la circonferenza di ogni nodo di ogni cavo (letta direttamente da WASM, non dal parsing del buffer path) alla sua posizione fisica reale, con raggio pari a `Wire.getRadius()` — utile per verificare la posizione dei nodi indipendentemente dal path renderizzato (segmenti/Bezier)

## `IRenderer` (`src/core/types.ts`)

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

## `IInteractionController` (`src/core/types.ts`)

```typescript
interface IInteractionController {
  attach: (cavi: Cavi) => void;
  detach: () => void;
}
```

Contratto per qualunque cosa gestisca l'interazione utente (drag, click, touch...) con `Jack`/`Plug` — pluggabile allo stesso modo di `IRenderer`. Vedi [Componenti Jack & Plug](./05-jack-plug.md#interazione-standardinteractioncontroller-e-cavi-interaction) per le implementazioni standard (`StandardInteractionController` per il puntatore, `KeyboardInteractionController` per la tastiera) e per come `<cavi-interaction>` ne collega una lista (`controllers`, `no-keyboard`).

## `SvgRenderer` (`src/renderer/renderer-svg.ts`)

Un'alternativa a `Renderer` che implementa lo stesso `IRenderer`: ogni cavo è un `<path>` SVG, mantenuto da un frame all'altro e riscritto solo quando il cavo si è mosso o è cambiato. Crea il proprio `<svg>` dentro il container (o usa `options.svg`), e supporta `options.surface` come `Renderer` (vedi [Zoom, pan e più mondi](./06-zoom-multiworld.md)). `<cavi-world>` usa sempre il `Renderer` su canvas, quindi `SvgRenderer` si collega a mano (vedi `examples/main-svg.ts`).

```typescript
constructor(container: HTMLElement, world: World, options?: RendererOptions & { svg?: SVGSVGElement })
```

## `<cavi-debug>` (`src/debug/debugwc.ts`)

Un pannello di debug per qualunque mondo della pagina: statistiche dal vivo, il log degli eventi e gli interruttori degli overlay di debug. Vedi [Debug ed eventi](./07-debug.md).

Le demo `demo-basic.html` e `demo-svg.html` usano un loro pannello di controllo, `<cavi-controls>` (`examples/controls.ts`). È codice d'esempio, non fa parte della libreria.

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

## Attributi di `<cavi-world>`

Gli attributi di impostazione sono live: cambiarne uno dopo lo applica al mondo in esecuzione, e toglierlo ripristina il default.

| Attributo                | Default       | Descrizione                                                                                                |
| ------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `gravity-x`, `gravity-y` | `0`, `5`      | Accelerazione globale                                                                                      |
| `step-rate`              | `60`          | Passi fisici al secondo, qualunque sia la frequenza dello schermo                                          |
| `sleep`                  | attivo        | `off` continua a simulare i cavi fermi invece di addormentarli                                             |
| `orphan-cleanup`         | attivo        | `off` tiene i cavi senza capi fissi anche fuori vista                                                      |
| `cable-drop-behavior`    | `detach`      | Un cavo nuovo lasciato nel vuoto: `detach` (cade), `dangle` (resta sul suo jack), `cancel` (viene rimosso) |
| `plug-spread-mode`       | `towardOther` | Come si aprono i plug di un jack in hover: `towardOther` o `radial`                                        |
| `plug-spread-radius`     | `1.8`         | Quanto si aprono, in mezze dimensioni del jack                                                             |
| `plug-spread-timeout`    | `500`         | Ms prima che si richiudano quando il puntatore se ne va                                                    |
| `debug-nodes`            | assente       | Disegna tutti i nodi e i raggi del puntatore                                                               |
| `wire-shadows`           | assente       | Ombra morbida sotto ogni cavo (renderer canvas)                                                            |

Letti solo quando il mondo viene creato:

| Attributo               | Descrizione                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `surface="<selettore>"` | Un antenato non trasformato su cui disegnare, per pan/zoom — vedi [Zoom, pan e più mondi](./06-zoom-multiworld.md) |
| `canvas="<selettore>"`  | Un canvas proprio su cui disegnare                                                                                 |
| `no-interaction`        | Nessun `<cavi-interaction>` di default: niente reagisce a puntatore o tastiera finché non aggiungi un controller   |

## Attributi di `<cavi-wire>`

Tutti live: cambiarne uno aggiorna il cavo in esecuzione.

| Attributo     | Default   | Descrizione                                                                                                                    |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `length`      | `10`      | Numero di nodi (cambiarlo ridistribuisce i nodi tra i due capi)                                                                |
| `tension`     | `20`      | Distanza a riposo tra nodi vicini                                                                                              |
| `size`        | `5`       | Raggio (metà dello spessore)                                                                                                   |
| `color`       | `#ffffff` | Colore                                                                                                                         |
| `type`        | `''`      | Tipo di connessione, dato ai suoi plug; vuoto fa da jolly                                                                      |
| `render-type` | bezier    | `segments` per segmenti dritti (la vecchia grafia `renderType` funziona ancora)                                                |
| `bend`        | `0`       | Rigidità alla flessione, da 0 a 1 (vedi `Wire.setBendStiffness`): più alta, il cavo si curva invece di pendere come una catena |

`id` non è live ma c'è sempre: un `<cavi-wire>` che non ce l'ha ne riceve uno generato alla connessione (vedi [Salvare e ripristinare i cavi](#salvare-e-ripristinare-i-cavi)).

## Salvare e ripristinare i cavi

`captureCables(cavi)` e `applyCables(cavi, snapshot)` (`src/component/cables.ts`) leggono i cavi di un mondo come dati semplici e li rimettono a posto. I dati si possono passare a `JSON.stringify`, per salvare una configurazione o tenere una history di annullamento:

```json
{
  "version": 1,
  "wires": [
    { "id": "w-3", "ends": ["out-1", "in-4"], "type": "audio", "color": "#ffaa00", "length": 14 },
    { "id": "w-4", "ends": ["out-2", null], "type": "audio", "length": 9 }
  ]
}
```

- **Cosa viene salvato:** per ogni `<cavi-wire>` nel container del mondo, il suo `id`, gli id dei jack in cui sono collegati il primo e l'ultimo nodo (`null` per un capo libero), e gli attributi impostati tra `type`, `color`, `length`, `tension`, `size` e `render-type` (come `renderType`). Lo stato fisico non viene salvato: un cavo ripristinato parte dritto tra i suoi jack e si assesta da solo.
- **Cosa resta fuori:** un cavo non collegato a niente (sta cadendo via, vedi l'eliminazione dei cavi orfani), e un capo in un jack senza `id`, che non si potrebbe ritrovare. Un capo in un jack rimosso dalla pagina conta già come libero, anche prima che il jack rilasci i suoi plug.
- **I jack non vengono salvati.** Appartengono alla pagina: vanno rimessi prima, con gli stessi id. Un capo il cui jack non è nella pagina resta libero; un cavo senza nessuno dei due jack non viene ripristinato.
- **`applyCables` tocca solo ciò che è diverso**, cavo per cavo, per `id`: un cavo che il mondo ha e lo snapshot no viene cancellato (`CaviWireElement.delete()`, così i suoi jack si liberano subito); uno che hanno entrambi mantiene il suo stato fisico, aggiorna gli attributi e sposta solo i capi che hanno cambiato jack (`Plug.disconnect`/`connect`); uno che manca viene creato nel container. Ogni capo che lascia un jack viene staccato prima che si colleghi qualunque cosa, così i cavi possono scambiarsi jack a `max-plugs`. Un capo che non si può collegare (jack pieno, tipo sbagliato) resta libero, con un `console.warn`.
- Lancia un errore per uno snapshot che non sia di versione 1, e per un `Cavi` senza container del renderer. Va chiamata tra un gesto e l'altro: un plug che si sta trascinando resta dov'è.

```ts
const cavi = worldEl.getCavi()!;
localStorage.setItem('cables', JSON.stringify(captureCables(cavi)));
// più tardi, una volta che i jack sono di nuovo nella pagina:
applyCables(cavi, JSON.parse(localStorage.getItem('cables')!));
```

## Annullare e ripristinare: `CaviHistory`

`CaviHistory` (`src/component/history.ts`) tiene i passi di annullamento/ripristino di un mondo. Ogni passo (`HistoryEntry`) è lo stato dei cavi come lo legge `captureCables` più, facoltativamente, lo stato della pagina:

```ts
const history = new CaviHistory(worldEl.getCavi()!, {
  // facoltativo: ciò che cavijs non possiede e da cui dipendono i cavi
  app: {
    capture: () => app.getModules(), // serializzabile in JSON
    restore: async (modules) => app.setModules(modules), // jack rimessi, stessi id
  },
  limit: 100, // passi di annullamento conservati al massimo (default)
});

history.commit(); // dopo una modifica fatta dalla pagina
history.batch(() => app.removeModule(m)); // più modifiche, un solo passo
await history.undo();
await history.redo();
history.canUndo; // e canRedo
history.addEventListener('change', updateButtons);
localStorage.setItem('state', JSON.stringify(history.capture()));
await history.load(JSON.parse(localStorage.getItem('state')!));
```

- **Quando si registra un passo:** alla fine di ogni gesto dell'utente sui cavi (`cavi-change`), da solo, e ogni volta che la pagina chiama `commit()`. Mai due volte lo stesso stato: un gesto che non ha cambiato niente (un plug rimesso dov'era) non registra nulla. I cavi vengono confrontati indipendentemente dal loro ordine nella pagina. Il passo di un gesto viene registrato un microtask dopo `cavi-change`, quando nel mondo non c'è più nessun altro gesto in corso (`Jack.isDragActive`): con due dita, il passo è lo stato che lasciano entrambi.
- **Undo, redo e load rimettono uno stato in ordine:** prima `app.restore`, atteso, poi `applyCables`, che tocca solo i cavi diversi — così i cavi trovano i loro jack nella pagina. Una modifica non ancora registrata viene registrata prima, così è quella che `undo()` annulla. Una volta rimesso uno stato, la sua voce diventa ciò che il ripristino ha lasciato nella pagina (lo stato della pagina riletto, un capo il cui jack non è tornato come libero), così quella differenza non conta mai come un passo nuovo.
- **Rifiutano (risolvono a `false`) mentre è in corso un gesto** nel mondo: quello è del controller, Escape lo annulla. Le chiamate girano una dopo l'altra, quindi premere Ctrl+Z tre volte di fila annulla tre passi.
- **Lo stato della pagina viene salvato come JSON:** modifiche successive all'oggetto restituito da `capture` non arrivano alla history, e `restore` riceve sempre una copia nuova.
- **`batch(fn)`** registra tutto ciò che fa `fn` come un solo passo, assorbendo le chiamate a `commit()` e i gesti che finiscono nel frattempo; per un `fn` che restituisce una promise restituisce una promise e registra quando si conclude. Il caso tipico è la rimozione di un modulo: i suoi jack spariscono e i capi dei cavi collegati vengono lasciati andare — `captureCables` conta già come libero un capo in un jack rimosso.
- **`load(entry)`** rimette uno stato ottenuto da `capture()` — salvato prima, magari in un'altra visita — come un passo nuovo, annullabile come gli altri. **`clear()`** dimentica tutti i passi; **`destroy()`** smette di ascoltare il mondo.
- **`change`** (un semplice `Event`) viene emesso ogni volta che `canUndo`/`canRedo` possono essere cambiati.

Va creata quando il mondo è pronto (`caviready`): lo stato in quel momento è il primo passo. `examples/demo-d3-interaction.ts` (`bindHistory`) la usa con le posizioni delle unità come stato della pagina, Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z, e i pulsanti Save/Load.

## `Jack` / `Plug`

Vedi [Componenti Jack & Plug](./05-jack-plug.md).
