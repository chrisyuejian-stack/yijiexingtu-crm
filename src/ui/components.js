import {
  viewFormat,
  studentDisplay,
  personStatus,
  leadMoveAllowed,
} from "../shared/view.js";
// 独立前端组件，无接口调用、业务计算或权限推断。
let sequence = 0;
const uid = (prefix) => `ui-${prefix}-${++sequence}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Durations belong to the CSS tokens; exit cleanup follows the actual computed duration.
const transitionMs = (element) => {
  const css = getComputedStyle(element);
  const parse = (text) =>
    text
      .split(",")
      .map((v) => parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000));
  return (
    Math.max(0, ...parse(css.transitionDuration)) +
    Math.max(0, ...parse(css.transitionDelay)) +
    10
  );
};
export function node(tag, text, attrs = {}) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.toLowerCase() === "style" || /^on/i.test(key))
      throw Error("不允许内联样式或事件属性");
    if (value !== null && value !== undefined)
      element.setAttribute(key, String(value));
  }
  return element;
}
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ui-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const shapes = globalThis.ChannelUISymbols?.[name];
  if (shapes) {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const [tag, attrs] of shapes) {
      const shape = document.createElementNS(svg.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs))
        shape.setAttribute(key, value);
      svg.append(shape);
    }
    return svg;
  }
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute(
    "href",
    new URL(`./icons.svg#${name}`, import.meta.url).href,
  );
  svg.append(use);
  return svg;
}
export function button(
  label,
  {
    kind = "",
    icon: image,
    onClick,
    onError = errorToast,
    disabled = false,
  } = {},
) {
  const b = node("button", null, {
    type: "button",
    class: `ui-button${kind ? " ui-button--" + kind : ""}`,
  });
  const face = node("span", null, { class: "ui-button-face" });
  if (image) face.append(icon(image));
  const text = node("span", label);
  face.append(text);
  b.append(face);
  b.disabled = disabled;
  // 等待状态：点下立即防重复点击，但外观不变；超过 0.3 秒还没完成，按钮才变浅，
  // 保存/提交类按钮的文字换成“保存中…”。不再往按钮里塞转圈的小符号；图标按钮不显示等待。
  if (onClick)
    b.addEventListener("click", async (event) => {
      if (b.disabled) return;
      b.disabled = true;
      b.setAttribute("aria-busy", "true");
      const verb = kind !== "icon" && typeof label === "string" ? label.match(BUSY_VERB)?.[1] : null;
      const timer = setTimeout(() => {
        if (kind === "icon") return;
        b.classList.add("is-busy");
        if (verb && text.isConnected) text.textContent = verb + "中…";
      }, 300);
      try {
        await onClick(event);
      } catch (e) {
        onError(e);
      } finally {
        clearTimeout(timer);
        b.classList.remove("is-busy");
        if (verb && text.textContent === verb + "中…") text.textContent = label;
        b.disabled = disabled;
        b.removeAttribute("aria-busy");
      }
    });
  return b;
}
const BUSY_VERB = /^(保存|提交|确认|生成|删除|发布|登记|导入|导出|发送|上传|撤销|退回|下载)/;
export function iconButton(label, image, onClick) {
  const b = button("", { kind: "icon", icon: image, onClick });
  b.setAttribute("aria-label", label);
  b.setAttribute("title", label);
  return b;
}
export function field({
  label,
  name = uid("input"),
  value = "",
  type = "text",
  hint = "",
  error = "",
  required = false,
  validate,
} = {}) {
  const element = node("div", null, { class: "ui-field" }),
    id = uid(name);
  const input = node(type === "textarea" ? "textarea" : "input", null, {
    id,
    name,
    class: "ui-control",
  });
  if (type !== "textarea") input.type = type;
  input.value = value;
  input.required = required;
  if (type === "checkbox") {
    input.classList.add("ui-input-switch");
    input.setAttribute("role", "switch");
  }
  let wrapped;
  if (["date", "month", "time", "datetime-local"].includes(type)) {
    input.type = "hidden";
    if (!value && type === "month")
      input.value = viewFormat.date(Date.now()).slice(0, 7);
    if (!value && type === "time") input.value = "09:00";
    const change = (v) => {
      input.value = v;
    };
    if (type === "date")
      wrapped = datePicker({
        label,
        value: value || "",
        allowEmpty: true,
        onChange: change,
      }).element;
    else if (type === "month")
      wrapped = monthPicker({
        value: value || viewFormat.date(Date.now()).slice(0, 7),
        onChange: change,
      }).element;
    else if (type === "time")
      wrapped = timePicker({
        label,
        value: value || "09:00",
        onChange: change,
      }).element;
    else {
      const parts = String(value || "").split("T"),
        pair = node("div", null, { class: "ui-filter-bar" });
      let date = parts[0] || "",
        time = parts[1]?.slice(0, 5) || "09:00";
      pair.append(
        datePicker({
          label: label + "日期",
          value: date,
          allowEmpty: true,
          onChange: (v) => {
            date = v;
            change(date + "T" + time);
          },
        }).element,
        timePicker({
          label: label + "时间",
          value: time,
          onChange: (v) => {
            time = v;
            change(date + "T" + time);
          },
        }).element,
      );
      wrapped = pair;
    }
    // 日期/时间控件自带的小标签与字段标签重复，只留给读屏，不再显示。
    wrapped.classList.add("ui-inner-pick");
  }
  if (type === "file") {
    input.classList.add("ui-sr-only");
    wrapped = button("选择文件", { onClick: () => input.click() });
    const filename = node("span", "尚未选择文件");
    input.addEventListener("change", () => {
      filename.textContent = input.files?.[0]?.name || "尚未选择文件";
    });
    const row = node("div", null, { class: "ui-upload" });
    row.append(wrapped, filename);
    wrapped = row;
  }
  const caption = node("label", label, { for: id, class: "ui-field-label" }),
    help = node("p", hint, { class: "ui-field-hint", id: id + "-hint" }),
    feedback = node("p", "", {
      class: "ui-field-error",
      id: id + "-error",
      "aria-live": "polite",
    });
  input.setAttribute("aria-describedby", id + "-hint " + id + "-error");
  help.hidden = !hint;
  element.append(caption, input, ...(wrapped ? [wrapped] : []), help, feedback);
  const setError = (message = "") => {
    feedback.textContent = message;
    feedback.hidden = !message;
    input.setAttribute("aria-invalid", String(!!message));
  };
  const check = () => {
    const message = validate
      ? validate(input.value)
      : required && !input.value.trim()
        ? "请填写" + label
        : "";
    setError(message || "");
    return !message;
  };
  input.addEventListener("blur", check);
  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") check();
  });
  setError(error);
  return { element, input, setError, validate: check };
}
export function badge(text, tone = "neutral") {
  return node("span", text, { class: "ui-badge ui-badge--" + tone });
}
export function switchControl({
  label,
  description = "",
  checked = false,
  onCommit = async () => {},
  onError = errorToast,
} = {}) {
  let current = checked;
  const root = node("div", null, { class: "ui-switch-row" }),
    copy = node("span", null, { class: "ui-switch-copy" }),
    labelId = uid("switch-label"),
    descId = uid("switch-desc");
  copy.append(
    node("span", label, { id: labelId, class: "ui-switch-label" }),
    node("span", description, { id: descId, class: "ui-switch-description" }),
  );
  const control = node("button", null, {
    type: "button",
    role: "switch",
    class: "ui-switch",
    "aria-checked": String(checked),
    "aria-labelledby": labelId,
    "aria-describedby": descId,
  });
  const track = node("span", null, {
    class: "ui-switch-track",
    "aria-hidden": "true",
  });
  track.append(node("span", null, { class: "ui-switch-knob" }));
  control.append(track);
  const status = node("span", "", { class: "ui-sr-only", role: "status" });
  root.append(copy, control, status);
  control.addEventListener("click", async () => {
    if (control.disabled) return;
    const prior = current,
      next = !prior;
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
    control.setAttribute("aria-checked", String(next));
    status.textContent = "处理中";
    try {
      await onCommit(next);
      current = next;
      status.textContent = "已保存";
    } catch (e) {
      current = prior;
      control.setAttribute("aria-checked", String(prior));
      status.textContent = "保存失败，已恢复";
      onError(e);
    } finally {
      control.disabled = false;
      control.removeAttribute("aria-busy");
    }
  });
  return {
    element: root,
    control,
    get checked() {
      return current;
    },
  };
}
export function card(
  title,
  description = "",
  { interactive = false, onClick } = {},
) {
  const element = node(interactive ? "button" : "section", null, {
    class: "ui-card" + (interactive ? " ui-interactive" : ""),
  });
  if (interactive) element.type = "button";
  element.append(
    node(interactive ? "span" : "h3", title, { class: "ui-card-title" }),
  );
  if (description)
    element.append(
      node(interactive ? "span" : "p", description, {
        class: "ui-card-description",
      }),
    );
  if (onClick) element.addEventListener("click", onClick);
  return element;
}
export function updateNumber(element, text) {
  if (element.textContent === String(text)) return;
  element.textContent = String(text);
  element.classList.remove("ui-metric-flash");
  requestAnimationFrame(() => element.classList.add("ui-metric-flash"));
}
export function formatMoney(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? viewFormat.money(value)
    : "—";
}
export function emptyState(title, description, { action } = {}) {
  const e = node("section", null, { class: "ui-empty" });
  e.append(icon("empty"), node("h3", title), node("p", description));
  if (action) e.append(action);
  return e;
}
export function skeleton(kind = "line") {
  return node("span", null, {
    class: "ui-skeleton ui-skeleton--" + kind,
    "aria-hidden": "true",
  });
}
let toastRegion;
export function toast(message, { tone = "success", duration = 3000 } = {}) {
  // A native modal is above every body z-index. Keep notices in its top layer.
  const activeHost = () =>
    [...(document.querySelectorAll?.("dialog[open]") || [])].at(-1) || document.body;
  const host = activeHost();
  if (!toastRegion?.isConnected) {
    toastRegion = node("div", null, {
      class: "ui-root ui-toast-region",
      "aria-label": "通知",
    });
    toastRegion.dataset.uiTheme = document.body.dataset.uiTheme || "blue";
    host.append(toastRegion);
  } else if (toastRegion.parentElement !== host) {
    host.append(toastRegion);
  }
  if (host !== document.body)
    host.addEventListener("close", () => {
      // Successful saves close the drawer: retain the notice in the next layer.
      if (toastRegion?.parentElement === host) {
        for (const error of toastRegion.querySelectorAll(".ui-toast--error")) error.remove();
        activeHost().append(toastRegion);
      }
    }, { once: true });
  const item = node("div", null, {
    class: "ui-toast ui-toast--" + tone,
    role: tone === "error" ? "alert" : "status",
  });
  item.append(
    icon(tone === "error" ? "warning" : tone === "success" ? "check" : "info"),
    node("span", message, { class: "ui-toast-message" }),
  );
  let timer;
  const dismiss = async () => {
    clearTimeout(timer);
    item.classList.remove("is-open");
    await wait(transitionMs(item));
    item.remove();
  };
  item.append(iconButton("关闭通知", "close", dismiss));
  toastRegion.append(item);
  requestAnimationFrame(() => item.classList.add("is-open"));
  if (tone !== "error" && duration > 0) timer = setTimeout(dismiss, duration);
  return { element: item, close: dismiss };
}
export function errorToast(error) {
  return toast(error?.message || String(error), { tone: "error" });
}
const focusable = (parent) =>
  [
    ...parent.querySelectorAll(
      "button,input,select,textarea,a[href],[tabindex]",
    ),
  ].filter((x) => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length);
export function overlay({
  title,
  kind = "modal",
  trigger = document.activeElement,
  isDirty = () => false,
} = {}) {
  const element = node("dialog", null, {
      class: "ui-root ui-overlay ui-overlay--" + kind,
      "aria-modal": "true",
    }),
    mask = node("div", null, {
      class: "ui-overlay-mask",
      "aria-hidden": "true",
    }),
    panel = node("section", null, { class: "ui-sheet" }),
    header = node("header", null, { class: "ui-sheet-header" }),
    heading = node("h2", title, {
      class: "ui-sheet-title",
      id: uid("dialog-title"),
    }),
    body = node("div", null, { class: "ui-sheet-body" }),
    footer = node("footer", null, { class: "ui-sheet-footer" });
  element.setAttribute("aria-labelledby", heading.id);
  element.dataset.uiTheme =
    trigger?.closest("[data-ui-theme]")?.dataset.uiTheme ||
    document.body.dataset.uiTheme ||
    "blue";
  let asking = false,
    closing = false,
    busy = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    element.classList.add("is-closing");
    element.classList.remove("is-open");
    await wait(transitionMs(panel));
    element.close();
    element.remove();
    if (trigger?.isConnected) trigger.focus();
    requestAnimationFrame(() => {
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    });
  };
  const requestClose = async () => {
    if (asking || closing || busy) return;
    if (isDirty()) {
      asking = true;
      const discard = await confirmDialog({
        title: "放弃未保存的修改？",
        message: "尚有修改没有保存，关闭后这些修改将丢失。",
        confirmLabel: "放弃修改",
        cancelLabel: "继续编辑",
        danger: true,
      });
      asking = false;
      if (!discard) return;
    }
    await close();
  };
  header.append(heading, iconButton("关闭", "close", requestClose));
  panel.append(header, body, footer);
  element.append(mask, panel);
  document.body.append(element);
  element.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void requestClose();
  });
  mask.addEventListener("click", () => void requestClose());
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void requestClose();
    }
    if (event.key === "Tab") {
      const list = focusable(element),
        first = list[0],
        last = list.at(-1);
      if (!first) {
        event.preventDefault();
        panel.tabIndex = -1;
        panel.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !element.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !element.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  element.showModal();
  requestAnimationFrame(() => {
    element.classList.add("is-open");
    (
      body.querySelector(
        "[autofocus],input:not(:disabled),textarea:not(:disabled)",
      ) || focusable(panel)[0]
    )?.focus();
  });
  return {
    element,
    panel,
    body,
    footer,
    close,
    requestClose,
    setBusy(value) {
      busy = value;
      panel.setAttribute("aria-busy", String(value));
    },
  };
}
export function confirmDialog({
  title = "确认操作",
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const dialog = overlay({ title });
    let settled = false;
    const finish = async (value) => {
      if (settled) return;
      settled = true;
      await dialog.close();
      resolve(value);
    };
    dialog.body.append(node("p", message));
    dialog.footer.append(
      button(cancelLabel, { onClick: () => finish(false) }),
      button(confirmLabel, {
        kind: danger ? "danger" : "primary",
        onClick: () => finish(true),
      }),
    );
    // Resolve native dismissal too; prevents dirty-close promises from hanging.
    dialog.element.addEventListener(
      "close",
      () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
      { once: true },
    );
  });
}
export function disclosure(label, children, { open = false } = {}) {
  const root = node("section"),
    toggle = node("button", label, {
      type: "button",
      class: "ui-disclosure-toggle",
      "aria-expanded": String(open),
      "aria-controls": uid("disclosure"),
    }),
    panel = node("div", null, {
      class: "ui-disclosure-panel" + (open ? " is-open" : ""),
      id: toggle.getAttribute("aria-controls"),
    }),
    inner = node("div", null, { class: "ui-disclosure-inner" });
  toggle.append(icon("chevron-right"));
  inner.append(...children);
  panel.append(inner);
  root.append(toggle, panel);
  const set = (value) => {
    toggle.setAttribute("aria-expanded", String(value));
    panel.classList.toggle("is-open", value);
    inner.inert = !value;
  };
  set(open);
  toggle.addEventListener("click", () =>
    set(toggle.getAttribute("aria-expanded") !== "true"),
  );
  return root;
}
export function selectControl({
  label,
  options,
  value,
  onChange = () => {},
} = {}) {
  const root = node("div", null, { class: "ui-field ui-select" }),
    id = uid("select"),
    caption = node("label", label, { id: id + "-label" }),
    trigger = node("button", null, {
      type: "button",
      class: "ui-control ui-picker-trigger",
      id,
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
      "aria-labelledby": id + "-label",
    }),
    text = node("span"),
    menu = node("ul", null, {
      class: "ui-popover ui-select-options",
      role: "listbox",
      tabindex: "-1",
      id: id + "-options",
      "aria-labelledby": id + "-label",
    });
  root.append(caption, trigger, menu);
  trigger.append(text, icon("chevron-down"));
  menu.hidden = true;
  trigger.setAttribute("aria-controls", menu.id);
  let current = value ?? options[0]?.value,
    index = Math.max(
      0,
      options.findIndex((x) => x.value === current),
    );
  const close = () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const render = () => {
    text.textContent =
      options.find((x) => x.value === current)?.label || "请选择";
    menu.replaceChildren();
    options.forEach((option, i) => {
      const item = node("li", option.label, {
        role: "option",
        class: "ui-select-option" + (i === index ? " is-current" : ""),
        "aria-selected": String(option.value === current),
        id: id + "-" + i,
      });
      if (option.value === current) item.append(icon("check"));
      item.addEventListener("click", () => choose(i));
      menu.append(item);
    });
    menu.setAttribute("aria-activedescendant", id + "-" + index);
  };
  const choose = (i) => {
    current = options[i].value;
    index = i;
    render();
    close();
    trigger.focus();
    onChange(current);
  };
  const open = () => {
    index = Math.max(
      0,
      options.findIndex((x) => x.value === current),
    );
    render();
    menu.hidden = false;
    menu.classList.toggle(
      "is-above",
      root.getBoundingClientRect().bottom +
        Math.min(options.length * 44 + 8, 240) >
        innerHeight,
    );
    trigger.setAttribute("aria-expanded", "true");
    menu.focus();
  };
  trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open();
    }
  });
  menu.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      index =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? options.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length;
      render();
      menu.children[index]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(index);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger.focus();
    } else if (e.key === "Tab") close();
  });
  const outside = (e) => {
    if (!root.contains(e.target)) close();
  };
  document.addEventListener("pointerdown", outside);
  render();
  return {
    element: root,
    trigger,
    get value() {
      return current;
    },
    setValue(v) {
      if (!options.some((x) => x.value === v)) throw Error("选项不存在");
      current = v;
      render();
    },
    destroy() {
      document.removeEventListener("pointerdown", outside);
      root.remove();
    },
  };
}
export function isoDate(year, month, day) {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
export function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T12:00:00Z")) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function dateControl({
  label,
  value,
  allowEmpty = false,
  onChange = () => {},
} = {}) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  if (value && !validDate(value)) throw Error("日期格式不正确");
  let selected = value || (allowEmpty ? "" : today),
    active = selected || today,
    year = Number(active.slice(0, 4)),
    month = Number(active.slice(5, 7));
  const root = node("div", null, { class: "ui-field ui-date" }),
    id = uid("date"),
    caption = node("label", label, { id: id + "-label" }),
    trigger = node("button", null, {
      type: "button",
      class: "ui-control ui-picker-trigger",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-labelledby": id + "-label",
    }),
    text = node("span"),
    popup = node("div", null, {
      class: "ui-popover ui-calendar",
      role: "dialog",
      "aria-label": "选择日期",
      id,
    });
  trigger.append(text, icon("calendar"));
  trigger.setAttribute("aria-controls", id);
  root.append(caption, trigger, popup);
  popup.hidden = true;
  const close = () => {
    popup.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const choose = (date) => {
    selected = date;
    active = date;
    text.textContent = selected || "选择日期";
    close();
    trigger.focus();
    onChange(date);
  };
  const moveMonth = (delta) => {
    const focusedLabel = document.activeElement?.getAttribute("aria-label");
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    active = isoDate(
      year,
      month,
      Math.min(
        Number(active.slice(8)),
        new Date(Date.UTC(year, month, 0)).getUTCDate(),
      ),
    );
    render();
    if (["上个月", "下个月"].includes(focusedLabel))
      [...popup.querySelectorAll("button")]
        .find((e) => e.getAttribute("aria-label") === focusedLabel)
        ?.focus();
  };
  function render() {
    popup.replaceChildren();
    const head = node("div", null, { class: "ui-calendar-header" });
    head.append(
      iconButton("上个月", "chevron-left", () => moveMonth(-1)),
      node("strong", year + "年" + month + "月"),
      iconButton("下个月", "chevron-right", () => moveMonth(1)),
    );
    popup.append(head);
    const days = node("div", null, {
        class: "ui-calendar-grid",
        role: "grid",
        "aria-label": year + "年" + month + "月",
      }),
      weekHeader = node("div", null, {
        class: "ui-calendar-week",
        role: "row",
      });
    days.append(weekHeader);
    for (const day of ["一", "二", "三", "四", "五", "六", "日"])
      weekHeader.append(
        node("span", day, {
          class: "ui-calendar-weekday",
          role: "columnheader",
        }),
      );
    const start = new Date(Date.UTC(year, month - 1, 1)),
      shift = (start.getUTCDay() + 6) % 7;
    let week;
    for (let i = 0; i < 42; i++) {
      if (i % 7 === 0) {
        week = node("div", null, { class: "ui-calendar-week", role: "row" });
        days.append(week);
      }
      const date = isoDate(year, month, 1 - shift + i),
        outside = Number(date.slice(5, 7)) !== month;
      const b = node("button", Number(date.slice(8)), {
        type: "button",
        class:
          "ui-calendar-day" +
          (outside ? " is-outside" : "") +
          (date === today ? " is-today" : ""),
        role: "gridcell",
        "aria-label": date,
        "aria-selected": String(date === selected),
        tabindex: date === active ? "0" : "-1",
        "data-date": date,
      });
      b.addEventListener("click", () => choose(date));
      b.addEventListener("keydown", (e) => {
        const delta = {
          ArrowLeft: -1,
          ArrowRight: 1,
          ArrowUp: -7,
          ArrowDown: 7,
        }[e.key];
        if (delta !== undefined || e.key === "Home" || e.key === "End") {
          e.preventDefault();
          const d = new Date(date + "T12:00:00Z"),
            weekday = (d.getUTCDay() + 6) % 7;
          d.setUTCDate(
            d.getUTCDate() +
              (delta ?? (e.key === "Home" ? -weekday : 6 - weekday)),
          );
          active = d.toISOString().slice(0, 10);
          year = d.getUTCFullYear();
          month = d.getUTCMonth() + 1;
          render();
          popup.querySelector('[tabindex="0"]')?.focus();
        } else if (e.key === "PageUp" || e.key === "PageDown") {
          e.preventDefault();
          moveMonth(e.key === "PageUp" ? -1 : 1);
          popup.querySelector('[tabindex="0"]')?.focus();
        }
      });
      week.append(b);
    }
    popup.append(days);
  }
  trigger.addEventListener("click", () => {
    if (!popup.hidden) {
      close();
      return;
    }
    // 空日期打开时从今天所在月份开始（原来会显示“0年0月”）。
    active = selected || today;
    year = Number(active.slice(0, 4));
    month = Number(active.slice(5, 7));
    render();
    popup.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const box = root.getBoundingClientRect();
    popup.classList.toggle("is-above", box.bottom + 370 > innerHeight);
    // 靠右的日期框：日历改为右对齐，不超出窗口或侧边栏右边。
    const edge = Math.min(innerWidth, root.closest("dialog, .ui-overlay, aside")?.getBoundingClientRect().right || innerWidth);
    popup.classList.toggle("is-end", box.left + 312 > edge - 8);
    popup.querySelector('[tabindex="0"]')?.focus();
  });
  popup.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger.focus();
    }
    if (
      e.key === "Tab" &&
      !e.shiftKey &&
      document.activeElement === focusable(popup).at(-1)
    )
      close();
  });
  root.addEventListener("focusout", () =>
    setTimeout(() => {
      if (!root.contains(document.activeElement)) close();
    }, 0),
  );
  const outside = (e) => {
    if (!root.contains(e.target)) close();
  };
  document.addEventListener("pointerdown", outside);
  text.textContent = selected || "选择日期";
  return {
    element: root,
    trigger,
    get value() {
      return selected;
    },
    setValue(v) {
      if (!validDate(v)) throw Error("日期格式不正确");
      selected = v;
      text.textContent = v.replaceAll("-", " / ");
    },
    destroy() {
      document.removeEventListener("pointerdown", outside);
      root.remove();
    },
  };
}
export function pagination({
  loaded = 0,
  total = null,
  offset = 0,
  nextOffset = null,
  onPage = () => {},
  size = 200,
} = {}) {
  const e = node("nav", null, { class: "ui-pagination", "aria-label": "分页" }),
    text = node(
      "span",
      total === null ? "已加载 " + loaded + " 条" : "共 " + total + " 条",
    ),
    actions = node("span", null, { class: "ui-pagination-actions" });
  const previous = button("上一页", {
      icon: "chevron-left",
      disabled: offset === 0,
      onClick: () => onPage(Math.max(0, offset - size)),
    }),
    next = button("下一页", {
      icon: "chevron-right",
      disabled: nextOffset === null,
      onClick: () => onPage(nextOffset),
    });
  actions.append(previous, next);
  e.append(text);
  if (offset || nextOffset !== null) e.append(actions);
  return e;
}
export function dataList({
  columns,
  items = [],
  key = "id",
  label = "数据列表",
  searchable = false,
  selectable = false,
  manual = false,
  onReorder,
  onOpen,
  openLabel = "查看",
  visiblePrimary = false,
  onDelete,
  onBatch,
  onLoadMore,
  loadedLabel = "仅对已加载范围排序和筛选",
  filters = [],
  deleteMessage = "请先确认删除的影响，再继续操作。",
  deleteTitle = "确认删除？",
  state = {},
  compactActions = false,
  onSortChange,
  rowMore = [],
  pageSize = 0,
  pageOffset = 0,
  onPage = () => {},
  total = null,
  serverPage,
  emptyText,
  emptyAction,
} = {}) {
  manual = manual && typeof onReorder === "function";
  let records = [...items],
    query = state.query || "",
    sortKey = state.sortKey || null,
    direction = state.direction || 0,
    filterValue = state.filterValue || "",
    busy = false,
    dragged = null;
  const selected = new Set(),
    root = node("section", null, { class: "ui-list", "aria-label": label }),
    progress = node("div", null, {
      class: "ui-progress",
      "aria-hidden": "true",
    }),
    tools = node("div", null, { class: "ui-list-tools" }),
    scope = node("p", loadedLabel, { class: "ui-list-scope" }),
    tableWrap = node("div", null, { class: "ui-table-scroll" }),
    table = node("table", null, { class: "ui-table ui-table--responsive" }),
    chips = node("div", null, { class: "ui-filter-chips" }),
    bottom = node("div");
  root.append(progress);
  const search = node("input", null, {
      type: "search",
      class: "ui-control",
      placeholder: "搜索已加载内容",
      "aria-label": "搜索" + label,
    }),
    clear = iconButton("清空搜索", "close", () => {
      search.value = "";
      query = "";
      render();
      search.focus();
    });
  if (searchable) {
    const wrap = node("div", null, { class: "ui-search" });
    const image = icon("search");
    image.classList.add("ui-search-icon");
    wrap.append(image, search, clear);
    tools.append(wrap);
    search.addEventListener("input", () => {
      query = search.value;
      pageOffset = 0;
      render();
    });
  }
  search.value = query;
  let picker;
  if (filters.length) {
    picker = selectControl({
      label: "状态",
      options: [{ value: "", label: "全部状态" }, ...filters],
      value: filterValue,
      onChange: (v) => {
        filterValue = v;
        pageOffset = 0;
        render();
      },
    });
    tools.append(picker.element);
  }
  if (searchable || filters.length || columns.some((c) => c.sortable))
    root.append(tools, ...(loadedLabel ? [scope] : []), chips);
  tableWrap.append(table);
  root.append(tableWrap, bottom);
  const batch = node("div", null, {
      class: "ui-batch-bar",
      hidden: "",
      "aria-label": "已选操作",
    }),
    batchText = node("span", null, { role: "status" });
  const hideBatch = () => {
    batch.classList.remove("is-open");
    batch.hidden = true;
  };
  if (selectable && onBatch) {
    batch.append(
      batchText,
      button("处理已选", {
        kind: "primary",
        onClick: () => onBatch([...selected]),
      }),
      button("取消选择", {
        onClick: () => {
          selected.clear();
          render();
        },
      }),
    );
    root.append(batch);
  }
  const disabledBefore = new WeakMap();
  const setLoading = (value) => {
    busy = value;
    root.setAttribute("aria-busy", String(value));
    for (const b of root.querySelectorAll("button,input")) {
      if (value) {
        disabledBefore.set(b, b.disabled);
        b.disabled = true;
      } else if (disabledBefore.has(b)) {
        b.disabled = disabledBefore.get(b);
        disabledBefore.delete(b);
      }
    }
  };
  const sortable = columns.filter((c) => c.sortable);
  let mobileSort;
  if (sortable.length) {
    mobileSort = selectControl({
      label: "排序",
      options: [
        { value: "", label: "恢复默认顺序" },
        ...sortable.flatMap((c) => [
          { value: c.key + ":1", label: c.label + "升序" },
          { value: c.key + ":-1", label: c.label + "降序" },
        ]),
      ],
      value: "",
      onChange: (v) => {
        if (!v) {
          sortKey = null;
          direction = 0;
        } else {
          const parts = v.split(":");
          sortKey = parts[0];
          direction = Number(parts[1]);
        }
        if (onSortChange)
          void Promise.resolve(onSortChange(sortKey, direction)).catch(
            errorToast,
          );
        render();
      },
    });
    mobileSort.element.classList.add("ui-mobile-sort");
    tools.append(mobileSort.element);
  }
  const visible = () => {
    let list = records.filter(
      (row) =>
        (!query ||
          columns.some((c) =>
            String(c.searchValue ? c.searchValue(row) : (row[c.key] ?? ""))
              .toLocaleLowerCase("zh-CN")
              .includes(query.toLocaleLowerCase("zh-CN")),
          )) &&
        (!filterValue || row.status === filterValue),
    );
    if (sortKey && direction) {
      const c = columns.find((x) => x.key === sortKey);
      list = [...list].sort((a, b) => {
        const x = a[c.key],
          y = b[c.key];
        const n =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x ?? "").localeCompare(String(y ?? ""), "zh-CN");
        return direction * n;
      });
    }
    return list;
  };
  const reorder = async (from, to) => {
    if (
      !onReorder ||
      busy ||
      query ||
      filterValue ||
      sortKey ||
      from === to ||
      to < 0 ||
      to >= records.length
    )
      return;
    const prior = [...records],
      next = [...records],
      [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    records = next;
    render();
    setLoading(true);
    try {
      await onReorder([...records]);
      toast("顺序已保存");
    } catch (e) {
      records = prior;
      errorToast(e);
    } finally {
      setLoading(false);
      render();
    }
  };
  const remove = async (row) => {
    rememberFocus();
    if (
      !(await confirmDialog({
        title:
          typeof deleteTitle === "function" ? deleteTitle(row) : deleteTitle,
        message:
          typeof deleteMessage === "function"
            ? deleteMessage(row)
            : deleteMessage,
        confirmLabel: "确认删除",
        danger: true,
      }))
    )
      return;
    const tr = [...table.querySelectorAll("tbody tr")].find(
      (x) => x.dataset.key === String(row[key]),
    );
    if (tr) tr.classList.add("is-saving");
    try {
      await onDelete(row);
      if (tr) {
        tr.classList.remove("is-saving");
        tr.classList.add("is-removing");
        await wait(transitionMs(tr.querySelector(".ui-cell")));
      }
      records = records.filter((x) => x[key] !== row[key]);
      selected.delete(row[key]);
      render();
      toast("已删除");
    } catch (e) {
      tr?.classList.remove("is-saving");
      errorToast(e);
    }
  };
  function cell(content, actions = false) {
    const td = node("td", null, { class: actions ? "ui-actions" : "" }),
      grid = node("div", null, { class: "ui-cell" }),
      clip = node("div", null, { class: "ui-cell-clip" }),
      body = node("div", null, { class: "ui-cell-body" });
    if (content instanceof Node) body.append(content);
    else body.textContent = String(content ?? "");
    clip.append(body);
    grid.append(clip);
    td.append(grid);
    return td;
  }
  let focusSnapshot = null;
  function rememberFocus() {
    const focused = document.activeElement;
    if (!root.contains(focused) || focused === root) return;
    focusSnapshot = {
      row: focused.closest("tr[data-key]")?.dataset.key,
      label: focused.getAttribute("aria-label"),
      text: focused.textContent,
      tag: focused.tagName,
    };
  }
  function restoreFocus() {
    const saved = focusSnapshot;
    if (!saved) return;
    requestAnimationFrame(() => {
      if (focusSnapshot !== saved) return;
      const active = document.activeElement;
      if (
        active !== document.body &&
        active?.getClientRects().length &&
        !root.contains(active)
      )
        return;
      const row = saved.row
        ? [...table.querySelectorAll("tbody tr")].find(
            (e) => e.dataset.key === saved.row,
          )
        : null;
      const scope = row || root;
      const candidates = [
        ...scope.querySelectorAll("button,input,a[href],tr[tabindex]"),
      ];
      let target =
        saved.tag === "TR" && row
          ? row
          : candidates.find((e) =>
              saved.label
                ? e.getAttribute("aria-label") === saved.label
                : e.tagName === saved.tag && e.textContent === saved.text,
            );
      if (!target && saved.row)
        target = table.querySelector("tbody tr[tabindex]") || search;
      if (
        target?.isConnected &&
        !target.disabled &&
        target.getClientRects().length
      ) {
        target.focus();
        focusSnapshot = null;
      }
    });
  }
  function render() {
    rememberFocus();
    mobileSort?.setValue(sortKey ? sortKey + ":" + direction : "");
    table.replaceChildren();
    const head = node("thead"),
      headRow = node("tr"),
      body = node("tbody");
    head.append(headRow);
    table.append(head, body);
    if (selectable) {
      const th = node("th"),
        hit = node("label", null, { class: "ui-check-hit" }),
        check = node("input", null, {
          type: "checkbox",
          class: "ui-checkbox",
          "aria-label": "选择当前已加载的筛选结果",
        }),
        list = visible();
      check.checked =
        list.length > 0 && list.every((r) => selected.has(r[key]));
      check.indeterminate =
        list.some((r) => selected.has(r[key])) && !check.checked;
      check.addEventListener("change", () => {
        for (const r of list) {
          check.checked ? selected.add(r[key]) : selected.delete(r[key]);
        }
        render();
      });
      hit.append(check);
      th.append(hit);
      headRow.append(th);
    }
    for (const c of columns) {
      const th = node("th", null, {
        scope: "col",
        class: c.numeric ? "ui-number" : "",
      });
      if (c.sortable) {
        th.setAttribute(
          "aria-sort",
          sortKey === c.key
            ? direction === 1
              ? "ascending"
              : "descending"
            : "none",
        );
        const control = node("button", c.label, {
          type: "button",
          class: "ui-sort",
          "aria-label": c.label + "排序",
        });
        control.append(
          icon(
            sortKey === c.key
              ? direction === 1
                ? "arrow-up"
                : "arrow-down"
              : "sort",
          ),
        );
        control.addEventListener("click", () => {
          if (sortKey !== c.key) {
            sortKey = c.key;
            direction = 1;
          } else if (direction === 1) direction = -1;
          else {
            sortKey = null;
            direction = 0;
          }
          if (onSortChange)
            void Promise.resolve(onSortChange(sortKey, direction)).catch(
              errorToast,
            );
          render();
        });
        th.append(control);
      } else th.textContent = c.label;
      headRow.append(th);
    }
    if (
      onOpen ||
      onDelete ||
      manual ||
      typeof rowMore === "function" ||
      rowMore.length
    )
      headRow.append(
        node("th", "操作", { scope: "col", class: "ui-actions-head" }),
      );
    for (const row of pageSize
      ? visible().slice(pageOffset, pageOffset + pageSize)
      : visible()) {
      const tr = node("tr", null, {
        class:
          "ui-row" +
          (selected.has(row[key]) ? " is-selected" : "") +
          (onOpen ? " is-clickable" : ""),
        "data-key": row[key],
      });
      if (onOpen) {
        const openRow = () =>
          Promise.resolve()
            .then(() => onOpen(row))
            .catch(errorToast);
        tr.tabIndex = 0;
        tr.setAttribute("aria-label", "查看" + String(row.name ?? ""));
        tr.addEventListener("click", (e) => {
          if (!busy && !e.target.closest("button,input,a,label"))
            void openRow();
        });
        tr.addEventListener("keydown", (e) => {
          if (
            !busy &&
            e.target === tr &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            void openRow();
          }
        });
      }
      if (selectable) {
        const hit = node("label", null, { class: "ui-check-hit" }),
          check = node("input", null, {
            type: "checkbox",
            class: "ui-checkbox",
            "aria-label": "选择" + String(row.name ?? row[key]),
          });
        check.checked = selected.has(row[key]);
        check.addEventListener("change", () => {
          check.checked ? selected.add(row[key]) : selected.delete(row[key]);
          render();
        });
        hit.append(check);
        tr.append(cell(hit));
      }
      for (const c of columns) {
        const td = cell(c.render ? c.render(row) : row[c.key]);
        if (c.numeric) td.classList.add("ui-number");
        td.querySelector(".ui-cell-body").prepend(
          node("span", c.label, { class: "ui-mobile-label" }),
        );
        tr.append(td);
      }
      if (
        onOpen ||
        onDelete ||
        manual ||
        typeof rowMore === "function" ||
        rowMore.length
      ) {
        const actions = node("span");
        if (onOpen)
          actions.append(
            button(openLabel, { kind: "link", onClick: () => onOpen(row) }),
          );
        if (onDelete)
          actions.append(
            iconButton("删除" + String(row.name ?? ""), "delete", () =>
              remove(row),
            ),
          );
        if (manual) {
          const index = records.indexOf(row),
            disabled = !!(query || filterValue || sortKey) || busy;
          const up = iconButton(
              "上移" + String(row.name ?? ""),
              "arrow-up",
              () => reorder(index, index - 1),
            ),
            down = iconButton(
              "下移" + String(row.name ?? ""),
              "arrow-down",
              () => reorder(index, index + 1),
            );
          up.disabled = disabled || index === 0;
          down.disabled = disabled || index === records.length - 1;
          if (!compactActions || !disabled) actions.append(up, down);
          tr.draggable = !disabled && !!onReorder;
          tr.addEventListener("dragstart", (e) => {
            dragged = row[key];
            tr.classList.add("is-dragging");
            e.dataTransfer?.setData("text/plain", String(dragged));
          });
          tr.addEventListener("dragend", () => {
            dragged = null;
            tr.classList.remove("is-dragging");
          });
          tr.addEventListener("dragover", (e) => {
            if (dragged !== null) {
              e.preventDefault();
              tr.classList.add("is-drop-target");
            }
          });
          tr.addEventListener("dragleave", () =>
            tr.classList.remove("is-drop-target"),
          );
          tr.addEventListener("drop", (e) => {
            e.preventDefault();
            tr.classList.remove("is-drop-target");
            const from = records.findIndex((x) => x[key] === dragged),
              to = records.indexOf(row);
            dragged = null;
            void reorder(from, to);
          });
        }
        for (const action of typeof rowMore === "function"
          ? rowMore(row)
          : rowMore)
          actions.append(
            button(action.label, { onClick: () => action.onSelect(row) }),
          );
        if (compactActions) {
          const primaryAction =
            visiblePrimary && onOpen ? actions.firstElementChild : null;
          if (primaryAction) primaryAction.remove();
          const menu = node("div", null, {
            class: "ui-root ui-more-menu",
            popover: "auto",
            id: uid("more"),
          });
          menu.append(actions);
          const more = iconButton(
            "更多操作：" + String(row.name || ""),
            "more",
            () => {
              menu.showPopover({ source: more });
              menu.querySelector("button")?.focus();
            },
          );
          more.setAttribute("aria-haspopup", "menu");
          menu.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
              menu.hidePopover();
              more.focus();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              const items = [...menu.querySelectorAll("button:not(:disabled)")],
                i = items.indexOf(document.activeElement);
              items[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                      items.length
              ]?.focus();
            }
          });
          menu.addEventListener("click", (e) => {
            if (e.target.closest("button") && menu.matches(":popover-open"))
              menu.hidePopover();
          });
          const wrap = node("span");
          if (primaryAction) wrap.append(primaryAction);
          if (actions.children.length) wrap.append(more, menu);
          tr.append(cell(wrap, true));
        } else tr.append(cell(actions, true));
      }
      body.append(tr);
    }
    bottom.replaceChildren();
    tableWrap.hidden = visible().length === 0;
    if (!visible().length && !serverPage?.offset) {
      bottom.append(
        empty({
          text: records.length ? "清除条件后再试。" : emptyText,
          action: records.length
            ? {
                label: "清除条件",
                onSelect: () => {
                  search.value = query = filterValue = "";
                  picker?.setValue("");
                  render();
                },
              }
            : emptyAction,
        }),
      );
    } else
      bottom.append(
        pagination({
          loaded: records.length,
          total: total ?? (loadedLabel ? null : records.length),
          offset: serverPage?.offset ?? pageOffset,
          nextOffset: serverPage
            ? serverPage.nextOffset
            : pageSize && pageOffset + pageSize < visible().length
              ? pageOffset + pageSize
              : null,
          size: serverPage?.size ?? pageSize,
          onPage:
            serverPage?.onPage ??
            ((value) => {
              pageOffset = value;
              onPage(value);
              render();
            }),
        }),
      );
    if (onLoadMore)
      bottom.append(
        button("加载更多", {
          onClick: async () => {
            setLoading(true);
            try {
              const more = await onLoadMore();
              const old = new Set(records.map((x) => x[key]));
              records.push(...more.filter((x) => !old.has(x[key])));
              render();
            } finally {
              setLoading(false);
              render();
            }
          },
        }),
      );
    chips.replaceChildren();
    if (query)
      chips.append(
        button("搜索：" + query + " ×", {
          kind: "chip",
          onClick: () => {
            query = "";
            search.value = "";
            render();
          },
        }),
      );
    if (filterValue)
      chips.append(
        button(
          "状态：" + filters.find((f) => f.value === filterValue)?.label + " ×",
          {
            kind: "chip",
            onClick: () => {
              filterValue = "";
              picker.setValue("");
              render();
            },
          },
        ),
      );
    if (query || filterValue)
      chips.append(
        button("清除全部", {
          kind: "link",
          onClick: () => {
            query = "";
            filterValue = "";
            search.value = "";
            picker?.setValue("");
            render();
          },
        }),
      );
    if (selectable && onBatch) {
      batchText.textContent = "已选 " + selected.size + " 项";
      if (selected.size) {
        batch.hidden = false;
        requestAnimationFrame(() => batch.classList.add("is-open"));
      } else hideBatch();
    }
    clear.hidden = !query;
    restoreFocus();
  }
  render();
  return {
    element: root,
    setLoading,
    getState() {
      return { query, sortKey, direction, filterValue };
    },
    setItems(next) {
      records = [...next];
      render();
    },
    add(row) {
      records = [row, ...records];
      render();
      table.querySelector("tbody tr")?.classList.add("is-inserting");
    },
    get items() {
      return [...records];
    },
    destroy() {
      picker?.destroy();
      mobileSort?.destroy();
      root.remove();
    },
  };
}

export function tableSkeleton({ columns = 3, rows = 3 } = {}) {
  const wrap = node("div", null, {
      class: "ui-table-scroll",
      "aria-label": "正在加载列表",
      role: "status",
    }),
    table = node("table", null, { class: "ui-table ui-table--responsive" }),
    head = node("thead"),
    hr = node("tr"),
    body = node("tbody");
  for (let i = 0; i < columns; i++) {
    const th = node("th");
    th.append(skeleton("medium"));
    hr.append(th);
  }
  head.append(hr);
  for (let n = 0; n < rows; n++) {
    const tr = node("tr");
    for (let i = 0; i < columns; i++) {
      const td = node("td"),
        cell = node("div", null, { class: "ui-cell-body" });
      cell.append(skeleton(i ? "medium" : "short"));
      td.append(cell);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

// C1 shared page contracts. Business authorization stays in callers and can().
export const fmt = viewFormat;
export { studentDisplay, personStatus, leadMoveAllowed };
export function page({ tabs = [], filters = [], actions = [] } = {}) {
  const element = node("section", null, { class: "ui-page" }),
    bar = node("nav", null, {
      class: "ui-page-tabs",
      "aria-label": "页面分页",
    }),
    tools = node("div", null, { class: "ui-page-actions" }),
    body = node("section", null, { class: "ui-page-body" });
  for (const tab of tabs) {
    const b = button(tab.label, { onClick: () => tab.onSelect?.() });
    b.setAttribute("aria-current", tab.active ? "page" : "false");
    if (tab.key) b.dataset.tabKey = tab.key;
    if (tab.count !== undefined && tab.count !== null)
      b.append(node("span", String(tab.count), { class: "ui-tab-count" }));
    bar.append(b);
  }
  tools.append(...actions);
  const head = node("div", null, { class: "ui-page-heading" });
  head.append(bar, tools);
  element.append(head);
  if (filters.length) element.append(filterBar(filters));
  element.append(body);
  return { element, body };
}
export function filterBar(items = []) {
  const row = node("div", null, { class: "ui-filter-bar" });
  for (const item of items) row.append(item.element || item);
  return row;
}
export function actionMenu({ label = "更多", items = [] } = {}) {
  const menu = node("div", null, {
      class: "ui-root ui-more-menu",
      popover: "auto",
    }),
    trigger = button(label, {
      icon: "chevron-down",
      onClick: () => {
        menu.showPopover({ source: trigger });
        menu.querySelector("button:not(:disabled)")?.focus();
      },
    }),
    element = node("span", null, { class: "ui-menu-holder" });
  trigger.setAttribute("aria-haspopup", "menu");
  for (const item of items) {
    const b = button(item.label, {
      kind: item.danger ? "danger" : "",
      onClick: async () => {
        menu.hidePopover();
        await item.onSelect?.();
      },
    });
    b.disabled = !!item.disabled;
    menu.append(b);
  }
  menu.addEventListener("keydown", (e) => {
    const choices = [...menu.querySelectorAll("button:not(:disabled)")],
      i = choices.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      menu.hidePopover();
      trigger.focus();
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      choices[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? choices.length - 1
            : (i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) %
              choices.length
      ]?.focus();
    }
  });
  element.append(trigger, menu);
  return { element, trigger, menu };
}
export function table({
  columns,
  rows = [],
  rowAction,
  primary,
  more = [],
  empty: emptyText = "这里会显示已登记的记录",
  emptyAction,
  serverPage,
  pageSize = 50,
  onSortChange,
  state = {},
  total,
  complete = true,
  scopeLimited = !complete,
} = {}) {
  let offset = 0;
  const element = node("section", null, { class: "ui-data-table" });
  const render = () => {
    const list = dataList({
      columns: columns.map((c) => ({ ...c, sortable: c.sortable !== false })),
      items: rows,
      onSortChange,
      state,
      onOpen: primary ? primary.onSelect : rowAction,
      openLabel: primary?.label || "查看",
      visiblePrimary: true,
      compactActions: true,
      pageSize,
      pageOffset: offset,
      onPage: (value) => {
        offset = value;
      },
      total: total ?? (complete ? rows.length : null),
      rowMore: more,
      loadedLabel: scopeLimited ? "仅在已加载范围内排序和筛选" : "",
      serverPage,
      emptyText,
      emptyAction,
    });
    element.replaceChildren(list.element);
  };
  render();
  return {
    element,
    setRows(next) {
      rows = next;
      offset = 0;
      render();
    },
  };
}
export function drawer({
  title,
  subtitle = "",
  body,
  primary,
  secondary,
  more = [],
  isDirty = () => false,
} = {}) {
  const view = overlay({ title, kind: "drawer", isDirty });
  view.element.classList.add("ui-c1-drawer");
  if (subtitle) view.body.append(node("p", subtitle, { class: "ui-muted" }));
  if (body) view.body.append(body.element || body);
  for (const action of [secondary, primary].filter(Boolean))
    view.footer.append(
      button(action.label, {
        kind: action === primary ? "primary" : "",
        onClick: async () => {
          view.setBusy(true);
          try {
            await action.onSelect?.(view);
          } finally {
            view.setBusy(false);
          }
        },
      }),
    );
  if (more.length) view.footer.append(actionMenu({ items: more }).element);
  return view;
}
export function formDialog(fields = [], { title = "填写资料" } = {}) {
  const view = overlay({ title, kind: "modal" }),
    form = node("form", null, { class: "ui-form-grid" }),
    inputs = {};
  for (const item of fields) {
    const control = field(item);
    inputs[item.name] = control;
    form.append(control.element);
  }
  view.body.append(form);
  return { ...view, form, inputs };
}
export function status(kind, text) {
  return badge(
    text,
    {
      complete: "success",
      pending: "info",
      danger: "error",
      warning: "warning",
      neutral: "neutral",
    }[kind] ||
      kind ||
      "neutral",
  );
}
export function empty({ text, action } = {}) {
  return emptyState("暂无内容", text || "完成登记后，记录会显示在这里。", {
    action: action?.label
      ? button(action.label, { onClick: action.onSelect })
      : action,
  });
}
export function confirm({ title, consequence, danger = false } = {}) {
  return confirmDialog({ title, message: consequence, danger });
}
export function datePicker(options = {}) {
  return dateControl(options);
}
export function timePicker({
  label = "时间",
  value = "09:00",
  onChange = () => {},
} = {}) {
  const control = field({
    label,
    value,
    type: "text",
    validate: (v) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
        ? ""
        : "请填写24小时制时间，例如14:30",
  });
  control.input.pattern = "([01][0-9]|2[0-3]):[0-5][0-9]";
  control.input.maxLength = 5;
  control.input.placeholder = "14:30";
  control.input.addEventListener("change", () => {
    if (control.validate()) onChange(control.input.value);
  });
  return {
    ...control,
    get value() {
      return control.input.value;
    },
  };
}
export function monthPicker({
  value = fmt.date(Date.now()).slice(0, 7),
  onChange = () => {},
} = {}) {
  const element = node("div", null, { class: "ui-month-picker" }),
    text = node("strong");
  let current = value;
  const paint = () => {
    text.textContent =
      Number(current.slice(0, 4)) + "年" + Number(current.slice(5)) + "月";
  };
  const move = async (n) => {
    const old = current;
    current = new Date(
      Date.UTC(
        Number(current.slice(0, 4)),
        Number(current.slice(5)) - 1 + n,
        1,
      ),
    )
      .toISOString()
      .slice(0, 7);
    paint();
    try {
      await onChange(current);
    } catch (e) {
      current = old;
      paint();
      throw e;
    }
  };
  element.append(
    button("上月", { icon: "chevron-left", onClick: () => move(-1) }),
    text,
    button("下月", { icon: "chevron-right", onClick: () => move(1) }),
  );
  paint();
  return {
    element,
    get value() {
      return current;
    },
  };
}
export function upload({
  label = "拖拽文件到这里，或选择文件",
  accept = "",
  onFiles = () => {},
} = {}) {
  const element = node("section", null, { class: "ui-upload" }),
    input = node("input", null, {
      type: "file",
      accept,
      class: "ui-sr-only",
      "aria-label": "选择文件",
    }),
    selection = node("p", "尚未选择文件", { role: "status" }),
    choose = button("选择文件", { onClick: () => input.click() });
  input.addEventListener("change", () => {
    selection.textContent = input.files?.[0]?.name || "尚未选择文件";
    void Promise.resolve(onFiles(input.files)).catch(errorToast);
  });
  element.addEventListener("dragover", (e) => e.preventDefault());
  element.addEventListener("drop", (e) => {
    e.preventDefault();
    selection.textContent = e.dataTransfer.files?.[0]?.name || "尚未选择文件";
    void Promise.resolve(onFiles(e.dataTransfer.files)).catch(errorToast);
  });
  element.append(node("p", label), input, choose, selection);
  return { element, input };
}
