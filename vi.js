// Copyright (C) 2024-2025 Michael Homer

class ViWindow extends HTMLElement {
    static formAssociated = true;
    static observedAttributes = ['rows', 'cols', 'value'];
    #buffer
    #view
    #shadowRoot
    #cells = []
    #mode = 'normal'
    #container
    #cursor
    #command;
    #elementInternals
    #rows = 25
    #cols = 80
    #lastPattern = null;
    #lastSubstitution = null;
    #lastSearchBackward = false;
    #lastChangeCommand = null;
    #macroRegister = null;
    constructor(config={}) {
        super();
        this.registers = {};
        for (let a of 'abcdefghijklnopqrstuvwxyz0123456789"') {
            this.registers[a] = {text: [], linewise: false};
        }
        this.#buffer = new ViBuffer(this.childNodes, this.registers);
        this.#view = new ViBufferView(this.#buffer, 0, this.#rows - 2);
        this.#cursor = this.#buffer.getCursor();
        this.#command = new ViCommand();
        this.#container = document.createElement('div');
        this.addEventListener('keydown', this.#onKeyDown.bind(this));
    }

    connectedCallback() {
        if (!this.#shadowRoot)
            this.#shadowRoot = this.attachShadow({mode:'open'});
        if (!this.#elementInternals)
            this.#elementInternals = this.attachInternals();
        this.#elementInternals.setFormValue(this.#buffer.toString());
        let link = document.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('href', new URL('./vi.css', import.meta.url).href);
        this.#shadowRoot.appendChild(link);
        let container = this.#container;
        container.classList.add('vi-window');
        this.#shadowRoot.appendChild(container);
        for (let y = 0; y < this.#rows; y++) {
            let row = [];
            this.#cells.push(row);
            for (let x = 0; x < this.#cols; x++) {
                let charSpan = document.createElement('span');
                charSpan.classList.add('vi-char');
                container.appendChild(charSpan);
                charSpan.style.gridRow = y + 1;
                charSpan.style.gridColumn = x + 1;
                row.push(charSpan);
                charSpan.addEventListener('click', (event) => {
                    this.#onClick(event, x + 1, y + 1);
                });
            }
        }

        this.#cells[0][0].textContent = '';
        this.#view.cellWidth = this.#cells[0][0].offsetWidth + 1;
        const updateCellWidth = () => {
            this.#view.cellWidth = this.#cells[0][0].offsetWidth + 1;
            this.redraw();
        }
        setTimeout(updateCellWidth, 0);
        setTimeout(updateCellWidth, 50);
        this.mode = 'normal';
        this.tabIndex = -1;
    }

    attributeChangedCallback(name, oldvalue, newvalue) {
        if (name == 'rows') {
            this.rows = newvalue|0;
        } else if (name == 'cols') {
            this.cols = newvalue|0;
        }
    }

    get cols() {
        return this.#cols;
    }

    set cols(val) {
        this.#cols = val;
        this.#view.cols = val;
        this.#recreate();
    }

    get rows() {
        return this.#rows;
    }

    set rows(val) {
        this.#rows = val;
        this.#view.rows = val - 2;
        this.#recreate();
    }

    get value() {
        return this.#buffer.toString();
    }

    set value(val) {
        this.#buffer.fromString(val);
        this.redraw();
    }

    get location() {
        return {line: this.#cursor.line, column: this.#cursor.column};
    }

    set location(loc) {
        this.#cursor.move(loc.line, loc.column);
        this.#view.ensureVisible(this.#cursor);
        this.redraw();
    }

    #recreate() {
        if (!this.#container)
            return;
        this.#cells.splice(0);
        let container = this.#container;
        this.#container.replaceChildren();
        for (let y = 0; y < this.#rows; y++) {
            let row = [];
            this.#cells.push(row);
            for (let x = 0; x < this.#cols; x++) {
                let charSpan = document.createElement('span');
                charSpan.classList.add('vi-char');
                container.appendChild(charSpan);
                charSpan.style.gridRow = y + 1;
                charSpan.style.gridColumn = x + 1;
                row.push(charSpan);
                charSpan.addEventListener('click', (event) => {
                    this.#onClick(event, x + 1, y + 1);
                });
            }
        }
        this.#view.cellWidth = this.#cells[0][0].offsetWidth + 1;
        this.redraw();
    }

    get mode() {
        return this.#mode;
    }

    set mode(value) {
        this.#elementInternals.states.clear();
        this.#elementInternals.states.add(value);
        this.#container.classList.remove('mode-' + this.#mode);
        this.#container.classList.add('mode-' + value);
        this.#mode = value;
        this.#cursor.mode = value;
    }

    exCommand(text) {
        let initText = text;
        let range = new ViRange(this.#buffer,
            {line: this.#cursor.line, column: this.#cursor.column},
            {line: this.#cursor.line, column: this.#cursor.column}, 'line');
        const rangePat = /^([1-9][0-9]*)(,([1-9][0-9]*|\$))?|^%/;
        let rangeResult = rangePat.exec(text);
        if (rangeResult) {
            if (rangeResult[0] == '%') {
                range = new ViRange(this.#buffer, {line: 1, column: 1},
                    {line: this.#buffer.lines.length, column: this.#buffer.lines.at(-1).length},
                    'line');
            } else {
                let start = parseInt(rangeResult[1]);
                let end = start;
                if (rangeResult[3]) {
                    end = rangeResult[3] == '$' ? this.#buffer.lines.length : parseInt(rangeResult[3]);
                }
                range = new ViRange(this.#buffer, {line: start, column: 1}, {line: end, column: 1}, 'line');
            }
            text = text.slice(rangeResult[0].length);
        }
        console.log(rangeResult, range, text)
        if (text.startsWith('/')) {
            this.#lastPattern = ViPattern.fromString(text.slice(1));
            this.#lastSearchBackward = false;
            this.#cursor.moveOperand({motion: 'search', pattern: this.#lastPattern});
        } else if (text.startsWith('s/')) {
            this.#lastSubstitution = text;
            let parts = text.split('/');
            let pattern = ViPattern.fromString(parts[1]);
            let options = parts[3] || '';
            console.log('moving to line', range.start.line, range.start.column, range);
            this.#cursor.move(range.start.line, 0);
            this.#buffer.makeCheckpoint();
            let searchRange = this.#cursor.operandRange({motion: 'search', pattern: pattern, character: '.'});
            let lastLine = -1;
            let lastColumn = -1;
            let repCount = 0;
            this.#cursor.mode = 'insert';
            while (searchRange && repCount < 1000) {
                repCount++;
                if (!range.contains(searchRange.start.line, searchRange.start.column)) {
                    break;
                }
                if (searchRange.start.line == lastLine && !options.includes('g')) {
                    searchRange = this.#cursor.operandRange({motion: 'search', pattern: pattern});
                    continue;
                }
                let startColumn = this.#cursor.column;
                lastLine = searchRange.start.line;
                let len = Math.abs(searchRange.end.column - searchRange.start.column);
                this.#cursor.move(searchRange.end.line, searchRange.end.column);
                this.#cursor.deleteOperand({motion: 'right', count: len + 1});
                for (let c of parts[2]) {
                    this.#cursor.insert(c);
                }
                lastColumn = searchRange.end.column;
                console.log(this.#cursor.column, startColumn);
                if (this.#cursor.column == startColumn
                        || searchRange.end.column + parts[2].length > this.#buffer.lines.at(searchRange.end.line - 1).length) {
                    // Reached end of line or trapped in cycle
                    this.#cursor.move(this.#cursor.line + 1, 1);
                }
                searchRange = this.#cursor.operandRange({motion: 'search', pattern: pattern, character: '.'});
            }
            this.#cursor.mode = 'normal';
        } else if (text == '' && range) {
            this.#cursor.move(range.end.line, range.end.column);
        } else if (text == 'w' || text == 'write') {
            let detail = {range: range, text: this.value}
            this.dispatchEvent(new CustomEvent('write', {detail, bubbles: true}));
            if (detail.message)
                this.#displayMessage(detail.message);
        } else {
            let detail = {range: range, command: text}
            if (this.dispatchEvent(new CustomEvent('ex', {detail, bubbles: true, cancelable: true})))
                this.#displayMessage('Unknown ex command: ' + initText);
            if (detail.message)
                this.#displayMessage(detail.message);
        }
    }

    runNormal(command) {
        if (command.operand.screenMotion) {
            command.mergeCounts();
            this.#view.setScreenMotion(command.operand);
        }
        if (command.operation == 'move') {
            command.mergeCounts();
            this.#cursor.moveOperand(command.operand);
            this.#view.ensureVisible(this.#cursor, !!command.operand.screenMotion);
        } else if (command.operation == 'ex') {
            this.exCommand(command.operand.text);
        } else if (command.operation == 'delete') {
            this.#buffer.makeCheckpoint();
            command.mergeCounts();
            this.#updateRegister(command, this.#cursor.deleteOperand(command.operand));
            this.#lastChangeCommand = command;
        } else if (command.operation == 'change') {
            this.#buffer.makeCheckpoint();
            command.mergeCounts();
            console.log('change', command.operand);
            this.#updateRegister(command, this.#cursor.deleteOperand(command.operand));
            if (command.operand.object && command.operand.object.kind == 'line'
                || command.operand.motion == 'down' || command.operand.motion == 'up') {
                this.#cursor.insertLineAbove();
                this.#cursor.up();
            }
            this.enterInsertMode();
        } else if (command.operation == 'yank') {
            command.mergeCounts();
            this.#updateRegister(command, this.#cursor.yankOperand(command.operand));
        } else if (command.operation == 'replace') {
            this.#buffer.makeCheckpoint();
            command.mergeCounts();
            this.#cursor.replace(command.operand);
            this.#cursor.moveOperand(command.operand);
            this.#lastChangeCommand = command;
        } else if (command.operation == 'paste') {
            this.#withRegister(command.register, async (reg) => {
                this.#buffer.makeCheckpoint();
                this.#cursor.paste(reg);
                this.#view.ensureVisible(this.#cursor);
                this.#lastChangeCommand = command;
            });
        } else if (command.operation == 'pasteBefore') {
            this.#withRegister(command.register, async (reg) => {
                this.#buffer.makeCheckpoint();
                this.#cursor.paste(reg, true);
                this.#view.ensureVisible(this.#cursor);
                this.#lastChangeCommand = command;
            });
        } else if (command.operation == 'joinLines') {
            this.#cursor.joinLines(command.count);
            this.#lastChangeCommand = command;
        } else if (command.operation == 'jumpTag') {
            this.#cursor.toTag();
            this.#view.ensureVisible(this.#cursor);
        } else if (command.operation == 'openLine') {
            this.#buffer.makeCheckpoint();
            this.#cursor.insertLineBelow();
            this.#cursor.down();
            this.#cursor.startLine();
            this.enterInsertMode();
            this.#view.ensureVisible(this.#cursor);
        } else if (command.operation == 'openLineAbove') {
            this.#buffer.makeCheckpoint();
            this.#cursor.insertLineAbove();
            this.#cursor.up();
            this.#cursor.startLine();
            this.enterInsertMode();
            this.#view.ensureVisible(this.#cursor);
        } else if (command.operation == 'insert') {
            this.#buffer.makeCheckpoint();
            this.enterInsertMode();
        } else if (command.operation == 'insertStart') {
            this.#buffer.makeCheckpoint();
            this.#cursor.moveOperand({motion: 'startLine'});
            this.enterInsertMode();
        } else if (command.operation == 'appendEnd') {
            this.#buffer.makeCheckpoint();
            this.enterInsertMode();
            this.#cursor.moveOperand({motion: 'endLine'});
        } else if (command.operation == 'append') {
            this.#buffer.makeCheckpoint();
            this.enterInsertMode();
            this.#cursor.right();
        } else if (command.operation == 'replaceMode') {
            this.#buffer.makeCheckpoint();
            this.enterReplaceMode();
        } else if (command.operation == 'indent') {
            command.mergeCounts();
            this.#cursor.indent(command.operand, false);
            this.#lastChangeCommand = command;
        } else if (command.operation == 'unindent') {
            command.mergeCounts();
            this.#cursor.indent(command.operand, true);
            this.#lastChangeCommand = command;
        } else if (command.operation == 'toggleCase') {
            this.#buffer.makeCheckpoint();
            let operand = {count: command.count, object: 'char'};
            this.#cursor.toggleCase(operand);
            operand = {count: (command.count || 1) + 1, motion: 'right'};
            this.#cursor.moveOperand(operand);
            this.#lastChangeCommand = command;
        } else if (command.operation == 'visual') {
            this.enterVisualMode();
        } else if (command.operation == 'visual-line') {
            this.enterVisualMode('line');
        } else if (command.operation == 'visual-block') {
            this.enterVisualMode('block');
        } else if (command.operation == 'text-entry') {
            this.enterTextEntryMode(command);
        } else if (command.operation == 'search') {
            this.#lastPattern = ViPattern.fromString(command.operand.text);
            this.#lastSearchBackward = false;
            this.#cursor.moveOperand({motion: 'search', pattern: this.#lastPattern});
        } else if (command.operation == 'search-word') {
            let word = this.#cursor.operandRange({object: {kind: 'word', inside: true}});
            if (!word) {
                this.#displayMessage('No word under cursor');
            } else {
                let text = word.text[0].map(c => c.symbol).join('');
                this.#lastPattern = ViPattern.fromString("\\<" + text + "\\>");
                this.#lastSearchBackward = false;
                this.#cursor.moveOperand({motion: 'search', pattern: this.#lastPattern});
            }
        } else if (command.operation == 'searchBack') {
            this.#lastPattern = ViPattern.fromString(command.operand.text);
            this.#lastSearchBackward = true;
            this.#cursor.moveOperand({motion: 'searchBack', pattern: this.#lastPattern});
        } else if (command.operation == 'searchBack-word') {
            let word = this.#cursor.operandRange({object: {kind: 'word', inside: true}});
            if (!word) {
                this.#displayMessage('No word under cursor');
            } else {
                let text = word.text[0].map(c => c.symbol).join('');
                this.#lastPattern = ViPattern.fromString("\\<" + text + "\\>");
                this.#lastSearchBackward = true;
                this.#cursor.moveOperand({motion: 'searchBack', pattern: this.#lastPattern});
            }
        } else if (command.operation == 'search-again') {
            if (!this.#lastPattern) {
                this.#displayMessage('No previous search pattern');
            } else if (this.#lastSearchBackward) {
                this.#cursor.moveOperand({motion: 'searchBack', pattern: this.#lastPattern});
            } else {
                this.#cursor.moveOperand({motion: 'search', pattern: this.#lastPattern});
            }
        } else if (command.operation == 'search-reverse') {
            if (!this.#lastPattern) {
                this.#displayMessage('No previous search pattern');
            } else if (this.#lastSearchBackward) {
                this.#cursor.moveOperand({motion: 'search', pattern: this.#lastPattern});
            } else {
                this.#cursor.moveOperand({motion: 'searchBack', pattern: this.#lastPattern});
            }
        } else if (command.operation == 'repeatSubst') {
            if (!this.#lastSubstitution) {
                this.#displayMessage('No previous substitution');
            } else {
                this.exCommand(this.#lastSubstitution);
            }
        } else if (command.operation == 'undo') {
            this.#buffer.undo();
        } else if (command.operation == 'redo') {
            this.#buffer.redo();
        } else if (command.operation == 'undoLine') {
            this.#buffer.makeCheckpoint();
            this.#cursor.undoLine();
        } else if (command.operation == 'pageUp') {
            this.#cursor.moveOperand({motion: 'up', count: this.#view.height - 5});
            this.#view.ensureVisible(this.#cursor);
            this.redraw();
        } else if (command.operation == 'pageDown') {
            this.#cursor.moveOperand({motion: 'down', count: this.#view.height - 5});
            this.#view.ensureVisible(this.#cursor);
            this.redraw();
        } else if (command.operation == 'scrollForward') {
            this.#view.scrollTo(this.#cursor, 1);
        } else if (command.operation == 'scrollLineDown') {
            this.#view.down();
            this.#view.ensureVisible(this.#cursor, true);
            this.redraw();
        } else if (command.operation == 'scrollLineUp') {
            this.#view.up();
            this.#view.ensureVisible(this.#cursor, true);
            this.redraw();
        } else if (command.operation == 'scroll') {
            if (command.count) {
                this.#cursor.move({line: command.count, column: 1});
            }
            if (command.operand.motion == 'top'
                    || command.operand.motion == 'page-down' && command.count) {
                this.#view.scrollTo(this.#cursor, 1);
            } else if (command.operand.motion == 'middle') {
                this.#view.scrollTo(this.#cursor, Math.floor(this.#view.height / 2));
            } else if (command.operand.motion == 'bottom') {
                this.#view.scrollTo(this.#cursor, this.#view.height - 1);
            } else if (command.operand.motion == 'page-down') {
                let lines = this.#view.lines;
                let lastLine = lines.at(-1);
                this.#cursor.move(lastLine[0].line + 1, 1);
                this.#view.ensureVisible(this.#cursor);
                this.#view.layOut();
                this.#view.scrollTo(this.#cursor, 0);
            } else if (command.operand.motion == 'page-up') {
                let lines = this.#view.lines;
                let firstLine = lines.at(0);
                this.#cursor.move(Math.max(1, firstLine[0].line - 1), 1);
                this.#view.ensureVisible(this.#cursor);
                this.#view.layOut();
                this.#view.scrollTo(this.#cursor, this.#view.height - 1);
            } else if (command.operand.motion == 'forward') {
                for (let i = 0; i < this.#view.height / 2; i++) {
                    this.#view.down();
                    this.#cursor.down();
                }
                this.#cursor.move(this.#cursor.line, this.#cursor.column);
            } else if (command.operand.motion == 'backward') {
                for (let i = 0; i < this.#view.height / 2; i++) {
                    this.#view.up();
                    this.#cursor.up();
                }
                this.#cursor.move(this.#cursor.line, this.#cursor.column);
            }
            this.redraw();
        } else if (command.operation == 'mark') {
            if (!command.operand.character) {
                this.#cursor.setPreviousContext();
            } else {
                this.#buffer.setMark(command.operand.character, this.#cursor.line, this.#cursor.column);
            }
        } else if (command.operation == 'repeat') {
            let count = command.count || 1;
            for (let i = 0; i < count; i++) {
                this.runNormal(this.#lastChangeCommand);
            }
        } else if (command.operation == 'recordMacro') {
            if (this.#macroRegister) {
                // Remove the final q
                this.registers[this.#macroRegister].text[0].pop();
                this.#macroRegister = null;
            } else if (command.operand.character) {
                this.#macroRegister = command.operand.character;
                this.registers[this.#macroRegister] = {text: [[]], linewise: false};
                this.enterNormalMode();
            } else {
                this.#command = new ViCommand([character.withOperation('recordMacro')]);
            }
        } else if (command.operation == 'runMacro') {
            let reg = this.registers[command.operand.character];
            if (!reg || !reg.text || !reg.text[0] || reg.text[0].length == 0) {
                this.#displayMessage('Macro ' + command.operand.character + ' not defined');
            } else {
                this.enterNormalMode();
                for (let char of reg.text[0]) {
                    this.#handleKey(char.symbol);
                }
            }
        } else if (command.operation == 'undo-cursor') {
            if (this.#cursor.multi) {
                this.#cursor.pop();
            }
        } else if (command.operation == 'extend') {
            if (command.operand.motion.includes('-skip')) {
                for (let i = 0; i < (command.count || 1); i++) {
                    this.#cursor = this.#cursor.extend(command.operand);
                }
            } else {
                command.mergeCounts();
                for (let i = 0; i < (command.operand.count || 1); i++) {
                    this.#cursor = this.#cursor.extend(command.operand);
                }
            }
        } else if (command.operation == 'normal-mode') {
            if (this.#cursor.multi)
                this.#cursor = this.#cursor.first;
        } else if (command.operation == 'displayInformation') {
            let lines = this.#buffer.lines;
            this.#displayMessage(lines.length + ' lines ' + Math.floor(this.#cursor.line / lines.length * 100) + '%');
        } else if (command.operation.startsWith('tab-')) {
            this.dispatchEvent(new CustomEvent('tab-command', {detail: {command: command.operation}, bubbles: true}));
        } else {
            console.log('Unhandled command', command.operation);
        }
    }

    enterNormalMode() {
        this.mode = 'normal';
        this.submode = null;
        this.#command = new ViCommand();
        this.#elementInternals.setFormValue(this.#buffer.toString());
    }

    enterTextEntryMode(command) {
        this.mode = 'text-entry';
        this.submode = null;
        this.#command = new ViCommand(textEntry(command.operand.motion, command.operand.character));
        this.#command.message = command.operand.character;
        this.#displayMessage(command.operand.character);
    }

    runTextEntry(command) {
        if (command.operation == 'normal-mode') {
            this.enterNormalMode();
        } else {
            this.enterNormalMode();
            this.runNormal(command);
        }
    }

    enterInsertMode() {
        this.mode = 'insert';
        this.submode = null;
        this.#command = new ViCommand([insertCommands]);
        this.#command.reset();
    }

    runInsert(command) {
        if (command.operation == 'normal-mode') {
            this.enterNormalMode();
            if (this.#cursor.multi) {
                this.#cursor = this.#cursor.first;
            }
            this.#cursor.left();
        } else if (command.operation == 'move') {
            this.#cursor.moveOperand(command.operand);
            this.#view.ensureVisible(this.#cursor);
        } else if (command.operation == 'insert-char') {
            this.#cursor.insert(command.operand.character);
        } else if (command.operation == 'delete') {
            this.#cursor.deleteOperand(command.operand);
        } else if (command.operation == 'break-line') {
            this.#cursor.breakLine();
            this.#view.ensureVisible(this.#cursor);
        }
    }

    enterReplaceMode() {
        this.mode = 'replace';
        this.submode = null;
        this.#command = new ViCommand([replaceCommands]);
        this.#command.reset();
    }

    runReplace(command) {
        if (command.operation == 'normal-mode') {
            this.enterNormalMode();
        } else if (command.operation == 'move') {
            this.#cursor.moveOperand(command.operand);
            this.#view.ensureVisible(this.#cursor);
        } else if (command.operation == 'delete') {
            this.#cursor.deleteOperand(command.operand);
        } else if (command.operation == 'replace') {
            this.#cursor.replace(command.operand);
            this.#cursor.moveOperand({motion: 'right'});
        }
    }

    #updateRegister(command, result) {
        if (command.register == '+' || command.register == '*') {
            navigator.clipboard.writeText(result.text.map(l => l.map(c => c.symbol).join('')).join('\n'));
            return;
        }
        let reg = this.registers[command.register ?? '"'];
        reg.linewise = result.linewise;
        if (command.appendRegister) {
            if (reg.linewise) {
                reg.text.push(...result.text);
            } else {
                reg.text[reg.text.length - 1].push(...result.text[0]);
            }
        } else {
            reg.text = result.text;
        }
    }

    #withRegister(register, fn) {
        if (register == '+' || register == '*') {
            navigator.clipboard.readText().then(text => {
                let lines = text.split('\n').map(line => {
                    let chars = [];
                    for (let i = 0; i < line.length; i++) {
                        let ch = line[i];
                        if (ch >= '\ud800' && ch <= '\udbff') {
                            // Potential surrogate pair
                            let ch2 = line[i+1];
                            if (ch2 >= '\udc00' && ch2 <= '\udfff') {
                                chars.push(cellFromChar(ch + ch2));
                                i++;
                            }
                            // Otherwise, lone high surrogate; ignore
                        } else if (ch >= '\udc00' && ch <= '\udfff') {
                            // Lone low surrogate; ignore
                        }  else {
                            chars.push(cellFromChar(ch));
                        }
                    }
                    return chars;
                });
                fn({text: lines, linewise: false});
                this.redraw();
            });
        } else {
            fn(this.registers[register || '"']);
        }
    }

    enterVisualMode(kind='char') {
        this.mode = 'visual';
        this.submode = kind == 'char' ? null : kind;
        this.#cursor.startVisual(kind);
        this.#command = new ViCommand([visualCommands]);
    }

    runVisual(command) {
        if (command.operand.screenMotion) {
            command.mergeCounts();
            this.#view.setScreenMotion(command.operand);
        }
        if (command.operation == 'move') { // TODO: currently, only select is used & handles both
            this.#cursor.moveOperand(command.operand);
            this.#view.ensureVisible(this.#cursor);
        } else if (command.operation == 'select') {
            this.#cursor.setVisualOperand(command.operand);
            this.#view.ensureVisible(this.#cursor, !!command.operand.screenMotion);
        } else if (command.operation == 'normal-mode') {
            this.enterNormalMode();
            this.#cursor.endVisual();
            this.#view.ensureVisible(this.#cursor, true);
        } else if (command.operation == 'visual') {
            this.submode = null;
            this.#cursor.startVisual();
        } else if (command.operation == 'visual-line') {
            this.submode = 'line';
            this.#cursor.startVisual('line');
        } else if (command.operation == 'visual-block') {
            this.submode = 'block';
            this.#cursor.startVisual('block');
        } else if (command.operation == 'swap-diag') {
            this.#cursor.visualSwap();
        } else if (command.operation == 'swap-horiz') {
            this.#cursor.visualSwap(true);
        } else if (command.operation == 'delete') {
            this.#buffer.makeCheckpoint();
            command.operand.object = 'visual';
            this.#updateRegister(command, this.#cursor.deleteOperand(command.operand));
            this.enterNormalMode();
            this.#cursor.endVisual();
        } else if (command.operation == 'yank') {
            command.operand.object = 'visual';
            this.#withRegister(command.register, reg => {
                this.#updateRegister(command, this.#cursor.yankOperand(command.operand));
                this.enterNormalMode();
                this.#cursor.endVisual();
            });
        } else if (command.operation == 'paste') {
            this.#withRegister(command.register, reg => {
                this.#buffer.makeCheckpoint();
                this.#cursor.deleteOperand({object: 'visual'});
                this.#cursor.paste(reg, true);
                this.enterNormalMode();
                this.#cursor.endVisual();
            });
        } else if (command.operation == 'replace') {
            command.operand.object = 'visual';
            this.#buffer.makeCheckpoint();
            this.#cursor.replace(command.operand);
            this.enterNormalMode();
            this.#cursor.endVisual();
        } else if (command.operation == 'indent') {
            this.#buffer.makeCheckpoint();
            command.operand.object = 'visual';
            let count = command.operand.count || 1;
            for (let i = 0; i < count; i++) {
                this.#cursor.indent(command.operand);
            }
            this.#cursor.endVisual();
            this.#cursor.moveOperand({motion: 'firstNonBlank'});
            this.enterNormalMode();
        } else if (command.operation == 'unindent') {
            this.#buffer.makeCheckpoint();
            command.operand.object = 'visual';
            let count = command.operand.count || 1;
            for (let i = 0; i < count; i++) {
                this.#cursor.indent(command.operand, true);
            }
            this.#cursor.endVisual();
            this.#cursor.moveOperand({motion: 'firstNonBlank'});
            this.enterNormalMode();
        } else if (command.operation == 'toggleCase') {
            this.#buffer.makeCheckpoint();
            command.operand.object = 'visual';
            this.#cursor.toggleCase(command.operand);
            this.#cursor.endVisual();
            this.enterNormalMode();
        } else if (command.operation == 'jumpTag') {
            this.#cursor.toTag();
            this.#view.ensureVisible(this.#cursor);
        } else if (command.operation == 'extend-next') {
            this.#cursor = this.#cursor.extend({motion:'next-selection'});
        } else if (command.operation == 'insert-before' || command.operation == 'insert-after' || command.operation == 'change') {
            let range = this.#cursor.operandRange({object: 'visual'});
            this.#buffer.makeCheckpoint();
            if (range.blockwise) {
                if (command.operation == 'change') {
                    this.#updateRegister(command, this.#cursor.deleteOperand({object: 'visual'}));
                }
                let start = range.earlier;
                let end = range.later;
                let column
                if (command.operation == 'insert-after') {
                    column = Math.max(start.column, end.column) + 1;
                } else {
                    column = Math.min(start.column, end.column);
                }
                let cursors = [];
                for (let i = start.line; i <= end.line; i++) {
                    let cursor = this.#buffer.getCursor(i, column);
                    cursors.push(cursor);
                }
                this.#cursor = new MultiCursor(...cursors);
                this.enterInsertMode();
            } else {
                if (command.operation == 'change') {
                    this.#updateRegister(command, this.#cursor.deleteOperand({object: 'visual'}));
                }
                let start = range.earlier;
                let end = range.later;
                this.#cursor.endVisual();
                if (command.operation == 'insert-after') {
                    this.#cursor.move(end.line, end.column);
                } else {
                    if (command.operation == 'change' && range.linewise) {
                        this.#cursor.insertLineAbove();
                        this.#cursor.up();
                        this.#cursor.move(start.line, 1);
                    }
                }
                this.enterInsertMode();
            }
        }
    }

    #onKeyDown(event) {
        event.preventDefault();
        let key = event.key;
        if (key == 'Shift' || key == 'Control' || key == 'Alt' || key == 'Meta') {
            return;
        }
        if (event.ctrlKey && key.length == 1) {
            key = 'CTRL-' + key;
        }
        if (key == 'CTRL-[')
            key = 'Escape';
        this.#handleKey(key);
        if (this.#macroRegister) {
            this.#displayMessage('Recording @' + this.#macroRegister);
        }
        if (this.#command.message) {
            this.#displayMessage(this.#command.message);
        }
        this.redraw();
    }

    async #handleKey(key) {
        if (this.#macroRegister) {
            this.registers[this.#macroRegister].text[0].push({symbol: key});
        }
        this.#command.handle(key);
        if (this.#command.done) {
            if (this.mode == 'normal') {
                this.runNormal(this.#command);
            } else if (this.mode == 'insert') {
                this.runInsert(this.#command);
            } else if (this.mode == 'visual') {
                this.runVisual(this.#command);
            } else if (this.mode == 'replace') {
                this.runReplace(this.#command);
            } else if (this.mode == 'text-entry') {
                this.runTextEntry(this.#command);
            }
            this.#command = this.#command.empty();
        }
    }

    #onClick(event, cx, cy) {
        let {x, y, content} = this.#view.at(cx, cy);
        if (event.ctrlKey) {
            if (content.tagDest) {
                let tag = this.#buffer.tag(content.tagDest);
                if (tag) {
                    this.#cursor.move(tag.line, tag.column);
                    this.#view.ensureVisible(this.#cursor);
                    this.redraw();
                }
            }
        } else {
            if (content)
                this.#cursor.move(y, x);
            this.redraw();
        }
    }

    #message = null;
    #displayMessage(message) {
        this.#message = message;
    }

    redraw() {
        if (!this.#container) return;
        this.#view.layOut();
        let range = this.#view.lines;
        let spaceColumn;
        for (let y = 0; y < range.length; y++) {
            if (!this.#cells[y]) break;
            for (let x = 0; x < this.#cols; x++) {
                let charSpan = this.#cells[y][x];
                if (this.#view.cursorAt(this.#cursor, y, x)) {
                    charSpan.classList.add('cursor');
                    if (!spaceColumn) {
                        spaceColumn = range[y][x]?.spaceColumn ?? x;
                    }
                } else
                    charSpan.classList.remove('cursor');
                if (this.#view.selectedAt(this.#cursor, y, x))
                    charSpan.classList.add('selected');
                else
                    charSpan.classList.remove('selected');
                let highlight = this.#view.highlightAt(this.#cursor, y, x);
                if (highlight) {
                    charSpan.classList.add('highlight');
                } else {
                    charSpan.classList.remove('highlight');
                }
                charSpan.style.background = '';
                charSpan.style.width = '';
                charSpan.style.height = '';
                if (charSpan.hasImage) {
                    charSpan.style.gridRow = y + 1;
                    charSpan.style.gridColumn = x + 1;
                    charSpan.style.zIndex = '';
                    charSpan.hasImage = false;
                }
                if (!range[y])
                    charSpan.textContent = '';
                else if (x >= range[y].length)
                    charSpan.textContent = '';
                else if (range[y][x].image) {
                    charSpan.style.backgroundImage = `url("${range[y][x].image}")`;
                    charSpan.style.backgroundSize = "contain";
                    charSpan.style.width = range[y][x].imageCols + 'ch';
                    charSpan.style.height = range[y][x].imageRows + 'lh';
                    charSpan.textContent = '';
                    charSpan.style.gridRow = (y + 1) + '/ span ' + range[y][x].imageRows;
                    charSpan.style.gridColumn = (x + 1) + '/ span ' + range[y][x].imageCols;
                    charSpan.style.zIndex = 1;
                    charSpan.hasImage = true;
                } else if (range[y][x].width > 1) {
                    charSpan.style.zIndex = 1;
                    charSpan.textContent = range[y][x].symbol;
                    charSpan.hasImage = true;
                } else if (range[y][x].tagDest) {
                    charSpan.classList.add('link');
                    charSpan.textContent = range[y][x].symbol;
                } else {
                    charSpan.classList.remove('link');
                    charSpan.textContent = range[y][x].symbol;
                }
            }
        }
        if (this.#message) {
            let message = this.#message;
            let lastRow = this.#cells.at(-1);
            for (let cell of lastRow) {
                cell.textContent = '';
            }
            for (let i = 0; i < message.length; i++) {
                lastRow[i].textContent = message[i];
            }
            this.#message = null;
        } else {
            const width = this.#cols;
            for (let i = 0; i < width; i++) {
                this.#cells.at(-1)[i].textContent = ' ';
            }
            if (this.#mode != 'normal') {
                let modeStr = '-- ' + this.#mode.toUpperCase();
                if (this.submode) {
                    modeStr += ' ' + this.submode.toUpperCase();
                }
                modeStr += ' --';
                for (let i = 0; i < modeStr.length; i++) {
                    this.#cells.at(-1)[i].textContent = modeStr[i];
                }
            }
            let posStr = this.#cursor.line + ',' + this.#cursor.column
            if (this.#cursor.column != spaceColumn)
                posStr += '-' + spaceColumn;
            for (let i = 0; i < posStr.length; i++) {
                this.#cells.at(-1)[width - 20 + i].textContent = posStr[i];
            }
            let opStr = this.#command.command;
            for (let i = 0; i < opStr.length; i++) {
                this.#cells.at(-1)[width - 10 + i].textContent = opStr[i];
            }
        }
    }

}


class ViBuffer {
    #lines = [];
    #cursors = [];
    #registers
    #undoStack = [];
    #redoStack = [];
    #tags = {};
    #marks = {};
    constructor(text='', registers={}) {
        if (typeof text == 'string') {
            this.fromString(text);
        } else {
            let line = [];
            for (let node of text) {
                if (node.nodeType == Node.TEXT_NODE) {
                    for (let i = 0; i < node.nodeValue.length; i++) {
                        let ch = node.nodeValue[i];
                        if (ch == '\n') {
                            this.#lines.push(line);
                            line = [];
                        } else if (ch >= '\ud800' && ch <= '\udbff') {
                            // Potential surrogate pair
                            let ch2 = node.nodeValue[i + 1];
                            if (ch2 >= '\udc00' && ch2 <= '\udfff') {
                                line.push(cellFromChar(ch + ch2));
                                i++;
                            }
                            // Otherwise, lone high surrogate; ignore
                        } else if (ch >= '\udc00' && ch <= '\udfff') {
                            // Lone low surrogate; ignore
                        }  else {
                            line.push(cellFromChar(ch));
                        }
                    }
                } else if (node.nodeType == Node.ELEMENT_NODE) {
                    if (node.tagName == 'A') {
                        let text = node.textContent;
                        if (node.getAttribute('name')) {
                            this.#tags[node.getAttribute('name')] = {line: this.#lines.length + 1, column: line.length + 1};
                        }
                        let extra = {};
                        if (node.getAttribute('href')) {
                            let href = node.getAttribute('href');
                            if (href.startsWith('#')) {
                                extra.tagDest = href.substring(1);
                            }
                        }
                        for (let i = 0; i < text.length; i++) {
                            line.push(cellFromChar(text[i], extra));
                        }
                    } else if (node.tagName == 'IMG') {
                        let imageRows = node.dataset.rows || 1;
                        let imageCols = node.dataset.cols || 1;
                        line.push({image: node.src, imageRows, imageCols});
                    } else {
                        let text = node.textContent;
                        for (let i = 0; i < text.length; i++) {
                            if (text[i] == '\n') {
                                this.#lines.push(line);
                                line = [];
                            } else {
                                line.push(cellFromChar(text[i]));
                            }
                        }
                    }
                }
                // let line = [];
                // for (let child of node.childNodes) {
                //     if (child.nodeType == Node.TEXT_NODE) {
                //         for (let i = 0; i < child.nodeValue.length; i++) {
                //             line.push(cellFromChar(child.nodeValue[i]));
                //         }
                //     } else if (child.nodeType == Node.ELEMENT_NODE) {
                //         if (child.tagName == 'BR') {
                //             this.#lines.push(line);
                //             line = [];
                //         } else {
                //             let text = child.textContent;
                //             for (let i = 0; i < text.length; i++) {
                //                 line.push(cellFromChar(text[i]));
                //             }
                //         }
                //     }
                // }
                // this.#lines.push(line);
            }
        }
        this.#registers = registers;
    }

    get lines() {
        return Array.from(this.#lines);
    }

    toString() {
        return this.#lines.map(line => line.map(cell => cell.symbol).join('')).join('\n');
    }

    fromString(text) {
        this.#lines = text.split('\n').map(line => {
            let chars = [];
            for (let i = 0; i < line.length; i++) {
                let ch = line[i];
                if (ch >= '\ud800' && ch <= '\udbff') {
                    // Potential surrogate pair
                    let ch2 = line[i+1];
                    if (ch2 >= '\udc00' && ch2 <= '\udfff') {
                        chars.push(cellFromChar(ch + ch2));
                        i++;
                    }
                    // Otherwise, lone high surrogate; ignore
                } else if (ch >= '\udc00' && ch <= '\udfff') {
                    // Lone low surrogate; ignore
                }  else {
                    chars.push(cellFromChar(ch));
                }
            }
            return chars;
        });
    }

    range(start, len) {
        return this.#lines.slice(start, start + len);
    }

    splice(y, x, len, text) {
        let line = this.#lines[y];
        line.splice(x, len, ...text);
    }

    spliceLines(y, len, text) {
        this.#lines.splice(y, len, ...text);
    }

    tag(tagText) {
        if (tagText in this.#tags) {
            return this.#tags[tagText];
        }
        return {line: 1, column: 1};
    }

    getCursor(startLine=1, startColumn=1) {
        let c
        c = new ViCursor(this, startLine, startColumn, {
            insertChar: (char, line, column) => {
                this.#lines[line - 1].splice(column - 1, 0, cellFromChar(char));
                for (let cursor of this.#cursors) {
                    if (cursor.line == line && cursor.column >= column) {
                        cursor.right();
                    }
                }
                for (let tag in this.#tags) {
                    let {line: tagLine, column: tagColumn} = this.#tags[tag];
                    if (line == tagLine && column <= tagColumn) {
                        this.#tags[tag].column++;
                    }
                }
                for (let mark in this.#marks) {
                    let {line: markLine, column: markColumn} = this.#marks[mark];
                    if (line == markLine && column <= markColumn) {
                        this.#marks[mark].column++;
                    }
                }
            },
            deleteChar: (line, column) => {
                let ret = this.#lines[line - 1].splice(column - 1, 1);
                for (let cursor of this.#cursors) {
                    if (cursor.line == line && cursor.column > column) {
                        cursor.left();
                    }
                }
                for (let tag in this.#tags) {
                    let {line: tagLine, column: tagColumn} = this.#tags[tag];
                    if (line == tagLine && column < tagColumn) {
                        this.#tags[tag].column--;
                    }
                }
                for (let mark in this.#marks) {
                    let {line: markLine, column: markColumn} = this.#marks[mark];
                    if (line == markLine && column < markColumn) {
                        this.#marks[mark].column--;
                    }
                }
                return ret[0];
            },
            setChar: (char, line, column, extra) => {
                let ret = this.#lines[line - 1][column - 1];
                this.#lines[line - 1][column - 1] = cellFromChar(char, extra);
                return ret;
            },
            deleteBefore: (line, column) => {
                if (column > 1) {
                    this.#lines[line - 1].splice(column - 2, 1);
                    for (let cursor of this.#cursors) {
                        if (cursor.line == line && cursor.column > column) {
                            cursor.left();
                        }
                    }
                    for (let tag in this.#tags) {
                        let {line: tagLine, column: tagColumn} = this.#tags[tag];
                        if (line == tagLine && column < tagColumn) {
                            this.#tags[tag].column--;
                        }
                    }
                    for (let mark in this.#marks) {
                        let {line: markLine, column: markColumn} = this.#marks[mark];
                        if (line == markLine && column < markColumn) {
                            this.#marks[mark].column--;
                        }
                    }
                }
            },
            insertLine: (line, column) => {
                let currentLine = this.#lines[line - 1];
                if (currentLine === undefined) {
                    currentLine = [];
                    this.#lines.push(currentLine);
                }
                let newLine = currentLine.splice(column - 1);
                this.#lines.splice(line, 0, newLine);
                for (let cursor of this.#cursors) {
                    if (cursor.line == line && cursor.column >= column) {
                        cursor.down();
                        cursor.left(column);
                    } else if (cursor.line > line) {
                        cursor.down();
                    }
                }
                for (let tag in this.#tags) {
                    let {line: tagLine, column: tagColumn} = this.#tags[tag];
                    if (line == tagLine && column <= tagColumn) {
                        this.#tags[tag].line++;
                    } else if (line < tagLine) {
                        this.#tags[tag].line++;
                    }
                }
                for (let mark in this.#marks) {
                    let {line: markLine, column: markColumn} = this.#marks[mark];
                    if (line == markLine && column <= markColumn) {
                        this.#marks[mark].line++;
                    } else if (line < markLine) {
                        this.#marks[mark].line++;
                    }
                }
            },
            deleteLine: (line) => {
                let ret = this.#lines.splice(line - 1, 1);
                for (let cursor of this.#cursors) {
                    if (cursor.line > line) {
                        cursor.up();
                    }
                }
                for (let tag in this.#tags) {
                    let {line: tagLine, column: tagColumn} = this.#tags[tag];
                    if (line < tagLine) {
                        this.#tags[tag].line--;
                    }
                }
                for (let mark in this.#marks) {
                    let {line: markLine, column: markColumn} = this.#marks[mark];
                    if (line < markLine) {
                        this.#marks[mark].line--;
                    }
                }
                return ret;
            },
            joinLines: (line, leaveWhitespace = false) => {
                let spaceRE = /^\s+$/;
                let currentLine = this.#lines[line - 1];
                let curLength = currentLine.length;
                let nextLine = this.#lines[line];
                let joined
                let nextStartsParen = nextLine.length && nextLine[0].symbol == ')';
                let currentEndsSpace = currentLine.length && spaceRE.test(currentLine[currentLine.length - 1].symbol);

                if (leaveWhitespace) {
                    joined = currentLine.concat(nextLine);
                } else {
                    let firstNonWhitespace = 0;
                    for (let i = 0; i < nextLine.length; i++) {
                        if (!spaceRE.test(nextLine[i].symbol)) {
                            firstNonWhitespace = i;
                            break;
                        }
                    }
                    let rest = nextLine.slice(firstNonWhitespace);
                    if (nextStartsParen || currentEndsSpace) {
                        joined = currentLine.concat(nextLine);
                    } else {
                        joined = currentLine.concat({symbol: ' '}, rest);
                    }
                }
                this.#lines.splice(line - 1, 2, joined);
                for (let cursor of this.#cursors) {
                    if (cursor.line == line) {
                        
                    } else if (cursor.line == line + 1) {
                        cursor.move(line, cursor.column + curLength);
                    } else if (cursor.line > line + 1) {
                        cursor.up();
                    }
                }
                for (let tag in this.#tags) {
                    let {line: tagLine, column: tagColumn} = this.#tags[tag];
                    if (line < tagLine) {
                        this.#tags[tag].line--;
                    }
                }
                for (let mark in this.#marks) {
                    let {line: markLine, column: markColumn} = this.#marks[mark];
                    if (line == markLine - 1) {
                        this.#marks[mark].line--;
                        this.#marks[mark].column += curLength;
                    } else if (line < markLine) {
                        this.#marks[mark].line--;
                    }
                }
            },
            indentLine: (line, unindent) => {
                let currentLine = this.#lines[line - 1];
                let currentDepth = 0;
                while (currentDepth < currentLine.length && currentLine[currentDepth].symbol == ' ') {
                    currentDepth++;
                }
                let count = currentDepth;
                if (unindent) {
                    count = Math.min(count, 4);
                } else {
                    count = 4;
                }
                for (let i = 0; i < count; i++) {
                    if (unindent && currentLine[0].symbol == ' ') {
                        currentLine.shift();
                    } else {
                        currentLine.unshift(cellFromChar(' '));
                    }
                }
            },
            copyLine: (line) => {
                return this.#lines[line - 1].map(cell => ({...cell}));
            },
            replaceLine: (line, text) => {
                this.#lines[line - 1] = text;
            },
            dispose: () => {this.#cursors.splice(this.#cursors.indexOf(c), 1)},
        });
        this.#cursors.push(c);
        return c;
    }

    setMark(mark, line, column) {
        this.#marks[mark] = {line, column};
    }

    getMark(mark) {
        if (mark in this.#marks)
            return {...this.#marks[mark]};
        return null;
    }

    #createCheckpoint() {
        let lines = this.#lines.map(line => Array.from(line));
        let cursors = this.#cursors.map(cursor => ({line: cursor.line, column: cursor.column}));
        return {lines, cursors};
    }

    makeCheckpoint() {
        let state = this.#createCheckpoint();
        this.#undoStack.push(state);
        if (this.#undoStack.length > 100) {
            this.#undoStack.shift();
        }
    }

    undo() {
        if (this.#undoStack.length) {
            let cur = this.#createCheckpoint();
            this.#redoStack.push(cur);
            let state = this.#undoStack.pop();
            this.#lines = state.lines;
            for (let i = 0; i < state.cursors.length; i++) {
                this.#cursors[i].move(state.cursors[i].line, state.cursors[i].column);
            }
        }
    }

    redo() {
        if (this.#redoStack.length) {
            let cur = this.#createCheckpoint();
            this.#undoStack.push(cur);
            let state = this.#redoStack.pop();
            this.#lines = state.lines;
            for (let i = 0; i < state.cursors.length; i++) {
                this.#cursors[i].move(state.cursors[i].line, state.cursors[i].column);
            }
        }
    }

    matchAt(line, column, pattern) {
        let lineChars = this.#lines[line - 1];
        let ret = pattern.match(lineChars, column - 1);
        if (!ret)
            return null;
        return {line, column: ret.column + 1, length: ret.length};
    }


}

function cellFromChar(char, extra={}) {
    return {
        symbol: char,
        wordChar: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.includes(char),
        whitespace: ' \t\n'.includes(char),
        ...extra
    }
}

class ViPattern {
    constructor(pattern) {
        this.pattern = pattern;
    }

    match(line, column) {
        return this.pattern.match(line, column);
    }

    static fromString(pattern) {
        let elements = [];
        let i = 0;
        while (i < pattern.length) {
            let ch = pattern[i];
            if (ch == '\\') {
                i++;
                ch = pattern[i];
                if (ch == '<') {
                    elements.push(new ViWordBoundaryPatternElement(true));
                } else if (ch == '>') {
                    elements.push(new ViWordBoundaryPatternElement(false));
                } else {
                    elements.push(new ViCharPatternElement(ch));
                }
            } else if (ch == '(') {
                let start = i;
                let depth = 1;
                i++;
                while (i < pattern.length && depth > 0) {
                    if (pattern[i] == '(')
                        depth++;
                    else if (pattern[i] == ')')
                        depth--;
                    i++;
                }
                let subpattern = pattern.substring(start + 1, i - 1);
                elements.push(ViPattern.fromString(subpattern));
            } else if (ch == '.') {
                elements.push(new ViWildcardPatternElement());
            } else {
                elements.push(new ViCharPatternElement(ch));
            }
            i++;
        }
        return new ViConcatPatternElement(elements);
    }
}

class ViPatternElement {
    constructor() {
    }

    match(line, column, opts) {
        return null;
    }
}

class ViCharPatternElement extends ViPatternElement {
    constructor(char) {
        super();
        this.char = char;
    }

    match(line, column, opts) {
        if (line[column] && line[column].symbol == this.char) {
            return {column: column + 1, length: 1};
        }
        return null;
    }
}

class ViWildcardPatternElement extends ViPatternElement {
    constructor() {
        super();
    }

    match(line, column, opts) {
        if (column < line.length) {
            return {column: column + 1, length: 1};
        }
        return null;
    }
}

class ViWordBoundaryPatternElement extends ViPatternElement {
    constructor(before) {
        super();
        this.before = before;
    }

    match(line, column, opts) {
        if (!line[column])
            return null;
        let wordChar = line[column].wordChar;
        if (this.before) {
            if (column == 0) {
                return wordChar ? {column: 0, length: 0} : null;
            } else {
                let prevWordChar = line[column - 1].wordChar;
                return wordChar && !prevWordChar ? {column: column, length: 0} : null;
            }
        } else {
            if (column == line.length) {
                return wordChar ? {column: column, length: 0} : null;
            } else {
                let prevWordChar = line[column - 1]?.wordChar;
                let nextWordChar = line[column]?.wordChar;
                return prevWordChar && !nextWordChar ? {column: column, length: 0} : null;
            }
        }
        return null;
    }
}

class ViConcatPatternElement extends ViPatternElement {
    constructor(elements) {
        super();
        this.elements = elements;
    }

    match(line, column, opts) {
        let pos = {column, length: 0};
        for (let element of this.elements) {
            let ret = element.match(line, pos.column, opts);
            if (!ret)
                return null;
            pos.column = ret.column;
            pos.length += ret.length;
        }
        return pos;
    }
}

class ViRange {
    #buffer
    #earlier
    #later
    #text
    constructor(buffer, start, end, mode='char', exclusive=false, text=null) {
        this.#buffer = buffer;
        this.start = start;
        this.end = end;
        this.mode = mode;
        this.exclusive = exclusive;
        if (text)
            this.#text = text;
    }

    fixed() {
        return new ViRange(this.#buffer, this.earlier, this.later, this.mode, this.exclusive, this.text);
    }

    get linewise() {
        return this.mode == 'line' || this.mode == 'block';
    }

    get blockwise() {
        return this.mode == 'block';
    }

    get charwise() {
        return this.mode == 'char';
    }

    get inclusive() {
        return !this.exclusive;
    }

    #earlyLate() {
        if (this.mode == 'block') {
            this.#earlier = {
                line: Math.min(this.start.line, this.end.line),
                column: Math.min(this.start.column, this.end.column)
            };
            this.#later = {
                line: Math.max(this.start.line, this.end.line),
                column: Math.max(this.start.column, this.end.column)
            };
        } else if (this.start.line < this.end.line || (this.start.line == this.end.line && this.start.column < this.end.column)) {
            this.#earlier = this.start;
            this.#later = this.end;
        } else {
            this.#earlier = this.end;
            this.#later = this.start;
        }
    }
    get earlier() {
        if (!this.#earlier)
            this.#earlyLate();
        return this.#earlier;
    }

    get later() {
        if (!this.#later)
            this.#earlyLate();
        return this.#later;
    }

    *lines() {
        let start = this.earlier;
        let end = this.later;
        for (let i = start.line; i <= end.line; i++) {
            yield i;
        }
    }

    contains(line, column) {
        let {linewise, blockwise} = this;
        let start = this.earlier;
        let end = this.later;
        if (blockwise) {
            return line >= start.line && line <= end.line && column >= start.column && column <= end.column;
        }
        if (linewise) {
            return line >= start.line && line <= end.line;
        }
        if (line < start.line || line > end.line)
            return false;
        if (line == start.line && column < start.column)
            return false;
        if (line == end.line && column > end.column)
            return false;
        return true;
    }

    get text() {
        if (this.#text) {
            return this.#text;
        }
        let {linewise, blockwise} = this;
        let start = this.earlier;
        let end = this.later;
        let text = [];
        if (blockwise) {
            for (let i = start.line; i <= end.line; i++) {
                let line = this.#buffer.lines[i - 1];
                let lineText = line.slice(start.column - 1, end.column);
                text.push(lineText);
            }
        } else if (linewise) {
            for (let i = start.line; i <= end.line; i++) {
                text.push(Array.from(this.#buffer.lines[i - 1]));
            }
        } else {
            if (start.line == end.line) {
                let line = this.#buffer.lines[start.line - 1];
                let lineText = [];
                for (let i = start.column - 1; i < end.column - (end.exclusive ? 1 : 0); i++) {
                    lineText.push(line[i]);
                }
                text.push(lineText);
            } else {
                let line = this.#buffer.lines[start.line - 1];
                let lineText = [];
                for (let i = start.column - 1; i < line.length; i++) {
                    lineText.push(line[i]);
                }
                text.push(lineText);
                for (let i = start.line + 1; i < end.line; i++) {
                    line = this.#buffer.lines[i - 1];
                    lineText = [];
                    for (let j = 0; j < line.length; j++) {
                        lineText.push(line[j]);
                    }
                    text.push(lineText);
                }
                line = this.#buffer.lines[end.line - 1];
                lineText = [];
                for (let i = 0; i < end.column; i++) {
                    lineText.push(line[i]);
                }
                text.push(lineText);
            }
        }
        return text;
    }
}

class ViCursor {
    #buffer
    #column = 1;
    #line = 1;
    #operations
    #mode = 'normal'
    #previousContextMark = {line: 1, column: 1}
    #lastFindChar = ' ';
    #lastFind = 'findChar';
    #savedLine = null;
    matchingSelections;

    constructor(buffer, line, column, operations) {
        this.#buffer = buffer;
        this.#line = line;
        this.#column = column;
        this.#operations = operations
    }

    get line() {
        return this.#line;
    }

    get column() {
        return this.#column;
    }

    get mode() {
        return this.#mode;
    }

    set mode(value) {
        this.#mode = value;
        if (value != 'insert') {
            this.#column = Math.min(this.#buffer.lines[this.#line - 1].length + 1, this.#column);
        } else {
            this.#column = Math.min(this.#buffer.lines[this.#line - 1].length + 1, this.#column);
        }
    }

    setPreviousContext() {
        this.#previousContextMark = {line: this.#line, column: this.#column};
    }

    move(line, column) {
        if (line < 1)
            line = 1;
        if (line >= this.#buffer.lines.length)
            line = this.#buffer.lines.length;
        if (line != this.#line)
            this.#savedLine = this.#operations.copyLine(line);
        this.#line = line;
        if (column > this.#buffer.lines[line - 1].length + (this.#mode == 'insert' ? 1 : 0))
            column = this.#buffer.lines[line - 1].length + (this.#mode == 'insert' ? 1 : 0);
        if (column < 1)
            column = 1;
        this.#column = column;
    }

    undoLine() {
        if (this.#savedLine) {
            let tmp = this.#operations.copyLine(this.#line);
            this.#operations.replaceLine(this.#line, this.#savedLine);
            this.#savedLine = tmp;
            this.move(this.#line, 1);
        }
    }

    up(count=1) {
        this.#line = Math.max(1, this.#line - count);
        this.#savedLine = this.#operations.copyLine(this.#line);
    }
    
    down(count=1) {
        this.#line = Math.min(this.#buffer.lines.length, this.#line + count);
        this.#savedLine = this.#operations.copyLine(this.#line);
    }

    left(count=1) {
        this.#column = Math.max(1, this.#column - count);
    }

    right(count = 1) {
        this.#column = Math.min(this.#buffer.lines[this.#line - 1].length + (this.#mode == 'insert' ? 1 : 0), this.#column + count);
    }

    endLine() {
        this.#column = this.#buffer.lines[this.#line - 1].length + (this.mode == 'insert' ? 1 : 0);
    }

    startLine() {
        this.#column = 1;
    }

    insert(char) {
        this.#operations.insertChar(char, this.#line, this.#column);
    }

    delete(count=1) {
        let ret = [];
        for (let i = 0; i < count; i++) {
            ret.push(this.#operations.deleteChar(this.#line, this.#column));
        }
        this.#column = Math.max(1, Math.min(this.#buffer.lines[this.#line - 1].length + (this.#mode == 'insert' ? 1 : 0), this.#column));
        return {linewise: false, text: ret};
    }

    deleteWord() {
        let line = this.#buffer.lines[this.#line - 1];
        let i = this.#column - 1;
        while (i < line.length && line[i].symbol == ' ') {
            i++;
        }
        while (i < line.length && line[i].symbol != ' ') {
            i++;
        }
        while (i < line.length && line[i].symbol == ' ') {
            i++;
        }
        let count = i - this.#column + 1;
        return this.delete(count);
    }

    deleteBefore() {
        if (this.#column > 1)
            this.#operations.deleteChar(this.#line, this.#column - 1);
    }

    breakLine() {
        this.#operations.insertLine(this.#line, this.#column);
    }

    insertLineBelow() {
        this.#operations.insertLine(this.#line + 1, 1);
    }
    
    insertLineAbove() {
        this.#operations.insertLine(this.#line, 1);
    }

    deleteLine(delta=0) {
        return {linewise: true, text: this.#operations.deleteLine(this.#line + delta)};
    }

    deleteOperand(opd) {
        let range = this.operandRange(opd);
        if (range) {
            let {linewise, exclusive, inclusive, blockwise, text} = range;
            if (typeof inclusive != 'undefined') {
                exclusive = !inclusive;
            }
            let ret = {linewise, blockwise, text};
            let start = range.earlier;
            let end = range.later;
            if (blockwise) {
                for (let i = start.line; i <= end.line; i++) {
                    let line = this.#buffer.lines[i - 1];
                    line.splice(start.column - 1, end.column - start.column + 1);
                }
            } else if (linewise) {
                for (let i = start.line; i <= end.line; i++) {
                    this.#operations.deleteLine(start.line);
                }
            } else {
                if (start.line == end.line) {
                    for (let i = start.column; i <= end.column - (exclusive ? 1 : 0); i++) {
                        this.#operations.deleteChar(start.line, start.column);
                    }
                } else {
                    // Delete rest of start line
                    while (this.#operations.deleteChar(start.line, start.column)) {
                    }
                    // Delete start of end line
                    for (let i = 1; i <= end.column - (exclusive ? 1 : 0); i++) {
                        this.#operations.deleteChar(end.line, 1);
                    }
                    // Delete lines in between
                    for (let i = start.line + 1; i < end.line; i++) {
                        this.#operations.deleteLine(start.line + 1);
                    }
                    this.#operations.joinLines(start.line, true);
                    this.move(start.line, start.column);
                }
            }
            return ret;
        }
    }

    #charAt(line=-1, column=-1) {
        if (line == -1)
            line = this.#line;
        if (column == -1)
            column = this.#column;
        if (line < 1 || line > this.#buffer.lines.length)
            return null;
        let lineChars = this.#buffer.lines[line - 1];
        if (column < 1 || column > lineChars.length)
            return null;
        return lineChars[column - 1];
    }

    #findPrevious(pattern, sameLine=true) {
        let line = this.#line;
        let column = this.#column;
        let lineChars = this.#buffer.lines[line - 1];
        let i = column - 2;
        while (i >= 0) {
            if (pattern.test(lineChars[i].symbol))
                break;
            i--;
        }
        if (!sameLine && i < 0) {
            while (line > 1) {
                line--;
                lineChars = this.#buffer.lines[line - 1];
                i = lineChars.length - 1;
                while (i >= 0) {
                    if (pattern.test(lineChars[i].symbol))
                        break;
                    i--;
                }
                if (i >= 0)
                    break;
            }
        }
        if (i < 0)
            return null;
        return {line, column: i + 1};
    }

    #findNext(pattern, sameLine=true, startAt=null, includeEOL=false) {
        let line = startAt?.line ?? this.#line;
        let column = startAt?.column ?? this.#column;
        let lineChars = this.#buffer.lines[line - 1];
        let i = column;
        while (i < lineChars.length) {
            if (pattern.test(lineChars[i].symbol))
                break;
            i++;
        }
        if (!sameLine && i >= lineChars.length) {
            while (line < this.#buffer.lines.length) {
                line++;
                lineChars = this.#buffer.lines[line - 1];
                i = 0;
                while (i < lineChars.length) {
                    if (pattern.test(lineChars[i].symbol))
                        break;
                    i++;
                }
                if (i < lineChars.length)
                    break;
            }
        }
        if (i >= lineChars.length && !includeEOL)
            return null;
        return {line, column: i + 1};
    }

    #findEnclosing(starting, ending, count=1) {
        let countBefore = count, countAfter = count;
        let start, end;
        let lines = this.#buffer.lines;
        let searchLine = this.#line - 1;
        let searchColumn = this.#column;
        if (lines[searchLine][searchColumn - 1].symbol == ending) {
            searchColumn--;
        }
        for (let i = 0; i < countBefore; i++) {
            searchColumn--;
            while (searchLine >= 0) {
                let line = lines[searchLine];
                let index = -1;
                for (let j = searchColumn; j >= 0; j--) {
                    if (line[j].symbol == ending) {
                        countBefore++;
                    }
                    if (line[j].symbol == starting) {
                        index = j;
                        break;
                    }
                }
                if (index == -1) {
                    searchLine--;
                    searchColumn = lines[searchLine].length - 1;
                } else {
                    searchColumn = index;
                    break;
                }
            }
            if (searchLine < 0)
                return null;
        }
        start = {line: searchLine + 1, column: searchColumn + 1, jump: true};
        searchLine = this.#line - 1;
        searchColumn = this.#column - 1;
        if (lines[searchLine][searchColumn].symbol == ending) {
            searchColumn--;
        }
        for (let i = 0; i < countAfter; i++) {
            searchColumn++;
            while (searchLine < lines.length) {
                let line = lines[searchLine];
                let index = -1;
                for (let j = searchColumn; j < line.length; j++) {
                    if (line[j].symbol == starting) {
                        countAfter++;
                    }
                    if (line[j].symbol == ending) {
                        index = j;
                        break;
                    }
                }
                if (index == -1) {
                    searchLine++;
                    searchColumn = 0;
                } else {
                    searchColumn = index;
                    break;
                }
            }
            if (searchLine >= lines.length)
                return null;
        }
        end = {line: searchLine + 1, column: searchColumn + 1, jump: true};
        return {start, end};
    }

    #findNextPredicate(pred, sameLine=true, startAt=null) {
        let line = startAt?.line ?? this.#line;
        let column = startAt?.column ?? this.#column;
        let lineChars = this.#buffer.lines[line - 1];
        let i = column;
        while (i < lineChars.length) {
            let cell = lineChars[i];
            let before = i > 0 ? lineChars[i - 1] : null;
            let after = i < lineChars.length - 1 ? lineChars[i + 1] : null;
            if (pred(cell, before, after))
                return {line, column: i + 1};
            i++;
        }
        if (!sameLine) {
            line++;
            while (line < this.#buffer.lines.length) {
                lineChars = this.#buffer.lines[line - 1];
                if (lineChars.length == 0) {
                    if (pred({symbol: ''}, null, null))
                        return {line, column: 1};
                }
                i = 0;
                while (i < lineChars.length) {
                    let cell = lineChars[i];
                    let before = i > 0 ? lineChars[i - 1] : null;
                    let after = i < lineChars.length - 1 ? lineChars[i + 1] : null;
                    if (pred(cell, before, after))
                        return {line, column: i + 1};
                    i++;
                }
                line++;
            }
        }
        return null;
    }

    #findPrevPredicate(pred, sameLine=true, startAt=null) {
        let line = startAt?.line ?? this.#line;
        let column = startAt?.column ?? this.#column;
        let lineChars = this.#buffer.lines[line - 1];
        let i = column - 2;
        while (i >= 0) {
            let cell = lineChars[i];
            let before = i > 0 ? lineChars[i - 1] : null;
            let after = i < lineChars.length - 1 ? lineChars[i + 1] : null;
            if (pred(cell, before, after))
                return {line, column: i + 1};
            i--;
        }
        if (!sameLine) {
            line--;
            while (line >= 1) {
                lineChars = this.#buffer.lines[line - 1];
                if (lineChars.length == 0) {
                    if (pred({symbol: ''}, null, null))
                        return {line, column: 1};
                }
                i = lineChars.length - 1;
                while (i >= 0) {
                    let cell = lineChars[i];
                    let before = i > 0 ? lineChars[i - 1] : null;
                    let after = i < lineChars.length - 1 ? lineChars[i + 1] : null;
                    if (pred(cell, before, after))
                        return {line, column: i + 1};
                    i--;
                }
                line--;
            }
        }
        return null;
    }

    #extendWhitespace(pos) {
        let line = this.#buffer.lines[pos.line - 1];
        if (line[pos.column].symbol != ' ')
            return;
        let i = pos.column;
        while (i < line.length && line[i].symbol == ' ') {
            i++;
        }
        pos.column = i;
    }

    #range(start, end, mode, exclusive) {
        return new ViRange(this.#buffer, start, end, mode, exclusive);
    }

    operandRange(opd) {
        let {count, motion, object, character} = opd;
        if (object) {
            let {inside, kind} = object;
            if (kind == 'word') {
                let start = this.#findPrevious(/\s/);
                if (!start)
                    start = {line: this.#line, column: 1};
                else
                    start.column++;
                let end = this.#findNext(/\s/);
                if (!end)
                    end = {line: this.#line, column: this.#buffer.lines[this.#buffer.lines.length - 1].length + 1};
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findNext(/\s/, false, {...end, column: end.column + 1}) || {line: this.#buffer.lines.length, column: this.#buffer.lines[this.#buffer.lines.length - 1].length + 1};
                    }
                }
                if (inside) {
                    end.column--;
                }
                return this.#range(start, end);
            } else if (kind == 'double-quote' || kind == 'single-quote') {
                let re = new RegExp(kind == 'double-quote' ? '"' : "'")
                let start = this.#findPrevious(re);
                if (!start)
                    return null;
                let end = this.#findNext(re);
                if (!end)
                    return null;
                if (inside) {
                    start.column++;
                    end.column--;
                } else {
                    this.#extendWhitespace(end);
                }
                return this.#range(start, end);
            } else if (kind == 'paren' || kind == 'brace' || kind == 'bracket' || kind == 'angle') {
                let charStart, charEnd
                console.log('inside', inside)
                switch (kind) {
                    case 'paren':
                        charStart = '(';
                        charEnd = ')';
                        break;
                    case 'brace':
                        charStart = '{';
                        charEnd = '}';
                        break;
                    case 'bracket':
                        charStart = '[';
                        charEnd = ']';
                        break;
                    case 'angle':
                        charStart = '<';
                        charEnd = '>';
                        break;
                }
                let enclosing = this.#findEnclosing(charStart, charEnd, count || 1);
                if (!enclosing)
                    return null;
                let {start, end} = enclosing;
                if (inside) {
                    start.column++;
                    end.column--;
                }
                return this.#range(start, end);
            } else if (kind == 'line') {
                let start = {line: this.#line, column: 1};
                let end = {line: this.#line, column: this.#buffer.lines[this.#line - 1].length + 1};
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = {line: end.line + 1, column: 1};
                    }
                }
                return this.#range(start, end, 'line');
            } else if (object == 'visual' || object.kind == 'visual') {
                if (!this.visualEnd) {
                    return null;
                }
                if (this.visualEnd.mode == 'line') {
                    return this.#range({line: this.#line, column: 1},
                        {line: this.visualEnd.line, column: this.#buffer.lines[this.visualEnd.line - 1].length + 1},
                        'line');
                } else if (this.visualEnd.mode == 'char') {
                    return this.#range({line: this.#line, column: this.#column},
                        {line: this.visualEnd.line, column: this.visualEnd.column}, 'char');
                } else {
                    return this.#range({line: this.#line, column: this.#column},
                        {line: this.visualEnd.line, column: this.visualEnd.column},
                        'block');
                }
            } else if (object == 'char' || object.kind == 'char') {
                let start = {line: this.#line, column: this.#column};
                let end = {line: this.#line, column: this.#column + (count ? count - 1 : 0)};
                return this.#range(start, end);
            } else if (object.kind == 'paragraph') {
                let toEndFirstPara = this.operandRange({motion: 'paragraph-forward'});
                this.move(toEndFirstPara.later.line, toEndFirstPara.later.column);
                let toStartFirstPara = this.operandRange({motion: 'paragraph-backward'});
                this.move(toStartFirstPara.earlier.line, toStartFirstPara.earlier.column);
                let range = this.operandRange({motion: 'paragraph-forward', count: count});
                if (inside) {
                    // Remove blank lines from either end of range
                    let start = range.earlier;
                    let end = range.later;
                    while (start.line < end.line && this.#buffer.lines[start.line - 1].length == 0) {
                        start.line++;
                    }
                    while (end.line > start.line && this.#buffer.lines[end.line - 1].length == 0) {
                        end.line--;
                    }
                    // end.column = this.#buffer.lines[end.line - 1].length;
                    return this.#range(start, end, 'line');
                } else {
                    // Remove blank lines from start of range, include all blank lines at end
                    let start = range.earlier;
                    let end = range.later;
                    while (start.line < end.line && this.#buffer.lines[start.line - 1].length == 0) {
                        start.line++;
                    }
                    while (end.line < this.#buffer.lines.length - 1 && this.#buffer.lines[end.line].length == 0) {
                        end.line++;
                    }
                    return this.#range(start, end, 'line');
                }
            } else if (object.kind == 'sentence') {
                let toEndFirstSentence = this.operandRange({motion: 'sentence-forward'});
                this.move(toEndFirstSentence.later.line, toEndFirstSentence.later.column);
                let toStartFirstSentence = this.operandRange({motion: 'sentence-backward'});
                this.move(toStartFirstSentence.earlier.line, toStartFirstSentence.earlier.column);
                let range = this.operandRange({motion: 'sentence-forward', count: count});
                range.end.column--;
                if (inside) {
                    // Remove whitespace from end of range
                    let start = range.earlier;
                    let end = range.later;
                    let theLine = this.#buffer.lines[end.line - 1];
                    while (end.column > 1 && theLine[end.column - 1].symbol == ' ') {
                        end.column--;
                    }
                    return this.#range(start, end, 'char', true);
                } else {
                    // Include whitespace at end of range
                    let start = range.earlier;
                    let end = range.later;
                    let theLine = this.#buffer.lines[end.line - 1];
                    while (end.column < theLine.length - 1 && theLine[end.column].whitespace) {
                        end.column++;
                    }
                    return this.#range(start, end, 'char', true);
                }
            }
        } else if (motion) {
            if (motion == 'endWord') {
                let start = {line: this.#line, column: this.#column};
                let end = this.#findNextPredicate((cell, before, after) => {
                    if (cell.wordChar && (!after || !after.wordChar)) {
                        return true;
                    }
                    if (!cell.whitespace && (!after || after.whitespace)) {
                        return true;
                    }
                    return false;
                }, false);
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findNextPredicate((cell, before, after) => {
                            if (cell.wordChar && (!after || !after.wordChar)) {
                                return true;
                            }
                            if (!cell.whitespace && (!after || after.whitespace)) {
                                return true;
                            }
                            return false;
                        }, false, end);
                    }
                }
                return this.#range(start, end, 'char', false);
            } else if (motion == 'word') {
                let start = {line: this.#line, column: this.#column};
                let end = this.#findNextPredicate((cell, before, after) => {
                    if (cell.wordChar && (!before || !before.wordChar)) {
                        return true;
                    }
                    if (!cell.whitespace && !cell.wordChar && (!before || before.whitespace || before.wordChar)) {
                        return true;
                    }
                    return false;
                }, false);
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findNextPredicate((cell, before, after) => {
                            if (cell.wordChar && (!before || !before.wordChar)) {
                                return true;
                            }
                            if (!cell.whitespace && !cell.wordChar && (!before || before.whitespace || before.wordChar)) {
                                return true;
                            }
                            return false;
                        }, false, end);
                    }
                }
                return this.#range(start, end, 'char', true);
            } else if (motion == 'backWord') {
                let start = {line: this.#line, column: this.#column > 1 ? this.#column - 1 : 1};
                let end = this.#findPrevPredicate((cell, before, after) => {
                    if (cell.wordChar && (!before || !before.wordChar)) {
                        return true;
                    }
                    if (!cell.whitespace && (!before || before.whitespace)) {
                        return true;
                    }
                    return false;
                }, false);
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findPrevPredicate((cell, before, after) => {
                            if (cell.wordChar && (!before || !before.wordChar)) {
                                return true;
                            }
                            if (!cell.whitespace && (!before || before.whitespace)) {
                                return true;
                            }
                            return false;
                        }, false, end);
                    }
                }
                return this.#range(start, end, 'char', false);
            } else if (motion == 'WORD') {
                let start = {line: this.#line, column: this.#column};
                let end = this.#findNextPredicate((cell, before, after) => {
                    if (!cell.whitespace && (!before || before.whitespace)) {
                        return true;
                    }
                    return false;
                }, false);
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findNextPredicate((cell, before, after) => {
                            if (!cell.whitespace && (!before || before.whitespace)) {
                                return true;
                            }
                            return false;
                        }, false, end);
                    }
                }
                return this.#range(start, end, 'char', true);
            } else if (motion == 'backWORD') {
                let start = {line: this.#line, column: this.#column > 1 ? this.#column - 1 : 1};
                let end = this.#findPrevPredicate((cell, before, after) => {
                    if (!cell.whitespace && (!before || before.whitespace)) {
                        return true;
                    }
                    return false;
                }, false);
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findPrevPredicate((cell, before, after) => {
                            if (!cell.whitespace && (!before || before.whitespace)) {
                                return true;
                            }
                            return false;
                        }, false, end);
                    }
                }
                return this.#range(start, end, 'char', false);
            } else if (motion == 'down') {
                let start = {line: this.#line, column: this.#column};
                let end = {line: this.#line + (count || 1), column: this.#column};
                return this.#range(start, end, 'line');
            } else if (motion == 'up') {
                let start = {line: this.#line, column: this.#column};
                let end = {line: this.#line - (count || 1), column: this.#column};
                return this.#range(start, end, 'line');
            } else if (motion == 'right') {
                let start = {line: this.#line, column: this.#column};
                let end = {line: this.#line, column: this.#column + (count ? count - 1 : 1), exclusive: true};
                return this.#range(start, end, 'char', true);
            } else if (motion == 'left') {
                let end = {line: this.#line, column: this.#column - 1};
                let start = {line: this.#line, column: this.#column - (count || 1)};
                return this.#range(start, end);
            } else if (motion == 'endLine') {
                let start = {line: this.#line, column: this.#column};
                let end = {line: this.#line, column: this.#buffer.lines[this.#line - 1].length + 1, exclusive: true};
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = {line: end.line + 1, column: this.#buffer.lines[end.line].length + 1, exclusive: true};
                    }
                }
                return this.#range(start, end);
            } else if (motion == 'startLine') {
                let end = {line: this.#line, column: 1};
                let start = {line: this.#line, column: this.#column - 1};
                return this.#range(start, end,);
            } else if (motion == 'firstNonBlank') {
                let line = this.#buffer.lines[this.#line - 1];
                let i = 0;
                while (i < line.length && line[i].symbol == ' ') {
                    i++;
                }
                let start = {line: this.#line, column: this.#column};
                let end = {line: this.#line, column: i + 1};
                return this.#range(start, end);
            } else if (motion == 'gotoLine') {
                let start = {line: this.#line, column: this.#column};
                let end = {line: count || this.#buffer.lines.length, column: 1, jump: true};
                return this.#range(start, end, 'line');
            } else if (motion == 'column') {
                let start = {line: this.#line, column: this.#column};
                let end = {line: this.#line, column: count || 1};
                return this.#range(start, end);
            } else if (motion == 'findChar') {
                let start = {line: this.#line, column: this.#column};
                if (!opd.redirected)
                    this.#lastFind = 'findChar';
                this.#lastFindChar = character;
                let end = this.#findNext(new RegExp(character), true, start);
                return this.#range(start, end);
            } else if (motion == 'findCharBack') {
                let start = {line: this.#line, column: this.#column};
                if (!opd.redirected)
                    this.#lastFind = 'findCharBack';
                this.#lastFindChar = character;
                let end = this.#findPrevious(new RegExp(character), true);
                return this.#range(start, end);
            } else if (motion == 'tillChar') {
                let start = {line: this.#line, column: this.#column};
                if (!opd.redirected)
                    this.#lastFind = 'tillChar';
                this.#lastFindChar = character;
                let end = this.#findNext(new RegExp(character), true);
                if (end)
                    end.column--;
                return this.#range(start, end);
            } else if (motion == 'tillCharBack') {
                let start = {line: this.#line, column: this.#column};
                if (!opd.redirected)
                    this.#lastFind = 'tillCharBack';
                this.#lastFindChar = character;
                let end = this.#findPrevious(new RegExp(character), true);
                if (end)
                    end.column++;
                return this.#range(start, end);
            } else if (motion == 'repeatFind') {
                opd.motion = this.#lastFind;
                opd.character = this.#lastFindChar;
                opd.redirected = 'true';
                return this.operandRange(opd);
            } else if (motion == 'repeatFindReverse') {
                opd.motion = this.#lastFind.replace('Back', '') + (this.#lastFind.includes('Back') ? '' : 'Back');
                opd.character = this.#lastFindChar;
                opd.redirected = 'true';
                return this.operandRange(opd);
            } else if (motion == 'markLine') {
                let mark = this.#buffer.getMark(character);
                if (character == '`' || character == "'")
                    mark = this.#previousContextMark;
                else if (!mark)
                    return null;
                let start = {line: this.#line, column: this.#column};
                let end = {...mark, column: 1, jump: true};
                return this.#range(start, end, 'line');
            } else if (motion == 'markChar') {
                let mark = this.#buffer.getMark(character);
                if (character == '`' || character == "'")
                    mark = this.#previousContextMark;
                else if (!mark)
                    return null;
                let start = {line: this.#line, column: this.#column};
                let end = {...mark, jump: true};
                return this.#range(start, end, 'char', true);
            } else if (motion == 'line') {
                let start = {line: this.#line, column: this.#column};
                let endLine = this.#line + (count ? count - 1 : 0);
                let bufLine = this.#buffer.lines[endLine - 1];
                for (let i = 0; i < bufLine.length; i++) {
                    if (bufLine[i].symbol != ' ' && bufLine.symbol != '\t') {
                        return this.#range(start, {line: endLine, column: i + 1}, 'line');
                    }
                }
                let end = {line: endLine, column: 1};
                return this.#range(start, end, 'line');
            } else if (motion == 'match') {
                let theLine = this.#buffer.lines[this.#line - 1];
                let cur = {line: this.#line, column: this.#column};
                for (let col = this.#column; col <= theLine.length; col++) {
                    if (theLine[col - 1].symbol == '(') {
                        this.move(this.#line, col);
                        let {start, end} = this.#findEnclosing('(', ')');
                        if (end) {
                            return this.#range(cur, end);
                        }
                    } else if (theLine[col - 1].symbol == '{') {
                        this.move(this.#line, col);
                        let {start, end} = this.#findEnclosing('{', '}');
                        if (end) {
                            this.#range(cur, end);
                        }
                    } else if (theLine[col - 1].symbol == '[') {
                        this.move(this.#line, col);
                        let {start, end} = this.#findEnclosing('[', ']');
                        if (end) {
                            return this.#range(cur, end);
                        }
                    } else if (theLine[col - 1].symbol == ')') {
                        this.move(this.#line, col);
                        console.log('finding enclosing for ) at', this.#line, col);
                        let {start, end} = this.#findEnclosing('(', ')');
                        console.log(start)
                        console.log(end)
                        if (start) {
                           return this.#range(cur, start);
                        }
                    } else if (theLine[col - 1].symbol == '}') {
                        this.move(this.#line, col);
                        let {start, end} = this.#findEnclosing('{', '}');
                        if (start) {
                            return this.#range(cur, start);
                        }
                    } else if (theLine[col - 1].symbol == ']') {
                        this.move(this.#line, col);
                        let {start, end} = this.#findEnclosing('[', ']');
                        if (start) {
                            return this.#range(cur, start);
                        }
                    }

                }
            } else if (motion == 'paragraph-forward') {
                let lines = this.#buffer.range(this.#line - 1, this.#buffer.lines.length);
                let start = this.#line;
                for (let i = 0; i < (count || 1); i++) {
                    let line = lines.shift();
                    console.log('count', i, 'line last', line.at(-1))
                    let seenNonBlank = line.length > 0;
                    while (lines.length && (!seenNonBlank || line.length > 0)) {
                        start++;
                        line = lines.shift();
                        seenNonBlank ||= line.length > 0;
                    }
                    lines.unshift(line);
                }
                return this.#range({line: this.#line, column: this.#column},
                    {line: start, column: 1, jump: true}, 'line');
            } else if (motion == 'paragraph-backward') {
                let lines = this.#buffer.range(0, this.#line).reverse();
                let start = this.#line;
                for (let i = 0; i < (count || 1); i++) {
                    let line = lines.shift();
                    let seenNonBlank = line.length > 0;
                    while (lines.length && (!seenNonBlank || line.length > 0)) {
                        start--;
                        line = lines.shift();
                        seenNonBlank ||= line.length > 0;
                    }
                    lines.unshift(line);
                }
                return this.#range({line: this.#line, column: this.#column},
                    {line: Math.max(1, start), column: 1, jump: true}, 'line');
            } else if (motion == 'sentence-forward') {
                let start = {line: this.#line, column: this.#column};
                let end = this.#findNextPredicate((cell, before, after) => {
                    if ('.?!'.includes(cell.symbol) && (!after || after.whitespace)) {
                        return true;
                    }
                    if (!before && !after && !cell.symbol)
                        return true;
                    return false;
                }, false);
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findNextPredicate((cell, before, after) => {
                            if ('.?!'.includes(cell.symbol) && (!after || after.whitespace)) {
                                return true;
                            }
                            if (!before && !after && !cell.symbol)
                                return true;
                            return false;
                        }, false, end);
                    }
                }
                end = this.#findNextPredicate((cell, before, after) => {
                    if (!cell.whitespace) {
                        return true;
                    }
                    return false;
                }, false, end);
                return this.#range(start, end, 'char', true);
            } else if (motion == 'sentence-backward') {
                let start = {line: this.#line, column: this.#column - 1};
                while (start.column > 1 && this.#charAt(start.line, start.column).whitespace) {
                    start.column--;
                }
                let end = this.#findPrevPredicate((cell, before, after) => {
                    if (before && '.?!'.includes(before.symbol) && (cell.whitespace)) {
                        return true;
                    }
                    if (!before && !after && !cell.symbol)
                        return true;
                    return false;
                }, false, start);
                if (count > 1) {
                    for (let i = 0; i < count - 1; i++) {
                        end = this.#findPrevPredicate((cell, before, after) => {
                            if (before && '.?!'.includes(before.symbol) && (cell.whitespace)) {
                                return true;
                            }
                            if (!before && !after && !cell.symbol)
                                return true;
                            return false;
                        }, false, end);
                    }
                }
                end = this.#findNextPredicate((cell, before, after) => {
                    if (!cell.whitespace) {
                        return true;
                    }
                    return false;
                }, false, end);
                return this.#range(start, end);
            } else if (motion == 'search') {
                let line = this.#line;
                let column = this.#column + (character ? 0 : 1);
                while (line <= this.#buffer.lines.length) {
                    let lineChars = this.#buffer.lines[line - 1];
                    while (column <= lineChars.length) {
                        let match = this.#buffer.matchAt(line, column, opd.pattern);
                        if (match) {
                            return this.#range({line, column: column + match.length, jump: true}, {line, column, jump: true});
                        }
                        column++;
                    }
                    line++;
                    column = 1;
                }
            } else if (motion == 'searchBack') {
                let line = this.#line;
                let column = this.#column - 1;
                while (line >= 1) {
                    let lineChars = this.#buffer.lines[line - 1];
                    while (column >= 1) {
                        let match = this.#buffer.matchAt(line, column, opd.pattern);
                        if (match) {
                            return this.#range({line, column: column + match.length, jump: true}, {line, column: column, jump: true});
                        }
                        column--;
                    }
                    line--;
                    column = this.#buffer.lines[line - 1].length;
                }
            }
        }
    }

    moveOperand(opd) {
        let range = this.operandRange(opd);
        if (range && range.end) {
            if (range.end.jump) {
                this.#previousContextMark = {line: this.#line, column: this.#column};
            }
            this.move(range.end.line, range.end.column);
        }
    }

    indent(opd, unindent=false) {
        let range = this.operandRange(opd);
        if (range) {
            let {earlier, later} = range;
            for (let i = earlier.line; i <= later.line; i++) {
                this.#operations.indentLine(i, unindent);
            }
        }
    }

    toggleCase(opd) {
        let range = this.operandRange(opd);
        if (range) {
            let {linewise, blockwise} = range;
            let start = range.earlier;
            let end = range.later;
            if (blockwise) {
                for (let i = start.line; i <= end.line; i++) {
                    let line = this.#buffer.lines[i - 1];
                    for (let j = start.column - 1; j < end.column; j++) {
                        let cell = line[j];
                        if (cell.symbol != ' ') {
                            if (cell.symbol == cell.symbol.toUpperCase()) {
                                cell.symbol = cell.symbol.toLowerCase();
                            } else {
                                cell.symbol = cell.symbol.toUpperCase();
                            }
                        }
                    }
                }
            } else if (linewise) {
                for (let i = start.line; i <= end.line; i++) {
                    let line = this.#buffer.lines[i - 1];
                    for (let j = 0; j < line.length; j++) {
                        let cell = line[j];
                        if (cell.symbol != ' ') {
                            if (cell.symbol == cell.symbol.toUpperCase()) {
                                cell.symbol = cell.symbol.toLowerCase();
                            } else {
                                cell.symbol = cell.symbol.toUpperCase();
                            }
                        }
                    }
                }
            } else {
                if (start.line == end.line) {
                    let line = this.#buffer.lines[start.line - 1];
                    for (let i = start.column - 1; i < end.column; i++) {
                        let cell = line[i];
                        if (cell.symbol != ' ') {
                            if (cell.symbol == cell.symbol.toUpperCase()) {
                                cell.symbol = cell.symbol.toLowerCase();
                            } else {
                                cell.symbol = cell.symbol.toUpperCase();
                            }
                        }
                    }
                } else {
                    let line = this.#buffer.lines[start.line - 1];
                    for (let i = start.column - 1; i < line.length; i++) {
                        let cell = line[i];
                        if (cell.symbol != ' ') {
                            if (cell.symbol == cell.symbol.toUpperCase()) {
                                cell.symbol = cell.symbol.toLowerCase();
                            } else {
                                cell.symbol = cell.symbol.toUpperCase();
                            }
                        }
                    }
                    for (let i = start.line + 1; i < end.line; i++) {
                        line = this.#buffer.lines[i - 1];
                        for (let j = 0; j < line.length; j++) {
                            let cell = line[j];
                            if (cell.symbol != ' ') {
                                if (cell.symbol == cell.symbol.toUpperCase()) {
                                    cell.symbol = cell.symbol.toLowerCase();
                                } else {
                                    cell.symbol = cell.symbol.toUpperCase();
                                }
                            }
                        }
                    }
                    line = this.#buffer.lines[end.line - 1];
                    for (let i = 0; i < end.column; i++) {
                        let cell = line[i];
                        if (cell.symbol != ' ') {
                            if (cell.symbol == cell.symbol.toUpperCase()) {
                                cell.symbol = cell.symbol.toLowerCase();
                            } else {
                                cell.symbol = cell.symbol.toUpperCase();
                            }
                        }
                    }
                }
            }
        }
    }

    paste(register, before=false) {
        let prevMode = this.mode;
        this.mode = 'insert';
        if (register.linewise) {
            if (before) {
                this.#line--;
            }
            for (let line of register.text) {
                this.#operations.insertLine(this.#line + 1, 1);
                this.move(this.#line + 1, 1);
                for (let i = 0; i < line.length; i++) {
                    this.insert(line[i].symbol);
                }
            }
            this.move(this.#line, 1);
        } else {
            if (register.text.length > 1) {
                // Split the current line at this point
                if (before) {
                    let origLine = this.#line;
                    let origColumn = this.#column;
                    this.#operations.insertLine(this.#line, this.#column);
                    this.move(origLine, origColumn);
                } else {
                    this.#operations.insertLine(this.#line, this.#column + 1);
                    this.right();
                }
                // Insert the text from the first pasted line at the (new) end of the current line
                for (let i = 0; i < register.text[0].length; i++) {
                    this.insert(register.text[0][i].symbol);
                }
                // Insert the text of the *last* line at the start of the newly-created next line
                let lastLine = register.text.at(-1);
                this.move(this.#line + 1, 1);
                for (let i = 0; i < lastLine.length; i++) {
                    this.insert(lastLine[i].symbol);
                }
                // Insert the intermediate lines in between
                this.move(this.#line - 1, 1);
                for (let i = 1; i < register.text.length - 1; i++) {
                    this.#operations.insertLine(this.#line + 1, 1);
                    this.move(this.#line + 1, 1);
                    for (let j = 0; j < register.text[i].length; j++) {
                        this.insert(register.text[i][j].symbol);
                    }
                }
                this.move(this.#line, lastLine.length);
            } else {
                if (!before)
                    this.right();
                for (let i = 0; i < register.text[0].length; i++) {
                    this.insert(register.text[0][i].symbol);
                }
                if (!before)
                    this.left();
            }

        }
        this.mode = prevMode;
    }

    yankOperand(opd) {
        let range = this.operandRange(opd);
        if (range) {
            let ret = range.fixed();
            console.log('yanked', ret)
            return ret;
        } else {
            console.log('range undefined for', opd);
        }
    }

    joinLines(count=1) {
        if (count > 1)
            count--;
        for (let i = 0; i < count; i++) {
            this.#operations.joinLines(this.#line);
        }
    }

    toTag() {
        function isKeywordChar(c) {
            return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.includes(c);
        }
        let line = this.#buffer.lines[this.#line - 1];
        let start = this.#column - 1;
        let end = start;
        if (line[start].tagDest) {
            let tag = this.#buffer.tag(line[start].tagDest);
            if (tag) {
                this.#previousContextMark = {line: this.#line, column: this.#column};
                this.move(tag.line, tag.column);
            }
            return;
        }
        while (start >= 0 && isKeywordChar(line[start].symbol)) {
            start--;
        }
        start++;
        while (end < line.length && isKeywordChar(line[end].symbol)) {
            end++;
        }
        let tagText = line.slice(start, end).map(cell => cell.symbol).join('');
        let tag = this.#buffer.tag(tagText);
        if (tag) {
            this.#previousContextMark = {line: this.#line, column: this.#column};
            this.move(tag.line, tag.column);
        }
        return tagText;
    }

    dispose() {
        this.#operations.dispose();
    }

    isAt(line, column) {
        return this.#line == line && this.#column == column;
    }

    startVisual(mode='char') {
        if (!this.visualEnd)
            this.visualEnd = {line: this.#line, column: this.#column, mode};
        else
            this.visualEnd.mode = mode;
        this.matchingSelections = null;
    }

    endVisual() {
        let top = Math.min(this.#line, this.visualEnd.line);
        let left
        if (this.visualEnd.mode == 'block') {
            left = Math.min(this.#column, this.visualEnd.column);
        } else if (this.#line == this.visualEnd.line) {
            left = Math.min(this.#column, this.visualEnd.column);
        } else if (this.#line < this.visualEnd.line) {
            left = this.#column;
        } else {
            left = this.visualEnd.column;
        }
        this.visualEnd = null;
        this.matchingSelections = null;
        this.move(top, left);
    }

    visualSwap(horizontal) {
        if (!this.visualEnd)
            return;
        let {line, column} = this.visualEnd;
        if (horizontal) {
            this.visualEnd = {line, column: this.#column, mode: this.visualEnd.mode};
            this.move(this.#line, column);
        } else {
            this.visualEnd = {line: this.#line, column: this.#column, mode: this.visualEnd.mode};
            this.move(line, column);
        }
    }

    setVisualOperand(opd) {
        let range = this.operandRange(opd);
        if (range) {
            if (opd.motion) {
                this.move(range.end.line, range.end.column);
            } else {
                this.visualEnd = {mode: range.mode, ...range.end};
                this.move(range.start.line, range.start.column);
            }
            if (this.visualEnd.mode == 'char') {
                this.#findMatchingSelections();
            }
        }
    }

    #findMatchingSelections() {
        if (this.visualEnd && this.visualEnd.mode == 'char' && this.visualEnd.line == this.#line) {
            let matchingRanges = [];
            let symbols = [];
            let low = Math.min(this.#column, this.visualEnd.column);
            let high = Math.max(this.#column, this.visualEnd.column);
            let line = this.#buffer.lines[this.#line - 1];
            for (let i = low; i <= high; i++) {
                symbols.push(line[i - 1].symbol);
            }
            // Look in the following lines for the same sequence of symbols
            let lineNum = 1;
            while (lineNum <= this.#buffer.lines.length) {
                let line = this.#buffer.lines[lineNum - 1];
                line: for (let col = 0; col < line.length - symbols.length; col++) {
                    if (lineNum == this.#line && col + 1 >= low && col <= high)
                        continue;
                    for (let i = 0; i < symbols.length; i++) {
                        if (line[col + i].symbol != symbols[i])
                            continue line;
                    }
                    matchingRanges.push(new ViRange(this.#buffer, {line: lineNum, column: col + 1},
                        {line: lineNum, column: col + symbols.length}));
                }
                lineNum++;
            }
            this.matchingSelections = matchingRanges;
        }

    }

    extend(opd, context) {
        let {multi, last} = context ?? {};
        if (opd.motion == 'next-selection') {
            if (!this.matchingSelections)
                return multi ?? this;
            for (let range of this.matchingSelections) {
                if (last) {
                    if (range.start.line < last.line || (range.start.line == last.line && range.start.column <= last.column)) {
                        continue;
                    }
                }
                if (range.start.line > this.#line || (range.start.line == this.#line && range.start.column > this.#column)) {
                    let startColumn = range.start.column;
                    let endColumn = range.end.column;
                    if (this.#column < this.visualEnd.column) {
                        startColumn = range.end.column;
                        endColumn = range.start.column;
                    }
                    let nextCursor = this.#buffer.getCursor(range.start.line, startColumn);
                    nextCursor.startVisual(this.visualEnd.mode);
                    nextCursor.move(range.end.line, endColumn);
                    if (multi) {
                        multi.addCursor(nextCursor);
                        return multi;
                    }
                    let mc = new MultiCursor(this, nextCursor);
                    return mc;
                }
            }
        } else if (opd.motion == 'down' || opd.motion == 'up') {
            let nextLine = this.#line + (opd.motion == 'down' ? 1 : -1);
            if (nextLine <= this.#buffer.lines.length && nextLine >= 1) {
                let nextCursor = this.#buffer.getCursor(nextLine, this.#column);
                if (multi) {
                    multi.addCursor(nextCursor);
                    return multi;
                }
                let mc = new MultiCursor(this, nextCursor);
                return mc;
            }
        } else if (opd.motion == 'down-skip' || opd.motion == 'up-skip') {
            let nextLine = this.#line + (opd.motion == 'down-skip' ? 1 : -1) * (opd.count || 1);
            if (nextLine <= this.#buffer.lines.length && nextLine >= 1) {
                let nextCursor = this.#buffer.getCursor(nextLine, this.#column);
                if (multi) {
                    multi.addCursor(nextCursor);
                    return multi;
                }
                let mc = new MultiCursor(this, nextCursor);
                return mc;
            }
        }
        return multi ?? this;
    }

    highlightAt(line, column) {
        if (this.matchingSelections) {
            for (let range of this.matchingSelections) {
                if (range.contains(line, column))
                    return true;
            }
        }
        return false;
    }

    selectedAt(line, column) {
        if (!this.visualEnd)
            return false;
        let low, high;
        if (this.#line < this.visualEnd.line || (this.#line == this.visualEnd.line && this.#column < this.visualEnd.column)) {
            low = {line: this.#line, column: this.#column};
            high = this.visualEnd;
        } else {
            low = this.visualEnd;
            high = {line: this.#line, column: this.#column};
        }
        if (this.visualEnd.mode == 'block') {
            let lowLine = Math.min(low.line, high.line);
            let highLine = Math.max(low.line, high.line);
            let lowColumn = Math.min(low.column, high.column);
            let highColumn = Math.max(low.column, high.column);
            return line >= lowLine && line <= highLine && column >= lowColumn && column <= highColumn
        } else if (this.visualEnd.mode == 'line') {
            return line >= low.line && line <= high.line;
        } else {
            if (line < low.line || line > high.line)
                return false;
            if (low.line == high.line)
                return line == low.line && column >= low.column && column <= high.column;
            if (line > low.line && line < high.line)
                return true;
            if (line == low.line && column >= low.column)
                return true;
            if (line == high.line && column <= high.column)
                return true;
            return false;
        }
    }

    replace(operand) {
        let range = this.operandRange(operand);
        let replacement = operand.character ?? operand.other;
        if (range) {
            let start = range.earlier;
            let end = range.later;
            let {linewise, text} = range;
            if (linewise) {
                for (let i = 0; i < text.length; i++) {
                    for (let j = 0; j < text[i].length; j++) {
                        this.#operations.setChar(replacement, start.line + i, j + 1);
                    }
                }
            } else { // TODO: blockwise
                // First line
                for (let j = 0; j < text[0].length; j++) {
                    this.#operations.setChar(replacement, start.line, start.column + j);
                }
                // Middle lines
                for (let i = 1; i < text.length - 1; i++) {
                    for (let j = 0; j < text[i].length; j++) {
                        this.#operations.setChar(replacement, start.line + i, j + 1);
                    }
                }
                // Last line (if any)
                if (text.length > 1) {
                    for (let j = 0; j < text.at(-1).length; j++) {
                        this.#operations.setChar(replacement, end.line, j + 1);
                    }
                }
            }
        }
    }
}

class ViBufferView {
    #buffer
    #start
    #rows
    #cols
    #layout
    #cellWidth = 7.25;
    #charWidths = {};
    constructor(buffer, start, rows, cols) {
        this.#buffer = buffer;
        this.#start = start;
        this.#rows = rows;
        this.#cols = cols;
        let canvas = document.createElement('canvas');
    }

    get rows() {
        return this.#rows;
    }

    set rows(val) {
        this.#rows = val;
    }

    get cols() {
        return this.#cols;
    }

    set cols(val) {
        this.#cols = val;
    }

    set cellWidth(val) {
        this.#cellWidth = val;
        this.#charWidths = {};
    }

    at(x, y) {
        let cell = this.#layout[y - 1][x - 1];
        if (!cell) {
            let lineCell = this.#layout[y - 1].at(-1);
            return {x: lineCell.column + (x - lineCell.displayColumn), y: lineCell.line, content: {}};
        }
        return {x: cell.column, y: cell.line, content: cell};
    }

    layOut() {
        let canvas = new OffscreenCanvas(100, 50);
        let ctx = canvas.getContext('2d');
        ctx.font = '13px monospace';
        let range = this.#buffer.range(this.#start, this.#rows);
        let lines = new Array(this.#rows);
        this.#layout = lines
        let physLine = 0;
        let physCol = 0;
        let spaceCol = 0;
        for (let i = 0; i < this.#rows; i++) {
            let line = [];
            lines[i] = line;
            let phys = range[physLine];
            if (!phys) {
                line.push({symbol: '~', line: this.#start + physLine + 1, column: 1, displayColumn: 1, displayLine: i + 1});
                physLine++;
                continue;
            }
            for (let j = 0; j < this.#cols; j++) {
                let cell = phys[physCol];
                if (!cell) {
                    if (j == 0) {
                        line.push({symbol: null, line: this.#start + physLine + 1, column: 1, displayColumn: 1, displayLine: i + 1, spaceColumn: spaceCol + 1});
                    }
                    physLine++;
                    physCol = 0;
                    spaceCol = 0;
                    break;
                }
                if (cell.symbol) {
                    if (!this.#charWidths[cell.symbol]) {
                        // Compute rendered width of this character in cells (best effort)
                        let metrics = ctx.measureText(cell.symbol);
                        this.#charWidths[cell.symbol] = Math.ceil(metrics.width / this.#cellWidth, 1);
                    }
                    cell.width = this.#charWidths[cell.symbol];
                }
                if (cell.imageCols) {
                    line.push({...cell, line: this.#start + physLine + 1, column: physCol + 1, displayColumn: j + 1, displayLine: i + 1, spaceColumn: spaceCol + 1});
                    for (let t = 1; t < cell.imageCols; t++)
                        line.push({symbol: null, line: this.#start + physLine + 1, column: physCol + 1, displayColumn: j + 1 + t, displayLine: i + 1, spaceColumn: spaceCol + 1});
                    j += cell.imageCols - 1;
                    spaceCol += cell.imageCols - 1;
                } else if (cell.symbol == '\t') {
                    let spacesToFill = 8 - (j % 8);
                    for (let t = 0; t < spacesToFill; t++) {
                        line.push({...cell, line: this.#start + physLine + 1, column: physCol + 1, displayColumn: j + t + 1, displayLine: i + 1, spaceColumn: spaceCol + 1});
                    }
                    j += spacesToFill - 1;
                    spaceCol += spacesToFill - 1;
                } else if (cell.width > 1) {
                    line.push({...cell, line: this.#start + physLine + 1, column: physCol + 1, displayColumn: j + 1, displayLine: i + 1, spaceColumn: spaceCol + 1});
                    for (let t = 1; t < cell.width; t++)
                        line.push({symbol: null, line: this.#start + physLine + 1, column: physCol + 1, displayColumn: j + t + 1, displayLine: i + 1, spaceColumn: spaceCol + 1});
                    j += cell.width - 1;
                    spaceCol += cell.width - 1;
                } else {
                    line.push({...cell, line: this.#start + physLine + 1, column: physCol + 1, displayColumn: j + 1, displayLine: i + 1, spaceColumn: spaceCol + 1});
                }
                physCol++;
                spaceCol++;
            }

        }
        return lines;
    }

    get lines() {
        if (!this.#layout)
            this.layOut();
        return this.#layout;
    }

    get height() {
        return this.#rows;
    }

    get width() {
        return this.#cols;
    }

    up() {
        if (this.#start == 0)
            return false;
        this.#start--;
        return true;
    }

    down() {
        if (this.#start + 1 >= this.#buffer.lines.length)
            return false;
        this.#start++;
        return true;
    }

    splice(y, x, len, text) {
        this.#buffer.splice(y + this.#start, x, len, text);
    }

    spliceLines(y, len, text) {
        this.#buffer.spliceLines(y + this.#start, len, text.split('\n'));
    }

    // Return y unchanged if it is within the range of the view, otherwise
    // return the nearest valid value.
    clampLine(y) {
        if (y < 0)
            return 0;
        if (y >= this.#rows)
            return this.#rows - 1;
        if (this.#buffer.lines.length <= this.#start + y) {
            return this.#buffer.lines.length - this.#start - 1;
        }
        return y;
    }

    clampOrScroll(y) {
        if (y < 0) {
            while (y < 0 && this.up()) {
                y++;
            }
            return 0;
        }
        if (y >= this.#rows) {
            this.down();
            return this.#rows - 1;
        }
        return y;
    }

    goToLine(y) {
        if (y < 0)
            return 0;
        if (y < this.#start) {
            let diff = this.#start - y;
            this.#start -= diff;
        } else if (y >= this.#start + this.#rows) {
            let diff = y - (this.#start + this.#rows) + 1;
            this.#start += diff;
        }
        if (y == this.#start) {
            for (let i = 0; i < 4; i++) {
                if (!this.up())
                    break;
            }
        } else if (y == this.#start + this.#rows - 1) {
            for (let i = 0; i < 3; i++) {
                if (!this.down())
                    break;
            }
        }
        return y - this.#start;
    }

    cursorAt(cursor, y, x) {
        let layoutLine = this.#layout[y];
        let layoutCell = layoutLine[x];
        if (!layoutCell) {
            let lastCell = layoutLine.at(-1);
            if (!lastCell)
                return false;
            if (lastCell.displayColumn == x)
                return cursor.isAt(lastCell.line, lastCell.column + 1);
            return false;
        }
        return cursor.isAt(layoutCell.line, layoutCell.column);
    }

    cursorTo(cursor, y, x) {
        let layoutLine = this.#layout[y];
        if (!layoutLine)
            return false;
        let layoutCell = layoutLine[x];
        if (!layoutCell)
            layoutCell = layoutLine.at(-1);
        cursor.move(layoutCell.line, layoutCell.column);
    }

    scrollTo(cursor, displayLine) {
        let currentDisplayLine;
        // Find which display line the cursor is on
        for (let i = 0; i < this.#rows; i++) {
            let layoutLine = this.#layout[i];
            for (let j = 0; j < layoutLine.length; j++) {
                let layoutCell = layoutLine[j];
                if (cursor.isAt(layoutCell.line, layoutCell.column)) {
                    currentDisplayLine = i;
                    break;
                }
            }
        }
        console.log('current display line', currentDisplayLine, 'display line', displayLine);
        let diff = displayLine - currentDisplayLine;
        console.log('diff', diff);
        if (diff < 0) {
            for (let i = 0; i < -diff; i++) {
                this.down();
            }
        } else if (diff > 0) {
            for (let i = 0; i < diff; i++) {
                this.up();
            }
        }
    }

    setScreenMotion(operand) {
        if (operand.screenMotion == 'middle') {
            let line = Math.floor(this.#rows / 2);
            operand.motion = 'gotoLine';
            operand.count = this.#layout[line][0].line;
        } else if (operand.screenMotion == 'top') {
            let c = (operand.count || 1) - 1;
            if (c >= this.#rows)
                c = this.#rows - 1;
            operand.motion = 'gotoLine';
            operand.count = this.#layout[c][0].line;
        } else if (operand.screenMotion == 'bottom') {
            let c = (operand.count || 1);
            if (c >= this.#rows)
                c = this.#rows;
            operand.motion = 'gotoLine';
            operand.count = this.#layout.at(-c)[0].line;
        }
    }

    selectedAt(cursor, y, x) {
        let layoutLine = this.#layout[y];
        let layoutCell = layoutLine[x];
        if (!layoutCell) {
            let lastCell = layoutLine.at(-1);
            if (!lastCell)
                return false;
            layoutCell = {...lastCell, column: lastCell.column + (x - lastCell.displayColumn) + 1};
        }
        return cursor.selectedAt(layoutCell.line, layoutCell.column);
    }

    highlightAt(cursor, y, x) {
        let layoutLine = this.#layout[y];
        let layoutCell = layoutLine[x];
        if (!layoutCell) {
            let lastCell = layoutLine.at(-1);
            if (!lastCell)
                return false;
            layoutCell = {...lastCell, column: lastCell.column + (x - lastCell.displayColumn) + 1};
        }
        return cursor.highlightAt(layoutCell.line, layoutCell.column);
    }

    ensureVisible(cursor, minimiseMovement=false) {
        if (cursor.line - 1 < this.#start) {
            let diff = this.#start - cursor.line + 1;
            this.#start -= diff;
        } else if (cursor.line - 1 >= this.#start + this.#rows) {
            let diff = cursor.line - (this.#start + this.#rows) + 1;
            this.#start += diff;
        }
        let offset = 4;
        if (minimiseMovement) {
            offset = 1;
        }
        if (cursor.line - 1 < this.#start + offset) {
            let padding = this.#start + offset - cursor.line;
            for (let i = 0; i < padding; i++) {
                if (!this.up())
                    break;
            }
        }
        if (cursor.line - 1 >= this.#start + this.#rows - offset) {
            let padding = cursor.line - (this.#start + this.#rows) + offset - 1;
            for (let i = 0; i < padding; i++) {
                if (!this.down())
                    break;
            }
        }
        // Crude approximation
        let wrappedLines = 0;
        for (let i = this.#start; i < cursor.line - 1; i++) {
            let line = this.#buffer.lines[i];
            if (line.length > this.#cols)
                wrappedLines += Math.ceil(line.length / this.#cols) - 1;
        }
        if (wrappedLines) {
            while (this.#start + this.#rows - wrappedLines - 1 < cursor.line) {
                this.down();
                wrappedLines = 0;
                for (let i = this.#start; i < cursor.line - 1; i++) {
                    let line = this.#buffer.lines[i];
                    if (line.length > this.#cols)
                        wrappedLines += Math.ceil(line.length / this.#cols) - 1;
                }
            }
        }
    }
}

class CommandKey {
    constructor(key, changer) {
        this.key = key;
        this.changer = changer;
    }

    accepts(key, command) {
        return key == this.key;
    }

    handle(key, command) {
        let ret = this.changer(key, command);
        return ret ?? [];
    }

    toString() {
        return this.key;
    }
}

const character = {
    accepts(key, command) {
        return key != 'Escape';
    },
    handle(key, command) {
        command.operand.character = key;
        return [];
    },
    toString() {
        return 'character';
    },
    withOperation(operation) {
        return {
            ...this,
            handle(key, command) {
                command.operation = operation;
                command.operand.character = key;
                return [];
            }
        };
    },
    withMotion(motion) {
        return {
            ...this,
            handle(key, command) {
                command.operand.motion = motion;
                command.operand.character = key;
                return [];
            }
        };
    },
    withObject(object) {
        return {
            ...this,
            handle(key, command) {
                command.operand.object = object;
                command.operand.character = key;
                return [];
            }
        };
    }
}

class CommandRegister {
    constructor(next) {
        this.next = next;
    }

    accepts(key, command) {
        if (key.length > 1)
            return false;
        return key >= 'a' && key <= 'z' || key >= 'A' && key <= 'Z' || key == '"' || key == '+' || key == '*';
    }

    handle(key, command) {
        command.register = key.toLowerCase();
        if (key >= 'A' && key <= 'Z') {
            command.appendRegister = true;
        }
        return this.next;
    }
}


const register = {
    accepts(key, command) {
        return key == '"';
    },
    handle(key, command) {
        return [new CommandRegister(command.next)];
    },
}

class CommandCount {
    constructor(target) {
        this.target = target;
    }
    accepts(key, command) {
        if (key < '0' || key > '9')
            return false;
        if (this.target == 'operator' && key == '0' && !command.count)
            return false;
        if (this.target == 'operand' && key == '0' && !command.operand.count)
            return false;
        return true;
    }

    handle(key, command) {
        if (this.target == 'operator') {
            command.count = command.count * 10 + parseInt(key);
        } else if (this.target == 'operand') {
            command.operand.count = command.operand.count * 10 + parseInt(key);
        }
        return command.next; // This is pretty ugly, but it does work
    }

    toString() {
        return 'count';
    }
}


class Key {
    constructor(key) {
        this.key = key;
        this.aliases = [];
        this._next = [];
    }
    alias(...aliases) {
        this.aliases.push(...aliases);
        return this;
    }
    accepts(key, command) {
        return key == this.key || this.aliases.includes(key);
    }
    handle(key, command) {
        if (this._operation)
            command.operation = this._operation;
        if (this._motion)
            command.operand.motion = this._motion;
        if (this._object)
            command.operand.object = Object.assign(command.operand.object ?? {}, this._object);
        if (this._screenMotion)
            command.operand.screenMotion = this._screenMotion;
        if (this._register)
            command.register = this._register;
        if (this._character)
            command.operand.character = this._character;
        if (this._count !== undefined)
            command.operand.count = this._count;
        return this._next;
    }
    operation(operation) {
        this._operation = operation;
        return this;
    }
    motion(motion) {
        this._motion = motion;
        return this;
    }
    object(object) {
        if (!this._object)
            this._object = {};
        this._object.kind = object;
        return this;
    }
    objectInside(inside) {
        if (!this._object)
            this._object = {};
        this._object.inside = inside;
        return this;
    }
    screenMotion(screenMotion) {
        this._screenMotion = screenMotion;
        return this;
    }
    register(register) {
        this._register = register;
        return this;
    }
    character(character) {
        this._character = character;
        return this;
    }
    count(countTarget) {
        this._count = countTarget;
        return this;
    }
    then(...following) {
        this._next.push(...following);
        return this;
    }
}

function key(key) {
    return new Key(key);
}

function oneOf(...keys) {
    return {
        accepts(key, command) {
            for (let k of keys) {
                if (k.accepts(key, command))
                    return true;
            }
        },
        handle(key, command) {
            if (this._defaultOperation)
                command.operation = this._defaultOperation;
            for (let k of keys) {
                if (k.accepts(key, command))
                    return k.handle(key, command);
            }
        },
        defaultOperation(operation) {
            this._defaultOperation = operation;
            return this;
        }
    }
}

const operandCount = new CommandCount('operand');

const motion = oneOf(
    key('h').motion('left').alias('ArrowLeft').alias('Backspace'),
    key('j').motion('down').alias('ArrowDown').alias('Enter').alias('+').alias('CTRL-m'),
    key('k').motion('up').alias('ArrowUp').alias('CTRL-p').alias('-'),
    key('l').motion('right').alias('ArrowRight').alias(' '),
    key('w').motion('word'),
    key('b').motion('backWord'),
    key('B').motion('backWORD'),
    key('W').motion('WORD'),
    key('e').motion('endWord'),
    key('E').motion('endWORD'),
    key('0').motion('startLine').alias('Home'),
    key('^').motion('firstNonBlank'),
    key('$').motion('endLine').alias('End'),
    key('G').motion('gotoLine'),
    key('|').motion('column'),
    key('f').motion('findChar').then(character),
    key('F').motion('findCharBack').then(character),
    key('t').motion('tillChar').then(character),
    key('T').motion('tillCharBack').then(character),
    key(';').motion('repeatFind'),
    key(',').motion('repeatFindReverse'),
    key('_').motion('line'),
    key('%').motion('match'),
    key('`').motion('markChar').then(character),
    key("'").motion('markLine').then(character),
    key('}').motion('paragraph-forward'),
    key('{').motion('paragraph-backward'),
    key('(').motion('sentence-backward'),
    key(')').motion('sentence-forward'),
);


const screenMotion = oneOf(
    key('H').screenMotion('top'),
    key('M').screenMotion('middle'),
    key('L').screenMotion('bottom'),
);

const anObject = oneOf(
    key('w').object('word'),
    key('W').object('WORD'),
    key('b').object('paren').alias('(').alias(')'),
    key('B').object('brace').alias('{').alias('}'),
    key('[').object('bracket').alias(']'),
    key('<').object('angle').alias('>'),
    key('"').object('double-quote'),
    key("'").object('single-quote'),
    key('p').object('paragraph'),
    key('s').object('sentence'),
);

const object = oneOf(
    key('a').objectInside(false).then(anObject),
    key('i').objectInside(true).then(anObject),
);

const normalImmediate = oneOf(
    key('i').operation('insert'),
    key('a').operation('append'),
    key('v').operation('visual'),
    key('V').operation('visual-line'),
    key('CTRL-v').operation('visual-block'),
    key('A').operation('appendEnd'),
    key('I').operation('insertStart'),
    key('o').operation('openLine'),
    key('O').operation('openLineAbove'),
    key('CTRL-]').operation('jumpTag'),
    key('u').operation('undo'),
    key('PageUp').operation('pageUp').alias('CTRL-b'),
    key('PageDown').operation('pageDown').alias('CTRL-f'),
    key('CTRL-d').operation('scroll').motion('forward'),
    key('CTRL-u').operation('scroll').motion('backward'),
    key('CTRL-e').operation('scrollLineDown'),
    key('CTRL-y').operation('scrollLineUp'),
    key('CTRL-g').operation('displayInformation'),
    key('R').operation('replaceMode'),
    key('n').operation('search-again'),
    key('N').operation('search-reverse'),
    key('.').operation('repeat'),
    key('q').operation('recordMacro'),
    key('@').operation('runMacro').then(character),
    key('U').operation('undoLine'),
    key('CTRL-r').operation('redo'),
    key('&').operation('repeatSubst'),
);

const operator = oneOf(
    key('d').operation('delete').then(operandCount, motion, screenMotion, object, key('d').object('line')),
    key('D').operation('delete').motion('endLine'),
    key('c').operation('change').then(operandCount, motion, screenMotion, object, key('c').object('line')),
    key('C').operation('change').motion('endLine'),
    key('s').operation('change').motion('right'),
    key('S').operation('change').object('line'),
    key('y').operation('yank').then(operandCount, motion, screenMotion, object, key('y').object('line')),
    key('Y').operation('yank').motion('line'),
    key('p').operation('paste'),
    key('P').operation('pasteBefore'),
    key('r').operation('replace').object('char').then(character),
    key('x').operation('delete').object('char'),
    key('X').operation('delete').motion('left'),
    key('>').operation('indent').then(operandCount, motion, screenMotion, object, key('>').object('line')),
    key('<').operation('unindent').then(operandCount, motion, screenMotion, object, key('<').object('line')),
    key('~').operation('toggleCase'),
    key('z').operation('scroll').then(
        key('Enter').motion('top'),
        key('.').motion('middle'),
        key('-').motion('bottom'),
        key('+').motion('page-down'),
        key('^').motion('page-up'),
    ),
    key('m').operation('mark').then(key("'"), character),
);

const normalg = oneOf(
    key('g').motion('gotoLine').count(1),
    key('t').operation('tab-next'),
    key('T').operation('tab-previous'),
)

const visualCommands = oneOf(
    key('Escape').operation('normal-mode'),
    register,
    operandCount,
    motion,
    screenMotion,
    object,
    key('v').operation('visual'),
    key('V').operation('visual-line'),
    key('CTRL-v').operation('visual-block'),
    key('d').operation('delete'),
    key('c').operation('change'),
    key('y').operation('yank'),
    key('p').operation('paste'),
    key('P').operation('pasteBefore'),
    key('r').operation('replace').then(character),
    key('x').operation('delete'),
    key('J').operation('joinLines'),
    key('CTRL-]').operation('jumpTag'),
    key('o').operation('swap-diag'),
    key('O').operation('swap-horiz'),
    key('I').operation('insert-before'),
    key('A').operation('insert-after'),
    key('>').operation('indent'),
    key('<').operation('unindent'),
    key('~').operation('toggleCase'),
    key('CTRL-l').operation('extend-next'),
).defaultOperation('select');

const replaceCommands = oneOf(
    key('Escape').operation('normal-mode'),
    key('Backspace').operation('delete').motion('left'),
    key('Delete').operation('delete').object('char'),
    key('Enter').operation('break-line'),
    key('ArrowLeft').operation('move').motion('left'),
    key('ArrowRight').operation('move').motion('right'),
    key('ArrowUp').operation('move').motion('up'),
    key('ArrowDown').operation('move').motion('down'),
    key('Home').operation('move').motion('startLine'),
    key('End').operation('move').motion('endLine'),
    character.withObject('char'),
).defaultOperation('replace');


function textEntry(resultOperation, prompt) {
    const textEntryCommands = [
        key('Enter').operation(resultOperation),
        key('Escape').operation('normal-mode'),
        {
            accepts(key, command) {
                return true;
            },
            handle(key, command) {
                if (!command.operand.text)
                    command.operand.text = '';
                if (key == 'Backspace' && command.operand.text.length == 0) {
                    command.operation = 'normal-mode';
                    return [];
                }
                if (key == 'Backspace') {
                    command.operand.text = command.operand.text.slice(0, -1);
                } else {
                    command.operand.text += key;
                }
                command.message = prompt + command.operand.text;
                return textEntryCommands;
            },
            toString() {
                return 'text-entry';
            }
        }
    ];
    return textEntryCommands;
}


const normalCommands = oneOf(
    key('Escape').operation('normal-mode'),
    register,
    new CommandCount('operator'),
    normalImmediate,
    operator,
    motion,
    screenMotion,
    object,
    key('/').operation('text-entry').motion('search').character('/'),
    key('?').operation('text-entry').motion('searchBack').character('?'),
    key('*').operation('search-word'),
    key('#').operation('searchBack-word'),
    key(':').operation('text-entry').motion('ex').character(':'),
    key('CTRL-l').operation('extend').then(
        operandCount,
        key('j').motion('down').alias('ArrowDown'),
        key('k').motion('up').alias('ArrowUp'),
        key('J').motion('down-skip'),
        key('K').motion('up-skip'),
        key('u').operation('undo-cursor'),
    ),
    key('g').then(normalg),
);


class ViCommand {

    #initial
    #initialOperation
    constructor(initial=[normalCommands], initialOperation='move') {
        this.#initial = initial;
        this.#initialOperation = initialOperation;
        this.message = null;
        this.reset();
    }

    reset() {
        this.operation = this.#initialOperation;
        this.register = null;
        this.appendRegister = false;
        this.count = 0;
        this.operand = {pending: null, count: 0, motion: null, object: null};
        this.next = Array.from(this.#initial);
        this.message = null;
        this.command = '';
    }

    empty() {
        return new ViCommand(this.#initial, this.#initialOperation);
    }

    handle(key) {
        for (let poss of this.next) {
            if (poss.accepts(key, this)) {
                this.next = poss.handle(key, this);
                this.command += key.replace('CTRL-', '^').replace('Escape', '^[');
                return this;
            }
        }
        console.log('No handler for', key, 'after', this.command);
        this.reset();
    }

    get done() {
        return this.next.length == 0;
    }

    mergeCounts() {
        if (this.operand.count && this.count) {
            this.operand.count *= this.count;
            this.count = 0;
        } else if (this.count) {
            this.operand.count = this.count;
            this.count = 0;
        }
    }

    full(cmdStr) {
        for (let key of cmdStr) {
            this.handle(key);
        }
        return this;
    }

    toString() {
        return this.command + ':[' + (this.next.join(', ')) + ']';
    }
}


// Missing insert commands:
// autoindent, CTRL-D, CTRL-H, CTRL-J, CTRL-M, CTRL-T, CTRL-U, CTRL-V, CTRL-W (can't), CTRL-Y,
const insertCommands = oneOf(
    key('Escape').operation('normal-mode'),
    key('Backspace').operation('delete').motion('left'),
    key('Delete').operation('delete').object('char'),
    key('Enter').operation('break-line'),
    key('ArrowLeft').operation('move').motion('left'),
    key('ArrowRight').operation('move').motion('right'),
    key('ArrowUp').operation('move').motion('up'),
    key('ArrowDown').operation('move').motion('down'),
    key('Home').operation('move').motion('startLine'),
    key('End').operation('move').motion('endLine'),
    character.withOperation('insert-char'),
);


class MultiCursor {
    multi = true;
    #cursors = []

    constructor(...cursors) {
        this.#cursors = cursors;
    }

    get first() {
        return this.#cursors[0];
    }

    get line() {
        return this.#cursors[0].line;
    }

    get column() {
        return this.#cursors[0].column;
    }

    set mode(value) {
        for (let cursor of this.#cursors) {
            cursor.mode = value;
        }
    }

    up(count=1) {
        for (let cursor of this.#cursors) {
            if (cursor.line == 1)
                return;
        }
        for (let cursor of this.#cursors) {
            cursor.up(count);
        }
    }

    down(count=1) {
        for (let cursor of this.#cursors) {
            cursor.down(count);
        }
    }

    left(count=1) {
        for (let cursor of this.#cursors) {
            cursor.left(count);
        }
    }

    right(count=1) {
        for (let cursor of this.#cursors) {
            cursor.right(count);
        }
    }

    endLine() {
        for (let cursor of this.#cursors) {
            cursor.endLine();
        }
    }

    startLine() {
        for (let cursor of this.#cursors) {
            cursor.startLine();
        }
    }

    insert(char) {
        for (let cursor of this.#cursors) {
            cursor.insert(char);
        }
    }

    delete() {
        for (let cursor of this.#cursors) {
            cursor.delete();
        }
    }

    deleteBefore() {
        for (let cursor of this.#cursors) {
            cursor.deleteBefore();
        }
    }

    breakLine() {
        for (let cursor of this.#cursors) {
            cursor.breakLine();
        }
    }

    insertLineBelow() {
        for (let cursor of this.#cursors) {
            cursor.insertLineBelow();
        }
    }

    insertLineAbove() {
        for (let cursor of this.#cursors) {
            cursor.insertLineAbove();
        }
    }

    deleteLine() {
        for (let cursor of this.#cursors) {
            cursor.deleteLine();
        }
    }

    dispose() {
        for (let cursor of this.#cursors) {
            cursor.dispose();
        }
    }

    isAt(line, column) {
        for (let cursor of this.#cursors) {
            if (cursor.isAt(line, column))
                return true;
        }
        return false;
    }

    selectedAt(line, column) {
        for (let cursor of this.#cursors) {
            if (cursor.selectedAt(line, column))
                return true;
        }
        return false;
    }

    highlightAt(line, column) {
        if (this.#cursors[0].highlightAt(line, column))
            return true;
        return false;
    }

    startVisual(kind) {
        for (let cursor of this.#cursors) {
            cursor.startVisual(kind);
        }
    }

    setVisualOperand(operand) {
        for (let cursor of this.#cursors) {
            cursor.setVisualOperand(operand);
        }
    }

    endVisual() {
        for (let cursor of this.#cursors) {
            cursor.endVisual();
        }
    }

    operandRange(operand) {
        return this.#cursors[0].operandRange(operand);
    }

    move(line, column) {
        for (let cursor of this.#cursors) {
            cursor.move(line, column);
        }
    }

    extend(opd) {
        let kind = opd.motion;
        if (opd.motion == 'next-selection') {
            return this.#cursors[0].extend(opd,
                {multi: this, last: this.#cursors.at(-1)});
        } else if (kind == 'down') {
            this.#cursors.at(-1).extend(opd, {multi: this, last: this.#cursors.at(-1)});
            return this;
        } else if (kind == 'up') {
            this.#cursors.at(0).extend(opd, {multi: this, last: this.#cursors.at(-1)});
            return this;
        } else if (kind == 'down-skip') {
            this.#cursors.at(-1).extend(opd, {multi: this, last: this.#cursors.at(-1)});
            return this;
        } else if (kind == 'up-skip') {
            this.#cursors.at(0).extend(opd, {multi: this, last: this.#cursors.at(-1)});
            return this;
        }
    }

    addCursor(cursor) {
        this.#cursors.push(cursor);
    }

    moveOperand(operand) {
        for (let cursor of this.#cursors) {
            cursor.moveOperand(operand);
        }
    }

    deleteOperand(operand) {
        let results = [];
        for (let cursor of this.#cursors.toReversed()) {
            results.push(cursor.deleteOperand(operand));
        }
        return {text: results.map(r => r.text.flat()), linewise: results[0].linewise};
    }

    toggleCase(operand) {
        for (let cursor of this.#cursors) {
            cursor.toggleCase(operand);
        }
    }

    pop() {
        this.#cursors.pop();
    }
}



customElements.define('vi-window', ViWindow);