import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  dryWindows,
  hourly,
  hoursOfDay,
  resolvePlace,
  windDirText,
  wmoText,
  type Hourly,
} from "./lib/openmeteo.js";

// ---------------------------------------------------------------- 工具实现

function hm(t: string): string {
  return t.slice(11, 16);
}

function table(list: Hourly[]): string[] {
  const out = ["  时刻   气温   降水mm  概率   天气        风向    风速"];
  for (const h of list) {
    out.push(
      `  ${hm(h.time)}  ${h.temp.toFixed(1).padStart(5)}C  ${h.precipMm.toFixed(1).padStart(5)}  ` +
      `${String(h.precipProb).padStart(3)}%  ${wmoText(h.code).padEnd(11)} ` +
      `${windDirText(h.windDir)}  ${h.windSpeed.toFixed(1).padStart(5)} km/h`
    );
  }
  return out;
}

async function toolHourly(args: any): Promise<string> {
  const place = await resolvePlace(String(args.place ?? ""));
  const days = Number(args.days) || 3;
  const all = await hourly(place.latitude, place.longitude, days);

  let list = all;
  if (args.date) list = hoursOfDay(all, String(args.date), Number(args.from_hour ?? 0), Number(args.to_hour ?? 23));
  if (!list.length) return `没取到 ${args.date ?? ""} 的预报（预报范围 ${all[0]?.time.slice(0, 10)} ~ ${all[all.length - 1]?.time.slice(0, 10)}）`;

  const head = [
    `# ${place.name} 逐小时预报（Open-Meteo，时区已本地化）`,
    `坐标 ${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}` +
      (place.admin1 ? `  ${place.admin1}` : "") + (place.country ? ` ${place.country}` : ""),
    "",
  ];
  const body = table(list);
  const win = dryWindows(list, { mmTol: 0.2, probTol: 50, minHours: 1 });
  const tail: string[] = [];
  if (win.length) {
    tail.push("");
    tail.push("## 相对干的时间段（降水 ≤0.2mm 且概率 ≤50%）");
    for (const w of win) {
      tail.push(`- ${hm(w.start)}~${w.end}  共 ${w.hours} 小时  ${w.minTemp.toFixed(1)}~${w.maxTemp.toFixed(1)}C  ` +
        `风 ${w.dirs.join("/")} ≤${w.maxWind.toFixed(1)} km/h  峰值概率 ${w.maxProb}%`);
    }
  } else {
    tail.push("");
    tail.push("这段时间里没有满足「降水 ≤0.2mm 且概率 ≤50%」的窗口。");
  }
  return [...head, ...body, ...tail].join("\n");
}

async function toolDryWindows(args: any): Promise<string> {
  const place = await resolvePlace(String(args.place ?? ""));
  const date = String(args.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "错误: date 要写成 YYYY-MM-DD";
  const days = Number(args.days) || 4;
  const all = await hourly(place.latitude, place.longitude, days);
  const list = hoursOfDay(all, date, Number(args.from_hour ?? 0), Number(args.to_hour ?? 23));
  if (!list.length) {
    const lo = all[0]?.time.slice(0, 10), hi = all[all.length - 1]?.time.slice(0, 10);
    return `没取到 ${date} 的预报。可预报范围是 ${lo} ~ ${hi}。`;
  }

  const mmTol = args.mm_tol !== undefined ? Number(args.mm_tol) : 0.2;
  const probTol = args.prob_tol !== undefined ? Number(args.prob_tol) : 50;
  const minHours = Number(args.min_hours) || 2;
  const win = dryWindows(list, { mmTol, probTol, minHours });

  const wet = list.filter((h) => h.precipMm > mmTol);
  const out = [
    `# ${place.name} ${date} 的无雨窗口`,
    `判据：降水 ≤${mmTol}mm **且** 降水概率 ≤${probTol}%，且连续 ≥${minHours} 小时`,
    "",
  ];
  if (!win.length) {
    out.push(`**${date} 没有满足条件的窗口。**`);
    out.push("");
    out.push(`这一天有 ${wet.length} 个小时在下雨，全天降水合计 ` +
      `${list.reduce((s, h) => s + h.precipMm, 0).toFixed(1)} mm。`);
    out.push("（只看「此刻有没有下」不够——概率高但暂时没下的小时也不算数，所以窗口会更少。）");
  } else {
    for (const w of win) {
      out.push(`## ${hm(w.start)} ~ ${hm(w.end)}（${w.hours} 小时）`);
      out.push(`- 气温 ${w.minTemp.toFixed(1)} ~ ${w.maxTemp.toFixed(1)} °C`);
      out.push(`- 风 ${w.dirs.join("/")}，最大 ${w.maxWind.toFixed(1)} km/h`);
      out.push(`- 这段里最坏的降水概率 ${w.maxProb}%`);
      out.push("");
      out.push(...table(list.filter((h) => h.time >= w.start && h.time <= w.end)));
      out.push("");
    }
  }
  out.push("");
  out.push(`（全天逐小时明细用 \`hourly_forecast\` 传 date="${date}" 查。）`);
  return out.join("\n");
}

async function toolResolvePlace(args: any): Promise<string> {
  const name = String(args.name ?? "");
  const p = await resolvePlace(name);
  return [
    `# ${name} → 坐标`,
    `- 名称: ${p.name}`,
    `- 坐标: ${p.latitude},${p.longitude}`,
    p.admin1 ? `- 省/州: ${p.admin1}` : "",
    p.country ? `- 国家: ${p.country}` : "",
    "",
    "把这个坐标喂给 `hourly_forecast` / `dry_windows` 也行（它们两种都接受）。",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- MCP 装配

async function main() {
  const server = new Server({ name: "weather-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "hourly_forecast",
        description:
          "逐小时天气预报（Open-Meteo，免费无需 key）。给出气温、降水量、降水概率、天气、风向风速。" +
          "地点可传中文地名或 \"纬度,经度\"。**比高德 maps_weather 细**——那个只有白天/夜间两级。",
        inputSchema: {
          type: "object",
          properties: {
            place: { type: "string", description: "地点，如 广州 / 花都 / \"23.13,113.26\"" },
            days: { type: "number", description: "可选：预报几天（默认 3，上限 16）" },
            date: { type: "string", description: "可选：只看某天 YYYY-MM-DD" },
            from_hour: { type: "number", description: "可选：起始小时 0-23（配合 date 用）" },
            to_hour: { type: "number", description: "可选：结束小时 0-23（配合 date 用）" },
          },
          required: ["place"],
        },
      },
      {
        name: "dry_windows",
        description:
          "找某天连续无雨的时间窗——直接回答「什么时候不下雨」。判据是「降水≤阈值 **且** 降水概率≤阈值」，" +
          "两个条件都要满足：只看降水量会把「概率 80% 但暂时没下」当好天气，那是误导。",
        inputSchema: {
          type: "object",
          properties: {
            place: { type: "string", description: "地点，如 广州" },
            date: { type: "string", description: "日期 YYYY-MM-DD（必填）" },
            min_hours: { type: "number", description: "可选：窗口至少多少小时（默认 2）" },
            mm_tol: { type: "number", description: "可选：降水量阈值 mm（默认 0.2）" },
            prob_tol: { type: "number", description: "可选：降水概率阈值 %（默认 50）" },
            from_hour: { type: "number", description: "可选：只看这个小时之后（默认 0）" },
            to_hour: { type: "number", description: "可选：只看这个小时之前（默认 23）" },
          },
          required: ["place", "date"],
        },
      },
      {
        name: "resolve_place",
        description: "把地名转成经纬度，供上面两个工具使用。中文地名命中率有限，查不到时改用坐标。",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "地名，如 广州 / 花都" } },
          required: ["name"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {
        case "hourly_forecast":
          return { content: [{ type: "text", text: await toolHourly(args) }] };
        case "dry_windows":
          return { content: [{ type: "text", text: await toolDryWindows(args) }] };
        case "resolve_place":
          return { content: [{ type: "text", text: await toolResolvePlace(args) }] };
        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      return { content: [{ type: "text", text: `错误: ${e?.message ?? e}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
