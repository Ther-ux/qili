import { COORDINATE_SYSTEM, serializeBoard, moveCoordinates } from '../public/board-state.js';

function transition(step) {
  return { id: step.id, move: step.move, ...moveCoordinates(step.move), piece: step.piece, captured: step.captured === '.' ? null : step.captured, beforeFen: step.beforeFen, afterFen: step.afterFen, changes: [{ square: step.move.slice(0, 2), before: step.piece, after: '.' }, { square: step.move.slice(2), before: step.captured, after: step.piece }] };
}

export function buildBoardContext(fen, walkthrough, playedLine = []) {
  return {
    coordinates: COORDINATE_SYSTEM,
    current: serializeBoard(fen),
    mainline: walkthrough.steps.map(transition),
    variations: walkthrough.steps.flatMap(step => ['responses', 'alternatives'].flatMap(kind => step[kind].map(branch => ({ id: branch.id, kind, legal: branch.verdict !== 'illegal', attempt: moveCoordinates(branch.move), originFen: kind === 'responses' ? step.afterFen : step.beforeFen, moves: branch.line.map(transition) })))),
    played: playedLine.map(transition),
    scope: 'matrix 与 pieces 描述 current；其他步骤按 beforeFen/afterFen 和 changes 还原。走前、走后和实际作答必须分清；只有给定且核验合法的线路可以回放。'
  };
}
