import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { PUZZLES, publicPuzzle, findPuzzle } from './src/puzzles.js';
import { KNOWLEDGE } from './src/knowledge.js';
import { attempt, getHint, getLesson, analysisFen } from './src/training.js';
import { engineAvailable, analyze, analyzeCandidates } from './src/engine.js';
import { generateCoach } from './src/coach.js';
import { DEFAULT_MODEL, MODEL_OPTIONS, resolveModelConfig, testModelConnection } from './src/model-client.js';
import { validateImportedPosition } from './src/imported-position.js';
import { createImportedAnalyzer } from './src/import-analysis.js';
import { recognizePositionImage, locatePositionImage } from './src/position-vision.js';
import { explainImportedPosition, importedWalkthrough } from './src/position-coach.js';
import { trainingWalkthrough } from './src/training-walkthrough.js';
import { studyPosition, explainStudy } from './src/study-coach.js';
import { createModelRequestGate } from './src/model-request.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const costlyPaths = new Set(['/api/engine', '/api/coach', '/api/compare', '/api/model/test', '/api/import/locate', '/api/import/recognize', '/api/import/solve', '/api/import/explain', '/api/study/analyze']);

function sameToken(actual, expected) {
  const a = Buffer.from(actual || ''), b = Buffer.from(expected || '');
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(res, status, data) { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function bodyJson(req, limit = 16384) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('请使用 JSON 请求。'), { status: 415 });
  let size = 0; const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大。'), { status: 413 });
    parts.push(part);
  }
  try { const data = JSON.parse(Buffer.concat(parts).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw Object.assign(new Error('JSON 内容不正确。'), { status: 400 }); }
}

export function createApp({ publicMode = false, fetchImpl = fetch, engineAnalyze = analyze, engineReady = engineAvailable, engineCompare = engineAnalyze===analyze?analyzeCandidates:null } = {}) {
  const rateLimits = new Map();
  const analyzeImported = createImportedAnalyzer({ engineAnalyze, engineReady });
  const coachFailures=[];
  function rememberCoachFailure(route,result){
    if(publicMode||!result?.validationIssue||!['/api/import/explain','/api/study/analyze','/api/coach','/api/compare'].includes(route))return;
    coachFailures.push({at:new Date().toISOString(),route,code:result.code||'MODEL_COACH_RESPONSE_INVALID',issue:result.validationIssue,...(result.validationIssues?.length>1?{issues:result.validationIssues}:{} )});
    if(coachFailures.length>8)coachFailures.shift();
  }
  const modelRequests = createModelRequestGate(fetchImpl);
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url, 'http://local');
      if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: '不支持此请求方法。' });
      if (!publicMode && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return json(res, 403, { error: '本地服务不接受此主机名。' });
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        const expected = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
        if (origin && origin !== expected) return json(res, 403, { error: '不接受跨站请求。' });
        const token = process.env.APP_ACCESS_TOKEN;
        if (token && !sameToken(req.headers.authorization?.replace(/^Bearer /, ''), token)) return json(res, 401, { error: '请输入项目访问口令。' });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { name: '棋理学伴', version: '0.3.0', coachValidationMode:'advisory', engine: engineReady(), modelCredentialMode: 'session', defaultModel: DEFAULT_MODEL, models: MODEL_OPTIONS, needsToken: Boolean(process.env.APP_ACCESS_TOKEN), mode: publicMode ? 'server' : 'local', curriculumCount: PUZZLES.length });
      if (req.method === 'GET' && url.pathname === '/api/puzzles') return json(res, 200, { puzzles: PUZZLES.map(publicPuzzle) });
      if (req.method === 'GET' && url.pathname === '/api/knowledge') return json(res, 200, { knowledge: KNOWLEDGE });
      if (req.method === 'GET' && url.pathname === '/api/coach/diagnostics') return json(res,publicMode?404:200,publicMode?{error:'接口不存在。'}:{busy:modelRequests.busy(),failures:coachFailures});
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const data = await bodyJson(req, url.pathname === '/api/import/recognize' ? 4300000 : url.pathname === '/api/import/locate' ? 2200000 : 16384);
        if(url.pathname === '/api/import/recognize' && !['enhanced','mapped'].includes(data.recognitionMode) && Buffer.byteLength(JSON.stringify(data)) > 2200000) return json(res,413,{error:'请求内容过大。'});
        if (costlyPaths.has(url.pathname)) {
          const now = Date.now();
          for (const [key, item] of rateLimits) if (now - item.start > 60000) rateLimits.delete(key);
          const key = req.socket.remoteAddress + (url.pathname === '/api/study/analyze' ? ':study' : '');
          const item = rateLimits.get(key) || { start: now, count: 0 };
          if (++item.count > (url.pathname === '/api/study/analyze' ? 30 : 12) || rateLimits.size > 1000) return json(res, 429, { error: '分析请求过于频繁，请稍后重试。' });
          rateLimits.set(key, item);
        }
        if (url.pathname === '/api/model/test') {
          resolveModelConfig(data.modelSettings);
          return json(res, 200, await modelRequests.run(req, res, url.pathname, requestFetch => testModelConnection(data.modelSettings, requestFetch)));
        }
        if (url.pathname === '/api/import/validate') {
          const position = validateImportedPosition(data.fen);
          return json(res, 200, { fen: position.fen, turn: position.turn, pieceCount: position.pieceCount, status: position.status });
        }
        if (url.pathname === '/api/study/analyze') {
          resolveModelConfig(data.modelSettings);
          const position = studyPosition(data.baseFen, data.moves);
          return json(res, 200, await modelRequests.run(req, res, url.pathname, async requestFetch => {
            const report = await analyzeImported(position.fen, 2);
            return explainStudy(position, report, data.modelSettings, requestFetch, engineReady()?engineCompare:null, data.learner);
          }));
        }
        if (url.pathname === '/api/import/solve') { const report = await analyzeImported(data.fen, data.maxMoves); return json(res, 200, { ...report, walkthrough: importedWalkthrough(report) }); }
        if (['/api/import/locate','/api/import/recognize','/api/import/explain'].includes(url.pathname)) {
          resolveModelConfig(data.modelSettings);
          return json(res, 200, await modelRequests.run(req, res, url.pathname, async requestFetch => {
            if (url.pathname === '/api/import/locate') return locatePositionImage(data, requestFetch);
            if (url.pathname === '/api/import/recognize') return recognizePositionImage(data, requestFetch);
            const report = await analyzeImported(data.fen, data.maxMoves);
            return explainImportedPosition(report, data.modelSettings, requestFetch, engineReady()?engineCompare:null, data.learner);
          }));
        }
        const puzzle = findPuzzle(data.id);
        if (url.pathname === '/api/attempt') return json(res, 200, attempt(puzzle.id, data.move, data.history));
        if (url.pathname === '/api/hint') return json(res, 200, getHint(puzzle.id, data.level, data.history));
        if (url.pathname === '/api/lesson') return json(res, 200, { ...getLesson(puzzle.id, data.move, data.history), walkthrough: trainingWalkthrough(puzzle.id, data.move, data.history) });
        if (url.pathname === '/api/engine') return json(res, 200, await analyze(analysisFen(puzzle.id,data.history)));
        if (url.pathname === '/api/coach' || url.pathname === '/api/compare') {
          resolveModelConfig(data.modelSettings);
          return json(res, 200, await modelRequests.run(req, res, url.pathname, async requestFetch => {
            // Validate the exercise/history before the optional engine branch.
            // A broken/missing engine must not block rules-grounded coaching.
            const fen = analysisFen(puzzle.id,data.history);
            let engine = null, engineWarning = null;
            if (engineReady()) {
              try { engine = await engineAnalyze(fen); }
              catch { engineWarning = 'Pikafish 暂不可用，本次讲解仅使用规则证据，未使用引擎分析。'; }
            } else engineWarning = 'Pikafish 尚未就绪，本次讲解仅使用规则证据，未使用引擎分析。';
            if (url.pathname === '/api/coach') { const result=await generateCoach(puzzle.id, data.move, 'customized', engine, requestFetch, data.modelSettings, data.history,engineReady()?engineCompare:null,data.learner);rememberCoachFailure(url.pathname,result);return {...result,engineWarning}; }
            // Both conditions use the same model, move, rules and engine result.
            const comparisons=new Map();
            const compare=engineReady()&&engineCompare?(fen,moves,time)=>{
              const key=JSON.stringify([fen,moves,time]);
              if(!comparisons.has(key))comparisons.set(key,engineCompare(fen,moves,time));
              return comparisons.get(key);
            }:null;
            const baseline = await generateCoach(puzzle.id, data.move, 'baseline', engine, requestFetch, data.modelSettings, data.history,compare,data.learner);
            const customized = await generateCoach(puzzle.id, data.move, 'customized', engine, requestFetch, data.modelSettings, data.history,compare,data.learner);
            for(const result of [baseline,customized])rememberCoachFailure(url.pathname,result);
            return { puzzleId: puzzle.id, createdAt: new Date().toISOString(), engine, engineWarning, baseline: { ...baseline, engineWarning }, customized: { ...customized, engineWarning }, protocol: '同一模型、候选着法、规则证据与引擎结果（不可用时两组均不使用引擎）；比较领域知识与教学提示的增量。', manualRubric: ['规则与战术事实正确性', '解释与实际候选着法一致', '证据引用是否支持结论', '初学者能否理解与复现'], humanScores: null };
          }));
        }
        return json(res, 404, { error: '接口不存在。' });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在。' });
      if (req.method !== 'GET') return json(res, 405, { error: '不支持此请求方法。' });
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: '路径无效。' }); }
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      const file = path.resolve(PUBLIC, relative);
      if (!file.startsWith(PUBLIC + path.sep) || relative.split(/[\\/]/).some(item => item.startsWith('.'))) return json(res, 403, { error: '不允许访问该文件。' });
      try {
        const content = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
      } catch { json(res, 404, { error: '页面不存在。' }); }
    } catch (error) { if(res.destroyed)return;rememberCoachFailure(req.url?.split('?')[0],error);json(res, error.status || 500, { error: error.status ? error.message : '服务暂时出错，请重试。', ...(typeof error.code==='string' && error.code.startsWith('MODEL_') ? { code: error.code, ...(error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}), ...(error.validationIssue ? {validationIssue:error.validationIssue} : {}) } : {}) }); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const publicMode = !['127.0.0.1', 'localhost', '::1'].includes(host);
  if (publicMode && !process.env.APP_ACCESS_TOKEN) throw new Error('非本机监听必须设置 APP_ACCESS_TOKEN，避免公开消耗模型与引擎资源。');
  const server = createApp({ publicMode });
  server.requestTimeout = 10000; server.headersTimeout = 12000;
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '该端口已在使用中。若棋理学伴已启动，请直接访问原页面；否则在 .env 中更换 PORT。' : '服务启动失败，请检查 HOST、PORT 与运行环境。');
    process.exitCode = 1;
  });
  server.listen(Number(process.env.PORT || 8787), host, () => console.log(`棋理学伴 Local: http://${host}:${server.address().port}`));
}
