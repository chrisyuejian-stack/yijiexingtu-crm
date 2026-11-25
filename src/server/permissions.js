export const modules = [
  "home",
  "schedule",
  "templates",
  "lessons",
  "attendance",
  "students",
  "followup",
  "packages",
  "tuition",
  "teacher_pay",
  "settlements",
  "reports",
  "exports",
  "settings",
  "accounts",
  "logs",
  "profile",
  "classes",
  "leads",
  "referrals",
  "imports",
  "comments",
  "promo",
  "content", "plans", "growth_reports", "school_db", "prices", "feedback", "parents", "ai", "usage",
];
const defaults = {
  consultant: {
    home: ["read"], students: ["read"], schedule: ["read"], lessons: ["read"], templates: ["read"],
    leads: ["read", "create", "update", "delete"], settings: ["read"], profile: ["read", "update"],
  },
  academic: {
    classes: ["read", "create", "update", "delete"],
    leads: ["read", "create", "update", "delete"],
    referrals: ["read", "create", "update"],
    imports: ["read", "create"],
    home: ["read"],
    schedule: ["read", "create", "update", "export"],
    templates: ["read", "create", "update", "export"],
    lessons: ["read", "create", "update", "export"],
    attendance: ["read", "create", "update", "export"],
    students: ["read", "create", "update", "export"],
    followup: ["read", "create", "update", "export"],
    packages: ["read", "create", "update", "export"],
    reports: ["read"],
    exports: ["read", "export"],
    settings: ["read"],
    accounts: ["create_personal", "reset_personal"],
    comments: ["read", "update"],
    profile: ["read", "update"],
    promo: ["read", "create", "update"],
  },
  finance: {
    home: ["read"],
    schedule: ["read"],
    templates: ["read"],
    lessons: ["read"],
    attendance: ["read"],
    students: ["read"],
    packages: ["read", "create", "update", "approve", "adjust", "transfer"],
    tuition: ["read", "create", "update", "approve", "export"],
    teacher_pay: ["read", "create", "update", "approve", "export"],
    settlements: ["read", "create", "update", "submit"],
    reports: ["read"],
    exports: ["read", "export"],
    settings: ["read", "rates_update"],
    logs: ["read_finance"],
    profile: ["read", "update"],
  },
  teacher: {
    home: ["read"],
    schedule: ["read"],
    lessons: ["read"],
    attendance: ["read", "submit"],
    students: ["read"],
    teacher_pay: ["read"],
    comments: ["read", "create", "update"],
    exports: ["export"],
    profile: ["read", "update"],
  },
  student: {
    home: ["read"],
    schedule: ["read"],
    lessons: ["read"],
    attendance: ["read"],
    students: ["read"],
    packages: ["read"],
    tuition: ["read"],
    comments: ["read"],
    exports: ["export"],
    profile: ["read", "update"],
  },
};
// 唯一授权入口。个人数据调用必须携带含归属信息的 record；列表服务也必须逐条调用。
export function can(user, policy, module, action, record) {
  if(user&&["plan_templates","plan_references"].includes(module))return identityPermission(user,policy,module,action,record);
  if (!user || !modules.includes(module) || !policy.modules[module])
    return false;
  const roles = user.roles;
  const identity = identityPermission(user, policy, module, action, record);
  if (identity !== undefined) return identity;
  if (
    module === "promo" &&
    !roles.some((r) => ["supervisor", "academic"].includes(r))
  )
    return false;
  if (
    (module === "attendance" && action === "submit") ||
    (module === "comments" && action === "create")
  ) {
    if (!roles.includes("teacher")) return false;
  }
  if (module === "attendance" && ["confirm", "return"].includes(action))
    return (
      roles.some((r) => ["supervisor", "academic"].includes(r)) &&
      can(user, policy, "attendance", "update", record)
    );
  if (module === "comments" && action === "correct")
    return (
      roles.some((r) => ["supervisor", "academic"].includes(r)) &&
      can(user, policy, "attendance", "update", record)
    );
  if (
    roles.includes("teacher") &&
    ((module === "attendance" && action === "submit") ||
      (module === "comments" && ["create", "update"].includes(action))) &&
    record?.teacher_id !== user.teacher_id
  )
    return false;

  if (
    roles.includes("student") &&
    ((module === "packages" && !policy.settings.student_view_balance) ||
      (module === "tuition" && !policy.settings.student_view_payments))
  )
    return false;
  if (
    roles.includes("teacher") &&
    module === "attendance" &&
    action === "submit" &&
    !policy.settings.teacher_self_checkin
  )
    return false;
  if (
    module === "settlements" &&
    ["approve", "unlock", "reject"].includes(action)
  )
    return roles.includes("supervisor");
  if (module === "settlements" && action === "submit")
    return roles.includes("finance");
  if (module === "settings" && action === "configure_absence")
    return roles.includes("supervisor");
  // 不可委派的账号安全边界优先于任何自定义授权。
  if (module === "accounts") {
    if (action === "update" && record?.id === user.id) return false;
    if (["create_personal", "reset_personal"].includes(action)) {
      if (roles.includes("supervisor")) return true;
      if (!roles.includes("academic")) return false;
      const key =
        action === "create_personal"
          ? "academic_can_create_accounts"
          : "academic_can_reset_accounts";
      if (policy.settings[key] === false) return false;
      const targetRoles =
        typeof record?.roles === "string"
          ? JSON.parse(record.roles)
          : record?.roles;
      return (
        Array.isArray(targetRoles) &&
        targetRoles.length === 1 &&
        ["teacher", "student"].includes(targetRoles[0])
      );
    }
    return roles.includes("supervisor");
  }
  if (module === "students" && action === "read_balance")
    return (
      roles.includes("teacher") &&
      !!user.teacher_id &&
      policy.modules.packages &&
      policy.settings.teacher_view_student_balance === true &&
      record?.teacher_id === user.teacher_id &&
      record?.current_main === true &&
      can(user, policy, "students", "read", record)
    );
  const granted = roles.some((role) => {
    if (role === "supervisor") return true;
    const custom = policy.rights.find(
      (r) => r.role === role && r.module === module && r.action === action,
    );
    return ["academic", "finance"].includes(role) && custom
      ? !!custom.allowed
      : !!defaults[role]?.[module]?.includes(action);
  });
  if (!granted) return false;
  if (roles.some((r) => ["teacher", "student"].includes(r))) {
    if (module === "profile") return !record || record.id === user.id;
    if (!record) return false;
    if (roles.includes("teacher"))
      return (
        !!user.teacher_id &&
        (record.teacher_id === user.teacher_id ||
          record.assistant_id === user.teacher_id)
      );
    return !!user.student_id && record.student_id === user.student_id;
  }
  return true;
}
export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  roles: typeof u.roles === "string" ? JSON.parse(u.roles) : u.roles,
  phone: "***" + u.phone_last4,
  teacher_id: u.teacher_id,
  student_id: u.student_id,
  must_change: !!u.must_change,
  active: !!u.active,
  version: u.version,
});
// 金额按领域分别授予，避免只有学费权限就能读取所有教师薪酬。
export function projectRecord(user, policy, module, record) {
  if (!can(user, policy, module, "read", record)) return null;
  const result = structuredClone(record);
  const tuition = can(user, policy, "tuition", "read", record);
  const pay = can(user, policy, "teacher_pay", "read", record);
  function strip(value, domain) {
    if (Array.isArray(value)) {
      value.forEach((item) => strip(item, domain));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (key === "other_income" && !tuition) {
        delete value[key];
        continue;
      }
      const compact = key.replaceAll("_", "").toLowerCase();
      let fieldDomain =
        /teacher|salary|overrideRate|lockedRate/i.test(key) ||
        compact === "rate"
          ? "teacher_pay"
          : /tuition|studentpayment|unitprice|seatprice|suggestedprice|earnedamount|otherincome|balanceamount|depositamount|overflow/i.test(
                compact,
              )
            ? "tuition"
            : domain;
      if (
        /amount|price|rate|cost|fee|salary|paid|tuition|profit/i.test(key) &&
        (value[key] === null || typeof value[key] !== "object")
      ) {
        if (
          fieldDomain === "tuition"
            ? !tuition
            : fieldDomain === "teacher_pay"
              ? !pay
              : !(tuition && pay)
        )
          delete value[key];
      } else strip(value[key], fieldDomain);
    }
  }
  strip(
    result,
    ["tuition", "packages"].includes(module)
      ? "tuition"
      : module === "teacher_pay"
        ? "teacher_pay"
        : null,
  );
  return result;
}

// New tool permissions are separate from legacy financial reports and financial settings.
function identityPermission(user, policy, module, action, record) {
  const roles = user.roles;
  const supervisor = roles.includes('supervisor');
  const academic = roles.includes('academic');
  const consultant = roles.includes('consultant');
  const teacher = roles.includes('teacher');
  const student = roles.includes('student');
  const parent = roles.includes('parent');
  if (['plan_templates','plan_references'].includes(module)) return !!policy.modules.plans && (supervisor || academic || consultant) && (module==='plan_templates'?['read','write'].includes(action):action==='write');
  if (module === 'settings' && ['write', 'propose'].includes(action))
    return action === 'write' ? supervisor : supervisor || academic || consultant;
  if (module === 'settings' && record?.settings_scope === 'tools')
    return action === 'read' && (supervisor || academic || consultant ||
      (teacher && record.kind === 'report_dimensions'));
  if (['content','plans','growth_reports','school_db','prices','feedback','parents','ai','usage'].includes(module)) {
    if (module === 'usage') return action === 'read' && supervisor;
    if (module === 'parents') return action === 'manage' && (supervisor || academic);
    if (module === 'prices') return action === 'write' ? supervisor : action === 'read' && (supervisor || academic || consultant || roles.includes('finance'));
    if (module === 'content') return ['read','write'].includes(action) && (supervisor || consultant);
    if (module === 'school_db') return action === 'read' && (supervisor || academic || consultant);
    if (module === 'ai') return action === 'use' && (supervisor || academic || consultant ||
      (teacher && ['feedback','growth_reports'].includes(record?.tool) &&
       !!user.teacher_id && record?.teacher_id === user.teacher_id));
    if (module === 'feedback') return action === 'confirm' ? supervisor || academic
      : action === 'write' && teacher && !!user.teacher_id && record?.teacher_id === user.teacher_id;
    if (module === 'plans') {
      if (['write','share'].includes(action)) return supervisor || academic || consultant;
      if (action !== 'read') return false;
      if (supervisor || academic || consultant || roles.includes('finance')) return true;
      return (student || parent) && ['sent','signed'].includes(record?.status) && ownsChild(user, record?.student_id);
    }
    if (module === 'growth_reports') {
      if (!['read','write','publish','unpublish'].includes(action)) return false;
      if (supervisor || academic) return true;
      if (consultant) return action === 'read';
      if (teacher) return !!user.teacher_id && record?.teacher_id === user.teacher_id && record?.main !== false &&
        (['read','write'].includes(action) || policy.settings.teacher_can_publish_reports === true);
      return action === 'read' && (student || parent) && record?.status === 'published' && ownsChild(user, record?.student_id);
    }
  }
  if (parent) {
    if (module === 'profile') return ['read','update'].includes(action) && (!record || record.id === user.id);
    if (!record?.student_id || !ownsChild(user, record.student_id)) return false;
    return can({ ...user, roles: ['student'], student_id: record.student_id }, policy, module, action, record);
  }
  return undefined;
}
function ownsChild(user, id) {
  return !!id && (user.roles.includes('student') ? user.student_id === id : user.guardian_student_ids?.includes(id));
}
