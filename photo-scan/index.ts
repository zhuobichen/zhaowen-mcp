#!/usr/bin/env npx tsx
/**
 * Photo to Scan MCP Server
 *
 * 把「手机拍的纸页」变成「平直扫描件」：自动判 0/90/180/270、纠偏、去阴影黑边、
 * 裁成 A4 比例、出 JPG/PNG/多页 PDF，红章与手写保留。
 *
 * 架构上有一个刻意的选择：**这一层不实现任何图像算法**。所有处理都在
 * `vendor/photo_to_scan.py`（与 zhaowen-skill/photo-to-scan 同源），MCP 只做
 * 协议适配 + 参数校验 + 回执。理由是同一套算法在 skill 和 MCP 各写一遍，迟早会
 * 在某个坑上只修一边（比如「浓墨手写块被当成背景洗白」这种）；一个 Python 入口，
 * 两条通道，就不可能不一致。
 *
 * 启动: npx tsx photo-scan/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(HERE, "vendor", "photo_to_scan.py");
/** 同源的 skill 版引擎，存在时用来提示"两边是否已经漂移"。 */
const SKILL_ENGINE = path.resolve(
  HERE, "..", "..", "zhaowen-skill", "photo-to-scan", "scripts", "photo_to_scan.py"
);
const TIMEOUT_MS = Number(process.env.PHOTO_SCAN_TIMEOUT_MS || 600_000);

const run = promisify(execFile);

/**
 * 相对路径会被解析成绝对路径再交给引擎。
 *
 * 不这么做的话，`input` 是相对谁就说不清了 —— 客户端传的是「我这边的工作目录」，
 * 但子进程继承的是 MCP server 的 cwd，两者经常不是一回事，报错还只显示一串
 * `..\..\x`，排查一次要半天。转成绝对路径后，报错里就是能直接看懂的路径。
 */
const abs = (p: unknown) => path.resolve(String(p));

function pythonCandidates(): string[] {
  const list = [
    process.env.PHOTO_SCAN_PYTHON,
    process.platform === "win32" ? "python" : "python3",
    "python",
  ].filter((x): x is string => Boolean(x && x.trim()));
  return [...new Set(list)];
}

/**
 * 跑 vendored 引擎。
 *
 * `execFile` 而不是 `exec`：参数里有目录名、中文文件名，过 shell 会被再解释一遍。
 * 解释器按候选列表试：Windows 上 `python` 可能只装了个 Store 别名（ENOENT 之外的
 * 奇葩报错），所以只对 ENOENT 换下一个，其余错误直接抛 —— 不能把"依赖没装"
 * 伪装成"解释器不存在"。
 */
async function callEngine(args: string[]) {
  if (!existsSync(ENGINE)) {
    throw new Error(`引擎缺失: ${ENGINE}（vendor 目录没跟着提交？）`);
  }
  let lastError: unknown;
  for (const py of pythonCandidates()) {
    try {
      const { stdout, stderr } = await run(py, [ENGINE, ...args], {
        timeout: TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      return { stdout, stderr };
    } catch (error: any) {
      lastError = error;
      if (error?.code === "ENOENT") continue;
      const stderr = String(error?.stderr || "").trim();
      const stdout = String(error?.stdout || "").trim();
      throw new Error(
        `引擎执行失败（${py}）${error?.killed ? "，超时" : ""}\n` +
          `${stderr || stdout || error?.message || error}`
      );
    }
  }
  throw new Error(
    `找不到可用的 Python 解释器（试过 ${pythonCandidates().join(", ")}）。` +
      `用环境变量 PHOTO_SCAN_PYTHON 指定路径，例如 D:\\\\Python311\\\\python.exe`
  );
}

function lastJson(text: string): any | null {
  const lines = text.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith("{") || !s.endsWith("}")) continue;
    try {
      return JSON.parse(s);
    } catch {
      /* 不是我们要的那行 */
    }
  }
  return null;
}

function md5(file: string): string | null {
  try {
    return createHash("md5").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * 回执。
 *
 * **低置信度必须显式喊出来**：orientation 判错的表现是"整页倒过来/躺倒"，而
 * 图片本身看着还挺干净，很容易被当成成功交付。所以 confidence 不是 high 时
 * 在回执第一段就给警告和修法，而不是埋在 JSON 里。
 */
function receipt(lead: string, payload: any, raw: string): string {
  const pages: any[] = payload?.pages ?? [];
  const lines: string[] = [lead];
  for (const p of pages) {
    lines.push(
      `- ${path.basename(String(p?.input ?? "?"))}: orient=${p?.orientation}° ` +
        `conf=${p?.confidence} skew=${p?.skew_deg}° → ${p?.output}`
    );
  }
  if (payload?.pdf) lines.push(`PDF: ${payload.pdf}`);

  const shaky = pages.filter((p) => p?.confidence && p.confidence !== "high");
  if (shaky.length) {
    lines.push(
      "",
      `⚠️ ${shaky.length} 页的方向判定不是 high（${shaky
        .map((p) => `${path.basename(String(p.input))}=${p.confidence}`)
        .join(", ")}）。` +
        `低置信度意味着可能整页倒置或躺倒，而图看上去仍然很干净 —— 先看一眼再交付；` +
        `确认错的方向就用 orient 参数指定（0/90/180/270）重跑。`
    );
  }
  lines.push("", "```json", raw.trim().split(/\r?\n/).slice(-1)[0] || raw.trim(), "```");
  return lines.join("\n");
}

const SCAN_SCHEMA = {
  type: "object",
  properties: {
    input: {
      type: "string",
      description: "图片文件或目录（目录会递归处理所有图片）",
    },
    outdir: {
      type: "string",
      description: "输出目录，默认 <input 同级>/scan_out",
    },
    mode: {
      type: "string",
      enum: ["color", "gray", "bw"],
      description: "color 保留红章（默认）| gray 去色 | bw 硬二值化（体积最小，适合 OCR）",
    },
    orient: {
      type: "string",
      description: "auto（默认）或 0/90/180/270；auto 判错时用它覆盖",
    },
    deskew: { type: "string", description: "auto（默认）或 0 或具体角度" },
    pdf: { type: "string", description: "多页合并成这一个 PDF 的路径" },
    dpi: { type: "number", description: "写入 JPG/PDF 的 DPI，默认 300" },
    max_side: { type: "number", description: "长边上限，默认 2600（0 = 不缩放）" },
    margin: { type: "number", description: "白边比例，默认 0.015" },
    ink_k: {
      type: "number",
      description: "Sauvola 的 k，铅笔/淡墨丢失时调到 0.30，默认 0.20",
    },
    paper: { type: "number", description: "判纸亮度阈值，默认 0.55" },
    png: { type: "boolean", description: "同时输出无损 PNG" },
    preview: { type: "boolean", description: "同时输出 2x2 方向候选对照图" },
    ocr: {
      type: "string",
      enum: ["auto", "rapidocr", "tesseract", "off"],
      description: "判定方向用的 OCR 引擎，默认 auto；off 则退回纯几何启发式",
    },
  },
  required: ["input"],
} as const;

async function main() {
  const server = new Server({ name: "photo-scan", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "photo_to_scan",
        description:
          "把手机拍的纸页照片变成平直扫描件：自动转正（0/90/180/270）、纠偏、去阴影与黑边、" +
          "裁成 A4 比例，输出 JPG/PNG 或多页 PDF；红章与手写保留。支持单文件或整个目录。",
        inputSchema: SCAN_SCHEMA,
      },
      {
        name: "photo_to_scan_preview",
        description:
          "只判方向、不出图：输出一张 2x2 的四向候选对照图（右上格是 auto 选中的那个），" +
          "用于在正式处理前确认方向判定对不对，或排查低置信度。",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string", description: "单张图片路径" },
            outdir: { type: "string", description: "对照图输出目录，默认 <input 同级>/scan_out" },
          },
          required: ["input"],
        } as const,
      },
      {
        name: "photo_to_scan_doctor",
        description:
          "自检：Python 解释器、图像依赖（numpy/scipy/Pillow）、可选加速件（OpenCV/OCR/PyMuPDF）、" +
          "以及 vendored 引擎是否与 skill 版同源。装不上依赖或结果异常时先跑它。",
        inputSchema: { type: "object", properties: {} } as const,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, any>;

    try {
      if (name === "photo_to_scan") {
        if (!args.input) throw new Error("缺少 input（图片文件或目录）");
        const input = abs(args.input);
        const outdir = args.outdir
          ? abs(args.outdir)
          : path.join(path.dirname(input), "scan_out");
        const cli = ["-i", input, "-o", outdir];
        if (args.mode) cli.push("--mode", String(args.mode));
        if (args.orient !== undefined) cli.push("--orient", String(args.orient));
        if (args.deskew !== undefined) cli.push("--deskew", String(args.deskew));
        if (args.pdf) cli.push("--pdf", abs(args.pdf));
        if (args.dpi) cli.push("--dpi", String(Math.round(Number(args.dpi))));
        if (args.max_side !== undefined) cli.push("--max-side", String(Math.round(Number(args.max_side))));
        if (args.margin !== undefined) cli.push("--margin", String(args.margin));
        if (args.ink_k !== undefined) cli.push("--ink-k", String(args.ink_k));
        if (args.paper !== undefined) cli.push("--paper", String(args.paper));
        if (args.ocr) cli.push("--ocr", String(args.ocr));
        if (args.png) cli.push("--png");
        if (args.preview) cli.push("--preview");

        const { stdout, stderr } = await callEngine(cli);
        const payload = lastJson(stdout);
        if (!payload) {
          throw new Error(`引擎没有返回可解析的结果。\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        }
        return {
          content: [{ type: "text" as const, text: receipt("扫描完成", payload, stdout) }],
        };
      }

      if (name === "photo_to_scan_preview") {
        if (!args.input) throw new Error("缺少 input（单张图片路径）");
        const input = abs(args.input);
        const outdir = args.outdir
          ? abs(args.outdir)
          : path.join(path.dirname(input), "scan_out");
        const { stdout, stderr } = await callEngine([
          "-i", input, "-o", outdir, "--preview", "--mode", "gray",
        ]);
        const payload = lastJson(stdout);
        const previewPath = path.join(outdir, `${path.basename(input).replace(/\.[^.]+$/, "")}.preview.png`);
        const text = [
          `方向候选图: ${previewPath}`,
          "2x2 四格里右上角是 auto 的判断；若它躺倒或倒置，用 photo_to_scan 的 orient 参数指定正确角度。",
          "",
          "```json",
          (stdout.trim().split(/\r?\n/).slice(-1)[0] || (payload ? JSON.stringify(payload) : stderr)),
          "```",
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "photo_to_scan_doctor") {
        const py = pythonCandidates()[0] || "python";
        let version = "?";
        try {
          const { stdout } = await run(py, ["-c", "import sys;print(sys.version.split()[0])"], {
            timeout: 30_000,
            windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: "utf-8" },
          });
          version = stdout.trim();
        } catch {
          version = "调用失败（解释器可能不存在）";
        }
        const probe = await (async () => {
          try {
            const { stdout } = await run(
              py,
              [
                "-c",
                [
                  "import importlib, json",
                  "out = {}",
                  "for m in ('numpy', 'scipy', 'PIL', 'cv2', 'rapidocr_onnxruntime', 'fitz'):",
                  "    try:",
                  "        mod = importlib.import_module(m)",
                  "        out[m] = getattr(mod, '__version__', 'ok')",
                  "    except Exception as e:",
                  "        out[m] = None",
                  "print(json.dumps(out))",
                ].join("\n"),
              ],
              { timeout: 120_000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }
            );
            return JSON.parse(stdout.trim().split(/\r?\n/).slice(-1)[0]);
          } catch (error: any) {
            return { error: String(error?.stderr || error?.message || error).trim() };
          }
        })();

        const vendorMd5 = md5(ENGINE);
        const skillMd5 = md5(SKILL_ENGINE);
        const lines = [
          `Python: ${py} ${version}`,
          `引擎: ${ENGINE}${vendorMd5 ? ` (md5 ${vendorMd5.slice(0, 8)})` : " —— 缺失"}`,
          `依赖: ${JSON.stringify(probe, null, 0)}`,
          "",
          probe?.numpy && probe?.scipy && probe?.PIL
            ? "必需依赖齐全。"
            : "⚠️ 缺必需依赖：python -m pip install numpy scipy pillow",
          probe?.cv2
            ? "OpenCV 在：四角透视与凸包纸张蒙版可用。"
            : "无 OpenCV：不做透视校正，纸张蒙版退回孔洞填充（拍满画幅时影响不大）。",
          probe?.rapidocr_onnxruntime || probe?.fitz
            ? "OCR/PDF 加速件可用。"
            : "无 OCR：0/180 只能靠几何启发式，低置信度会更常见；无 PyMuPDF：PDF 走 Pillow 兜底。",
        ];
        if (SKILL_ENGINE && vendorMd5 && skillMd5) {
          lines.push(
            "",
            vendorMd5 === skillMd5
              ? "与 zhaowen-skill/photo-to-scan 的引擎一致（同源）。"
              : `⚠️ 与 skill 版引擎不一致（vendor ${vendorMd5.slice(0, 8)} / skill ${skillMd5.slice(0, 8)}）——` +
                " 以 skill 版为准，重新同步 vendor。"
          );
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      throw new Error(`未知工具: ${name}`);
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `失败: ${error?.message ?? String(error)}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 连上就报一句，方便 ps/stderr 里确认进程活着；stdout 留给协议。
  console.error("[photo-scan] ready (engine: vendor/photo_to_scan.py)");
}

main().catch((error) => {
  console.error("[photo-scan] fatal:", error);
  process.exit(1);
});
