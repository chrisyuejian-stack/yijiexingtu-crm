# AI 入口手册

各 AI 被叫醒时，读 `AGENTS.md` 和自己的手册（`gemini.md` / `grok.md` / `gpt.md`），然后按下面的领任务流程干活。

## 领任务流程（所有 AI 通用）
1. 打开 https://github.com/chrisyuejian-stack/yijiexingtu-crm/issues?q=is%3Aopen+label%3Atask ，找标题以你的名字开头（`[Gemini]` / `[Grok]` / `[GPT]`）且没有 `in-progress` 标签的 Issue，按编号从小到大。
2. 全仓库通用任务（标题不带名字，如“全面扫描”）按其中分工表认领自己的部分。
3. 认领：在 Issue 评论 `认领：<你的名字>`，并加 `in-progress` 标签（没有权限加标签就只评论）。
4. 从最新 `main` 建分支 `<名字小写>/<issue号>-<简述>`，实现，本地 `npm run build && npm test` 通过。
5. 开 PR，描述 ≤ 10 行，写 `Closes #<号>`。CI 全绿且无拦截标签会自动合并，不要自己打合并标签。
6. 没有任务就停下，**不要自创工作**。想到好点子，开 Issue（标题 `[建议] ...`，不带 `task` 标签），由 Claude 决定是否排期。
7. 卡住（需求不明、需要改接口契约、需要改迁移或鉴权）：在 Issue 评论说明，给 PR 或 Issue 打 `needs-claude`，然后换下一个任务。

## 通用红线
见 `AGENTS.md`。尤其：不改迁移 0001–0028、不提交密钥、不跳过或删除测试、不提交 `work/` 与 `package-lock.json`。

## 省 token
只读与任务相关的文件；评论和 PR 描述简短；不要通读仓库。

## 本地运行
```sh
npm install
npm run build
npm test                 # 源码模式
TEST_BUNDLE=1 npm test   # 打包模式
npm run test:e2e         # 浏览器验收（无 ffmpeg 的环境见下）
```
无 ffmpeg 时，`tests/e2e/helpers.mjs` 的 `recordVideo` 会让 e2e 直接失败，可临时去掉调试，**不要提交**。
