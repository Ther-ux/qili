import { COACH_ANALYSIS_PROMPT, COACH_PROMPT_VERSION } from './coach-prompt.js';
import { findPuzzle } from './puzzles.js';
import { getLesson } from './training.js';
import { validatePV } from './engine.js';
import { resolveModelConfig } from './model-client.js';
import { trainingWalkthrough } from './training-walkthrough.js';
import { DETAILED_SCHEMA, walkthroughMoves } from './walkthrough.js';
import { enrichTeaching } from './teaching-analysis.js';
import { coachAnswerFailure } from './coach-validation.js';
import { requestDetailedCoach } from './coach-completion.js';
import { buildLearnerContext } from './learner-context.js';
import { buildBoardContext } from './board-context.js';
export { validateCoachResponse } from './coach-validation.js';

export function buildMessages(id, move, mode = 'customized', engine = null, history=[], walkthrough=trainingWalkthrough(id, move, history), learner=buildLearnerContext({}, id)) {
  const puzzle = findPuzzle(id);
  const lesson = getLesson(id, move, history);
  const common = { fen: lesson.fen || puzzle.fen, task: lesson.task || puzzle.objective, candidateMove: lesson.move, notation: lesson.notation, evidence: [...lesson.evidence, ...walkthrough.evidence], exerciseCompleteAfterCandidate: lesson.complete ?? lesson.correct, engine, walkthrough, learner, boardState: buildBoardContext(lesson.fen || puzzle.fen, walkthrough) };
  const schema = `只返回 JSON，move 必须等于 candidateMove；总览 observation、reason、practice 也须填写，evidenceIds 引用给定编号。engine 为 null 时不得声称使用引擎。连续将杀的中间着法不等于已完成绝杀，历史步骤与当前步骤须分清。${COACH_ANALYSIS_PROMPT}${DETAILED_SCHEMA}`;
  const system = mode === 'customized'
    ? `你是面向象棋初学者的战术学习助手。先核对规则证据，再引用相关知识，解释指定训练目标。教案是参考，若选择了其他正确着法，必须解释实际候选着法而不能照抄教案。引用证据编号，区分将军、绝杀与困毙，承认多个正确应将。引擎的推荐着法可能与题目候选着法不同，不能将原局面的引擎评分移用于候选着法；引擎 mate 分值也不单独证明正在将军。${schema}`
    : `你是中国象棋助手，请分析给定局面、候选着法和相同的规则/引擎信息。${schema}`;
  const context = mode === 'customized' ? { ...common, knowledge: lesson.knowledge, teachingExample: puzzle.lesson, learningGoal: puzzle.reflection } : common;
  return [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(context) }];
}

export async function generateCoach(id, move, mode = 'customized', engine = null, fetchImpl = fetch, settings, history=[], compare=null, learnerInput={}) {
  const config = resolveModelConfig(settings);
  const lesson = getLesson(id, move, history);
  const walkthrough = await enrichTeaching(trainingWalkthrough(id, lesson.move, history),compare);
  lesson.walkthrough = walkthrough;
  const started = Date.now();
  const positionFen=lesson.fen || findPuzzle(id).fen;
  const engineMoves = engine ? validatePV(positionFen, Array.isArray(engine.pv) ? engine.pv : []) : [];
  const engineBest = engine?.bestMove ? validatePV(positionFen, [engine.bestMove]) : [];
  // A response may contrast the lesson move with a DIFFERENT provided engine
  // recommendation. Permit only those tool-supplied, legally verified moves;
  // the structured answer must still equal the exercise candidate.
  const allowedMoves = [...new Set([lesson.move, ...engineMoves, ...engineBest, ...walkthroughMoves(walkthrough)])];
  const evidence = [...lesson.evidence, ...walkthrough.evidence];
  const learner = buildLearnerContext(learnerInput, id);
  allowedMoves.push(...learner.review.attempts.map(item => item.move));
  let content, payload;
  try {
    const result = await requestDetailedCoach({
      config,identity:['training',id,lesson.move,mode,history,learner],messages:buildMessages(id,lesson.move,mode,engine,history,walkthrough,learner),fetchImpl,
      task:{expectedMove:lesson.move,evidenceIds:evidence.map(item=>item.id),allowedMoves,walkthrough}
    });
    content=result.content;payload=result.payload;
  } catch (error) {
    if (!error.validationIssue) throw error;
    const failure=coachAnswerFailure(error,error.coachPayload,'MODEL_COACH_RESPONSE_INVALID');
    return {source:'lesson-fallback',validation:failure.validationIssue.kind==='truncated'?'truncated':'rejected',message:failure.message+'本地提示与训练仍可使用；如需查看解法，请手动点击“查看本地解法”。',validationIssue:failure.validationIssue,validationIssues:failure.validationIssues,lesson,elapsedMs:Date.now()-started,finishReason:error.coachPayload?.choices?.[0]?.finish_reason||null,usage:null};
  }
  const finishReason=payload.choices?.[0]?.finish_reason??null,usage=payload.usage??null;
  return { source: 'model', promptVersion:COACH_PROMPT_VERSION, validation: content.validationWarnings.length?'displayed-with-warnings':'display-structure-checked', mode, model: config.model, ...content, evidence, knowledge: mode === 'customized' ? lesson.knowledge : [], usage, finishReason, elapsedMs: Date.now() - started };
}
