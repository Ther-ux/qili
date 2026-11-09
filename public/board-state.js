import { parseFen, boardToFen, pieceSide, pieceName } from './vendor/xiangqi.js';

// This frame belongs to the position. Rotating the view never changes it.
export const COORDINATE_SYSTEM = Object.freeze({
  id: 'xiangqi-red-origin-v1', width: 9, height: 10,
  origin: 'a0：红方视角的左下角交叉点',
  files: 'abcdefghi', ranks: '0123456789',
  x: '0–8，从红方左侧向右递增，对应 a–i',
  y: '0–9，从红方底线向黑方底线递增',
  matrix: 'matrix[row][col]，row=9-y，col=x；第一行为黑方底线，空位为 .',
  symbols: '大写为红方，小写为黑方；K帅/将、A仕/士、B相/象、N马、R车、C炮、P兵/卒',
  river: 'y=4 与 y=5 之间；河界不增加行数',
  palaces: { red: { x: [3, 5], y: [0, 2] }, black: { x: [3, 5], y: [7, 9] } },
  forward: { red: '+y', black: '-y' },
  moveFormat: 'a1a7 表示从 a1 到 a7；坐标不随行棋方、照片方向或棋盘翻转改变'
});

export function squareCoordinates(square) {
  if (typeof square !== 'string' || !/^[a-i][0-9]$/.test(square)) throw new Error('棋位坐标无效。');
  const x = 'abcdefghi'.indexOf(square[0]), y = Number(square[1]);
  return { square, x, y, row: 9 - y, col: x };
}

export function moveCoordinates(move) {
  if (typeof move !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(move)) throw new Error('着法坐标无效。');
  return { from: squareCoordinates(move.slice(0, 2)), to: squareCoordinates(move.slice(2)) };
}

export function serializeBoard(fen) {
  const { board, turn } = parseFen(fen), pieces = [];
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const symbol = board[row][col];
    if (symbol === '.') continue;
    pieces.push({ symbol, side: pieceSide(symbol) === 'w' ? 'red' : 'black', name: pieceName(symbol), ...squareCoordinates(`${'abcdefghi'[col]}${9 - row}`) });
  }
  return { schemaVersion: 1, coordinateSystem: COORDINATE_SYSTEM.id, fen: boardToFen(board, turn), turn: turn === 'w' ? 'red' : 'black', matrix: board, pieces };
}
