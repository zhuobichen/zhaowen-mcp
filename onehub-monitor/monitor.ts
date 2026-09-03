/**
 * one-hub 用量监测 API 模块
 *
 * 支持通过环境变量配置：
 *   ONEMONITOR_API_KEY  - API Key（fallback ONEHUB_API_KEY）
 *   ONEMONITOR_URL      - one-hub 根地址，默认 https://one-hub.hycx-gd.cn
 *   ONEMONITOR_HISTORY  - 本地账本文件路径，默认与 cost_stats.py 共享 cost_stats_history.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";

const DEFAULT_URL = "https://one-hub.hycx-gd.cn";
const DEFAULT_RATE = 7.3;
const DEFAULT_HISTORY = "E:/CodeProject/问题修理/cost_stats_history.json";

export interface MonitorConfig {
  apiKey: string;
  url: string;
  historyFile: string;
}

export function getConfig(): MonitorConfig {
  return {
    apiKey: process.env.ONEMONITOR_API_KEY || process.env.ONEHUB_API_KEY || "",
    url: (process.env.ONEMONITOR_URL || DEFAULT_URL).replace(/\/$/, ""),
    historyFile: process.env.ONEMONITOR_HISTORY || DEFAULT_HISTORY,
  };
}

async function apiGet(base: string, path: string, key: string): Promise<any> {
  const resp = await fetch(base + path, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API ${resp.status}: ${err.slice(0, 200)}`);
  }
  return resp.json();
}

async function getRate(base: string, key: string): Promise<number> {
  try {
    const st = await apiGet(base, "/api/status", key);
    const r = st?.data?.PaymentUSDRate;
    return r ? Number(r) : DEFAULT_RATE;
  } catch {
    return DEFAULT_RATE;
  }
}

export interface UsageState {
  limitUsd: number;
  usedUsd: number;
  remainUsd: number;
  usedPct: number;
  rate: number;
  totalCents: number;
}

/** 实时查询当前总量/额度/剩余（美分 -> 美元，动态汇率） */
export async function checkUsage(): Promise<UsageState> {
  const c = getConfig();
  if (!c.apiKey) {
    throw new Error("未配置 API Key（ONEMONITOR_API_KEY / ONEHUB_API_KEY）");
  }
  const rate = await getRate(c.url, c.apiKey);
  const sub = await apiGet(c.url, "/v1/dashboard/billing/subscription", c.apiKey);
  const use = await apiGet(c.url, "/v1/dashboard/billing/usage?start_date=2000-01-01&end_date=2100-01-01", c.apiKey);
  const limit = sub.soft_limit_usd || sub.hard_limit_usd || 0;
  const totalCents = use.total_usage || 0;
  const usedUsd = totalCents / 100;
  return {
    limitUsd: limit,
    usedUsd,
    remainUsd: Math.max(limit - usedUsd, 0),
    usedPct: limit ? (usedUsd / limit) * 100 : 0,
    rate,
    totalCents,
  };
}

export function loadHistory(): Record<string, number> {
  const f = getConfig().historyFile;
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return {};
  }
}

export function saveHistory(h: Record<string, number>): void {
  writeFileSync(getConfig().historyFile, JSON.stringify(h, null, 2), "utf-8");
}

export interface DailyRecord {
  date: string;
  usd: number;
}
export interface MonthlyRecord {
  month: string;
  usd: number;
}

/** 记录今日快照，返回每日/每月花费（总量差值） */
export async function dailySnapshot(): Promise<{
  today: string;
  daily: DailyRecord[];
  monthly: MonthlyRecord[];
  totalCents: number;
}> {
  const u = await checkUsage();
  // 用本地时区日期（toISOString 是 UTC，中国凌晨会记到前一天）
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const h = loadHistory();
  h[today] = Math.round(u.totalCents * 10000) / 10000;
  saveHistory(h);

  const dates = Object.keys(h).sort();
  const daily: DailyRecord[] = [];
  for (let i = 1; i < dates.length; i++) {
    daily.push({ date: dates[i], usd: (h[dates[i]] - h[dates[i - 1]]) / 100 });
  }
  const monthlyMap: Record<string, number> = {};
  for (const d of daily) {
    const m = d.date.slice(0, 7);
    monthlyMap[m] = (monthlyMap[m] || 0) + d.usd;
  }
  return {
    today,
    daily,
    monthly: Object.entries(monthlyMap).map(([month, usd]) => ({ month, usd })),
    totalCents: u.totalCents,
  };
}
