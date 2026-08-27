jack e plug

la classe jack e plug sono le classi che definiscono entrate e uscite alla quale poi si collegano i cavi.
La classe plug modella i nodi terminale di un cavo, la classe jack un elemento fisso alla quale il plug può collegarsi. Il tutto per modellare delle connessioni come gli archi di collegamento in un diagramma.

plug.

La classe plug rappresenta un elemento terminale di un cavo e ha le seguenti proprietà:
- ha un identificatore di tipo stringa
- è un elemento html di tipo div
- è un web component dove l'utente può specificare eventualmente un template ma seguendo delle regole, per esempio la struttura e le classi da assegnare
- è un elemento draggabile che può essere ancorato con un effetto "calamita" ad un elemento di tipo jack. Per effetto calamita intendo che se l'elemento viene draggato sopra un elemento di tipo jack esso ne prende la posizione dell'area di drop.
- è un elemento che ha la possibilità di interagire con world per rappresentare un terminale di un cavo, o più in generale un Node di Wire. Al drag dell'elemento esso setta la posizione del Node e se droppato dentro un jack esso ne rimane agganciato in modo fisso. Se plug non viene agganciato ad un jack esso setta il nodo come unfixed, e il cavo rimarrà penzoloni, con la possibilità di riagganciarlo successivamente.

jack.

La classe jack è un elemento con le seguenti proprietà:
- ha un identificatore di tipo stringa.
- è un elemento HTML di tipo div
- è un web component che dove l'utente può specificare eventualmente un template ma seguendo delle regole, per esempio la struttura e le classi da assegnare
- definisce la possibilità di riceve gli elementi plug come in drop
- jack può avere molti plug su di sé

In generare le aree di drag e drop di jack e plug hanno la stessa forma, per esempio due cerchi, e quando droppo un plug in un jack esso ne rimane agganciato. Per esempio quando prendo un plug e lo trascino dentro un jack, plug prende le coordinate di jack, per esempio due cerchi concetrici che si sovrappongono.

Plug dovrà essere sempre spostato quindi sensa avere elementi sopra che vanno in conflitto con altri elementi della dom, in particolare jack starà sempre "sotto" plug e sopra il canvas, anche a livello di render. 