import { moveToUci, pieceName, pieceSide } from './vendor/xiangqi.js';
import { COORDINATE_SYSTEM } from './board-state.js';

const NS = 'http://www.w3.org/2000/svg';
const { files, width, height } = COORDINATE_SYSTEM;
const STEP = 52;
const x = col => 62 + col * STEP;
const y = row => 65 + row * STEP;
const squareName = (row, col) => `${files[col]}${height - 1 - row}`;
const directions = new Map([
  ['ArrowUp', [-1, 0]], ['ArrowDown', [1, 0]],
  ['ArrowLeft', [0, -1]], ['ArrowRight', [0, 1]]
]);

function svg(tag, attrs, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawGrid() {
  const grid = svg('g', { 'aria-hidden': 'true', 'pointer-events': 'none' });
  const line = (x1, y1, x2, y2, weight = 1) => grid.append(svg('line', {
    x1, y1, x2, y2, stroke: '#aa9370', 'stroke-width': weight
  }));
  grid.append(svg('rect', {
    x: 44, y: 47, width: 452, height: 504, rx: 3, fill: 'none', stroke: '#b9a17a', 'stroke-width': 1.4
  }));
  for (let row = 0; row < height; row++) {
    line(x(0), y(row), x(width - 1), y(row), row === 0 || row === height - 1 ? 1.5 : 1);
  }
  for (let col = 0; col < width; col++) {
    if (col === 0 || col === width - 1) {
      line(x(col), y(0), x(col), y(height - 1), 1.5);
    } else {
      line(x(col), y(0), x(col), y(4));
      line(x(col), y(5), x(col), y(height - 1));
    }
  }
  for (const row of [0, 7]) {
    line(x(3), y(row), x(5), y(row + 2));
    line(x(5), y(row), x(3), y(row + 2));
  }
  for (const [label, col] of [['楚 河', 2], ['汉 界', 6]]) {
    grid.append(svg('text', {
      x: x(col), y: y(4.5) + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: '#b39b75', 'font-size': 21, 'font-family': 'SimSun,serif', 'letter-spacing': 7
    }, label));
  }
  return grid;
}

function drawSquare(piece, { last, hint, selected, legal }) {
  const content = [];
  const circle = (r, attrs) => svg('circle', { r, ...attrs });
  if (last) content.push(circle(24, { class: 'last-ring' }));
  if (hint) content.push(circle(24, { class: 'target-mark' }));
  if (piece !== '.') {
    const red = pieceSide(piece) === 'w';
    content.push(
      circle(22, { cy: 2, fill: '#9c7c4f26' }),
      circle(21.5, { fill: 'url(#stone)', stroke: '#c2ab82', 'stroke-width': 1 }),
      circle(17.5, { fill: 'none', stroke: red ? '#bb6e5955' : '#7e786255', 'stroke-width': 0.9 }),
      svg('text', { y: 0.5, class: 'piece-text', fill: red ? '#b44e3c' : '#405047' }, pieceName(piece))
    );
  }
  if (selected) content.push(circle(25, { class: 'selected-ring' }));
  if (legal) content.push(piece === '.' ? circle(5, { class: 'legal-dot' }) : circle(24, { class: 'selected-ring' }));
  return content;
}

export function mountTrainingBoard(root, { onSquare, onCancel }) {
  const defs = svg('defs', {});
  const gradient = svg('radialGradient', { id: 'stone', cx: '.38', cy: '.28', r: '.8' });
  gradient.append(svg('stop', { offset: '0', 'stop-color': '#fffdf4' }), svg('stop', { offset: '1', 'stop-color': '#efe1c2' }));
  defs.append(gradient);
  const grid = drawGrid();
  const columns = Array.from({ length: width }, (_, col) => svg('text', { x: x(col), y: 575, 'text-anchor': 'middle', class: 'coord-label' }));
  const rows = Array.from({ length: height }, (_, row) => svg('text', { x: 25, y: y(row) + 4, 'text-anchor': 'middle', class: 'coord-label' }));
  grid.append(...columns, ...rows);

  let flipped, tabStop;
  const squares = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
    const square = squareName(row, col);
    const node = svg('g', { class: 'board-cell', role: 'button', tabindex: square === 'e0' ? '0' : '-1', 'data-square': square });
    const content = svg('g', { 'aria-hidden': 'true', 'pointer-events': 'none' });
    node.append(svg('rect', { x: -25, y: -25, width: 50, height: 50, fill: 'transparent' }), content);
    if (square === 'e0') tabStop = node;
    node.addEventListener('click', () => onSquare(row, col));
    node.addEventListener('focus', () => {
      if (tabStop === node) return;
      tabStop.setAttribute('tabindex', '-1');
      node.setAttribute('tabindex', '0');
      tabStop = node;
    });
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) onSquare(row, col);
      } else if (event.key === 'Escape') {
        onCancel();
      } else if (directions.has(event.key)) {
        event.preventDefault();
        const [dr, dc] = directions.get(event.key), sign = flipped ? -1 : 1;
        const nextRow = Math.max(0, Math.min(height - 1, row + sign * dr));
        const nextCol = Math.max(0, Math.min(width - 1, col + sign * dc));
        squares[nextRow][nextCol].node.focus();
      }
    });
    return { node, content, square, previous: null };
  }));
  root.replaceChildren(defs, grid, ...squares.flat().map(cell => cell.node));

  return function render({ board, selected, legal, lastMove, hintMove, flipped: nextFlipped }) {
    const orientationChanged = flipped !== nextFlipped;
    flipped = nextFlipped;
    if (orientationChanged) {
      columns.forEach((label, col) => { label.textContent = files[flipped ? width - 1 - col : col]; });
      rows.forEach((label, row) => { label.textContent = flipped ? row : height - 1 - row; });
    }
    const selectedSquare = selected ? squareName(...selected) : null;
    const destinations = new Set();
    if (selected) {
      for (const move of legal) {
        if (move.from[0] === selected[0] && move.from[1] === selected[1]) destinations.add(squareName(...move.to));
      }
    }
    const lastSquares = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2)] : [];
    const hintSquares = hintMove ? [hintMove.slice(0, 2), hintMove.slice(2)] : [];
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const cell = squares[row][col], piece = board[row][col];
      const { node, content, square } = cell;
      if (orientationChanged) {
        node.setAttribute('transform', `translate(${x(flipped ? width - 1 - col : col)} ${y(flipped ? height - 1 - row : row)})`);
      }
      const marks = {
        last: lastSquares.includes(square), hint: hintSquares.includes(square),
        selected: square === selectedSquare, legal: destinations.has(square)
      };
      const appearance = `${piece}${Number(marks.last)}${Number(marks.hint)}${Number(marks.selected)}${Number(marks.legal)}`;
      if (appearance === cell.previous) continue;
      cell.previous = appearance;
      const red = pieceSide(piece) === 'w';
      const name = piece === '.' ? '空位' : `${red ? '红' : '黑'}${pieceName(piece)}`;
      node.setAttribute('aria-label', `${name} ${square}${marks.legal ? '，合法落点' : ''}`);
      if (red) node.setAttribute('aria-pressed', String(marks.selected));
      else node.removeAttribute('aria-pressed');
      content.replaceChildren(...drawSquare(piece, marks));
    }
  };
}
