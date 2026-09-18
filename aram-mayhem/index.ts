#!/usr/bin/env npx tsx
/**
 * aram-mayhem MCP Server —— 英雄联盟「海克斯大乱斗」（ARAM Mayhem）助手
 *
 * 提供符文图鉴/搜索、羁绊（套装）推算、英雄视角推荐、版本对比。
 * 数据：社区站 arammayhem.com 的公开静态数据 + Riot 官方游戏文件（CommunityDragon 导出），
 *       由 lib/refresh.ts 合并成本地快照，运行时只读 data/，不联网（refresh_data 除外）。
 *
 * 启动: npx tsx index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { refreshData } from "./lib/refresh.js";
import { analyzeMyAugments, myAccountStatus, myRecentGames } from "./lib/my.js";
import { friendStats, listMyFriends } from "./lib/friends.js";
import { tftStats } from "./lib/tft.js";
import { archiveInfo } from "./lib/games.js";
import { analyzeMyPlaystyle } from "./lib/playstyle.js";
import { socialText } from "./lib/social.js";
import { buildsText } from "./lib/builds.js";
import { matchupsText } from "./lib/matchups.js";
import { exportText } from "./lib/export.js";
import { empiricalAugmentsText, empiricalPairsText, synergyCheckText } from "./lib/empirical.js";
import { tftDetailText } from "./lib/tft-detail.js";
import { trendText } from "./lib/trend.js";
import { queueStatsText } from "./lib/queue-stats.js";
import { compareAccounts } from "./lib/compare.js";
import { leaderboard } from "./lib/leaderboard.js";
import { myRanked } from "./lib/ranked.js";
import { scoutTeammates, sendChampSelectMessage } from "./lib/teammates.js";
import { resolveMe } from "./lib/identity.js";
import {
  analyzeSynergy,
  championGuide,
  comparePatches,
  dataInfo,
  getAugmentTool,
  listChampions,
  listSynergySets,
  searchAugmentsTool,
} from "./lib/tools.js";

const SCOPES = ["live", "unknown", "retired", "all"];

async function main() {
  const server = new Server(
    { name: "aram-mayhem", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_data_info",
        description:
          "查看海克斯大乱斗数据概况：当前补丁号、数据更新时间、符文/英雄/羁绊/搭配条数、数据来源与已知的数据出入（官方与社区站不一致的地方）。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search_augments",
        description:
          "搜索或浏览海斗强化符文（海克斯）。支持中文名、英文名、说明关键词搜索；可按品质（银/金/棱彩）和在池状态过滤；不带 query 就是按强度榜顺序列符文。返回品质、强度榜名次、胜率、选取率。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "关键词：符文名或说明里的字词（如 坦克引擎 / tank engine / 暴击）" },
            rarity: { type: "string", description: "品质过滤：silver(银) / gold(金) / prismatic(棱彩)" },
            mode: { type: "string", description: "模式过滤，如 海克斯大乱斗 / 斗魂竞技场" },
            scope: {
              type: "string",
              enum: SCOPES,
              description: "在池范围：live=当前在池（默认，无 query 时）/ unknown=状态未知 / retired=已下架 / all=全部",
            },
            limit: { type: "number", description: "最多返回多少条（默认 20，上限 100）" },
            sort: { type: "string", enum: ["rank", "name"], description: "排序：rank=强度榜名次（默认）/ name=按名字" },
          },
        },
      },
      {
        name: "get_augment",
        description:
          "查单个符文的详情：官方名/社区站名、品质、在池状态、中文效果说明、强度榜名次与胜率、强势英雄、所属羁绊、被推荐的英雄搭配。",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "符文名（中文或英文，可只写几个字）" },
          },
          required: ["name"],
        },
      },
      {
        name: "list_synergy_sets",
        description: "列出海斗的羁绊（套装）：每套需要哪些符文、凑齐后的效果。可按关键词过滤。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "可选：按羁绊名/效果/组成符文过滤" },
          },
        },
      },
      {
        name: "analyze_synergy",
        description:
          "羁绊推算：输入你已经拿到或正在考虑的符文，算出能凑出哪些羁绊、各差几件、还缺哪些符文（并标出哪些还当前在池）。",
        inputSchema: {
          type: "object",
          properties: {
            augments: {
              type: "array",
              items: { type: "string" },
              description: "符文名列表，如 [\"坦克引擎\", \"珠光护手\"]",
            },
          },
          required: ["augments"],
        },
      },
      {
        name: "list_champions",
        description: "按胜率或梯队列出海斗强势英雄（社区站统计的梯队与胜率）。",
        inputSchema: {
          type: "object",
          properties: {
            tier: { type: "string", description: "只看某一档：S+ / S / A / B / C" },
            sort: { type: "string", enum: ["winRate", "tier"], description: "排序方式，默认 winRate" },
            limit: { type: "number", description: "最多返回多少个（默认 25）" },
          },
        },
      },
      {
        name: "get_champion_guide",
        description:
          "英雄视角推荐：输入英雄（中文常用名/昵称/称号/英文名），返回梯队与胜率、推荐符文搭配（含社区站推荐理由）、该英雄进入强度榜前列的符文、相关羁绊。",
        inputSchema: {
          type: "object",
          properties: {
            champion: { type: "string", description: "英雄：亚索 / 火男 / 疾风剑豪 / Yasuo 都可以" },
            limit: { type: "number", description: "最多返回多少条搭配（默认 8）" },
          },
          required: ["champion"],
        },
      },
      {
        name: "compare_patches",
        description:
          "对比两个已归档补丁快照的差异：新增/移除的符文、说明改动、品质与名次变动、英雄梯队变动、羁绊增减。默认对比最近两个快照。",
        inputSchema: {
          type: "object",
          properties: {
            base: { type: "string", description: "基准补丁号（默认倒数第二个快照）" },
            target: { type: "string", description: "目标补丁号（默认最新快照）" },
          },
        },
      },
      {
        name: "get_my_account_status",
        description:
          "检查本地游戏客户端（LCU）连接状态，读取本机登录的国服账号并固定下来（写入 data/profile.json）。需要游戏客户端正在运行。",
        inputSchema: {
          type: "object",
          properties: {
            pin: { type: "boolean", description: "是否把当前账号写入 data/profile.json（默认 true）" },
          },
        },
      },
      {
        name: "get_my_recent_games",
        description:
          "读我最近的英雄联盟对局（默认只看海斗）：时间、英雄、胜负、KDA、时长。需要游戏客户端正在运行。",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "看最近多少把（默认 15，上限 50）" },
            only_mayhem: { type: "boolean", description: "只列海斗对局（默认 true；false 则列所有模式）" },
          },
        },
      },
      {
        name: "analyze_my_augments",
        description:
          "统计我最近海斗对局里拿过的符文（次数/胜率），并对照社区站强度榜看拿的符文是不是版本强势。依赖客户端上报符文字段，读不到时会直说。",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "统计最近多少把海斗（默认 20，上限 50）" },
          },
        },
      },
      {
        name: "list_my_friends",
        description:
          "列出本机客户端里当前账号的好友（含在线状态与名字#编号）。只能查好友列表里的人。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_friend_stats",
        description:
          "看某个好友的海斗战绩（读本机客户端缓存的对局）：胜率、常玩英雄、拿过的符文与版本名次、陷阱符文提示、还没拿过的神级符文。传部分名字即可匹配。",
        inputSchema: {
          type: "object",
          properties: {
            friend: { type: "string", description: "好友名字或名字的一部分（如 丁ding / 自己的丁ding#66595）" },
            limit: { type: "number", description: "最多读取多少把对局（默认 200，即客户端缓存的全部）" },
          },
          required: ["friend"],
        },
      },
      {
        name: "get_tft_stats",
        description:
          "查云顶之弈（TFT）战绩：平均名次、吃鸡率、前四率、名次分布、队列分布与最近几局明细。默认查自己，传 friend 可查好友。历史深度靠腾讯 SGP 分页（实测本机 684 局），只用客户端时上限是最近 20 局；输出里会标注实际来源。",
        inputSchema: {
          type: "object",
          properties: {
            friend: { type: "string", description: "可选：好友名字（部分匹配），不传就是查自己" },
            limit: { type: "number", description: "明细列最近多少局（默认 10）" },
          },
        },
      },
      {
        name: "analyze_my_playstyle",
        description:
          "打法画像：时段表现、战斗风格（KDA/伤害/阵亡、胜负局差异）、英雄池集中度、稳定性（连胜连败与近期走势）、以及你选的符文跟版本强势榜的契合度。基于本地归档+客户端数据。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_my_ranked",
        description:
          "查排位段位与战绩（单双排/灵活组排/云顶排位等）：段位、LP、胜负与连胜连败。默认查自己，传 friend 试查好友（客户端可能只给当前登录账号的）。需要客户端在线。",
        inputSchema: {
          type: "object",
          properties: {
            friend: { type: "string", description: "可选：好友名字（部分匹配）" },
          },
        },
      },
      {
        name: "get_my_teammates",
        description:
          "队友/对手分析：谁和你一起打得最多、共同胜率多少、和谁打最稳；以及遇到过哪些对手、你对他们的胜率。数据来自对局里完整的 10 人名单（SGP）。默认查自己，可传 who 查好友。",
        inputSchema: {
          type: "object",
          properties: {
            who: { type: "string", description: "可选：查哪个账号（好友名，部分匹配）。不传就是自己" },
            min_games: { type: "number", description: "只列同队/相遇至少 N 次的（默认 3）" },
          },
        },
      },
      {
        name: "get_friend_leaderboard",
        description:
          "小圈子榜单：把本地归档里出现过的账号按海斗胜率排名（含你自己和所有同场过的玩家）。可设最低样本局数。注意这不是全服排名。",
        inputSchema: {
          type: "object",
          properties: {
            min_games: { type: "number", description: "上榜最低局数（默认 10）" },
            top: { type: "number", description: "显示前多少名（默认 20）" },
          },
        },
      },
      {
        name: "compare_accounts",
        description:
          "跨账号对比：把两个账号的海斗核心指标并排比（局数/胜率/近期状态/KDA/伤害/常玩英雄/常用符文），并给一句克制的结论。a 不传就是自己。",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "string", description: "第一个账号（好友名/部分匹配）；不传=自己" },
            b: { type: "string", description: "第二个账号（好友名/部分匹配）" },
          },
          required: ["b"],
        },
      },
      {
        name: "get_my_builds",
        description:
          "出装分析：你最常出哪些装备、它们的胜率；哪些出得多但胜率偏低（该换）。数据来自对局里的 item0..item6（消耗品与饰品不计入）。",
        inputSchema: {
          type: "object",
          properties: {
            min_games: { type: "number", description: "只统计出现过至少 N 次的装备（默认 8）" },
          },
        },
      },
      {
        name: "get_my_matchups",
        description:
          "英雄对位分析：对面出现哪些英雄时你整体最容易输/最稳（你的克星与提款机），以及你玩某个英雄时的对位差异。海斗不能临场反选，所以用途是「这种局要改出装/改打法」。默认查自己，可传 who 查好友；样本不足的组合会被过滤。",
        inputSchema: {
          type: "object",
          properties: {
            who: { type: "string", description: "可选：查哪个账号（好友名，部分匹配）。不传就是自己" },
            min_games: { type: "number", description: "对面英雄至少出现多少次才列入（默认 12）" },
            min_champion_games: { type: "number", description: "英雄视角：你至少玩过多少把才展开（默认 15）" },
          },
        },
      },
      {
        name: "export_games_csv",
        description:
          "把对局明细导成 CSV（写到仓库 reports/ 目录，带 BOM，Excel 直接打开不乱码）：日期/时间/队列/英雄/胜负/KDA/伤害/金币/符文/装备/多杀。可选 kind=mayhem(默认,只看海斗) / lol(所有模式) / tft(云顶)。可传 who 导好友的。读不到的字段留空而不是填 0。",
        inputSchema: {
          type: "object",
          properties: {
            who: { type: "string", description: "可选：导出哪个账号（好友名，部分匹配）。不传就是自己" },
            kind: { type: "string", enum: ["mayhem", "lol", "tft"], description: "导什么：海斗 / 英雄联盟全部模式 / 云顶（默认 mayhem）" },
            out: { type: "string", description: "可选：自定义输出路径" },
          },
        },
      },
      {
        name: "get_queue_stats",
        description:
          "按队列拆分看：海斗其实不止一个队列（2400 普通 / 2410 巅峰赛 / 2450 经典模式版 / 4310 官方无名的那个），云顶也有排位与各种活动队列。列出每个队列的场次、胜率或平均名次、时长、英雄数。样本 <10 局的队列只报数字不下结论。",
        inputSchema: {
          type: "object",
          properties: {
            who: { type: "string", description: "可选：查哪个账号（好友名，部分匹配）。不传就是自己" },
            kind: { type: "string", enum: ["lol", "tft"], description: "看英雄联盟全部模式（默认 lol）还是云顶" },
            min_games: { type: "number", description: "多少局以上才下结论（默认 10）" },
          },
        },
      },
      {
        name: "get_my_trend",
        description:
          "周趋势：把对局按自然周（周一起算）分桶，看场次/胜率/KDA/场均伤害的逐周变化，并给出「最近 4 个有效周 vs 之前 4 个有效周」的结论。用归档数据，攒得越久越能看出长期走势。可查云顶（kind=tft）或好友（who）。",
        inputSchema: {
          type: "object",
          properties: {
            who: { type: "string", description: "可选：查哪个账号（好友名，部分匹配）。不传就是自己" },
            kind: { type: "string", enum: ["mayhem", "tft"], description: "看海斗（默认）还是云顶" },
            min_games_per_week: { type: "number", description: "一周至少多少局才算有效样本（默认 5），未达标的周不参与结论" },
          },
        },
      },
      {
        name: "get_tft_detail",
        description:
          "云顶棋子与装备维度：你最终阵容里带某个棋子/某件装备时平均名次如何、前四率多少，以及追到过三星的棋子。注意这是「最终阵容」统计（带着它收场时的成绩），不是「拿了它就能赢」。默认查自己，可传 who 查好友。",
        inputSchema: {
          type: "object",
          properties: {
            who: { type: "string", description: "可选：查哪个账号（好友名，部分匹配）。不传就是自己" },
            min_games: { type: "number", description: "棋子/装备至少出现多少局才列入（默认 12）" },
          },
        },
      },
      {
        name: "get_empirical_augments",
        description:
          "符文实证榜：用**本机归档里的真实对局**算符文胜率（每局都带全部 10 人的符文，当前样本约两千局两万行），并与社区站口径并列对照。这是观察数据不是实验数据 —— 符文是玩家自选的，含选择偏差，输出里会写明。",
        inputSchema: {
          type: "object",
          properties: {
            min_games: { type: "number", description: "只列出现至少 N 次的符文（默认 100）" },
            top: { type: "number", description: "各列前多少名（默认 20）" },
          },
        },
      },
      {
        name: "get_augment_pairs",
        description:
          "符文组合实证：同一局里同时拿到这两件时，比两件分开拿更好还是更差（协同 = 组合胜率 − 两件单拿胜率的均值）。用来找出真正 1+1>2 的搭配，以及互相抢资源的组合。",
        inputSchema: {
          type: "object",
          properties: {
            min_games: { type: "number", description: "组合至少一起出现 N 次才列入（默认 60）" },
            top: { type: "number", description: "列前多少组（默认 15）" },
          },
        },
      },
      {
        name: "check_synergy_sets",
        description:
          "羁绊验证：社区站定义的羁绊，在归档的真实对局里被凑齐时胜率如何。也会给出「一局实际能拿到几件符文」的分布，用来判断羁绊到底是不是可行的构筑目标。",
        inputSchema: {
          type: "object",
          properties: {
            min_games: { type: "number", description: "凑齐多少局以上才当作有效结论（默认 30）" },
          },
        },
      },
      {
        name: "get_champ_select_teammates",
        description:
          "选人阶段侦察队友（只读）：读当前选人会话里的队友，逐个拉他们最近的海斗战绩，整理成一份给你自己看的报告。不会往任何聊天频道发言。",
        inputSchema: {
          type: "object",
          properties: {
            games: { type: "number", description: "每个队友看多少把（默认 100）" },
          },
        },
      },
      {
        name: "send_champ_select_message",
        description:
          "往【当前选人频道】发一条消息（内容必须由用户明确给出；调用时需 confirm=true）。这是用户本人发言的加速器，不是自动发言：一次一条、文本由用户决定。对局内的我方/所有人频道官方没有接口，本工具做不到。",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "要发送的文本（用户指定的原文，不要自行生成评价）" },
            confirm: { type: "boolean", description: "必须为 true 才会真正发送" },
          },
          required: ["text"],
        },
      },
      {
        name: "get_archive_info",
        description:
          "查看本地对局归档的覆盖情况（海斗/英雄联盟 与 云顶各存了多少局、时间跨度、按模式分布）。归档随每次查询自动累积，客户端没开时分析就用它。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "refresh_data",
        description:
          "联网重新拉取数据并更新本地快照（社区站 + Riot 官方文件），会归档当前补丁快照用于版本对比。仅在需要更新数据时调用。",
        inputSchema: {
          type: "object",
          properties: {
            dry_run: { type: "boolean", description: "true 时只拉取校验、不写文件" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {
        case "get_data_info":
          return text(dataInfo());

        case "search_augments":
          return text(
            searchAugmentsTool({
              query: args.query ? String(args.query) : undefined,
              rarity: args.rarity ? String(args.rarity) : undefined,
              mode: args.mode ? String(args.mode) : undefined,
              scope: args.scope ? (String(args.scope) as "live" | "unknown" | "retired" | "all") : undefined,
              limit: args.limit ? Number(args.limit) : undefined,
              sort: args.sort === "name" ? "name" : args.sort === "rank" ? "rank" : undefined,
            })
          );

        case "get_augment":
          if (!args.name) return text("请提供符文名 name");
          return text(getAugmentTool({ name: String(args.name) }));

        case "list_synergy_sets":
          return text(listSynergySets({ query: args.query ? String(args.query) : undefined }));

        case "analyze_synergy":
          if (!args.augments) return text("请提供符文名列表 augments");
          return text(analyzeSynergy({ augments: args.augments as string[] | string }));

        case "list_champions":
          return text(
            listChampions({
              tier: args.tier ? String(args.tier) : undefined,
              sort: args.sort === "tier" ? "tier" : undefined,
              limit: args.limit ? Number(args.limit) : undefined,
            })
          );

        case "get_champion_guide":
          if (!args.champion) return text("请提供英雄名 champion");
          return text(
            championGuide({
              champion: String(args.champion),
              limit: args.limit ? Number(args.limit) : undefined,
            })
          );

        case "compare_patches":
          return text(
            comparePatches({
              base: args.base ? String(args.base) : undefined,
              target: args.target ? String(args.target) : undefined,
            })
          );

        case "get_my_account_status":
          return text(await myAccountStatus({ pin: args.pin !== false }));

        case "get_my_recent_games":
          return text(
            await myRecentGames({
              limit: args.limit ? Number(args.limit) : undefined,
              only_mayhem: args.only_mayhem !== false,
            })
          );

        case "analyze_my_augments":
          return text(await analyzeMyAugments({ limit: args.limit ? Number(args.limit) : undefined }));

        case "list_my_friends":
          return text(await listMyFriends());

        case "get_friend_stats":
          if (!args.friend) return text("请提供好友名字 friend");
          return text(
            await friendStats({ friend: String(args.friend), limit: args.limit ? Number(args.limit) : undefined })
          );

        case "get_tft_stats":
          return text(
            await tftStats({
              friend: args.friend ? String(args.friend) : undefined,
              limit: args.limit ? Number(args.limit) : undefined,
            })
          );

        case "analyze_my_playstyle":
          return text(await analyzeMyPlaystyle());

        case "get_my_ranked":
          return text(await myRanked({ friend: args.friend ? String(args.friend) : undefined }));

        case "get_my_teammates":
          return text(
            await socialText({
              who: args.who ? String(args.who) : undefined,
              minGames: args.min_games ? Number(args.min_games) : undefined,
            })
          );

        case "get_friend_leaderboard":
          return text(
            await leaderboard({
              minGames: args.min_games ? Number(args.min_games) : undefined,
              top: args.top ? Number(args.top) : undefined,
            })
          );

        case "compare_accounts":
          if (!args.b) return text("请提供第二个账号 b");
          return text(await compareAccounts(args.a ? String(args.a) : undefined, String(args.b)));

        case "get_my_builds":
          return text(await buildsText({ minGames: args.min_games ? Number(args.min_games) : undefined }));

        case "get_my_matchups":
          return text(
            await matchupsText({
              who: args.who ? String(args.who) : undefined,
              minGames: args.min_games ? Number(args.min_games) : undefined,
              minChampionGames: args.min_champion_games ? Number(args.min_champion_games) : undefined,
            })
          );

        case "export_games_csv":
          return text(
            await exportText({
              who: args.who ? String(args.who) : undefined,
              kind: args.kind ? (String(args.kind) as "mayhem" | "lol" | "tft") : undefined,
              out: args.out ? String(args.out) : undefined,
            })
          );

        case "get_queue_stats":
          return text(
            await queueStatsText({
              who: args.who ? String(args.who) : undefined,
              kind: args.kind === "tft" ? "tft" : "lol",
              minGames: args.min_games ? Number(args.min_games) : undefined,
            })
          );

        case "get_my_trend":
          return text(
            await trendText({
              who: args.who ? String(args.who) : undefined,
              kind: args.kind === "tft" ? "tft" : args.kind === "mayhem" ? "mayhem" : undefined,
              minGamesPerWeek: args.min_games_per_week ? Number(args.min_games_per_week) : undefined,
            })
          );

        case "get_tft_detail":
          return text(
            await tftDetailText({
              who: args.who ? String(args.who) : undefined,
              minGames: args.min_games ? Number(args.min_games) : undefined,
            })
          );

        case "get_empirical_augments":
          return text(
            await empiricalAugmentsText({
              minGames: args.min_games ? Number(args.min_games) : undefined,
              top: args.top ? Number(args.top) : undefined,
            })
          );

        case "get_augment_pairs":
          return text(
            await empiricalPairsText({
              minGames: args.min_games ? Number(args.min_games) : undefined,
              top: args.top ? Number(args.top) : undefined,
            })
          );

        case "check_synergy_sets":
          return text(
            await synergyCheckText({ minGames: args.min_games ? Number(args.min_games) : undefined })
          );

        case "get_champ_select_teammates": {
          const me = await resolveMe();
          const r = await scoutTeammates({
            myPuuid: me?.puuid ?? null,
            games: args.games ? Number(args.games) : undefined,
          });
          return text(r.text);
        }

        case "send_champ_select_message":
          return text(
            await sendChampSelectMessage({
              text: String(args.text ?? ""),
              confirm: args.confirm === true,
            })
          );

        case "get_archive_info":
          return text(await archiveInfo());

        case "refresh_data": {
          const r = await refreshData({ dryRun: args.dry_run === true });
          return text(
            [
              `数据已更新（补丁 ${r.patch}，${r.updatedAt}）${args.dry_run === true ? " —— dry_run，未写文件" : ""}`,
              `符文 ${r.counts.augments}（在池 ${r.counts.liveAugments} / 已下架 ${r.counts.retiredAugments} / 未知 ${r.counts.unknownAvailability}）`,
              `英雄 ${r.counts.champions} · 羁绊 ${r.counts.synergySets} · 搭配 ${r.counts.combos}`,
              r.patchChangedFrom ? `⚠ 补丁从 ${r.patchChangedFrom} 变为 ${r.patch}，旧快照已归档，可用 compare_patches 对比` : "",
              `数据出入：名称不一致 ${r.meta.validation.nameConflicts.length} · 品质不一致 ${r.meta.validation.rarityConflicts.length} · 仅官方有 ${r.meta.validation.officialOnly.length}`,
            ]
              .filter(Boolean)
              .join("\n")
          );
        }

        default:
          return text(`未知工具: ${name}`);
      }
    } catch (e: any) {
      return text(`错误: ${e?.message ?? e}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

main().catch(console.error);
