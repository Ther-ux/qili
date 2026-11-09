import { COACH_ANALYSIS_PROMPT, COACH_PROMPT_VERSION } from './coach-prompt.js';
import { resolveModelConfig } from './model-client.js';
import { requestDetailedCoach } from './coach-completion.js';
import { KNOWLEDGE } from './knowledge.js';
import { buildWalkthrough, DETAILED_SCHEMA, walkthroughMoves } from './walkthrough.js';
import { enrichTeaching } from './teaching-analysis.js';
import { coachAnswerFailure } from './coach-validation.js';
import { buildLearnerContext } from './learner-context.js';
import { buildBoardContext } from './board-context.js';

export function importedWalkthrough(report) {
  return buildWalkthrough({ result:report.result, fen: report.fen, moves: report.line.map(item => item.move), attacker: report.turn, maxMoves: report.proof.maxMoves, goal: report.proof.status === 'proven' ? 'checking-mate' : 'reference', task: report.proof.status === 'proven' ? `在 ${report.proof.maxMoves} 个进攻方回合内连续将军并绝杀` : '理解引擎参考线路，不据此推断必胜', summary: `${report.conclusion}先观察双方帅将安全与进攻棋子的配合，再逐步核对主线和变化。每一步合法不等于实战最优，未完成短将杀也不等于实战必输。比较其他正确解时，重点看它如何处理不同防守；复习时尝试独立摆出整条线路并解释每一步的目的。` });
}

export async function explainImportedPosition(report, settings, fetchImpl = fetch, compare=null, learnerInput={}) {
  if (!report.recommendation) throw Object.assign(new Error('当前没有可验证的推荐线路，暂不能生成解法讲解。'), { status: 400 });
  const config = resolveModelConfig(settings), started = Date.now();
  const walkthrough = await enrichTeaching(report.walkthrough || importedWalkthrough(report),compare);
  const evidence = [...report.evidence, ...walkthrough.evidence];
  const learner = buildLearnerContext(learnerInput);
  const messages = [
    { role: 'system', content: `你是面向象棋初学者的残局教学助手。只解释工具提供的局面与线路，不能自由编造解法。只有 proven 才能称已证明的短连续将杀；其他结果只能称参考，不能称必胜或和棋。engine 为 null 不得声称使用引擎；mate 分值可能包含困毙，须根据 outcome 区分。move 必须等于 recommendation，evidenceIds 引用给定编号。${COACH_ANALYSIS_PROMPT}${DETAILED_SCHEMA}` },
    { role: 'user', content: JSON.stringify({ fen: report.fen, recommendation: report.recommendation, proof: { status: report.proof.status, maxMoves: report.proof.maxMoves }, engine: report.engine, line: report.line, evidence, walkthrough, learner, boardState: buildBoardContext(report.fen, walkthrough), knowledge: KNOWLEDGE.map(({id,title,text}) => ({id,title,text})) }) }
  ];
  try {
    const {content} = await requestDetailedCoach({
      config,identity:['import',report.fen,report.proof.maxMoves,learner],messages,fetchImpl,
      task:{expectedMove:report.recommendation,evidenceIds:evidence.map(item=>item.id),allowedMoves:[...new Set([...report.line.map(item=>item.move),...(report.engine?.pv||[]),...walkthroughMoves(walkthrough)])],walkthrough}
    });
    return {source:'model',promptVersion:COACH_PROMPT_VERSION,model:config.model,...content,elapsedMs:Date.now()-started};
  } catch (error) {
    if (!error.validationIssue) throw error;
    throw coachAnswerFailure(error,error.coachPayload,'MODEL_IMPORT_RESPONSE_INVALID');
  }
}
