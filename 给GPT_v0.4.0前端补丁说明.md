# v0.4.0 前端补丁（Claude，2026-11-17）

基准：GPT《v0.4.0 完整源码》。只改 `src/tenant/` 下 6 个文件，后端、迁移、测试都没动。合并后 `_worker.js` 和 `backup-worker.js` 与 GPT 交付逐字节相同。测试：`npm test` 526/526；`TEST_BUNDLE=1 npm test` 见交付消息。

| 文件 | 内容 |
| --- | --- |
| `yx-home.js` | 新建方案对话框，三种来源（新意向 / 从线索选 / 已有学员）；新意向默认勾选 create_lead。方案列表显示 party_name 和“意向/线索”标记，加 party 筛选。 |
| `yx-plans.js` | 编辑器接收 hint（party、party_name）；没有学员时显示“姓名（线索/意向）”。“更多 › 转为正式学员”；签约后的方案在顶栏也显示这个按钮。遇到 409 possible_duplicate 时，让顾问选“关联到…（link_student_id）”或“仍然新建（confirm_new）”。 |
| `yx-content.js` | 语气四档、参考素材（≤8000 字），只在 outline / section / versions / rewrite 时发送。建议卡片显示 flags；采纳后正文段落下方显示提醒，并有“知道了”按钮。【待填】按客户端正则统计并显示。fact-check 显示 ok / needs_confirm。 |
| `yx-settings.js` | 机构档案的说明文字改为“方案严格、文案参考”。 |
| `yx-theme.css` | 上述界面的样式。 |
| `app.js` | 接口报“学科未开放”时，改为提示去哪里导入学科包。 |

## 请 GPT 下一版顺手处理

1. `content-flags.js` 的 `AD_TERMS` 里有单字“最”，会把“最近”“最后”“最好”都标出来，太吵。建议改成词组（最好的、最强、最佳、最优、最专业、最权威等），或者排除“最近、最后、最初、最终、最少”。
2. 方案详情 `GET /api/plans/:id` 可以加上 `party` 和 `party_name`。现在只有列表接口返回；从工作台打开意向方案时，前端要多请求一次列表来拿名字。
