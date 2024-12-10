vi-window web component
=======================

This component adds a <vi-window> element that provides editing of text as
as in vi. <vi-window name="xxx"> can be used within a form, and by default
it will display its text contents, like a textarea.

```html
<vi-window rows="25" cols="80" name="text" id="viwin">
This text will be the initial content of the buffer.
</vi-window>
<script src="vi.js" type="module"></script>
<style>
vi-window {
    --background: white;
    --text: black;
}
</style>
<script>
document.getElementById('viwin').addEventListener('write', (ev) => {
    console.log(ev.detail.text);
});
</script>
```

It supports the POSIX vi commands except:
* Shell command (!)
* Edit alternate (CTRL-^)
* ex mode (Q)
* Redraw (CTRL-R); uses this for redo as in vim
* Redisplay (CTRL-L); uses this for cursor commands
* Z exit commands (useless)
* CTRL-N, CTRL-W, CTRL-T; these are captured by the browser
* The insert-mode CTRL commands
* Section motions ([[ / ]])

In addition, it includes extensions from vim or elsewhere:
* Visual character, line, and block modes with v/V/CTRL-V
* The + and * registers to access the system clipboard
* Macros recorded into registers with q and executed with @
* An undo and redo stack accessed through u and CTRL-R
* The * and # word-under-cursor searches
* Multiple simultaneous cursors with CTRL-L j/k/J/K or visual CTRL-L/I/A/C
* Mouse-click positioning of the cursor

Surrogate pairs in the text content are handled, and it has some ability
to display characters that are wider than one cell.

It has very limited ex commands, including substitute and range movements.
Unknown ex commands raise an "ex" event on the element, which can be
handled to implement further functionality. `:w`/`:write` do nothing, but
produce a "write" event. The regular-expression dialect supports only
literal characters, single . wildcards, and the \< and \> word-boundary
markers.

