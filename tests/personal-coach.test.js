import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { COORDINATE_SYSTEM, serializeBoard, squareCoordinates, moveCoordinates } from '../public/board-state.js';
import { START_FEN, parseFen, boardToFen, applyMove, uciToMove, opposite } from '../public/vendor/xiangqi.js';
import { DEFAULT_PROFILE, PROFILE_KEY, loadLearnerProfile, saveLearnerProfile, sanitizeLearnerProfile } from '../public/learner-profile.js';
import { buildLearnerContext } from '../src/learner-context.js';
import { buildBoardContext } from '../src/board-context.js';
import { trainingWalkthrough } from '../src/training-walkthrough.js';
import { generateCoach } from '../src/coach.js';
import { createApp } from '../server.js';
import { detailedAnswer } from './model-fixture.js';

const response = data => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] }) });
const learnerInput = { profile: { ageBand: '6-8', level: 'starter', goal: 'safety', pace: 'gentle' }, reflection: '我想先吃黑车。', recentAttempts: [{ puzzleId: 'rook-line', move: 'a1a2', correct: true }] };

test('all 90 board coordinates round trip through the matrix and keep one red-side origin', () => {
  const names = new Set();
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const square = `${'abcdefghi'[col]}${9-row}`, value = squareCoordinates(square);
    names.add(square); assert.deepEqual(value, { square, x: col, y: 9-row, row, col });
  }
  assert.equal(names.size, 90); assert.equal(COORDINATE_SYSTEM.origin.startsWith('a0'), true);
  assert.deepEqual(moveCoordinates('a1a7').to, { square:'a7', x:0, y:7, row:2, col:0 });
  for (const input of ['j0', 'a10', '', null]) assert.throws(() => squareCoordinates(input));
  assert.throws(() => moveCoordinates('a1-a7'));
  const red = serializeBoard(START_FEN), black = serializeBoard(START_FEN.replace(' w ', ' b '));
  assert.equal(red.pieces.length, 32); assert.equal(red.matrix.length, 10);
  assert.ok(red.matrix.every(row => row.length === 9));
  assert.deepEqual(red.matrix, black.matrix); assert.deepEqual(red.pieces, black.pieces);
  assert.equal(red.turn, 'red'); assert.equal(black.turn, 'black');
  for (const p of red.pieces) assert.equal(red.matrix[p.row][p.col], p.symbol);
  assert.equal(red.pieces.find(p => p.square === 'e0').name, '帅');
  assert.equal(red.pieces.find(p => p.square === 'e9').name, '将');
});

test('mainline and variation changes reconstruct exactly the rule-verified after position', () => {
  for (const id of ['rook-line', 'cannon-mate', 'ending-pawn-two']) {
    const walk = trainingWalkthrough(id), context = buildBoardContext(walk.steps[0].beforeFen, walk);
    assert.equal(context.current.fen, walk.steps[0].beforeFen);
    const transitions = [...context.mainline, ...context.variations.flatMap(v => v.moves)];
    for (const step of transitions) {
      const { board, turn } = parseFen(step.beforeFen);
      for (const change of step.changes) {
        const { row, col } = squareCoordinates(change.square);
        assert.equal(board[row][col], change.before); board[row][col] = change.after;
      }
      assert.equal(boardToFen(board, opposite(turn)), step.afterFen);
    }
    for (const branch of context.variations) if (!branch.legal) assert.deepEqual(branch.moves, []);
  }
});

test('profile settings survive storage, reject unexpected fields and tolerate bad or unavailable storage', () => {
  let saved;
  const storage = { getItem: key => key === PROFILE_KEY ? saved : null, setItem: (key, value) => { assert.equal(key, PROFILE_KEY); saved=value; } };
  assert.deepEqual(loadLearnerProfile(storage), DEFAULT_PROFILE);
  assert.equal(saveLearnerProfile(storage, { ...learnerInput.profile, apiKey: 'must-not-save', school: 'must-not-save' }), true);
  assert.deepEqual(loadLearnerProfile(storage), learnerInput.profile); assert.ok(!saved.includes('must-not-save'));
  saved = '{broken'; assert.deepEqual(loadLearnerProfile(storage), DEFAULT_PROFILE);
  assert.deepEqual(sanitizeLearnerProfile({ ageBand: { toString: null }, level: '__proto__' }), DEFAULT_PROFILE);
  assert.equal(saveLearnerProfile({ setItem() { throw new Error('unavailable'); } }, learnerInput.profile), false);
});

test('coaching replays attempted moves and ignores client-supplied outcomes, boards and unrelated attempts', () => {
  const input = { ...learnerInput, recentAttempts: [
    { puzzleId:'rook-line', move:'a1b2', legal:true, correct:true, nextFen:START_FEN },
    { puzzleId:'rook-line', move:'a1a2', legal:false, correct:true },
    { puzzleId:'rook-line', move:'a1a7', assisted:true, hintsUsed:2 },
    { puzzleId:'unknown', move:'a1a7' }
  ], records: { 'rook-line': { attempts:3, mistakes:2, independent:true, completed:true, resolved:true }, unknown: { attempts:999 } } };
  const learner = buildLearnerContext(input, 'rook-line'), [illegal, misses, correct] = learner.review.attempts;
  assert.equal(learner.review.attempts.length,3); assert.equal(illegal.legal,false); assert.equal(illegal.afterMove,null);
  assert.equal(misses.legal,true); assert.equal(misses.goalReached,false); assert.equal(misses.appliedToExercise,false);
  assert.equal(misses.afterMove.pieces.find(p => p.square === 'a2').symbol, 'R');
  assert.equal(misses.afterExerciseResponse,null); assert.equal(correct.goalReached,true); assert.equal(correct.assisted,true);
  assert.equal(learner.progress.attemptedExercises,1); assert.equal(learner.progress.independentExercises,1);
  assert.match(learner.teachingPlan.nextAction,/最近一次未达标/);
  assert.equal(learner.review.reflection, learnerInput.reflection);
  assert.equal(buildLearnerContext({ reflection:'x'.repeat(400) }).review.reflection.length,240);
  assert.deepEqual(buildLearnerContext({ recentAttempts:[{}] }).review.attempts,[]);
});

test('multi-step review separates the proposed red move from the automatic black reply', () => {
  const learner = buildLearnerContext({ recentAttempts:[{ puzzleId:'ending-pawn-two',move:'e7e8',history:[] }] }, 'ending-pawn-two');
  const entry = learner.review.attempts[0]; assert.ok(entry);
  assert.equal(entry.complete,false); assert.ok(entry.automaticReply);
  assert.equal(entry.afterMove.turn,'black'); assert.equal(entry.afterExerciseResponse.turn,'red');
  const before = parseFen(entry.before.fen);
  assert.equal(entry.afterMove.fen, boardToFen(applyMove(before.board,uciToMove(entry.move)), 'b'));
});

test('all coaching HTTP entrances receive the same personal profile and a structured current board', async t => {
  const contexts = [];
  const server = createApp({ engineReady:() => false, fetchImpl:async (url, options) => {
    const context = JSON.parse(JSON.parse(options.body).messages[1].content); contexts.push(context);
    return response(detailedAnswer(context));
  } });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const fen = trainingWalkthrough('rook-line').steps[0].beforeFen;
  const cases = [
    ['/api/coach', { id:'rook-line' }], ['/api/compare', { id:'rook-line' }],
    ['/api/import/explain', { fen:trainingWalkthrough('ending-pawn-two').steps[0].beforeFen,maxMoves:2 }],
    ['/api/study/analyze', { baseFen:fen,moves:['a1a2'] }]
  ];
  for (const [route, data] of cases) {
    const result = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ ...data, learner:learnerInput,modelSettings:{ apiKey:'personal-context-test-only' } }) });
    assert.equal(result.status,200, await result.text());
  }
  assert.equal(contexts.length,5);
  for (const context of contexts) {
    assert.equal(context.learner.profile.ageBand,'6-8'); assert.equal(context.learner.profile.goal,'safety');
    assert.equal(context.boardState.current.matrix.length,10);
    assert.equal(context.boardState.coordinates.id,COORDINATE_SYSTEM.id);
    assert.ok(!JSON.stringify(context).includes('personal-context-test-only'));
  }
  assert.equal(contexts[0].learner.review.attempts[0].goalReached,false);
  assert.deepEqual(contexts[1].learner,contexts[2].learner);
  assert.equal(contexts.at(-1).boardState.current.fen,contexts.at(-1).currentFen);
  assert.equal(contexts.at(-1).boardState.played[0].move,'a1a2');
  assert.deepEqual(contexts[3].learner.review.attempts,[]);
});

test('explicit repairs retain the learner and board context and changed preferences start a fresh explanation', async () => {
  let full, calls=0;
  const settings={ apiKey:'personal-repair-test-only' };
  const mock=async (url, options) => {
    const context=JSON.parse(JSON.parse(options.body).messages[1].content); calls++;
    if (calls===1) { full=detailedAnswer(context); const draft=structuredClone(full); draft.steps[0].responses=[]; return response(draft); }
    assert.equal(context.learner.profile.ageBand,'6-8'); assert.equal(context.boardState.current.turn,'red');
    if (calls===3) {
      assert.equal(context.repair,true);
      assert.equal(context.learner.profile.pace,'gentle');
      return response({ patches:context.requiredRepairs.map(target => ({ ...target,value:full.steps.find(s => s.id===target.stepId)[target.field].find(b => b.id===target.id).explanation })) });
    }
    assert.equal(context.repair,undefined); assert.equal(context.learner.profile.pace,'challenge');
    return response(detailedAnswer(context));
  };
  const first=await generateCoach('rook-line',null,'customized',null,mock,settings,[],null,learnerInput);
  assert.equal(first.source,'lesson-fallback');
  await generateCoach('rook-line',null,'customized',null,mock,settings,[],null,{ ...learnerInput,profile:{ ...learnerInput.profile,pace:'challenge' } });
  assert.equal((await generateCoach('rook-line',null,'customized',null,mock,settings,[],null,learnerInput)).source,'model');
  assert.equal(calls,3);
});
