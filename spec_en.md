jack and plug

The jack and plug classes define the inputs and outputs to which cables are connected.
The plug class models the terminal nodes of a cable, while the jack class is a fixed element to which the plug can connect. This is used to model connections like the linking arcs in a diagram.

plug.

The plug class represents a terminal element of a cable and has the following properties:
- It has a string identifier
- It is an HTML element of type div
- It is a web component where the user can optionally specify a template, but following certain rules, for example the structure and the classes to assign
- It is a draggable element that can be anchored with a "magnet" effect to an element of type jack. By magnet effect, I mean that if the element is dragged over a jack element, it takes the position of the drop area.
- It is an element that can interact with world to represent a cable terminal, or more generally a Node of Wire. When the element is dragged, it sets the position of the Node, and if dropped inside a jack, it remains fixedly attached. If the plug is not attached to a jack, it sets the node as unfixed, and the cable will hang, with the possibility of reattaching it later.

jack.

The jack class is an element with the following properties:
- It has a string identifier
- It is an HTML element of type div
- It is a web component where the user can optionally specify a template, but following certain rules, for example the structure and the classes to assign
- It defines the possibility to receive plug elements as drops
- A jack can have many plugs attached to it

In general, the drag and drop areas of jack and plug have the same shape, for example two circles, and when a plug is dropped into a jack, it remains attached. For example, when you take a plug and drag it into a jack, the plug takes the coordinates of the jack, for example two concentric circles that overlap.

Plug must always be moved without having elements above it that conflict with other DOM elements; in particular, jack will always be "under" plug and above the canvas, also at the rendering level.
