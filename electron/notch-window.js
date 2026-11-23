const path = require("node:path");
const { BrowserWindow, screen } = require("electron");

// 每块显示器独立维护悬停/退出状态，避免副屏操作影响另一屏的计时器。
function createNotchPanel(display, hoverDelayMs) {
  let window = null;
  let expanded = false;
  let keyboardOpened = false;
  let entered = false;
  let suppressHover = false;
  let exitTimer = null;
  let hoverClosingUntil = 0;
  let ignoringMouse = null;
  let pointerTimer = null;
  let inset = 0;
  let hoverStartedAt = null;

  function bounds(open = expanded) {
    // 内建屏在菜单栏下方留透明避让区（自动隐藏时保留32px），外接屏无需顶部空白。
    inset = display.internal ? Math.max(32, display.workArea.y - display.bounds.y) : 0;
    // 收起时仅顶部中央 160×4 逻辑像素可感应，视觉完全透明。
    const width = Math.min(open ? 480 : 160, display.bounds.width);
    const height = open ? Math.min(inset + 284, display.bounds.height) : 4;
    return { x: Math.round(display.bounds.x + (display.bounds.width - width) / 2), y: display.bounds.y, width, height };
  }

  function contains(point, rect) {
    const x = point.x - rect.x;
    const y = point.y - rect.y;
    if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) {
      return false;
    }
    const radius = Math.min(18, rect.width / 2, rect.height / 2);
    if (y > rect.height - radius && (x < radius || x > rect.width - radius)) {
      const centerX = x < radius ? radius : rect.width - radius;
      return (x - centerX) ** 2 + (y - (rect.height - radius)) ** 2 <= radius ** 2;
    }
    return true;
  }

  function sendState() {
    if (window && !window.isDestroyed()) {
      window.webContents.send("notch:state", { expanded, keyboardOpened, inset });
    }
  }

  function cancelExit() {
    clearTimeout(exitTimer);
    exitTimer = null;
  }

  function collapse(fromPointer = false) {
    hoverStartedAt = null;
    if (!window || !expanded) {
      return;
    }
    cancelExit();
    expanded = false;
    keyboardOpened = false;
    entered = false;
    suppressHover = true;
    hoverClosingUntil = fromPointer ? Date.now() + 180 : 0;
    window.setFocusable(false);
    // 隐藏状态只通过屏幕坐标感应，不拦截菜单栏及下层应用的点击。
    ignoringMouse = true;
    window.setIgnoreMouseEvents(true, { forward: true });
    sendState();
    // 原生窗口始终保持展开尺寸，透明区域穿透；CSS 连续裁切轮廓，避免 macOS 重建窗口表面造成跳变。
  }

  function expand(fromKeyboard) {
    hoverStartedAt = null;
    if (!window) {
      return;
    }
    hoverClosingUntil = 0;
    cancelExit();
    expanded = true;
    keyboardOpened = fromKeyboard;
    entered = contains(screen.getCursorScreenPoint(), bounds(true));
    suppressHover = false;
    window.setFocusable(true);
    // 悬停只展示，不激活；键盘打开则接收 Tab/Esc，并通过 blur 处理外部点击。
    if (fromKeyboard) {
      window.show();
      window.focus();
    } else {
      window.showInactive();
    }
    sendState();
  }

  function trackPointer() {
    if (!window || !window.isVisible()) {
      hoverStartedAt = null;
      return;
    }
    const point = screen.getCursorScreenPoint();
    const inside = contains(point, bounds());
    // 仅在穿透状态真正改变时调用原生 API，避免空闲时反复重设窗口事件路由。
    const ignore = !expanded || !inside || point.y < display.bounds.y + inset;
    if (ignoringMouse !== ignore) {
      ignoringMouse = ignore;
      window.setIgnoreMouseEvents(ignoringMouse, { forward: true });
    }
    // 自动收起尚在动画中时，移回原面板即可反向展开；手动 Esc/关闭不触发此恢复。
    if (!expanded && Date.now() < hoverClosingUntil && contains(point, bounds(true))) {
      expand(false);
      return;
    }
    if (!expanded) {
      if (!inside) {
        hoverStartedAt = null;
        suppressHover = false;
      } else if (!suppressHover) {
        // 必须连续停留在顶部感应区；沿用轮询，不留下移出后仍会触发的延迟回调。
        // 单调时钟避免系统时间调整影响等待；快捷键和退出动画反向恢复不走此延迟。
        const now = performance.now();
        if (hoverStartedAt === null) hoverStartedAt = now;
        if (now - hoverStartedAt >= hoverDelayMs) expand(false);
      }
      return;
    }
    if (inside) {
      entered = true;
      cancelExit();
    } else if (entered && !exitTimer) {
      exitTimer = setTimeout(() => collapse(true), 300);
    }
  }

  function reposition(nextDisplay) {
    hoverStartedAt = null;
    display = nextDisplay;
    if (window) {
      const next = bounds(true);
      const current = window.getBounds();
      if (["x", "y", "width", "height"].every((key) => current[key] === next[key])) {
        return;
      }
      // 屏幕重排后丢弃旧位置的悬停计时，不能在新位置继续处理旧屏幕的退出动作。
      cancelExit();
      collapse();
      hoverClosingUntil = 0;
      ignoringMouse = null;
      window.setBounds(next);
      sendState();
    }
  }

  function setEnabled(enabled) {
    if (!enabled) {
      destroy();
      return;
    }
    if (window) {
      return;
    }
    hoverStartedAt = null;
    expanded = false;
    entered = false;
    suppressHover = false;
    window = new BrowserWindow({
      ...bounds(true),
      title: "待办刘海",
      type: "panel",
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      acceptFirstMouse: true,
      skipTaskbar: true,
      show: false,
      // Electron 31 的无框窗口需要此选项，才能越过 macOS 菜单栏的 frame 约束。
      enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });
    ignoringMouse = true;
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.once("ready-to-show", () => {
      if (window) {
        window.setBounds(bounds(true));
        window.showInactive();
        sendState();
      }
    });
    window.on("blur", () => collapse());
    window.on("close", (event) => {
      // Cmd+W 只收起常驻面板；真正退出/禁用时由 destroy 释放窗口。
      event.preventDefault();
      collapse();
    });
    // Escape 由渲染层逐层处理：先关闭分组选择，再收起刘海。
    window.on("closed", () => {
      hoverStartedAt = null;
      window = null;
      clearInterval(pointerTimer);
      clearTimeout(exitTimer);
      hoverClosingUntil = 0;
    });
    window.loadFile(path.join(__dirname, "..", "src", "notch.html"));
    pointerTimer = setInterval(trackPointer, 40);
  }

  function destroy() {
    hoverStartedAt = null;
    clearInterval(pointerTimer);
    clearTimeout(exitTimer);
    hoverClosingUntil = 0;
    if (window) {
      window.destroy();
      window = null;
    }
    expanded = false;
  }

  return {
    setHoverDelay(value) {
      hoverDelayMs = value;
      hoverStartedAt = null;
    },
    setEnabled,
    reposition,
    collapse,
    destroy,
    sendState,
    isExpanded: () => expanded,
    toggle: () => expanded ? collapse() : expand(true),
    notifyChanged: () => window && window.webContents.send("memo:changed"),
    isSender: (sender) => Boolean(window && sender === window.webContents)
  };
}

// 显示器 ID 是窗口身份；主副屏互换只更新位置，数据通知仍广播到全部刘海。
function createNotchController() {
  const panels = new Map();
  let enabled = false;
  let hoverDelayMs = 2000;
  const displayEvents = ["display-added", "display-removed", "display-metrics-changed"];

  function reconcileDisplays() {
    if (!enabled) return;
    const displays = screen.getAllDisplays();
    const connectedIds = new Set(displays.map((display) => display.id));
    for (const [id, panel] of panels) {
      if (!connectedIds.has(id)) {
        panels.delete(id);
        panel.destroy();
      }
    }
    for (const display of displays) {
      if (panels.has(display.id)) {
        panels.get(display.id).reposition(display);
      } else {
        const panel = createNotchPanel(display, hoverDelayMs);
        panels.set(display.id, panel);
        panel.setEnabled(true);
      }
    }
  }

  function forSender(sender, action) {
    for (const panel of panels.values()) {
      if (!sender || panel.isSender(sender)) action(panel);
    }
  }

  function destroy() {
    enabled = false;
    displayEvents.forEach((event) => screen.removeListener(event, reconcileDisplays));
    for (const panel of panels.values()) panel.destroy();
    panels.clear();
  }

  return {
    setHoverDelay(value) {
      hoverDelayMs = value;
      for (const panel of panels.values()) panel.setHoverDelay(value);
    },
    setEnabled(value) {
      if (!value) return destroy();
      if (!enabled) {
        enabled = true;
        displayEvents.forEach((event) => screen.on(event, reconcileDisplays));
      }
      reconcileDisplays();
    },
    destroy,
    collapse: (sender) => forSender(sender, (panel) => panel.collapse()),
    sendState: (sender) => forSender(sender, (panel) => panel.sendState()),
    isExpanded: () => Array.from(panels.values()).some((panel) => panel.isExpanded()),
    isSender: (sender) => Array.from(panels.values()).some((panel) => panel.isSender(sender)),
    notifyChanged: () => forSender(null, (panel) => panel.notifyChanged()),
    toggle() {
      // 快捷键跟随鼠标所在屏幕，不依赖可被用户调整的“主屏”标记。
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const target = panels.get(display.id);
      if (!target) return;
      for (const panel of panels.values()) {
        if (panel !== target) panel.collapse();
      }
      target.toggle();
    }
  };
}

module.exports = { createNotchController };
