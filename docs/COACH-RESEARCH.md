# 真人棋评研究与讲解约束（2026-10-22）

## 阅读资料

- Jim Png：[Maneuvering Material](https://www.xiangqi.com/articles/basic-xiangqi-chinese-chess-midgame-tactics-04-maneuvering-material)。用具体目标、行动路线及子力重新部署后的作用解释调动。
- Jim Png：[Sacrificing Material](https://www.xiangqi.com/articles/basic-xiangqi-chinese-chess-midgame-tactics-05-sacrificing-material)。把弃子与后续获得的攻击条件、对手应对联系起来，不能只报一着结果。
- 象棋百科：[布局陷阱第126局](https://www.xqbase.com/funnychess/answer126.htm)。借实际分支对照说明选着差异及不同应对的后果。
- Pikafish [UCI 实现](https://github.com/official-pikafish/Pikafish/blob/master/src/uci.cpp)、[搜索实现](https://github.com/official-pikafish/Pikafish/blob/master/src/search.cpp)。核对 MultiPV、searchmoves 和输出深度、分值格式，用于提供同一局面的候选比较证据。

以上是作者棋评与引擎实现资料。提示词示范为本项目自行编写的双车接力和炮借架吃车，不是复制网页棋评，也不将其他棋局的着法作为当前局面的事实。

## 落实到程序

`src/coach-prompt.js` 的 `xiangqi-human-commentary-v2` 约束普通题、预置残局、导入和摆谱。分析顺序为局面具体问题、主着目的、成立条件、对手动机、实走后的结果、其他选着、后续计划。规则合法与着法好坏分开。未被将军的安静着，不能写成必须解除将军。

`src/position-facts.js` 提供走前走后子力、走子直接效果、将帅周边格的攻击者或己方占位。`src/teaching-analysis.js` 逐步收集同根局面候选及对方应对的合法引擎变化、吃子记录和末尾子力。只比较同深度、同视角、同为精确 cp 的值；分数是参考，不能替代对变例的棋理解说。参考线不覆盖原有正确解的证明线。

本地规则说明与成功 DS 输出均显示来源。对长输出做结构、步骤、变化、证据和坐标校验；复制旧规则占位原因的结果被拒绝。结构合格仍不等于自然语言棋理全部正确，不能宣称已完成语义验证。

## 用户案例

用户反馈的黑方 `g5i7` 是没有被将军时的象退边线，旧教案却使用“解除红方攻击”的通用目标，并在原因内重复象的移动规则。已改掉错误目标，且不再把本地教案当作 DS 输出。实际 Windows Pikafish 已对该根局面的四个合法候选完成同深度比较，并验证合法后续可通过导入讲解契约；这是引擎与模拟模型的集成检查，不是真实 DS 讲棋质量验收。

有限搜索中接近零分只支持暂评平衡。总结要明确程序当前有依据的红胜、黑胜或胜负未定；未接入残局库及完整循环裁定时，不伪造和棋证明。

## 验收边界

本轮没有调用真实 DS，也没有读取或输出页面 Key。自动测试中的模型内容为 mock，真实引擎和用户棋盘截图像素另行验证。后续应在页面对同一局面重新点“DS 逐步讲解”，检查能否讲清象的调动目的、红方不同应对和走后计划；不能用本文件或测试通过代替这一步人工验收。
