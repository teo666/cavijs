# Cavijs — Componenti Jack & Plug

`Jack` (`<cavi-jack>`) e `Plug` (`<cavi-plug>`) modellano punti di connessione e terminali di cavo — ad esempio per diagrammi dove i cavi ("wires", vedi `<cavi-wire>`) si collegano a prese fisse, con una regola di compatibilità basata su un singolo tipo stringa (es. `"audio"`, `"midi"`, `"scsi"`).

> Questa funzionalità è più recente rispetto all'API principale `Cavi`/`World`/`Wire` ed è in evoluzione — considerare i dettagli qui come un'istantanea di `src/jack.ts` / `src/plug.ts` / `src/wirewc.ts` così come attualmente implementati.

## Concetto

- **`Plug`** modella il nodo terminale di un cavo (l'estremità trascinabile di un `<cavi-wire>`). Per ora un plug rappresenta sempre uno dei **due nodi terminali** del cavo (indice `0` o `nodeCount - 1`); i nodi intermedi non sono ancora supportati.
- **`Jack`** modella una presa fissa a cui un plug può collegarsi, con un proprio `type` stringa.
- **`<cavi-wire>`** (il "Cable") possiede il proprio `type`, che viene propagato automaticamente a tutti i suoi `<cavi-plug>` figli — un plug non ha un tipo indipendente impostabile via markup.
- Una connessione plug→jack è permessa se e solo se `plug.type === jack.type` (uguaglianza semplice; un jack senza `type` configurato non accetta nessuna connessione).
- Trascinare un `Plug` sopra un `Jack` compatibile lo aggancia in posizione (effetto "calamita"); durante l'avvicinamento, sia il jack candidato sia il plug ricevono una classe CSS configurabile per l'anteprima visiva (es. blur/glow), non solo al momento del rilascio. Rilasciare altrove lascia il nodo del cavo sottostante non fissato di default: il cavo rimane penzoloni liberamente e può essere riagganciato successivamente — a meno che il plug non abbia l'attributo `freeze-on-drop`, nel qual caso resta fissato esattamente dove è stato rilasciato, sempre riafferrabile con un click/tap normale invece di dover inseguire un bersaglio in movimento.
- Entrambi sono Web Component che accettano contenuto template opzionale fornito dall'utente (con struttura/classi attese).
- Ordine Z: `Plug` deve sempre essere renderizzato sopra `Jack`, che a sua volta è sopra il canvas — così il plug non è mai occluso durante il trascinamento.
- Il drag-and-drop funziona sia con mouse sia con touch/penna tramite Pointer Events unificati.

## `Jack` (`src/jack.ts`)

Un custom element (`cavi-jack`) con Shadow DOM.

**Attributi osservati**
| Attributo | Effetto |
|---|---|
| `color` | Colore di riempimento del punto visivo del jack |
| `x`, `y` | Posizione assoluta (`style.left`/`style.top`, traslata -50%/-50% per centrare sulla coordinata) |
| `type` | Stringa di tipo (es. `"audio"`) — un plug può agganciarsi solo se il proprio `type` è identico |
| `max-plugs` | Numero massimo di plug agganciabili contemporaneamente (default illimitato) |
| `magnet-class` | Nome della classe CSS applicata all'host quando un plug compatibile è in prossimità durante il trascinamento (default `cavi-magnet-target`) |
| `full-class` | Nome della classe CSS applicata all'host quando il jack ha raggiunto `max-plugs` **e** il cursore è vicino **e** Shift è premuto (default `cavi-jack-full`) — vedi sotto |
| `cable-tension`, `cable-size`, `cable-color` | Valori opzionali di tensione/raggio/colore applicati al cavo creato trascinando da questo jack (vedi sotto); se omessi, il cavo usa i default fissi di `<cavi-wire>` |

**API**
| Metodo | Descrizione |
|---|---|
| `canAccept(type: string) -> boolean` | Ritorna true se `type` è uguale al `type` del jack (e il jack ne ha uno configurato) |
| `canAcceptMore() -> boolean` | Ritorna true se il jack non ha raggiunto `max-plugs` |
| `attach(plug: Plug)` / `detach(plug: Plug)` | Registra/rimuove un plug collegato (aggiorna `plugCount`) |
| `plugCount` | Numero di plug attualmente collegati |
| `getCenter() -> { x, y }` | Punto centrale in coordinate viewport (`getBoundingClientRect`) |
| `type` (getter) | Il `type` corrente del jack |
| `setMagnetActive(active: boolean)` | Attiva/disattiva la classe `magnet-class` sull'host, usata per l'anteprima calamita durante il drag |

Di default renderizza un piccolo cerchio scuro (`.inner`); se l'elemento ha contenuto figlio, renderizza quello al suo posto (tramite `<slot>`), permettendo di personalizzare l'aspetto mantenendo la stessa semantica di drop-target.

L'host ha una dimensione esplicita `24×24px` e riceve eventi pointer nativi (`pointer-events: auto`) — è ciò che gli permette di comportarsi come sorgente di drag per la creazione di un cavo (vedi sotto). L'hit-testing per l'aggancio di un `Plug` **esistente** su un jack resta invece interamente basato sulla distanza (`Plug._findSnapTarget()` tramite `Jack.registry`), non su eventi nativi del jack; gli eventi pointer propri del jack servono solo ad avviare un cavo **nuovo**.

## Creare un cavo trascinando da un Jack (`src/jack.ts`)

Oltre ad essere un drop target, `Jack` è anche una sorgente di drag: click destro, oppure click sinistro + <kbd>Shift</kbd>, su un jack con capacità residua (`canAcceptMore()`) crea immediatamente un nuovo `<cavi-wire>` — un `<cavi-plug>` viene subito agganciato a quel jack, l'altro segue il cursore.

- **Trigger**: `pointerdown` con `button === 2` (tasto destro) oppure `button === 0 && shiftKey`. Il menu contestuale nativo del jack viene sempre soppresso (`contextmenu` → `preventDefault()`), dato che il jack è sempre una possibile sorgente di drag col tasto destro. Un jack già a `max-plugs` ignora il gesto.
- **Costruzione del cavo**: crea un `<cavi-wire type="{jack.type}" length="4">` con due `<cavi-plug>` figli (`node="0"` / `node="3"`), inserito come sibling del jack (così condivide lo stesso `offsetParent`/spazio di coordinate già usato da Plug). Il nodo `0` viene subito posizionato al centro del jack, fissato e agganciato (`plugged`); il nodo `3` viene posizionato alla posizione iniziale del cursore. Tensione (`tension`), raggio (`size`) e colore (`color`) del nuovo `<cavi-wire>` vengono copiati dagli attributi `cable-tension`/`cable-size`/`cable-color` del jack di origine, se presenti; per ogni attributo omesso resta il default fisso a cui `<cavi-wire>` ricade normalmente (tipo di render escluso: sempre bezier di default, salvo `renderType="segments"` sul cavo — non c'è un equivalente `cable-render-type`).
- **Crescita durante il drag**: ad ogni `pointermove`, la posizione del nodo libero segue il cursore e il numero di nodi cresce con la distanza dal jack di origine — `4 + floor(distanza / 30)`, con un tetto di `60`. **Il cavo cresce soltanto durante il drag, non si accorcia mai** quando il cursore si riavvicina — come tirare un cavo fuori dallo schermo: una volta uscito, resta fuori fino al rilascio. Un passo di crescita chiama il nuovo `Wire.setNodeCount()` (vedi [`Wire` nel riferimento API](./03-api.md#wire)) e ri-aggancia il `Plug` libero al nuovo ultimo nodo, dato che il resize sposta l'indice del terminale.
- **Anteprima calamita**: stessa identica meccanica del drag di `Plug` — stessa soglia di aggancio di `20`px, stesso toggling continuo dell'evidenziazione (`setMagnetActive`) sia sul jack candidato sia sul plug libero mentre è in prossimità, calcolato con la stessa scansione di `Jack.registry` (escludendo il jack di origine stesso, così un cavo non può riagganciarsi alla propria sorgente).
- **Al rilascio**: se un jack compatibile è in prossimità, il plug libero si aggancia esattamente come un normale rilascio di `Plug` (`fixed = true`, `attach()`, `plugged`). Altrimenti il cavo resta agganciato all'origine con il capo libero lasciato pendente — `node.fixed = false`, identico a un `Plug` normale rilasciato lontano da ogni jack oggi (libero di muoversi sotto la fisica, e già completamente ri-trascinabile da solo dato che è un vero `<cavi-plug>`). Un `pointercancel` viene trattato come un rilascio a vuoto.
- **Un jack pieno mostra un cursore "vietato"**: tenendo premuto Shift, se il cursore si trova entro `20`px dal centro di un jack che ha raggiunto `max-plugs` (`!canAcceptMore()`), l'host riceve `cursor: not-allowed` (stile inline, vince sempre sulla regola `:host { cursor: crosshair }`) e la classe `full-class`. Vale già al semplice hover, anche prima di iniziare un drag. Il rilevamento è basato sulla distanza dall'ultima posizione nota del puntatore (un unico listener `pointermove` su `document`, condiviso da tutti i jack), **non** su `pointerenter`/`pointerleave` nativi sul jack: un jack con almeno un plug agganciato ha quel `<cavi-plug>` posizionato esattamente al suo centro con `z-index` più alto, quindi lo occlude e impedirebbe agli eventi di hover nativi di raggiungerlo mai. Lo stato si aggiorna anche senza muovere il cursore quando il jack si riempie/libera (`attach`/`detach`) mentre è già sotto osservazione.
- **Mentre Shift è premuto, i plug dei cavi già esistenti non si spostano**: `Plug.handlePointerDown` ignora ogni `pointerdown` con `shiftKey` attivo, dato che Shift è riservato all'avvio di un nuovo cavo — vedi la sezione `Plug` sotto.

## `Plug` (`src/plug.ts`)

Un custom element (`cavi-plug`) con Shadow DOM, trascinabile tramite **Pointer Events** (mouse, touch e penna con lo stesso codice).

**Attributi osservati**
| Attributo | Effetto |
|---|---|
| `plugged` | Attiva/disattiva lo stile visivo "connesso" (impostato/rimosso all'aggancio/sgancio) |
| `magnet-class` | Nome della classe CSS applicata all'host quando il plug è in prossimità di un jack compatibile durante il trascinamento (default `cavi-magnet-active`) |
| `freeze-on-drop` | Attributo booleano basato su presenza (come `plugged`). Se presente, un rilascio lontano da ogni jack compatibile lascia il nodo fisico **fissato** (`node.fixed = true`) invece che libero — il plug resta fermo sul punto di rilascio anziché oscillare sotto gravità/tensione, restando sempre riafferrabile con un click/tap. Default assente (comportamento invariato: nodo libero). Si applica sia al rilascio normale sia a un `pointercancel` |

`type` **non** è un attributo del plug: viene ricevuto esclusivamente tramite `setType(type)`, chiamato dal `<cavi-wire>` genitore in base al proprio attributo `type`.

**API**
| Metodo | Descrizione |
|---|---|
| `setNode(node: Node)` | Collega visivamente il plug a un nodo fisico del cavo |
| `setType(type: string)` | Imposta il tipo di connessione del plug (propagato dal Cable, non impostabile da markup) |
| `attach(jack: Jack)` / `detach()` | Collega/scollega il plug da un jack, passando dallo stesso registro `attach`/`detach` del jack (usato sia dal drag sia dal binding dichiarativo di `<cavi-wire>`) |
| `setMagnetActive(active: boolean)` | Attiva/disattiva la classe `magnet-class` sull'host |

**Comportamento**
1. `setNode(node: Node)` collega visivamente il plug a un'istanza `Node` (proveniente da un `Wire`); `updatePosition()` lo mantiene sincronizzato con `x`/`y` del nodo a meno che non sia in corso un trascinamento.
2. Al `pointerdown` (tasto primario, **senza** Shift premuto — Shift è riservato all'avvio di un nuovo cavo da un `Jack`, vedi sopra, e un `pointerdown` con `shiftKey` attivo su un plug non fa nulla): avvia il trascinamento, sgancia subito il plug da un eventuale jack corrente, fissa il nodo sottostante (`node.fixed = true`), tenta `setPointerCapture` (con feature-detection: non tutti gli ambienti la supportano — vedi nota jsdom sotto), registra i listener `pointermove`/`pointerup`/`pointercancel` su se stesso, aumenta lo `z-index`.
3. Ad ogni `pointermove` durante il trascinamento: calcola la posizione relativa a `offsetParent`, chiama `node.setPosition(x, y)` **e** `node.setMousePosition(x, y)` (quest'ultimo inoltra a `WasmWorld.set_mouse`, mantenendo la repulsione fisica sincronizzata col plug trascinato), aggiorna la propria posizione a schermo, e ricalcola il jack calamita candidato (`_findSnapTarget()`), attivando/disattivando le classi `magnet-class` su jack e plug di conseguenza — in modo continuo, non solo al rilascio.
4. Al `pointerup`: ricalcola il jack più vicino compatibile (tipo uguale e capacità disponibile) entro `_snapDistance` (default `20`px); se trovato, aggancia il nodo al centro del jack, chiama `attach(jack)` e imposta `plugged`; altrimenti chiama `detach()` e imposta `node.fixed` in base a `freeze-on-drop` (`true` se presente, altrimenti `false`), rimuovendo `plugged`.
5. Al `pointercancel` (es. gesto interrotto dal sistema, tipico su touch): stesso comportamento del rilascio "a vuoto" del punto 4, senza tentare alcuno snap.

**Note implementative**
- La ricerca dei jack avviene tramite il registro statico `Jack.registry`, non tramite query DOM.
- `z-index`: plug usa `20`, jack usa `10`, coerentemente col requisito "jack sotto plug" della spec.
- `touch-action: none` è impostato nello shadow DOM del plug per evitare che il browser intercetti lo scroll durante il trascinamento touch.
- **jsdom**: `setPointerCapture`/`releasePointerCapture` non sono implementati in jsdom (verificato con jsdom 30.x) — il codice fa feature-detection e degrada senza capture nativa; nei test si simula il drag dispatchando `PointerEvent` direttamente sul plug.

## `<cavi-wire>` — propagazione del `type` e nodi terminali (`src/wirewc.ts`)

- L'attributo `type` su `<cavi-wire>` viene letto una volta in fase di setup e propagato a ogni `<cavi-plug>` figlio tramite `plug.setType(type)`.
- Solo i `<cavi-plug node="...">` con indice `0` o `nodeCount - 1` (i due nodi terminali) vengono collegati; un indice intermedio produce un `console.warn` e il plug viene ignorato — i nodi intermedi non sono ancora supportati.
- Se un `<cavi-plug>` ha un attributo `jack="id"`, viene collegato dichiarativamente al jack corrispondente in fase di setup, passando dallo stesso `plug.attach(jack)` usato dal drag (così `jack.plugCount`/`max-plugs` restano corretti anche per le connessioni dichiarative). Se il `type` del jack non coincide con quello del cavo, viene emesso un `console.warn` ma la connessione viene comunque stabilita (il markup ha precedenza).

### Eliminazione automatica quando il cavo esce dal container (`auto-cleanup`)

Attributo booleano basato su presenza (come `plugged`/`freeze-on-drop`), **assente di default** — comportamento invariato finché non lo si imposta esplicitamente, dato che è un'azione irreversibile (libera anche la memoria WASM del cavo).

Quando presente, ad ogni frame del loop `requestAnimationFrame` già usato da `CaviWireElement` per sincronizzare i plug, viene eseguito un controllo sincrono (`_cleanupIfOutsideContainer()`, facilmente rintracciabile via grep) che verifica, tramite `getBoundingClientRect()`, se **tutti** i plug del cavo non si sovrappongono più al container passato a `new Renderer(container, world)` (esposto come `Cavi.getContainer()`/`Renderer.getContainer()` — vedi [riferimento API](./03-api.md#renderer)). Se sì, il cavo viene distrutto (`_destroy()`): il suo `Wire` viene cancellato (`cavi.deleteWire(index)`, liberando la memoria WASM) e l'elemento viene rimosso dal DOM — la rimozione fa scattare automaticamente `disconnectedCallback` su ogni `<cavi-plug>` figlio, che a sua volta chiama `detach()` (sganciandolo dal proprio Jack, se presente) e rimuove i propri listener di trascinamento.

Deliberatamente basato su un controllo sincrono per-frame anziché su `IntersectionObserver`: dato che il loop RAF esiste già per sincronizzare la posizione dei plug, un controllo bounding-box nello stesso tick è preciso al frame esatto e non rischia il ritardo/coalescing tipico di `IntersectionObserver` (specialmente con tab in background).

**Nota importante**: cancellare un cavo che non è l'ultimo creato sposta gli indici WASM di tutti i cavi successivi (`World.deleteWire`, vedi [riferimento API](./03-api.md#world)). `CaviWireElement` mantiene un proprio registro statico di tutti i `<cavi-wire>` connessi e, subito dopo ogni cancellazione, ri-aggancia (`_rebindAfterIndexShift`) ogni cavo sopravvissuto il cui indice si è spostato al `Wire` fresco corretto — senza questo passaggio, gli altri cavi continuerebbero silenziosamente a leggere/scrivere il cavo sbagliato. Non copre invece un `Jack` che sta attivamente creando un nuovo cavo nello stesso istante in cui un *altro* cavo esce ed è auto-cleanup: un caso limite molto raro, non ancora gestito.

## Relazione col motore fisico

Né `Jack` né `Plug` comunicano direttamente con `WasmWorld` — passano sempre attraverso un'istanza `Node`, che inoltra i cambiamenti di posizione/stato-fisso al nodo WASM sottostante (vedi [`Node` nel riferimento API](./03-api.md#node)). Questo mantiene la UI dei connettori coerente col resto dell'architettura di `cavijs` (la fisica resta in WASM, il DOM/interazione resta in TS).
