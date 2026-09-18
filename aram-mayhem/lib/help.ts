/**
 * 场景化引导：告诉用户（和模型）「你这个情况该用哪个工具」。
 *
 * 为什么需要：工具有四十多个，靠罗列名字没法用 —— 用户不会说「调用 get_my_matchups」，
 * 他会说「我最近老是被某个英雄打爆」。这个模块把工具**按用户意图**分组，
 * 每组给几句他真会说的话，再指向对应的工具。
 *
 * 维护约束：新增工具后要把它加进某个场景，否则 tools/audit-help.mjs 会报出来 ——
 * 引导表漏了新工具，等于那个工具从入口上就消失了。
 *
 * 纯静态文案，不读数据、不联网。
 */
import { loadData } from "./store.js";

export interface Scenario {
  /** 用户处在什么处境 */
  when: string;
  /** 他可能会说的话（这些是给模型做意图匹配用的） */
  asks: string[];
  /** 该用哪些工具 */
  tools: Array<{ name: string; what: string }>;
}

export const SCENARIOS: Scenario[] = [
  {
    when: "正在选人 / 刚排进去，想先看看队友",
    asks: ["选人阶段看看队友", "这把队友什么水平", "帮我看下队友最近打得怎么样", "队友战绩"],
    tools: [
      { name: "get_champ_select_teammates", what: "读当前选人会话里的队友，逐个拉他们最近的海斗战绩" },
      { name: "get_friend_stats", what: "只看某一个好友的战绩" },
      { name: "send_champ_select_message", what: "往选人频道发一条你指定的消息（需确认，不会自动发言）" },
    ],
  },
  {
    when: "刚打完一局，想复盘那一把",
    asks: ["刚才那把怎么样", "看看我最后那把", "9 月 17 号那把亚索", "复盘", "这局我打得如何"],
    tools: [
      { name: "get_game_detail", what: "单局详情：10 人摊开、两队伤害对比、我全场第几、这局符文成色。可按「最近第 N 把 / 日期 / 英雄名 / gameId」找" },
      { name: "get_my_recent_games", what: "最近几把的列表（英雄/胜负/KDA/时长），用来定位是哪一把" },
    ],
  },
  {
    when: "想知道自己最近的状态",
    asks: ["我最近打得怎么样", "最近胜率", "我是不是变菜了", "这段状态如何", "体检"],
    tools: [
      { name: "get_my_checkup", what: "一键体检：把各维度结论按「偏离基准的幅度」排序，最该看的排前面" },
      { name: "get_my_trend", what: "按周看走势（最近 4 周 vs 之前 4 周）" },
      { name: "export_self_compare_report", what: "前后两段并排报告：最近 N 把 vs 紧挨着的前 N 把" },
      { name: "analyze_my_playstyle", what: "打法画像：时段、风格、英雄池、稳定性、高光" },
    ],
  },
  {
    when: "想找出自己的毛病 / 该改什么",
    asks: ["我哪里有问题", "该练什么", "为什么老输", "我哪个符文用不好", "我是不是该换出装", "我这个打法行不行"],
    tools: [
      { name: "get_my_matchups", what: "对面出谁时你最容易输（用残差扣掉英雄本身强度）" },
      { name: "get_my_builds", what: "出装：出得多但胜率偏低的该换" },
      { name: "get_my_contribution", what: "你是不是必须自己 carry 才能赢" },
      { name: "get_my_tilt", what: "连败之后会不会打得更差、赢了会不会飘" },
      { name: "get_combat_profile", what: "承伤/控制/治疗/存活这些「伤害以外」的项做得如何" },
      { name: "get_enemy_comps", what: "对面阵容构成对你有没有影响" },
      { name: "get_empirical_augments", what: "符文实证榜：哪些符文在你的对局里真的赢" },
      { name: "analyze_my_augments", what: "我最近拿过的符文统计（次数/胜率），对照版本榜看拿的是不是强势符文" },
      { name: "get_counter_items", what: "对面肉多/刺客多时，归档里赢的那一方出的是什么" },
    ],
  },
  {
    when: "想查符文 / 英雄（对局外，纯资料）",
    asks: ["这个符文什么效果", "什么符文强", "亚索该拿什么", "有没有陷阱符文", "羁绊怎么凑", "现在什么英雄强"],
    tools: [
      { name: "search_augments", what: "搜/列符文（中文名、英文名、说明关键词）" },
      { name: "get_augment", what: "单个符文详情，含本机实证（这符文在归档里多少局、胜率、和谁搭）" },
      { name: "get_champion_guide", what: "英雄视角：梯队 + 推荐符文 + 本机实证（这英雄拿到哪些符文胜率高）" },
      { name: "list_champions", what: "按胜率/梯队列英雄" },
      { name: "list_synergy_sets", what: "羁绊有哪些、要哪些符文" },
      { name: "analyze_synergy", what: "羁绊推算：手上这几件还差什么" },
      { name: "get_data_info", what: "数据概况：补丁、条数、来源、已知的数据出入" },
      { name: "compare_patches", what: "两个补丁之间改了什么" },
    ],
  },
  {
    when: "想和别人比 / 想分享出去",
    asks: ["我和他谁强", "对比一下", "我们俩谁打得好", "生成报告", "发给朋友看"],
    tools: [
      { name: "compare_accounts", what: "两个账号核心指标并排 + 符文偏好差异（文字版）" },
      { name: "export_compare_report", what: "双账号对比报告（HTML，带图，可留档）" },
      { name: "get_friend_leaderboard", what: "小圈子榜单：归档里出现过的账号按胜率排" },
      { name: "export_report_markdown", what: "一屏看完的 Markdown 小结，能直接贴出去" },
    ],
  },
  {
    when: "想自己算 / 想要原始数据",
    asks: ["导出数据", "给我 CSV", "我要自己做分析", "原始对局"],
    tools: [
      { name: "export_games_csv", what: "对局明细 CSV（39 列，含队内名次与对面阵容构成）" },
      { name: "get_my_teammates", what: "队友/对手统计（谁一起打得最多、共同胜率）" },
      { name: "get_queue_stats", what: "按队列拆分（海斗普通/巅峰赛/经典模式版…）" },
      { name: "get_my_patches", what: "按补丁看自己的表现" },
      { name: "get_augment_pairs", what: "符文组合实证（一起拿是否比分开好）" },
      { name: "check_synergy_sets", what: "羁绊在实战里凑齐时的胜率" },
    ],
  },
  {
    when: "维护数据 / 其它",
    asks: ["更新数据", "数据太旧了", "归档里有多少", "绑定账号"],
    tools: [
      { name: "get_help", what: "就是这一份引导；忘了有什么功能时再看一遍" },
      { name: "refresh_data", what: "联网刷新数据快照（会归档当前补丁）" },
      { name: "get_archive_info", what: "本地归档覆盖情况（多少局、时间跨度、哪些账号）" },
      { name: "get_my_account_status", what: "连本地客户端、读并固定当前登录账号" },
      { name: "get_my_ranked", what: "排位段位与战绩" },
      { name: "list_my_friends", what: "列出客户端里的好友（用来确认名字）" },
      { name: "get_tft_stats", what: "云顶之弈战绩（默认查自己，可传好友）" },
      { name: "get_tft_detail", what: "云顶棋子与装备维度" },
    ],
  },
];

/** 引导文本：可以整份给，也可以按关键词只给相关场景 */
export function helpText(query?: string): string {
  const d = (() => {
    try {
      return loadData();
    } catch {
      return null;
    }
  })();

  const q = query?.trim();
  let list = SCENARIOS;
  if (q) {
    const hit = SCENARIOS.filter(
      (s) =>
        s.when.includes(q) ||
        s.asks.some((a) => a.includes(q)) ||
        s.tools.some((t) => t.name.includes(q) || t.what.includes(q))
    );
    // 命中了就用命中的；没命中就给全部（宁可多给，也别让人以为「查不到就是没有」）
    if (hit.length) list = hit;
  }

  const out: string[] = [];
  out.push("=== aram-mayhem 能做什么 ===");
  out.push(
    d
      ? `共 ${d.augments.length} 条符文、${d.champions.length} 个英雄、${d.synergySets.length} 套羁绊的数据，外加绑定本机账号后的个人战绩分析。当前数据补丁 ${d.meta.patch}。`
      : "符文图鉴 + 个人战绩分析。"
  );
  if (q && list.length !== SCENARIOS.length) {
    out.push(`（按「${q}」筛出 ${list.length} 个场景；想看全部就别传参数）`);
  } else if (q) {
    out.push(`（「${q}」没有匹配到具体场景，下面是全部）`);
  }
  out.push("");

  for (const s of list) {
    out.push(`■ ${s.when}`);
    out.push(`  你可能会说：${s.asks.map((a) => `「${a}」`).join(" / ")}`);
    for (const t of s.tools) out.push(`    · ${t.name} —— ${t.what}`);
    out.push("");
  }

  out.push(
    "说明：直接说人话就行（比如「我最近打得怎么样」），不用记工具名。"
  );
  out.push(
    "数据只读本地快照与你的对局归档；只有 refresh_data 会联网、send_champ_select_message 会写（且需要你确认）。"
  );
  // 参数写错会被明确拒绝。不写这一句，模型收到「参数不对…」可能以为**工具坏了**、
  // 转而去换别的工具或跟用户道歉 —— 实际上照着回复里的签名重发一次就行。
  out.push(
    "参数写错（名字/类型/取值不在词表里）不会被执行，会返回一段说明和该工具**完整的参数签名** —— " +
      "照着改一下重发即可，不是工具坏了，也不要为它换别的工具。"
  );
  return out.join("\n");
}
