/**
 * Open-Meteo：免费、无需 API key、提供逐小时预报。
 * 选它是因为「高德 maps_weather 只给到白天/夜间两级」——那是路由决策不够用的粒度。
 */

const UA = "Mozilla/5.0 (compatible; weather-mcp/1.0)";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export class WeatherError extends Error {}

async function getJson(url: string, timeoutMs = 25000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new WeatherError(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (e: any) {
    if (e?.name === "AbortError") throw new WeatherError(`请求超时（${timeoutMs} ms）`);
    throw new WeatherError(String(e?.message ?? e));
  } finally {
    clearTimeout(t);
  }
}

/** "广州" / "Guangzhou" / "23.13,113.26" 都接受。 */
export async function resolvePlace(input: string): Promise<Place> {
  const s = (input || "").trim();
  if (!s) throw new WeatherError("地点为空");
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    return { name: `${m[1]},${m[2]}`, latitude: Number(m[1]), longitude: Number(m[2]) };
  }
  const url = `${GEOCODE}?name=${encodeURIComponent(s)}&count=5&language=zh`;
  const d = await getJson(url);
  const list = Array.isArray(d?.results) ? d.results : [];
  if (!list.length) throw new WeatherError(`找不到地点「${s}」（Open-Meteo 的地理库对中文地名支持有限，可改用 "lat,lon" 坐标）`);
  const r = list[0];
  return {
    name: String(r.name ?? s),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    country: r.country,
    admin1: r.admin1,
  };
}

export interface Hourly {
  time: string;
  temp: number;
  precipMm: number;
  precipProb: number;
  code: number;
  windSpeed: number;
  windDir: number;
}

/** WMO 天气代码 → 中文。只覆盖常见值，其余原样显示代码。 */
export const WMO: Record<number, string> = {
  0: "晴", 1: "少云", 2: "多云", 3: "阴",
  45: "雾", 48: "雾凇",
  51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
  56: "冻毛毛雨", 57: "强冻毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  66: "冻雨", 67: "强冻雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
  80: "阵雨", 81: "强阵雨", 82: "暴阵雨",
  85: "阵雪", 86: "强阵雪",
  95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷暴伴冰雹",
};

export function wmoText(code: number): string {
  return WMO[code] ?? `代码${code}`;
}

const DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
export function windDirText(deg: number): string {
  return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/**
 * 取逐小时预报。
 *
 * 返回的 time 已按 timezone=Asia/Shanghai 本地化，形如 "2026-10-05T07:00"。
 * ⚠️ 别自己再做时区换算——这是本仓库踩过的坑（时间戳换算是静默出错重灾区）。
 */
export async function hourly(lat: number, lon: number, days: number): Promise<Hourly[]> {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m",
    timezone: "Asia/Shanghai",
    forecast_days: String(Math.min(Math.max(days, 1), 16)),
  });
  const d = await getJson(`${FORECAST}?${q.toString()}`);
  const h = d?.hourly;
  if (!h?.time?.length) throw new WeatherError("预报返回为空");
  const out: Hourly[] = [];
  for (let i = 0; i < h.time.length; i++) {
    out.push({
      time: String(h.time[i]),
      temp: Number(h.temperature_2m?.[i]),
      precipMm: Number(h.precipitation?.[i]),
      precipProb: Number(h.precipitation_probability?.[i]),
      code: Number(h.weather_code?.[i]),
      windSpeed: Number(h.wind_speed_10m?.[i]),
      windDir: Number(h.wind_direction_10m?.[i]),
    });
  }
  return out;
}

export function hoursOfDay(list: Hourly[], date: string, from = 0, to = 23): Hourly[] {
  return list.filter((h) => {
    if (!h.time.startsWith(date)) return false;
    const hh = Number(h.time.slice(11, 13));
    return hh >= from && hh <= to;
  });
}

export interface Window {
  start: string;
  end: string;
  hours: number;
  maxMm: number;
  maxProb: number;
  minTemp: number;
  maxTemp: number;
  maxWind: number;
  dirs: string[];
}

/**
 * 找连续无雨窗口。
 *
 * 判据是「降水 mm 低于 mmTol **且** 降水概率不超过 probTol」——只看 mm 会把
 * "80% 概率但此刻没下" 当成好天气，那对骑行决策是误导。
 */
export function dryWindows(list: Hourly[], opts: {
  mmTol?: number; probTol?: number; minHours?: number;
} = {}): Window[] {
  const mmTol = opts.mmTol ?? 0.2;
  const probTol = opts.probTol ?? 50;
  const minHours = opts.minHours ?? 1;
  const out: Window[] = [];
  let cur: Hourly[] = [];
  const flush = () => {
    if (cur.length >= minHours) {
      out.push({
        start: cur[0].time, end: cur[cur.length - 1].time, hours: cur.length,
        maxMm: Math.max(...cur.map((x) => x.precipMm)),
        maxProb: Math.max(...cur.map((x) => x.precipProb)),
        minTemp: Math.min(...cur.map((x) => x.temp)),
        maxTemp: Math.max(...cur.map((x) => x.temp)),
        maxWind: Math.max(...cur.map((x) => x.windSpeed)),
        dirs: [...new Set(cur.map((x) => windDirText(x.windDir)))],
      });
    }
    cur = [];
  };
  for (const h of list) {
    if (h.precipMm <= mmTol && h.precipProb <= probTol) cur.push(h);
    else flush();
  }
  flush();
  return out;
}
