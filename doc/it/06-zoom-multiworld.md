# Zoom, pan e più mondi

## Pan/zoom

cavijs non implementa pan/zoom: la pagina applica una trasformazione CSS (es. con d3-zoom) a un contenitore attorno a `<cavi-world>` e la comunica a cavijs tramite un **provider della trasformazione di coordinate**:

```typescript
worldEl.setCoordinateTransform(() => ({ scale: t.k, translateX: t.x, translateY: t.y }));
```

(`Cavi.setCoordinateTransformProvider` in un setup manuale.) Ogni posizione del puntatore e ogni jack posizionato via CSS viene riconvertito in coordinate del mondo attraverso di esso (`clientToWorld` in `src/core/coords.ts`), così la fisica non vede mai valori scalati dallo zoom. Il provider viene letto ad ogni frame, e anche i jack posizionati via CSS vengono rimisurati ad ogni frame, quindi dopo un passo di zoom/pan non serve chiamare altro. `notifyCoordinateTransformChanged()` invia ancora `cavi-transform-change` sul mondo, per il codice della pagina che vuole reagire. Si può chiamare `setCoordinateTransform` anche prima che il mondo sia pronto: il provider viene applicato appena lo è.

### La superficie di disegno (`surface`)

Di default il canvas (o l'svg) vive dentro il container del mondo e viene scalato via CSS insieme a lui. Questo ha due difetti:

- **clipping**: il canvas è grande quanto il container, quindi facendo zoom out i cavi che escono dal suo box spariscono;
- **sfocatura**: facendo zoom in si ingrandisce una bitmap a risoluzione fissa.

Dai al mondo una **superficie** — un elemento _fuori_ dal sottoalbero trasformato, tipicamente il riquadro fisso su cui ascolta lo zoom:

```html
<div id="zoomFrame">
  <!-- non trasformato; d3-zoom ascolta qui -->
  <div id="viewport">
    <!-- trasformato da d3-zoom -->
    <cavi-world surface="#zoomFrame"> ... </cavi-world>
  </div>
</div>
```

oppure, con un renderer creato a mano:

```typescript
new Renderer(container, world, { surface: frame });
new SvgRenderer(container, world, { surface: frame });
```

Il canvas/svg viene messo nella superficie e dimensionato su di essa (a risoluzione `devicePixelRatio` per il canvas), e a ogni frame il renderer mappa le coordinate del mondo tramite la trasformazione registrata e l'origine a schermo del container. I cavi restano visibili ovunque vadano e nitidi a qualunque zoom.

Note:

- La superficie deve essere posizionata; `<cavi-world>` le imposta `position: relative` se è `static`.
- I cavi sono disegnati _sotto_ il contenuto del mondo, così jack e plug restano sopra. Il contenuto del mondo quindi non deve avere uno sfondo opaco — metti lo sfondo sulla superficie.
- La pulizia dei cavi orfani considera un cavo sparito solo quando è uscito sia dal container sia dalla superficie. Con gravità 0, dove un cavo lasciato resta fermo dove l'hai mollato, valuta `<cavi-world orphan-cleanup="off">`, così fare pan altrove non lo elimina mai.

Vedi `examples/demo-patchbay-zoom.html` (canvas) e `examples/demo-patchbay-zoom-svg.html` (SVG).

## Usare un canvas (o svg) proprio

`<cavi-world>` crea un canvas solo se non gliene viene dato uno. Per disegnare in uno tuo — per esempio **sopra** jack e plug — indicalo con l'attributo `canvas` (qualsiasi selettore CSS), oppure assegnalo alla proprietà `.canvas` prima che l'elemento venga collegato:

```html
<cavi-world surface="#zoomFrame" canvas="#cables"> ... </cavi-world>
<canvas
  id="cables"
  style="position: absolute; top: 0; left: 0; z-index: 30; pointer-events: none"
></canvas>
```

Con un renderer creato a mano: `new Renderer(container, world, { canvas })` / `new SvgRenderer(container, world, { svg })`.

Il canvas può stare in qualsiasi punto della pagina: a ogni frame il renderer ne misura la posizione a schermo (e la scala, se sta dentro un elemento zoomato) e allinea il disegno al mondo. `<cavi-world>` ne mantiene solo la dimensione allineata al mondo (o alla sua superficie) e non rimuove mai un canvas che non ha creato lui.

Note sulla sovrapposizione:

- `pointer-events: none` è obbligatorio, altrimenti il canvas intercetta i click destinati a jack e plug.
- I jack hanno `z-index` 10, i plug 20, un plug trascinato 1000 — scegli il valore adatto (con 30 i cavi coprono jack e plug ma non un plug mentre lo trascini).
- `z-index` conta solo dentro lo stesso contesto di sovrapposizione: un canvas dentro un elemento con `transform` (es. un modulo trascinabile) non può salire sopra i plug che stanno fuori.

## Più mondi nella stessa pagina

Ogni Jack, Plug, Wire e controller di interazione risolve l'istanza `Cavi` a cui appartiene con `Cavi.for(element)`: quella il cui container del renderer (registrato da `Cavi.setRenderer`) è l'elemento o il suo antenato più vicino. Così più `<cavi-world>` possono coesistere:

- ogni mondo ha la propria fisica, trasformazione di coordinate e impostazioni;
- un cavo non si aggancia mai a un jack di un altro mondo, e `<cavi-plug jack="id">` viene risolto tra i jack del suo mondo, così i mondi possono riusare gli stessi id, anche dentro gli shadow root;
- il `<cavi-interaction>` di ogni mondo gestisce solo gli eventi sui propri elementi e ha il suo stato di puntatore e di drag (`Jack.setPointerHoverPosition`/`setDragActive` ricevono il mondo): un drag in un mondo non cambia mai l'aspetto dei jack di un altro, e un movimento del puntatore misura solo i jack del suo mondo;
- un solo controller di interazione per mondo: un secondo `<cavi-interaction>` per lo stesso mondo resta inattivo (con un avviso), e `<cavi-world>` aggiunge il suo di default solo se il mondo non ne ha già uno, nemmeno messo altrove nella pagina. `<cavi-world no-interaction>` non ne aggiunge nessuno;
- `caviready` viene emesso sul `<cavi-world>` stesso (e risale fino a `document`), e `Cavi.whenReady(el, fn)` aspetta il mondo dell'elemento, trovato anche attraverso gli shadow root, ignorando gli altri mondi che diventano pronti.

Vedi `examples/demo-two-worlds.html`: lo stesso pannello due volte, il secondo dentro uno shadow root, con gli stessi id dei jack.

`Cavi.shared` esiste ancora — punta all'ultimo mondo inizializzato ed è il ripiego per gli elementi fuori da qualunque container registrato (pagine a mondo singolo con setup manuale, test). Un `<cavi-world>` rimosso dalla pagina smonta il suo mondo (vedi [Smontare un mondo](./03-api.md#smontare-un-mondo)), e questo azzera anche `Cavi.shared` se puntava lì.

## Usare cavijs come libreria

`pnpm build:lib` genera `dist-lib/cavijs.js` (modulo ES, con `cavi` esterno così il tuo bundler serve il suo `.wasm`) e le dichiarazioni di tipo in `dist-lib/types/`. `package.json` le espone tramite `exports`, quindi il pacchetto si può usare da un workspace o come dipendenza git; è ancora marcato `private`, quindi togli quel flag prima di pubblicarlo su npm.
