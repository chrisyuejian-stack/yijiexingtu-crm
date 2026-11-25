// Extend the existing lightweight DOM for real shared components; not component mocks.
import vm from "node:vm";
import { tenantAssets } from "../scripts/frontend-bundle.mjs";
export async function installFoundation(context, Node, document) {
  Object.defineProperty(Node.prototype, "classList", {
    configurable: true,
    get() {
      const self = this;
      return {
        add(...v) {
          self.className = [
            ...new Set(
              (self.className || "").split(" ").filter(Boolean).concat(v),
            ),
          ].join(" ");
        },
        remove(...v) {
          self.className = (self.className || "")
            .split(" ")
            .filter((x) => !v.includes(x))
            .join(" ");
        },
        toggle(v, on) {
          on = on ?? !this.contains(v);
          on ? this.add(v) : this.remove(v);
          return on;
        },
        contains(v) {
          return (self.className || "").split(" ").includes(v);
        },
      };
    },
    set() {},
  });
  Node.prototype.remove ??= function () {};
  document.addEventListener ??= () => {};
  document.removeEventListener ??= () => {};
  context.matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  Node.prototype.prepend = function (...xs) {
    this.children.unshift(...xs);
  };
  Node.prototype.getAttribute = function (k) {
    return this.attrs[k] ?? null;
  };
  Node.prototype.removeAttribute ??= function (k) {
    delete this.attrs[k];
  };
  Node.prototype.querySelector = function (selector) {
    const all = [];
    const walk = (n) => {
      for (const c of n.children || [])
        if (c && typeof c === "object") {
          all.push(c);
          walk(c);
        }
    };
    walk(this);
    return (
      all.find((n) =>
        selector.split(",").some((raw) => {
          const sel = raw.trim();
          if (sel.startsWith("."))
            return (n.className || n.attrs.class || "")
              .split(" ")
              .includes(sel.slice(1));
          return n.tag === sel.split(/[:\[ ]/)[0];
        }),
      ) || null
    );
  };
  Node.prototype.closest = function () {
    return null;
  };
  Node.prototype.focus = function () {
    document.activeElement = this;
  };
  Object.defineProperty(Node.prototype, "dataset", {
    configurable: true,
    get() {
      return (this._dataset ??= {});
    },
  });
  document.body ??= new Node("body");
  document.createElementNS ??= (ns, tag) => {
    const n = new Node(tag);
    n.namespaceURI = ns;
    return n;
  };
  context.requestAnimationFrame ??= (fn) => {
    fn();
    return 0;
  };
  context.getComputedStyle ??= () => ({
    transitionDuration: "0ms",
    transitionDelay: "0ms",
  });
  const assets = await tenantAssets();
  vm.runInContext(
    assets.js.slice(0, assets.js.indexOf('"use strict";')),
    context,
  );
}
