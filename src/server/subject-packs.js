// Structured translation of the user's 学科模版包 v0.1. No prices or factual claims are invented.
export const stageRuleKeys = [ "exam_sprint_before_grade", "insert_holiday_camp", "art_exam_end_after_school_exam", "art_transition_stage", "mock_exam_schedule" ];

const dims = names => names.split("·").map((name, i) => ({
  key: "d" + (i + 1),
  name: name.trim(),
  order: i + 1,
  feedback_tags: []
}));

const courses = rows => rows.map(([group, name, form, minutes, duration_text]) => ({
  group: group,
  name: name,
  form: form,
  minutes: minutes ?? null,
  duration_text: duration_text ?? null,
  pricing: null,
  active: true
}));

const stage = (name, min, max, anchor = "normal", anchor_node = null, offset_months = 0) => ({
  name: name,
  default_months: {
    min: min,
    max: max
  },
  anchor: anchor,
  anchor_node: anchor_node,
  offset_months: offset_months,
  active: true
});

const content = rows => rows.map(([name, required, optional]) => ({
  name: name,
  required: required.split("、"),
  optional: optional ? optional.split("、") : []
}));

const interestCalendar = [ {
  key: "grade_exam",
  name: "考级季",
  months: [ 1, 7, 8 ]
}, {
  key: "showcase",
  name: "汇报演出",
  months: [ 6, 12 ]
}, {
  key: "winter_camp",
  name: "寒假集训",
  months: [ 1, 2 ]
}, {
  key: "summer_camp",
  name: "暑假集训",
  months: [ 7, 8 ]
} ];

const examCalendar = [ {
  key: "summer_camp",
  name: "暑期集训",
  months: [ 7, 8 ]
}, {
  key: "unified_exam",
  name: "统考",
  months: [ 12 ],
  note: "按省份改"
}, {
  key: "school_exam",
  name: "校考",
  months: [ 1, 2, 3 ],
  next_year: true
} ];

const options = (extra = {}) => ({
  compare_previous: true,
  mock_exam: false,
  require_artwork: false,
  renewal_suggestion: false,
  ...extra
});

const constraints = {
  prohibited_terms: [ "包过", "保录", "100% 合格", "第一", "最好" ],
  policy_source: "只使用机构提供的官方文件",
  student_privacy: "默认姓氏或昵称；全名与照片需家长同意",
  report_basis: "只按老师要点与评分写，不推算分数、不和其他学员比较"
};

export const subjectPacks = {
  music_interest: {
    name: "音乐兴趣",
    version: "0.1",
    courses: courses([ [ "启蒙", "少儿音乐启蒙", "group", 45 ], ...[ "钢琴", "声乐", "小提琴", "古筝", "吉他", "架子鼓" ].flatMap(n => [ 30, 45, 60 ].map(m => [ "主修", n + "一对一" + m + "分钟", "one_to_one", m ])), [ "基础乐科", "乐理与视唱练耳", "group", 45 ], ...[ "合唱团", "少儿乐队", "室内乐重奏" ].map(n => [ "合奏", n, "group", 60 ]), ...[ "考级冲刺", "比赛曲目指导", "演出排练" ].map(n => [ "专项", n, "one_to_one", 45 ]), [ "假期", "寒暑假集训营", "camp", null, "按期" ] ]),
    stages: [ stage("体验与适应", 1, 2, "start"), stage("常规学习", 3, 5), stage("考级冲刺", 2, 2, "before_node", "grade_exam", -2), stage("假期集训", 1, 2, "on_node", "summer_camp") ],
    calendar: interestCalendar,
    rules: {
      exam_sprint_before_grade: true,
      insert_holiday_camp: true,
      art_exam_end_after_school_exam: false,
      art_transition_stage: false,
      mock_exam_schedule: false
    },
    classes: [ {
      name: "器乐通用",
      dimensions: dims("读谱识谱·节奏感·演奏技术·音乐表现力·练习习惯·课堂专注与自信"),
      options: options()
    }, {
      name: "声乐",
      dimensions: dims("读谱识谱·节奏感·音准·气息·咬字·音乐表现力·练习习惯·课堂专注与自信"),
      options: options()
    }, {
      name: "音乐启蒙",
      dimensions: dims("节奏·听辨·模仿·参与度"),
      options: options()
    } ],
    content_types: content([ [ "课程介绍 / 招生简章", "适合谁、学什么、上课形式与时间、报名方式", "师资、学员作品、常见问题" ], [ "体验课邀约", "体验内容、时间地点、预约方式", "老师介绍、家长常问" ], [ "考级报名提醒", "考级时间、报名截止、需要准备什么", "各级别要求、冲刺课安排" ], [ "演出预告 / 回顾", "活动概况、时间地点或现场亮点", "节目单、学员和家长感言、下一场预告" ], [ "考级 / 比赛喜报", "成绩概况、祝贺", "学员故事、老师寄语" ], [ "寒暑假班招生", "班型、时间、报名方式", "往期回顾、优惠说明" ] ])
  },
  music_exam: {
    name: "音乐艺考",
    version: "0.1",
    courses: courses([ ...[ "声乐主项", "钢琴主项", "器乐主项" ].map(n => [ "主项", n, "one_to_one", 60 ]), ...[ "钢琴副项", "声乐副项" ].map(n => [ "副项", n, "one_to_one", 45 ]), ...[ "乐理", "视唱", "练耳" ].map(n => [ "基本乐科", n, "group", 60 ]), ...[ "统考模拟考", "校考曲目指导", "试镜与舞台仪态" ].map(n => [ "应试", n, "group", 60 ]), ...[ "暑期集训", "统考冲刺集训" ].map(n => [ "集训", n, "camp", null, "按期" ]) ]),
    stages: [ stage("专业测评与基础", 2, 3, "start"), stage("常规提升", 3, 4), stage("暑期集训", 2, 2, "on_node", "summer_camp"), stage("统考冲刺", 3, 4, "before_node", "unified_exam", -3), stage("校考准备", 1, 3, "on_node", "school_exam") ],
    calendar: examCalendar,
    rules: {
      exam_sprint_before_grade: false,
      insert_holiday_camp: true,
      art_exam_end_after_school_exam: true,
      art_transition_stage: false,
      mock_exam_schedule: true
    },
    classes: [ {
      name: "音乐艺考",
      dimensions: dims("主项技术·曲目完成度·视唱·练耳·乐理·应试状态与舞台表现"),
      options: options({
        mock_exam: true
      })
    } ],
    content_types: content([ [ "集训营招生", "集训时间、课程安排、师资、报名方式", "往届成果、住宿与管理、常见问题" ], [ "统考 / 校考提醒", "关键日期、考试科目、现在该做什么", "政策变化解读（须机构提供文件）" ], [ "模拟考公告 / 总结", "时间地点、考试内容或整体情况", "评委建议、下一阶段重点" ], [ "合格与录取喜报", "祝贺、成绩概况", "学员故事（须家长同意）" ], [ "专业方向解读", "专业是什么、考什么、适合谁", "就业与升学去向" ] ])
  },
  art_interest: {
    name: "美术兴趣",
    version: "0.1",
    courses: courses([ [ "启蒙", "少儿创意美术", "group", 90 ], ...[ "素描基础", "色彩（水彩 / 水粉）", "速写" ].map(n => [ "基础", n, "group", 120 ]), ...[ "国画", "书法（硬笔 / 软笔）", "漫画插画", "手工陶艺" ].map(n => [ "特色", n, "group", 90 ]), ...[ "考级班", "比赛创作指导" ].map(n => [ "专项", n, "group", 90 ]), [ "活动", "户外写生", "group", null, "按次" ], [ "活动", "寒暑假特训营", "camp", null, "按期" ] ]),
    stages: [ stage("体验与适应", 1, 1, "start"), stage("常规学习", 3, 5), stage("过渡阶段", 1, 2), stage("假期特训", 1, 2, "on_node", "summer_camp") ],
    calendar: interestCalendar.map(x => x.key === "showcase" ? {
      ...x,
      name: "学员画展"
    } : x),
    rules: {
      exam_sprint_before_grade: false,
      insert_holiday_camp: true,
      art_exam_end_after_school_exam: false,
      art_transition_stage: true,
      mock_exam_schedule: false
    },
    classes: [ {
      name: "创意美术",
      dimensions: dims("观察力·想象与创意·色彩感受·画面构图·动手能力·专注与完成度"),
      options: options({
        require_artwork: true
      })
    }, {
      name: "素描色彩",
      dimensions: dims("造型比例·结构·明暗关系·色彩关系·画面组织·完成度"),
      options: options({
        require_artwork: true
      })
    } ],
    content_types: content([ [ "学期招生", "班型与年龄、学什么、上课时间、报名方式", "学员作品、老师介绍" ], [ "寒暑假特训", "主题、日程、报名方式", "往期作品、材料说明" ], [ "画展预告 / 回顾", "时间地点或现场亮点", "作品解读、家长感言" ], [ "优秀作品分享", "作品、创作思路", "老师点评（须家长同意）" ], [ "考级提醒 / 喜报", "考级时间与准备或结果", "各级别要求" ], [ "写生 / 节日手工活动", "活动内容、时间地点、报名", "需要带的材料" ] ])
  },
  art_exam: {
    name: "美术艺考",
    version: "0.1",
    courses: courses([ ...[ "素描（石膏 / 头像 / 静物）", "色彩（静物 / 风景）", "速写（人物）" ].map(n => [ "统考科目", n, "group", null, "半天 / 全天" ]), ...[ "设计基础", "创作", "校考专项" ].map(n => [ "校考科目", n, "group", null, "半天" ]), ...[ "模拟考", "限时训练", "评画讲评" ].map(n => [ "应试", n, "group", null, "半天" ]), [ "基础期", "周末基础班", "group", 240 ], ...[ "暑期集训", "统考冲刺集训", "校考集训" ].map(n => [ "集训", n, "camp", null, "按期 / 按月" ]), ...[ "住宿", "画材" ].map(n => [ "可选费用", n, "package", null, "自选" ]) ]).map(x => ({
      ...x,
      optional: x.group === "可选费用"
    })),
    stages: [ stage("周末基础", 1, 12, "start"), stage("暑期集训", 2, 2, "on_node", "summer_camp"), stage("统考冲刺", 3, 4, "before_node", "unified_exam", -3), stage("校考集训", 1, 3, "on_node", "school_exam") ],
    calendar: examCalendar,
    rules: {
      exam_sprint_before_grade: false,
      insert_holiday_camp: true,
      art_exam_end_after_school_exam: true,
      art_transition_stage: false,
      mock_exam_schedule: true
    },
    classes: [ {
      name: "美术艺考",
      dimensions: dims("素描造型·素描结构·素描明暗·素描画面·色彩色调·色彩冷暖·色彩塑造·速写动态·速写比例·速写线条·应试速度"),
      options: options({
        mock_exam: true,
        require_artwork: true
      })
    } ],
    content_types: content([ [ "集训招生", "时间、课程安排、师资、报名方式", "画室环境、住宿与管理、往届成果" ], [ "统考 / 校考提醒", "关键日期、考试科目与时长、现在该做什么", "政策解读（须机构提供文件）" ], [ "模拟考 / 讲评", "概况、高分卷展示", "老师讲评要点" ], [ "合格与录取喜报", "祝贺、成绩概况", "学员故事（须家长同意）" ], [ "画室作品展示", "作品、创作要点", "教学理念" ] ])
  }
};

for (const pack of Object.values(subjectPacks)) {
  pack.constraints = constraints;
  pack.tone = pack.name.includes("艺考") ? "专业、务实" : "亲切、鼓励";
}
