// Static synthetic platform sample. No tenant data is queried at preview time.
export const planPreview = {
    subject: "music_interest",
    title: "平台示例：学习规划",
    style: {
        pack_id: "stp_folio",
        pack_version: "1.0.0",
        cover_image_id: null,
        text_mode: "auto",
        focal_point: {
            x: .5,
            y: .5
        },
        show_unit_price: false,
        show_latin_eyebrow: true,
        show_consultant: true
    },
    meta: {
        start_month: "2026-11",
        target: {
            node_key: null,
            month: null,
            text: ""
        },
        budget_cap: null
    },
    modules: {
        cover: {
            visible: true,
            eyebrow: "",
            subtitle: ""
        },
        assessment: {
            visible: true,
            text: "",
            source_note: "",
            strengths: [],
            gaps: [],
            goals: []
        },
        path: {
            visible: true,
            stages: [ {
                key: "stk_5f440ee3f89eaeb4cd642f80",
                stage_type_id: "example_1",
                name: "体验与适应",
                start: "2026-12-01",
                end: "2026-12-31",
                teaching_weeks: null,
                weeks_note: "",
                goals: [],
                node_tags: []
            } ]
        },
        courses: {
            visible: true,
            lines: [ {
                line_id: "ln_3448c8ff8b3a8bee49254891",
                stage_key: "stk_5f440ee3f89eaeb4cd642f80",
                course_id: "example_2",
                qty: {
                    units: 2
                },
                frequency_text: "",
                note: "",
                ai_filled: false,
                includes: [],
                snapshot: {
                    name: "钢琴一对一",
                    form: "one_to_one",
                    minutes: 45,
                    duration_text: null,
                    optional: false,
                    pricing: {
                        mode: "per_unit",
                        units_per_package: null
                    }
                }
            } ]
        },
        fees: {
            visible: true,
            installments: "per_stage",
            custom: [],
            due_dates: {},
            note: ""
        },
        teachers: {
            visible: true,
            teacher_ids: []
        },
        about: {
            visible: false
        }
    },
    computed: {
        stages: [ {
            key: "stk_5f440ee3f89eaeb4cd642f80",
            months: 1,
            calendar_weeks: 4,
            teaching_weeks: null,
            weeks_display: 4,
            units: 2,
            amount: 400
        } ],
        total: {
            units: 2,
            bundles: [],
            amount: 400
        },
        budget: {
            cap: null,
            remaining: null,
            over: false
        },
        installments: [ {
            stage_key: "stk_5f440ee3f89eaeb4cd642f80",
            label: "第1期 · 体验与适应",
            due: null,
            amount: 400
        } ],
        optional_fees: [],
        cover_numbers: [ {
            label: "规划周期",
            value: "1",
            unit: "个月",
            sub: "2026.12 – 2026.12"
        } ]
    },
    id: "pln_8a4069afa43dfc99dbf44295",
    revision_id: "example_3",
    student: {
        nickname: "示例同学",
        display_name: "示例同学"
    },
    brand: {
        name: "平台示例机构",
        logo: null,
        primary_color: "#A3271F"
    },
    consultant: {
        name: "主管"
    },
    teachers: [],
    example: true
};
