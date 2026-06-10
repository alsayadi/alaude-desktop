const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const {
  FaCog, FaShieldAlt, FaNetworkWired, FaLayerGroup, FaSyncAlt,
  FaExclamationTriangle, FaCheckCircle, FaLightbulb, FaTools,
  FaEye, FaCompass, FaBalanceScale, FaBolt, FaLock, FaSitemap,
  FaCode, FaBrain, FaChartLine, FaFlask
} = require("react-icons/fa");

// ─── Palette: Charcoal + Teal (engineering feel) ───
const C = {
  ink:    "0F1724",  // near-black background
  slate:  "1E293B",  // panel
  line:   "334155",  // border
  mute:   "94A3B8",  // muted text
  text:   "E2E8F0",  // body on dark
  paper:  "F8FAFC",  // light bg
  body:   "1E293B",  // body on light
  teal:   "14B8A6",  // accent
  tealD:  "0D9488",
  amber:  "F59E0B",  // warning
  red:    "EF4444",
  green:  "22C55E",
};

function svg(Icon, color = "#14B8A6", size = 256) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(Icon, { color, size: String(size) })
  );
}
async function icon(Icon, color = "#14B8A6", size = 256) {
  const pngBuffer = await sharp(Buffer.from(svg(Icon, color, size))).png().toBuffer();
  return "image/png;base64," + pngBuffer.toString("base64");
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.3" × 7.5"
  pres.title = "Harness Engineering — alaude-desktop 实战";
  pres.author = "alaude";

  const SW = 13.333, SH = 7.5;

  // Pre-render icons we'll reuse
  const I = {
    cog:      await icon(FaCog, "#14B8A6"),
    shield:   await icon(FaShieldAlt, "#14B8A6"),
    net:      await icon(FaNetworkWired, "#14B8A6"),
    layer:    await icon(FaLayerGroup, "#14B8A6"),
    sync:     await icon(FaSyncAlt, "#14B8A6"),
    warn:     await icon(FaExclamationTriangle, "#F59E0B"),
    check:    await icon(FaCheckCircle, "#22C55E"),
    bulb:     await icon(FaLightbulb, "#F59E0B"),
    tools:    await icon(FaTools, "#14B8A6"),
    eye:      await icon(FaEye, "#14B8A6"),
    compass:  await icon(FaCompass, "#14B8A6"),
    balance:  await icon(FaBalanceScale, "#14B8A6"),
    bolt:     await icon(FaBolt, "#F59E0B"),
    lock:     await icon(FaLock, "#14B8A6"),
    sitemap:  await icon(FaSitemap, "#14B8A6"),
    code:     await icon(FaCode, "#94A3B8"),
    brain:    await icon(FaBrain, "#14B8A6"),
    chart:    await icon(FaChartLine, "#14B8A6"),
    flask:    await icon(FaFlask, "#14B8A6"),
  };

  // ─── Helpers ───
  const font = { title: "Georgia", body: "Calibri" };

  const addFooter = (slide, pageLabel) => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: SH - 0.35, w: SW, h: 0.02, fill: { color: C.line }, line: { type: "none" }
    });
    slide.addText("Harness Engineering · alaude-desktop", {
      x: 0.5, y: SH - 0.32, w: 6, h: 0.3,
      fontSize: 9, color: C.mute, fontFace: font.body, margin: 0
    });
    slide.addText(pageLabel, {
      x: SW - 2.5, y: SH - 0.32, w: 2, h: 0.3,
      fontSize: 9, color: C.mute, fontFace: font.body, align: "right", margin: 0
    });
  };

  const sectionHeader = (slide, num, title, subtitle) => {
    // Left teal band
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 0.25, h: SH,
      fill: { color: C.teal }, line: { type: "none" }
    });
    // Concept number chip
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: 0.55, w: 1.1, h: 0.45,
      fill: { color: C.teal }, line: { type: "none" }
    });
    slide.addText(`CONCEPT ${num}`, {
      x: 0.7, y: 0.55, w: 1.1, h: 0.45,
      fontSize: 10, color: "FFFFFF", bold: true, fontFace: font.body,
      align: "center", valign: "middle", charSpacing: 2, margin: 0
    });
    slide.addText(title, {
      x: 0.7, y: 1.05, w: 11.5, h: 0.9,
      fontSize: 34, bold: true, color: C.body, fontFace: font.title, margin: 0
    });
    slide.addText(subtitle, {
      x: 0.7, y: 1.95, w: 11.5, h: 0.4,
      fontSize: 14, color: C.line, italic: true, fontFace: font.body, margin: 0
    });
  };

  // =========================================================
  // SLIDE 1 — Title
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.ink };

    // Grid pattern: faint vertical lines for "engineering" feel
    for (let i = 1; i < 12; i++) {
      s.addShape(pres.shapes.LINE, {
        x: i, y: 0, w: 0, h: SH,
        line: { color: C.slate, width: 0.5 }
      });
    }

    // Title block
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.8, y: 2.5, w: 0.08, h: 2.5,
      fill: { color: C.teal }, line: { type: "none" }
    });
    s.addText("HARNESS", {
      x: 1.1, y: 2.4, w: 11, h: 1.1,
      fontSize: 72, bold: true, color: C.paper, fontFace: font.title,
      charSpacing: 4, margin: 0
    });
    s.addText("ENGINEERING", {
      x: 1.1, y: 3.4, w: 11, h: 1.1,
      fontSize: 72, bold: true, color: C.teal, fontFace: font.title,
      charSpacing: 4, margin: 0
    });
    s.addText("让 LLM 真正能干活的脚手架", {
      x: 1.1, y: 4.65, w: 11, h: 0.5,
      fontSize: 22, color: C.text, fontFace: font.body, margin: 0
    });
    s.addText("alaude-desktop · 一个 Electron 桌面 AI 应用的四条实战经验", {
      x: 1.1, y: 5.2, w: 11, h: 0.4,
      fontSize: 14, color: C.mute, italic: true, fontFace: font.body, margin: 0
    });

    // Footer marker
    s.addText("模型是引擎 · Harness 是底盘、传动、仪表、安全带", {
      x: 0.8, y: SH - 0.8, w: 11, h: 0.35,
      fontSize: 12, color: C.mute, fontFace: font.body, margin: 0
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.8, y: SH - 0.95, w: 0.4, h: 0.04,
      fill: { color: C.teal }, line: { type: "none" }
    });
  }

  // =========================================================
  // SLIDE 2 — What is Harness Engineering?
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };

    s.addText("什么是 Harness Engineering?", {
      x: 0.6, y: 0.45, w: 12, h: 0.7,
      fontSize: 32, bold: true, color: C.body, fontFace: font.title, margin: 0
    });
    s.addText("模型是引擎,但一辆车不是只有引擎就能开。", {
      x: 0.6, y: 1.15, w: 12, h: 0.4,
      fontSize: 14, color: C.line, italic: true, fontFace: font.body, margin: 0
    });

    // Central equation
    const eqY = 1.9;
    const boxW = 3.6, boxH = 1.3;
    const gap = 0.25;
    const totalW = boxW * 3 + gap * 2 + 1.2;
    const startX = (SW - totalW) / 2;

    const drawBox = (x, title, sub, color, iconData) => {
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: eqY, w: boxW, h: boxH,
        fill: { color: "FFFFFF" }, line: { color: C.line, width: 1 },
        shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.08 }
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: eqY, w: 0.08, h: boxH,
        fill: { color }, line: { type: "none" }
      });
      s.addImage({ data: iconData, x: x + 0.3, y: eqY + 0.3, w: 0.5, h: 0.5 });
      s.addText(title, {
        x: x + 0.9, y: eqY + 0.2, w: boxW - 1, h: 0.45,
        fontSize: 20, bold: true, color: C.body, fontFace: font.title, margin: 0
      });
      s.addText(sub, {
        x: x + 0.9, y: eqY + 0.65, w: boxW - 1, h: 0.6,
        fontSize: 11, color: C.line, fontFace: font.body, margin: 0
      });
    };

    drawBox(startX, "LLM", "模型权重 · 推理能力", C.mute, I.brain);
    // plus sign
    s.addText("+", {
      x: startX + boxW, y: eqY, w: gap + 0.6, h: boxH,
      fontSize: 36, bold: true, color: C.teal, fontFace: font.title,
      align: "center", valign: "middle", margin: 0
    });
    drawBox(startX + boxW + gap + 0.6, "HARNESS", "工具 · 路由 · 上下文 · 反馈", C.teal, I.cog);
    // equals
    s.addText("=", {
      x: startX + 2 * boxW + gap + 0.6, y: eqY, w: gap + 0.6, h: boxH,
      fontSize: 36, bold: true, color: C.teal, fontFace: font.title,
      align: "center", valign: "middle", margin: 0
    });
    drawBox(startX + 2 * boxW + 2 * gap + 1.2, "PRODUCT", "用户实际能用上的东西", C.amber, I.bolt);

    // Four pillars
    const pillars = [
      { t: "工具能力门控", d: "谁能调工具,谁不能", ic: I.shield },
      { t: "进程隔离", d: "UI / 调度 / Worker 拆开", ic: I.sitemap },
      { t: "上下文切片", d: "按领域换提示词", ic: I.layer },
      { t: "OODA 循环", d: "自观察、自诊断、不自改", ic: I.sync },
    ];
    const pY = 4.2;
    const pW = 2.85, pH = 2.4;
    const pGap = 0.2;
    const pTotal = pW * 4 + pGap * 3;
    const pStart = (SW - pTotal) / 2;
    pillars.forEach((p, i) => {
      const x = pStart + i * (pW + pGap);
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: pY, w: pW, h: pH,
        fill: { color: C.ink }, line: { type: "none" }
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: pY, w: pW, h: 0.08,
        fill: { color: C.teal }, line: { type: "none" }
      });
      s.addText(`0${i + 1}`, {
        x: x + 0.3, y: pY + 0.25, w: 1, h: 0.4,
        fontSize: 14, bold: true, color: C.teal, fontFace: font.body, charSpacing: 2, margin: 0
      });
      s.addImage({ data: p.ic, x: x + pW - 0.9, y: pY + 0.3, w: 0.55, h: 0.55 });
      s.addText(p.t, {
        x: x + 0.3, y: pY + 0.9, w: pW - 0.6, h: 0.55,
        fontSize: 18, bold: true, color: C.paper, fontFace: font.title, margin: 0
      });
      s.addText(p.d, {
        x: x + 0.3, y: pY + 1.5, w: pW - 0.6, h: 0.8,
        fontSize: 12, color: C.mute, fontFace: font.body, margin: 0
      });
    });

    addFooter(s, "00 · 开宗明义");
  }

  // =========================================================
  // CONCEPT 1 — Tool Capability Gating (slides 3-5)
  // =========================================================

  // Slide 3: Problem
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "01", "工具能力门控", "不是每个模型都配得上工具调用权");

    // Two column: left problem, right quote
    s.addImage({ data: I.warn, x: 0.7, y: 2.8, w: 0.6, h: 0.6 });
    s.addText("问题", {
      x: 1.4, y: 2.8, w: 5, h: 0.5,
      fontSize: 22, bold: true, color: C.body, fontFace: font.title, margin: 0
    });
    s.addText([
      { text: "给小模型开放 run_command、write_file 听起来很酷,", options: { breakLine: true } },
      { text: "直到它把 JSON 写歪、把路径拼错、把 rm 调去错的目录。", options: { breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "Gemma 3 1B、Llama 3.2 1B/3B、DeepSeek-R1 蒸馏版 —", options: { breakLine: true } },
      { text: "这些模型无法可靠格式化工具调用,开放等于自找麻烦。", options: {} },
    ], {
      x: 0.7, y: 3.4, w: 6.3, h: 3,
      fontSize: 13, color: C.body, fontFace: font.body, paraSpaceAfter: 4, margin: 0
    });

    // Right side: code-ish panel
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.3, y: 2.65, w: 5.3, h: 4.2,
      fill: { color: C.ink }, line: { type: "none" }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.3, y: 2.65, w: 5.3, h: 0.4,
      fill: { color: C.slate }, line: { type: "none" }
    });
    s.addText("electron/api-worker.js", {
      x: 7.45, y: 2.67, w: 5, h: 0.36,
      fontSize: 10, color: C.mute, fontFace: "Consolas", margin: 0
    });
    s.addText([
      { text: "// 典型翻车现场:小模型 \"调用\" 工具", options: { color: C.mute, breakLine: true } },
      { text: "Assistant: ", options: { color: C.teal, breakLine: false } },
      { text: "我来帮你读文件", options: { color: C.text, breakLine: true } },
      { text: "Model: ", options: { color: C.teal, breakLine: false } },
      { text: "{name: 'read_file, path: /etc…", options: { color: C.amber, breakLine: true } },
      { text: "         ^ JSON 未闭合", options: { color: C.red, breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "结果:工具调用解析失败,", options: { color: C.text, breakLine: true } },
      { text: "       UI 卡在 \"思考中\" 转圈,", options: { color: C.text, breakLine: true } },
      { text: "       用户点重试 → 再翻一遍。", options: { color: C.text, breakLine: false } },
    ], {
      x: 7.5, y: 3.15, w: 5, h: 3.6,
      fontSize: 11, fontFace: "Consolas", margin: 0, paraSpaceAfter: 2
    });

    addFooter(s, "01 · 工具能力门控 · 1/3");
  }

  // Slide 4: alaude's approach
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "01", "工具能力门控 — alaude 做法", "模型 catalog 中标注 tools 布尔字段,路由层读取");

    // Table
    const tableY = 2.7;
    const headers = [
      { text: "模型", options: { bold: true, color: "FFFFFF", fill: { color: C.ink }, align: "left" } },
      { text: "能调工具吗", options: { bold: true, color: "FFFFFF", fill: { color: C.ink }, align: "center" } },
      { text: "理由", options: { bold: true, color: "FFFFFF", fill: { color: C.ink }, align: "left" } },
    ];
    const rows = [
      ["Claude / GPT-4 / o-series", "✓ 开", "旗舰级,JSON 结构可靠"],
      ["Gemma 4 E4B / Qwen 3.6", "✓ 开", "中型本地模型,工具格式化稳定"],
      ["Llama 3.3 70B", "✓ 开", "大本地模型 · 经实测"],
      ["Gemma 3 1B / Llama 3.2 1B", "✗ 关", "过小,会写歪 JSON"],
      ["DeepSeek-R1 蒸馏", "✗ 关", "蒸馏模型指令遵循弱"],
    ];
    const tableData = [headers];
    rows.forEach(r => {
      tableData.push([
        { text: r[0], options: { color: C.body, fontFace: "Consolas", fontSize: 11 } },
        { text: r[1], options: { color: r[1].startsWith("✓") ? C.tealD : C.red, bold: true, align: "center", fontSize: 12 } },
        { text: r[2], options: { color: C.line, fontSize: 11 } },
      ]);
    });
    s.addTable(tableData, {
      x: 0.7, y: tableY, w: 7.5,
      colW: [3, 1.4, 3.1],
      rowH: 0.42,
      border: { pt: 0.5, color: C.mute },
      fontFace: font.body, fontSize: 12,
      valign: "middle",
    });

    // Right column: principle
    s.addShape(pres.shapes.RECTANGLE, {
      x: 8.5, y: 2.7, w: 4.2, h: 4.2,
      fill: { color: C.ink }, line: { type: "none" }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 8.5, y: 2.7, w: 4.2, h: 0.08,
      fill: { color: C.teal }, line: { type: "none" }
    });
    s.addImage({ data: I.lock, x: 8.8, y: 2.95, w: 0.55, h: 0.55 });
    s.addText("一条铁律", {
      x: 9.5, y: 3, w: 3, h: 0.45,
      fontSize: 16, bold: true, color: C.paper, fontFace: font.title, margin: 0
    });
    s.addText([
      { text: "能力 ≠ 权限。", options: { bold: true, color: C.teal, breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "给不胜任的模型开放工具,", options: { color: C.text, breakLine: true } },
      { text: "不是赋能,是把用户暴露在", options: { color: C.text, breakLine: true } },
      { text: "乱写文件的风险下。", options: { color: C.text, breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "Harness 的职责:", options: { color: C.mute, italic: true, breakLine: true } },
      { text: "显式标注谁配得上,", options: { color: C.mute, italic: true, breakLine: true } },
      { text: "谁只能老实聊天。", options: { color: C.mute, italic: true } },
    ], {
      x: 8.8, y: 3.7, w: 3.8, h: 3,
      fontSize: 13, fontFace: font.body, paraSpaceAfter: 3, margin: 0
    });

    addFooter(s, "01 · 工具能力门控 · 2/3");
  }

  // Slide 5: Takeaways
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "01", "工具能力门控 — 带走三条", "Lessons Learned");

    const lessons = [
      {
        t: "把 \"能不能调工具\" 当配置,不是默认",
        d: "alaude 在 model-catalog.js 给每个模型显式声明 tools: true/false。改策略只动数据,不碰代码路径。"
      },
      {
        t: "Chat UI 要能降级",
        d: "对关闭工具的模型,UI 不显示工具活动气泡,系统提示词也不暗示 \"我能帮你改文件\"—不然小模型会照着幻觉。"
      },
      {
        t: "能力矩阵要跑真实用户流量才能定",
        d: "别信论文里的 benchmark。alaude 的门控名单,是在 OODA 日志里看到实际 retry / 错误率之后才固化下来的。"
      }
    ];

    lessons.forEach((l, i) => {
      const y = 2.75 + i * 1.45;
      s.addShape(pres.shapes.RECTANGLE, {
        x: 0.7, y, w: 11.9, h: 1.25,
        fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 },
        shadow: { type: "outer", color: "000000", blur: 6, offset: 1, angle: 90, opacity: 0.06 }
      });
      // Number badge
      s.addShape(pres.shapes.OVAL, {
        x: 0.95, y: y + 0.3, w: 0.65, h: 0.65,
        fill: { color: C.teal }, line: { type: "none" }
      });
      s.addText(String(i + 1), {
        x: 0.95, y: y + 0.3, w: 0.65, h: 0.65,
        fontSize: 22, bold: true, color: "FFFFFF", fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
      s.addText(l.t, {
        x: 1.85, y: y + 0.15, w: 10.5, h: 0.5,
        fontSize: 18, bold: true, color: C.body, fontFace: font.title, margin: 0
      });
      s.addText(l.d, {
        x: 1.85, y: y + 0.65, w: 10.5, h: 0.55,
        fontSize: 12, color: C.line, fontFace: font.body, margin: 0
      });
    });

    addFooter(s, "01 · 工具能力门控 · 3/3");
  }

  // =========================================================
  // CONCEPT 2 — Process Isolation (slides 6-8)
  // =========================================================

  // Slide 6: Problem
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "02", "进程隔离", "一个卡死的 LLM 请求不能把 UI 拖下水");

    // Left: problem text
    s.addImage({ data: I.warn, x: 0.7, y: 2.8, w: 0.6, h: 0.6 });
    s.addText("真实踩坑", {
      x: 1.4, y: 2.8, w: 5, h: 0.5,
      fontSize: 22, bold: true, color: C.body, fontFace: font.title, margin: 0
    });
    s.addText([
      { text: "本想一切跑在 Electron 主进程里,干净利索。", options: { breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "结果:某些 VPN 的 DNS 解析器", options: { breakLine: true } },
      { text: "跟 ELECTRON_RUN_AS_NODE 模式打架,", options: { breakLine: true } },
      { text: "api.openai.com / api.anthropic.com", options: { breakLine: true, color: C.red } },
      { text: "直接无法解析 — 用户看到的是 ", options: { breakLine: false } },
      { text: "\"模型挂了\"。", options: { color: C.red } },
    ], {
      x: 0.7, y: 3.45, w: 6.3, h: 3,
      fontSize: 13, color: C.body, fontFace: font.body, paraSpaceAfter: 4, margin: 0
    });

    // Right: ASCII diagram box
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.3, y: 2.65, w: 5.3, h: 4.3,
      fill: { color: C.ink }, line: { type: "none" }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.3, y: 2.65, w: 5.3, h: 0.4,
      fill: { color: C.slate }, line: { type: "none" }
    });
    s.addText("单进程 — 故障传染路径", {
      x: 7.45, y: 2.67, w: 5, h: 0.36,
      fontSize: 10, color: C.mute, fontFace: "Consolas", margin: 0
    });
    s.addText([
      { text: "[ UI thread ]", options: { color: C.teal, breakLine: true } },
      { text: "      │", options: { color: C.mute, breakLine: true } },
      { text: "      ▼  同进程调用", options: { color: C.mute, breakLine: true } },
      { text: "[ fetch(api.openai.com) ]", options: { color: C.text, breakLine: true } },
      { text: "      │", options: { color: C.mute, breakLine: true } },
      { text: "      ▼", options: { color: C.mute, breakLine: true } },
      { text: "[ DNS lookup ]  ← VPN 劫持", options: { color: C.amber, breakLine: true } },
      { text: "      │", options: { color: C.mute, breakLine: true } },
      { text: "      ✗ hang 60s", options: { color: C.red, breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "→ UI 冻结,键盘输入无响应", options: { color: C.red, breakLine: true } },
      { text: "→ 用户只能强杀 app", options: { color: C.red, breakLine: false } },
    ], {
      x: 7.5, y: 3.15, w: 5, h: 3.7,
      fontSize: 11, fontFace: "Consolas", margin: 0, paraSpaceAfter: 1
    });

    addFooter(s, "02 · 进程隔离 · 1/3");
  }

  // Slide 7: alaude's approach — three processes
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "02", "进程隔离 — alaude 做法", "三进程三职责 + DNS monkey-patch 兜底");

    // Three process boxes with arrows
    const bY = 2.9;
    const bH = 2.0;
    const boxes = [
      {
        x: 0.7, w: 3.8, color: C.teal, icon: I.code,
        title: "Renderer", file: "renderer/",
        lines: ["UI · 用户事件", "单文件 HTML", "不碰网络"]
      },
      {
        x: 4.75, w: 3.8, color: C.amber, icon: I.sitemap,
        title: "Main", file: "electron/main.js",
        lines: ["IPC 路由 · 文件操作", "Ollama pull/list", "凭据、OAuth PKCE"]
      },
      {
        x: 8.8, w: 3.8, color: "8B5CF6", icon: I.brain,
        title: "API Worker", file: "electron/api-worker.js",
        lines: ["LLM 请求 · 工具执行", "DNS monkey-patch", "独立 Node 进程"]
      },
    ];
    boxes.forEach(b => {
      s.addShape(pres.shapes.RECTANGLE, {
        x: b.x, y: bY, w: b.w, h: bH,
        fill: { color: "FFFFFF" }, line: { color: C.line, width: 1 },
        shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.08 }
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x: b.x, y: bY, w: b.w, h: 0.08,
        fill: { color: b.color }, line: { type: "none" }
      });
      s.addImage({ data: b.icon, x: b.x + 0.3, y: bY + 0.25, w: 0.5, h: 0.5 });
      s.addText(b.title, {
        x: b.x + 0.95, y: bY + 0.2, w: b.w - 1, h: 0.45,
        fontSize: 20, bold: true, color: C.body, fontFace: font.title, margin: 0
      });
      s.addText(b.file, {
        x: b.x + 0.95, y: bY + 0.65, w: b.w - 1, h: 0.3,
        fontSize: 10, color: C.mute, fontFace: "Consolas", margin: 0
      });
      s.addText(
        b.lines.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < b.lines.length - 1 } })),
        {
          x: b.x + 0.3, y: bY + 1.05, w: b.w - 0.6, h: 0.9,
          fontSize: 11, color: C.line, fontFace: font.body, margin: 0, paraSpaceAfter: 2
        }
      );
    });

    // Arrows between boxes
    const arrowY = bY + bH / 2;
    [4.55, 8.6].forEach(x => {
      s.addText("↔", {
        x: x, y: arrowY - 0.25, w: 0.2, h: 0.5,
        fontSize: 22, bold: true, color: C.teal, fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
    });

    // Caption strip
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: 5.2, w: 11.9, h: 1.5,
      fill: { color: C.ink }, line: { type: "none" }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: 5.2, w: 0.08, h: 1.5,
      fill: { color: C.teal }, line: { type: "none" }
    });
    s.addText("关键修补:api-worker.js 里给 dns.lookup 打了 monkey-patch —", {
      x: 1.0, y: 5.35, w: 11.5, h: 0.35,
      fontSize: 14, bold: true, color: C.paper, fontFace: font.body, margin: 0
    });
    s.addText([
      { text: "系统解析器失败时,自动 fallback 到 ", options: { color: C.text, breakLine: false } },
      { text: "8.8.8.8 / 1.1.1.1", options: { color: C.teal, bold: true, fontFace: "Consolas", breakLine: true } },
      { text: "于是 UI 进程不会被网络故障拖住,LLM 调用也能在 VPN 下打通。", options: { color: C.text } },
    ], {
      x: 1.0, y: 5.75, w: 11.5, h: 0.85,
      fontSize: 12, fontFace: font.body, margin: 0, paraSpaceAfter: 2
    });

    addFooter(s, "02 · 进程隔离 · 2/3");
  }

  // Slide 8: Takeaways
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "02", "进程隔离 — 带走三条", "Lessons Learned");

    const lessons = [
      { t: "UI 永远不和网络共住一个进程", d: "用户的焦点切换、键盘输入、动画帧率,比任何一个 API 调用都重要。" },
      { t: "把兜底逻辑放在它真正用得上的层",  d: "DNS monkey-patch 只在 worker 里装一次 —— 不污染 main,不污染 renderer。" },
      { t: "隔离反而简化了调试",  d: "worker 挂了就重启 worker,日志独立。过去一个 Electron 崩溃要猜十个地方。" },
    ];

    lessons.forEach((l, i) => {
      const y = 2.75 + i * 1.45;
      s.addShape(pres.shapes.RECTANGLE, {
        x: 0.7, y, w: 11.9, h: 1.25,
        fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 },
        shadow: { type: "outer", color: "000000", blur: 6, offset: 1, angle: 90, opacity: 0.06 }
      });
      s.addShape(pres.shapes.OVAL, {
        x: 0.95, y: y + 0.3, w: 0.65, h: 0.65,
        fill: { color: C.teal }, line: { type: "none" }
      });
      s.addText(String(i + 1), {
        x: 0.95, y: y + 0.3, w: 0.65, h: 0.65,
        fontSize: 22, bold: true, color: "FFFFFF", fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
      s.addText(l.t, {
        x: 1.85, y: y + 0.15, w: 10.5, h: 0.5,
        fontSize: 18, bold: true, color: C.body, fontFace: font.title, margin: 0
      });
      s.addText(l.d, {
        x: 1.85, y: y + 0.65, w: 10.5, h: 0.55,
        fontSize: 12, color: C.line, fontFace: font.body, margin: 0
      });
    });

    addFooter(s, "02 · 进程隔离 · 3/3");
  }

  // =========================================================
  // CONCEPT 3 — Context Scoping / Spaces (slides 9-11)
  // =========================================================

  // Slide 9: Problem
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "03", "上下文切片 (Spaces)", "一个万能 system prompt 等于没有 system prompt");

    s.addImage({ data: I.warn, x: 0.7, y: 2.8, w: 0.6, h: 0.6 });
    s.addText("问题", {
      x: 1.4, y: 2.8, w: 5, h: 0.5,
      fontSize: 22, bold: true, color: C.body, fontFace: font.title, margin: 0
    });
    s.addText([
      { text: "用户今天要看化验单,明天要对账,后天要改 NDA。", options: { breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "一个 \"你是万能助手\" 的提示词,", options: { breakLine: true } },
      { text: "既不会在化验单里主动提红旗值,", options: { breakLine: true } },
      { text: "也不会在合同里挑出对赌条款 —", options: { breakLine: true } },
      { text: "因为它不知道这次该关注什么。", options: { breakLine: false } },
    ], {
      x: 0.7, y: 3.45, w: 6.3, h: 3,
      fontSize: 13, color: C.body, fontFace: font.body, paraSpaceAfter: 4, margin: 0
    });

    // Right: messy chat bubble demo
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.3, y: 2.65, w: 5.3, h: 4.3,
      fill: { color: C.ink }, line: { type: "none" }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.3, y: 2.65, w: 5.3, h: 0.4,
      fill: { color: C.slate }, line: { type: "none" }
    });
    s.addText("同一个提示词 · 三个场景", {
      x: 7.45, y: 2.67, w: 5, h: 0.36,
      fontSize: 10, color: C.mute, fontFace: "Consolas", margin: 0
    });
    s.addText([
      { text: "用户: ALT 84, AST 76 正常吗?", options: { color: C.text, breakLine: true } },
      { text: "AI: 这些看起来是数字 🙂", options: { color: C.amber, breakLine: true } },
      { text: "     (没提 ALT 偏高的红旗)", options: { color: C.red, italic: true, breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "用户: 看下这份 NDA 有问题吗?", options: { color: C.text, breakLine: true } },
      { text: "AI: 文档看起来挺完整 🙂", options: { color: C.amber, breakLine: true } },
      { text: "     (没提 2 年禁业条款)", options: { color: C.red, italic: true, breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "用户: Q3 现金流怎么样?", options: { color: C.text, breakLine: true } },
      { text: "AI: 我需要更多上下文…", options: { color: C.amber, breakLine: false } },
    ], {
      x: 7.5, y: 3.15, w: 5, h: 3.7,
      fontSize: 11, fontFace: "Consolas", margin: 0, paraSpaceAfter: 1
    });

    addFooter(s, "03 · Spaces · 1/3");
  }

  // Slide 10: alaude's approach — 7 Spaces
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "03", "Spaces — alaude 做法", "7 个领域 Space + 自定义 · 每个都带独立 system prompt 和快速动作");

    const spaces = [
      { t: "General", d: "默认 · 通用助手", c: C.mute },
      { t: "Health", d: "化验分析 · 药物相互作用 · PHQ-9/GAD-7", c: "EF4444" },
      { t: "Finance", d: "预算 · 发票 · P&L · 现金流预测", c: "22C55E" },
      { t: "Real Estate", d: "房源分析 · MLS · 投资 ROI", c: "F59E0B" },
      { t: "Legal", d: "合同审查 · NDA 起草 · 合规核查", c: "8B5CF6" },
      { t: "Education", d: "教案 · 测验 · 评分 · 学习指南", c: "0EA5E9" },
      { t: "Marketing", d: "社交文案 · 邮件 · SEO · 广告语", c: "EC4899" },
    ];

    // Grid 2 rows x 4 cols (last cell = custom)
    const gX = 0.7, gY = 2.75;
    const cellW = 2.95, cellH = 1.75;
    const gap = 0.18;
    const cols = 4;
    for (let i = 0; i < spaces.length; i++) {
      const r = Math.floor(i / cols), col = i % cols;
      const x = gX + col * (cellW + gap);
      const y = gY + r * (cellH + gap);
      const sp = spaces[i];
      s.addShape(pres.shapes.RECTANGLE, {
        x, y, w: cellW, h: cellH,
        fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 },
        shadow: { type: "outer", color: "000000", blur: 6, offset: 1, angle: 90, opacity: 0.06 }
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y, w: 0.08, h: cellH,
        fill: { color: sp.c }, line: { type: "none" }
      });
      s.addText(sp.t, {
        x: x + 0.3, y: y + 0.25, w: cellW - 0.5, h: 0.5,
        fontSize: 18, bold: true, color: C.body, fontFace: font.title, margin: 0
      });
      s.addText(sp.d, {
        x: x + 0.3, y: y + 0.75, w: cellW - 0.5, h: 0.9,
        fontSize: 11, color: C.line, fontFace: font.body, margin: 0
      });
    }
    // Custom slot
    {
      const i = 7;
      const r = Math.floor(i / cols), col = i % cols;
      const x = gX + col * (cellW + gap);
      const y = gY + r * (cellH + gap);
      s.addShape(pres.shapes.RECTANGLE, {
        x, y, w: cellW, h: cellH,
        fill: { color: C.ink }, line: { type: "none" }
      });
      s.addText("+ 自定义 Space", {
        x, y, w: cellW, h: cellH / 2,
        fontSize: 16, bold: true, color: C.teal, fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
      s.addText("独立提示词 + 快捷动作", {
        x, y: y + cellH / 2 - 0.1, w: cellW, h: cellH / 2,
        fontSize: 11, color: C.mute, italic: true, fontFace: font.body,
        align: "center", valign: "middle", margin: 0
      });
    }

    // Bottom note strip
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: 6.55, w: 11.9, h: 0.55,
      fill: { color: C.paper }, line: { color: C.teal, width: 1 }
    });
    s.addText([
      { text: "切 Space = 切 system prompt + 切 quick-action + 切工具集。", options: { bold: true, color: C.body } },
      { text: "   不是换话术,是换人设。", options: { color: C.line, italic: true } },
    ], {
      x: 0.85, y: 6.6, w: 11.6, h: 0.45,
      fontSize: 12, fontFace: font.body, valign: "middle", margin: 0
    });

    addFooter(s, "03 · Spaces · 2/3");
  }

  // Slide 11: Takeaways
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "03", "Spaces — 带走三条", "Lessons Learned");

    const lessons = [
      { t: "提示词不是一条,是一组", d: "alaude 的 spaces.js 把 7 套预置 + 用户自定义存储为结构化数据,能随版本升级一起演化。" },
      { t: "每个 Space 都要配\"快速动作\"", d: "Health 给你 \"分析化验单\",Legal 给你 \"检查 NDA\"—— 降低 \"我该问什么\" 的用户负担。" },
      { t: "让用户自己造 Space", d: "内置的永远覆盖不全。自定义 Space 把长尾场景交还给用户,harness 只提供结构。" },
    ];

    lessons.forEach((l, i) => {
      const y = 2.75 + i * 1.45;
      s.addShape(pres.shapes.RECTANGLE, {
        x: 0.7, y, w: 11.9, h: 1.25,
        fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 },
        shadow: { type: "outer", color: "000000", blur: 6, offset: 1, angle: 90, opacity: 0.06 }
      });
      s.addShape(pres.shapes.OVAL, {
        x: 0.95, y: y + 0.3, w: 0.65, h: 0.65,
        fill: { color: C.teal }, line: { type: "none" }
      });
      s.addText(String(i + 1), {
        x: 0.95, y: y + 0.3, w: 0.65, h: 0.65,
        fontSize: 22, bold: true, color: "FFFFFF", fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
      s.addText(l.t, {
        x: 1.85, y: y + 0.15, w: 10.5, h: 0.5,
        fontSize: 18, bold: true, color: C.body, fontFace: font.title, margin: 0
      });
      s.addText(l.d, {
        x: 1.85, y: y + 0.65, w: 10.5, h: 0.55,
        fontSize: 12, color: C.line, fontFace: font.body, margin: 0
      });
    });

    addFooter(s, "03 · Spaces · 3/3");
  }

  // =========================================================
  // CONCEPT 4 — OODA Loop (slides 12-14)
  // =========================================================

  // Slide 12: Problem
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "04", "OODA 循环", "Harness 会退化,而没人知道哪里出了问题");

    s.addImage({ data: I.warn, x: 0.7, y: 2.8, w: 0.6, h: 0.6 });
    s.addText("问题", {
      x: 1.4, y: 2.8, w: 5, h: 0.5,
      fontSize: 22, bold: true, color: C.body, fontFace: font.title, margin: 0
    });
    s.addText([
      { text: "开发者上线后最致命的盲点:", options: { breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "· 哪个 provider 经常超时?", options: { breakLine: true } },
      { text: "· 哪个 Space × 模型组合被反复重试?", options: { breakLine: true } },
      { text: "· 哪个快速动作其实从没人点?", options: { breakLine: true } },
      { text: "· 用户是复制了答案,还是默默放弃了?", options: { breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "没有信号 → 没有迭代方向 → harness 慢慢烂掉。", options: { color: C.red, italic: true } },
    ], {
      x: 0.7, y: 3.45, w: 6.3, h: 3.4,
      fontSize: 13, color: C.body, fontFace: font.body, paraSpaceAfter: 3, margin: 0
    });

    // Right: signal icons grid
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.3, y: 2.65, w: 5.3, h: 4.3,
      fill: { color: C.ink }, line: { type: "none" }
    });
    s.addText("看不见的信号", {
      x: 7.5, y: 2.8, w: 5, h: 0.4,
      fontSize: 14, bold: true, color: C.paper, fontFace: font.title, margin: 0
    });
    const signals = [
      { t: "retry (60s 内同 prompt)", v: "−2" },
      { t: "abandoned (30s 无后续)",  v: "−1" },
      { t: "error (HTTP / tool fail)", v: "−1" },
      { t: "clean success",            v: "+1" },
      { t: "response copied",           v: "+1" },
    ];
    signals.forEach((sg, i) => {
      const y = 3.4 + i * 0.62;
      s.addText(sg.t, {
        x: 7.5, y, w: 4, h: 0.5,
        fontSize: 12, color: C.text, fontFace: "Consolas", valign: "middle", margin: 0
      });
      const col = sg.v.startsWith("+") ? C.green : C.red;
      s.addShape(pres.shapes.RECTANGLE, {
        x: 11.55, y: y + 0.08, w: 0.9, h: 0.38,
        fill: { color: col }, line: { type: "none" }
      });
      s.addText(sg.v, {
        x: 11.55, y: y + 0.08, w: 0.9, h: 0.38,
        fontSize: 13, bold: true, color: "FFFFFF", fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
    });

    addFooter(s, "04 · OODA 循环 · 1/3");
  }

  // Slide 13: alaude's approach — the four phases
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "04", "OODA — alaude 做法", "Observe → Orient → Decide → Act · 每 10 个 outcome 跑一次");

    const phases = [
      { letter: "O", name: "Observe", icon: I.eye,
        lines: ["append NDJSON 事件", "~/.claude/alaude-events.ndjson", "从不阻塞主流程"] },
      { letter: "O", name: "Orient",  icon: I.compass,
        lines: ["每 10 outcome 触发", "按 provider / space / model", "算复合 health score"] },
      { letter: "D", name: "Decide",  icon: I.balance,
        lines: ["6 条优先级规则", "一批只产 1 条 proposal", "从高危到优化排序"] },
      { letter: "A", name: "Act",     icon: I.flask,
        lines: ["写入 ux-proposals.md", "人审后才生效", "永不自动改 UX 文案"] },
    ];
    const pW = 2.85, pH = 3.6;
    const pY = 2.75;
    const pGap = 0.22;
    const pTotal = pW * 4 + pGap * 3;
    const pStart = (SW - pTotal) / 2;

    phases.forEach((p, i) => {
      const x = pStart + i * (pW + pGap);
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: pY, w: pW, h: pH,
        fill: { color: C.ink }, line: { type: "none" }
      });
      // Letter watermark
      s.addText(p.letter, {
        x, y: pY, w: pW, h: 1.7,
        fontSize: 90, bold: true, color: C.slate, fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
      s.addImage({ data: p.icon, x: x + pW/2 - 0.3, y: pY + 0.55, w: 0.6, h: 0.6 });
      s.addText(p.name, {
        x, y: pY + 1.8, w: pW, h: 0.5,
        fontSize: 20, bold: true, color: C.teal, fontFace: font.title,
        align: "center", margin: 0
      });
      s.addText(
        p.lines.map((t, j) => ({ text: t, options: { breakLine: j < p.lines.length - 1, align: "center" } })),
        {
          x: x + 0.2, y: pY + 2.35, w: pW - 0.4, h: 1.15,
          fontSize: 11, color: C.text, fontFace: font.body,
          align: "center", margin: 0, paraSpaceAfter: 2
        }
      );
      // Arrow between
      if (i < phases.length - 1) {
        s.addText("▶", {
          x: x + pW - 0.15, y: pY + pH/2 - 0.25, w: 0.4, h: 0.5,
          fontSize: 22, bold: true, color: C.teal, fontFace: font.title,
          align: "center", valign: "middle", margin: 0
        });
      }
    });

    // Iron law strip
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: 6.55, w: 11.9, h: 0.55,
      fill: { color: "FFFBEB" }, line: { color: C.amber, width: 1 }
    });
    s.addImage({ data: I.lock, x: 0.85, y: 6.64, w: 0.35, h: 0.35 });
    s.addText([
      { text: "铁律: ", options: { bold: true, color: C.amber } },
      { text: "proposal 落地到 markdown,人读完再决定改不改。LLM 不允许自动篡改 UX 文案。", options: { color: C.body } },
    ], {
      x: 1.3, y: 6.6, w: 11.2, h: 0.45,
      fontSize: 12, fontFace: font.body, valign: "middle", margin: 0
    });

    addFooter(s, "04 · OODA 循环 · 2/3");
  }

  // Slide 14: Six diagnose rules + takeaways
  {
    const s = pres.addSlide();
    s.background = { color: C.paper };
    sectionHeader(s, "04", "OODA — 六条 diagnose 规则 + 带走三条", "Lessons Learned");

    // Left: six rules
    s.addText("priority-ordered rules", {
      x: 0.7, y: 2.65, w: 6, h: 0.3,
      fontSize: 11, color: C.mute, italic: true, fontFace: font.body,
      charSpacing: 1, margin: 0
    });
    const rules = [
      "Provider 错误率过高",
      "Space×Model 重试率高",
      "Quick-action 放弃率高",
      "Provider 延迟异常 / 模型切换频繁",
      "Quick-action 从不被用",
      "健康回退 (确认系统稳定)",
    ];
    rules.forEach((r, i) => {
      const y = 3.0 + i * 0.55;
      s.addShape(pres.shapes.OVAL, {
        x: 0.75, y: y + 0.08, w: 0.38, h: 0.38,
        fill: { color: C.teal }, line: { type: "none" }
      });
      s.addText(String(i + 1), {
        x: 0.75, y: y + 0.08, w: 0.38, h: 0.38,
        fontSize: 12, bold: true, color: "FFFFFF", fontFace: font.title,
        align: "center", valign: "middle", margin: 0
      });
      s.addText(r, {
        x: 1.25, y: y + 0.05, w: 5, h: 0.45,
        fontSize: 13, color: C.body, fontFace: font.body, valign: "middle", margin: 0
      });
    });

    // Right: 3 takeaways
    const takeaways = [
      { t: "先看,再判,最后才动", d: "别先写修复,先把事件落地。" },
      { t: "优先级排序代替多条建议", d: "一批只给 1 条 proposal,人不会淹没。" },
      { t: "LLM 不审自己的 UX", d: "把 action 卡在人审那一关。" },
    ];
    takeaways.forEach((t, i) => {
      const y = 2.75 + i * 1.4;
      const x = 7.0;
      s.addShape(pres.shapes.RECTANGLE, {
        x, y, w: 5.6, h: 1.2,
        fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 },
        shadow: { type: "outer", color: "000000", blur: 6, offset: 1, angle: 90, opacity: 0.06 }
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y, w: 0.08, h: 1.2,
        fill: { color: C.teal }, line: { type: "none" }
      });
      s.addText(t.t, {
        x: x + 0.3, y: y + 0.15, w: 5.2, h: 0.45,
        fontSize: 16, bold: true, color: C.body, fontFace: font.title, margin: 0
      });
      s.addText(t.d, {
        x: x + 0.3, y: y + 0.6, w: 5.2, h: 0.55,
        fontSize: 12, color: C.line, fontFace: font.body, margin: 0
      });
    });

    addFooter(s, "04 · OODA 循环 · 3/3");
  }

  // =========================================================
  // SLIDE 15 — Closing
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.ink };

    // Left teal band
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 0.25, h: SH,
      fill: { color: C.teal }, line: { type: "none" }
    });

    s.addText("Harness Engineering", {
      x: 0.8, y: 0.6, w: 11, h: 0.6,
      fontSize: 16, color: C.mute, fontFace: font.body, charSpacing: 3, margin: 0
    });
    s.addText("四条铁律", {
      x: 0.8, y: 1.1, w: 11, h: 1,
      fontSize: 48, bold: true, color: C.paper, fontFace: font.title, margin: 0
    });

    const rules = [
      { n: "01", t: "能力 ≠ 权限", d: "不是每个模型都配得上工具调用。显式标注。" },
      { n: "02", t: "UI 不和网络共进程", d: "worker 里装兜底,UI 永不冻结。" },
      { n: "03", t: "换 Space = 换人设", d: "system prompt 是一组,不是一条。" },
      { n: "04", t: "先观察,人审才动", d: "OODA 产 proposal,LLM 不动 UX。" },
    ];
    rules.forEach((r, i) => {
      const y = 2.6 + i * 1.0;
      s.addText(r.n, {
        x: 0.8, y, w: 1.2, h: 0.55,
        fontSize: 26, bold: true, color: C.teal, fontFace: font.title,
        charSpacing: 2, margin: 0
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x: 2.1, y: y + 0.08, w: 0.02, h: 0.5,
        fill: { color: C.line }, line: { type: "none" }
      });
      s.addText(r.t, {
        x: 2.3, y, w: 4.8, h: 0.55,
        fontSize: 24, bold: true, color: C.paper, fontFace: font.title, margin: 0
      });
      s.addText(r.d, {
        x: 7.2, y: y + 0.05, w: 5.5, h: 0.5,
        fontSize: 14, color: C.mute, italic: true, fontFace: font.body,
        valign: "middle", margin: 0
      });
    });

    s.addText("模型换代如此之快,harness 才是你能积累的工程资产。", {
      x: 0.8, y: SH - 0.95, w: 11.5, h: 0.4,
      fontSize: 14, color: C.teal, italic: true, fontFace: font.body, margin: 0
    });
    s.addText("github.com/alsayadi/alaude-desktop", {
      x: 0.8, y: SH - 0.55, w: 11.5, h: 0.35,
      fontSize: 11, color: C.mute, fontFace: "Consolas", margin: 0
    });
  }

  await pres.writeFile({ fileName: "harness-engineering.pptx" });
  console.log("done.");
})();
